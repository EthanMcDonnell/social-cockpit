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

import { reservedSlugVideoIds } from "@/lib/schedule/store";
import { scoreCandidates, type CandidateMetrics } from "./metrics";
import { basename } from "path";
import { filenameOf, isMissing, listVideos, postedTo } from "./store";
import { describeRepost, rankCandidates, repostCandidates } from "@/lib/repost/candidates";
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
  /**
   * This slot runs from the slug's archive rather than its unposted files.
   *
   * Comes from the job, not from the slug. A slug names a topic; whether a
   * given slot repeats something is a property of that booking.
   */
  repost?: boolean;
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
  // A repost draws from the archive of what this slug has already published,
  // and inverts the "already posted here" rule that governs every method below.
  // Branch before touching `slug_videos`.
  if (opts.repost) return selectRepost(opts);

  const pool = listVideos(opts.slug);
  if (!pool.length) {
    return { error: `Slug "${opts.slug}" has no videos in its pool.`, exhausted: false };
  }

  // The same three filters `eligibleVideos` composes, applied one at a time so
  // a pool that produces nothing can say which of them emptied it.
  const unposted = pool.filter((video) => !postedTo(video, opts.platform));
  if (!unposted.length) {
    return {
      error: `Every video in "${opts.slug}" has already been posted to ${platformName(opts.platform)}.`,
      exhausted: true,
    };
  }

  const onDisk = unposted.filter((video) => !isMissing(video));
  if (!onDisk.length) {
    return {
      error: `Every remaining video in "${opts.slug}" is missing from disk.`,
      exhausted: false,
    };
  }

  // A candidate another job is publishing right now has not reached the ledger
  // yet, but it is spoken for — picking it again would post it twice.
  const reserved = reservedSlugVideoIds(opts.slug, opts.platform);
  const eligible = reserved.size
    ? onDisk.filter((video) => !reserved.has(video.id))
    : onDisk;
  if (!eligible.length) {
    return {
      error: `Every remaining video in "${opts.slug}" is already being published by another slot.`,
      exhausted: true,
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

/**
 * Resolve a repost pool to the one archived video that should run now.
 *
 * Deliberately not folded into the method machinery above. Every `SelectionMethod`
 * answers "which of these unposted files goes out", and a repost is asking a
 * different question entirely — "which of the things that already worked
 * deserves another run" — with its own two-tier ordering. Sharing the ranking
 * code would mean bending both.
 *
 * The failures are enumerated separately for the same reason `selectVideo` does
 * it: a pool that produces nothing has to be able to say which rule emptied it,
 * and "not enabled yet" is a very different message from "everything is resting".
 */
async function selectRepost(
  opts: SelectOptions
): Promise<SlugSelection | SlugSelectionFailure> {
  // Scoped to this slot's own topic: the slot was booked to repost *this*, so
  // reaching across to another topic's archive would publish something the
  // calendar never said it would.
  const candidates = await repostCandidates(opts.platform, opts.slug);
  if (!candidates.length) {
    return {
      error: `#${opts.slug} has nothing archived to repost.`,
      exhausted: false,
    };
  }

  const ranked = rankCandidates(candidates);
  if (!ranked.length) {
    const awaiting = candidates.filter((c) => c.why === "not_enabled").length;
    const blocked = candidates.filter((c) => c.block).length;
    const resting = candidates.filter((c) => c.why === "resting").length;

    // Ordered by what the user can actually do about it. "Turn a slug on" is
    // actionable; "everything is resting" is a matter of waiting.
    if (awaiting) {
      return {
        error:
          `#${opts.slug} has nothing to repost: ${awaiting} archived video(s) are not ` +
          `enabled for reposting. Enable the slug on the Slugs page.`,
        exhausted: false,
      };
    }
    if (resting) {
      return {
        error: `Every eligible video in #${opts.slug} has been reposted too recently.`,
        exhausted: true,
      };
    }
    if (blocked) {
      return {
        error: `Every candidate in #${opts.slug} has been blocked for underperforming as a repost.`,
        exhausted: true,
      };
    }
    return {
      error: `No archived video meets the repost threshold for #${opts.slug} yet.`,
      exhausted: false,
    };
  }

  const chosen = ranked[0];
  // The archived copy, not the original: it is by definition the exact file
  // that earned the numbers this pick was made on, and the original may since
  // have been re-edited in place.
  const video: SlugVideoView = {
    id: chosen.video_id ?? chosen.archive.id,
    seq: 0,
    slug: opts.slug,
    path: chosen.archive.path,
    label: chosen.label,
    payload: chosen.payload,
    archive_id: chosen.archive.id,
    created_at: chosen.archive.created_at,
    posts: [],
    filename: basename(chosen.archive.path),
    missing: false,
    views: chosen.views,
    scored: chosen.scored,
  };

  return {
    video,
    method: opts.method,
    reason: describeRepost(chosen, ranked.length),
    considered: ranked.length,
    repost: { archive_id: chosen.archive.id, tier: chosen.tier as 1 | 2 },
  };
}
