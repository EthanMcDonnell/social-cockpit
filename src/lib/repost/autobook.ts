/**
 * Keep the calendar topped up with repost slots.
 *
 * A repost pool that has to be booked by hand is a repost pool that quietly
 * stops running the week you get busy, which defeats the point of it. This walks
 * forward over the configured horizon and books a job against the repost slug
 * for every repost time that is not yet spoken for.
 *
 * Three rules keep it from being annoying:
 *
 *   It never overbooks. Every insert goes through `createJobWithinScheduledCap`,
 *   the same path the API uses, so the account-wide `max_posts_per_day` and the
 *   exact-instant collision check both still apply. A day already full of fresh
 *   content simply gets no repost.
 *
 *   It never resurrects. Every instant it books is recorded in `repost_autobook`
 *   and that row outlives the job, so deleting an auto-booked slot on the
 *   calendar means "not that one" rather than "put it back in thirty seconds".
 *
 *   It never books blind. If the pool has nothing eligible, no slot is created —
 *   an empty slot that fails at 3am is worse than no slot.
 *
 * Server-side only.
 */

import { getDb } from "@/lib/db";
import { logScheduleEvent, createJobWithinScheduledCap } from "@/lib/schedule/store";
import { checkDailyCap } from "@/lib/schedule/capacity";
import { getMaxPostsPerDay, getTimeZone } from "@/lib/schedule/settings";
import { addDays, dayOfWeek, startOfDay, wallToUtc, utcToWall } from "@/lib/schedule/tz";
import { reportWarn } from "@/lib/observability";
import { repostCandidates, rankCandidates } from "./candidates";
import type { SchedulePlatform } from "@/lib/schedule/types";
import { autobookedInstants, cullAutobookLedger, recordAutobooked } from "./store";
import {
  getHorizonDays,
  getMaxPerWeek,
  getTimesByWeekday,
  isAutobookEnabled,
} from "./settings";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Ledger rows older than this are of no further use. */
const LEDGER_RETENTION_DAYS = 60;

/**
 * The topics with something worth reposting, best first, one entry per video.
 *
 * A topic appears once per eligible candidate it holds, so a slug with two
 * archived cuts can legitimately take two slots in a horizon while one with a
 * single cut takes one. Booking the same topic more often than it has material
 * would leave the later slot resolving to nothing at fire time.
 */
async function bookableTopics(platform: SchedulePlatform): Promise<string[]> {
  const ranked = rankCandidates(await repostCandidates(platform));
  return ranked
    .map((candidate) => candidate.archive.origin_slug)
    .filter((slug): slug is string => Boolean(slug));
}

export interface AutobookSummary {
  booked: number;
  skipped: number;
}

export async function autobookReposts(now = Date.now()): Promise<AutobookSummary> {
  const summary: AutobookSummary = { booked: 0, skipped: 0 };
  if (!isAutobookEnabled()) return summary;

  cullAutobookLedger(now - LEDGER_RETENTION_DAYS * DAY_MS);

  const timeZone = getTimeZone();
  const times = getTimesByWeekday();
  if (times.every((day) => day.length === 0)) return summary;

  const horizon = getHorizonDays();
  const from = startOfDay(now, timeZone);
  const to = addDays(from, horizon + 1, timeZone);
  const claimed = autobookedInstants(from, to);

  // Resolved once for the whole pass rather than per slot: this reads insights
  // for every archived video, and the answer cannot meaningfully change between
  // two slots booked in the same second.
  //
  // Consumed as a queue. Each slot takes the next topic down the ranking, so a
  // pass books the best material first and never gives one topic more slots
  // than it has eligible videos.
  const topics = await bookableTopics("ig");
  if (!topics.length) return summary;
  let next = 0;

  const maxPerWeek = getMaxPerWeek();
  let bookedThisPass = 0;

  for (let offset = 0; offset <= horizon; offset++) {
    const dayStart = addDays(from, offset, timeZone);
    const weekday = dayOfWeek(dayStart, timeZone);
    const slots = times[weekday] ?? [];
    if (!slots.length) continue;

    for (const time of slots) {
      // Never book into the past — a slot earlier today has already gone.
      const instant = instantFor(dayStart, time, timeZone);
      if (instant <= now) continue;
      if (claimed.has(instant)) continue;

      // Out of material — the remaining slots stay empty rather than being
      // booked against a topic that cannot fill them. Read without consuming:
      // a slot skipped by a cap below must not burn the topic it would have had.
      if (next >= topics.length) return summary;
      const slug = topics[next];

      // The cap is a rolling seven days from now, not a calendar week, so the
      // rate holds no matter which day the pass happens to run on.
      if (maxPerWeek > 0 && bookedThisPass + existingInWeek(instant) >= maxPerWeek) {
        summary.skipped += 1;
        continue;
      }

      const cap = checkDailyCap(instant, timeZone, getMaxPostsPerDay());
      if (!cap.allowed) {
        summary.skipped += 1;
        continue;
      }

      const job = createJobWithinScheduledCap(
        {
          platform: "ig",
          scheduledAt: instant,
          // Empty payload and media: this is a slug job, and the worker
          // resolves both at fire time. Identical in shape to a slug slot
          // booked by hand from the calendar.
          payload: {} as never,
          media: [],
          slug,
          isRepost: true,
        },
        cap.usage.dayStart,
        addDays(cap.usage.dayStart, 1, timeZone),
        cap.max - cap.usage.external
      );

      if (!job) {
        summary.skipped += 1;
        continue;
      }

      recordAutobooked(instant, slug, job.id);
      claimed.add(instant);
      next += 1;
      bookedThisPass += 1;
      summary.booked += 1;

      logScheduleEvent(
        "info",
        "repost_autobooked",
        `Booked a repost slot for ${new Date(instant).toISOString()}`,
        { jobId: job.id, meta: { slug, scheduled_at: instant } }
      );
    }
  }

  return summary;
}

/**
 * Repost jobs already on the calendar in the seven days around an instant.
 *
 * Counted across every topic, not per slug: `max_per_week` is a ceiling on how
 * often the account repeats itself, and three reposts in a week are three
 * reposts whether they are three topics or one.
 */
function existingInWeek(instant: number): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS count FROM scheduled_posts
        WHERE is_repost = 1 AND scheduled_at >= ? AND scheduled_at < ?
          AND status IN ('pending','paused','publishing','finalizing','published')`
    )
    .get(instant - 7 * DAY_MS, instant + 7 * DAY_MS) as { count: number };
  return row.count;
}

/**
 * The UTC instant for a wall-clock time on a given local day.
 *
 * Built from the day's own wall-clock fields rather than by adding minutes to
 * `dayStart`, so a slot lands at the stated local time across a DST boundary
 * instead of drifting an hour.
 */
function instantFor(dayStart: number, time: string, timeZone: string): number {
  const [hour, minute] = time.split(":").map(Number);
  const wall = utcToWall(dayStart, timeZone);
  return wallToUtc({ ...wall, hour, minute, second: 0 }, timeZone);
}
