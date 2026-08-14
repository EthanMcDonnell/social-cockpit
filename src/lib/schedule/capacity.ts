/**
 * How full a calendar day already is.
 *
 * The daily cap is meant to be a true statement about the account — "this
 * account posts at most N times a day" — so it counts posts that never went
 * through the scheduler too. That means reading both stores:
 *
 * - `scheduled_posts` for anything booked here, including jobs that already
 *   published.
 * - the media cache for what actually appeared on the account, which is the
 *   only place a post made by hand or from the phone shows up.
 *
 * A job that has published appears in *both*, so its media id is subtracted from
 * the cache side. Without that, every scheduled post would count twice the
 * moment it went live and the cap would halve itself.
 *
 * Server-side only.
 */

import { getDb } from "@/lib/db";
import { getAllCachedMedia } from "@/lib/cache/store";
import { startOfDay, addDays } from "./tz";
import type { ScheduleResult } from "./types";

/** Statuses that represent a post that exists or is going to. */
const OCCUPYING_STATUSES = [
  "pending",
  "paused",
  "publishing",
  "finalizing",
  "published",
] as const;

export interface DayUsage {
  /** Start of the day, epoch ms, in the given zone. */
  dayStart: number;
  /** Total posts on the day, deduplicated across both sources. */
  total: number;
  /** Booked through the scheduler. */
  scheduled: number;
  /** Published, and not attributable to one of this day's jobs. */
  external: number;
}

/**
 * Posts already on the calendar day containing `instant`.
 *
 * `excludeJobId` lets a job be moved within its own day without counting itself
 * as an obstacle — otherwise rescheduling 09:30 → 18:00 on a full day would be
 * rejected by the very job being moved.
 */
export function usageForDay(
  instant: number,
  timeZone: string,
  excludeJobId?: string
): DayUsage {
  const dayStart = startOfDay(instant, timeZone);
  const dayEnd = addDays(dayStart, 1, timeZone);

  const placeholders = OCCUPYING_STATUSES.map(() => "?").join(",");
  const rows = getDb()
    .prepare(
      `SELECT id, result FROM scheduled_posts
        WHERE scheduled_at >= ? AND scheduled_at < ?
          AND status IN (${placeholders})`
    )
    .all(dayStart, dayEnd, ...OCCUPYING_STATUSES) as { id: string; result: string | null }[];

  const jobs = rows.filter((row) => row.id !== excludeJobId);

  // Media ids this day's jobs are responsible for — so the cache doesn't
  // double-count them.
  const ownMediaIds = new Set<string>();
  for (const row of jobs) {
    if (!row.result) continue;
    try {
      const parsed = JSON.parse(row.result) as ScheduleResult;
      if (parsed.media_id) ownMediaIds.add(parsed.media_id);
    } catch {
      // A result we can't parse just means no id to subtract.
    }
  }

  let external = 0;
  for (const media of getAllCachedMedia()) {
    const at = Date.parse(media.timestamp);
    if (!Number.isFinite(at) || at < dayStart || at >= dayEnd) continue;
    if (ownMediaIds.has(media.id)) continue;
    external++;
  }

  return {
    dayStart,
    scheduled: jobs.length,
    external,
    total: jobs.length + external,
  };
}

export interface CapCheck {
  allowed: boolean;
  usage: DayUsage;
  max: number;
  /** Human-readable reason, present only when rejected. */
  message?: string;
}

/** Whether one more post fits on the day containing `instant`. */
export function checkDailyCap(
  instant: number,
  timeZone: string,
  max: number,
  excludeJobId?: string
): CapCheck {
  const usage = usageForDay(instant, timeZone, excludeJobId);
  if (usage.total < max) return { allowed: true, usage, max };

  const date = new Date(usage.dayStart).toLocaleDateString("en-CA", { timeZone });
  const breakdown =
    usage.external > 0
      ? `${usage.scheduled} scheduled + ${usage.external} already published`
      : `${usage.scheduled} scheduled`;

  return {
    allowed: false,
    usage,
    max,
    message:
      `${date} already has ${usage.total} post(s) (${breakdown}), which is the limit of ${max} per day. ` +
      `Pick another day, or raise max_posts_per_day in the schedule settings.`,
  };
}
