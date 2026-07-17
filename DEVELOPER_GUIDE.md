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
└─ tests/
   └─ inspector.test.js
```

## 処理経路

```text
contextmenuイベント
↓
Content Scriptがevent.targetをメモリ内に保持
↓
ユーザーが「Element Inspector」を選択
↓
Backgroundがinfo.frameId宛てにELEMENT_INSPECTOR_RUNを送信
↓
Content Scriptが対象の存在とisConnectedを確認
↓
inspector.jsのinspectElement()で解析
↓
JSON.stringify(result, null, 2)
↓
navigator.clipboard.writeText()
↓ 失敗時
一時textarea + document.execCommand('copy')
↓
右クリック対象へ黒白の二重枠オーバーレイを約3秒表示
（明暗を約2回繰り返し、最後は透明度0までフェードアウト）
↓
Console出力と一時通知
```

## 責務

### `background.js`

- コンテキストメニュー登録
- 対象タブとフレームへのメッセージ送信
- Content Script未注入時の警告ログ

DOM解析や結果保持は行いません。

### `content.js`

- 右クリック対象の一時保持
- Backgroundからの実行指示受信
- クリップボードコピー
- 成功・失敗通知
- コピー成功時の右クリック対象強調表示
- Console表示

結果の永続保存や外部送信は行いません。

強調表示は`lastContextMenuTarget`、つまり右クリックした要素自体を囲みます。対象要素と親要素のstyleは書き換えず、closed Shadow DOM内の固定配置オーバーレイとして表示します。CSS Animationは`HIGHLIGHT_DURATION_MS`（現在3000ミリ秒）全体を使い、明暗を約2回繰り返した後、終端で透明度0までフェードアウトします。表示中は`requestAnimationFrame()`で対象位置を追従し、`animationend`、対象要素の削除、または安全用タイマーのいずれかでオーバーレイを破棄します。白枠と黒い外枠を重ねることで、元の背景色が明色・暗色のどちらでも識別しやすくしています。

拡張機能のメインアイコンは`assets/icons/main-icon.png`です。`action.default_icon`は全サイズでこの画像を参照し、ツールバー表示を維持します。

右クリックメニューは`contextMenus.create()`で個別アイコンを指定できず、Manifestの16px拡張アイコンを使用します。そのため`manifest.icons`だけを次のように分離しています。

```text
16px: assets/icons/context-menu-icon-16.png
32px: assets/icons/context-menu-icon-32.png
48px: assets/icons/main-icon.png
128px: assets/icons/main-icon.png
```

ライト／ダークテーマを検出して画像を差し替えるAPIもないため、右クリックメニュー用画像は透明背景の黒線に白い外縁を重ねた単一のモノクロ画像です。現在の拡張には拡張機能ページがないため、Manifestの16px画像を変更した影響は実質的に右クリックメニュー表示へ限定されます。

### `inspector.js`

Chrome APIへ依存しないDOM解析モジュールです。ブラウザでは `globalThis.ElementInspector`、Nodeテストでは `module.exports` として公開します。

## 出力契約

DevTools版と同じ主要構造を維持します。

```js
{
  selectedTag,
  selectedAttributes,
  controlTag,
  controlAttributes,
  text,
  svg,
  ancestors,
  outerHTML
}
```

## 操作対象の探索

```css
button, [role="button"], a, [tabindex]
```

右クリック対象から `closest()` で探索し、該当要素がなければ対象自身を使います。

## Shadow DOM

`contextmenu` イベントの `composedPath()` から最初のElementを優先します。これにより、参照可能なShadow DOM内部では単純な `event.target` より内側の対象を保持できる場合があります。ただしclosed Shadow DOMなど、ブラウザから参照できない内部は解析できません。

## iframe

`manifest.json` の `all_frames: true` と、`background.js` の次の指定を組み合わせます。

```js
chrome.tabs.sendMessage(tab.id, message, { frameId });
```

DOM要素はメッセージで送らず、該当フレームのContent Script内に保持します。

## コピー処理

第一経路:

```js
navigator.clipboard.writeText(json)
```

フォールバック:

```js
document.execCommand('copy')
```

フォールバック用textareaは処理直後に削除します。

## セキュリティ方針

- ユーザーの明示操作時だけ解析する
- 定期ポーリングを行わない
- MutationObserverを登録しない
- ネットワークAPIを使用しない
- Storage APIを使用しない
- Cookieや認証情報を別途読み取らない
- 結果をBackgroundへ送らない

## 既知の制限

- Chrome内部ページなどContent Scriptを注入できないページでは使用不可
- 右クリック後に対象が置換された場合は再探索せず明示的に失敗
- 擬似要素、イベントリスナー、React内部stateは取得しない
- `outerHTML`は5000文字で切り詰める
- 親要素は8階層まで

## テスト

```powershell
npm run check
npm test
```

テストでは、解析結果構造、操作対象探索、SVG情報、親要素、HTML制限、Manifest権限、iframe配線、外部通信・永続保存の不在を確認します。
