/**
 * Judge how a repost did, and retire the video if it flopped.
 *
 * This is the half of the feature that makes it self-correcting. A video can
 * look like a strong repost candidate on its original numbers and still land
 * flat the second time — the audience has seen it, or the moment has passed.
 * Without this the pool would keep offering it every time the gap elapsed.
 *
 * Two properties worth keeping:
 *
 *   It costs nothing. Views come from `cache.db`, which the cache worker is
 *   already syncing for the dashboard, so evaluation makes no API call of its
 *   own and cannot be the thing that exhausts a rate limit.
 *
 *   It never blocks on absence. A post whose insights have not synced yet is
 *   deferred, not judged — reading "0 views" off a cache miss would retire a
 *   perfectly good video permanently.
 *
 * Runs on the scheduler's existing housekeeping cadence. Server-side only.
 */

import { getCachedInsights } from "@/lib/cache/store";
import { logScheduleEvent } from "@/lib/schedule/store";
import { reportWarn } from "@/lib/observability";
import { getArchived } from "@/lib/archive/store";
import {
  abandonEvent,
  blockVideo,
  claimEvaluable,
  deferEvent,
  settleEvent,
} from "./store";
import { getBlockBelowViews, getEvaluateAfterHours } from "./settings";

const HOUR_MS = 60 * 60 * 1000;

/**
 * How many times a repost's views may be re-read before we give up.
 *
 * A post that was deleted, or made outside this app, will never appear in the
 * cache. Without a ceiling its event would be re-read on every housekeeping
 * pass for the life of the install. Six attempts across the evaluation window
 * is days of grace, after which the event is settled as `ok` — declining to
 * judge is the safe direction, since the alternative retires a video on
 * missing data.
 */
const MAX_ATTEMPTS = 6;

export interface EvaluationSummary {
  evaluated: number;
  blocked: number;
  deferred: number;
}

export async function evaluateReposts(now = Date.now()): Promise<EvaluationSummary> {
  const due = claimEvaluable(now);
  const summary: EvaluationSummary = { evaluated: 0, blocked: 0, deferred: 0 };
  if (!due.length) return summary;

  const threshold = getBlockBelowViews();
  const window = getEvaluateAfterHours() * HOUR_MS;

  for (const event of due) {
    // YouTube stats are not cached anywhere, and reposting is Instagram-only
    // (there is no trial-reel equivalent), so anything else here is a stray row
    // rather than something to spend an API call on.
    if (event.platform !== "ig") {
      abandonEvent(event.id);
      continue;
    }

    const insights = getCachedInsights(event.external_id);
    const views = insights?.views ?? insights?.reach;

    if (views === undefined) {
      if (event.attempts + 1 >= MAX_ATTEMPTS) {
        abandonEvent(event.id);
        reportWarn(
          "repost",
          "evaluation_abandoned",
          `gave up reading views for repost ${event.external_id} after ${MAX_ATTEMPTS} attempts`,
          { meta: { event: event.id, media_id: event.external_id } }
        );
        continue;
      }
      deferEvent(event.id, now + window);
      summary.deferred += 1;
      continue;
    }

    summary.evaluated += 1;

    if (views < threshold) {
      const reason = `Repost reached ${views.toLocaleString()} views, below the ${threshold.toLocaleString()} threshold.`;
      settleEvent(event.id, "blocked", views);
      blockVideo(event.archive_id, reason, views, event.id);
      summary.blocked += 1;

      const archived = getArchived(event.archive_id);
      logScheduleEvent(
        "warn",
        "repost_blocked",
        `${archived?.label ?? event.archive_id} retired from reposting — ${reason}`,
        {
          jobId: event.job_id,
          meta: {
            archive_id: event.archive_id,
            media_id: event.external_id,
            views,
            threshold,
          },
        }
      );
      continue;
    }

    settleEvent(event.id, "ok", views);
    logScheduleEvent(
      "info",
      "repost_evaluated",
      `Repost cleared the threshold with ${views.toLocaleString()} views`,
      {
        jobId: event.job_id,
        meta: { archive_id: event.archive_id, media_id: event.external_id, views, threshold },
      }
    );
  }

  return summary;
}
