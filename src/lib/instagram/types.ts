// Instagram Graph API v25.0 TypeScript types

// ─── Pagination ───────────────────────────────────────────────────────────────

export interface PagingCursors {
  before: string;
  after: string;
}

export interface Paging {
  cursors?: PagingCursors;
  next?: string;
  previous?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  paging?: Paging;
}

// ─── User / Profile ───────────────────────────────────────────────────────────

export type AccountType = "BUSINESS" | "MEDIA_CREATOR" | "PERSONAL";

export interface InstagramProfile {
  id: string;
  username: string;
  name?: string;
  biography?: string;
  followers_count?: number;
  media_count?: number;
  profile_picture_url?: string;
  website?: string;
  account_type?: AccountType;
}

// ─── Media ────────────────────────────────────────────────────────────────────

export type MediaType = "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM" | "REEL";
export type MediaProductType = "AD" | "FEED" | "IGTV" | "REELS" | "STORY";

export interface InstagramMedia {
  id: string;
  caption?: string;
  media_type: MediaType;
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
  timestamp: string;
  like_count?: number;
  comments_count?: number;
  shortcode?: string;
  ig_id?: string;
  is_comment_enabled?: boolean;
  media_product_type?: MediaProductType;
  owner?: { id: string };
  username?: string;
  children?: PaginatedResponse<{ id: string }>;
}

export type MediaListResponse = PaginatedResponse<InstagramMedia>;

// ─── Insights ─────────────────────────────────────────────────────────────────

export type InsightPeriod = "day" | "week" | "month" | "lifetime";

export interface InsightValue {
  value: number;
  end_time?: string;
}

export interface InsightMetric {
  id: string;
  name: string;
  period: InsightPeriod;
  values?: InsightValue[];
  title?: string;
  description?: string;
}

export interface InsightsResponse {
  data: InsightMetric[];
  paging?: Paging;
}

// Media-level insight metrics
export type MediaInsightMetric =
  | "reach"
  | "likes"
  | "comments"
  | "shares"
  | "saved"
  | "views"
  | "total_interactions"
  | "ig_reels_avg_watch_time"
  | "ig_reels_video_view_total_time";

// User-level insight metrics
export type UserInsightMetric =
  | "reach"
  | "profile_views"
  | "follower_count"
  | "accounts_engaged"
  | "total_interactions"
  | "impressions"
  | "website_clicks"
  | "email_contacts"
  | "get_directions_clicks"
  | "phone_call_clicks"
  | "text_message_clicks";

export interface MediaInsights {
  mediaId: string;
  reach?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saved?: number;
  views?: number;
  total_interactions?: number;
  ig_reels_avg_watch_time?: number;
  ig_reels_video_view_total_time?: number;
}

// ─── Comments ─────────────────────────────────────────────────────────────────

export interface InstagramComment {
  id: string;
  text: string;
  timestamp: string;
  username?: string;
  like_count?: number;
  hidden?: boolean;
  from?: { id: string; username?: string };
  replies?: PaginatedResponse<InstagramComment>;
}

export type CommentListResponse = PaginatedResponse<InstagramComment>;

// ─── Rate Limit ───────────────────────────────────────────────────────────────

export interface AppUsage {
  call_count: number;
  cpu_time: number;
  total_time: number;
}

export interface RateLimitInfo {
  usage: AppUsage | null;
  isThrottled: boolean;
  throttledField?: keyof AppUsage;
}

// ─── API Errors ───────────────────────────────────────────────────────────────

export interface InstagramApiErrorBody {
  message: string;
  type: string;
  code: number;
  error_subcode?: number;
  fbtrace_id?: string;
}

export interface InstagramApiError {
  error: InstagramApiErrorBody;
}

export class InstagramError extends Error {
  readonly code: number;
  readonly type: string;
  readonly subcode?: number;

  constructor(body: InstagramApiErrorBody) {
    super(body.message);
    this.name = "InstagramError";
    this.code = body.code;
    this.type = body.type;
    this.subcode = body.error_subcode;
  }
}

/**
 * True for the terminal "media no longer exists / not accessible" error
 * (Graph code 100, subcode 33) — a deleted post or lost access. Retrying can
 * never succeed, so callers should stop hitting the API for this object and
 * tombstone it instead.
 */
export function isMediaGoneError(err: unknown): err is InstagramError {
  return err instanceof InstagramError && err.code === 100 && err.subcode === 33;
}

export class RateLimitError extends Error {
  readonly usage: AppUsage;

  constructor(usage: AppUsage) {
    super("Instagram API rate limit reached (≥90%). Try again shortly.");
    this.name = "RateLimitError";
    this.usage = usage;
  }
}
