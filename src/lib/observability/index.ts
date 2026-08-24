import { getEventsDb, type SystemEventRow } from "./db";
import { EVENTS_RETENTION_DAYS } from "@/lib/retention";

/**
 * One call that both prints and persists.
 *
 * The split this replaces was the whole problem: a failure reached the terminal
 * via console.error and reached the UI only if the author separately remembered
 * a logEvent. Two mechanisms means drift, and the drift was one-directional —
 * every worker had console lines, only two had a table. Here the terminal line
 * and the row are the same statement, so a warning cannot exist in one place
 * and not the other.
 *
 * Never throws. Observability failing must not take a worker with it, so a
 * broken events.db degrades to console-only rather than to an outage.
 */

/** Which subsystem is speaking. The UI's first-line filter. */
export type EventSource =
  | "automation"
  | "schedule"
  | "cache"
  | "token"
  | "transcription"
  | "instagram"
  | "db"
  | "api";

export interface ReportOptions {
  /** Structured context for the log row. */
  meta?: Record<string, unknown>;
  /** The thrown value, if any — its message is appended and its stack stored. */
  error?: unknown;
}

/** Stacks are for debugging one row, not for filling a disk. */
const MAX_STACK_CHARS = 1200;

function describe(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    // `cause` is where InstagramTransportError puts the original network fault,
    // and it is usually the only part that says what actually went wrong.
    const cause = error.cause;
    const causeMsg =
      cause instanceof Error ? ` (cause: ${cause.message})` : cause ? ` (cause: ${String(cause)})` : "";
    return {
      message: `${error.message}${causeMsg}`,
      stack: error.stack ? error.stack.slice(0, MAX_STACK_CHARS) : undefined,
    };
  }
  return { message: String(error) };
}

function persist(
  source: EventSource,
  level: "info" | "warn" | "error",
  kind: string,
  message: string,
  meta: Record<string, unknown> | undefined
): void {
  try {
    getEventsDb()
      .prepare(
        "INSERT INTO system_events (source, level, kind, message, meta) VALUES (?, ?, ?, ?, ?)"
      )
      .run(source, level, kind, message, meta === undefined ? null : JSON.stringify(meta));
    maybePrune();
  } catch (err) {
    // Deliberately console-only. Routing this through report() would recurse
    // straight back into the write that just failed.
    console.error("[observability] could not persist event:", err);
  }
}

function report(
  source: EventSource,
  level: "warn" | "error",
  kind: string,
  message: string,
  opts: ReportOptions = {}
): void {
  const detail = opts.error === undefined ? null : describe(opts.error);
  const full = detail ? `${message}: ${detail.message}` : message;

  // Terminal output keeps the shape it always had — "[source] message" plus the
  // raw error object, which is still richer than any string we could store.
  if (level === "error") console.error(`[${source}] ${message}`, opts.error ?? "");
  else console.warn(`[${source}] ${message}`, opts.error ?? "");

  const meta = { ...(opts.meta ?? {}), ...(detail?.stack ? { stack: detail.stack } : {}) };
  persist(source, level, kind, full, Object.keys(meta).length > 0 ? meta : undefined);
}

export function reportWarn(
  source: EventSource,
  kind: string,
  message: string,
  opts?: ReportOptions
): void {
  report(source, "warn", kind, message, opts);
}

export function reportError(
  source: EventSource,
  kind: string,
  message: string,
  opts?: ReportOptions
): void {
  report(source, "error", kind, message, opts);
}

// ─── Retention ───────────────────────────────────────────────────────────────

/**
 * Piggy-backed on writes rather than given its own interval.
 *
 * This table is only ever appended to by workers that are already running on a
 * timer, so a write is a free wake-up. An hourly throttle keeps the DELETE off
 * the hot path of a burst — a hundred failures in one minute cost one cull, not
 * a hundred.
 */
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;
let lastPruneAt = 0;

function maybePrune(): void {
  const now = Date.now();
  if (now - lastPruneAt < PRUNE_INTERVAL_MS) return;
  lastPruneAt = now;
  try {
    getEventsDb()
      .prepare("DELETE FROM system_events WHERE created_at < datetime('now', ?)")
      .run(`-${EVENTS_RETENTION_DAYS} days`);
  } catch {
    /* a failed cull costs disk, not correctness */
  }
}

// ─── Reads (for /api/logs) ───────────────────────────────────────────────────

export function listSystemEvents(limit: number): SystemEventRow[] {
  return getEventsDb()
    .prepare(
      `SELECT id, source, level, kind, message, meta, created_at
         FROM system_events ORDER BY id DESC LIMIT ?`
    )
    .all(limit) as SystemEventRow[];
}

export function countSystemEventsByLevel(): Record<string, number> {
  const rows = getEventsDb()
    .prepare("SELECT level, COUNT(*) AS c FROM system_events GROUP BY level")
    .all() as { level: string; c: number }[];
  const out: Record<string, number> = {};
  for (const r of rows) out[r.level] = r.c;
  return out;
}

export function clearSystemEvents(): number {
  return getEventsDb().prepare("DELETE FROM system_events").run().changes;
}

export type { SystemEventRow };
