/**
 * Wire types for slug content pools, shared by the worker, the API routes, the
 * calendar composer, and the slugs page.
 *
 * `import type` only, so this module is erased at runtime and can be pulled into
 * the browser bundle without dragging better-sqlite3 along (same discipline as
 * src/lib/schedule/types.ts).
 */

import type { SchedulePlatform } from "@/lib/schedule/types";

/**
 * How a slug job picks its video when the slot arrives.
 *
 * Everything except `oldest_unposted`, `newest` and `random` needs metrics, and
 * metrics only exist for a candidate that has already been posted somewhere. A
 * candidate with no metrics is never discarded for that — it ranks below every
 * scored candidate and falls back to add order. A brand-new slug therefore still
 * posts on its first slot instead of failing at 3am.
 */
export type SelectionMethod =
  | "most_views"
  | "most_engagement"
  | "least_views"
  | "oldest_unposted"
  | "newest"
  | "random";

export const SELECTION_METHODS: SelectionMethod[] = [
  "most_views",
  "most_engagement",
  "least_views",
  "oldest_unposted",
  "newest",
  "random",
];

export const SELECTION_LABELS: Record<SelectionMethod, string> = {
  most_views: "Most views",
  most_engagement: "Most engagement",
  least_views: "Fewest views",
  oldest_unposted: "Oldest first",
  newest: "Newest first",
  random: "Random",
};

export const SELECTION_DESCRIPTIONS: Record<SelectionMethod, string> = {
  most_views: "The candidate whose existing posts have the most views.",
  most_engagement: "The candidate with the highest interactions-per-view rate.",
  least_views: "The candidate with the fewest views — give the underdog a second run.",
  oldest_unposted: "The candidate that has waited longest since it was added.",
  newest: "The most recently added candidate.",
  random: "Any eligible candidate, chosen at random.",
};

export function isSelectionMethod(value: unknown): value is SelectionMethod {
  return typeof value === "string" && (SELECTION_METHODS as string[]).includes(value);
}

/** Re-exported so route handlers can name a platform without reaching across. */
export type SchedulePlatformParam = SchedulePlatform;

/** Per-platform payload defaults stored against a candidate. */
export interface SlugVideoPayload {
  ig?: { caption?: string };
  yt?: { title?: string; description?: string; tags?: string[]; isShort?: boolean };
}

/** Where a candidate has already been posted. */
export interface SlugVideoPost {
  platform: SchedulePlatform;
  external_id: string;
  job_id?: string;
  posted_at: string;
}

export interface SlugVideo {
  id: string;
  /**
   * Insertion order, from the table's rowid.
   *
   * `created_at` cannot carry it: SQLite's `datetime('now')` has one-second
   * resolution, so a batch of videos added together all share a timestamp and
   * "oldest first" would fall through to whatever order the rows happened to
   * come back in. This is the tie-break that makes every method deterministic.
   */
  seq: number;
  slug: string;
  path: string;
  /** Display name. Defaults to the file's basename when unset. */
  label?: string;
  payload: SlugVideoPayload;
  /**
   * The preserved copy of this file, once one exists. What keeps the candidate
   * usable after the original is moved or deleted — see src/lib/archive.
   */
  archive_id?: string;
  created_at: string;
  posts: SlugVideoPost[];
}

/**
 * A post already published under a slug.
 *
 * Distinct from a candidate: this is something that exists on a platform, not a
 * file that can be posted. Pointing a candidate at one is how an established
 * account's history becomes rankable — see `slugPostHistory`.
 */
export interface SlugPost {
  platform: SchedulePlatform;
  external_id: string;
  /** First line of the caption, for recognising the post at a glance. */
  title?: string;
  thumbnail_url?: string;
  permalink?: string;
  posted_at?: string;
  views?: number;
  /** The pool candidate claiming this post, when one does. */
  linked_video_id?: string;
  linked_label?: string;
}

/** A candidate plus everything the pool view and the selector need to rank it. */
export interface SlugVideoView extends SlugVideo {
  filename: string;
  /** The source file has been moved or deleted since it was enrolled. */
  missing: boolean;
  /** Summed across every platform this candidate has been posted to. */
  views?: number;
  /** Interactions per view, 0–1. Undefined when nothing is known. */
  engagement?: number;
  /** True when metrics were found for at least one of its posts. */
  scored: boolean;
}

export interface Slug {
  slug: string;
  name?: string;
  /** Overrides the global default. Unset means "use the default". */
  selection_method?: SelectionMethod;
  /**
   * Whether videos published under this slug may ever be reposted.
   *
   * **Opt-in, and off by default.** This is a statement of intent — "this
   * content is evergreen" — and is the mechanism for keeping time-dependent
   * material (news, updates, anything dated) out of the rotation: such a slug
   * is simply never switched on.
   *
   * Do not conflate this with a video being blocked. A block lives in
   * `repost_blocks`, is written only by the evaluator from a measured view
   * count, and applies to one video rather than a whole slug. "I have not
   * enabled this" and "this one underperformed" are different answers and are
   * kept in different places so they cannot be reported as the same thing.
   */
  repost_eligible: boolean;
  created_at: string;
  updated_at: string;
}

/** A flow that fires on a slug, as the pool page needs to show it. */
export interface AutomationLink {
  flow_id: string;
  name: string;
  is_active: boolean;
}

export interface SlugSummary extends Slug {
  video_count: number;
  /** Candidates still eligible for each platform (not yet posted there). */
  eligible: Record<SchedulePlatform, number>;
  /** Every automation flow sharing this slug. Empty when nothing automates it. */
  automations: AutomationLink[];
}

export interface SlugDetail extends SlugSummary {
  videos: SlugVideoView[];
}

/** The outcome of running a selection against a pool. */
export interface SlugSelection {
  video: SlugVideoView;
  method: SelectionMethod;
  /** Human-readable "why this one", stored on the job and shown in the log. */
  reason: string;
  /** Candidates that were eligible at the moment of the pick. */
  considered: number;
  /**
   * Set only when the pick came from a repost pool.
   *
   * The worker branches on this for the two things a repost does differently:
   * it forces trial-reel parameters onto the payload, and it writes the repost
   * ledger instead of the ordinary pool ledger (a repost must not retire its
   * video from the platform's pool — it is the *same* post going out again).
   */
  repost?: { archive_id: string; tier: 1 | 2 };
}

/** Why a pool could not produce a candidate. */
export interface SlugSelectionFailure {
  error: string;
  /** The pool has candidates, but every one has already run on this platform. */
  exhausted: boolean;
}

export function isSelectionFailure(
  result: SlugSelection | SlugSelectionFailure
): result is SlugSelectionFailure {
  return "error" in result;
}
