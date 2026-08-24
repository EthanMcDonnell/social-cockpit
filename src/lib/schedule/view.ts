/**
 * Hydrate stored jobs into what the calendar actually needs: staged media
 * resolved to filenames, and each source liveness-checked so a card can warn
 * that its file has gone missing *before* the slot arrives.
 *
 * Server-side only.
 */

import { getStagedMediaMany, withStatus } from "./media";
import { listVideos } from "@/lib/slugs/store";
import { resolveSelectionMethod } from "@/lib/slugs/settings";
import type { SchedulePlatform } from "./types";
import type { ScheduledPost, ScheduledPostView } from "./types";

export function hydrateJobs(jobs: ScheduledPost[]): ScheduledPostView[] {
  const ids = Array.from(new Set(jobs.flatMap((j) => j.media.map((m) => m.staged_id))));
  const staged = getStagedMediaMany(ids);
  // One pool read per distinct slug on screen, not one per card — a week of
  // slug jobs is usually a week of the same two or three slugs.
  const pools = new Map<string, ReturnType<typeof listVideos>>();
  const poolFor = (slug: string) => {
    if (!pools.has(slug)) pools.set(slug, listVideos(slug));
    return pools.get(slug)!;
  };

  return jobs.map((job) => {
    const media_files = job.media
      .map((ref) => staged.get(ref.staged_id))
      .filter((m): m is NonNullable<typeof m> => !!m)
      .map(withStatus);

    // A media row that vanished from the table counts as missing too — the job
    // references something we can no longer resolve to a file at all.
    const unresolved = job.media.length !== media_files.length;

    return {
      ...job,
      media_files,
      media_missing: unresolved || media_files.some((m) => m.missing),
      // Only for a job still waiting on its pool. Once it has resolved, the
      // card shows the file it actually chose.
      ...(job.content_slug && !job.media.length
        ? {
            selection_effective: resolveSelectionMethod(job.content_slug, job.selection_method),
            slug_eligible: countEligible(poolFor(job.content_slug), job.platform),
          }
        : {}),
    };
  });
}

export function hydrateJob(job: ScheduledPost): ScheduledPostView {
  return hydrateJobs([job])[0];
}

/** Candidates in the pool that have not yet been posted to this platform. */
function countEligible(
  pool: ReturnType<typeof listVideos>,
  platform: SchedulePlatform
): number {
  return pool.filter((video) => !video.posts.some((post) => post.platform === platform)).length;
}
