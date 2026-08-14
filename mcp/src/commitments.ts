/**
 * Everything the calendar already has on it, from both sources that know.
 *
 * Two sources, because neither is complete on its own:
 *
 * - **Scheduler jobs** (`/api/schedule`) — anything booked through the cockpit,
 *   including jobs that have already gone out. Their payload keeps the `video`
 *   tag after publishing, which is the only way to tell that two posts are hooks
 *   of the same video.
 * - **Published history** (`/api/schedule/history`) — what actually appeared on
 *   the account, from the media cache. Catches posts made outside the scheduler
 *   (by hand, or from the phone) that no job row describes.
 *
 * A job that has published appears in *both*, so the media id it produced is
 * subtracted from the history side and the job row is kept — it is the one
 * carrying the video tag. Without that, every scheduled post would count twice
 * the moment it went live and `max_posts_per_day` would halve itself. This
 * mirrors `src/lib/schedule/capacity.ts`, which is what actually enforces the
 * cap at booking time; the two have to agree or `suggest_slots` will skip days
 * the booking route would accept.
 */

import { cockpit, CockpitError } from "./cockpit.js";
import type { ScheduledPostView } from "./types.js";

/** The `/api/schedule` route's own hard cap on `limit`. */
const JOB_LIMIT = 1000;

export interface Commitment {
  /** Epoch ms. */
  at: number;
  /** Where this came from: a scheduler job, or the published-post cache. */
  source: "job" | "history";
  /** Job status, for jobs only. */
  status?: string;
  /** The video (slug) this post is a hook of, when the job was tagged. */
  video?: string;
  label: string;
  id?: string;
}

/** Job statuses that still represent a real post, past or future. */
const REAL_STATUSES = [
  "pending",
  "paused",
  "publishing",
  "finalizing",
  "published",
] as const;

interface HistoryEntry {
  id: string;
  published_at: number;
  title: string;
}

function firstLine(text: string | undefined | null): string {
  return (text ?? "").split("\n")[0]?.trim() || "(no caption)";
}

/**
 * Everything committed between two instants, sorted by time.
 *
 * `cancelled`, `failed`, and `missed` jobs are deliberately absent: they occupy
 * no slot, and treating them as taken would block times that are genuinely free.
 */
export async function fetchCommitments(from: number, to: number): Promise<Commitment[]> {
  const [history, scheduled] = await Promise.all([
    cockpit<{ posts: HistoryEntry[] }>("/api/schedule/history", { query: { from, to } }),
    cockpit<{ jobs: ScheduledPostView[] }>("/api/schedule", {
      query: { from, to, status: REAL_STATUSES.join(","), limit: JOB_LIMIT },
    }),
  ]);

  // Hitting the cap means the far end of the window is missing, and a *short*
  // calendar is the dangerous kind: slots would look free because the jobs
  // holding them weren't returned. Unreachable at max_posts_per_day ≤ 2 over
  // the 400-day horizon, so fail loudly rather than silently under-report.
  if (scheduled.jobs.length >= JOB_LIMIT) {
    throw new CockpitError(
      "window_truncated",
      `The calendar window ${new Date(from).toISOString()} — ${new Date(to).toISOString()} holds at least ` +
        `${JOB_LIMIT} scheduled posts, which is the API's maximum per request, so it cannot be read completely. ` +
        `Narrow the window before trusting any answer about free slots.`,
      0
    );
  }

  // Media ids these jobs are responsible for, so history doesn't re-count them.
  const ownMediaIds = new Set<string>();
  for (const job of scheduled.jobs) {
    if (job.result?.media_id) ownMediaIds.add(job.result.media_id);
  }

  const commitments: Commitment[] = [
    ...scheduled.jobs.map((job) => ({
      at: job.scheduled_at,
      source: "job" as const,
      status: job.status,
      video: typeof job.payload.video === "string" ? job.payload.video : undefined,
      label: firstLine(job.payload.caption ?? job.payload.title),
      id: job.id,
    })),
    ...history.posts
      .filter((post) => !ownMediaIds.has(post.id))
      .map((post) => ({
        at: post.published_at,
        source: "history" as const,
        status: "published",
        label: firstLine(post.title),
        id: post.id,
      })),
  ];

  return commitments.sort((a, b) => a.at - b.at);
}
