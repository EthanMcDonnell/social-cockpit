/**
 * The repost ledger: what has been reposted, and what has been retired for
 * underperforming.
 *
 * Two tables, kept apart on purpose:
 *
 *   `repost_events` is the history — one row per repost that actually went out,
 *   carrying the deadline at which its views become worth reading.
 *
 *   `repost_blocks` is the verdict — written only by the evaluator, only from a
 *   measured view count. Nothing a user does in the UI writes here. Turning a
 *   slug's `repost_eligible` off holds its videos back without ever producing a
 *   block, so "I decided not to" and "this one flopped" remain distinguishable
 *   states rather than one grey "off".
 *
 * Server-side only.
 */

import { randomUUID } from "crypto";
import { getDb } from "@/lib/db";
import type { SchedulePlatform } from "@/lib/schedule/types";
import type { RepostBlock, RepostEvent, RepostOutcome } from "./types";

interface EventRow {
  id: string;
  archive_id: string;
  slug: string | null;
  platform: string;
  external_id: string;
  job_id: string | null;
  posted_at: string;
  evaluate_after: number;
  attempts: number;
  evaluated_at: string | null;
  views: number | null;
  outcome: string;
}

interface BlockRow {
  archive_id: string;
  reason: string;
  views: number | null;
  repost_event_id: string | null;
  blocked_at: string;
}

function rowToEvent(row: EventRow): RepostEvent {
  return {
    id: row.id,
    archive_id: row.archive_id,
    slug: row.slug ?? undefined,
    platform: row.platform as SchedulePlatform,
    external_id: row.external_id,
    job_id: row.job_id ?? undefined,
    posted_at: row.posted_at,
    evaluate_after: row.evaluate_after,
    attempts: row.attempts,
    evaluated_at: row.evaluated_at ?? undefined,
    views: row.views ?? undefined,
    outcome: row.outcome as RepostOutcome,
  };
}

function rowToBlock(row: BlockRow): RepostBlock {
  return {
    archive_id: row.archive_id,
    reason: row.reason,
    views: row.views ?? undefined,
    repost_event_id: row.repost_event_id ?? undefined,
    blocked_at: row.blocked_at,
  };
}

// ─── Events ──────────────────────────────────────────────────────────────────

export interface RecordRepostInput {
  archiveId: string;
  slug?: string;
  platform: SchedulePlatform;
  externalId: string;
  jobId?: string;
  /** Epoch ms at which this repost's views should be judged. */
  evaluateAfter: number;
}

/**
 * Record that a repost went out.
 *
 * Idempotent on (archive_id, platform, external_id), so a retried attach after
 * a publish that already succeeded cannot double-record — and, more importantly,
 * cannot reset an evaluation that has already run.
 */
export function recordRepost(input: RecordRepostInput): RepostEvent | null {
  const db = getDb();
  const write = db.transaction(() => {
    const existing = db
      .prepare(
        "SELECT * FROM repost_events WHERE archive_id = ? AND platform = ? AND external_id = ?"
      )
      .get(input.archiveId, input.platform, input.externalId) as EventRow | undefined;
    if (existing) return existing.id;

    const id = randomUUID();
    db.prepare(
      `INSERT INTO repost_events
         (id, archive_id, slug, platform, external_id, job_id, evaluate_after)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      input.archiveId,
      input.slug ?? null,
      input.platform,
      input.externalId,
      input.jobId ?? null,
      input.evaluateAfter
    );
    return id;
  });

  const id = write.immediate();
  return getRepostEvent(id);
}

export function getRepostEvent(id: string): RepostEvent | null {
  const row = getDb()
    .prepare("SELECT * FROM repost_events WHERE id = ?")
    .get(id) as EventRow | undefined;
  return row ? rowToEvent(row) : null;
}

/** Every repost of a set of videos, newest first, grouped by archive id. */
export function repostsFor(archiveIds: string[]): Map<string, RepostEvent[]> {
  const out = new Map<string, RepostEvent[]>();
  if (!archiveIds.length) return out;

  const rows = getDb()
    .prepare(
      `SELECT * FROM repost_events
        WHERE archive_id IN (${archiveIds.map(() => "?").join(",")})
        ORDER BY posted_at DESC`
    )
    .all(...archiveIds) as EventRow[];

  for (const row of rows) {
    const list = out.get(row.archive_id) ?? [];
    list.push(rowToEvent(row));
    out.set(row.archive_id, list);
  }
  return out;
}

/** Reposts whose views are due to be judged. */
export function claimEvaluable(now: number, limit = 25): RepostEvent[] {
  return (
    getDb()
      .prepare(
        `SELECT * FROM repost_events
          WHERE outcome = 'pending' AND evaluate_after <= ?
          ORDER BY evaluate_after ASC
          LIMIT ?`
      )
      .all(now, limit) as EventRow[]
  ).map(rowToEvent);
}

export function settleEvent(id: string, outcome: "ok" | "blocked", views: number): void {
  getDb()
    .prepare(
      `UPDATE repost_events
          SET outcome = ?, views = ?, evaluated_at = datetime('now'), attempts = attempts + 1
        WHERE id = ?`
    )
    .run(outcome, views, id);
}

/**
 * Views are not readable yet — try again after another window.
 *
 * Bounded by `attempts` at the call site rather than retried forever: a post
 * the cache will never carry (deleted, or made outside this app) would
 * otherwise be re-read on every housekeeping pass for the life of the install.
 */
export function deferEvent(id: string, nextAt: number): void {
  getDb()
    .prepare("UPDATE repost_events SET evaluate_after = ?, attempts = attempts + 1 WHERE id = ?")
    .run(nextAt, id);
}

/** Give up judging a repost, without retiring the video over it. */
export function abandonEvent(id: string): void {
  getDb()
    .prepare("UPDATE repost_events SET outcome = 'ok', evaluated_at = datetime('now') WHERE id = ?")
    .run(id);
}

// ─── Blocks ──────────────────────────────────────────────────────────────────

/**
 * Retire a video from reposting.
 *
 * Only ever called by the evaluator, from a measured view count, and the count
 * and its date are stored with it — a block that cannot say why it exists would
 * be indistinguishable from a slug that was never opted in, which is exactly
 * the confusion this design is built to avoid.
 */
export function blockVideo(
  archiveId: string,
  reason: string,
  views: number,
  eventId?: string
): void {
  getDb()
    .prepare(
      `INSERT INTO repost_blocks (archive_id, reason, views, repost_event_id)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(archive_id) DO UPDATE SET reason = excluded.reason,
                                             views = excluded.views,
                                             repost_event_id = excluded.repost_event_id,
                                             blocked_at = datetime('now')`
    )
    .run(archiveId, reason, views, eventId ?? null);
}

/** Put a retired video back in the running. Manual, from the Slugs page. */
export function unblockVideo(archiveId: string): boolean {
  return (
    getDb().prepare("DELETE FROM repost_blocks WHERE archive_id = ?").run(archiveId).changes > 0
  );
}

export function getBlock(archiveId: string): RepostBlock | null {
  const row = getDb()
    .prepare("SELECT * FROM repost_blocks WHERE archive_id = ?")
    .get(archiveId) as BlockRow | undefined;
  return row ? rowToBlock(row) : null;
}

export function blocksFor(archiveIds: string[]): Map<string, RepostBlock> {
  const out = new Map<string, RepostBlock>();
  if (!archiveIds.length) return out;

  const rows = getDb()
    .prepare(
      `SELECT * FROM repost_blocks WHERE archive_id IN (${archiveIds.map(() => "?").join(",")})`
    )
    .all(...archiveIds) as BlockRow[];

  for (const row of rows) out.set(row.archive_id, rowToBlock(row));
  return out;
}

export function listBlocks(): RepostBlock[] {
  return (
    getDb()
      .prepare("SELECT * FROM repost_blocks ORDER BY blocked_at DESC")
      .all() as BlockRow[]
  ).map(rowToBlock);
}

// ─── Auto-booking ledger ─────────────────────────────────────────────────────

/**
 * Instants auto-booking has already claimed.
 *
 * The row deliberately outlives the job it created. Deleting an auto-booked
 * slot on the calendar has to mean "not that one" — without this, the next
 * housekeeping pass would see an empty slot and helpfully put it straight back.
 */
export function recordAutobooked(scheduledAt: number, slug: string, jobId: string): void {
  getDb()
    .prepare(
      `INSERT INTO repost_autobook (scheduled_at, slug, job_id) VALUES (?, ?, ?)
         ON CONFLICT(scheduled_at) DO NOTHING`
    )
    .run(scheduledAt, slug, jobId);
}

export function autobookedInstants(from: number, to: number): Set<number> {
  const rows = getDb()
    .prepare("SELECT scheduled_at FROM repost_autobook WHERE scheduled_at >= ? AND scheduled_at < ?")
    .all(from, to) as { scheduled_at: number }[];
  return new Set(rows.map((row) => row.scheduled_at));
}

/** Drop ledger rows for instants long past, so the table does not grow forever. */
export function cullAutobookLedger(before: number): void {
  getDb().prepare("DELETE FROM repost_autobook WHERE scheduled_at < ?").run(before);
}
