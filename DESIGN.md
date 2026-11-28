# DESIGN.md — FORGE の設計判断記録

FORGE（forgebot）の設計判断と、その理由を記録する。機能の使い方と
パリティ一覧は [README.md](README.md) を参照。

## 1. アーキテクチャ概要

```
Discord イベント
  └─ client.ts（ハンドラ登録）
       ├─ clientInteractions.ts（スラッシュ / モーダル / ボタン / 補完）
       ├─ clientExecution.ts（/c 実行 / リアクション / スケジューラ）
       └─ engine.ts（Blueprint 実行）
            ├─ render.ts（テンプレート描画）
            ├─ plugins.ts（ブロック解決）
            └─ store.ts（SQLite / node:sqlite）
```

- 核は `Blueprint = Trigger + Conditions + Actions + Presentation` の
  単一データ形式。カスタムコマンドと自動化を別形式にしない。
- 実行エンジンは Discord に依存しない純粋な処理で、テストでは
  メモリ内ストアで駆動する。

## 2. データモデル

全テーブルが `guild_id` を持ち、ギルドごとに分離する。

| テーブル           | キー                                   | 内容                                      |
| ------------------ | -------------------------------------- | ----------------------------------------- |
| `guilds`           | guild_id                               | 無効化フラグ、実行総数                    |
| `blueprints`       | (guild_id, name)                       | Blueprint 本体（JSON）                    |
| `variables`        | (guild_id, scope, owner_id, key)       | 変数（user / guild の2スコープ）          |
| `counters`         | (guild_id, key)                        | カウンター                                |
| `automation_fired` | (guild_id, blueprint_name, message_id) | リアクション自動化の発火済み記録          |
| `automation_state` | (guild_id, blueprint_name)             | スケジュール自動化の最終実行時刻          |
| `memories`         | (guild_id, key)                        | 記憶候補（pending / approved / rejected） |
| `growth`           | guild_id                               | 親密度（実行総数・稼働日数）              |
| `plugin_installs`  | (guild_id, plugin_name)                | プラグインのギルド別有効化状態            |
| `guild_settings`   | (guild_id, key)                        | ギルド設定（自動提案の有効・無効など）    |

## 3. 設計判断

### 3.1 Privileged Intent を使わない

参加 Trigger（メンバー参加時）は `GuildMemberAdd` の検知に Privileged
Intent の `GuildMembers` が必要なため実装しない。公開 Bot として
特権 Intent の審査なしに配布できる状態を優先する。Trigger の `event`
種別は検証で拒否し、黙って受け付けない。

### 3.2 Blueprint は保存前に必ずプレビューする

作成・編集・取り込みは、ストアへの書き込み前に描画プレビューと
「保存 / キャンセル」確認を通す。下書き（draft）は10分の有効期限を持ち、
作成した本人以外は操作できない。カウンターはプレビュー時だけ加算後の
値で表示し、実データは変更しない。

### 3.3 プラグインの例外はブロック単位で隔離する

プラグインの Condition / Action が例外を投げても本体は落とさない。
Condition の例外は「条件不成立」、Action の例外は「出力なし」として
扱う。プラグインは `plugins/` 配下のディレクトリから読み込み、
`manifest.json` の検証を通ったものだけを登録する。

### 3.4 記憶の自動提案は既存の記憶を上書きしない

リアクション自動化が発火したメッセージは名言候補として自動提案される
が、登録は「不在の場合のみ」（`proposeMemoryIfAbsent`）。承認・却下済みの
記憶を自動提案が pending に戻すことはない。手動の再登録
（`proposeMemory`）だけが pending に戻せる。

### 3.5 自動化の発火は先に記録する

- リアクション: 発火済み記録を先に書き、送信に失敗しても再送しない。
- スケジュール: 最終実行時刻を先に保存し、送信に失敗しても再送しない。

どちらも「二重送信しない」ことを「必ず届ける」ことより優先する。

### 3.6 声のルール

FORGE 本体は人格を持たない道具として扱う。一人称・感情・挨拶・絵文字を
使わず、文は短く、Embed の色はグラファイト `#3A3F4A` で固定する。
成功は作ったものを、失敗は不足しているものを具体名で伝える。

### 3.7 永続化は Node 標準の node:sqlite

外部のネイティブ依存を持たない。WAL モードで開き、終了処理は
SIGINT / SIGTERM でグレースフルに行う。データの書き出し・全削除は
ストア層の `exportGuildData` / `deleteGuildData` が担い、ギルドの
管理者が自分のサーバーのデータを持ち出せる・消せる状態を保つ。

## 4. 再作成（v1.0.0）にあたっての意図的な差異

2026-11-28、統一開発フローに合わせて旧実装（v0.1.1）をゼロから
書き直した。機能・コマンド定義・DB スキーマは旧実装と一致させ、
以下だけを意図的に変えている。

| 差異                                                                                                                   | 理由                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| package 名を `forge` から `forgebot` に変更、バージョンを 1.0.0 にリセット                                             | リポジトリ名（forgebot）に合わせる統一フローの取り決め                                          |
| pm2 のアプリ名を `forge` から `forgebot` に変更                                                                        | package 名の変更に追随                                                                          |
| GitHub 運用系の追加設定（Mergify / Release Drafter / stale / lock-threads / welcome bot / all-contributors）を載せない | 統一フローの標準形（CI・Issue テンプレート・PR テンプレート・CONTRIBUTING・Dependabot）に揃える |
| `.githooks` を含めない                                                                                                 | 整形は `npm run format` と CI の format:check で担保する                                        |
| 内部実装の再構成（ストア内部の補助関数の命名など）                                                                     | 挙動差なし。コマンド定義 JSON と DB スキーマは機械比較で一致を検証済み                          |
| 共有コード形式は旧実装と双方向に互換                                                                                   | 既存の共有コード資産を失わないため（旧で符号化 → 新で復号、その逆も検証済み）                   |

## 5. 既知の文面差異（引き継ぎメモ）

プライバシーポリシー（docs/legal/privacy.md）は「メッセージが自動で
保存されることはない」としているが、リアクション自動化の発火時には
メッセージ本文が記憶の「候補」（未承認）として自動提案される実装に
なっている。候補は承認されるまで参照されず、ギルド単位で無効化も
できるため実害はないが、文面と実装の厳密な一致は今後の課題として
記録する。再作成では法務文書の文面をそのまま引き継いだ。
