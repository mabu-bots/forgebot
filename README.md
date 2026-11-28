# ⚒️ FORGE（forgebot）

ユーザーが自分でコマンドと自動化を作れる、公開前提の Discord Bot。
核になるのは **Blueprint** という単一のデータ形式で、カスタムコマンドも
自動化も Blueprint として保存・実行する。共有コード、サーバーの記憶と
親密度、プラグイン、テンプレートギャラリーまで実装している。
利用規約とプライバシーポリシーは [利用規約](docs/legal/terms.md) と
[プライバシーポリシー](docs/legal/privacy.md) にある。

| 項目       | 内容                                        |
| ---------- | ------------------------------------------- |
| バージョン | v1.0.0                                      |
| 状態       | 未デプロイ（Discord アプリ/トークン未作成） |
| 稼働先     | –                                           |
| 実装       | TypeScript（Node.js 22+、discord.js 14）    |
| 更新履歴   | [CHANGELOG.md](CHANGELOG.md)                |
| 設計判断   | [DESIGN.md](DESIGN.md)                      |

## 📖 概要

```
Blueprint = Trigger + Conditions + Actions + Presentation
```

- カスタムコマンドは、Trigger が Slash の Blueprint である
- 自動化は、Trigger がリアクション / スケジュールの Blueprint である
- プラグインは、新しい Condition / Action ブロック種別を追加する形で統合する

FORGE 本体は人格を持たない道具である。口調の演出はせず、表示形式
（色・接頭辞・Embed 形式）だけを Presentation として扱う。

## ✨ 機能

### Blueprint の作成

`/forge create` でモーダルが開く。入力項目は次の4つ。

| 項目               | 内容                                                                                          |
| ------------------ | --------------------------------------------------------------------------------------------- |
| コマンド名         | 1〜32 文字。小文字の文字・数字・ハイフン・アンダースコア（日本語可）                          |
| 返信テンプレート   | `{user}` `{server}` `{count:キー}` `{memory:キー}` `{random:1-100}` `{choice:A,B}` 等が使える |
| クールダウン（秒） | 任意。0〜86400 の整数                                                                         |
| カウンターキー     | 任意。指定すると実行のたびにそのカウンターを +1 してから描画する                              |

送信すると、保存前に描画プレビュー（カウンターは加算後の値で表示し、
実データは変更しない）と「保存 / キャンセル」ボタンが出る。保存した時点で
初めてストアに書き込まれる。確認待ちの状態は10分で失効し、作成した
本人以外はボタンを操作できない。ギルドごとの Blueprint 上限は100件。

### 自動化

`/forge auto create` で、Trigger 種別の選択 → 送信先チャンネルの選択 →
モーダルの順に作成する。保存の流れは Blueprint 作成と同じ
（プレビュー → 保存 / キャンセル）。

| Trigger      | 内容                                                                                                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| リアクション | メッセージのリアクション数が閾値に達したら、送信先チャンネルへテンプレートを送信する。絵文字を指定するとその絵文字の数、空欄なら合計で判定する。メッセージごとに1回だけ発火する |
| スケジュール | 時刻（HH:MM、タイムゾーン付き）または間隔（分）ごとに、送信先チャンネルへテンプレートを送信する。最終実行時刻を保存し、再起動で二重に発火しない                                 |

自動化のテンプレートでは `{user}` `{server}` に加えて
`{messageUrl}`（発火したメッセージの URL）と `{reactionCount}`
（判定に使ったリアクション数）が使える。

参加 Trigger（メンバー参加時）は実装していない。`GuildMemberAdd` の検知には
Privileged Intent の `GuildMembers` が必要で、FORGE は Privileged Intent を
使用しない方針のため見送っている（[DESIGN.md](DESIGN.md) 参照）。

### 共有コード

`/forge share <name>` で Blueprint を共有コードとして表示する。

```
FORGE1-<チェックサム>-<gzip 圧縮した JSON の base64url>
```

チェックサムはペイロードの SHA-256 先頭8桁で、改ざんされたコードは
読み込み時に拒否される。コードが長い場合は `.txt` ファイルで添付する。

`/forge import` で共有コードを読み込む。任意で新しい名前を指定できる。
自動化の Blueprint に含まれる送信先チャンネル ID はそのまま使わず、
読み込み時に読み込み先ギルドのチャンネルを選択し直す（付け替えは必須）。
Slash の Blueprint はそのままプレビュー → 保存の流れになる。

### 記憶と親密度

管理者が `/forge memory propose` で候補を登録し、`/forge memory approve`
で承認した記憶だけが保存され、テンプレートの `{memory:キー}` で参照できる。
却下は `/forge memory reject`、削除は `/forge memory delete`。

リアクション自動化が発火したメッセージは、本文がそのまま名言候補として
自動提案もされる（キー `reaction-<メッセージID>`）。候補はメッセージごとに
1件だけで、承認・却下済みの記憶が自動提案で上書きされることはない。
Bot のメッセージ、本文が空のメッセージ、上限（500 文字）を超える本文は
候補化されない。ギルド単位で止める場合は `/forge memory auto-disable`。

親密度は Blueprint の実行総数と稼働日数から段階（1〜5）を算出する
純粋関数で決まり、`/forge status` に表示する。段階で基本機能を
ロックすることはなく、表現のみに使う。

### プラグイン

プラグインは新しい Condition / Action ブロックタイプの提供者である。
`plugins/` 配下の各ディレクトリが1プラグインで、`manifest.json`
（名前・提供ブロック種別・権限宣言）が必須、`index.mjs` がハンドラを
提供する。プラグインの例外はブロック単位で隔離し、本体は落とさない。
ギルドごとの有効化は `/forge plugin enable / disable` で管理する。
サンプルとして `dice` プラグイン（条件 `diceAtLeast` / アクション
`rollDice`）を同梱している。Blueprint では
`{ "type": "plugin", "plugin": "dice", "block": "rollDice", "params": {} }`
の形で使う。

### テンプレートギャラリー

公式テンプレート集は `templates/gallery.json` に同梱している。
`/forge template list` で一覧し、`/forge template use <id>` で
Blueprint として取り込む。

## 📝 コマンド

管理コマンドはすべてハンドラ側で `ManageGuild` 権限を再チェックし、
DM では実行できない。

| コマンド                                       | 内容                                                                                                                                    |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `/forge status`                                | Blueprint / Variable / Counter の件数と実行総数、承認済み記憶の件数、親密度の段階と稼働日数、有効プラグイン数を表示する                 |
| `/forge create`                                | モーダルで Blueprint を作成する（上記 ✨ 機能）                                                                                         |
| `/forge list`                                  | そのギルドの Blueprint の一覧（名前・Trigger・アクション数）を表示する。自動化も Trigger 種別つきで含まれる                             |
| `/forge auto create`                           | 自動化を作成する（上記 ✨ 機能）                                                                                                        |
| `/forge share <name>`                          | Blueprint の共有コードを表示する（上記 ✨ 機能）。名前の補完候補が出る                                                                  |
| `/forge import`                                | 共有コードから Blueprint を読み込む（上記 ✨ 機能）                                                                                     |
| `/forge edit <name>`                           | 作成フォームで扱える形の Blueprint を、入力済みのモーダルで編集する。自動化は送信先チャンネルを据え置いて編集する。名前の補完候補が出る |
| `/forge delete <name>`                         | 確認ボタンの後に Blueprint を削除する。自動化も削除できる。名前の補完候補が出る                                                         |
| `/forge memory propose <key> <kind> <content>` | 記憶の候補を登録する（種別は名言 / 記念日 / メモ）。候補は承認されるまでテンプレートから参照できない                                    |
| `/forge memory list [status]`                  | 記憶の一覧を承認状態つきで表示する                                                                                                      |
| `/forge memory approve <key>`                  | 候補を承認する。承認済みの記憶はテンプレートの `{memory:キー}` で参照できる                                                             |
| `/forge memory reject <key>`                   | 候補を却下する                                                                                                                          |
| `/forge memory delete <key>`                   | 記憶を削除する                                                                                                                          |
| `/forge memory auto-enable` / `auto-disable`   | リアクション閾値到達時の記憶の自動提案を有効化 / 無効化する（既定は有効）                                                               |
| `/forge plugin list`                           | 読み込まれたプラグインとギルドごとの有効・無効を表示する                                                                                |
| `/forge plugin enable <name>` / `disable`      | そのギルドでプラグインを有効化 / 無効化する                                                                                             |
| `/forge template list`                         | 同梱の公式テンプレート集を表示する                                                                                                      |
| `/forge template use <id> [name]`              | テンプレートを Blueprint として取り込む。自動化テンプレートは送信先チャンネルを選択し直す                                               |
| `/forge data export`                           | そのギルドのデータ（Blueprint・変数・カウンター・記憶・成長・プラグイン有効化状態）を JSON ファイルで書き出す                           |
| `/forge data delete`                           | 確認ボタンの後に、そのギルドのデータを全件削除する                                                                                      |
| `/c <name>`                                    | そのギルドの Blueprint を名前で引いて実行する                                                                                           |

## 🚀 セットアップ

必要環境: Node.js 22 以上。

```sh
npm install
cp .env.example .env   # DISCORD_TOKEN と DISCORD_CLIENT_ID を入力する
npm run register       # 開発用ギルドへ /forge と /c を登録する（DISCORD_GUILD_ID が必要）
npm run build
npm start
```

### 🔨 ビルド（ワンコマンド）

依存関係のインストール → 型チェック → ビルド → テストまでを1コマンドで
実行するスクリプトを用意している。失敗した場合は、そのステップで
止まってどこで落ちたかを表示する。

```bat
build.bat
```

```sh
./build.sh
```

### 環境変数

| 変数                | 必須 | 内容                                            |
| ------------------- | ---- | ----------------------------------------------- |
| `DISCORD_TOKEN`     | ✅   | Bot のトークン                                  |
| `DISCORD_CLIENT_ID` | ✅   | アプリケーションの Client ID                    |
| `DISCORD_GUILD_ID`  | –    | コマンド登録先の開発用ギルド ID                 |
| `FORGE_DISABLED`    | –    | `1` / `true` / `yes` で全ギルドの実行を停止する |
| `FORGE_DB_PATH`     | –    | SQLite のパス（既定: `data/forge.sqlite`）      |

## 🔄 運用

- データは SQLite（Node 標準の `node:sqlite`）に保存し、全テーブルが
  `guild_id` を持つ。ギルド間のデータ分離をテストで保証している
- ストア層に `exportGuildData` / `deleteGuildData` を用意し、導入ギルドの
  管理者が自分のサーバーのデータを書き出し・全削除できる
- 実行前には全局停止スイッチ（`FORGE_DISABLED`）とギルド単位の無効化
  フラグを必ず確認する。Blueprint ごとにクールダウンも適用できる
- READY が一定時間来ない停滞を検知してプロセスを終了する
  ウォッチドッグを備える（pm2 の再起動と組み合わせる）

## 🧪 テスト

```sh
npm test          # node:test による単体テスト（tsx 経由）
npm run typecheck # 型チェック
npm run format    # Prettier で整形
```

## 📁 ファイル構成

- `src/index.ts` — エントリポイント（ログインとハンドラ登録）
- `src/register.ts` — スラッシュコマンドの登録
- `src/client.ts` — クライアント生成とイベントハンドラ登録。
  公開 API（`buildCommands` / `createClient` / `attachHandlers` /
  `startScheduler` / `ClientDeps`）の再エクスポートも担う
- `src/clientShared.ts` — クライアント共通基盤（依存関係の型・
  customId 等の定数・権限の再チェック）
- `src/commandDefinitions.ts` — `/forge` と `/c` のコマンド定義の構築
- `src/clientForms.ts` — モーダル・ボタン・選択メニュー等の UI 構築
- `src/forgeCommands.ts` — `/forge` の各サブコマンドの処理と
  保存前プレビューの提示
- `src/clientInteractions.ts` — モーダル送信・選択メニュー・確認ボタン・
  補完・スラッシュコマンドの振り分け
- `src/clientExecution.ts` — `/c` による実行、チャンネルへの送信、
  リアクション Trigger の処理、スケジューラ
- `src/blueprint.ts` / `src/blueprintForm.ts` / `src/blueprintService.ts` —
  Blueprint の型・フォーム変換・作成可否チェックと保存
- `src/automationForm.ts` — 自動化フォームの変換
- `src/engine.ts` — Blueprint の実行エンジン
- `src/store.ts` — SQLite ストア
- `src/draft.ts` — 保存前下書き（確認セッション）の管理
- `src/shareCode.ts` — 共有コードの符号化・復号
- `src/gallery.ts` — テンプレートギャラリーの読み込み
- `src/memory.ts` / `src/autoMemory.ts` — 記憶の検証と自動提案
- `src/growth.ts` — 親密度の段階算出
- `src/schedule.ts` / `src/reactionTrigger.ts` / `src/cooldown.ts` —
  Trigger 判定とクールダウン
- `src/plugins.ts` — プラグインレジストリ
- `src/render.ts` — テンプレートの描画
- `src/permissions.ts` — 権限チェック
- `src/execLog.ts` — コマンド実行ログ
- `src/config.ts` — 環境変数の読み込み
- `src/watchdog.ts` — READY ウォッチドッグ
- `test/` — 単体テスト

## 📋 仕様メモ

### 声のルール（要約）

- 一人称を使わない。感情を表さない。挨拶をしない
- 文は短く、1メッセージ1事実。絵文字は使わない
- Embed の色はグラファイト `#3A3F4A` で固定する
- 成功は作ったものを、失敗は不足しているものを具体名で伝える
  （例: `作成しました: /{name}`、
  `実行できませんでした。権限が不足しています: {permission}`）

## ⚠️ 注意

- 参加 Trigger は実装していない（Privileged Intent が必要なため。
  判断の詳細は [DESIGN.md](DESIGN.md)）
