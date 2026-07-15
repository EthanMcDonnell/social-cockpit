-- ─────────────────────────────────────────────────────────────────────────────
-- DEFERRED MIGRATION — NOT APPLIED.
--
-- Per CLAUDE.md this repo serves live traffic; DB changes are additive and are
-- only applied at hand-off, never by the app or this branch. This file is the
-- artifact for that hand-off. It is NOT wired into src/lib/db/index.ts, so
-- nothing runs it automatically. Apply it by hand against data/automations.db
-- when you're ready:
--
--     sqlite3 data/automations.db < migrations/001_youtube_uploads.sql
--
-- ── What it's for ──
-- Optional audit log mapping each published YouTube video id to the R2 object
-- key it was uploaded from, paralleling how Instagram publishes are tracked.
-- Phases 0–2 (OAuth, Compose switch, upload-to-private-draft) do NOT depend on
-- this table — the upload path reclaims its R2 key inline. It exists purely for
-- after-the-fact reclaim auditing and future features.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS youtube_uploads (
  video_id      TEXT PRIMARY KEY,
  r2_key        TEXT NOT NULL,
  title         TEXT,
  is_short      INTEGER NOT NULL DEFAULT 0,
  privacy_status TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_youtube_uploads_created ON youtube_uploads(created_at);
