/**
 * The subset of social-cockpit's wire types this server actually reads.
 *
 * Kept as a hand-written mirror of `src/lib/schedule/types.ts` rather than an
 * import: this package builds independently of the Next app, and importing
 * across the boundary would drag `@/` path aliases and the app's tsconfig in.
 * Only the fields used for formatting are listed.
 */

export type SchedulePlatform = "ig" | "yt";

export type ScheduleStatus =
  | "pending"
  | "publishing"
  | "finalizing"
  | "published"
  | "failed"
  | "missed"
  | "cancelled"
  | "paused";

export interface StagedMediaStatus {
  id: string;
  filename: string;
  missing: boolean;
  size_bytes: number;
}

export interface ScheduleResult {
  media_id?: string;
  /** Slug jobs: which candidate was chosen at fire time, and why. */
  slug_video_id?: string;
  slug_reason?: string;
  permalink?: string;
  video_id?: string;
  watch_url?: string;
  error?: string;
  error_kind?: string;
  dry_run?: boolean;
}

export interface ScheduledPostView {
  id: string;
  platform: SchedulePlatform;
  status: ScheduleStatus;
  /** Epoch ms, UTC. */
  scheduled_at: number;
  payload: { caption?: string; title?: string; media_type?: string } & Record<string, unknown>;
  /** Booked against a content pool rather than a file. */
  slug?: string;
  /** Runs from the slug's archive of published videos rather than its unposted files. */
  is_repost?: boolean;
  /** The method that will actually run, after the job → slug → default fallback. */
  selection_effective?: string;
  /** Empty on a slug job until the worker resolves its pool at fire time. */
  media: { role: string; staged_id: string }[];
  media_files: StagedMediaStatus[];
  media_missing: boolean;
  attempts: number;
  max_attempts: number;
  grace_minutes: number;
  automation?: { key?: string; trigger_keywords?: string[] };
  result?: ScheduleResult;
  created_at: string;
}

export interface ScheduleEvent {
  level: "info" | "warn" | "error";
  kind: string;
  message?: string;
  created_at: string;
}

export interface ScheduleSettings {
  timezone: string;
  abbreviation: string;
  scheduler_enabled: boolean;
  dry_run: boolean;
  /**
   * Posting policy, stored in the cockpit's `app_settings`.
   *
   * Optional because a cockpit running an older build won't return them; the
   * fallbacks in `policy()` keep this server working against one that doesn't.
   */
  suggested_times?: string[];
  max_posts_per_day?: number;
}

/** Posting policy with fallbacks applied — mirrors the cockpit's own defaults. */
export interface PostingPolicy {
  suggestedTimes: string[];
  maxPostsPerDay: number;
  /** True when the cockpit didn't supply policy, so these are local defaults. */
  fromDefaults: boolean;
}

export function policy(settings: ScheduleSettings): PostingPolicy {
  const times = settings.suggested_times?.length ? settings.suggested_times : undefined;
  return {
    suggestedTimes: times ?? ["09:30"],
    maxPostsPerDay: settings.max_posts_per_day ?? 2,
    fromDefaults: settings.max_posts_per_day == null && times === undefined,
  };
}

/** Mirrors `PostListItem` in `src/lib/posts.ts` (camelCase on the wire). */
export interface PostListItem {
  id: string;
  caption: string | null;
  mediaType: string;
  mediaProductType?: string;
  permalink?: string;
  timestamp: string;
  likeCount: number;
  commentsCount: number;
  insights: {
    reach?: number;
    likes?: number;
    comments?: number;
    shares?: number;
    saved?: number;
    views?: number;
    total_interactions?: number;
    ig_reels_avg_watch_time?: number;
  } | null;
}

/** Mirrors `PostsSummary` from `src/lib/cache/store.ts`. */
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

/**
 * Content pools. Mirrors the subset of `src/lib/slugs/types.ts` this server
 * formats — see `docs/slug-scheduling.md`.
 */

export type SelectionMethod =
  | "most_views"
  | "most_engagement"
  | "least_views"
  | "oldest_unposted"
  | "newest"
  | "random";

export interface SlugVideoView {
  id: string;
  path: string;
  filename: string;
  label?: string;
  /** The source file has been moved or deleted since it was enrolled. */
  missing: boolean;
  /** Summed across every platform this candidate has been posted to. */
  views?: number;
  /** Interactions per view, 0–1. Undefined when nothing is known. */
  engagement?: number;
  /** True when metrics were found for at least one of its posts. */
  scored: boolean;
  posts: { platform: SchedulePlatform; external_id: string; posted_at: string }[];
}

export interface SlugSummary {
  slug: string;
  name?: string;
  selection_method?: SelectionMethod;
  /**
   * Whether videos published under this slug may ever be reposted. Opt-in and
   * off by default — the mechanism for keeping time-dependent content (updates,
   * news) out of the repost rotation is simply never enabling it.
   */
  repost_eligible?: boolean;
  video_count: number;
  /** Candidates still eligible for each platform (not yet posted there). */
  eligible: Record<SchedulePlatform, number>;
  automation?: { flow_id: string; name: string; is_active: boolean };
}

export interface SlugListResponse {
  default_selection: SelectionMethod;
  slugs: SlugSummary[];
}

/** One archived video's standing in a repost pool. */
export interface RepostCandidateView {
  label: string;
  slug?: string;
  views?: number;
  last_reposted_at?: number;
  tier: 1 | 2 | null;
  eligible: boolean;
  why?: string;
  /** Present only when a previous repost underperformed. Never the same as `why: "not_enabled"`. */
  block?: { views?: number; blocked_at: string; reason: string };
}

export interface RepostPoolView {
  candidates: RepostCandidateView[];
  tier1: number;
  tier2: number;
  /** Held back only because their slug was never opted in — your decision, not a verdict. */
  awaiting_optin: number;
  /** Retired on measured performance. A different thing entirely. */
  blocked: number;
}

export interface SlugDetailResponse {
  slug: SlugSummary & { videos: SlugVideoView[] };
  /** The slug's archive of already-published videos, when it is opted in. */
  repost?: RepostPoolView | null;
  effective_method: SelectionMethod;
  /** The pick the worker would make right now, from the real selector. */
  next_up: { video: SlugVideoView; method: SelectionMethod; reason: string; considered: number } | null;
  /** Why the pool could not produce a candidate, when it could not. */
  blocked: { error: string; exhausted: boolean } | null;
}
