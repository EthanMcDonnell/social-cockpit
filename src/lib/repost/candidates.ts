/**
 * Which archived videos are worth reposting, and in what order.
 *
 * A normal slug pool works through a library and retires each video as it
 * posts, which is what `postedTo()` in `lib/slugs/select.ts` enforces. A repost
 * pool asks the opposite question — it only wants videos that have *already*
 * been published, and it wants the ones that did well.
 *
 * Two tiers, and the order between them is the rule that matters most:
 *
 *   Tier 1 — never reposted. Ranked by views, best first.
 *   Tier 2 — reposted before, has rested long enough, and its last repost did
 *            not flop. Ranked by longest since its last outing.
 *
 * Tier 1 is drained completely before tier 2 is looked at. Anything else and a
 * single 400k video would take every slot forever while a shelf of 40k videos
 * that have never had a second run sat behind it.
 *
 * Server-side only.
 */

import fs from "fs";
import path from "path";
import { getDb } from "@/lib/db";
import { scoreCandidates } from "@/lib/slugs/metrics";
import type { SchedulePlatform } from "@/lib/schedule/types";
import type { SlugVideoPayload, SlugVideoPost } from "@/lib/slugs/types";
import type { ArchivedVideo } from "@/lib/archive/types";
import { blocksFor, repostsFor } from "./store";
import { getBlockBelowViews, getMinGapDays, getMinViews } from "./settings";
import type { RepostCandidate, RepostEvent, RepostPoolView } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

interface JoinedRow {
  id: string;
  sha256: string;
  path: string;
  source_path: string | null;
  size_bytes: number;
  content_type: string;
  label: string | null;
  origin_slug: string | null;
  created_at: string;
  /** From the origin slug. NULL when the video has no slug at all. */
  repost_eligible: number | null;
  /** The pool candidate's label, when one is linked. */
  candidate_label: string | null;
  /** The pool row linking this file to its posts, when one is linked. */
  candidate_id: string | null;
  /** The per-platform defaults it published under, as stored JSON. */
  candidate_payload: string | null;
}

function rowToArchived(row: JoinedRow): ArchivedVideo {
  return {
    id: row.id,
    sha256: row.sha256,
    path: row.path,
    source_path: row.source_path ?? undefined,
    size_bytes: row.size_bytes,
    content_type: row.content_type,
    label: row.label ?? undefined,
    origin_slug: row.origin_slug ?? undefined,
    created_at: row.created_at,
  };
}

/**
 * Every published post behind each archived video, keyed by archive id.
 *
 * The join runs through `slug_videos.archive_id`: the pool row is what links a
 * file to the posts it became, and the archive is what keeps the file alive
 * once the original moves. A video may be enrolled in more than one slug, so
 * the posts are unioned rather than assumed to come from a single row.
 */
function postsByArchive(): Map<string, SlugVideoPost[]> {
  const rows = getDb()
    .prepare(
      `SELECT v.archive_id AS archive_id, p.platform, p.external_id, p.job_id, p.posted_at
         FROM slug_videos v
         JOIN slug_video_posts p ON p.video_id = v.id
        WHERE v.archive_id IS NOT NULL
        ORDER BY p.posted_at ASC`
    )
    .all() as {
      archive_id: string;
      platform: string;
      external_id: string;
      job_id: string | null;
      posted_at: string;
    }[];

  const out = new Map<string, SlugVideoPost[]>();
  for (const row of rows) {
    const list = out.get(row.archive_id) ?? [];
    // The same post can be reached through two pool rows sharing an archived
    // file. Counting it twice would double the video's view total.
    if (list.some((post) => post.external_id === row.external_id && post.platform === row.platform)) {
      continue;
    }
    list.push({
      platform: row.platform as SchedulePlatform,
      external_id: row.external_id,
      job_id: row.job_id ?? undefined,
      posted_at: row.posted_at,
    });
    out.set(row.archive_id, list);
  }
  return out;
}

/**
 * Score and classify every archived video for one platform.
 *
 * Returns *all* of them, ineligible ones included, each carrying why. The Slugs
 * page renders this list directly, so "there are 40 videos and none of them can
 * run, here is the reason for each" is answerable without a second query — and
 * a video held back because its slug was never opted in reads differently from
 * one retired for underperforming, which is the distinction the whole feature
 * hangs on.
 */
export async function repostCandidates(platform: SchedulePlatform): Promise<RepostCandidate[]> {
  const rows = getDb()
    .prepare(
      `SELECT a.*, s.repost_eligible AS repost_eligible,
              (SELECT v.label FROM slug_videos v
                WHERE v.archive_id = a.id AND v.label IS NOT NULL LIMIT 1) AS candidate_label,
              (SELECT v.id FROM slug_videos v
                WHERE v.archive_id = a.id ORDER BY v.rowid ASC LIMIT 1) AS candidate_id,
              (SELECT v.payload FROM slug_videos v
                WHERE v.archive_id = a.id ORDER BY v.rowid ASC LIMIT 1) AS candidate_payload
         FROM archived_videos a
         LEFT JOIN slugs s ON s.slug = a.origin_slug
        ORDER BY a.created_at DESC`
    )
    .all() as JoinedRow[];
  if (!rows.length) return [];

  const posts = postsByArchive();
  const ids = rows.map((row) => row.id);
  const blocks = blocksFor(ids);
  const reposts = repostsFor(ids);

  // Views are summed across every platform the video ran on, matching how a
  // slug pool scores: the question is "did this clip work", not "did this one
  // posting of it work".
  const scores = await scoreCandidates(
    rows.map((row) => ({ id: row.id, posts: posts.get(row.id) ?? [] })),
    { needsMetrics: true }
  );

  const minViews = getMinViews();
  const minGapMs = getMinGapDays() * DAY_MS;
  const blockBelow = getBlockBelowViews();
  const now = Date.now();

  return rows.map((row) => {
    const archive = rowToArchived(row);
    const metrics = scores.get(row.id);
    const allPosts = posts.get(row.id) ?? [];
    const onPlatform = allPosts.filter((post) => post.platform === platform);
    const history = (reposts.get(row.id) ?? []).filter((event) => event.platform === platform);
    const block = blocks.get(row.id);
    const last = history[0]; // repostsFor orders newest first
    const lastAt = last ? Date.parse(last.posted_at) : undefined;

    const base: RepostCandidate = {
      archive,
      label: row.candidate_label ?? row.label ?? path.basename(row.path),
      video_id: row.candidate_id ?? undefined,
      payload: parsePayload(row.candidate_payload),
      slug: archive.origin_slug,
      slug_enabled: row.repost_eligible === 1,
      views: metrics?.views,
      scored: metrics?.scored ?? false,
      reposts: history,
      last_reposted_at: Number.isNaN(lastAt) ? undefined : lastAt,
      block,
      tier: null,
      eligible: false,
    };

    // Ordered so the most explanatory reason wins. The two "somebody decided
    // this" reasons come first; `block` stays attached to the candidate either
    // way, so the UI can show a retired video's numbers even while its slug is
    // switched off.
    if (!archive.origin_slug) return { ...base, why: "no_slug" };
    if (row.repost_eligible !== 1) return { ...base, why: "not_enabled" };
    if (block) return { ...base, why: "blocked" };
    if (!onPlatform.length) return { ...base, why: "not_posted_here" };
    if (!fs.existsSync(archive.path)) return { ...base, why: "missing" };
    if (!base.scored) return { ...base, why: "unscored" };
    if ((base.views ?? 0) < minViews) return { ...base, why: "below_min_views" };

    if (!history.length) return { ...base, tier: 1, eligible: true };

    // Tier 2's two gates. The second re-checks the last repost's own figure
    // rather than trusting the absence of a block: an event recorded before the
    // threshold was raised never produced one, and would otherwise walk back
    // into the rotation the moment the gap elapsed.
    const rested = lastAt !== undefined && now - lastAt >= minGapMs;
    const cleared = last.views !== undefined && last.views >= blockBelow;
    if (!rested || !cleared) return { ...base, why: "resting" };

    return { ...base, tier: 2, eligible: true };
  });
}

/**
 * Order the eligible candidates. Tier 1 entirely before tier 2.
 *
 * Ties break on `created_at` (oldest archived first) so the order is
 * deterministic — two videos on identical view counts must resolve the same way
 * on every run rather than following whatever order SQLite returned.
 */
export function rankCandidates(candidates: RepostCandidate[]): RepostCandidate[] {
  const eligible = candidates.filter((candidate) => candidate.eligible);

  const tier1 = eligible
    .filter((candidate) => candidate.tier === 1)
    .sort(
      (a, b) =>
        (b.views ?? 0) - (a.views ?? 0) ||
        Date.parse(a.archive.created_at) - Date.parse(b.archive.created_at)
    );

  const tier2 = eligible
    .filter((candidate) => candidate.tier === 2)
    .sort(
      (a, b) =>
        (a.last_reposted_at ?? 0) - (b.last_reposted_at ?? 0) ||
        Date.parse(a.archive.created_at) - Date.parse(b.archive.created_at)
    );

  return [...tier1, ...tier2];
}

/** The whole pool as the Slugs page and the MCP server want to see it. */
export async function viewRepostPool(
  slug: string,
  platform: SchedulePlatform
): Promise<RepostPoolView> {
  const candidates = await repostCandidates(platform);
  return {
    slug,
    platform,
    candidates,
    tier1: candidates.filter((candidate) => candidate.tier === 1).length,
    tier2: candidates.filter((candidate) => candidate.tier === 2).length,
    awaiting_optin: candidates.filter((candidate) => candidate.why === "not_enabled").length,
    blocked: candidates.filter((candidate) => candidate.block).length,
  };
}

/** A human-readable "why this one", stored on the job and shown in the log. */
export function describeRepost(candidate: RepostCandidate, considered: number): string {
  const pool = `${considered} eligible`;
  if (candidate.tier === 1) {
    return `${candidate.label} — ${formatCount(candidate.views ?? 0)} views, never reposted (${pool})`;
  }
  const days = candidate.last_reposted_at
    ? Math.floor((Date.now() - candidate.last_reposted_at) / DAY_MS)
    : 0;
  return `${candidate.label} — ${formatCount(candidate.views ?? 0)} views, last reposted ${days}d ago (${pool})`;
}

export type { RepostEvent };

function parsePayload(raw: string | null): SlugVideoPayload {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as SlugVideoPayload;
  } catch {
    return {};
  }
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
