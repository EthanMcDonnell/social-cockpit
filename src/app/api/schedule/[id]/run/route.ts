import { NextRequest, NextResponse } from "next/server";
import { getJob, updateJob, logScheduleEvent } from "@/lib/schedule/store";
import { runScheduleCycle, schedulerEnabled } from "@/lib/schedule/worker";
import { hydrateJob } from "@/lib/schedule/view";
import { requireScheduleAuth } from "@/lib/schedule/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

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
  // very act of asking can't immediately mark it missed.
  updateJob(job.id, {
    status: "pending",
    scheduledAt: Date.now(),
    attempts: 0,
    nextAttemptAt: null,
    result: null,
    containerId: null,
    graceMinutes: Math.max(job.grace_minutes, 60),
  });
  logScheduleEvent("info", "run_now", "Triggered manually", { jobId: job.id });

  await runScheduleCycle();

  const after = getJob(job.id)!;
  return NextResponse.json({ job: hydrateJob(after) });
}
