import Database from "better-sqlite3";
import { config } from "@/lib/config";
import path from "path";
import fs from "fs";

// Transcripts live in their OWN sqlite file, fully decoupled from the
// production automations.db. This keeps the transcription feature from ever
// touching the live automations dataset.
const TRANSCRIPTS_DB_PATH = config.db.transcripts;

let _db: Database.Database | null = null;

export function getTranscriptsDb(): Database.Database {
  if (_db) return _db;
  const dir = path.dirname(TRANSCRIPTS_DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  _db = new Database(TRANSCRIPTS_DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.exec(`
    CREATE TABLE IF NOT EXISTS transcripts (
      media_id   TEXT PRIMARY KEY,
      text       TEXT NOT NULL,
      language   TEXT,
      duration   REAL,
      model      TEXT NOT NULL,
      segments   TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS app_settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  return _db;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface TranscriptRow {
  media_id: string;
  text: string;
  language: string | null;
  duration: number | null;
  model: string;
  segments: string;
  created_at: string;
}

export interface Transcript {
  mediaId: string;
  text: string;
  language: string | null;
  duration: number | null;
  model: string;
  segments: TranscriptSegment[];
  createdAt: string;
}

// Lightweight transcript metadata for list views — no full text or segments.
export interface TranscriptSummary {
  mediaId: string;
  language: string | null;
  duration: number | null;
  model: string;
  charCount: number;
  preview: string;
  createdAt: string;
}

export function rowToTranscript(row: TranscriptRow): Transcript {
  let segments: TranscriptSegment[] = [];
  try {
    const parsed = JSON.parse(row.segments);
    if (Array.isArray(parsed)) segments = parsed;
  } catch {
    /* malformed segments — fall back to empty */
  }
  return {
    mediaId: row.media_id,
    text: row.text,
    language: row.language,
    duration: row.duration,
    model: row.model,
    segments,
    createdAt: row.created_at,
  };
}
