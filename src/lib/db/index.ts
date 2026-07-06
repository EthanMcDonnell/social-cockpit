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
    // ── comment_to_follow_dm funnel state (Comment → Follow → DM) ──
    // A pending row exists only while a user is mid-funnel; it is culled the
    // moment the funnel resolves (reward sent / nudges exhausted / TTL expiry),
    // so the table stays small and self-draining. Additive only — existing
    // flows never touch this table.
    `CREATE TABLE IF NOT EXISTS follow_check_pending (
      flow_id            TEXT NOT NULL,
      recipient_id       TEXT NOT NULL,
      commenter_username TEXT,
      comment_id         TEXT,
      nudge_count        INTEGER NOT NULL DEFAULT 0,
      created_at         TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (flow_id, recipient_id)
    )`,
    "CREATE INDEX IF NOT EXISTS idx_pending_created ON follow_check_pending(created_at)",
    // ── automation event log (observability for the funnel) ──
    // Every meaningful step and every failure is recorded here so problems are
    // inspectable after the fact instead of vanishing into stdout. Self-bounds
    // via a 30-day retention cull on the worker cadence.
    `CREATE TABLE IF NOT EXISTS automation_events (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      flow_id      TEXT,
      recipient_id TEXT,
      comment_id   TEXT,
      level        TEXT NOT NULL CHECK(level IN ('info','warn','error')),
      kind         TEXT NOT NULL,
      message      TEXT,
      meta         TEXT,
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    "CREATE INDEX IF NOT EXISTS idx_events_created ON automation_events(created_at)",
    "CREATE INDEX IF NOT EXISTS idx_events_level   ON automation_events(level)",
  ]) {
    try { _db.exec(sql); } catch { /* already exists */ }
  }
  return _db;
}

// ─── Cursors ─────────────────────────────────────────────────────────────────
// Reuses the automation_post_cursors table as a generic key→ISO-timestamp store
// (the confirm poll stores its incremental message cursor under a reserved key).

export function getCursor(db: Database.Database, key: string): string | undefined {
  const row = db
    .prepare("SELECT last_checked_at FROM automation_post_cursors WHERE media_id = ?")
    .get(key) as { last_checked_at: string } | undefined;
  return row?.last_checked_at ?? undefined;
}

export function setCursor(db: Database.Database, key: string, value?: string): void {
  if (!value) return;
  db.prepare(
    `INSERT INTO automation_post_cursors (media_id, last_checked_at) VALUES (?, ?)
       ON CONFLICT(media_id) DO UPDATE SET last_checked_at = excluded.last_checked_at`
  ).run(key, value);
}

// ─── Automation Flows ────────────────────────────────────────────────────────

export type AutomationTemplateType =
  "comment_to_dm" | "comment_to_reply" | "comment_to_follow_dm";

export interface CommentToDmConfig {
  comment_reply_fn?: string;
  comment_replies: string[];
  initial_message: string;
  // Posts this flow applies to. Absent/empty = any post. Stored inside the
  // config JSON so no schema migration is needed to support multiple videos.
  media_ids?: string[];
}

export interface CommentToReplyConfig {
  comment_reply_fn?: string;
  comment_replies: string[];
  media_ids?: string[];
}

// Comment → Follow → DM (reply-to-confirm). DMs a reward only to people who
// follow, via a confirm-tap flow. Additive — existing configs are untouched.
export interface CommentToFollowDmConfig {
  comment_reply_fn?: string;          // reuse public-reply machinery
  comment_replies?: string[];
  media_ids?: string[];

  opener_message?: string;            // "Follow me, then reply DONE and I'll send it 🔗"
  confirm_keyword?: string;           // reply-to-confirm keyword, default "DONE"
  follower_message?: string;          // reward — sent to followers (manual)
  not_following_message?: string;     // nudge — sent to non-followers
  dm_pack?: string;                   // named copy pack — generates opener + nudge
  resource?: string;                  // {{resource}} value, default "resources"
  on_check_error?: "reward" | "follow_prompt" | "skip"; // default "follow_prompt"
}

export type AutomationConfig =
  | CommentToDmConfig
  | CommentToReplyConfig
  | CommentToFollowDmConfig;

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
  // Primary/first targeted post — kept for backward compatibility and list display.
  media_id?: string;
  // Full set of targeted posts. Empty = any post. Source of truth for matching.
  media_ids: string[];
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
    row.template_type === "comment_to_reply"
      ? "comment_to_reply"
      : row.template_type === "comment_to_follow_dm"
        ? "comment_to_follow_dm"
        : "comment_to_dm";
  const config = JSON.parse(row.config) as AutomationConfig;
  // Resolve targeted posts: new flows store the full list in config.media_ids;
  // older flows only have the single media_id column (or none = any post).
  const configMediaIds = Array.isArray(config.media_ids)
    ? config.media_ids.filter(Boolean)
    : undefined;
  const media_ids = configMediaIds ?? (row.media_id ? [row.media_id] : []);
  return {
    id: row.id,
    name: row.name,
    template_type,
    trigger_keywords,
    config,
    is_active: row.is_active === 1,
    created_at: row.created_at,
    media_id: media_ids[0] ?? row.media_id ?? undefined,
    media_ids,
    activated_at: row.activated_at ?? undefined,
  };
}

export function resolveTemplate(
  template: string,
  placeholders: Record<string, string>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => placeholders[key] ?? `{{${key}}}`);
}
