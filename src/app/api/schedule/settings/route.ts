import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import {
  getTimeZone,
  setTimeZone,
  getSuggestedTimes,
  setSuggestedTimes,
  getMaxPostsPerDay,
  setMaxPostsPerDay,
  getMinSameVideoDays,
  setMinSameVideoDays,
} from "@/lib/schedule/settings";
import { isValidTimeZone, zoneAbbreviation } from "@/lib/schedule/tz";
import { requireScheduleAuth } from "@/lib/schedule/auth";

export const dynamic = "force-dynamic";

function payload() {
  const timezone = getTimeZone();
  return {
    timezone,
    abbreviation: zoneAbbreviation(Date.now(), timezone),
    scheduler_enabled: config.schedule.enabled,
    dry_run: config.schedule.dryRun,
    // Posting policy. Unlike the two flags above, these are stored and editable
    // without restarting the server.
    suggested_times: getSuggestedTimes(),
    max_posts_per_day: getMaxPostsPerDay(),
    min_same_video_days: getMinSameVideoDays(),
  };
}

/** GET /api/schedule/settings — display zone, worker mode, and posting policy. */
export async function GET(request: NextRequest) {
  const denied = requireScheduleAuth(request);
  if (denied) return denied;
  return NextResponse.json(payload());
}

/**
 * PUT /api/schedule/settings — update any subset of the stored settings.
 *
 *   { "timezone": "America/Chicago",
 *     "suggested_times": ["09:30", "18:00"],
 *     "max_posts_per_day": 2,
 *     "min_same_video_days": 2 }
 *
 * Only keys that are present are touched, so a client can change one setting
 * without having to echo back the rest and risk clobbering a concurrent edit.
 */
export async function PUT(request: NextRequest) {
  const denied = requireScheduleAuth(request);
  if (denied) return denied;

  const body = await request.json().catch(() => ({}));
  const invalid = (message: string) =>
    NextResponse.json({ error: "invalid_param", message }, { status: 400 });

  if (body?.timezone !== undefined) {
    if (typeof body.timezone !== "string" || !isValidTimeZone(body.timezone)) {
      return invalid("timezone must be a valid IANA zone, e.g. America/Chicago.");
    }
    setTimeZone(body.timezone);
  }

  if (body?.suggested_times !== undefined) {
    if (!Array.isArray(body.suggested_times)) {
      return invalid('suggested_times must be an array of "HH:MM" strings.');
    }
    try {
      setSuggestedTimes(body.suggested_times);
    } catch (err) {
      return invalid(err instanceof Error ? err.message : "Bad suggested_times.");
    }
  }

  if (body?.max_posts_per_day !== undefined) {
    try {
      setMaxPostsPerDay(Number(body.max_posts_per_day));
    } catch (err) {
      return invalid(err instanceof Error ? err.message : "Bad max_posts_per_day.");
    }
  }

  if (body?.min_same_video_days !== undefined) {
    try {
      setMinSameVideoDays(Number(body.min_same_video_days));
    } catch (err) {
      return invalid(err instanceof Error ? err.message : "Bad min_same_video_days.");
    }
  }

  return NextResponse.json(payload());
}
