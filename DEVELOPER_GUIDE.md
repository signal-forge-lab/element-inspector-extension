# Element Inspector 開発者ガイド

## バージョン

`0.12.0`

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
├─ THIRD_PARTY_NOTICES.md
├─ skills-lock.json
├─ .agents/skills/apple-design/SKILL.md
├─ assets/icons/main-icon-source.svg
├─ assets/icons/main-icon-{16,32,48,128}.png
└─ tests/inspector.test.js
```

## 全体アーキテクチャ

```text
Toolbar action
↓
background.js
├─ タブ単位のactive状態
├─ activeFrameId
├─ selectedFrameId
├─ 全フレームbroadcast
└─ 指定frameIdへのcommand routing

Top frame content.js
├─ Inspector window
├─ UI state
├─ countdown
├─ selection history
├─ pinned snapshots / comparison
├─ panel resize / density
├─ styles / box model view
├─ temporary CSS editor
├─ accessibility / limited events view
├─ export
└─ frame result aggregation

Child frame content.js
├─ pointer/focus detection
├─ local highlight overlay
├─ click fixation
├─ DOM analysis
└─ parent frame context handshake

inspector.js
├─ DOM snapshot
├─ CSS Selector
├─ XPath
├─ JS Path
├─ open Shadow DOM context
├─ computed styles / box model
├─ accessibility estimation
├─ limited DOM0 / inline event collection
└─ hierarchy metadata
```

## `background.js`

### メッセージ契約

```text
ELEMENT_INSPECTOR_SET_ACTIVE
ELEMENT_INSPECTOR_QUERY_STATE
ELEMENT_INSPECTOR_FRAME_READY
ELEMENT_INSPECTOR_FRAME_EVENT
ELEMENT_INSPECTOR_FRAME_COMMAND
ELEMENT_INSPECTOR_TOP_EVENT
ELEMENT_INSPECTOR_TOP_COMMAND
```

### 状態

タブごとに次を保持します。

```js
{
  active: false,
  activeFrameId: null,
  selectedFrameId: null
}
```

- `activeFrameId`: 最後にホバー情報を送ったフレーム
- `selectedFrameId`: 固定中の要素を所有するフレーム

Service Worker再起動後でも、ツールバークリック時にトップフレームへ現在状態を問い合わせてから反転します。新しい子フレームが接続した場合も、トップフレーム状態から復元します。

## `content.js`

同じContent Scriptを全フレームで実行し、`window.top === window`とBackgroundから返る`frameId`で役割を分けます。

### フレーム共通責務

- 選択モード管理
- pointermove / focusin追跡
- クリック固定
- local highlight overlay
- DOM解析
- Document / open Shadow DOM階層移動
- 一時CSS編集の適用・Undo・Reset
- Backgroundとのメッセージ通信

### トップフレーム専用責務

- Inspectorウィンドウ生成
- Overview / Styles / Edit / A11y / Locators / Compare / JSONタブ
- 固定Hierarchy領域
- 選択履歴の戻る・進む・直接選択
- 最大4件のピン留め比較
- パネル横幅・高さ・斜めリサイズ
- Compact / Comfortable密度切替
- 遅延固定カウント
- Locator単体コピー
- JSONコピー・保存
- 編集CSSコピー
- ヘッダドラッグ

### iframe経路

各子フレームは親へ`postMessage`で`HELLO`を送り、親Content Scriptが`event.source`と`iframe.contentWindow`を照合します。

親はiframe要素のCSS Selectorを生成し、既存の親経路へ追加して子へ返します。nested iframeで親経路の到着が遅れた場合は、登録済みの子フレームへ更新済みContextを再送します。

この経路は診断情報であり、機密情報やDOM内容の転送には使用しません。

## `inspector.js`

Chrome APIに依存しないDOM解析モジュールです。ブラウザでは`globalThis.ElementInspector`、Nodeテストでは`module.exports`として公開します。

### Locator API

```js
generateCssLocator(element)
generateXPathLocator(element)
generateJsPath(element, cssLocator)
getComposedParent(element)
getSiblingElements(element)
getNavigableChildren(element)
collectShadowContext(element)
collectComputedStyles(element)
collectBoxModel(element)
collectAccessibility(element)
collectEventInfo(element)
```

返却形式：

```js
{
  value: '#save-button',
  matchCount: 1,
  unique: true,
  scope: 'document'
}
```

### CSS Selector

現在のSelector Root内で`querySelectorAll()`を使って一致件数を検証します。候補はid、テスト属性、ARIA属性、安定class、一般属性、階層の順です。

### XPath

Document内で`document.evaluate()`を使って一致件数を検証します。Shadow RootではXPathを生成せず、`unsupported: true`を返します。

### JS Path

Document内ではCSS Selectorから`document.querySelector()`式を生成します。open Shadow DOM内では、外側のHostから対象までを次の形式で連結します。

```js
document.querySelector('#outer-host')
  ?.shadowRoot?.querySelector('#inner-host')
  ?.shadowRoot?.querySelector('#target')
```

iframe内ではそのiframe Document基準です。

### 階層情報

```js
getNavigationState(element)
```

以下を返します。

- 親の有無
- 前後兄弟の有無
- 兄弟内indexと総数
- 子要素数
- 最大80件の子要素summary
- Shadow Root直下からHostへの親移動
- Shadow子 / Light DOM子の`treeScope`

### open Shadow DOM

Document capture listenerで受けたイベントの`composedPath()`から実際の内部Elementを取得します。追加のMutationObserverやページスクリプト注入は行いません。

```text
open Shadow Root内のElement
↓ getRootNode()
ShadowRoot.host
↓ 必要なだけ反復
Document内の外側Host
```

CSS Selectorは各Selector Root内の相対値です。`collectShadowContext()`は外側から内側の順でHost summaryとSelectorを保持します。closed Shadow Rootは`composedPath()`から内部要素が公開されないため対象外です。

### Computed Style / Box Model

`collectComputedStyles()`は主要プロパティを次の3グループへ整理します。

```text
layout
flexGrid
typography
```

`collectBoxModel()`は`getBoundingClientRect()`とcomputed border / paddingからcontent boxを算出し、margin、border、padding、content、borderBox、scroll sizeを返します。すべて選択時点のスナップショットで、継続監視はしません。

### Accessibility

`collectAccessibility()`は通常DOMから次を推定します。

```text
explicitRole / implicitRole / role
accessible name + source
description + source
associated labels
focusable / sequentiallyFocusable / tabIndex
heading level
disabled / hidden / required / checked / expanded / pressedなど
aria-* attributes
```

accessible nameは`aria-labelledby`、`aria-label`、関連label、alt、value、要素内容、title、placeholderの順で基本推定します。Chrome Accessibility Treeの完全再現ではありません。

### 限定イベント情報

`collectEventInfo()`は次だけを対象にします。

- `onclick`などのHTMLイベント属性
- `element.onclick`などのDOM0プロパティ

Handler previewは最大320文字です。`addEventListener()`、フレームワーク内部イベント、DevTools Protocolのリスナー一覧は取得しません。

## UI設計

プロジェクト内の`apple-design`スキルを基準にしています。

### 適用方針

- ボタンは押下時点で即時フィードバック
- ヘッダドラッグはPointer Captureで1:1追従
- ドラッグ中にtransitionを使用しない
- UIの出現アニメーションは短く、入力をロックしない
- Calm Hybridの明るい半透明Materialは外枠と操作面に限定
- データ表示面は濃いグラファイト、虹色はフォーカス境界、選択タブ、要素強調枠へ限定
- メインアイコンは`main-icon-source.svg`を正本として、重なった四角形のグラファイトアイコンをサイズ別PNGへ展開
- 基本文字は`#20262D`、補助文字は`#68727E`、成功状態は`#4F8A68`
- Current TargetとHierarchyを固定操作領域へ集約
- Overview / Styles / Edit / A11y / Locators / Compare / JSONは結果表示専用の軽量タブへ分離
- タブは囲み型セグメントではなく下線型
- フレーム情報と選択状態をヘッダへ集約
- 閉じるアイコンはSVGをinline-flex中央配置
- `prefers-reduced-motion`で動きを抑制
- `prefers-reduced-transparency`で不透明背景へ切替
- `prefers-contrast`で境界を強化

## 選択履歴

トップフレームUIは最大100件の履歴を保持します。

```js
{
  selectionId,
  frameId,
  result,
  reason
}
```

各フレームは`selectionRegistry: Map<selectionId, Element>`を保持します。履歴復元はBackground経由で対象フレームへ`RESTORE_SELECTION`を送り、実際のElement参照を再固定します。

```text
Top UI
↓ RESTORE_SELECTION(frameId, selectionId)
Background
↓ FRAME_COMMAND
Target frame
↓ selected event (historyMode: restore)
Top UI
```

新規選択時は現在位置より後ろの履歴を削除します。復元対象がDOMから削除されている場合は履歴位置を変更せず、エラー状態を返します。履歴とElement参照はInspector終了時に破棄します。

履歴ドロップダウンは`historyIndex`を選択値として使用し、直接移動も戻る・進むと同じ`RESTORE_SELECTION`経路へ統一します。

## ピン留め比較

トップフレームUIは最大4件のピンを保持します。

```js
{
  pinId,
  selectionId,
  frameId,
  result
}
```

`result`はピン時点のスナップショットです。比較表示はDOMの存否に依存せず、再選択だけがElement参照を必要とします。

各フレームは`pinnedSelectionIds: Set<selectionId>`を保持します。`selectionRegistry`の上限整理ではピン中の参照を削除対象から除外します。

```text
Top UI
↓ PIN_SELECTION / UNPIN_SELECTION
Background
↓ FRAME_COMMAND(targetFrameId)
Target frame
↓ pinnedSelectionIds更新
```

再選択には履歴と同じ`RESTORE_SELECTION`を使用します。iframe削除時はBackgroundがトップUIへ失敗状態を返します。

## パネルリサイズと表示密度

左右、下端、左下・右下のリサイズハンドルはPointer Captureでサイズを1:1追従します。上端・上角はヘッダドラッグと競合するため設けません。

```text
最小幅: min(360px, viewport - 16px)
最小高さ: min(440px, viewport - 16px)
初期幅: 468px
最大幅・高さ: viewport内
```

リサイズ開始時に`right: auto`へ切り替え、現在の`left`、`top`、`width`、必要な場合は`height`を固定値へ変換します。左ハンドルは右端を、右ハンドルは左端を基準に幅を計算します。下端は上端を固定し、角ハンドルは辺より高い`z-index`で判定を優先します。

密度は`panel.dataset.density`で切り替えます。

```text
compact
comfortable
```

どちらもメモリ内状態だけで、Inspector終了時に`compact`へ戻します。結果レイアウトはCSS Container Queriesでパネル幅に追従します。

## 一時CSS編集

### 状態

各フレームが次をメモリ内で保持します。

```text
editRecords: Map<editId, record>
editElementIds: WeakMap<Element, editId>
editUndoStack: operation[]
editStyleResources: Map<Document|ShadowRoot, resource>
```

対象Elementにはセッション固有名の一時属性を付与します。元から同名属性が存在した場合は値を退避し、Resetまたは終了時に復元します。一時属性はDOMスナップショットとJSONから除外します。

### 適用層

既存の`element.style`は変更しません。Documentまたはopen Shadow Rootごとに、次の優先順で専用スタイル層を作成します。

```text
Constructable CSSStyleSheet + adoptedStyleSheets
↓ 利用不可時のみ
一時style要素
```

許可リスト内のプロパティと`CSS.supports()`を通過した値だけを、`!important`付きで適用します。Reset時にはStylesheet、fallback style、一時属性をすべて撤去します。

### コマンド

```text
APPLY_EDIT
UNDO_EDIT
RESET_CURRENT_EDITS
RESET_ALL_EDITS
```

`APPLY_EDIT`、`UNDO_EDIT`、`RESET_CURRENT_EDITS`は`selectedFrameId`へ送ります。`RESET_ALL_EDITS`は全フレームへbroadcastします。編集後の再解析は`historyMode: refresh`を使用し、選択履歴を増やしません。

JSONの`temporaryEdits`には次を含めます。

```text
active
frameEditCount
undoAvailable
declarations: before / value / after
currentValues
cssText / allCssText
```

## 強調枠

各Documentに独立したclosed Shadow DOMホストを配置します。

```text
top edge
right edge
bottom edge
left edge
```

4本の線形グラデーション背景位置だけをアニメーションします。

禁止している方式：

- opacity点滅
- mask-composite
- conic-gradientのマスク抜き
- filter / drop-shadowアニメーション
- 対象DOMへのstyle書き込み

## フレーム状態遷移

```text
idle
↓ SET_ACTIVE
picking
↓ click
fixed
↓ START_PICKING
picking

picking
↓ START_COUNTDOWN
countdown
↓ FIX_HOVER
fixed
```

固定時はBackgroundが`selectedFrameId`を全フレームへ通知し、所有フレーム以外を`idle`へ移行させます。

## セキュリティ方針

- 外部通信しない
- Storage APIを使用しない
- 対象DOMへ永続的な属性やstyleを追加しない
- 一時編集はセッション固有属性と専用Stylesheetだけを使用し、終了時に元へ戻す
- 結果をBackgroundへ永続保存しない
- パネル幅・密度・履歴・ピンをStorageへ保存しない
- iframe context handshakeはフレーム経路だけを扱う
- クリップボード・ダウンロードはユーザー操作時だけ実行する

## テスト

```powershell
npm run check
npm test
```

テスト対象：

- DOMスナップショット
- CSS Selector / XPath / JS Path
- Locator一意性
- 兄弟・子要素ナビゲーションmetadata
- Manifestの全フレーム設定
- Background routing契約
- iframe context handshake
- 新UIのタブ・ドラッグ・Reduced Motion
- 固定Hierarchy、履歴一覧、SVG閉じるアイコン
- Calm Hybridトークン、サイズ別PNGアイコン、全方向下側リサイズ、密度切替
- SVG正本から生成した重なり四角形メインアイコン
- nested open Shadow DOM、Host境界移動、Shadow JS Path
- Computed Style、Box Model、Stylesタブ
- 一時CSS編集、Undo、対象Reset、全frame Reset、終了時撤去
- 基本Accessibility推定、ARIA状態、限定DOM0 / inlineイベント情報
- ピン留め上限、比較タブ、iframe間ピン参照保護
- 外部通信と永続保存の不在

## 手動確認項目

### Locator

- 一意id
- data-testid
- 重複class
- SVG
- 属性値に引用符を含む要素
- open / nested Shadow Root内のCSS SelectorとJS Path

### ナビゲーション

- 親・前後兄弟
- 最初と最後の子
- 子一覧選択
- 履歴の戻る・進む
- 履歴一覧からの直接移動
- 戻ったあとに新規選択して進む履歴が破棄されること
- iframe削除後の履歴復元エラー
- 対象削除時の復帰
- Shadow Root直下からHostへの親移動
- Shadow子とLight DOM子が混在するHost

### iframe

- same-origin
- cross-origin
- nested
- about:blank
- iframe削除後

### UI

- ヘッダドラッグ
- SVG閉じるアイコンの中央揃え
- 左右端からの横幅リサイズ
- 下端からの高さリサイズ
- 左下・右下からの斜めリサイズ
- 440px最小高さと小さいビューポートでの補正
- Compact / Comfortable切替
- 360px付近と620px以上でのレイアウト変化
- Compareの1列・2列表示
- 4件ピン留めと5件目の拒否
- ピン対象削除後もスナップショットが残ること
- Hierarchyが全タブで常時表示されること
- TOP FRAME / iframeバッジがヘッダ内に収まること
- 小さいビューポート
- Reduced Motion
- Reduced Transparency
- High Contrast

### Styles

- margin / border / padding / contentの値
- border-box / content-box
- scroll size
- Layout / Flex・Grid / Typographyの主要computed値
- 選択対象を変更した際の再取得

### Edit

- width / heightなど許可プロパティの適用
- 無効値と`!important`入力の拒否
- 既存style属性が変化しないこと
- Undoで直前値へ戻ること
- 対象Resetで現在要素だけ解除されること
- 全Resetでiframe / Shadow Rootを含めて解除されること
- JSONのbefore / value / after
- コピーCSSのDocument / Shadow Root表記
- Inspector終了後に一時属性とStylesheetが残らないこと

### Accessibility / Events

- explicit / implicit role
- aria-labelledby / aria-label / label / alt / contents由来のname
- description、focusability、tabindex、heading level
- disabled / hidden / required / checked / expanded / pressedなど
- aria-*属性一覧
- inline event属性とDOM0プロパティ
- addEventListener / React / Vueを取得しないこと
