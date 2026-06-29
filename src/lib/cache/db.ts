import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import type {
  InstagramMedia,
  MediaType,
  MediaProductType,
  MediaInsights,
} from "@/lib/instagram/types";

// A local materialized cache of Meta API data, in its OWN sqlite file — fully
// decoupled from automations.db and transcripts.db. Reads are served from here
// (fast, local) and a background worker keeps it fresh; see ./sync.ts.
const CACHE_DB_PATH =
  process.env.CACHE_DB_PATH ?? path.join(process.cwd(), "data", "cache.db");

let _db: Database.Database | null = null;

export function getCacheDb(): Database.Database {
  if (_db) return _db;
  const dir = path.dirname(CACHE_DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  _db = new Database(CACHE_DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.exec(`
    CREATE TABLE IF NOT EXISTS media (
      media_id           TEXT PRIMARY KEY,
      caption            TEXT,
      media_type         TEXT NOT NULL,
      media_product_type TEXT,
      permalink          TEXT,
      thumbnail_url      TEXT,
      media_url          TEXT,
      shortcode          TEXT,
      timestamp          TEXT,
      like_count         INTEGER,
      comments_count     INTEGER,
      raw                TEXT NOT NULL DEFAULT '{}',
      fetched_at         TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS media_insights (
      media_id              TEXT PRIMARY KEY,
      reach                 INTEGER,
      views                 INTEGER,
      likes                 INTEGER,
      comments              INTEGER,
      shares                INTEGER,
      saved                 INTEGER,
      total_interactions    INTEGER,
      avg_watch_time        REAL,
      video_view_total_time REAL,
      fetched_at            TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS sync_state (
      key            TEXT PRIMARY KEY,
      last_synced_at TEXT,
      last_status    TEXT,
      detail         TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_media_timestamp ON media(timestamp DESC);
  `);
  return _db;
}

// ─── Row shapes ───────────────────────────────────────────────────────────────

export interface MediaRow {
  media_id: string;
  caption: string | null;
  media_type: string;
  media_product_type: string | null;
  permalink: string | null;
  thumbnail_url: string | null;
  media_url: string | null;
  shortcode: string | null;
  timestamp: string | null;
  like_count: number | null;
  comments_count: number | null;
  raw: string;
  fetched_at: string;
}

export interface MediaInsightsRow {
  media_id: string;
  reach: number | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saved: number | null;
  total_interactions: number | null;
  avg_watch_time: number | null;
  video_view_total_time: number | null;
  fetched_at: string;
}

export interface SyncStateRow {
  key: string;
  last_synced_at: string | null;
  last_status: string | null;
  detail: string | null;
}

// ─── Converters ───────────────────────────────────────────────────────────────

export function rowToMedia(row: MediaRow): InstagramMedia {
  return {
    id: row.media_id,
    caption: row.caption ?? undefined,
    media_type: row.media_type as MediaType,
    media_product_type:
      (row.media_product_type as MediaProductType | null) ?? undefined,
    permalink: row.permalink ?? undefined,
    thumbnail_url: row.thumbnail_url ?? undefined,
    media_url: row.media_url ?? undefined,
    shortcode: row.shortcode ?? undefined,
    timestamp: row.timestamp ?? "",
    like_count: row.like_count ?? undefined,
    comments_count: row.comments_count ?? undefined,
  };
}

export function rowToInsights(row: MediaInsightsRow): MediaInsights {
  return {
    mediaId: row.media_id,
    reach: row.reach ?? undefined,
    views: row.views ?? undefined,
    likes: row.likes ?? undefined,
    comments: row.comments ?? undefined,
    shares: row.shares ?? undefined,
    saved: row.saved ?? undefined,
    total_interactions: row.total_interactions ?? undefined,
    ig_reels_avg_watch_time: row.avg_watch_time ?? undefined,
    ig_reels_video_view_total_time: row.video_view_total_time ?? undefined,
  };
}
