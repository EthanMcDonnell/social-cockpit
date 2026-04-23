import { instagramFetch } from "../client";
import type {
  InsightsResponse,
  InsightMetric,
  InsightPeriod,
  MediaInsightMetric,
  UserInsightMetric,
  MediaInsights,
} from "../types";

const DEFAULT_MEDIA_METRICS: MediaInsightMetric[] = [
  "reach",
  "likes",
  "comments",
  "shares",
  "saved",
  "views",
  "total_interactions",
  "ig_reels_avg_watch_time",
  "ig_reels_video_view_total_time",
];

const DEFAULT_USER_METRICS: UserInsightMetric[] = [
  "reach",
  "profile_views",
  "follower_count",
  "accounts_engaged",
  "total_interactions",
];

export async function getMediaInsights(
  mediaId: string,
  metrics: MediaInsightMetric[] = DEFAULT_MEDIA_METRICS
): Promise<InsightsResponse> {
  return instagramFetch<InsightsResponse>(`/${mediaId}/insights`, {
    params: { metric: metrics.join(",") },
  });
}

/**
 * Get media insights and return them as a flat MediaInsights object.
 */
export async function getMediaInsightsFlat(
  mediaId: string,
  metrics: MediaInsightMetric[] = DEFAULT_MEDIA_METRICS
): Promise<MediaInsights> {
  const response = await getMediaInsights(mediaId, metrics);
  const result: MediaInsights = { mediaId };

  for (const metric of response.data) {
    const name = metric.name as keyof Omit<MediaInsights, "mediaId">;
    // Lifetime metrics have a single value, not an array of time-series values
    const value =
      metric.values?.[0]?.value ?? (metric as unknown as { value?: number }).value;
    if (value !== undefined) {
      (result as unknown as Record<string, unknown>)[name] = value;
    }
  }

  return result;
}

export async function getUserInsights(
  period: InsightPeriod = "day",
  metrics: UserInsightMetric[] = DEFAULT_USER_METRICS,
  since?: string,
  until?: string
): Promise<InsightsResponse> {
  const accountId = process.env.INSTAGRAM_ACCOUNT_ID;
  if (!accountId) {
    throw new Error("INSTAGRAM_ACCOUNT_ID is not set. Add it to .env.local.");
  }

  const params: Record<string, string | number | undefined> = {
    metric: metrics.join(","),
    period,
    since,
    until,
  };

  return instagramFetch<InsightsResponse>(`/${accountId}/insights`, {
    params,
  });
}

export type { InsightMetric, InsightsResponse };
