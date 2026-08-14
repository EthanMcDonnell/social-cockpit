import { NextRequest, NextResponse } from "next/server";
import {
  getJob,
  updateJob,
  deleteJob,
  listScheduleEvents,
  logScheduleEvent,
} from "@/lib/schedule/store";
import { releaseStaged } from "@/lib/schedule/media";
import { hydrateJob } from "@/lib/schedule/view";
import { getTimeZone, getMaxPostsPerDay } from "@/lib/schedule/settings";
import { checkDailyCap } from "@/lib/schedule/capacity";
import { parseScheduledAt } from "@/lib/schedule/tz";
import { requireScheduleAuth } from "@/lib/schedule/auth";
import { validatePublish } from "@/lib/instagram/publish-flow";
import type { PublishInput } from "@/lib/instagram/endpoints/publish";
import type { JobPatch } from "@/lib/schedule/store";
import type { ScheduledPost, YoutubeJobPayload } from "@/lib/schedule/types";

export const dynamic = "force-dynamic";

/** A job mid-flight can't be edited — the worker is already acting on it. */
function isLocked(job: ScheduledPost): boolean {
  return job.status === "publishing" || job.status === "finalizing";
}

const notFound = () =>
  NextResponse.json({ error: "not_found", message: "No such scheduled post." }, { status: 404 });

const locked = () =>
  NextResponse.json(
    { error: "conflict", message: "This post is publishing right now and can't be changed." },
    { status: 409 }
  );

/** GET /api/schedule/:id — one job plus its event history. */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const denied = requireScheduleAuth(request);
  if (denied) return denied;

  const job = getJob(params.id);
  if (!job) return notFound();

  return NextResponse.json({
    job: hydrateJob(job),
    events: listScheduleEvents({ jobId: job.id, limit: 100 }),
    timezone: getTimeZone(),
  });
}

/**
 * PATCH /api/schedule/:id — reschedule, edit, pause, or resume.
 *
 * Body may carry `scheduled_at`, any payload field, `grace_minutes`,
 * `automation`, or `status: "paused" | "pending"`.
 *
 * Setting a new time on a job that already failed or was missed also resets it:
 * attempts go back to zero and it returns to `pending`. That's what "reschedule"
 * means from the calendar — otherwise a retried job would arrive already out of
 * attempts.
 */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const denied = requireScheduleAuth(request);
  if (denied) return denied;

  const job = getJob(params.id);
  if (!job) return notFound();
  if (isLocked(job)) return locked();

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { error: "bad_request", message: "Body must be valid JSON" },
      { status: 400 }
    );
  }

  const patch: JobPatch = {};
  const timeZone = getTimeZone();

  if (body.scheduled_at != null) {
    const ms = parseScheduledAt(body.scheduled_at, timeZone);
    if (ms == null) {
      return NextResponse.json(
        { error: "invalid_param", message: "Could not read scheduled_at." },
        { status: 400 }
      );
    }
    // Same ceiling as creation. This job is excluded from the count, so moving
    // it *within* a day that is already at capacity isn't blocked by itself.
    const cap = checkDailyCap(ms, timeZone, getMaxPostsPerDay(), job.id);
    if (!cap.allowed) {
      return NextResponse.json({ error: "day_full", message: cap.message }, { status: 409 });
    }

    patch.scheduledAt = ms;
    // Moving a finished-unhappily job back onto the calendar revives it.
    if (job.status === "failed" || job.status === "missed" || job.status === "cancelled") {
      patch.status = "pending";
      patch.nextAttemptAt = null;
      patch.result = null;
      patch.containerId = null;
      patch.attempts = 0;
    }
  }

  if (body.status != null) {
    if (body.status !== "paused" && body.status !== "pending") {
      return NextResponse.json(
        { error: "invalid_param", message: 'status may only be set to "paused" or "pending".' },
        { status: 400 }
      );
    }
    patch.status = body.status;
    if (body.status === "pending") patch.nextAttemptAt = null;
  }

  if (body.grace_minutes != null) {
    const g = Number(body.grace_minutes);
    if (!Number.isFinite(g) || g < 0) {
      return NextResponse.json(
        { error: "invalid_param", message: "grace_minutes must be a non-negative number." },
        { status: 400 }
      );
    }
    patch.graceMinutes = g;
  }

  if (body.automation !== undefined) patch.automation = body.automation ?? null;

  // Payload edits: merge, then re-validate exactly as the create path does.
  if (body.payload && typeof body.payload === "object") {
    const merged = { ...job.payload, ...body.payload };
    if (job.platform === "ig") {
      const problem = validatePublish({
        ...(merged as PublishInput),
        r2: previewFrom(job),
      });
      if (problem) {
        return NextResponse.json({ error: "invalid_param", message: problem }, { status: 400 });
      }
    } else if (!(merged as YoutubeJobPayload).title?.trim()) {
      return NextResponse.json(
        { error: "invalid_param", message: "title is required for a YouTube post" },
        { status: 400 }
      );
    }
    patch.payload = merged;
  }

  const updated = updateJob(job.id, patch);
  logScheduleEvent("info", "updated", describePatch(patch), { jobId: job.id });

  return NextResponse.json({ job: hydrateJob(updated!), timezone: timeZone });
}

/** DELETE /api/schedule/:id — cancel and clean up any media we own. */
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const denied = requireScheduleAuth(request);
  if (denied) return denied;

  const job = getJob(params.id);
  if (!job) return notFound();
  if (isLocked(job)) return locked();

  await releaseStaged(job.media.map((m) => m.staged_id));
  deleteJob(job.id);
  logScheduleEvent("info", "cancelled", "Cancelled from the calendar", { jobId: job.id });

  return NextResponse.json({ ok: true, id: job.id });
}

// ── helpers ──

/** Synthetic source map so payload edits validate like the create path. */
function previewFrom(job: ScheduledPost) {
  const r2: { video_url?: string; image_url?: string; cover_url?: string; children?: (string | null)[] } = {};
  for (const m of job.media) {
    if (m.role === "video") r2.video_url = m.staged_id;
    if (m.role === "image") r2.image_url = m.staged_id;
    if (m.role === "cover") r2.cover_url = m.staged_id;
    if (m.role === "child") {
      r2.children ??= [];
      r2.children[m.index ?? r2.children.length] = m.staged_id;
    }
  }
  return r2;
}

function describePatch(patch: JobPatch): string {
  const bits: string[] = [];
  if (patch.scheduledAt != null) bits.push(`time → ${new Date(patch.scheduledAt).toISOString()}`);
  if (patch.status) bits.push(`status → ${patch.status}`);
  if (patch.payload) bits.push("payload edited");
  if (patch.automation !== undefined) bits.push("automation edited");
  if (patch.graceMinutes != null) bits.push(`grace → ${patch.graceMinutes}m`);
  return bits.join(", ") || "no-op";
}
