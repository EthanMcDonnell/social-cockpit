import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { runAutomationCycle, runFollowConfirmPoll } from "@/lib/automation-worker";

export const dynamic = "force-dynamic";

// POST /api/automation-flows/trigger
// Runs the automation cycle immediately and returns basic stats.
// Accepts optional ?resetActivatedAt=true to clear activated_at on all flows
// so they re-initialize from created_at (fixes flows where activated_at was
// set to a time after the comments you want to catch).
export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const resetActivatedAt = searchParams.get("resetActivatedAt") === "true";

  if (resetActivatedAt) {
    const db = getDb();
    const info = db
      .prepare("UPDATE automation_flows SET activated_at = NULL WHERE activated_at IS NOT NULL")
      .run();
    console.log(`[automation/trigger] reset activated_at on ${info.changes} flow(s)`);
  }

  try {
    await runAutomationCycle();
    // Also run the comment_to_follow_dm confirm poll so a manual trigger
    // processes confirm taps too (isolated so a poll failure won't fail here).
    await runFollowConfirmPoll().catch((err) =>
      console.error("[automation/trigger] follow-confirm poll error:", err)
    );
    return NextResponse.json({ ok: true, message: "Automation cycle complete. Check server logs for details." });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
