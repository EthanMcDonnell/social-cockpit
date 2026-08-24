import Database from "better-sqlite3";
import { config } from "@/lib/config";
import path from "path";
import fs from "fs";

/**
 * The system event log, in its OWN sqlite file.
 *
 * Every worker already had somewhere to put a *funnel* event — automation_events
 * and schedule_events, both in automations.db. What none of them had was
 * somewhere to put "the cache sync failed", "the token refresh failed", "the
 * public reply didn't post": those went to stdout and died there, which meant
 * the only failures visible in the UI were the ones that happened to occur
 * inside the two workers that had a table.
 *
 * Kept out of automations.db on purpose. That file holds the Instagram access
 * token, the YouTube refresh token, and the funnel state the product actually
 * depends on; this one holds history nothing reads to make a decision. Deleting
 * events.db costs you the log and nothing else, which is not a sentence you can
 * write about automations.db.
 */
const EVENTS_DB_PATH = config.db.events;

let _db: Database.Database | null = null;

export function getEventsDb(): Database.Database {
  if (_db) return _db;
  const dir = path.dirname(EVENTS_DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  _db = new Database(EVENTS_DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.exec(`
    -- Same shape as automation_events / schedule_events so one table component
    -- renders all three, plus a source column: this table is fed by every worker
    -- rather than one, and "which subsystem" is the first thing you want to
    -- filter on when something is broken.
    CREATE TABLE IF NOT EXISTS system_events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      source     TEXT NOT NULL,
      level      TEXT NOT NULL CHECK(level IN ('info','warn','error')),
      kind       TEXT NOT NULL,
      message    TEXT,
      meta       TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_system_events_created ON system_events(created_at);
    CREATE INDEX IF NOT EXISTS idx_system_events_level   ON system_events(level);
    CREATE INDEX IF NOT EXISTS idx_system_events_source  ON system_events(source);
  `);
  return _db;
}

export interface SystemEventRow {
  id: number;
  source: string;
  level: "info" | "warn" | "error";
  kind: string;
  message: string | null;
  meta: string | null;
  created_at: string;
}
