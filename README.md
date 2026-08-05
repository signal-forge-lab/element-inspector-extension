# Prismora — Web Element Inspector

Chromeのツールバーから起動し、ページ上のDOM要素を視覚的に選択して、Locator・階層・Styles・Accessibility・一時CSS編集・DOMスナップショットを確認、コピー、保存するChrome拡張です。

## 名称とブランドコンセプト

```text
Prismora
Web Element Inspector
```

読みは「プリズモラ」です。

> Prismを核に、光彩と広がりを感じさせる響きを加えた造語。Web要素を複数の観点へ分解し、可視化するInspectorを表す。

## 現在のバージョン

`0.13.0`

## 起動

1. Chromeで`chrome://extensions`を開きます。
2. 「デベロッパー モード」を有効にします。
3. 「パッケージ化されていない拡張機能を読み込む」から、このフォルダを選択します。
4. 対象ページでツールバーのPrismoraアイコンを押します。

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
固定Hierarchy・選択履歴・ピン比較・Overview / Styles / Edit / A11y / Locators / JSONを確認
```

### 専用ウィンドウ

- ヘッダをドラッグして移動できます。
- 左右端で横幅、下端で高さ、左下・右下で幅と高さを変更できます。
- ヘッダの`COMPACT` / `COMFORTABLE`セグメントで表示密度を切り替えます。
- Hierarchyはタブ外の固定エリアに常時表示します。
- `Current Target`と`Hierarchy`の間に独立した`Selection History`を置き、戻る・進むボタンと履歴ドロップダウンで過去の選択対象を移動できます。
- 現在対象を最大4件までピン留めし、`Compare`で比較できます。
- `Overview`で対象情報を確認します。
- `Styles`でBox Modelと主要Computed Styleを確認します。
- `Edit`でCSS・レイアウトを一時編集します。
- `A11y`で基本Accessibility情報と限定イベント情報を確認します。
- `Locators`でCSS Selector、XPath、JS Pathを確認・コピーします。
- `JSON`で全結果をコピーまたはファイル保存します。
- `prefers-reduced-motion`、`prefers-reduced-transparency`、`prefers-contrast`へ対応します。

UIはプロジェクト内の`apple-design`スキルを設計基準として、即時フィードバック、1:1ドラッグ、視覚階層、抑制されたマテリアル表現を重視しています。`0.9.0`で採用したCalm Hybrid方針を維持し、明るいニュートラル面と濃いグラファイトのデータ表示面を組み合わせています。メインアイコンは256pxの透過PNG原画を正本とし、同じデザインをサイズ別PNGへ縮小しています。

通常ページではフレーム表示を省略し、iframe内の要素を選択した場合だけ`IFRAME · DEPTH n`をヘッダへ表示します。選択状態と閉じる操作はヘッダ右側へ集約しています。

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

Hierarchyは`Overview`、`Styles`、`Edit`、`A11y`、`Locators`、`Compare`、`JSON`のどのビューでも利用できます。open Shadow Root直下の要素では、親移動がShadow Hostへ接続され、Shadow子とLight DOM子が混在する場合だけ子一覧へ種別を表示します。

## 選択履歴

要素のクリック固定、階層移動、子要素選択のたびに一時履歴へ追加します。

- 戻る：直前の選択対象へ戻る。文字付きの大型ボタンで表示
- 進む：戻る前の選択対象へ進む。文字付きの大型ボタンで表示
- 現在位置：`3 / 12`の形式で履歴内の位置を表示
- 履歴一覧：最大100件から任意の選択対象へ直接移動
- 戻ったあとに新しい要素を選択すると、進む側の履歴を破棄
- 最大100件
- iframeをまたいだ履歴移動に対応
- Inspector終了時に全履歴を破棄

履歴はLocatorから再探索せず、各フレーム内で保持した実際のElement参照を使用します。対象要素がページから削除されている場合は復元せず、エラーを表示します。

## パネルサイズと表示密度

パネルの左右端、下端、左下・右下をドラッグしてサイズを変更できます。ドラッグ中はPointer Captureを使用し、ポインターが端から外れても操作を継続します。

```text
最小幅: min(360px, viewport - 16px)
最小高さ: min(440px, viewport - 16px)
最大幅・高さ: viewport内
```

右下には控えめな斜線グリップを表示します。上端・上角はヘッダ移動との競合を避けるためリサイズ対象にしていません。

- `Compact`: 操作列、Hierarchy、結果表示を高密度に配置
- `Comfortable`: ヘッダ、操作部品、セクション余白、カード間隔を明確に拡大

パネル幅・高さと表示密度はInspectorを閉じるまで維持し、Storageへ保存しません。画面サイズが変わった場合は、パネルがビューポート外へ出ないようサイズと位置を補正します。

## ピン留め比較

固定中の対象を`Pin`で最大4件まで比較へ追加できます。ピン留め時点のDOM解析結果をスナップショットとして保持します。

`Compare`では次を確認できます。

- Tag / Identity
- Rect / Text
- Frame
- CSS Selector / XPath / JS Pathの個別コピー
- ピン対象の再選択
- 個別解除・全解除

対象Elementが後から削除されても比較スナップショットは残ります。再選択時にElementまたはiframeが存在しない場合だけ、エラーを表示します。ピン留めと比較内容はInspector終了時に破棄します。

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

open Shadow DOM内部では、Shadow HostごとのSelectorを連結したJS Pathを生成します。

```js
document.querySelector('#app-host')
  ?.shadowRoot?.querySelector('#toolbar-host')
  ?.shadowRoot?.querySelector('[data-testid="save"]')
```

Locatorの状態バッジには、一意性に加えて`DOCUMENT`または`FRAME`、必要に応じて`SHADOW`基準を表示します。

## open Shadow DOM対応

open Shadow Root内部の要素を通常の要素と同じ選択操作で固定できます。

- nested open Shadow Root
- Shadow Root直下からShadow Hostへの親移動
- Shadow子とLight DOM子を含む子要素一覧
- Shadow Root内相対CSS Selector
- Shadow Hostチェーンを含むJS Path
- Shadow深度とHost一覧のJSON出力

XPathはブラウザ仕様上Shadow Root境界を越えないため、Shadow DOM内部では`unsupported`として表示します。closed Shadow DOM内部は対象外です。

## Computed Style / Box Model

`Styles`タブでは、固定時点の`getComputedStyle()`と要素サイズから次を表示します。

- margin / border / padding / contentの各領域
- border boxとscroll size
- display / position / box-sizing / width / height / overflow / z-index
- Flex / Gridの方向・整列・gap・template
- font / line-height / letter-spacing / text-align / color

表示値は固定するたびに再取得され、JSONの`computedStyles`と`boxModel`にも含まれます。

## CSS・レイアウト一時編集

`Edit`タブでは、固定中の要素へ次のCSSプロパティを一時適用できます。

- width / height / min・max size
- margin / paddingと各辺
- display / position / top / right / bottom / left
- gap / Flex alignment / Grid columns
- color / background-color
- font-size / line-height
- border-radius / overflow / z-index

編集は対象要素の既存`style`属性を上書きせず、Documentまたはopen Shadow Rootごとの専用スタイル層から`!important`付きで適用します。

- `Undo`: 現在のフレーム内で直前の編集を戻す
- `対象をReset`: 現在の要素だけ解除
- `全Reset`: 全iframeを含むすべての一時編集を解除
- `編集CSSをコピー`: 現在フレームの編集CSSをコピー
- Inspector終了時またはページ再読み込み時に完全撤去
- Storageへ保存しない

編集結果は選択履歴を増やさず再解析され、JSONの`temporaryEdits`に編集前・指定値・適用後の値、対象数、コピー用CSSを出力します。対象識別用の一時属性はJSONから除外し、Resetまたは終了時に元の状態へ戻します。

## 基本Accessibility / 限定イベント情報

`A11y`タブでは、DOMから推定できる範囲で次を表示します。

- 明示role / 暗黙role
- accessible nameと推定元
- aria-describedby / aria-descriptionなどの説明
- label関連付け
- focus可能性、順次フォーカス、tabindex
- heading level
- disabled / hidden / required / checked / expanded / pressedなどの状態
- `aria-*`属性一覧

イベント情報は、`onclick`などのHTMLイベント属性と`element.onclick`などのDOM0プロパティだけを表示します。`addEventListener()`で登録されたリスナー、React・Vueなどフレームワーク内部イベント、Chrome DevTools Protocolのイベント一覧は取得しません。

取得結果はJSONの`accessibility`と`events`にも含まれます。Accessibility情報はブラウザの完全なAccessibility Treeではなく、通常DOMからの基本推定です。

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
一時CSS編集
Accessibility / 限定イベント解析
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
      "framePath": [],
      "shadowDepth": 0
    }
  },
  "navigation": {},
  "shadow": {},
  "computedStyles": {},
  "boxModel": {},
  "temporaryEdits": {},
  "accessibility": {},
  "events": {},
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
- パネル幅・高さ、表示密度、ピン留め、比較内容を永続保存しません。
- 一時編集、Undo履歴、Accessibility・イベント解析結果を永続保存しません。
- 一時編集用の属性とスタイル層はResetまたはInspector終了時に撤去します。

Content Scriptは`<all_urls>`へ宣言されます。これはツールバー起動後に、トップページとiframe内の対象要素を選択・解析するためです。

解析結果にはページ内テキスト、属性、URL、内部IDなどが含まれる可能性があります。共有前に内容を確認してください。

## 制限

- `chrome://`ページ、Chromeウェブストア、拡張機能管理ページなどでは利用できません。
- closed Shadow DOM内部には対応していません。
- XPathはShadow Root内部では生成できません。
- Shadow Root内のCSS SelectorはそのShadow Root基準です。
- iframe内LocatorはフレームDocument基準です。
- 元のインラインCSSに`!important`が指定されている場合、一時編集が上書きできないことがあります。
- Accessibilityは通常DOMからの基本推定で、Chromeの完全なAccessibility Treeとは一致しない場合があります。
- イベント情報はHTML属性とDOM0プロパティに限定されます。

## 開発時の確認

```powershell
npm run check
npm test
```

## ロードマップ

- `0.14.0`: Styles検索、変更差分、CSS Custom Properties、Edit連携
- `0.15.0`: DOMから確実に判定できるAccessibility診断の強化
- `0.16.0`: Locator安定度とPlaywright・Cypress・Selenium向け出力

## 導入済みスキル

- `.agents/skills/apple-design/SKILL.md`
- 出典とライセンスは`THIRD_PARTY_NOTICES.md`を参照してください。
