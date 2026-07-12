import { youtubeFetch } from "../client";
import type {
  YoutubeChannelStats,
  YoutubeChannelItem,
  YoutubeListResponse,
} from "../types";

/**
 * Fetch the configured channel's public statistics (subscribers, total views,
 * video count) plus its "uploads" playlist id for paging recent videos.
 * Costs 1 quota unit. Analog of instagram/endpoints/user.ts `getProfile`.
 */
export async function getChannelStats(): Promise<YoutubeChannelStats> {
  const channelId = process.env.YOUTUBE_CHANNEL_ID;
  if (!channelId) {
    throw new Error("YOUTUBE_CHANNEL_ID is not set. Add it to .env.");
  }

  const res = await youtubeFetch<YoutubeListResponse<YoutubeChannelItem>>(
    "/channels",
    { params: { part: "snippet,statistics,contentDetails", id: channelId } }
  );

  const item = res.items?.[0];
  if (!item) {
    throw new Error(`No YouTube channel found for id "${channelId}".`);
  }

  const thumbs = item.snippet?.thumbnails;
  return {
    id: item.id,
    title: item.snippet?.title ?? "",
    thumbnailUrl: thumbs?.high?.url ?? thumbs?.medium?.url ?? thumbs?.default?.url,
    subscriberCount: Number(item.statistics?.subscriberCount ?? 0),
    viewCount: Number(item.statistics?.viewCount ?? 0),
    videoCount: Number(item.statistics?.videoCount ?? 0),
    uploadsPlaylistId: item.contentDetails?.relatedPlaylists?.uploads,
  };
}
