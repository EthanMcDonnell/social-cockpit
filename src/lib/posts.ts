import type {
  InstagramMedia,
  MediaType,
  MediaProductType,
  MediaInsights,
} from "@/lib/instagram/types";
import type { Transcript, TranscriptSummary } from "@/lib/transcription/db";

// ─── Post shapes ─────────────────────────────────────────────────────────────

export interface PostBase {
  id: string;
  caption: string | null;
  mediaType: MediaType;
  mediaProductType?: MediaProductType;
  permalink?: string;
  thumbnailUrl?: string;
  timestamp: string;
  likeCount: number;
  commentsCount: number;
  shortcode?: string;
}

// "ready" = transcript stored; "pending" = a video with no transcript yet;
// "unsupported" = not a video/reel, so it can't be transcribed.
export type TranscriptStatus = "ready" | "pending" | "unsupported";

// Lightweight transcript info for list responses — preview only, no full text.
export interface PostTranscriptSummary {
  status: TranscriptStatus;
  language?: string | null;
  duration?: number | null;
  model?: string;
  charCount?: number;
  preview?: string;
  // Full transcript text — only populated when the caller asks (fullText=1).
  text?: string;
  createdAt?: string;
  // Link to the full transcript resource, present only when status === "ready".
  href?: string;
}

export interface PostListItem extends PostBase {
  insights: MediaInsights | null;
  transcript: PostTranscriptSummary;
}

// Full transcript (text + segments) for detail responses.
export interface PostDetail extends PostBase {
  transcript: {
    status: TranscriptStatus;
    data: Transcript | null;
  };
}

// ─── Builders ────────────────────────────────────────────────────────────────

function isVideo(media: InstagramMedia): boolean {
  return media.media_type === "VIDEO" || media.media_type === "REEL";
}

function transcriptStatus(media: InstagramMedia, hasTranscript: boolean): TranscriptStatus {
  if (hasTranscript) return "ready";
  return isVideo(media) ? "pending" : "unsupported";
}

function buildPostBase(media: InstagramMedia): PostBase {
  return {
    id: media.id,
    caption: media.caption ?? null,
    mediaType: media.media_type,
    mediaProductType: media.media_product_type,
    permalink: media.permalink,
    // Videos expose a poster image via thumbnail_url; images use media_url.
    thumbnailUrl: media.thumbnail_url ?? media.media_url,
    timestamp: media.timestamp,
    likeCount: media.like_count ?? 0,
    commentsCount: media.comments_count ?? 0,
    shortcode: media.shortcode,
  };
}

export function toPostListItem(
  media: InstagramMedia,
  summary: TranscriptSummary | undefined,
  insights: MediaInsights | null = null
): PostListItem {
  const transcript: PostTranscriptSummary = summary
    ? {
        status: "ready",
        language: summary.language,
        duration: summary.duration,
        model: summary.model,
        charCount: summary.charCount,
        preview: summary.preview,
        createdAt: summary.createdAt,
        href: `/api/transcripts/${media.id}`,
      }
    : { status: transcriptStatus(media, false) };

  return { ...buildPostBase(media), insights, transcript };
}

export function toPostDetail(
  media: InstagramMedia,
  transcript: Transcript | null
): PostDetail {
  return {
    ...buildPostBase(media),
    transcript: {
      status: transcriptStatus(media, !!transcript),
      data: transcript,
    },
  };
}
