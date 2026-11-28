// ==========================================
// 🗄️ SQLite ストア（全永続化の担い手）
// ==========================================
// Node 標準の node:sqlite を使い、全テーブルに guild_id を持たせて
// ギルド間の分離を保証する。Blueprint の定義は JSON 文字列で保存し、
// Trigger 種別の絞り込みには json_extract を使う。

import { DatabaseSync, type StatementSync } from "node:sqlite";
import type { Blueprint } from "./blueprint.js";
import type { GrowthRecord } from "./growth.js";
import type { MemoryRecord, MemoryStatus } from "./memory.js";

export type VariableScope = "guild" | "user" | "global";

export interface GuildCounts {
  blueprints: number;
  variables: number;
  counters: number;
  executions: number;
}

export interface GuildExport {
  guildId: string;
  disabled: boolean;
  autoMemoryEnabled: boolean;
  executions: number;
  blueprints: Blueprint[];
  variables: Array<{
    scope: VariableScope;
    ownerId: string;
    key: string;
    value: string;
  }>;
  counters: Array<{ key: string; value: number }>;
  memories: MemoryRecord[];
  growth: GrowthRecord | null;
  pluginInstalls: Array<{ pluginName: string; enabled: boolean }>;
}

export interface PluginInstall {
  guildId: string;
  pluginName: string;
  enabled: boolean;
}

// ==========================================
// 🗄️ スキーマ（10テーブル）
// ==========================================

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS guilds (
  guild_id TEXT PRIMARY KEY,
  disabled INTEGER NOT NULL DEFAULT 0,
  execution_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS blueprints (
  guild_id TEXT NOT NULL,
  name TEXT NOT NULL,
  definition TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (guild_id, name)
);
CREATE TABLE IF NOT EXISTS variables (
  guild_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  owner_id TEXT NOT NULL DEFAULT '',
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (guild_id, scope, owner_id, key)
);
CREATE TABLE IF NOT EXISTS counters (
  guild_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, key)
);
CREATE TABLE IF NOT EXISTS automation_fired (
  guild_id TEXT NOT NULL,
  blueprint_name TEXT NOT NULL,
  message_id TEXT NOT NULL,
  fired_at TEXT NOT NULL,
  PRIMARY KEY (guild_id, blueprint_name, message_id)
);
CREATE TABLE IF NOT EXISTS automation_state (
  guild_id TEXT NOT NULL,
  blueprint_name TEXT NOT NULL,
  last_run_at TEXT NOT NULL,
  PRIMARY KEY (guild_id, blueprint_name)
);
CREATE TABLE IF NOT EXISTS memories (
  guild_id TEXT NOT NULL,
  key TEXT NOT NULL,
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_by TEXT NOT NULL DEFAULT '',
  approved_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (guild_id, key)
);
CREATE TABLE IF NOT EXISTS growth (
  guild_id TEXT PRIMARY KEY,
  total_executions INTEGER NOT NULL DEFAULT 0,
  active_days INTEGER NOT NULL DEFAULT 0,
  last_active_date TEXT,
  first_active_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS plugin_installs (
  guild_id TEXT NOT NULL,
  plugin_name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (guild_id, plugin_name)
);
CREATE TABLE IF NOT EXISTS guild_settings (
  guild_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (guild_id, key)
);
`;

// ==========================================
// 🧱 行の型と変換
// ==========================================

interface DefinitionRow {
  definition: string;
}

interface VariableRow {
  scope: VariableScope;
  owner_id: string;
  key: string;
  value: string;
}

interface CounterRow {
  key: string;
  value: number;
}

interface CountRow {
  n: number;
}

interface MemoryRow {
  guild_id: string;
  key: string;
  kind: string;
  content: string;
  status: MemoryStatus;
  created_by: string;
  approved_by: string | null;
  created_at: string;
  updated_at: string;
}

interface GrowthRow {
  guild_id: string;
  total_executions: number;
  active_days: number;
  last_active_date: string | null;
  first_active_at: string | null;
}

interface PluginInstallRow {
  plugin_name: string;
  enabled: number;
}

const MEMORY_COLUMNS =
  "guild_id, key, kind, content, status, created_by, approved_by, created_at, updated_at";

// 🔄 memories テーブルの行を MemoryRecord へ変換する
function toMemoryRecord(row: MemoryRow): MemoryRecord {
  return {
    guildId: row.guild_id,
    key: row.key,
    kind: row.kind,
    content: row.content,
    status: row.status,
    createdBy: row.created_by,
    approvedBy: row.approved_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ==========================================
// 🧱 Store 本体
// ==========================================

export class Store {
  private readonly db: DatabaseSync;
  private readonly statementCache = new Map<string, StatementSync>();
  private isClosed = false;

  // 🗄️ データベースを開き、WAL 等の PRAGMA とスキーマを適用する
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA synchronous = NORMAL;");
    this.db.exec("PRAGMA busy_timeout = 5000;");
    this.db.exec(SCHEMA_SQL);
  }

  // 💡 SQL ごとにコンパイル済みステートメントをキャッシュする
  private stmt(sql: string): StatementSync {
    const cached = this.statementCache.get(sql);
    if (cached !== undefined) return cached;
    const prepared = this.db.prepare(sql);
    this.statementCache.set(sql, prepared);
    return prepared;
  }

  // ⏰ 現在時刻の ISO 文字列
  private nowIso(): string {
    return new Date().toISOString();
  }

  // 🧹 接続を閉じる（冪等）
  close(): void {
    if (this.isClosed) return;
    this.isClosed = true;
    this.db.close();
  }

  // ==========================================
  // 🏠 ギルド行と無効化フラグ・実行数
  // ==========================================

  // 🏠 ギルド行が無ければ作る
  ensureGuild(guildId: string): void {
    const at = this.nowIso();
    this.stmt(
      "INSERT OR IGNORE INTO guilds (guild_id, created_at, updated_at) VALUES (?, ?, ?)",
    ).run(guildId, at, at);
  }

  // 🛡️ ギルド単位の無効化を設定する
  setGuildDisabled(guildId: string, disabled: boolean): void {
    this.ensureGuild(guildId);
    this.stmt(
      "UPDATE guilds SET disabled = ?, updated_at = ? WHERE guild_id = ?",
    ).run(disabled ? 1 : 0, this.nowIso(), guildId);
  }

  // 🛡️ ギルドが無効化されているか
  isGuildDisabled(guildId: string): boolean {
    const row = this.stmt(
      "SELECT disabled AS n FROM guilds WHERE guild_id = ?",
    ).get(guildId) as CountRow | undefined;
    return row !== undefined && row.n === 1;
  }

  // 📝 実行回数を加算し、成長記録にも反映する
  recordExecution(guildId: string): void {
    this.ensureGuild(guildId);
    const at = this.nowIso();
    this.stmt(
      "UPDATE guilds SET execution_count = execution_count + 1, updated_at = ? WHERE guild_id = ?",
    ).run(at, guildId);
    this.recordGrowthExecution(guildId, new Date(at));
  }

  // ==========================================
  // 💾 Blueprint の保存
  // ==========================================

  // 💾 Blueprint を保存する（同名は定義を上書き）
  upsertBlueprint(guildId: string, blueprint: Blueprint): void {
    this.ensureGuild(guildId);
    const at = this.nowIso();
    this.stmt(
      `INSERT INTO blueprints (guild_id, name, definition, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (guild_id, name)
       DO UPDATE SET definition = excluded.definition, updated_at = excluded.updated_at`,
    ).run(guildId, blueprint.name, JSON.stringify(blueprint), at, at);
  }

  // 🔄 Blueprint を置換する。名前変更時は旧名の削除と同一トランザクション
  replaceBlueprint(
    guildId: string,
    originalName: string,
    blueprint: Blueprint,
  ): boolean {
    this.db.exec("BEGIN");
    try {
      if (this.getBlueprint(guildId, originalName) === null) {
        this.db.exec("ROLLBACK");
        return false;
      }
      if (originalName !== blueprint.name) {
        this.deleteBlueprint(guildId, originalName);
      }
      this.upsertBlueprint(guildId, blueprint);
      this.db.exec("COMMIT");
      return true;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  // 🔍 Blueprint を1件取得する
  getBlueprint(guildId: string, name: string): Blueprint | null {
    const row = this.stmt(
      "SELECT definition FROM blueprints WHERE guild_id = ? AND name = ?",
    ).get(guildId, name) as DefinitionRow | undefined;
    if (row === undefined) return null;
    return JSON.parse(row.definition) as Blueprint;
  }

  // 📋 Blueprint の一覧を名前順で返す
  listBlueprints(guildId: string): Blueprint[] {
    const rows = this.stmt(
      "SELECT definition FROM blueprints WHERE guild_id = ? ORDER BY name",
    ).all(guildId) as unknown as DefinitionRow[];
    return rows.map((row) => JSON.parse(row.definition) as Blueprint);
  }

  // 🗑️ Blueprint を削除する（削除できたら true）
  deleteBlueprint(guildId: string, name: string): boolean {
    const result = this.stmt(
      "DELETE FROM blueprints WHERE guild_id = ? AND name = ?",
    ).run(guildId, name);
    return result.changes > 0;
  }

  // 📋 指定した Trigger 種別の Blueprint だけを返す
  listBlueprintsByTriggerType(
    guildId: string,
    triggerType: string,
  ): Blueprint[] {
    const rows = this.stmt(
      "SELECT definition FROM blueprints WHERE guild_id = ? AND json_extract(definition, '$.trigger.type') = ? ORDER BY name",
    ).all(guildId, triggerType) as unknown as DefinitionRow[];
    return rows.map((row) => JSON.parse(row.definition) as Blueprint);
  }

  // 📋 全ギルドのスケジュール Blueprint を列挙する（スケジューラ用）
  listScheduledBlueprints(): Array<{ guildId: string; blueprint: Blueprint }> {
    const rows = this.stmt(
      "SELECT guild_id, definition FROM blueprints WHERE json_extract(definition, '$.trigger.type') = 'schedule' ORDER BY guild_id, name",
    ).all() as unknown as Array<{ guild_id: string; definition: string }>;
    return rows.map((row) => ({
      guildId: row.guild_id,
      blueprint: JSON.parse(row.definition) as Blueprint,
    }));
  }

  // ==========================================
  // 🔤 変数とカウンター
  // ==========================================

  // 🔤 変数を保存する（スコープ: guild / user / global、owner_id は user 時の所有者）
  setVariable(
    guildId: string,
    scope: VariableScope,
    ownerId: string,
    key: string,
    value: string,
  ): void {
    this.ensureGuild(guildId);
    this.stmt(
      `INSERT INTO variables (guild_id, scope, owner_id, key, value)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (guild_id, scope, owner_id, key)
       DO UPDATE SET value = excluded.value`,
    ).run(guildId, scope, ownerId, key, value);
  }

  // 🔍 変数を取得する
  getVariable(
    guildId: string,
    scope: VariableScope,
    ownerId: string,
    key: string,
  ): string | null {
    const row = this.stmt(
      "SELECT value FROM variables WHERE guild_id = ? AND scope = ? AND owner_id = ? AND key = ?",
    ).get(guildId, scope, ownerId, key) as { value: string } | undefined;
    return row === undefined ? null : row.value;
  }

  // 🔢 カウンターを加算し、加算後の値を返す
  incrementCounter(guildId: string, key: string, amount = 1): number {
    this.ensureGuild(guildId);
    this.stmt(
      `INSERT INTO counters (guild_id, key, value) VALUES (?, ?, ?)
       ON CONFLICT (guild_id, key)
       DO UPDATE SET value = value + excluded.value`,
    ).run(guildId, key, amount);
    return this.getCounter(guildId, key);
  }

  // 🔍 カウンターの現在値（無ければ 0）
  getCounter(guildId: string, key: string): number {
    const row = this.stmt(
      "SELECT value FROM counters WHERE guild_id = ? AND key = ?",
    ).get(guildId, key) as { value: number } | undefined;
    return row === undefined ? 0 : row.value;
  }

  // ==========================================
  // 🤖 自動化の状態（発火済み・最終実行時刻）
  // ==========================================

  // 🔍 そのメッセージで既に発火したか
  hasAutomationFired(
    guildId: string,
    blueprintName: string,
    messageId: string,
  ): boolean {
    const row = this.stmt(
      "SELECT 1 AS n FROM automation_fired WHERE guild_id = ? AND blueprint_name = ? AND message_id = ?",
    ).get(guildId, blueprintName, messageId) as CountRow | undefined;
    return row !== undefined;
  }

  // 📝 発火を記録する。記録できた場合だけ true（重複時は false）
  markAutomationFired(
    guildId: string,
    blueprintName: string,
    messageId: string,
  ): boolean {
    this.ensureGuild(guildId);
    const result = this.stmt(
      "INSERT OR IGNORE INTO automation_fired (guild_id, blueprint_name, message_id, fired_at) VALUES (?, ?, ?, ?)",
    ).run(guildId, blueprintName, messageId, this.nowIso());
    return result.changes > 0;
  }

  // ⏰ スケジュール自動化の最終実行時刻を取得する
  getAutomationLastRun(guildId: string, blueprintName: string): Date | null {
    const row = this.stmt(
      "SELECT last_run_at FROM automation_state WHERE guild_id = ? AND blueprint_name = ?",
    ).get(guildId, blueprintName) as { last_run_at: string } | undefined;
    return row === undefined ? null : new Date(row.last_run_at);
  }

  // ⏰ スケジュール自動化の最終実行時刻を記録する
  setAutomationLastRun(guildId: string, blueprintName: string, at: Date): void {
    this.ensureGuild(guildId);
    this.stmt(
      `INSERT INTO automation_state (guild_id, blueprint_name, last_run_at)
       VALUES (?, ?, ?)
       ON CONFLICT (guild_id, blueprint_name)
       DO UPDATE SET last_run_at = excluded.last_run_at`,
    ).run(guildId, blueprintName, at.toISOString());
  }

  // ==========================================
  // 🧠 記憶の保存と状態遷移
  // ==========================================

  // 🧠 候補を登録する。既存キーは pending に戻して上書きする（手動登録用）
  proposeMemory(
    guildId: string,
    input: { key: string; kind: string; content: string; createdBy: string },
  ): MemoryRecord {
    this.ensureGuild(guildId);
    const at = this.nowIso();
    this.stmt(
      `INSERT INTO memories (guild_id, key, kind, content, status, created_by, approved_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'pending', ?, NULL, ?, ?)
       ON CONFLICT (guild_id, key)
       DO UPDATE SET kind = excluded.kind, content = excluded.content, status = 'pending', created_by = excluded.created_by, approved_by = NULL, updated_at = excluded.updated_at`,
    ).run(
      guildId,
      input.key,
      input.kind,
      input.content,
      input.createdBy,
      at,
      at,
    );
    return this.getMemory(guildId, input.key)!;
  }

  // 💡 自動提案専用: 同じキーが既にあれば何もせず null を返す。
  // 承認・却下済みの記憶を自動提案が pending に戻さないための経路。
  proposeMemoryIfAbsent(
    guildId: string,
    input: { key: string; kind: string; content: string; createdBy: string },
  ): MemoryRecord | null {
    if (this.getMemory(guildId, input.key) !== null) return null;
    return this.proposeMemory(guildId, input);
  }

  // 🔍 記憶を1件取得する
  getMemory(guildId: string, key: string): MemoryRecord | null {
    const row = this.stmt(
      `SELECT ${MEMORY_COLUMNS} FROM memories WHERE guild_id = ? AND key = ?`,
    ).get(guildId, key) as MemoryRow | undefined;
    return row === undefined ? null : toMemoryRecord(row);
  }

  // 🔍 承認済みの記憶の内容だけを取得する（テンプレート参照用）
  getApprovedMemory(guildId: string, key: string): string | null {
    const row = this.stmt(
      "SELECT content FROM memories WHERE guild_id = ? AND key = ? AND status = 'approved'",
    ).get(guildId, key) as { content: string } | undefined;
    return row === undefined ? null : row.content;
  }

  // 📋 記憶の一覧をキー順で返す（状態で絞り込み可）
  listMemories(guildId: string, status?: MemoryStatus): MemoryRecord[] {
    const rows =
      status === undefined
        ? (this.stmt(
            `SELECT ${MEMORY_COLUMNS} FROM memories WHERE guild_id = ? ORDER BY key`,
          ).all(guildId) as unknown as MemoryRow[])
        : (this.stmt(
            `SELECT ${MEMORY_COLUMNS} FROM memories WHERE guild_id = ? AND status = ? ORDER BY key`,
          ).all(guildId, status) as unknown as MemoryRow[]);
    return rows.map(toMemoryRecord);
  }

  // ✅ 候補を承認する
  approveMemory(guildId: string, key: string, approvedBy: string): boolean {
    const result = this.stmt(
      "UPDATE memories SET status = 'approved', approved_by = ?, updated_at = ? WHERE guild_id = ? AND key = ?",
    ).run(approvedBy, this.nowIso(), guildId, key);
    return result.changes > 0;
  }

  // ❌ 候補を却下する
  rejectMemory(guildId: string, key: string): boolean {
    const result = this.stmt(
      "UPDATE memories SET status = 'rejected', approved_by = NULL, updated_at = ? WHERE guild_id = ? AND key = ?",
    ).run(this.nowIso(), guildId, key);
    return result.changes > 0;
  }

  // 🗑️ 記憶を削除する
  deleteMemory(guildId: string, key: string): boolean {
    const result = this.stmt(
      "DELETE FROM memories WHERE guild_id = ? AND key = ?",
    ).run(guildId, key);
    return result.changes > 0;
  }

  // 🔢 記憶の件数を数える（状態で絞り込み可）
  countMemories(guildId: string, status?: MemoryStatus): number {
    const row =
      status === undefined
        ? (this.stmt(
            "SELECT COUNT(*) AS n FROM memories WHERE guild_id = ?",
          ).get(guildId) as CountRow | undefined)
        : (this.stmt(
            "SELECT COUNT(*) AS n FROM memories WHERE guild_id = ? AND status = ?",
          ).get(guildId, status) as CountRow | undefined);
    return row === undefined ? 0 : row.n;
  }

  // ==========================================
  // 🌱 成長記録
  // ==========================================

  // 🌱 実行を成長記録へ反映する。稼働日数は日付が変わった日だけ増える
  recordGrowthExecution(guildId: string, at: Date = new Date()): GrowthRecord {
    this.ensureGuild(guildId);
    const iso = at.toISOString();
    const today = iso.slice(0, 10);
    const existing = this.getGrowthRecord(guildId);
    if (existing === null) {
      this.stmt(
        "INSERT INTO growth (guild_id, total_executions, active_days, last_active_date, first_active_at, updated_at) VALUES (?, 1, 1, ?, ?, ?)",
      ).run(guildId, today, iso, iso);
    } else {
      const dayIncrement = existing.lastActiveDate !== today ? 1 : 0;
      this.stmt(
        "UPDATE growth SET total_executions = total_executions + 1, active_days = active_days + ?, last_active_date = ?, updated_at = ? WHERE guild_id = ?",
      ).run(dayIncrement, today, iso, guildId);
    }
    return this.getGrowthRecord(guildId)!;
  }

  // 🔍 成長記録を取得する
  getGrowthRecord(guildId: string): GrowthRecord | null {
    const row = this.stmt(
      "SELECT guild_id, total_executions, active_days, last_active_date, first_active_at FROM growth WHERE guild_id = ?",
    ).get(guildId) as GrowthRow | undefined;
    if (row === undefined) return null;
    return {
      guildId: row.guild_id,
      totalExecutions: row.total_executions,
      activeDays: row.active_days,
      lastActiveDate: row.last_active_date,
      firstActiveAt: row.first_active_at,
    };
  }

  // ==========================================
  // 🔌 プラグイン有効化状態
  // ==========================================

  // 🔌 ギルド単位でプラグインの有効・無効を保存する
  setPluginEnabled(
    guildId: string,
    pluginName: string,
    enabled: boolean,
  ): void {
    this.ensureGuild(guildId);
    const at = this.nowIso();
    this.stmt(
      `INSERT INTO plugin_installs (guild_id, plugin_name, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (guild_id, plugin_name)
       DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at`,
    ).run(guildId, pluginName, enabled ? 1 : 0, at, at);
  }

  // 🔍 プラグインがそのギルドで有効か（未設定は無効）
  isPluginEnabled(guildId: string, pluginName: string): boolean {
    const row = this.stmt(
      "SELECT enabled FROM plugin_installs WHERE guild_id = ? AND plugin_name = ?",
    ).get(guildId, pluginName) as { enabled: number } | undefined;
    return row !== undefined && row.enabled === 1;
  }

  // 📋 プラグイン有効化状態の一覧を名前順で返す
  listPluginInstalls(guildId: string): PluginInstall[] {
    const rows = this.stmt(
      "SELECT plugin_name, enabled FROM plugin_installs WHERE guild_id = ? ORDER BY plugin_name",
    ).all(guildId) as unknown as PluginInstallRow[];
    return rows.map((row) => ({
      guildId,
      pluginName: row.plugin_name,
      enabled: row.enabled === 1,
    }));
  }

  // ==========================================
  // ⚙️ ギルド設定（キーバリュー）
  // ==========================================

  private readSetting(guildId: string, key: string): string | null {
    const row = this.stmt(
      "SELECT value FROM guild_settings WHERE guild_id = ? AND key = ?",
    ).get(guildId, key) as { value: string } | undefined;
    return row === undefined ? null : row.value;
  }

  private writeSetting(guildId: string, key: string, value: string): void {
    this.ensureGuild(guildId);
    this.stmt(
      `INSERT INTO guild_settings (guild_id, key, value, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (guild_id, key)
       DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ).run(guildId, key, value, this.nowIso());
  }

  // ⚙️ 記憶の自動提案の有効・無効を保存する（既定は有効、無効化だけを記録）
  setAutoMemoryEnabled(guildId: string, enabled: boolean): void {
    this.writeSetting(guildId, "auto_memory_enabled", enabled ? "1" : "0");
  }

  // ⚙️ 記憶の自動提案が有効か（未設定は有効）
  isAutoMemoryEnabled(guildId: string): boolean {
    return this.readSetting(guildId, "auto_memory_enabled") !== "0";
  }

  // ==========================================
  // 📊 集計・書き出し・全削除
  // ==========================================

  // 📊 ギルドの件数集計を返す
  getCounts(guildId: string): GuildCounts {
    const countWhere = (sql: string): number => {
      const row = this.stmt(sql).get(guildId) as CountRow | undefined;
      return row === undefined ? 0 : row.n;
    };
    return {
      blueprints: countWhere(
        "SELECT COUNT(*) AS n FROM blueprints WHERE guild_id = ?",
      ),
      variables: countWhere(
        "SELECT COUNT(*) AS n FROM variables WHERE guild_id = ?",
      ),
      counters: countWhere(
        "SELECT COUNT(*) AS n FROM counters WHERE guild_id = ?",
      ),
      executions: countWhere(
        "SELECT execution_count AS n FROM guilds WHERE guild_id = ?",
      ),
    };
  }

  // 📤 ギルドの全データを書き出し用にまとめる
  exportGuildData(guildId: string): GuildExport {
    const variableRows = this.stmt(
      "SELECT scope, owner_id, key, value FROM variables WHERE guild_id = ? ORDER BY scope, owner_id, key",
    ).all(guildId) as unknown as VariableRow[];
    const counterRows = this.stmt(
      "SELECT key, value FROM counters WHERE guild_id = ? ORDER BY key",
    ).all(guildId) as unknown as CounterRow[];
    return {
      guildId,
      disabled: this.isGuildDisabled(guildId),
      autoMemoryEnabled: this.isAutoMemoryEnabled(guildId),
      executions: this.getCounts(guildId).executions,
      blueprints: this.listBlueprints(guildId),
      variables: variableRows.map((row) => ({
        scope: row.scope,
        ownerId: row.owner_id,
        key: row.key,
        value: row.value,
      })),
      counters: counterRows.map((row) => ({
        key: row.key,
        value: row.value,
      })),
      memories: this.listMemories(guildId),
      growth: this.getGrowthRecord(guildId),
      pluginInstalls: this.listPluginInstalls(guildId).map((row) => ({
        pluginName: row.pluginName,
        enabled: row.enabled,
      })),
    };
  }

  // 🗑️ ギルドのデータを全テーブルから削除する（単一トランザクション）
  deleteGuildData(guildId: string): void {
    const tables = [
      "blueprints",
      "variables",
      "counters",
      "automation_fired",
      "automation_state",
      "memories",
      "growth",
      "plugin_installs",
      "guild_settings",
      "guilds",
    ];
    this.db.exec("BEGIN");
    try {
      for (const table of tables) {
        this.stmt(`DELETE FROM ${table} WHERE guild_id = ?`).run(guildId);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}
