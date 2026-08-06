# Changelog

Prismoraの主な変更を記録します。

## [0.14.8] - 2026-08-07

### Fixed

- 通常時のパネル最小サイズ360×440pxを維持しながら、それ未満のビューポートでは8px余白内へ縮小するようにしました。

## [0.14.7] - 2026-08-07

### Fixed

- 一時CSS編集用の内部属性をSVGとcircleの属性スナップショットからも除外しました。
- `prefers-reduced-motion`時に、パネル出現と虹色アウトラインのアニメーションを停止するようにしました。

## [0.14.6] - 2026-08-07

### Fixed

- DOM解析中に例外が発生した場合、部分的なfixed状態や選択履歴を残さずpickingへ復帰するようにしました。
- Backgroundログの表示名を`Prismora`へ統一しました。

## [0.14.5] - 2026-08-07

### Fixed

- Inspectorタブへ`tab` / `tabpanel`のARIA関係を追加しました。
- ロービングtabindexと左右矢印、Home、Endによるキーボード移動を追加しました。
- 非表示のCompareタブをキーボード移動から除外し、Compareが消える場合はOverviewへフォーカスを戻すようにしました。

## [0.14.4] - 2026-08-07

### Fixed

- Standard JSONとAncestor detail JSONのテキストを空白正規化後の最大5,000文字へ制限しました。
- `truncated`、`originalLength`、`limit`をJSONメタデータとして追加しました。
- pickingまたはcountdownへ戻る際に、古いAncestor detail結果と生成中状態を破棄するようにしました。

## [0.14.3] - 2026-08-07

### Fixed

- iframe間の一時編集`全Reset`を、現在frameの編集件数に依存せず実行できるようにしました。
- 固定要素の削除、iframeの削除・移動・再読み込み時に、選択状態を全frameで同期解除するようにしました。
- 古いselection IDとframe IDによる遅延通知を拒否するようにしました。
- frame context handshakeをactive中だけに限定し、message shape、token、深度、Selector長を検証するようにしました。
- frame context payloadから`name`、`title`、`src`を除き、`tagName`とCSS Selectorだけに縮小しました。
- pollingを追加せず、親frameと子frameのどちらが先にactive化してもhandshakeを再同期できるようにしました。

## [0.14.2] - 2026-08-07

### Fixed

- Manifest V3 Service Worker再起動後に、active状態、hover frame、selected frame、selection IDをトップframeから復元するようにしました。
- 再起動直後のhover、navigation、Edit、Ancestor detailを破棄せず処理するようにしました。
- 同時に到着した復元要求を1回の状態問い合わせへ集約しました。
- Backgroundの論理エラーをInspector UIへ表示し、保留状態を解除するようにしました。

## [0.14.1] - 2026-08-06

### Added

- JSONタブへ`Standard` / `Ancestor detail`のExport profileを追加しました。
- 選択要素と親から最大8階層を、Styles、Box Model、Accessibility、Locatorを含む詳細構造でオンデマンド取得できるようにしました。
- 直下の子は概要だけを維持し、孫以下を除外しました。

### Changed

- 拡張機能表示名を`Prismora — Web Element Inspector`へ統一しました。

## [0.14.0] - 2026-08-06

### Added

- Styles検索を追加しました。
- CSS Custom Propertiesを最大200件まで表示するようにしました。
- 一時編集差分へ`TEMP`表示と変更前・指定値・適用後の情報を追加しました。
- StylesからEditタブへ直接移動できるようにしました。

## [0.13.0] - 2026-08-05

### Changed

- 表示ブランドをPrismoraへ変更しました。
- Compact / Comfortableの表示密度を追加しました。
- Selection Historyを独立領域へ整理しました。
- 通常ページではframe badgeを省略し、iframe選択時だけ表示するようにしました。
