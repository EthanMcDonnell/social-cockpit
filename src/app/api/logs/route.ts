import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  listSystemEvents,
  countSystemEventsByLevel,
  clearSystemEvents,
} from "@/lib/observability";

export const dynamic = "force-dynamic";

/**
 * GET /api/logs — every worker's warnings and errors in one stream.
 *
 * Three tables across two files feed this: system_events (events.db) plus the
 * two funnel logs already in automations.db. They are merged rather than
 * consolidated because they answer different questions — automation_events is
 * "did my DM go out", system_events is "is anything broken" — and the second
 * question is the one that had no UI at all before.
 *
 * `stream` says which table a row came from (it is what Clear acts on).
 * `source` says which subsystem produced it, and is the filter worth reaching
 * for: system_events carries its own, the funnel logs are constant.
 */

export type LogStream = "system" | "automation" | "schedule";

export interface LogRow {
  id: string;
  stream: LogStream;
  source: string;
  level: "info" | "warn" | "error";
  kind: string;
  message: string | null;
  meta: string | null;
  /** Flow/recipient for automation rows, job id for scheduler rows. */
  ref: string | null;
  created_at: string;
}

interface Counts {
  info: number;
  warn: number;
  error: number;
}

const EMPTY: Counts = { info: 0, warn: 0, error: 0 };

function bump(counts: Counts, level: string, n: number): void {
  if (level === "info" || level === "warn" || level === "error") counts[level] += n;
}

/**
 * Every read is individually guarded. A single missing or locked table must
 * degrade to "that stream is empty" rather than blanking the whole page — the
 * page you open precisely when something is broken is the worst possible place
 * for one broken source to take out the other two.
 */
function safely<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function readSystem(limit: number): LogRow[] {
  return safely(
    () =>
      listSystemEvents(limit).map((e) => ({
        id: `sys-${e.id}`,
        stream: "system" as const,
        source: e.source,
        level: e.level,
        kind: e.kind,
        message: e.message,
        meta: e.meta,
        ref: null,
        created_at: e.created_at,
      })),
    []
  );
}

function readAutomation(limit: number): LogRow[] {
  return safely(() => {
    const rows = getDb()
      .prepare(
        `SELECT id, flow_id, recipient_id, level, kind, message, meta, created_at
           FROM automation_events ORDER BY id DESC LIMIT ?`
      )
      .all(limit) as {
      id: number;
      flow_id: string | null;
      recipient_id: string | null;
      level: LogRow["level"];
      kind: string;
      message: string | null;
      meta: string | null;
      created_at: string;
    }[];
    return rows.map((e) => ({
      id: `auto-${e.id}`,
      stream: "automation" as const,
      source: "automation",
      level: e.level,
      kind: e.kind,
      message: e.message,
      meta: e.meta,
      ref: e.recipient_id ?? (e.flow_id ? e.flow_id.slice(0, 8) : null),
      created_at: e.created_at,
    }));
  }, []);
}

function readSchedule(limit: number): LogRow[] {
  return safely(() => {
    const rows = getDb()
      .prepare(
        `SELECT id, job_id, level, kind, message, meta, created_at
           FROM schedule_events ORDER BY id DESC LIMIT ?`
      )
      .all(limit) as {
      id: number;
      job_id: string | null;
      level: LogRow["level"];
      kind: string;
      message: string | null;
      meta: string | null;
      created_at: string;
    }[];
    return rows.map((e) => ({
      id: `sched-${e.id}`,
      stream: "schedule" as const,
      source: "schedule",
      level: e.level,
      kind: e.kind,
      message: e.message,
      meta: e.meta,
      ref: e.job_id ? e.job_id.slice(0, 8) : null,
      created_at: e.created_at,
    }));
  }, []);
}

/** Level tallies over the whole of every table, so the badge never moves when a filter does. */
function totalCounts(): Counts {
  const counts: Counts = { ...EMPTY };

  const sys = safely(() => countSystemEventsByLevel(), {});
  for (const [level, n] of Object.entries(sys)) bump(counts, level, n);

  for (const table of ["automation_events", "schedule_events"]) {
    const rows = safely(
      () =>
        getDb()
          .prepare(`SELECT level, COUNT(*) AS c FROM ${table} GROUP BY level`)
          .all() as { level: string; c: number }[],
      []
    );
    for (const r of rows) bump(counts, r.level, r.c);
  }
  return counts;
}

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const limit = Math.min(Math.max(Number(sp.get("limit")) || 300, 1), 1000);

    const levels = (sp.get("level") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s === "info" || s === "warn" || s === "error");
    const sources = (sp.get("source") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const kind = sp.get("kind")?.trim() || null;

    // Each table is read to `limit` and merged, so the newest `limit` overall is
    // always present no matter how lopsided the three streams are.
    const all = [...readSystem(limit), ...readAutomation(limit), ...readSchedule(limit)];

    // All three write datetime('now') — the same UTC "YYYY-MM-DD HH:MM:SS" — so
    // a string sort is a chronological sort, no parsing required.
    all.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));

    const filtered = all
      .filter(
        (e) =>
          (levels.length === 0 || levels.includes(e.level)) &&
          (sources.length === 0 || sources.includes(e.source)) &&
          (!kind || e.kind === kind)
      )
      .slice(0, limit);

    // Dropdown options come from the merged window rather than a DISTINCT per
    // table — what you can filter to is then exactly what you can see.
    const kinds = Array.from(new Set(all.map((e) => e.kind))).sort();
    const sourceNames = Array.from(new Set(all.map((e) => e.source))).sort();

    return NextResponse.json({
      events: filtered,
      counts: totalCounts(),
      kinds,
      sources: sourceNames,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: "internal", message }, { status: 500 });
  }
}

/**
 * DELETE /api/logs?stream=system|automation|schedule|all — wipe a log.
 *
 * Observability only: the workers keep their real state in automation_flows,
 * scheduled_posts and the cursor tables, so clearing this changes what you can
 * read about the past and nothing about what happens next.
 */
export async function DELETE(request: NextRequest) {
  try {
    const stream = request.nextUrl.searchParams.get("stream") ?? "all";
    let deleted = 0;

    if (stream === "system" || stream === "all") {
      deleted += safely(() => clearSystemEvents(), 0);
    }
    if (stream === "automation" || stream === "all") {
      deleted += safely(() => getDb().prepare("DELETE FROM automation_events").run().changes, 0);
    }
    if (stream === "schedule" || stream === "all") {
      deleted += safely(() => getDb().prepare("DELETE FROM schedule_events").run().changes, 0);
    }

    return NextResponse.json({ success: true, deleted });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: "internal", message }, { status: 500 });
  }
}
