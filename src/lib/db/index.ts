import Database from "better-sqlite3";
import { config } from "@/lib/config";
import path from "path";
import fs from "fs";

const DB_PATH = config.db.main;

let _db: Database.Database | null = null;

/**
 * Narrow this database to its owner.
 *
 * It holds the Instagram access token and the YouTube refresh token (see
 * `lib/credentials.ts`), and SQLite creates files with the process umask —
 * typically 0644, world-readable. `.env`, where these secrets used to live, is
 * 0600, so without this the move from one to the other would quietly widen who
 * can read them.
 *
 * The `-wal` file needs it just as much: freshly written pages land there before
 * they are checkpointed into the main file, so a rotated token is in the WAL
 * first. `-shm` is a shared-memory index rather than page data, but it is
 * covered too rather than reason about the distinction.
 *
 * Called after the connection is open and WAL mode is set, so the sidecars
 * exist. Best-effort: a chmod can fail on a filesystem that has no POSIX modes
 * (a mounted volume, some containers), and refusing to start over that would be
 * worse than the exposure it prevents on a single-user box.
 */
function restrictPermissions(): void {
  for (const file of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) {
    try {
      if (fs.existsSync(file)) fs.chmodSync(file, 0o600);
    } catch (err) {
      console.warn(
        `[db] could not restrict permissions on ${file}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
}

export function getDb(): Database.Database {
  if (_db) return _db;
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  restrictPermissions();
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
    // ── stable dedup slug for API-driven publish+automate ──
    // Lets a publish call target an existing flow by key instead of creating a
    // duplicate: re-posting a variation of the same video with the same
    // automation_key appends the new media_id to the matching flow. Additive;
    // non-unique index (oldest match wins on lookup). Legacy flows have NULL.
    "ALTER TABLE automation_flows ADD COLUMN automation_key TEXT",
    "CREATE INDEX IF NOT EXISTS idx_flows_automation_key ON automation_flows(automation_key)",
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
    // ── R2 storage usage gate (see docs/r2-integration.md) ──
    // One row per live object reserved/uploaded under publish/. Rows are removed
    // the moment the object is deleted, so steady-state is ~empty; SUM(size_bytes)
    // is the authoritative "reserved" figure the sign route gates against.
    `CREATE TABLE IF NOT EXISTS r2_reservations (
      key         TEXT PRIMARY KEY,
      size_bytes  INTEGER NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    // ── scheduling (see docs/scheduling.md) ──────────────────────────────────
    // The scheduler is entirely DB-driven: this table IS the state machine, and
    // the worker is a stateless 30s poll over it. Nothing lives in memory, so a
    // restart loses nothing and the calendar can edit a job by writing a row.
    //
    // scheduled_at is epoch MILLISECONDS, not a datetime('now') string. The rest
    // of this schema uses text timestamps, which are fine for "when did this
    // happen" but ambiguous for "is this due yet" — an integer makes the claim
    // query trivially correct and indexable.
    `CREATE TABLE IF NOT EXISTS scheduled_posts (
      id              TEXT    PRIMARY KEY,
      platform        TEXT    NOT NULL CHECK(platform IN ('ig','yt')),
      status          TEXT    NOT NULL CHECK(status IN
                        ('pending','publishing','finalizing','published',
                         'failed','missed','cancelled','paused')),
      scheduled_at    INTEGER NOT NULL,
      payload         TEXT    NOT NULL DEFAULT '{}',
      media           TEXT    NOT NULL DEFAULT '[]',
      automation      TEXT,
      attempts        INTEGER NOT NULL DEFAULT 0,
      max_attempts    INTEGER NOT NULL DEFAULT 3,
      next_attempt_at INTEGER,
      lease_until     INTEGER,
      grace_minutes   INTEGER NOT NULL DEFAULT 60,
      container_id    TEXT,
      result          TEXT,
      created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
    )`,
    "CREATE INDEX IF NOT EXISTS idx_sched_due ON scheduled_posts(status, scheduled_at)",
    "CREATE INDEX IF NOT EXISTS idx_sched_window ON scheduled_posts(scheduled_at)",
    // Media staged for a scheduled post. `path` is always an absolute path on
    // this machine — media deliberately never reaches R2 until publish time, so
    // there is nothing here but a pointer to local bytes.
    //   owned=0 → the caller's own file, referenced in place, never touched.
    //   owned=1 → a browser upload we copied into data/staged, ours to delete.
    `CREATE TABLE IF NOT EXISTS scheduled_media (
      id           TEXT    PRIMARY KEY,
      path         TEXT    NOT NULL,
      owned        INTEGER NOT NULL DEFAULT 0,
      size_bytes   INTEGER NOT NULL,
      content_type TEXT    NOT NULL,
      created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
    )`,
    // Per-job event log — same shape and 30-day retention discipline as
    // automation_events, so the Logs page renders both with one component.
    `CREATE TABLE IF NOT EXISTS schedule_events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id     TEXT,
      level      TEXT NOT NULL CHECK(level IN ('info','warn','error')),
      kind       TEXT NOT NULL,
      message    TEXT,
      meta       TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    "CREATE INDEX IF NOT EXISTS idx_sched_events_created ON schedule_events(created_at)",
    "CREATE INDEX IF NOT EXISTS idx_sched_events_job ON schedule_events(job_id)",
    // Generic key→value app settings. Introduced for the calendar's display
    // timezone, which must not require an app restart to change (unlike the
    // .env-backed settings) since it silently changes what every slot means.
    `CREATE TABLE IF NOT EXISTS app_settings (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
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
  automation_key?: string;
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
  // Stable dedup slug set by API-driven publish+automate. Absent for UI flows.
  automation_key?: string;
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
    automation_key: row.automation_key ?? undefined,
  };
}

/**
 * Remove a media ID from every flow that targets it. Used when Instagram reports
 * the media is gone (error code 100 / subcode 33 — deleted post or lost access),
 * so the worker stops hammering the API every cycle for a post that will never
 * come back.
 *
 * A flow whose target list becomes empty is DEACTIVATED rather than left empty:
 * an empty media_ids reads as "any post", so blanking it would silently widen the
 * flow to every post instead of retiring it.
 *
 * Returns the flows that were changed, for logging.
 */
export function pruneMediaFromFlows(
  db: Database.Database,
  mediaId: string
): Array<{ id: string; name: string; deactivated: boolean }> {
  const rows = db
    .prepare("SELECT * FROM automation_flows")
    .all() as AutomationFlowRow[];
  const changed: Array<{ id: string; name: string; deactivated: boolean }> = [];

  for (const row of rows) {
    const flow = rowToFlow(row);
    if (!flow.media_ids.includes(mediaId)) continue;

    const remaining = flow.media_ids.filter((id) => id !== mediaId);
    const config = JSON.stringify({ ...flow.config, media_ids: remaining });
    const newMediaId = remaining[0] ?? null;
    // Empty target list would read as "any post" — retire the flow instead.
    const deactivated = remaining.length === 0;
    const isActive = deactivated ? 0 : row.is_active;

    db.prepare(
      "UPDATE automation_flows SET config=?, media_id=?, is_active=? WHERE id=?"
    ).run(config, newMediaId, isActive, row.id);

    changed.push({ id: row.id, name: row.name, deactivated });
  }

  return changed;
}

export function resolveTemplate(
  template: string,
  placeholders: Record<string, string>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => placeholders[key] ?? `{{${key}}}`);
}
