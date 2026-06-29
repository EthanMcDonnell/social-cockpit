import { getAllMedia } from "@/lib/instagram/endpoints/media";
import { getMediaInsightsFlat } from "@/lib/instagram/endpoints/insights";
import {
  RateLimitError,
  type InstagramMedia,
  type MediaInsightMetric,
} from "@/lib/instagram/types";
import * as store from "./store";

// How long cached data is considered fresh before a read triggers a background
// refresh (stale-while-revalidate). Defaults to 30 min.
export const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS) || 30 * 60 * 1000;

// Metrics valid for any media type; reels/videos additionally get watch-time
// metrics. Graph rejects metrics that don't apply to a media type, so we tailor
// the request per type.
const BASE_METRICS: MediaInsightMetric[] = [
  "reach",
  "likes",
  "comments",
  "shares",
  "saved",
  "views",
  "total_interactions",
];
const REEL_METRICS: MediaInsightMetric[] = [
  ...BASE_METRICS,
  "ig_reels_avg_watch_time",
  "ig_reels_video_view_total_time",
];

function metricsFor(media: InstagramMedia): MediaInsightMetric[] {
  return media.media_type === "VIDEO" || media.media_type === "REEL"
    ? REEL_METRICS
    : BASE_METRICS;
}

// ─── Refreshers ───────────────────────────────────────────────────────────────

export async function refreshMedia(): Promise<InstagramMedia[]> {
  const media = await getAllMedia();
  store.upsertMedia(media);
  store.setSyncState("media", "ok", `${media.length} media`);
  return media;
}

export async function refreshInsightsFor(media: InstagramMedia): Promise<void> {
  const insights = await getMediaInsightsFlat(media.id, metricsFor(media));
  store.upsertMediaInsights(media.id, insights);
}

// ─── Full sync cycle (background worker) ──────────────────────────────────────

export async function runCacheSync(): Promise<void> {
  let media: InstagramMedia[];
  try {
    media = await refreshMedia();
  } catch (err) {
    store.setSyncState(
      "media",
      "error",
      err instanceof Error ? err.message : String(err)
    );
    console.error("[cache] media sync failed:", err);
    return;
  }

  let ok = 0;
  for (const m of media) {
    try {
      await refreshInsightsFor(m);
      ok++;
    } catch (err) {
      if (err instanceof RateLimitError) {
        store.setSyncState("insights", "throttled", `stopped after ${ok}`);
        console.warn(
          `[cache] insights sync throttled after ${ok}/${media.length} — backing off`
        );
        return;
      }
      console.error(`[cache] insights failed for ${m.id}:`, err);
    }
  }
  store.setSyncState("insights", "ok", `${ok}/${media.length}`);
  console.log(`[cache] synced ${media.length} media, ${ok} insights`);
}

// ─── Read-through (stale-while-revalidate) ────────────────────────────────────

const inFlight = new Set<string>();

function background(key: string, fn: () => Promise<unknown>): void {
  if (inFlight.has(key)) return;
  inFlight.add(key);
  void Promise.resolve()
    .then(fn)
    .catch((e) => console.error(`[cache] background refresh ${key} failed:`, e))
    .finally(() => inFlight.delete(key));
}

// Ensure the media set is present and reasonably fresh. Cold cache → await a
// full refresh (so the first read isn't empty); stale → serve now, refresh in
// the background.
export async function ensureMediaFresh(): Promise<void> {
  if (store.mediaCount() === 0) {
    await refreshMedia();
    return;
  }
  if (store.isStale("media", CACHE_TTL_MS)) {
    background("media", refreshMedia);
  }
}

// Ensure a single media's insights are present and reasonably fresh.
export async function ensureInsightsFresh(media: InstagramMedia): Promise<void> {
  if (!store.hasInsights(media.id)) {
    await refreshInsightsFor(media);
    return;
  }
  if (store.insightsStale(media.id, CACHE_TTL_MS)) {
    background(`insights:${media.id}`, () => refreshInsightsFor(media));
  }
}
