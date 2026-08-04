import { NextRequest, NextResponse } from "next/server";
import { listScheduleEvents } from "@/lib/schedule/store";
import { requireScheduleAuth } from "@/lib/schedule/auth";

export const dynamic = "force-dynamic";

/** GET /api/schedule/events?job_id=&limit= — scheduler activity log. */
export async function GET(request: NextRequest) {
  const denied = requireScheduleAuth(request);
  if (denied) return denied;

  const q = request.nextUrl.searchParams;
  const limit = Number(q.get("limit"));

  return NextResponse.json({
    events: listScheduleEvents({
      jobId: q.get("job_id") ?? undefined,
      limit: Number.isFinite(limit) && limit > 0 ? limit : 100,
    }),
  });
}
