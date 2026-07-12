// YouTube Data API v3 TypeScript types

// ─── Channel / Videos (our normalized shapes) ─────────────────────────────────

export interface YoutubeChannelStats {
  id: string;
  title: string;
  thumbnailUrl?: string;
  subscriberCount: number;
  viewCount: number;
  videoCount: number;
  /** "Uploads" playlist id — used to page recent videos without spending search quota. */
  uploadsPlaylistId?: string;
}

export interface YoutubeVideo {
  id: string;
  title: string;
  publishedAt: string;
  thumbnailUrl?: string;
  durationSeconds: number;
  /**
   * Heuristic only: the Data API v3 cannot distinguish Shorts from longform, so
   * we flag anything <= 180s. Not authoritative — real Shorts metrics need the
   * OAuth-gated Analytics API.
   */
  isLikelyShort: boolean;
  viewCount: number;
  likeCount: number;
  commentCount: number;
}

// ─── Raw API response shapes (subset of fields we request) ────────────────────

export interface YoutubeListResponse<T> {
  items?: T[];
  nextPageToken?: string;
  pageInfo?: { totalResults: number; resultsPerPage: number };
}

export interface YoutubeChannelItem {
  id: string;
  snippet?: {
    title?: string;
    thumbnails?: { default?: { url?: string }; medium?: { url?: string }; high?: { url?: string } };
  };
  statistics?: {
    subscriberCount?: string;
    viewCount?: string;
    videoCount?: string;
    hiddenSubscriberCount?: boolean;
  };
  contentDetails?: { relatedPlaylists?: { uploads?: string } };
}

export interface YoutubePlaylistItem {
  contentDetails?: { videoId?: string };
}

export interface YoutubeVideoItem {
  id: string;
  snippet?: {
    title?: string;
    publishedAt?: string;
    thumbnails?: { default?: { url?: string }; medium?: { url?: string }; high?: { url?: string } };
  };
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
  contentDetails?: { duration?: string };
}

// ─── API Errors ───────────────────────────────────────────────────────────────

export interface YoutubeApiErrorItem {
  domain?: string;
  reason?: string;
  message?: string;
}

export interface YoutubeApiErrorBody {
  code: number;
  message: string;
  errors?: YoutubeApiErrorItem[];
  status?: string;
}

export interface YoutubeApiError {
  error: YoutubeApiErrorBody;
}

export class YoutubeError extends Error {
  readonly code: number;
  readonly reason?: string;

  constructor(body: YoutubeApiErrorBody) {
    super(body.message);
    this.name = "YoutubeError";
    this.code = body.code;
    this.reason = body.errors?.[0]?.reason;
  }
}

export class YoutubeQuotaError extends Error {
  readonly reason: string;

  constructor(reason = "quotaExceeded") {
    super("YouTube Data API quota exceeded. Try again after the daily reset (Pacific midnight).");
    this.name = "YoutubeQuotaError";
    this.reason = reason;
  }
}
