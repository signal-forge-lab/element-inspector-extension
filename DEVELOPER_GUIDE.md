# Element Inspector 開発者ガイド

## バージョン

`0.8.2`

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
├─ assets/icons/main-icon.png
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
- 階層移動
- Backgroundとのメッセージ通信

### トップフレーム専用責務

- Inspectorウィンドウ生成
- Overview / Locators / JSONタブ
- 固定Hierarchy領域
- 選択履歴の戻る・進む・直接選択
- 最大4件のピン留め比較
- パネル横幅リサイズ
- Compact / Comfortable密度切替
- 遅延固定カウント
- Locator単体コピー
- JSONコピー・保存
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

CSS Selectorから`document.querySelector()`式を生成します。iframe内ではそのiframe Document基準です。

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

## UI設計

プロジェクト内の`apple-design`スキルを基準にしています。

### 適用方針

- ボタンは押下時点で即時フィードバック
- ヘッダドラッグはPointer Captureで1:1追従
- ドラッグ中にtransitionを使用しない
- UIの出現アニメーションは短く、入力をロックしない
- C.Glassパレットの半透明Materialは階層表現に限定
- パネルは濃いブルーグレー、アクセントは`#719BFF`、成功状態は`#77D6A3`
- Current TargetとHierarchyを固定操作領域へ集約
- Overview / Locators / Compare / JSONは結果表示専用の軽量タブへ分離
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

左右のリサイズハンドルはPointer Captureで横幅を1:1追従します。

```text
最小幅: min(360px, viewport - 16px)
初期幅: 468px
最大幅: viewport - 16px
```

リサイズ開始時に`right: auto`へ切り替え、現在の`left`と`width`を固定値へ変換します。左ハンドルは右端を、右ハンドルは左端を基準に幅を計算します。

密度は`panel.dataset.density`で切り替えます。

```text
compact
comfortable
```

どちらもメモリ内状態だけで、Inspector終了時に`compact`へ戻します。結果レイアウトはCSS Container Queriesでパネル幅に追従します。

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
- C.Glassトークン、横幅リサイズ、密度切替
- ピン留め上限、比較タブ、iframe間ピン参照保護
- 外部通信と永続保存の不在

## 手動確認項目

### Locator

- 一意id
- data-testid
- 重複class
- SVG
- 属性値に引用符を含む要素

### ナビゲーション

- 親・前後兄弟
- 最初と最後の子
- 子一覧選択
- 履歴の戻る・進む
- 履歴一覧からの直接移動
- 戻ったあとに新規選択して進む履歴が破棄されること
- iframe削除後の履歴復元エラー
- 対象削除時の復帰

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
