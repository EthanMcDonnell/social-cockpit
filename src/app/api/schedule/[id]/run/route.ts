import { NextRequest, NextResponse } from "next/server";
import { getJob, updateJobWithinScheduledCap, logScheduleEvent } from "@/lib/schedule/store";
import { runScheduleCycle, schedulerEnabled } from "@/lib/schedule/worker";
import { hydrateJob } from "@/lib/schedule/view";
import { requireScheduleAuth } from "@/lib/schedule/auth";
import { checkDailyCap } from "@/lib/schedule/capacity";
import { getMaxPostsPerDay, getTimeZone } from "@/lib/schedule/settings";
import { addDays } from "@/lib/schedule/tz";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const RUNNABLE_STATUSES = ["pending", "paused", "failed", "missed", "cancelled"] as const;

/**
 * POST /api/schedule/:id/run — publish now, ignoring the clock.
 *
 * Used by the calendar's "post now" on a missed job, and to retry a failed one.
 * It doesn't publish inline: it moves the job to due-now and turns the worker
 * over immediately, so the same claim/lease/retry path runs. That keeps one code
 * path for publishing instead of a second one that only the button uses.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const denied = requireScheduleAuth(request);
  if (denied) return denied;

  const job = getJob(params.id);
  if (!job) {
    return NextResponse.json(
      { error: "not_found", message: "No such scheduled post." },
      { status: 404 }
    );
  }
  if (job.status === "publishing" || job.status === "finalizing") {
    return NextResponse.json(
      { error: "conflict", message: "Already publishing." },
      { status: 409 }
    );
  }
  if (job.status === "published") {
    return NextResponse.json(
      { error: "conflict", message: "This post has already gone out." },
      { status: 409 }
    );
  }
  if (!schedulerEnabled()) {
    return NextResponse.json(
      {
        error: "scheduler_disabled",
        message: "SCHEDULER_ENABLED is false on this instance — nothing will publish.",
      },
      { status: 409 }
    );
  }

  // Due now, with a full attempt budget and a grace window wide enough that the
  // very act of asking can't immediately mark it missed. It still consumes the
  // same account-day capacity as a normal booking.
  const now = Date.now();
  const timeZone = getTimeZone();
  const cap = checkDailyCap(now, timeZone, getMaxPostsPerDay(), job.id);
  if (!cap.allowed) {
    return NextResponse.json({ error: "day_full", message: cap.message }, { status: 409 });
  }
  const queued = updateJobWithinScheduledCap(
    job.id,
    {
      status: "pending",
      scheduledAt: now,
      attempts: 0,
      nextAttemptAt: null,
      result: null,
      containerId: null,
      graceMinutes: Math.max(job.grace_minutes, 60),
    },
    cap.usage.dayStart,
    addDays(cap.usage.dayStart, 1, timeZone),
    cap.max - cap.usage.external,
    RUNNABLE_STATUSES
  );
  if (!queued) {
    return NextResponse.json({ error: "conflict", message: "Already publishing." }, { status: 409 });
  }
  logScheduleEvent("info", "run_now", "Triggered manually", { jobId: job.id });

  await runScheduleCycle();

  const after = getJob(job.id)!;
  return NextResponse.json({ job: hydrateJob(after) });
}
