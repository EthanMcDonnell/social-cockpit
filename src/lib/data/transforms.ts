import type { InsightsResponse, InstagramMedia, MediaInsights } from "@/lib/instagram/types";
import { formatChartDate } from "@/lib/utils/dates";
import { calcEngagementRate, type PostWithInsights } from "./calculations";

// ─── Chart Data Types ──────────────────────────────────────────────────────────

export interface TimeSeriesPoint {
  date: string;       // formatted for chart display, e.g. "Mar 15"
  isoDate: string;    // raw ISO string for tooltip / sorting
  value: number;
}

export interface MultiSeriesPoint {
  date: string;
  isoDate: string;
  [metric: string]: string | number;
}

// ─── Table Row Type ────────────────────────────────────────────────────────────

export interface PostTableRow {
  id: string;
  thumbnail: string | undefined;
  caption: string;
  mediaType: string;
  timestamp: string;
  isoTimestamp: string;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  reach: number;
  views: number;
  engagementRate: number;
}

// ─── Transforms ───────────────────────────────────────────────────────────────

/**
 * Converts a user InsightsResponse for a single metric into a time series array.
 * Used for FollowerChart, ReachChart, etc.
 */
export function userInsightsToTimeSeries(
  insights: InsightsResponse,
  metricName: string
): TimeSeriesPoint[] {
  const metric = insights.data.find((m) => m.name === metricName);
  if (!metric?.values) return [];

  return metric.values
    .filter((v) => v.end_time !== undefined)
    .map((v) => ({
      date: formatChartDate(v.end_time!),
      isoDate: v.end_time!,
      value: v.value,
    }))
    .sort((a, b) => a.isoDate.localeCompare(b.isoDate));
}

/**
 * Meta reports follower_count as a daily acquisition delta, while the profile
 * endpoint exposes the present total. Walk backwards from that total so every
 * consumer describes the same cumulative follower series.
 */
export function reconstructCumulativeTotals(
  deltas: TimeSeriesPoint[],
  currentTotal: number
): TimeSeriesPoint[] {
  if (!deltas.length) return [];

  const sorted = [...deltas].sort((a, b) => a.isoDate.localeCompare(b.isoDate));
  const totals = new Array<number>(sorted.length);
  totals[sorted.length - 1] = currentTotal;
  for (let i = sorted.length - 2; i >= 0; i--) {
    totals[i] = totals[i + 1] - sorted[i + 1].value;
  }

  return sorted.map((point, index) => ({ ...point, value: totals[index] }));
}

/**
 * Converts a user InsightsResponse with multiple metrics into a multi-series
 * array keyed by metric name. Used for EngagementChart (likes/comments/shares).
 */
export function userInsightsToMultiSeries(
  insights: InsightsResponse,
  metricNames: string[]
): MultiSeriesPoint[] {
  // Build a map: isoDate → { metric: value }
  const byDate = new Map<string, MultiSeriesPoint>();

  for (const metricName of metricNames) {
    const metric = insights.data.find((m) => m.name === metricName);
    if (!metric?.values) continue;

    for (const v of metric.values) {
      if (!v.end_time) continue;
      if (!byDate.has(v.end_time)) {
        byDate.set(v.end_time, {
          date: formatChartDate(v.end_time),
          isoDate: v.end_time,
        });
      }
      byDate.get(v.end_time)![metricName] = v.value;
    }
  }

  return Array.from(byDate.values()).sort((a, b) =>
    a.isoDate.localeCompare(b.isoDate)
  );
}

/**
 * Merges media + insights arrays into PostTableRow[] for the posts table/grid.
 * Requires that insightsMap keys are media IDs.
 */
export function mediaWithInsightsToTableRows(
  mediaList: InstagramMedia[],
  insightsMap: Map<string, MediaInsights>,
  followerCount?: number
): PostTableRow[] {
  return mediaList.map((media) => {
    const insights = insightsMap.get(media.id) ?? { mediaId: media.id };
    const engagementRate = calcEngagementRate(insights, followerCount);

    return {
      id: media.id,
      thumbnail: media.thumbnail_url ?? media.media_url,
      caption: media.caption ?? "",
      mediaType: media.media_type,
      timestamp: formatChartDate(media.timestamp),
      isoTimestamp: media.timestamp,
      likes: insights.likes ?? media.like_count ?? 0,
      comments: insights.comments ?? media.comments_count ?? 0,
      shares: insights.shares ?? 0,
      saves: insights.saved ?? 0,
      reach: insights.reach ?? 0,
      views: insights.views ?? 0,
      engagementRate,
    };
  });
}

/**
 * Merges media + insights into PostWithInsights[] for TopPostsRanking.
 */
export function mediaWithInsightsToRanked(
  mediaList: InstagramMedia[],
  insightsMap: Map<string, MediaInsights>,
  followerCount?: number
): PostWithInsights[] {
  return mediaList.map((media) => {
    const insights = insightsMap.get(media.id) ?? { mediaId: media.id };
    const engagementRate = calcEngagementRate(insights, followerCount);
    return { media, insights, engagementRate };
  });
}

/**
 * Extracts the latest value for a named metric from an InsightsResponse.
 * Useful for StatCards (e.g. current follower_count).
 */
export function extractLatestValue(
  insights: InsightsResponse,
  metricName: string
): number | undefined {
  const metric = insights.data.find((m) => m.name === metricName);
  if (!metric?.values?.length) return undefined;
  // values are ordered oldest→newest; take the last
  return metric.values[metric.values.length - 1].value;
}

/**
 * Computes period-over-period delta for a metric.
 * Returns the delta (current - first) and a ratio (delta / first).
 */
export function calcPeriodDelta(
  insights: InsightsResponse,
  metricName: string
): { delta: number; ratio: number } | undefined {
  const metric = insights.data.find((m) => m.name === metricName);
  if (!metric?.values || metric.values.length < 2) return undefined;

  const first = metric.values[0].value;
  const last = metric.values[metric.values.length - 1].value;
  const delta = last - first;
  const ratio = first === 0 ? 0 : delta / first;
  return { delta, ratio };
}
