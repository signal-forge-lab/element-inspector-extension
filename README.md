# Element Inspector

Chromeのツールバーから起動し、ページ上のDOM要素を視覚的に選択して、Locator・階層情報・DOMスナップショットを確認・コピー・保存するChrome拡張です。

## 現在のバージョン

`0.8.1`

## 起動

1. Chromeで`chrome://extensions`を開きます。
2. 「デベロッパー モード」を有効にします。
3. 「パッケージ化されていない拡張機能を読み込む」から、このフォルダを選択します。
4. 対象ページでツールバーのElement Inspectorアイコンを押します。

同じアイコンをもう一度押すか、専用ウィンドウの閉じるボタンまたは`Esc`で終了します。

## 操作

```text
ツールバーアイコンを押す
↓
ページ内に専用Inspectorウィンドウを表示
↓
ホバー中の要素を虹色アウトラインで常時強調
↓
クリックして固定
↓
固定Hierarchy・選択履歴・Overview / Locators / JSONを確認
```

### 専用ウィンドウ

- ヘッダをドラッグして移動できます。
- Hierarchyはタブ外の固定エリアに常時表示します。
- 戻る・進むボタンで過去の選択対象を移動できます。
- `Overview`で対象情報を確認します。
- `Locators`でCSS Selector、XPath、JS Pathを確認・コピーします。
- `JSON`で全結果をコピーまたはファイル保存します。
- `prefers-reduced-motion`、`prefers-reduced-transparency`、`prefers-contrast`へ対応します。

UIはプロジェクト内の`apple-design`スキルを設計基準として、即時フィードバック、1:1ドラッグ、視覚階層、抑制されたマテリアル表現を重視しています。

`TOP FRAME`またはiframe情報、選択状態、閉じる操作はヘッダ右側へ集約しています。閉じるアイコンは文字ではなくSVGで描画し、ボタン中央へ配置します。

## 要素選択

### 通常選択

ホバーまたはフォーカス中の要素を強調し、クリックで固定します。固定に使用したクリックはページ本来の操作へ伝播しません。

### 遅延固定

1〜60秒を指定して`秒後に固定`を押すと、カウント中はページを通常操作できます。0秒時点で最後にホバーまたはフォーカスされた要素を固定します。

### 強調表示

対象DOM自体のstyleは変更しません。各Document上に独立したオーバーレイを配置し、4辺のグラデーション背景だけを連続移動させます。

- 明滅なし
- opacityアニメーションなし
- mask-composite不使用
- iframe内ではiframe自身のビューポート内に表示

## 階層ナビゲーション

固定後、次の移動ができます。

- 親要素
- 前の兄弟要素
- 次の兄弟要素
- 最初の子要素
- 最後の子要素
- 子要素一覧から任意の子を選択

ウィンドウには兄弟内の現在位置と子要素数を表示します。移動するたびにDOM解析とLocator生成を再実行します。

Hierarchyは`Overview`、`Locators`、`JSON`のどのビューでも利用できます。

## 選択履歴

要素のクリック固定、階層移動、子要素選択のたびに一時履歴へ追加します。

- 戻る：直前の選択対象へ戻る
- 進む：戻る前の選択対象へ進む
- 戻ったあとに新しい要素を選択すると、進む側の履歴を破棄
- 最大100件
- iframeをまたいだ履歴移動に対応
- Inspector終了時に全履歴を破棄

履歴はLocatorから再探索せず、各フレーム内で保持した実際のElement参照を使用します。対象要素がページから削除されている場合は復元せず、エラーを表示します。

## Locator生成

### CSS Selector

現在のDocumentまたはSelector Root内で一意になる候補を優先します。

優先順位の概要：

```text
一意なid
data-testid / data-test / data-qa
aria-label / name / title / alt
安定したclass
role / type / value / placeholder
DOM階層 + nth-of-type
```

生成クラスと推定される値は低優先度にします。

### XPath

一意な属性ベースXPathを優先し、該当しない場合は絶対XPathを生成します。SVGなど名前空間を持つ要素では`local-name()`を使用します。

### JS Path

CSS Selectorを利用して、現在のDocument内で実行できる式を生成します。

```js
document.querySelector('[data-testid="save-button"]')
```

iframe内部で生成されたJS Pathは、そのiframeのDocument基準です。トップDocumentからクロスオリジンiframe内部へ直接到達する式ではありません。

Locatorの状態バッジには、一意性に加えて`DOCUMENT`または`FRAME`基準を表示します。

## iframe対応

Content Scriptは一致する全フレームへ注入されます。

対応対象：

- トップフレーム
- 同一オリジンiframe
- クロスオリジンiframe
- nested iframe
- `about:blank`系フレーム
- initiator originで一致する`data:`、`blob:`などのフレーム

トップフレームはInspectorウィンドウと全体状態を管理し、各iframeは次を担当します。

```text
要素検出
クリック固定
アウトライン描画
DOM解析
Locator生成
```

iframe間の選択結果はBackground Service Workerを介してトップフレームへ集約します。nested iframeの経路は、親子フレーム間の`postMessage`ハンドシェイクで構築します。

## JSON出力

主要項目：

```json
{
  "selectedTag": "button",
  "selectedAttributes": {},
  "selectedText": "保存",
  "selectedRect": {},
  "selectedOuterHTML": "<button>保存</button>",
  "controlTag": "button",
  "controlAttributes": {},
  "controlRect": {},
  "text": "保存",
  "locators": {
    "css": {
      "value": "[data-testid=\"save-button\"]",
      "matchCount": 1,
      "unique": true,
      "scope": "document"
    },
    "xpath": {
      "value": "//*[@data-testid='save-button']",
      "matchCount": 1,
      "unique": true,
      "scope": "document"
    },
    "jsPath": {
      "value": "document.querySelector('[data-testid=\"save-button\"]')",
      "scope": "document"
    },
    "context": {
      "frameRelative": false,
      "frameId": 0,
      "framePath": []
    }
  },
  "navigation": {},
  "frame": {},
  "svg": null,
  "ancestors": [],
  "outerHTML": "<button>保存</button>"
}
```

制限：

- `selectedOuterHTML`と`outerHTML`は最大5,000文字
- `ancestors`は最大8階層
- 子要素一覧は最大80件
- 座標は各Documentのビューポート基準

## 権限とプライバシー

- 使用権限は`clipboardWrite`のみです。
- 外部通信を行いません。
- DOM解析結果をサーバーへ送信しません。
- localStorage、sessionStorage、Chrome Storageを使用しません。
- 選択履歴を永続保存しません。

Content Scriptは`<all_urls>`へ宣言されます。これはツールバー起動後に、トップページとiframe内の対象要素を選択・解析するためです。

解析結果にはページ内テキスト、属性、URL、内部IDなどが含まれる可能性があります。共有前に内容を確認してください。

## 制限

- `chrome://`ページ、Chromeウェブストア、拡張機能管理ページなどでは利用できません。
- closed Shadow DOM内部には対応していません。
- open Shadow DOMの完全なHostチェーンとJS Pathは後続版の対象です。
- XPathはShadow Root内部では生成できません。
- iframe内LocatorはフレームDocument基準です。

## 開発時の確認

```powershell
npm run check
npm test
```

## 導入済みスキル

- `.agents/skills/apple-design/SKILL.md`
- 出典とライセンスは`THIRD_PARTY_NOTICES.md`を参照してください。
