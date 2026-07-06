import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export interface FlowStats {
  invited: number;   // openers sent
  rewarded: number;  // rewards sent to followers
  nudged: number;    // follow-prompt nudges sent
  expired: number;   // pending funnels culled by TTL without converting
}

/**
 * GET /api/automation-stats — per-flow funnel counters for the flow cards,
 * derived from the automation_events log. Read-only, keyed by flow_id. Counts
 * reflect the retained event window (30 days), same as the log itself.
 */
export async function GET() {
  try {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT flow_id, kind, COUNT(*) AS c
           FROM automation_events
          WHERE flow_id IS NOT NULL
            AND kind IN ('opener_sent','reward_sent','nudge_sent','expired')
          GROUP BY flow_id, kind`
      )
      .all() as { flow_id: string; kind: string; c: number }[];

    const stats: Record<string, FlowStats> = {};
    for (const r of rows) {
      const s = (stats[r.flow_id] ??= { invited: 0, rewarded: 0, nudged: 0, expired: 0 });
      if (r.kind === "opener_sent") s.invited = r.c;
      else if (r.kind === "reward_sent") s.rewarded = r.c;
      else if (r.kind === "nudge_sent") s.nudged = r.c;
      else if (r.kind === "expired") s.expired = r.c;
    }

    return NextResponse.json(stats);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: "internal", message }, { status: 500 });
  }
}
