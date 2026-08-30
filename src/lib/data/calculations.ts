import type { InstagramMedia, MediaInsights } from "@/lib/instagram/types";

export interface PostWithInsights {
  media: InstagramMedia;
  insights: MediaInsights;
  engagementRate: number;
}

/**
 * Calculates engagement rate for a single post.
 * engagement = (likes + comments + shares + saves) / reach
 * Falls back to total_interactions / reach if individual metrics unavailable.
 */
export function calcEngagementRate(
  insights: MediaInsights,
  followerCount?: number
): number {
  const reach = insights.reach ?? followerCount ?? 0;
  if (reach === 0) return 0;

  const interactions =
    insights.total_interactions ??
    (insights.likes ?? 0) +
      (insights.comments ?? 0) +
      (insights.shares ?? 0) +
      (insights.saved ?? 0);

  return interactions / reach;
}

/**
 * Ranks posts by engagement rate, descending. Returns top N.
 */
export function rankPostsByEngagement(
  posts: PostWithInsights[],
  limit = 5
): PostWithInsights[] {
  return [...posts]
    .sort((a, b) => b.engagementRate - a.engagementRate)
    .slice(0, limit);
}

/**
 * Calculates the average of a numeric metric across an array of insights.
 */
export function calcAvgMetric(
  insightsArray: MediaInsights[],
  metric: keyof Omit<MediaInsights, "mediaId">
): number {
  const values = insightsArray
    .map((i) => i[metric] as number | undefined)
    .filter((v): v is number => v !== undefined);

  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Sums a numeric metric across an array of insights.
 */
export function sumMetric(
  insightsArray: MediaInsights[],
  metric: keyof Omit<MediaInsights, "mediaId">
): number {
  return insightsArray.reduce(
    (sum, i) => sum + ((i[metric] as number | undefined) ?? 0),
    0
  );
}
