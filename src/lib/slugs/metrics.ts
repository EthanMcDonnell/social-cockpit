/**
 * Per-candidate performance, for the selection methods that rank by it.
 *
 * A candidate's score is summed across every platform it has been posted to: a
 * video that did 40k on Instagram and 10k on YouTube is a 50k video, because the
 * question a slug job asks is "which of these clips performs", not "which of
 * these Instagram posts performs".
 *
 * Instagram is free — `cache.db` already holds insights for every post, synced
 * by the cache worker. YouTube is not cached anywhere, so it costs API units;
 * stats are fetched by id (never by recency, or a pool's older clips would be
 * invisible), memoised per video for the TTL below, and a failure degrades to
 * "no YouTube metrics" rather than failing the publish. A slot must never be
 * missed because a stats call timed out.
 *
 * Server-side only.
 */

import { getCachedInsightsMany } from "@/lib/cache/store";
import { getVideoStats } from "@/lib/youtube/endpoints/videos";
import { reportWarn } from "@/lib/observability";
import type { SchedulePlatform } from "@/lib/schedule/types";
import type { SlugVideo } from "./types";

/** One score per external post. */
export interface PostMetrics {
  views: number;
  /** Interactions per view, 0–1. Undefined when views are unknown or zero. */
  engagement?: number;
}

export interface CandidateMetrics {
  views?: number;
  engagement?: number;
  scored: boolean;
}

/**
 * How long a YouTube figure is reused. Long enough that resolving a pool,
 * previewing it in the UI, and firing the job minutes later cost one call;
 * short enough that "most views" means today's views, not last week's.
 */
const YT_TTL_MS = 10 * 60 * 1000;

const ytCache = new Map<string, { at: number; metrics: PostMetrics }>();
/** After a failed fetch, don't retry until the TTL is up. */
let ytFailedAt = 0;

async function youtubeStats(ids: string[]): Promise<Map<string, PostMetrics>> {
  const now = Date.now();
  const stale = ids.filter((id) => {
    const hit = ytCache.get(id);
    return !hit || now - hit.at >= YT_TTL_MS;
  });

  if (stale.length && now - ytFailedAt >= YT_TTL_MS) {
    try {
      const fetched = await getVideoStats(stale);
      for (const id of stale) {
        const stats = fetched.get(id);
        // Cache the miss too: a video that has been deleted, or belongs to
        // another channel, must not be re-requested on every preview.
        const views = stats?.viewCount ?? 0;
        const interactions = (stats?.likeCount ?? 0) + (stats?.commentCount ?? 0);
        ytCache.set(id, {
          at: now,
          metrics: stats
            ? { views, engagement: views > 0 ? interactions / views : undefined }
            : { views: 0 },
        });
      }
    } catch (err) {
      // Degrade, never block. Without YouTube numbers a cross-posted candidate
      // is ranked on its Instagram half; with nothing at all it falls back to
      // add order. Either is better than a missed slot.
      ytFailedAt = now;
      reportWarn(
        "slugs",
        "youtube_metrics_unavailable",
        `could not read YouTube stats for slug selection: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  const out = new Map<string, PostMetrics>();
  for (const id of ids) {
    const hit = ytCache.get(id);
    // A post with no usable figure is left out entirely rather than scored as a
    // zero, so it falls back to add order instead of ranking last on a number
    // nobody measured.
    if (hit && hit.metrics.views > 0) out.set(id, hit.metrics);
  }
  return out;
}

function instagramStats(mediaIds: string[]): Map<string, PostMetrics> {
  const out = new Map<string, PostMetrics>();
  for (const [mediaId, insights] of Array.from(getCachedInsightsMany(mediaIds))) {
    // Reach stands in when views are absent — an older post, or a media type
    // that never reported them. They are not the same measure, but ranking one
    // clip against another needs a comparable number more than an exact one.
    const views = insights.views ?? insights.reach ?? 0;
    const interactions =
      insights.total_interactions ??
      (insights.likes ?? 0) + (insights.comments ?? 0) + (insights.shares ?? 0) + (insights.saved ?? 0);
    out.set(mediaId, {
      views,
      engagement: views > 0 ? interactions / views : undefined,
    });
  }
  return out;
}

/**
 * Score every candidate in a pool.
 *
 * `needsMetrics` is false for the methods that rank by add order, and then this
 * skips the YouTube call entirely — an `oldest_unposted` slug should not spend
 * API quota to answer a question it never asks.
 */
export async function scoreCandidates(
  videos: SlugVideo[],
  opts: { needsMetrics: boolean } = { needsMetrics: true }
): Promise<Map<string, CandidateMetrics>> {
  const out = new Map<string, CandidateMetrics>();
  for (const video of videos) out.set(video.id, { scored: false });
  if (!opts.needsMetrics || !videos.length) return out;

  const byPlatform: Record<SchedulePlatform, string[]> = { ig: [], yt: [] };
  for (const video of videos) {
    for (const post of video.posts) byPlatform[post.platform]?.push(post.external_id);
  }

  const ig = byPlatform.ig.length ? instagramStats(byPlatform.ig) : new Map<string, PostMetrics>();
  const yt = byPlatform.yt.length
    ? await youtubeStats(byPlatform.yt)
    : new Map<string, PostMetrics>();

  for (const video of videos) {
    let views = 0;
    let weightedEngagement = 0;
    let engagementWeight = 0;
    let scored = false;

    for (const post of video.posts) {
      const metrics = post.platform === "ig" ? ig.get(post.external_id) : yt.get(post.external_id);
      if (!metrics) continue;
      scored = true;
      views += metrics.views;
      if (metrics.engagement !== undefined) {
        // Weight by views so a 200-view post cannot outrank a 50k one on a
        // lucky ratio — the average has to mean "how this clip engages", not
        // "how its smallest posting engaged".
        weightedEngagement += metrics.engagement * metrics.views;
        engagementWeight += metrics.views;
      }
    }

    out.set(video.id, {
      views: scored ? views : undefined,
      engagement: engagementWeight > 0 ? weightedEngagement / engagementWeight : undefined,
      scored,
    });
  }
  return out;
}

/** Drop the memoised YouTube stats — used by tests and after a token change. */
export function resetMetricsCache(): void {
  ytCache.clear();
  ytFailedAt = 0;
}
