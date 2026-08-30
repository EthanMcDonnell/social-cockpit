/**
 * Repost policy, backed by the `app_settings` key/value table.
 *
 * Here rather than in `.env` for the same reason the posting cadence is: these
 * are decisions about *how you post*, tuned from the app, and they have to take
 * effect without restarting a server we are told not to restart. `.env` keeps
 * the operational switches — the kill switch, dry run, storage ceilings — where
 * needing a restart is a feature.
 *
 * One thing is deliberately NOT here: the graduation strategy. Reposts publish
 * as trial reels that are promoted by hand, always, and that is a property of
 * what a repost *is* rather than a preference. A settings key would imply the
 * alternative is one toggle away; a constant in `lib/repost/publish.ts` says it
 * is not on offer.
 *
 * Server-side only.
 */

import { getSetting, setSetting, getBoolSetting, setBoolSetting } from "@/lib/settings";
import { isValidTimeOfDay } from "@/lib/schedule/settings";

const MIN_VIEWS_KEY = "repost.min_views";
const BLOCK_BELOW_KEY = "repost.block_below_views";
const MIN_GAP_DAYS_KEY = "repost.min_gap_days";
const EVALUATE_AFTER_KEY = "repost.evaluate_after_hours";
const TIMES_KEY = "repost.times_by_weekday";
const MAX_PER_WEEK_KEY = "repost.max_per_week";
const AUTOBOOK_KEY = "repost.autobook";
const HORIZON_KEY = "repost.horizon_days";

/** A video has to have genuinely worked before it is worth running again. */
export const DEFAULT_MIN_VIEWS = 20_000;
/** Below this, a repost is judged to have failed and the video is retired. */
export const DEFAULT_BLOCK_BELOW_VIEWS = 1_000;
/** How long before a video that has already been reposted may come round again. */
export const DEFAULT_MIN_GAP_DAYS = 30;
/** Long enough for a trial reel's views to mean something. */
export const DEFAULT_EVALUATE_AFTER_HOURS = 48;
export const DEFAULT_MAX_PER_WEEK = 3;
export const DEFAULT_HORIZON_DAYS = 14;

/**
 * Repost times, one list per weekday, Sunday first to match `Date.getDay()`.
 *
 * Deliberately staggered rather than the same clock reading seven times. A feed
 * that posts at exactly 12:30 every single day reads as automation to anyone
 * looking, and the whole point of a repost is that it should not announce
 * itself as one. The spread is small enough to stay inside the same part of the
 * day and so keep whatever the account's audience habits are.
 *
 * A day may hold no times at all, which simply means no repost is booked then.
 */
export const DEFAULT_TIMES_BY_WEEKDAY: string[][] = [
  ["13:15"], // Sun
  ["12:10"], // Mon
  ["13:35"], // Tue
  ["12:50"], // Wed
  ["14:05"], // Thu
  ["12:25"], // Fri
  ["11:40"], // Sat
];

export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * A stored whole number, or the fallback.
 *
 * The explicit null check matters: `getSetting` returns null when unset and
 * `Number(null)` is 0, which sails through a bare numeric guard and silently
 * becomes the answer — a `min_views` of 0 would make every video repostable.
 */
function intSetting(key: string, fallback: number, min: number): number {
  const stored = getSetting(key);
  if (stored === null) return fallback;
  const value = Number(stored);
  return Number.isInteger(value) && value >= min ? value : fallback;
}

function setIntSetting(key: string, value: number, min: number, label: string): void {
  if (!Number.isInteger(value) || value < min) {
    throw new Error(`${label} must be a whole number of at least ${min}.`);
  }
  setSetting(key, String(value));
}

// ─── Thresholds ──────────────────────────────────────────────────────────────

/** Views an original must have earned before it is worth reposting at all. */
export function getMinViews(): number {
  return intSetting(MIN_VIEWS_KEY, DEFAULT_MIN_VIEWS, 0);
}

export function setMinViews(value: number): void {
  setIntSetting(MIN_VIEWS_KEY, value, 0, "min_views");
}

/**
 * Views a repost must reach to avoid retiring its video.
 *
 * Read in two places, and they have to agree: the evaluator writes a block
 * below it, and the tier-2 gate re-checks the last repost against it. The
 * second is not redundant — it is what makes the rule hold for events recorded
 * before a threshold change, where no block was ever written.
 */
export function getBlockBelowViews(): number {
  return intSetting(BLOCK_BELOW_KEY, DEFAULT_BLOCK_BELOW_VIEWS, 0);
}

export function setBlockBelowViews(value: number): void {
  setIntSetting(BLOCK_BELOW_KEY, value, 0, "block_below_views");
}

/** How long a video must rest before a second (or third) repost. */
export function getMinGapDays(): number {
  return intSetting(MIN_GAP_DAYS_KEY, DEFAULT_MIN_GAP_DAYS, 1);
}

export function setMinGapDays(value: number): void {
  setIntSetting(MIN_GAP_DAYS_KEY, value, 1, "min_gap_days");
}

/** How long after a repost its views are judged. */
export function getEvaluateAfterHours(): number {
  return intSetting(EVALUATE_AFTER_KEY, DEFAULT_EVALUATE_AFTER_HOURS, 1);
}

export function setEvaluateAfterHours(value: number): void {
  setIntSetting(EVALUATE_AFTER_KEY, value, 1, "evaluate_after_hours");
}

// ─── Cadence ─────────────────────────────────────────────────────────────────

export function getTimesByWeekday(): string[][] {
  const stored = getSetting(TIMES_KEY);
  if (!stored) return DEFAULT_TIMES_BY_WEEKDAY.map((day) => [...day]);

  try {
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed) || parsed.length !== 7) {
      return DEFAULT_TIMES_BY_WEEKDAY.map((day) => [...day]);
    }
    return parsed.map((day) =>
      Array.isArray(day)
        ? day.filter((t): t is string => typeof t === "string" && isValidTimeOfDay(t)).sort()
        : []
    );
  } catch {
    return DEFAULT_TIMES_BY_WEEKDAY.map((day) => [...day]);
  }
}

/**
 * Seven entries, Sunday first. An empty day is legal and means "no repost that
 * day" — this is the only way to say it, so an empty array is never treated as
 * "unset" and quietly replaced by the defaults.
 */
export function setTimesByWeekday(times: string[][]): void {
  if (!Array.isArray(times) || times.length !== 7) {
    throw new Error("times_by_weekday must be 7 arrays, Sunday first.");
  }
  const cleaned = times.map((day, index) => {
    if (!Array.isArray(day)) throw new Error(`${WEEKDAY_LABELS[index]} must be an array of times.`);
    for (const time of day) {
      if (typeof time !== "string" || !isValidTimeOfDay(time)) {
        throw new Error(`Not a 24-hour HH:MM time on ${WEEKDAY_LABELS[index]}: ${time}`);
      }
    }
    return Array.from(new Set(day.map((t) => t.trim()))).sort();
  });
  setSetting(TIMES_KEY, JSON.stringify(cleaned));
}

export function getMaxPerWeek(): number {
  return intSetting(MAX_PER_WEEK_KEY, DEFAULT_MAX_PER_WEEK, 0);
}

export function setMaxPerWeek(value: number): void {
  setIntSetting(MAX_PER_WEEK_KEY, value, 0, "max_per_week");
}

export function getHorizonDays(): number {
  return intSetting(HORIZON_KEY, DEFAULT_HORIZON_DAYS, 1);
}

export function setHorizonDays(value: number): void {
  setIntSetting(HORIZON_KEY, value, 1, "horizon_days");
}

/**
 * Whether the app books repost slots itself.
 *
 * Defaults ON, but that is safe in a way it would not normally be: auto-booking
 * can only produce jobs against a slug in repost mode, and nothing is in repost
 * mode — nor opted in to reposting — until the user says so. With no repost
 * pool configured this setting does nothing at all.
 */
export function isAutobookEnabled(): boolean {
  return getBoolSetting(AUTOBOOK_KEY, true);
}

export function setAutobookEnabled(value: boolean): void {
  setBoolSetting(AUTOBOOK_KEY, value);
}

// ─── Bundle ──────────────────────────────────────────────────────────────────

export interface RepostSettings {
  min_views: number;
  block_below_views: number;
  min_gap_days: number;
  evaluate_after_hours: number;
  times_by_weekday: string[][];
  max_per_week: number;
  autobook: boolean;
  horizon_days: number;
}

export function getRepostSettings(): RepostSettings {
  return {
    min_views: getMinViews(),
    block_below_views: getBlockBelowViews(),
    min_gap_days: getMinGapDays(),
    evaluate_after_hours: getEvaluateAfterHours(),
    times_by_weekday: getTimesByWeekday(),
    max_per_week: getMaxPerWeek(),
    autobook: isAutobookEnabled(),
    horizon_days: getHorizonDays(),
  };
}
