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
  try {
    _db.exec("ALTER TABLE automation_flows ADD COLUMN media_id TEXT");
  } catch {
    // column already exists
  }
  return _db;
}

export interface AutomationRow {
  id: string;
  post_id: string;
  keyword: string;
  action_type: "comment" | "dm";
  template_body: string;
  placeholder_values: string;
  is_active: number;
  created_at: string;
}

export interface Automation {
  id: string;
  post_id: string;
  keyword: string;
  action_type: "comment" | "dm";
  template_body: string;
  placeholder_values: Record<string, string>;
  is_active: boolean;
  created_at: string;
}

export function rowToAutomation(row: AutomationRow): Automation {
  return {
    ...row,
    placeholder_values: JSON.parse(row.placeholder_values),
    is_active: row.is_active === 1,
  };
}

// ─── Automation Flows ────────────────────────────────────────────────────────

export interface CommentToDmConfig {
  initial_message: string;
  not_following_message: string;
  following_message: string;
}

export interface AutomationFlowRow {
  id: string;
  name: string;
  template_type: string;
  trigger_keyword: string;
  config: string;
  is_active: number;
  created_at: string;
  media_id?: string;
}

export interface AutomationFlow {
  id: string;
  name: string;
  template_type: "comment_to_dm";
  trigger_keywords: string[];
  config: CommentToDmConfig;
  is_active: boolean;
  created_at: string;
  media_id?: string;
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
  return {
    id: row.id,
    name: row.name,
    template_type: "comment_to_dm",
    trigger_keywords,
    config: JSON.parse(row.config) as CommentToDmConfig,
    is_active: row.is_active === 1,
    created_at: row.created_at,
    media_id: row.media_id ?? undefined,
  };
}

export function resolveTemplate(
  template: string,
  placeholders: Record<string, string>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => placeholders[key] ?? `{{${key}}}`);
}
