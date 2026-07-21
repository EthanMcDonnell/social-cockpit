import {
  getCacheDb,
  rowToMedia,
  rowToInsights,
  type MediaRow,
  type MediaInsightsRow,
  type SyncStateRow,
} from "./db";
import type { InstagramMedia, MediaInsights } from "@/lib/instagram/types";

// ─── Writes ───────────────────────────────────────────────────────────────────

export function upsertMedia(items: InstagramMedia[]): void {
  if (items.length === 0) return;
  const db = getCacheDb();
  const stmt = db.prepare(
    `INSERT INTO media (media_id, caption, media_type, media_product_type,
       permalink, thumbnail_url, media_url, shortcode, timestamp, like_count,
       comments_count, raw, fetched_at)
     VALUES (@media_id, @caption, @media_type, @media_product_type, @permalink,
       @thumbnail_url, @media_url, @shortcode, @timestamp, @like_count,
       @comments_count, @raw, datetime('now'))
     ON CONFLICT(media_id) DO UPDATE SET
       caption = excluded.caption, media_type = excluded.media_type,
       media_product_type = excluded.media_product_type, permalink = excluded.permalink,
       thumbnail_url = excluded.thumbnail_url, media_url = excluded.media_url,
       shortcode = excluded.shortcode, timestamp = excluded.timestamp,
       like_count = excluded.like_count, comments_count = excluded.comments_count,
       raw = excluded.raw, fetched_at = excluded.fetched_at`
  );
  const tx = db.transaction((rows: InstagramMedia[]) => {
    for (const m of rows) {
      stmt.run({
        media_id: m.id,
        caption: m.caption ?? null,
        media_type: m.media_type,
        media_product_type: m.media_product_type ?? null,
        permalink: m.permalink ?? null,
        thumbnail_url: m.thumbnail_url ?? null,
        media_url: m.media_url ?? null,
        shortcode: m.shortcode ?? null,
        timestamp: m.timestamp ?? null,
        like_count: m.like_count ?? null,
        comments_count: m.comments_count ?? null,
        raw: JSON.stringify(m),
      });
    }
  });
  tx(items);
}

export function upsertMediaInsights(mediaId: string, ins: MediaInsights): void {
  getCacheDb()
    .prepare(
      `INSERT INTO media_insights (media_id, reach, views, likes, comments,
         shares, saved, total_interactions, avg_watch_time,
         video_view_total_time, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(media_id) DO UPDATE SET
         reach = excluded.reach, views = excluded.views, likes = excluded.likes,
         comments = excluded.comments, shares = excluded.shares, saved = excluded.saved,
         total_interactions = excluded.total_interactions,
         avg_watch_time = excluded.avg_watch_time,
         video_view_total_time = excluded.video_view_total_time,
         fetched_at = excluded.fetched_at`
    )
    .run(
      mediaId,
      ins.reach ?? null,
      ins.views ?? null,
      ins.likes ?? null,
      ins.comments ?? null,
      ins.shares ?? null,
      ins.saved ?? null,
      ins.total_interactions ?? null,
      ins.ig_reels_avg_watch_time ?? null,
      ins.ig_reels_video_view_total_time ?? null
    );
}

// ─── Tombstones (media reported gone by the Graph API) ────────────────────────

/**
 * Record a media as gone and evict it from the cache. Idempotent. Called when a
 * per-media Graph call returns code 100 / subcode 33 (deleted post or lost
 * access); afterwards both the cache sync and the automation worker skip it.
 */
export function tombstoneMedia(mediaId: string, reason: string): void {
  const db = getCacheDb();
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO media_tombstones (media_id, reason) VALUES (?, ?)
         ON CONFLICT(media_id) DO UPDATE SET reason = excluded.reason`
    ).run(mediaId, reason);
    db.prepare("DELETE FROM media WHERE media_id = ?").run(mediaId);
    db.prepare("DELETE FROM media_insights WHERE media_id = ?").run(mediaId);
  });
  tx();
}

export function isMediaTombstoned(mediaId: string): boolean {
  return !!getCacheDb()
    .prepare("SELECT 1 FROM media_tombstones WHERE media_id = ?")
    .get(mediaId);
}

export function getTombstonedIds(): Set<string> {
  const rows = getCacheDb()
    .prepare("SELECT media_id FROM media_tombstones")
    .all() as { media_id: string }[];
  return new Set(rows.map((r) => r.media_id));
}

// ─── Sync state ───────────────────────────────────────────────────────────────

export type SyncKey = "media" | "insights";

export function setSyncState(
  key: SyncKey,
  status: "ok" | "error" | "throttled",
  detail?: string
): void {
  getCacheDb()
    .prepare(
      `INSERT INTO sync_state (key, last_synced_at, last_status, detail)
       VALUES (?, datetime('now'), ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         last_synced_at = excluded.last_synced_at,
         last_status = excluded.last_status, detail = excluded.detail`
    )
    .run(key, status, detail ?? null);
}

export function getSyncState(key: SyncKey): SyncStateRow | null {
  return (
    (getCacheDb()
      .prepare("SELECT * FROM sync_state WHERE key = ?")
      .get(key) as SyncStateRow | undefined) ?? null
  );
}

// ─── Freshness ────────────────────────────────────────────────────────────────

export function mediaCount(): number {
  return (
    getCacheDb().prepare("SELECT COUNT(*) AS n FROM media").get() as { n: number }
  ).n;
}

export function hasInsights(mediaId: string): boolean {
  return !!getCacheDb()
    .prepare("SELECT 1 FROM media_insights WHERE media_id = ?")
    .get(mediaId);
}

// True when a single media's cached insights are missing or older than ttlMs.
export function insightsStale(mediaId: string, ttlMs: number): boolean {
  const row = getCacheDb()
    .prepare("SELECT fetched_at FROM media_insights WHERE media_id = ?")
    .get(mediaId) as { fetched_at: string } | undefined;
  if (!row) return true;
  return Date.now() - new Date(row.fetched_at + "Z").getTime() > ttlMs;
}

// True when the last successful sync for `key` is older than ttlMs (or never ran).
export function isStale(key: SyncKey, ttlMs: number): boolean {
  const state = getSyncState(key);
  if (!state?.last_synced_at) return true;
  const age = Date.now() - new Date(state.last_synced_at + "Z").getTime();
  return age > ttlMs;
}

// ─── Reads ────────────────────────────────────────────────────────────────────

export function getCachedMedia(mediaId: string): InstagramMedia | null {
  const row = getCacheDb()
    .prepare("SELECT * FROM media WHERE media_id = ?")
    .get(mediaId) as MediaRow | undefined;
  return row ? rowToMedia(row) : null;
}

export function getCachedInsights(mediaId: string): MediaInsights | null {
  const row = getCacheDb()
    .prepare("SELECT * FROM media_insights WHERE media_id = ?")
    .get(mediaId) as MediaInsightsRow | undefined;
  return row ? rowToInsights(row) : null;
}

export function getCachedInsightsMany(
  mediaIds: string[]
): Map<string, MediaInsights> {
  const out = new Map<string, MediaInsights>();
  if (mediaIds.length === 0) return out;
  const ph = mediaIds.map(() => "?").join(",");
  const rows = getCacheDb()
    .prepare(`SELECT * FROM media_insights WHERE media_id IN (${ph})`)
    .all(...mediaIds) as MediaInsightsRow[];
  for (const r of rows) out.set(r.media_id, rowToInsights(r));
  return out;
}

export function getAllCachedMedia(): InstagramMedia[] {
  const rows = getCacheDb()
    .prepare("SELECT * FROM media ORDER BY timestamp DESC, media_id DESC")
    .all() as MediaRow[];
  return rows.map(rowToMedia);
}

// Keyset pagination over local rows, newest first. Cursor encodes the last
// (timestamp, media_id) seen; the next page is everything strictly "after" it.
export interface CachedMediaPage {
  items: InstagramMedia[];
  nextCursor: string | null;
}

function encodeCursor(row: MediaRow): string {
  return Buffer.from(`${row.timestamp ?? ""}|${row.media_id}`).toString("base64url");
}

function decodeCursor(cursor: string): { ts: string; id: string } | null {
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const idx = raw.lastIndexOf("|");
    if (idx === -1) return null;
    return { ts: raw.slice(0, idx), id: raw.slice(idx + 1) };
  } catch {
    return null;
  }
}

export function getCachedMediaPage(opts: {
  limit: number;
  after?: string;
  mediaTypes?: Set<string>;
}): CachedMediaPage {
  const { limit, after, mediaTypes } = opts;
  const where: string[] = [];
  const params: (string | number)[] = [];

  if (mediaTypes && mediaTypes.size > 0) {
    where.push(`media_type IN (${Array.from(mediaTypes).map(() => "?").join(",")})`);
    params.push(...Array.from(mediaTypes));
  }
  if (after) {
    const cur = decodeCursor(after);
    if (cur) {
      // strictly after the cursor in (timestamp DESC, media_id DESC) order
      where.push("(timestamp < ? OR (timestamp = ? AND media_id < ?))");
      params.push(cur.ts, cur.ts, cur.id);
    }
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  // Fetch one extra row to know whether a next page exists.
  const rows = getCacheDb()
    .prepare(
      `SELECT * FROM media ${whereSql}
       ORDER BY timestamp DESC, media_id DESC LIMIT ?`
    )
    .all(...params, limit + 1) as MediaRow[];

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor =
    hasMore && pageRows.length > 0 ? encodeCursor(pageRows[pageRows.length - 1]) : null;

  return { items: pageRows.map(rowToMedia), nextCursor };
}

// ─── Ranking & aggregates ─────────────────────────────────────────────────────

export type RankMetric =
  | "likes"
  | "comments"
  | "reach"
  | "views"
  | "saved"
  | "shares"
  | "total_interactions"
  | "avg_watch_time"
  | "engagement";

// Whitelisted metric → SQL expression (prevents injection via the metric param).
const METRIC_SQL: Record<RankMetric, string> = {
  likes: "COALESCE(mi.likes, m.like_count, 0)",
  comments: "COALESCE(mi.comments, m.comments_count, 0)",
  reach: "COALESCE(mi.reach, 0)",
  views: "COALESCE(mi.views, 0)",
  saved: "COALESCE(mi.saved, 0)",
  shares: "COALESCE(mi.shares, 0)",
  total_interactions: "COALESCE(mi.total_interactions, 0)",
  avg_watch_time: "COALESCE(mi.avg_watch_time, 0)",
  engagement:
    "COALESCE(mi.likes, m.like_count, 0) + COALESCE(mi.comments, m.comments_count, 0)",
};

export function isRankMetric(value: string): value is RankMetric {
  return value in METRIC_SQL;
}

export interface RankedPost {
  media: InstagramMedia;
  insights: MediaInsights | null;
  metricValue: number;
}

export function getRankedPosts(opts: {
  metric: RankMetric;
  limit?: number;
  mediaTypes?: Set<string>;
}): RankedPost[] {
  const { metric, limit, mediaTypes } = opts;
  const expr = METRIC_SQL[metric];
  const params: (string | number)[] = [];

  let where = "";
  if (mediaTypes && mediaTypes.size > 0) {
    where = `WHERE m.media_type IN (${Array.from(mediaTypes).map(() => "?").join(",")})`;
    params.push(...Array.from(mediaTypes));
  }

  let limitSql = "";
  if (limit !== undefined) {
    limitSql = "LIMIT ?";
    params.push(limit);
  }

  const rows = getCacheDb()
    .prepare(
      `SELECT m.*, ${expr} AS metric_value
         FROM media m LEFT JOIN media_insights mi ON mi.media_id = m.media_id
         ${where}
        ORDER BY metric_value DESC, m.timestamp DESC ${limitSql}`
    )
    .all(...params) as (MediaRow & { metric_value: number })[];

  return rows.map((r) => ({
    media: rowToMedia(r),
    insights: getCachedInsights(r.media_id),
    metricValue: r.metric_value,
  }));
}

export interface PostsSummary {
  total: number;
  byType: Record<string, number>;
  totals: {
    likes: number;
    comments: number;
    reach: number;
    views: number;
    saved: number;
    shares: number;
  };
}

export function getPostsSummary(mediaTypes?: Set<string>): PostsSummary {
  const params: string[] = [];
  let where = "";
  if (mediaTypes && mediaTypes.size > 0) {
    where = `WHERE m.media_type IN (${Array.from(mediaTypes).map(() => "?").join(",")})`;
    params.push(...Array.from(mediaTypes));
  }
  const db = getCacheDb();

  const totalsRow = db
    .prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(COALESCE(mi.likes, m.like_count, 0)), 0)      AS likes,
              COALESCE(SUM(COALESCE(mi.comments, m.comments_count, 0)), 0) AS comments,
              COALESCE(SUM(COALESCE(mi.reach, 0)), 0)  AS reach,
              COALESCE(SUM(COALESCE(mi.views, 0)), 0)  AS views,
              COALESCE(SUM(COALESCE(mi.saved, 0)), 0)  AS saved,
              COALESCE(SUM(COALESCE(mi.shares, 0)), 0) AS shares
         FROM media m LEFT JOIN media_insights mi ON mi.media_id = m.media_id
         ${where}`
    )
    .get(...params) as {
    total: number;
    likes: number;
    comments: number;
    reach: number;
    views: number;
    saved: number;
    shares: number;
  };

  const typeRows = db
    .prepare(
      `SELECT media_type, COUNT(*) AS n FROM media m ${where} GROUP BY media_type`
    )
    .all(...params) as { media_type: string; n: number }[];

  const byType: Record<string, number> = {};
  for (const r of typeRows) byType[r.media_type] = r.n;

  return {
    total: totalsRow.total,
    byType,
    totals: {
      likes: totalsRow.likes,
      comments: totalsRow.comments,
      reach: totalsRow.reach,
      views: totalsRow.views,
      saved: totalsRow.saved,
      shares: totalsRow.shares,
    },
  };
}
