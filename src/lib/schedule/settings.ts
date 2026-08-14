/**
 * Scheduler settings, backed by the `app_settings` key/value table.
 *
 * The display timezone lives here rather than in `.env` (where the transcription
 * toggle and API credentials live) for one reason: changing it silently changes
 * what every scheduled slot *means*, so it has to take effect immediately rather
 * than at the next restart of a production server we're told not to restart.
 *
 * The posting-policy settings below are here for the same reason. The split is
 * deliberate and worth keeping: `.env` holds operational switches (the kill
 * switch, dry run, storage ceilings, credentials) where needing a restart is a
 * feature; this table holds decisions about *how you post*, which you tune.
 *
 * Server-side only.
 */

import { config } from "@/lib/config";
import { getSetting, setSetting, getBoolSetting, setBoolSetting } from "@/lib/settings";
import { isValidTimeZone, systemTimeZone } from "./tz";

const TZ_KEY = "calendar.timezone";
const SUGGESTED_TIMES_KEY = "calendar.suggested_times";
const MAX_PER_DAY_KEY = "calendar.max_posts_per_day";
const MIN_SAME_VIDEO_DAYS_KEY = "calendar.min_same_video_days";
const PAUSED_KEY = "scheduler.paused";
const DRY_RUN_KEY = "scheduler.dry_run";

export { getSetting, setSetting };

/** Times of day slots are offered at, in preference order. */
const DEFAULT_SUGGESTED_TIMES = ["09:30"];
/** Ceiling on posts per calendar day. Enforced at booking, not advisory. */
const DEFAULT_MAX_POSTS_PER_DAY = 2;
/**
 * Days two hooks of the *same* video are kept apart. Different videos are
 * unaffected — they are not near-duplicates of each other, so they may share a
 * day up to the daily cap.
 */
const DEFAULT_MIN_SAME_VIDEO_DAYS = 2;

/** "HH:MM", 24-hour. */
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidTimeOfDay(value: string): boolean {
  return TIME_PATTERN.test(value.trim());
}

// ─── Scheduler pause / dry run ───────────────────────────────────────────────

/**
 * Whether publishing is paused from the UI.
 *
 * This is stored rather than env-backed because the alternative is editing
 * `.env` and restarting, and on this deployment restarting the server is the one
 * thing we're told not to do. Without it there is no way to stop the scheduler
 * at all.
 *
 * It composes with `SCHEDULER_ENABLED` rather than replacing it, and the
 * direction is deliberate: see `schedulerEnabled()` in `worker.ts`. A stored
 * value can pause publishing; it can never start publishing that `.env` has
 * disabled. The worst a corrupt row or a stray API call can do is stop posts
 * going out.
 */
export function isSchedulerPaused(): boolean {
  return getBoolSetting(PAUSED_KEY, false);
}

export function setSchedulerPaused(paused: boolean): void {
  setBoolSetting(PAUSED_KEY, paused);
}

/** Stored dry-run switch. ORs with SCHEDULE_DRY_RUN — either source can force it. */
export function isDryRunStored(): boolean {
  return getBoolSetting(DRY_RUN_KEY, false);
}

export function setDryRunStored(dryRun: boolean): void {
  setBoolSetting(DRY_RUN_KEY, dryRun);
}

/**
 * The effective gates, combining `.env` with the stored switches.
 *
 * They live here rather than in `worker.ts` so the composition can be tested on
 * its own: importing the worker drags in the entire publish stack, and a safety
 * property that is awkward to test is one nobody checks. `worker.ts` re-exports
 * these under its old names.
 */
export function schedulerEnabled(): boolean {
  // AND, so `.env` holds a veto the UI cannot override. Reversing this would let
  // a row in a database re-enable a scheduler that .env disabled, defeating the
  // kill switch entirely.
  return config.schedule.enabled && !isSchedulerPaused();
}

export function dryRunActive(): boolean {
  // OR, the mirror image: either source may force the safer behaviour, and
  // neither can cancel the other's decision to be safe.
  return config.schedule.dryRun || isDryRunStored();
}

/**
 * The zone the calendar renders in and bare `scheduled_at` strings are read in.
 * Falls back to SCHEDULE_TIMEZONE, then the host's own zone.
 */
export function getTimeZone(): string {
  const stored = getSetting(TZ_KEY);
  if (stored && isValidTimeZone(stored)) return stored;

  const fromEnv = config.schedule.timezone;
  if (fromEnv && isValidTimeZone(fromEnv)) return fromEnv;

  return systemTimeZone();
}

export function setTimeZone(tz: string): void {
  if (!isValidTimeZone(tz)) throw new Error(`Unknown timezone: ${tz}`);
  setSetting(TZ_KEY, tz);
}

/**
 * Times of day new slots are offered at, earliest preference first.
 *
 * More than one entry is how the account posts more than once a day: each is a
 * separate slot on the same date. It stays a *suggestion* — a caller may ask for
 * any time it likes — but `max_posts_per_day` is not negotiable.
 */
export function getSuggestedTimes(): string[] {
  const stored = getSetting(SUGGESTED_TIMES_KEY);
  if (!stored) return DEFAULT_SUGGESTED_TIMES;

  try {
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return DEFAULT_SUGGESTED_TIMES;
    const valid = parsed.filter((t): t is string => typeof t === "string" && isValidTimeOfDay(t));
    return valid.length ? sortTimes(valid) : DEFAULT_SUGGESTED_TIMES;
  } catch {
    return DEFAULT_SUGGESTED_TIMES;
  }
}

export function setSuggestedTimes(times: string[]): void {
  if (!times.length) throw new Error("At least one suggested time is required.");
  const bad = times.find((t) => !isValidTimeOfDay(t));
  if (bad) throw new Error(`Not a 24-hour HH:MM time: ${bad}`);

  const unique = sortTimes(Array.from(new Set(times.map((t) => t.trim()))));
  setSetting(SUGGESTED_TIMES_KEY, JSON.stringify(unique));
}

/**
 * Hard ceiling on posts per calendar day, counted in the display timezone.
 *
 * Enforced when a job is booked, not merely suggested — that is the whole point
 * of it. Counts everything on the day, including posts published outside the
 * scheduler, so it is a true statement about the account rather than about this
 * app's own bookings.
 */
export function getMaxPostsPerDay(): number {
  // Explicit null check: getSetting returns null when unset, and Number(null) is
  // 0, which sails through a bare numeric guard and silently becomes the answer.
  const stored = getSetting(MAX_PER_DAY_KEY);
  if (stored === null) return DEFAULT_MAX_POSTS_PER_DAY;

  const raw = Number(stored);
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_MAX_POSTS_PER_DAY;
}

export function setMaxPostsPerDay(value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error("max_posts_per_day must be a whole number of at least 1.");
  }
  setSetting(MAX_PER_DAY_KEY, String(value));
}

/** Days two hooks of the same video must be kept apart. */
export function getMinSameVideoDays(): number {
  // Same trap as above, and worse here: zero is a *legal* value meaning "no
  // spacing", so Number(null) === 0 would quietly disable the rule entirely.
  const stored = getSetting(MIN_SAME_VIDEO_DAYS_KEY);
  if (stored === null) return DEFAULT_MIN_SAME_VIDEO_DAYS;

  const raw = Number(stored);
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_MIN_SAME_VIDEO_DAYS;
}

export function setMinSameVideoDays(value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("min_same_video_days must be zero or more.");
  }
  setSetting(MIN_SAME_VIDEO_DAYS_KEY, String(value));
}

function sortTimes(times: string[]): string[] {
  return [...times].sort();
}
