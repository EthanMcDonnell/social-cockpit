/**
 * How often the automation worker re-checks a post's comments.
 *
 * Every targeted post used to be polled every 60s regardless of whether anyone
 * was still commenting on it. Most aren't: the bulk of matches land in a post's
 * first week, and a post nobody has touched in a month was costing 1,440
 * comment-list calls a day to find nothing. So a post's cadence follows its own
 * activity — quiet posts rest, and the first new comment wakes them back up.
 *
 * Resting is safe because nothing is lost by checking late. The comment cursor
 * walks back to the last comment handled, so a 60-minute gap means the DM goes
 * out later, not that the comment is skipped; and Instagram allows a private
 * reply for 7 days after the comment, far longer than the slowest tier.
 *
 * Pure on purpose: no database, no clock. The worker gathers the timestamps and
 * owns the in-memory "last polled" map; this only does the arithmetic.
 */

const DAY_MS = 24 * 60 * 60_000;

/**
 * Longest-quiet first. A post with no activity for `afterDays` is checked at
 * most every `intervalMs`. Anything more recent than the last tier is polled on
 * every worker tick.
 */
export const QUIET_TIERS: readonly { afterDays: number; intervalMs: number }[] = [
  { afterDays: 14, intervalMs: 60 * 60_000 },
  { afterDays: 3, intervalMs: 15 * 60_000 },
];

/**
 * The most recent of the given timestamps, in epoch ms, or null if none parse.
 *
 * "Activity" is whichever happened last: the newest comment handled (the
 * cursor), a flow being attached or activated on the post, or the post being
 * published. A flow added to an old post therefore wakes it immediately.
 */
export function lastActivityAt(timestamps: (string | null | undefined)[]): number | null {
  let latest: number | null = null;
  for (const ts of timestamps) {
    if (!ts) continue;
    const ms = Date.parse(ts);
    if (Number.isNaN(ms)) continue;
    if (latest === null || ms > latest) latest = ms;
  }
  return latest;
}

/**
 * Minimum gap between checks of a post, in ms. 0 means every tick.
 *
 * No known activity at all is treated as active rather than quiet: the safe
 * mistake is one extra call, not a post that silently rests from the start.
 */
export function pollIntervalFor(lastActivityMs: number | null, now: number): number {
  if (lastActivityMs === null) return 0;
  const quietMs = now - lastActivityMs;
  for (const tier of QUIET_TIERS) {
    if (quietMs >= tier.afterDays * DAY_MS) return tier.intervalMs;
  }
  return 0;
}

/** Whether a post last polled at `lastPolledAt` is due again at `now`. */
export function isDue(lastPolledAt: number | undefined, intervalMs: number, now: number): boolean {
  return lastPolledAt === undefined || now - lastPolledAt >= intervalMs;
}
