# Prismora Privacy Policy

最終更新日: 2026-08-07

## 1. 対象

このプライバシーポリシーは、Chrome拡張機能`Prismora — Web Element Inspector`（以下「Prismora」）に適用されます。

Prismoraは、ユーザーが明示的に起動し、ページ上で選択したWeb要素を調査するためのローカルツールです。

## 2. Prismoraがアクセスする情報

Prismoraは機能提供のため、起動中のページと対応iframe内にある次の情報をブラウザ内で読み取ることがあります。

- DOM要素のタグ名、属性、テキスト、HTML断片
- 要素の座標、Box Model、Computed Styles、CSS Custom Properties
- CSS Selector、XPath、JS PathなどのLocator
- 通常DOMから推定できるAccessibility情報
- HTMLイベント属性とDOM0イベントプロパティの限定情報
- open Shadow DOMとiframeの経路情報
- Prismoraが適用した一時CSS編集の内容
- ページURL、フレームURL、ページタイトル

ページ内容には、ユーザーまたは閲覧先サイトに由来する個人情報・機密情報が含まれる可能性があります。

## 3. 情報の利用目的

読み取った情報は、次のユーザー向け機能を提供する目的だけで使用します。

- 選択要素の可視化と調査
- DOM階層、Styles、Accessibility、Locatorの表示
- 一時CSS編集、Undo、Reset
- 選択履歴とピン留め比較
- Standard JSONとAncestor detail JSONの生成
- ユーザー操作によるクリップボードへのコピーとJSONファイル保存

広告、ユーザー追跡、行動分析、プロファイリング、信用評価には使用しません。

## 4. 収集・送信・共有

Prismoraは、ページから読み取った情報を開発者または第三者のサーバーへ収集・送信・共有しません。

Prismoraには次の機能がありません。

- 外部APIまたは分析サービスへの通信
- 広告SDK
- テレメトリまたはクラッシュレポート送信
- アカウント作成またはログイン
- 開発者が管理するサーバーへのアップロード

ユーザーがコピーまたは保存を実行した場合、選択した情報はユーザー自身のクリップボードまたはローカルファイルへ出力されます。その後の保管・共有はユーザーの管理下にあります。

## 5. 保存と保持期間

Prismoraは、DOM解析結果、履歴、ピン留め、一時編集、パネル設定をChrome Storage、localStorage、sessionStorage、IndexedDBへ保存しません。

これらの情報はブラウザのメモリ内だけで保持されます。

- Prismoraを終了したとき
- トップページを再読み込みまたは移動したとき
- 対象タブを閉じたとき
- 拡張機能を再読み込みまたは無効化したとき

子iframeだけを再読み込みまたは移動した場合、そのiframe内のElement参照、一時編集、現在選択は破棄されます。トップフレーム側にある過去の選択履歴またはピン留めスナップショットは、Prismora終了またはトップページ再読み込みまでメモリ内に残る場合があります。

ユーザーが明示的に保存したJSONファイルやコピーした内容は、Prismoraでは削除または管理できません。

## 6. 一時的なページ変更

一時CSS編集を使用した場合、Prismoraはセッション固有の一時属性と専用Stylesheetをページ内へ追加します。

- 既存の`style`属性は変更しません。
- ResetまたはPrismora終了時に、一時属性とStylesheetを撤去します。
- 元から同名属性が存在した場合は元の値を復元します。
- Prismora内部の一時属性は、コピー・保存するJSONから除外します。

## 7. Chrome権限

Prismoraが宣言する拡張機能権限は`clipboardWrite`です。これは、ユーザーがコピー操作を実行したときにLocator、CSS、JSONをクリップボードへ書き込むために使用します。

Content Scriptは`<all_urls>`および`all_frames`へ設定されています。これは、ユーザーがツールバーからPrismoraを起動したページとiframe内の要素を選択・解析するためです。Prismoraが非アクティブな間は、要素選択・解析・frame context handshakeを実行しません。

iframe経路を構築する`postMessage` handshakeはページスクリプトから観測可能です。そのため、handshakeで渡すContextは相関用token、階層深度、`iframe` / `frame`のタグ種別だけに限定し、CSS Selector、URL、`name`、`title`、`src`、`aria-label`などの親frame属性値は渡しません。tokenは認証情報として使用しません。

## 8. 第三者提供

Prismoraはユーザーデータを販売、貸与、広告目的で利用、または第三者へ提供しません。

法令により開示を求められた場合でも、Prismoraの開発者はユーザーデータを収集・保持していないため、Prismora経由で保存されたデータを保有していません。

## 9. セキュリティ

Prismoraはローカル完結を基本設計とし、ページ内容を外部へ送信しないことでデータ露出を抑えます。

ただし、コピーしたJSON、Locator、CSSにはページ内容、URL、属性、内部IDなどが含まれる可能性があります。第三者へ共有する前に、ユーザー自身で内容を確認してください。

## 10. 変更

データ処理方法を変更する場合は、この文書とChrome Web Store上の開示内容を更新します。重要な変更がある場合は、リリースノートまたは拡張機能の表示を通じて案内します。

## 11. 問い合わせ

プライバシーに関する問い合わせは、公開リポジトリのIssue Trackerを利用してください。

`https://github.com/signal-forge-lab/element-inspector-extension/issues`

公開Issueへ、調査対象ページの内容、認証情報、Cookie、個人情報、生成したJSON全文を貼り付けないでください。
