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
  min_same_video_days?: number;
}

/** Posting policy with fallbacks applied — mirrors the cockpit's own defaults. */
export interface PostingPolicy {
  suggestedTimes: string[];
  maxPostsPerDay: number;
  minSameVideoDays: number;
  /** True when the cockpit didn't supply policy, so these are local defaults. */
  fromDefaults: boolean;
}

export function policy(settings: ScheduleSettings): PostingPolicy {
  const times = settings.suggested_times?.length ? settings.suggested_times : undefined;
  return {
    suggestedTimes: times ?? ["09:30"],
    maxPostsPerDay: settings.max_posts_per_day ?? 2,
    minSameVideoDays: settings.min_same_video_days ?? 2,
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
