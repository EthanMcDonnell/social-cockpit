import { NextRequest, NextResponse } from "next/server";
import { getTimeZone, setTimeZone } from "@/lib/schedule/settings";
import { isValidTimeZone, zoneAbbreviation } from "@/lib/schedule/tz";
import { requireScheduleAuth } from "@/lib/schedule/auth";

export const dynamic = "force-dynamic";

function payload() {
  const timezone = getTimeZone();
  return {
    timezone,
    abbreviation: zoneAbbreviation(Date.now(), timezone),
    scheduler_enabled: process.env.SCHEDULER_ENABLED !== "false",
    dry_run: process.env.SCHEDULE_DRY_RUN === "true",
  };
}

/** GET /api/schedule/settings — the zone the calendar renders in, plus worker mode. */
export async function GET(request: NextRequest) {
  const denied = requireScheduleAuth(request);
  if (denied) return denied;
  return NextResponse.json(payload());
}

/** PUT /api/schedule/settings — body: { timezone: "America/Chicago" } */
export async function PUT(request: NextRequest) {
  const denied = requireScheduleAuth(request);
  if (denied) return denied;

  const body = await request.json().catch(() => ({}));
  const tz = body?.timezone;

  if (typeof tz !== "string" || !isValidTimeZone(tz)) {
    return NextResponse.json(
      { error: "invalid_param", message: "timezone must be a valid IANA zone, e.g. America/Chicago." },
      { status: 400 }
    );
  }

  setTimeZone(tz);
  return NextResponse.json(payload());
}
