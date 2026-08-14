import { youtubeFetch } from "../client";
import { config } from "@/lib/config";
import { getChannelStats } from "./channel";
import type {
  YoutubeVideo,
  YoutubeVideoItem,
  YoutubePlaylistItem,
  YoutubeListResponse,
} from "../types";

const SHORT_MAX_SECONDS = 180;

// Parse an ISO-8601 duration (e.g. "PT1H2M30S", "PT45S") to seconds.
function parseIsoDuration(iso: string | undefined): number {
  if (!iso) return 0;
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!m) return 0;
  const [, h, min, s] = m;
  return Number(h ?? 0) * 3600 + Number(min ?? 0) * 60 + Number(s ?? 0);
}

/**
 * Fetch the channel's most recent videos with public stats.
 * Uses the uploads playlist (1 unit) rather than search.list (100 units), then a
 * single videos.list (1 unit) for stats. Analog of instagram/endpoints/insights.
 * `limit` is capped at 50 (one videos.list page).
 */
export async function getRecentVideos(limit = 25): Promise<YoutubeVideo[]> {
  const capped = Math.min(Math.max(limit, 1), 50);

  const uploads = config.youtube.uploadsPlaylistId
    ?? (await getChannelStats()).uploadsPlaylistId;
  if (!uploads) {
    throw new Error("Could not resolve the channel's uploads playlist id.");
  }

  const playlist = await youtubeFetch<YoutubeListResponse<YoutubePlaylistItem>>(
    "/playlistItems",
    { params: { part: "contentDetails", playlistId: uploads, maxResults: capped } }
  );

  const videoIds = (playlist.items ?? [])
    .map((it) => it.contentDetails?.videoId)
    .filter((id): id is string => Boolean(id));
  if (videoIds.length === 0) return [];

  const videos = await youtubeFetch<YoutubeListResponse<YoutubeVideoItem>>(
    "/videos",
    { params: { part: "snippet,statistics,contentDetails", id: videoIds.join(",") } }
  );

  return (videos.items ?? []).map((v) => {
    const thumbs = v.snippet?.thumbnails;
    const durationSeconds = parseIsoDuration(v.contentDetails?.duration);
    return {
      id: v.id,
      title: v.snippet?.title ?? "",
      publishedAt: v.snippet?.publishedAt ?? "",
      thumbnailUrl: thumbs?.medium?.url ?? thumbs?.default?.url ?? thumbs?.high?.url,
      durationSeconds,
      isLikelyShort: durationSeconds > 0 && durationSeconds <= SHORT_MAX_SECONDS,
      viewCount: Number(v.statistics?.viewCount ?? 0),
      likeCount: Number(v.statistics?.likeCount ?? 0),
      commentCount: Number(v.statistics?.commentCount ?? 0),
    };
  });
}
