import { NextResponse } from "next/server";
import { fetchUsageSnapshot } from "@/lib/instagram/usage";

export const dynamic = "force-dynamic";

/**
 * GET /api/instagram/usage — one lightweight Graph API read whose only purpose
 * is to report current rate-limit usage from the response headers. Touches no
 * DB. Each call costs exactly one API call against the quota it measures.
 */
export async function GET() {
  try {
    const snapshot = await fetchUsageSnapshot();
    return NextResponse.json(snapshot);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: "usage_check_failed", message }, { status: 502 });
  }
}
