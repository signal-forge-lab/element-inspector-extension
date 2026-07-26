# Element Inspector 開発者ガイド

## 構成

```text
element_inspector_extension/
├─ manifest.json
├─ background.js
├─ inspector.js
├─ content.js
├─ package.json
├─ README.md
├─ DEVELOPER_GUIDE.md
├─ assets/icons/main-icon.png
└─ tests/inspector.test.js
```

## 処理経路

```text
ツールバーアイコン
↓
background.jsがトップフレームへELEMENT_INSPECTOR_TOGGLEを送信
↓
content.jsがclosed Shadow DOM内に専用ウィンドウと強調枠を生成
↓
pointermove / focusinで対象を追跡
↓
通常選択はclickを抑止して固定
遅延固定はページ操作を素通しし、0秒時点の対象を固定
↓
inspector.jsでDOM情報を生成
↓
専用ウィンドウへ表示、Clipboard APIまたはBlobで出力
```

## 責務

### `background.js`

- `chrome.action.onClicked`の処理
- トップフレームへの起動・終了メッセージ送信
- Content Scriptを利用できないページの警告ログ

右クリックメニューは登録しません。

### `content.js`

- 専用ウィンドウの生成・破棄
- ヘッダドラッグによるウィンドウ移動
- ホバー・フォーカス対象の追跡
- 4辺独立で常時表示する虹色グラデーションアウトライン
- クリック固定、親子移動
- 遅延固定カウントダウン
- JSONプレビュー、コピー、ダウンロード

専用UIはclosed Shadow DOMへ配置し、ページ側CSSとの衝突を避けます。対象DOMのstyleは変更しません。強調枠は4本の`span`で構成し、各辺の背景位置だけを連続移動させます。

### `inspector.js`

Chrome APIに依存しないDOM解析モジュールです。ブラウザでは`globalThis.ElementInspector`、Nodeテストでは`module.exports`として公開します。

## 選択モード

### 通常選択

`pointermove`または`focusin`で対象を更新し、`click`をcapture phaseで抑止して固定します。ページ本来のクリック動作は実行しません。

### 遅延固定

カウント中はクリックを抑止しません。ページ操作を行いながら対象を追跡し、期限到達時に最後のホバーまたはフォーカス対象を固定します。

## 親子移動

- 親: `selectedElement.parentElement`
- 子: `selectedElement.firstElementChild`

移動後は同じ解析処理を再実行します。

## ウィンドウ移動

ヘッダの`pointerdown`でドラッグを開始し、Pointer Captureを使って`pointermove`を追跡します。位置はビューポート内へクランプし、ウィンドウサイズ変更時も画面外へ出ないよう補正します。

## セキュリティ方針

- 外部通信しない
- Storage APIを使用しない
- 対象DOMへstyleや属性を書き込まない
- 結果をBackgroundへ送らない
- クリップボード・ダウンロードはユーザー操作時だけ実行する

## テスト

```powershell
npm run check
npm test
```

テストではDOM解析結果、Manifest権限、ツールバー起動経路、専用UI、明滅しない常時表示の虹色アウトライン、親子移動、遅延固定、ドラッグ、外部通信・永続保存の不在を確認します。
