/**
 * Pick the video a slug job should post.
 *
 * Two rules govern every method:
 *
 *   Eligibility — a candidate already posted to the target platform is out of
 *   that platform's pool, and a candidate whose file has gone missing is out of
 *   every pool. The first rule is what makes a recurring slug schedule work its
 *   way through a library instead of posting its best performer forever.
 *
 *   Fallback — a candidate with no metrics is never discarded for that. Scored
 *   candidates rank first among themselves; unscored ones follow in the order
 *   they were added. A brand-new slug whose videos have never been posted
 *   anywhere still fires on its first slot.
 *
 * Server-side only.
 */

import { scoreCandidates, type CandidateMetrics } from "./metrics";
import { filenameOf, isMissing, listVideos } from "./store";
import type { SchedulePlatform } from "@/lib/schedule/types";
import {
  SELECTION_LABELS,
  type SelectionMethod,
  type SlugSelection,
  type SlugSelectionFailure,
  type SlugVideo,
  type SlugVideoView,
} from "./types";

/** Methods that need a metrics lookup. The rest rank by add order alone. */
const METRIC_METHODS: SelectionMethod[] = ["most_views", "most_engagement", "least_views"];

export function needsMetrics(method: SelectionMethod): boolean {
  return METRIC_METHODS.includes(method);
}

export function toView(video: SlugVideo, metrics?: CandidateMetrics): SlugVideoView {
  return {
    ...video,
    filename: filenameOf(video),
    missing: isMissing(video),
    views: metrics?.views,
    engagement: metrics?.engagement,
    scored: metrics?.scored ?? false,
  };
}

/**
 * Score a whole pool for display. The slugs page shows the same numbers the
 * selector ranks on, so "why did it pick that one" is answerable by looking.
 */
export async function viewPool(
  slug: string,
  opts: { metrics?: boolean } = {}
): Promise<SlugVideoView[]> {
  const videos = listVideos(slug);
  const scores = await scoreCandidates(videos, { needsMetrics: opts.metrics !== false });
  return videos.map((video) => toView(video, scores.get(video.id)));
}

export interface SelectOptions {
  slug: string;
  platform: SchedulePlatform;
  method: SelectionMethod;
}

/**
 * Resolve a slug to the one video that should go out now.
 *
 * Called by the worker under its lease at fire time, and by the UI to preview
 * what would happen — the same function both times, so the preview cannot drift
 * from the decision.
 */
export async function selectVideo(
  opts: SelectOptions
): Promise<SlugSelection | SlugSelectionFailure> {
  const pool = listVideos(opts.slug);
  if (!pool.length) {
    return { error: `Slug "${opts.slug}" has no videos in its pool.`, exhausted: false };
  }

  const unposted = pool.filter(
    (video) => !video.posts.some((post) => post.platform === opts.platform)
  );
  if (!unposted.length) {
    return {
      error: `Every video in "${opts.slug}" has already been posted to ${platformName(opts.platform)}.`,
      exhausted: true,
    };
  }

  const eligible = unposted.filter((video) => !isMissing(video));
  if (!eligible.length) {
    return {
      error: `Every remaining video in "${opts.slug}" is missing from disk.`,
      exhausted: false,
    };
  }

  const scores = await scoreCandidates(eligible, { needsMetrics: needsMetrics(opts.method) });
  const views = eligible.map((video) => toView(video, scores.get(video.id)));
  const chosen = rank(views, opts.method);

  return {
    video: chosen,
    method: opts.method,
    reason: describe(chosen, opts.method, views.length),
    considered: views.length,
  };
}

/**
 * Order the eligible candidates and take the first.
 *
 * `sortedByAge` is the tie-break under every method as well as the fallback for
 * unscored candidates, which is what keeps the outcome deterministic: two
 * candidates with identical view counts resolve the same way on every run
 * rather than depending on row order.
 */
function rank(videos: SlugVideoView[], method: SelectionMethod): SlugVideoView {
  const byAge = [...videos].sort((a, b) => a.seq - b.seq);

  if (method === "oldest_unposted") return byAge[0];
  if (method === "newest") return byAge[byAge.length - 1];
  if (method === "random") return byAge[Math.floor(Math.random() * byAge.length)];

  const scored = byAge.filter((video) => video.scored);
  // Nothing has numbers yet — the whole pool falls back to add order.
  if (!scored.length) return byAge[0];

  const metric = (video: SlugVideoView): number =>
    method === "most_engagement" ? (video.engagement ?? 0) : (video.views ?? 0);
  const direction = method === "least_views" ? 1 : -1;

  return [...scored].sort((a, b) => {
    const delta = (metric(a) - metric(b)) * direction;
    return delta !== 0 ? delta : a.seq - b.seq;
  })[0];
}

function describe(video: SlugVideoView, method: SelectionMethod, considered: number): string {
  const name = video.label ?? video.filename;
  const pool = `${considered} eligible`;

  if (!video.scored && needsMetrics(method)) {
    return `${name} — no candidate had metrics yet, so ${SELECTION_LABELS[method].toLowerCase()} fell back to add order (${pool})`;
  }
  if (method === "most_views" || method === "least_views") {
    return `${name} — ${formatCount(video.views ?? 0)} views (${pool})`;
  }
  if (method === "most_engagement") {
    return `${name} — ${((video.engagement ?? 0) * 100).toFixed(1)}% engagement (${pool})`;
  }
  if (method === "oldest_unposted") return `${name} — longest wait in the pool (${pool})`;
  if (method === "newest") return `${name} — most recently added (${pool})`;
  return `${name} — picked at random (${pool})`;
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function platformName(platform: SchedulePlatform): string {
  return platform === "yt" ? "YouTube" : "Instagram";
}
