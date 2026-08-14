import { NextRequest, NextResponse } from "next/server";
import { createJob, listJobs, type ListJobsFilter } from "@/lib/schedule/store";
import { parseScheduleBody, isFailure, type ScheduleRequestBody } from "@/lib/schedule/input";
import { hydrateJob, hydrateJobs } from "@/lib/schedule/view";
import { logScheduleEvent } from "@/lib/schedule/store";
import { getTimeZone, getMaxPostsPerDay } from "@/lib/schedule/settings";
import { checkDailyCap } from "@/lib/schedule/capacity";
import { requireScheduleAuth } from "@/lib/schedule/auth";
import type { ScheduleStatus, SchedulePlatform } from "@/lib/schedule/types";

export const dynamic = "force-dynamic";

/** Hard ceiling on rows per request, whatever `limit` asks for. */
const MAX_LIMIT = 1000;

const ALL_STATUSES: ScheduleStatus[] = [
  "pending",
  "publishing",
  "finalizing",
  "published",
  "failed",
  "missed",
  "cancelled",
  "paused",
];

/**
 * GET /api/schedule?from=&to=&status=&platform=&limit=
 *
 * `from`/`to` are epoch ms or ISO strings and bound the calendar's current
 * window. Returns jobs with their media resolved and liveness-checked.
 */
export async function GET(request: NextRequest) {
  const denied = requireScheduleAuth(request);
  if (denied) return denied;

  const q = request.nextUrl.searchParams;
  const filter: ListJobsFilter = {};

  const num = (raw: string | null): number | undefined => {
    if (!raw) return undefined;
    const n = /^\d+$/.test(raw) ? Number(raw) : Date.parse(raw);
    return Number.isFinite(n) ? n : undefined;
  };

  filter.from = num(q.get("from"));
  filter.to = num(q.get("to"));

  const statuses = q.getAll("status").flatMap((s) => s.split(","));
  const valid = statuses.filter((s): s is ScheduleStatus =>
    ALL_STATUSES.includes(s as ScheduleStatus)
  );
  if (valid.length) filter.status = valid;

  const platform = q.get("platform");
  if (platform === "ig" || platform === "yt") filter.platform = platform as SchedulePlatform;

  const limit = num(q.get("limit"));
  const effectiveLimit = limit ? Math.min(limit, MAX_LIMIT) : undefined;
  if (effectiveLimit) filter.limit = effectiveLimit;

  const jobs = hydrateJobs(listJobs(filter));

  return NextResponse.json({
    timezone: getTimeZone(),
    /**
     * True when the row cap clipped the result, so the caller is holding a
     * partial view of the window.
     *
     * Reported rather than left to be inferred. The MCP server used to compare
     * the row count against its own copy of this cap, which works only while
     * the two numbers agree — lower MAX_LIMIT here and that check silently
     * stops firing, and a *short* calendar is the dangerous kind: slots look
     * free because the jobs holding them weren't returned.
     */
    truncated: effectiveLimit !== undefined && jobs.length >= effectiveLimit,
    jobs,
  });
}

/**
 * POST /api/schedule — schedule a post.
 *
 * The body is a POST /api/publish/local body plus `scheduled_at`. Nothing is
 * uploaded anywhere by this call: filesystem sources are validated and recorded
 * in place, and the bytes stay on your disk until the slot arrives.
 *
 *   curl -X POST localhost:3000/api/schedule -H 'Content-Type: application/json' -d '{
 *     "scheduled_at": "2026-08-12T09:30",
 *     "video_path": "/Users/me/clips/summer-v3.mp4",
 *     "caption": "Comment LINK for the guide 👇",
 *     "automation": { "key": "summer-giveaway" }
 *   }'
 */
export async function POST(request: NextRequest) {
  const denied = requireScheduleAuth(request);
  if (denied) return denied;

  let body: ScheduleRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "bad_request", message: "Body must be valid JSON" },
      { status: 400 }
    );
  }

  const parsed = await parseScheduleBody(body);
  if (isFailure(parsed)) {
    return NextResponse.json(
      { error: parsed.code, message: parsed.error },
      { status: parsed.status }
    );
  }

  // Hard daily ceiling. Checked here rather than inside parseScheduleBody
  // because it is a property of the calendar, not of the request: the same body
  // is acceptable or not depending on what else is booked that day.
  const cap = checkDailyCap(parsed.job.scheduledAt, getTimeZone(), getMaxPostsPerDay());
  if (!cap.allowed) {
    return NextResponse.json({ error: "day_full", message: cap.message }, { status: 409 });
  }

  const job = createJob(parsed.job);
  logScheduleEvent("info", "scheduled", `Scheduled for ${new Date(job.scheduled_at).toISOString()}`, {
    jobId: job.id,
    meta: { platform: job.platform, media: job.media.length, automation: !!job.automation },
  });

  return NextResponse.json({ job: hydrateJob(job), timezone: getTimeZone() }, { status: 201 });
}
