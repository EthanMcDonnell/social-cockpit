import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DB_PATH =
  process.env.DB_PATH ?? path.join(process.cwd(), "data", "automations.db");

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.exec(`
    CREATE TABLE IF NOT EXISTS automations (
      id         TEXT    PRIMARY KEY,
      post_id    TEXT    NOT NULL,
      keyword    TEXT    NOT NULL,
      action_type TEXT   NOT NULL CHECK(action_type IN ('comment','dm')),
      template_body TEXT NOT NULL,
      placeholder_values TEXT NOT NULL DEFAULT '{}',
      is_active  INTEGER NOT NULL DEFAULT 0,
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS fired_automations (
      automation_id TEXT NOT NULL,
      comment_id    TEXT NOT NULL,
      fired_at      TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (automation_id, comment_id)
    );
    CREATE TABLE IF NOT EXISTS automation_flows (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      template_type   TEXT NOT NULL DEFAULT 'comment_to_dm',
      trigger_keyword TEXT NOT NULL,
      config          TEXT NOT NULL DEFAULT '{}',
      is_active       INTEGER NOT NULL DEFAULT 0,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  for (const sql of [
    "ALTER TABLE automation_flows ADD COLUMN media_id TEXT",
    "ALTER TABLE automation_flows ADD COLUMN activated_at TEXT",
    `CREATE TABLE IF NOT EXISTS automation_post_cursors (
      media_id        TEXT PRIMARY KEY,
      last_checked_at TEXT NOT NULL
    )`,
  ]) {
    try { _db.exec(sql); } catch { /* already exists */ }
  }
  return _db;
}

// ─── Automation Flows ────────────────────────────────────────────────────────

export type AutomationTemplateType = "comment_to_dm" | "comment_to_reply";

export interface CommentToDmConfig {
  comment_reply_fn?: string;
  comment_replies: string[];
  initial_message: string;
}

export interface CommentToReplyConfig {
  comment_reply_fn?: string;
  comment_replies: string[];
}

export type AutomationConfig = CommentToDmConfig | CommentToReplyConfig;

export interface AutomationFlowRow {
  id: string;
  name: string;
  template_type: string;
  trigger_keyword: string;
  config: string;
  is_active: number;
  created_at: string;
  media_id?: string;
  activated_at?: string;
}

export interface AutomationFlow {
  id: string;
  name: string;
  template_type: AutomationTemplateType;
  trigger_keywords: string[];
  config: AutomationConfig;
  is_active: boolean;
  created_at: string;
  media_id?: string;
  activated_at?: string;
}

export function rowToFlow(row: AutomationFlowRow): AutomationFlow {
  // Backward-compatible: old rows stored a plain string, new rows store JSON array
  let trigger_keywords: string[];
  try {
    const parsed = JSON.parse(row.trigger_keyword);
    trigger_keywords = Array.isArray(parsed) ? parsed : [String(parsed)];
  } catch {
    trigger_keywords = row.trigger_keyword ? [row.trigger_keyword] : [];
  }
  const template_type: AutomationTemplateType =
    row.template_type === "comment_to_reply" ? "comment_to_reply" : "comment_to_dm";
  return {
    id: row.id,
    name: row.name,
    template_type,
    trigger_keywords,
    config: JSON.parse(row.config) as AutomationConfig,
    is_active: row.is_active === 1,
    created_at: row.created_at,
    media_id: row.media_id ?? undefined,
    activated_at: row.activated_at ?? undefined,
  };
}

export function resolveTemplate(
  template: string,
  placeholders: Record<string, string>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => placeholders[key] ?? `{{${key}}}`);
}
