# Element Inspector

ページ上で右クリックした要素を解析し、結果を整形済みJSONとしてクリップボードへコピーするChrome拡張です。

既存のDevTools Console用 `devtools_element_inspector.js` が取得していた主要項目を維持し、DevToolsの`$0`と`copy()`を右クリック対象とClipboard APIへ置き換えています。

## インストール

1. Chromeで `chrome://extensions` を開きます。
2. 右上の「デベロッパー モード」を有効にします。
3. 「パッケージ化されていない拡張機能を読み込む」を選択します。
4. この `element_inspector_extension` フォルダを選択します。

ローカルHTMLで使用する場合は、拡張機能の詳細画面で「ファイルのURLへのアクセスを許可する」を有効にしてください。

## 使い方

```text
ページ上の要素を右クリック
↓
「Element Inspector」を選択
↓
右クリック対象と最も近い操作可能要素を解析
↓
JSONをクリップボードへコピー
↓
右クリックした要素自体を黒白の二重枠で約3秒間強調
（明暗を約2回繰り返し、最後は透明度0までフェードアウト）
↓
ページ右下に完了通知
```

コピー結果はDevTools ConsoleにもオブジェクトとJSON文字列で表示します。

強調表示は右クリックした要素自体を囲みます。対象要素や親要素の背景色・インラインスタイルは変更せず、ページ上に一時的なオーバーレイを重ねます。約3秒の表示中に明暗を約2回繰り返し、最後は透明度0まで自然にフェードアウトして削除します。表示時間は`content.js`の`HIGHLIGHT_DURATION_MS`で管理します。

ツールバー、拡張機能一覧、インストール表示では`assets/icons/main-icon.png`を使用します。右クリックメニュー向けには、16pxと32pxのモノクロ画像を分離しています。

```text
assets/icons/context-menu-icon-16.png
assets/icons/context-menu-icon-32.png
```

Chromeの`contextMenus` APIにはメニュー項目ごとのアイコン指定や、ライト／ダークテーマ別画像を切り替える機能がありません。そのため、右クリックメニューが参照するManifestの16px／32px画像だけを、透明背景に黒線と白い縁取りを重ねたモノクロアイコンにしています。単一画像のまま、明るい背景では黒線、暗い背景では白い縁取りが見える構成です。

## 取得項目

- `selectedTag` / `selectedAttributes`: 右クリックした要素
- `controlTag` / `controlAttributes`: 最も近い `button`、`[role="button"]`、`a`、`[tabindex]`
- `text`: 操作対象内の空白を正規化したテキスト
- `svg`: SVG属性、`use`参照先、`path`、`circle`
- `ancestors`: 操作対象自身を含む最大8階層の親要素情報
- `outerHTML`: 操作対象のHTML先頭5000文字

## 権限

### `contextMenus`

右クリックメニューに `Element Inspector` を登録するために使用します。

### `clipboardWrite`

ユーザーがメニューを選択したときだけ、解析結果をクリップボードへコピーするために使用します。

## プライバシー

- 外部通信を行いません。
- 解析結果をサーバーへ送信しません。
- localStorage、sessionStorage、Chrome Storageへ結果を保存しません。
- 履歴を永続化しません。
- 右クリック対象の参照はContent Scriptのメモリ内だけに保持し、次の右クリックで上書きします。

解析結果にはページ内テキスト、URL、内部ID、data属性などが含まれる可能性があります。第三者へ共有する前に内容を確認してください。

## iframe

Content Scriptは `all_frames: true` で動作します。Background Service Workerはコンテキストメニューイベントの `frameId` を使い、右クリックされたフレームへ実行指示を送ります。

## 利用できないページ

Chromeの制限により、次のようなページでは動作しません。

- `chrome://` ページ
- Chromeウェブストアの保護対象ページ
- 拡張機能管理ページ
- 他の拡張機能ページ
- 一部の組み込みPDFビューア

## 対象要素が置き換わった場合

右クリック後、メニュー選択までに対象がReactなどで置き換えられた場合は、古い要素を推測で探し直さず、次のエラーを表示します。

```text
右クリックした要素はすでにページから削除されています
```

## 開発時の確認

```powershell
npm run check
npm test
```

## バージョン

`0.5.0`
