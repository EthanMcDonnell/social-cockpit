/**
 * Wire types for reposting, shared by the worker, the API routes and the UI.
 *
 * Types plus two lookup tables, and nothing else — every import here is
 * `import type`, so this module carries no runtime dependency on the database
 * layer and can be pulled into the browser bundle safely (same discipline as
 * src/lib/slugs/types.ts, which also ships its labels this way).
 */

import type { SchedulePlatform } from "@/lib/schedule/types";
import type { SlugVideoPayload } from "@/lib/slugs/types";
import type { ArchivedVideo } from "@/lib/archive/types";

/** How a repost turned out, once its views have been read. */
export type RepostOutcome = "pending" | "ok" | "blocked";

export interface RepostEvent {
  id: string;
  archive_id: string;
  slug?: string;
  platform: SchedulePlatform;
  external_id: string;
  job_id?: string;
  posted_at: string;
  /** Epoch ms — when this repost's views become worth reading. */
  evaluate_after: number;
  attempts: number;
  evaluated_at?: string;
  views?: number;
  outcome: RepostOutcome;
}

/**
 * A video retired because its repost underperformed.
 *
 * Emphatically NOT the same thing as a slug whose `repost_eligible` is off.
 * That is a user's decision about what may run again; this is the app reporting
 * a measurement. They are separate tables at separate scopes precisely so no
 * query or component can collapse them into one ambiguous "disabled" — and a
 * block always carries the number and date that produced it, which is what
 * makes it self-explanatory wherever it surfaces.
 */
export interface RepostBlock {
  archive_id: string;
  reason: string;
  views?: number;
  repost_event_id?: string;
  blocked_at: string;
}

/**
 * Why a video is or is not in the running.
 *
 * Ordered roughly by how interesting it is to a person reading the pool: the
 * reasons that are somebody's decision come first, the mechanical ones last.
 */
export type RepostIneligibility =
  /** Its slug has not been opted in — the default state, not a judgement. */
  | "not_enabled"
  /** No slug at all, so there is nothing to opt in. */
  | "no_slug"
  /** A previous repost underperformed. The only performance-based exclusion. */
  | "blocked"
  /** The original never cleared the minimum view count. */
  | "below_min_views"
  /** Reposted too recently to come round again. */
  | "resting"
  /** Never published on this platform, so there is nothing to repost here. */
  | "not_posted_here"
  /** The archived file is gone from disk. */
  | "missing"
  /** No view figures yet, so it cannot be judged against the threshold. */
  | "unscored";

export interface RepostCandidate {
  archive: ArchivedVideo;
  /** Display name — the candidate's label, else the archived file's basename. */
  label: string;
  /** The pool row linking this archived file to its posts, when one exists. */
  video_id?: string;
  /**
   * The caption/title this video published under, carried forward so a repost
   * does not go out blank when the slot itself supplies no payload.
   */
  payload: SlugVideoPayload;
  /** The slug it was published under, whose opt-in governs it. */
  slug?: string;
  /** Whether that slug is opted in to reposting. */
  slug_enabled: boolean;
  /** Summed across every platform this video has been posted to. */
  views?: number;
  scored: boolean;
  /** Reposts already made on this platform, newest first. */
  reposts: RepostEvent[];
  /** Epoch ms of the most recent repost, when there is one. */
  last_reposted_at?: number;
  /** Set only when a previous repost underperformed. */
  block?: RepostBlock;
  /**
   * 1 = never reposted, 2 = has been reposted and has rested long enough.
   * Null when not eligible at all. Tier 1 is always exhausted before tier 2.
   */
  tier: 1 | 2 | null;
  eligible: boolean;
  /** Absent when eligible. */
  why?: RepostIneligibility;
}

export const INELIGIBILITY_LABELS: Record<RepostIneligibility, string> = {
  not_enabled: "Reposting not enabled for this slug",
  no_slug: "Published without a slug, so it has no repost setting",
  blocked: "Blocked — a previous repost underperformed",
  below_min_views: "Below the minimum view count",
  resting: "Reposted too recently",
  not_posted_here: "Never published on this platform",
  missing: "Archived file is missing from disk",
  unscored: "No view figures yet",
};

/** What a repost pool would do right now, for the UI and the worker alike. */
export interface RepostPoolView {
  slug: string;
  platform: SchedulePlatform;
  candidates: RepostCandidate[];
  tier1: number;
  tier2: number;
  /** Videos held out only because their slug was never opted in. */
  awaiting_optin: number;
  /** Videos retired on measured performance. */
  blocked: number;
}
