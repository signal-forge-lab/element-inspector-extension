# Prismora — Web Element Inspector 開発者ガイド

## バージョン

`0.14.9`

## 構成

```text
element_inspector_extension/
├─ manifest.json
├─ background.js
├─ inspector.js
├─ content.js
├─ package.json
├─ README.md
├─ CHANGELOG.md
├─ PRIVACY.md
├─ DEVELOPER_GUIDE.md
├─ THIRD_PARTY_NOTICES.md
├─ skills-lock.json
├─ .agents/skills/apple-design/SKILL.md
├─ assets/icons/main-icon.png
├─ assets/icons/main-icon-{16,32,48,128}.png
├─ tests/background.test.js
├─ tests/content-runtime.test.js
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
  selectedFrameId: null,
  selectedSelectionId: null
}
```

- `activeFrameId`: 最後にホバー情報を送ったフレーム
- `selectedFrameId`: 固定中の要素を所有するフレーム
- `selectedSelectionId`: 固定中の選択ID。同一frameから遅れて届いた古い無効化通知を破棄するために使用

Service Worker再起動後にBackground状態が未復元の場合、ツールバークリック、最初の`FRAME_EVENT`、`TOP_COMMAND`、子フレームの`FRAME_READY`は共通の`recoverTabState()`を通り、トップフレームへ`QUERY_STATE`を送って`active`、`activeFrameId`、`selectedFrameId`、`currentSelectionId`を復元します。すでにBackground状態がある場合はその状態を正本として使用します。

同じタブでツールバー操作とメッセージ処理を含む復元要求が重なった場合は1回の問い合わせへ集約します。これにより、deactivate後に遅い復元応答だけがBackgroundを再active化する競合を防ぎます。復元に失敗した`TOP_COMMAND`は`ok: false`を返し、トップフレームUIが保留状態を解除してエラーを表示します。永続Storageは使用しません。

トップフレームが`picking`または`countdown`へ移行する場合は、現在選択、選択フレーム、履歴移動の保留、Ancestor detail結果と生成中状態を`clearTopSelectionState()`で一括解除します。選択履歴とピン留めスナップショットは維持します。

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

`inspectAndSelect()`はDOM解析、Frame情報、Locator context、一時編集スナップショットの生成を完了してから、`fixed`状態・選択Element・選択ID・履歴Registryを確定します。解析中に例外が発生した場合は部分的な選択状態を残さず`picking`へ戻し、スタックトレースではなくエラーメッセージだけをstatusイベントとして通知します。

### トップフレーム専用責務

- Inspectorウィンドウ生成
- Overview / Styles / Edit / A11y / Locators / Compare / JSONタブ
- ARIA tab / tabpanel契約とロービングtabindex、左右矢印・Home・Endによるキーボード移動
- 固定Hierarchy領域
- 選択履歴の戻る・進む・直接選択
- 最大4件のピン留め比較
- パネル横幅・高さ・斜めリサイズ
- 通常時の最小360×440pxと、極小ビューポート時の利用可能領域への縮小
- Compact / Comfortable密度切替
- 遅延固定カウント
- Locator単体コピー
- JSONコピー・保存
- 編集CSSコピー
- ヘッダドラッグ

### iframe経路

各子フレームはInspector active中だけ親へ`postMessage`で`HELLO`を送り、親Content Scriptが`event.source`と直接の`iframe.contentWindow`を照合します。親もactive化時に直接の子frameへ`REQUEST_HELLO`を送るため、親・子どちらが先にactive化しても、後からactiveになった側のイベントでhandshakeを成立させます。タイマーやポーリングは使用しません。

親はiframe要素の`tagName`と階層深度だけを既存の親経路へ追加して子へ返します。CSS Selector、`name`、`title`、`src`、`aria-label`などの属性値は返しません。nested iframeで親経路の到着が遅れた場合は、登録済みの子フレームへ更新済みContextを再送します。

この`postMessage`経路はページから観測可能であり、tokenは認証境界ではありません。tokenは最大128文字の相関IDとしてのみ扱い、contextは最大深度16、path長一致、`iframe` / `frame`というshapeだけを保持します。受信したCSS文字列は保存せず`null`へ正規化します。消滅した子frameのWindow参照は、新しい`HELLO`受付時とContext再送時にMapから削除します。

固定要素の切断、子frameの`pagehide`、選択frameの新しい`FRAME_READY`を`selectionInvalidated`へ統一します。Backgroundはframe IDとselection IDの両方が現在値と一致する場合だけ選択状態を解除し、全フレームへ`START_PICKING`をbroadcastします。トップframe再読み込み時も古い選択ルーティングを破棄します。

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

`collectComputedStyles()`は主要プロパティを次の3グループへ整理し、CSS Custom Propertiesも別スナップショットとして収集します。

```text
layout
flexGrid
typography
customProperties（最大200件）
customPropertiesMeta（total / truncated / limit）
```

Styles UIはプロパティ名・値・一時編集値をクライアント側で絞り込み、編集許可リスト内の行だけ`Edit`タブへ直接送ります。一時編集済みの行には`TEMP`表示と変更前・指定値・適用後値を表示します。`collectBoxModel()`は`getBoundingClientRect()`とcomputed border / paddingからcontent boxを算出し、margin、border、padding、content、borderBox、scroll sizeを返します。すべて選択時点のスナップショットで、継続監視はしません。

### Ancestor detail JSON

`ElementInspector.buildAncestorExport()`は選択要素と親から最大8階層へ、同じ詳細構造のスナップショットを生成します。各詳細には属性、テキスト、座標、shallow HTML、Locator、Computed Styles、Box Model、Accessibility、限定イベント、Shadow情報を含めます。

`inspectElement()`と`buildAncestorExport()`はDOMの`textContent`を空白正規化後に既定5,000文字へ制限します。既存の`selectedText`／`text`文字列を維持し、`truncated`、`originalLength`、`limit`をそれぞれ`selectedTextMeta`／`textMeta`へ追加します。Ancestor detailでは選択要素と各先祖の`textMeta`に同じ情報を保持します。`textContent`は子孫テキストを含み得るため、「孫以下を除外」はDOM構造・子要素一覧・`shallowOuterHTML`の非再帰を指し、文字列内容まで子孫由来を除去する意味ではありません。

トップフレームUIが`REQUEST_ANCESTOR_EXPORT`を選択中フレームへ送り、フレーム側でFrame情報と対象別の一時編集情報を追加して`ancestorExport`イベントとして返します。選択IDが変わった応答は採用しません。

直下の子は`navigation.children`相当の概要のみです。先祖の`outerHTML`や子孫再帰は含めず、`shallowOuterHTML`で開始タグ相当だけを表現します。

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
- メインアイコンは指定された256px透過PNGを正本として、形状を変更せずサイズ別PNGへ縮小
- 基本文字は`#20262D`、補助文字は`#68727E`、成功状態は`#4F8A68`
- 固定操作領域はCurrent Target、独立したSelection History、Hierarchyの順に配置
- Overview / Styles / Edit / A11y / Locators / Compare / JSONは結果表示専用の軽量タブへ分離
- 各タブは`aria-controls`で対応tabpanelを参照し、tabpanelは`aria-labelledby`でタブを参照する
- 選択中タブだけを`tabindex="0"`とし、左右矢印・Home・Endで非表示タブを除外して自動選択する
- アクティブなCompareが消える場合はOverviewへフォーカスを戻す
- タブは囲み型セグメントではなく下線型
- フレーム情報と選択状態をヘッダへ集約
- 閉じるアイコンはSVGをinline-flex中央配置
- `prefers-reduced-motion`でパネル出現と虹色アウトラインのアニメーションを停止
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

密度はヘッダの2択セグメントから`panel.dataset.density`へ反映します。

```text
compact
comfortable
```

`comfortable`ではヘッダ、操作部品、履歴バー、セクション余白、カード間隔をまとめて拡大し、`compact`との差が視覚的に分かるようにします。どちらもメモリ内状態だけで、Inspector終了時に`compact`へ戻します。結果レイアウトはCSS Container Queriesでパネル幅に追従します。

## 一時CSS編集

### 状態

各フレームが次をメモリ内で保持します。

```text
editRecords: Map<editId, record>
editElementIds: WeakMap<Element, editId>
editUndoStack: operation[]
editStyleResources: Map<Document|ShadowRoot, resource>
```

対象Elementにはセッション固有名の一時属性を付与します。元から同名属性が存在した場合は値を退避し、Resetまたは終了時に復元します。一時属性は選択・control・先祖・Shadow Hostの属性、HTML文字列、SVG属性、circle属性スナップショットから除外し、DOMスナップショットとJSONへ混入させません。

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
- iframe context handshakeはactive中の直接の親子frameだけを扱い、受信値を未信頼としてshape検証する
- クリップボード・ダウンロードはユーザー操作時だけ実行する

## テスト

```powershell
npm run check
npm test
```

テスト対象：

- DOMスナップショット
- Standard / Ancestor detailのテキスト上限とtruncation metadata
- CSS Selector / XPath / JS Path
- Locator一意性
- 兄弟・子要素ナビゲーションmetadata
- Manifestの全フレーム設定
- Background routing契約、Service Worker再起動後の状態復元、toolbar deactivateとの復元競合、frame再読み込み時のselection invalidation
- iframe context handshakeのactive制限、親frame属性値を含まないpayload、message検証、実際の`HELLO`経路での消滅frame参照prune
- fixed状態の再解析失敗時にselection invalidationへ移行し、古い選択状態を残さないこと
- 別frameに編集が残る場合の全Reset操作
- 新UIのタブ・ドラッグ・Reduced Motion
- 固定Hierarchy、履歴一覧、SVG閉じるアイコン
- Calm Hybridトークン、サイズ別PNGアイコン、全方向下側リサイズ、密度切替
- 指定原画と同一SHA-256の256pxメインアイコン、サイズ別PNG
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

### Lifecycle

- fixed状態のままService Workerを停止・再起動し、次のhover / navigation / Edit / Ancestor detailが継続すること
- countdown中のhover後にService Workerを再起動し、0秒時点で同じactive frameを固定できること
- 復元不能時にAncestor detailのpending表示が解除され、UIへエラーが表示されること
- DOM解析を意図的に失敗させた場合、fixed状態・選択ID・履歴Registryを残さずpickingへ戻ること

### UI

- ヘッダドラッグ
- SVG閉じるアイコンの中央揃え
- 左右端からの横幅リサイズ
- 下端からの高さリサイズ
- 左下・右下からの斜めリサイズ
- 440px最小高さと小さいビューポートでの補正
- 360×440px未満のビューポートで、パネルが8px余白内へ収まること
- Compact / Comfortable切替
- 360px付近と620px以上でのレイアウト変化
- Compareの1列・2列表示
- タブの左右矢印、Home、End、非表示Compareのスキップ、Compare消滅時のOverviewフォーカス復帰
- 4件ピン留めと5件目の拒否
- ピン対象削除後もスナップショットが残ること
- Hierarchyが全タブで常時表示されること
- 通常ページではフレームバッジを表示せず、iframe選択時だけ`IFRAME · DEPTH n`がヘッダ内に収まること
- 小さいビューポート
- Reduced Motion
- Reduced Motionで虹色アウトラインが静止すること
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
