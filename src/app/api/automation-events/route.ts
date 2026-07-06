import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export interface AutomationEventRow {
  id: number;
  flow_id: string | null;
  recipient_id: string | null;
  comment_id: string | null;
  level: "info" | "warn" | "error";
  kind: string;
  message: string | null;
  meta: string | null;
  created_at: string;
}

/**
 * GET /api/automation-events?level=&kind=&limit= — read-only view of the
 * automation_events log, newest-first, for the /automations/logs page and the
 * failure-count badge. Mirrors the usage-meter pattern: the page never writes.
 *
 * `level` accepts a comma-separated list (e.g. "warn,error"). `counts` is
 * always computed over the full table (unfiltered) so the badge is stable.
 */
export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const sp = request.nextUrl.searchParams;

    const levels = (sp.get("level") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s === "info" || s === "warn" || s === "error");
    const kind = sp.get("kind")?.trim() || null;
    const limit = Math.min(Math.max(Number(sp.get("limit")) || 200, 1), 1000);

    const where: string[] = [];
    const args: (string | number)[] = [];
    if (levels.length > 0) {
      where.push(`level IN (${levels.map(() => "?").join(",")})`);
      args.push(...levels);
    }
    if (kind) {
      where.push("kind = ?");
      args.push(kind);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const events = db
      .prepare(
        `SELECT id, flow_id, recipient_id, comment_id, level, kind, message, meta, created_at
           FROM automation_events ${whereSql}
          ORDER BY id DESC LIMIT ?`
      )
      .all(...args, limit) as AutomationEventRow[];

    const countRows = db
      .prepare("SELECT level, COUNT(*) AS c FROM automation_events GROUP BY level")
      .all() as { level: string; c: number }[];
    const counts = { info: 0, warn: 0, error: 0 };
    for (const r of countRows) {
      if (r.level === "info" || r.level === "warn" || r.level === "error") counts[r.level] = r.c;
    }

    // Distinct kinds for the filter dropdown.
    const kinds = (
      db.prepare("SELECT DISTINCT kind FROM automation_events ORDER BY kind").all() as { kind: string }[]
    ).map((k) => k.kind);

    return NextResponse.json({ events, counts, kinds });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: "internal", message }, { status: 500 });
  }
}
