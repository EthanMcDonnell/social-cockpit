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
 * The two overlap for anything scheduled *and* published; that is harmless for
 * "how busy is this day", and the job row is the one carrying the video tag.
 */

import { cockpit } from "./cockpit.js";
import type { ScheduledPostView } from "./types.js";

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
      query: { from, to, status: REAL_STATUSES.join(","), limit: 1000 },
    }),
  ]);

  const commitments: Commitment[] = [
    ...scheduled.jobs.map((job) => ({
      at: job.scheduled_at,
      source: "job" as const,
      status: job.status,
      video: typeof job.payload.video === "string" ? job.payload.video : undefined,
      label: firstLine(job.payload.caption ?? job.payload.title),
      id: job.id,
    })),
    ...history.posts.map((post) => ({
      at: post.published_at,
      source: "history" as const,
      status: "published",
      label: firstLine(post.title),
      id: post.id,
    })),
  ];

  return commitments.sort((a, b) => a.at - b.at);
}
