# epsonprojector

エプソン社製プロジェクターを制御するモジュールです。
制御はESC/VP.netという通信プロトコルを使用します。プロトコルの詳細はエプソンのサイトなどで入手可能です。

## 使用方法

### 初期化
```JavaScript
const epsonprojector_factory = require('epsonprojector');
const proj = new epsonprojector_factory('EH-TW6700');
```
なお、初期化でモデル名を渡していますが、これが今のところログ出力にしか使用しておらず、機器探索などで使用していません。ESC/VP.netで機器探索をする際、ブロードキャストで応答を待つのですが、今のところは応答してきた機器を無条件に対象プロジェクターとしています。

### 電源ON/OFF
```JavaScript
// 電源ON
proj.on();
// 電源OFF
proj.off();
```

### マニュアルコマンド

コマンド文字列を指定して、レスポンスをコールバックで受けます。
下記のような感じでコマンド文字列の指定、コールバックの処理を行います。
```JavaScript
// プロジェクターの電源状態取得
proj.manual('PWR?', (res) => {
    for (let i = 0; i < res.length; res++) {
        let arg = res[i].match(/^PWR=([0-9]+)/);
        if (arg && arg.length >= 1) {
            console.log('Projector power is ' + (arg[1] == '01' ? 'ON' : 'OFF'));
        }
    }
});

// ランプ点灯時間取得
proj.manual('LAMP?', (res) => {
    for (let i = 0; i < res.length; res++) {
        let arg = res[i].match(/^LAMP=([0-9]+)/);
        if (arg && arg.length >= 1) {
            console.log('LAMP time is' + arg[1] + ' hours')
        }
    }
});
```

## 使用環境
以下のような環境で使用しています。

|項目|内容|
|:----|:--------------------------------------|
|ホスト|Raspberry Pi 3B+ Raspbian Stretch Lite|
|プロジェクター|エプソン社製EH-TW6700|
