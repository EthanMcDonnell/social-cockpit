/**
 * Hydrate stored jobs into what the calendar actually needs: staged media
 * resolved to filenames, and each source liveness-checked so a card can warn
 * that its file has gone missing *before* the slot arrives.
 *
 * Server-side only.
 */

import { getStagedMediaMany, withStatus } from "./media";
import type { ScheduledPost, ScheduledPostView } from "./types";

export function hydrateJobs(jobs: ScheduledPost[]): ScheduledPostView[] {
  const ids = Array.from(new Set(jobs.flatMap((j) => j.media.map((m) => m.staged_id))));
  const staged = getStagedMediaMany(ids);

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
    };
  });
}

export function hydrateJob(job: ScheduledPost): ScheduledPostView {
  return hydrateJobs([job])[0];
}
