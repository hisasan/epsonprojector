'use strict';

const dgram      = require('dgram');
const net        = require('net');
const debug      = require('debug')('epsonprojector');

const port       = 3629;
const protocolid = 'ESC/VP.net';
const versionid  = 0x10;

var backup_address = '';

// フレームタイプ
const FT = {
    HELLO:   0x01,
    CONNECT: 0x03
};

// ステータスコード
const SC = {
    REQUEST: 0x00,
    OK:      0x20
};

// フレーム
const HELLO      = createFrame({type:FT.HELLO,   status:SC.REQUEST});
const CONNECT    = createFrame({type:FT.CONNECT, status:SC.REQUEST});

// フレーム作成(numberOfHeaderまで)
function createFrame(f) {
    let b = Buffer.allocUnsafe(16);
    b.write(protocolid, 0);
    b[10] = versionid;
    b[11] = f.type;
    b.writeUIntBE(0x0000, 12, 2);
    b[14] = f.status;
    if (!f.hasOwnProperty('header') || f.header.length == 0) {
        // ヘッダなし
        b[15] = 0;
        return b;
    }
    // ヘッダ付加
    let pool = [b];
    b[15] = f.header.length;
    for (let i = 0; i < f.header.length; i++) {
        let h = Buffer.alloc(18);
        h[0] = f.header[i].id;
        h[1] = f.header[i].attr;
        if (f.header[i].hasOwnProperty('info')) {
            h.write(f.header[i].info, 2, Math.min(16, f.header[i].info.length));
        }
        pool.push(h);
    }
    return Buffer.concat(pool);
}

// フレーム解析
function parseFrame(b) {
    const baseSize   = 16;
    const headerSize = 18;
    if (b.length < baseSize) {
        // フレームが短すぎる
        return null;
    }
    if (b.toString('ascii', 0, protocolid.length) != protocolid || b[10] != versionid) {
        // プロトコルIDまたはバージョンIDが異なる
        return null;
    }
    let f = {
        type:   b[11],
        status: b[14],
        header: []
    };
    let numberOfHeader = b[15];
    if (b.length < (baseSize + numberOfHeader * headerSize))
    {
        // フレーム長さが足りない
        return null;
    }
    for (let i = 0; i < numberOfHeader; i++) {
        let offset = baseSize + i * headerSize;
        f.header.push({
            id:   b[offset + 0],
            attr: b[offset + 1],
            info: b.toString('ascii', offset + 2, 16)
        });
    }
    return f;
}

// Projectorクラスコンストラクタ
var Projector = function (model) {
    this.udpServer = null;
    this.udpClient = null;
    this.timer     = null;
    this.run       = null;
    this.que       = [];
    this.model     = model;
};

// Projectorクラスメンバクリア
Projector.prototype.clean = function() {
    if (this.udpServer != null) {
        this.udpServer.close();
        this.udpServer = null;
    }
    if (this.udpClient != null) {
        this.udpClient.close();
        this.udpClient = null;
    }
    if (this.timer != null) {
        clearTimeout(this.timer);
        this.timer = null;
    }
};

function command(f, c) {
    return new Promise((resolve, reject) => {
        let receive_1st = true;
        let proc_ok = false;
        let socket = new net.Socket();
        f.discover()
        .then((address) => {
            // プロジェクターに接続
            socket.connect(port, address, () => {
                debug(`epsonprojector: connected`);
                socket.write(CONNECT);
            });
    
            // プロジェクターからの受信を解析
            socket.on('data', (data) => {
                if (receive_1st) {
                    receive_1st = false;
                    socket.write(c.cmd + '\r');
                    return;
                }
                let ws = data.toString().split('\r');
                c.callback(ws);
                proc_ok = true;
                resolve(ws);
                socket.destroy();
            });
    
            // 接続でエラー発生
            socket.on('error', () => {
                console.log('error');
            });
    
            // 接続が閉じた（接続できなかったとき）
            socket.on('close', () => {
                debug(`epsonprojector: closed`);
                reject('error');
                if (!proc_ok) {
                    c.callback('error');
                    proc_ok = true;
                }
            });
        })
        .catch((e) => {
            reject(e);
            if (!proc_ok) {
                c.callback('error');
                proc_ok = true;
            }
        });
    });
}

function dispatcher(f) {
    if (f.run == null) {
        if (f.que.length > 0) {
            // 次のコマンドをキューから取得
            f.run = f.que.shift();
        } else {
            // キューが空
            f.run = null;
        }
    }

    if (f.run) {
        command(f, f.run)
        .then(() => {
            dispatcher2(f);
        })
        .catch(() => {
            dispatcher2(f);
        });
    }
}

function dispatcher2(f) {
    f.run = null;
    dispatcher(f);
}

function pushExec(f, s, c) {
    f.que.push({cmd:s, callback:c});
    if (f.run) {
        return;
    }
    dispatcher(f);
}

// プロジェクター検索
Projector.prototype.discover = function() {
    this.retry = 30;

    return new Promise((resolve, reject) => {
        // HELLOフレームの応答を受信する準備
        this.udpServer = dgram.createSocket('udp4');
        this.udpServer.on('error', (err) => {
            console.error(`${this.model} discover error:\n${err.stack}`);
            this.clean();
            reject();
        });
        this.udpServer.on('message', (msg, rinfo) => {
            // HELLOフレームの正常な応答かチェックする
            let f = parseFrame(msg);
            if (f == null) {
                return;
            }
            if (f.type   == FT.HELLO &&
                f.status == SC.OK) {
                // 正常な応答の場合送信元アドレスをresolveで後続に伝達
                if (backup_address != rinfo.address) {
                    console.log(`Found ${this.model} on ${rinfo.address}`);
                    backup_address = rinfo.address;
                }
                this.clean();
                resolve(rinfo.address);
            }
        });
        this.udpServer.bind(port);

        // HELLOフレームを送信する処理
        let sendHello = () => {
            // タイムアウト設定
            this.timer = setTimeout(() => {
                if (--this.retry >= 0) {
                    // リトライ
                    sendHello();
                    return;
                }
                // タイムアウトで処理を中断
                console.error(`${this.model} not found`);
                this.timer = null;
                this.clean();
                if (backup_address != '') {
                    resolve(backup_address);
                }
                reject();
            }, 1000);
            // HELLOフレームを送信してESC/VP.net対応機器の応答を待つ
            this.udpClient.send(HELLO, port, '255.255.255.255');
        };
        this.udpClient = dgram.createSocket('udp4');
        this.udpClient.bind(() => {
            this.udpClient.setBroadcast(true);
        });
        sendHello();
    });
};

// プロジェクターマニュアル入出力
Projector.prototype.manual = function(cmd, callback) {
    pushExec(this, cmd, callback);
};

// プロジェクターON
Projector.prototype.on = function() {
    pushExec(this, 'PWR ON', () => {});
};

// プロジェクターOFF
Projector.prototype.off = function() {
    pushExec(this, 'PWR OFF', () => {});
};

module.exports = Projector;
