/**
 * Every read and write against the scheduler's tables.
 *
 * The scheduler holds no state in memory — `scheduled_posts` *is* the state
 * machine. The worker is a stateless poll over this module, and the calendar
 * edits a job by writing a row, so the two can never disagree about what's
 * scheduled. Server-side only.
 */

import { randomUUID } from "crypto";
import { EVENTS_RETENTION_DAYS } from "@/lib/retention";
import { config } from "@/lib/config";
import { getDb } from "@/lib/db";
import type {
  FailureKind,
  ScheduleEvent,
  ScheduleStatus,
  ScheduledMediaRef,
  ScheduledPost,
  SchedulePayload,
  SchedulePlatform,
  ScheduleResult,
  AutomationSpec,
} from "./types";

/**
 * How long a claimed job may stay `publishing` before another tick assumes the
 * process died and requeues it. Must comfortably exceed the longest legitimate
 * publish — a reel with automation waits up to 5 min for processing — or a slow
 * publish would be requeued while it's still running.
 */
export const LEASE_MS = 15 * 60 * 1000;


interface ScheduledPostRow {
  id: string;
  platform: string;
  status: string;
  scheduled_at: number;
  payload: string;
  media: string;
  automation: string | null;
  attempts: number;
  max_attempts: number;
  next_attempt_at: number | null;
  lease_until: number | null;
  grace_minutes: number;
  container_id: string | null;
  result: string | null;
  created_at: string;
  updated_at: string;
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function rowToPost(row: ScheduledPostRow): ScheduledPost {
  return {
    id: row.id,
    platform: row.platform as SchedulePlatform,
    status: row.status as ScheduleStatus,
    scheduled_at: row.scheduled_at,
    payload: parseJson<SchedulePayload>(row.payload, {} as SchedulePayload),
    media: parseJson<ScheduledMediaRef[]>(row.media, []),
    automation: row.automation ? parseJson<AutomationSpec>(row.automation, {}) : undefined,
    attempts: row.attempts,
    max_attempts: row.max_attempts,
    next_attempt_at: row.next_attempt_at ?? undefined,
    grace_minutes: row.grace_minutes,
    container_id: row.container_id ?? undefined,
    result: row.result ? parseJson<ScheduleResult>(row.result, {}) : undefined,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ─── Create ──────────────────────────────────────────────────────────────────

export interface CreateJobInput {
  platform: SchedulePlatform;
  scheduledAt: number;
  payload: SchedulePayload;
  media: ScheduledMediaRef[];
  automation?: AutomationSpec;
  graceMinutes?: number;
  maxAttempts?: number;
  status?: ScheduleStatus;
}

export function createJob(input: CreateJobInput): ScheduledPost {
  const db = getDb();
  const id = randomUUID();

  db.prepare(
    `INSERT INTO scheduled_posts
       (id, platform, status, scheduled_at, payload, media, automation,
        max_attempts, grace_minutes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.platform,
    input.status ?? "pending",
    input.scheduledAt,
    JSON.stringify(input.payload),
    JSON.stringify(input.media),
    input.automation ? JSON.stringify(input.automation) : null,
    input.maxAttempts ?? 3,
    input.graceMinutes ?? defaultGraceMinutes()
  );

  return getJob(id)!;
}

export function defaultGraceMinutes(): number {
  return config.schedule.graceMinutes;
}

// ─── Read ────────────────────────────────────────────────────────────────────

export function getJob(id: string): ScheduledPost | null {
  const row = getDb()
    .prepare("SELECT * FROM scheduled_posts WHERE id = ?")
    .get(id) as ScheduledPostRow | undefined;
  return row ? rowToPost(row) : null;
}

export interface ListJobsFilter {
  /** Epoch ms, inclusive. */
  from?: number;
  /** Epoch ms, exclusive. */
  to?: number;
  status?: ScheduleStatus[];
  platform?: SchedulePlatform;
  limit?: number;
}

export function listJobs(filter: ListJobsFilter = {}): ScheduledPost[] {
  const where: string[] = [];
  const params: (string | number)[] = [];

  if (filter.from != null) {
    where.push("scheduled_at >= ?");
    params.push(filter.from);
  }
  if (filter.to != null) {
    where.push("scheduled_at < ?");
    params.push(filter.to);
  }
  if (filter.status?.length) {
    where.push(`status IN (${filter.status.map(() => "?").join(",")})`);
    params.push(...filter.status);
  }
  if (filter.platform) {
    where.push("platform = ?");
    params.push(filter.platform);
  }

  const sql =
    "SELECT * FROM scheduled_posts" +
    (where.length ? ` WHERE ${where.join(" AND ")}` : "") +
    " ORDER BY scheduled_at ASC" +
    (filter.limit ? " LIMIT ?" : "");
  if (filter.limit) params.push(filter.limit);

  return (getDb().prepare(sql).all(...params) as ScheduledPostRow[]).map(rowToPost);
}

/** Every staged-media id still referenced by a job — used by the sweep. */
export function referencedStagedIds(): Set<string> {
  const rows = getDb().prepare("SELECT media FROM scheduled_posts").all() as {
    media: string;
  }[];
  const ids = new Set<string>();
  for (const row of rows) {
    for (const ref of parseJson<ScheduledMediaRef[]>(row.media, [])) {
      if (ref.staged_id) ids.add(ref.staged_id);
    }
  }
  return ids;
}

// ─── Update ──────────────────────────────────────────────────────────────────

export interface JobPatch {
  status?: ScheduleStatus;
  scheduledAt?: number;
  /** Set to 0 when rescheduling a failed job, so it arrives with a full budget. */
  attempts?: number;
  payload?: SchedulePayload;
  media?: ScheduledMediaRef[];
  automation?: AutomationSpec | null;
  graceMinutes?: number;
  maxAttempts?: number;
  nextAttemptAt?: number | null;
  leaseUntil?: number | null;
  containerId?: string | null;
  result?: ScheduleResult | null;
}

export function updateJob(id: string, patch: JobPatch): ScheduledPost | null {
  const sets: string[] = [];
  const params: (string | number | null)[] = [];

  const put = (column: string, value: string | number | null) => {
    sets.push(`${column} = ?`);
    params.push(value);
  };

  if (patch.status !== undefined) put("status", patch.status);
  if (patch.scheduledAt !== undefined) put("scheduled_at", patch.scheduledAt);
  if (patch.attempts !== undefined) put("attempts", patch.attempts);
  if (patch.payload !== undefined) put("payload", JSON.stringify(patch.payload));
  if (patch.media !== undefined) put("media", JSON.stringify(patch.media));
  if (patch.automation !== undefined) {
    put("automation", patch.automation ? JSON.stringify(patch.automation) : null);
  }
  if (patch.graceMinutes !== undefined) put("grace_minutes", patch.graceMinutes);
  if (patch.maxAttempts !== undefined) put("max_attempts", patch.maxAttempts);
  if (patch.nextAttemptAt !== undefined) put("next_attempt_at", patch.nextAttemptAt);
  if (patch.leaseUntil !== undefined) put("lease_until", patch.leaseUntil);
  if (patch.containerId !== undefined) put("container_id", patch.containerId);
  if (patch.result !== undefined) {
    put("result", patch.result ? JSON.stringify(patch.result) : null);
  }

  if (!sets.length) return getJob(id);

  sets.push("updated_at = datetime('now')");
  getDb()
    .prepare(`UPDATE scheduled_posts SET ${sets.join(", ")} WHERE id = ?`)
    .run(...params, id);

  return getJob(id);
}

export function deleteJob(id: string): boolean {
  const info = getDb().prepare("DELETE FROM scheduled_posts WHERE id = ?").run(id);
  return info.changes > 0;
}

// ─── Worker claim / recovery ─────────────────────────────────────────────────

/**
 * Atomically claim the next due job, or return null.
 *
 * The `AND status = 'pending'` re-check on the outer UPDATE is what makes this
 * safe: a publish can take minutes, so two ticks can overlap, and without it
 * both would claim the same row and double-post. SQLite runs the statement
 * atomically, so the loser's UPDATE matches zero rows.
 */
export function claimDueJob(now: number): ScheduledPost | null {
  const db = getDb();

  const claim = db.transaction((ts: number): string | null => {
    const row = db
      .prepare(
        `SELECT id FROM scheduled_posts
          WHERE status = 'pending'
            AND scheduled_at <= ?
            AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
          ORDER BY scheduled_at ASC
          LIMIT 1`
      )
      .get(ts, ts) as { id: string } | undefined;
    if (!row) return null;

    const info = db
      .prepare(
        `UPDATE scheduled_posts
            SET status = 'publishing',
                lease_until = ?,
                attempts = attempts + 1,
                updated_at = datetime('now')
          WHERE id = ? AND status = 'pending'`
      )
      .run(ts + LEASE_MS, row.id);

    return info.changes > 0 ? row.id : null;
  });

  const id = claim(now);
  return id ? getJob(id) : null;
}

/** Re-claim the lease on a long-running job so a slow publish isn't requeued. */
export function renewLease(id: string, now: number): void {
  getDb()
    .prepare("UPDATE scheduled_posts SET lease_until = ? WHERE id = ?")
    .run(now + LEASE_MS, id);
}

/**
 * Jobs left `publishing`/`finalizing` by a process that died mid-flight. Their
 * lease has expired, so they go back to `pending` for another attempt — unless
 * they've exhausted `max_attempts`, in which case they're terminal.
 *
 * Returns the ids requeued, for logging.
 */
export function recoverExpiredLeases(now: number): string[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, attempts, max_attempts FROM scheduled_posts
        WHERE status IN ('publishing','finalizing')
          AND lease_until IS NOT NULL
          AND lease_until < ?`
    )
    .all(now) as { id: string; attempts: number; max_attempts: number }[];

  const requeued: string[] = [];
  for (const row of rows) {
    if (row.attempts >= row.max_attempts) {
      updateJob(row.id, {
        status: "failed",
        leaseUntil: null,
        result: {
          error: "Interrupted mid-publish and out of attempts.",
          error_kind: "internal",
          finished_at: new Date().toISOString(),
        },
      });
      continue;
    }
    updateJob(row.id, { status: "pending", leaseUntil: null });
    requeued.push(row.id);
  }
  return requeued;
}

/**
 * Retire jobs whose slot passed by more than their grace window.
 *
 * Without this, bringing the server back after a few hours down would fire a
 * backlog of stale posts all at once — the single worst failure mode a scheduler
 * has. Returns the ids retired.
 */
export function markMissed(now: number): string[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id FROM scheduled_posts
        WHERE status = 'pending'
          AND scheduled_at + (grace_minutes * 60000) < ?`
    )
    .all(now) as { id: string }[];

  for (const row of rows) {
    updateJob(row.id, {
      status: "missed",
      result: {
        error: "The scheduled time passed outside the grace window.",
        finished_at: new Date().toISOString(),
      },
    });
  }
  return rows.map((r) => r.id);
}

/** Jobs sitting in `finalizing`, oldest first — containers awaiting a publish. */
export function listFinalizing(limit = 5): ScheduledPost[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM scheduled_posts
        WHERE status = 'finalizing'
          AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
        ORDER BY scheduled_at ASC LIMIT ?`
    )
    .all(Date.now(), limit) as ScheduledPostRow[];
  return rows.map(rowToPost);
}

// ─── Events ──────────────────────────────────────────────────────────────────

export function logScheduleEvent(
  level: ScheduleEvent["level"],
  kind: string,
  message?: string,
  opts: { jobId?: string; meta?: Record<string, unknown> } = {}
): void {
  try {
    getDb()
      .prepare(
        `INSERT INTO schedule_events (job_id, level, kind, message, meta)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        opts.jobId ?? null,
        level,
        kind,
        message ?? null,
        opts.meta ? JSON.stringify(opts.meta) : null
      );
  } catch (err) {
    // Never let observability break the thing it observes.
    console.error("[schedule] could not log event:", err);
  }
}

export function listScheduleEvents(opts: { jobId?: string; limit?: number } = {}): ScheduleEvent[] {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const rows = opts.jobId
    ? (getDb()
        .prepare(
          "SELECT * FROM schedule_events WHERE job_id = ? ORDER BY id DESC LIMIT ?"
        )
        .all(opts.jobId, limit) as Record<string, unknown>[])
    : (getDb()
        .prepare("SELECT * FROM schedule_events ORDER BY id DESC LIMIT ?")
        .all(limit) as Record<string, unknown>[]);

  return rows.map((r) => ({
    id: r.id as number,
    job_id: (r.job_id as string) ?? undefined,
    level: r.level as ScheduleEvent["level"],
    kind: r.kind as string,
    message: (r.message as string) ?? undefined,
    meta: r.meta ? parseJson<Record<string, unknown>>(r.meta as string, {}) : undefined,
    created_at: r.created_at as string,
  }));
}

/** Wipe the activity log. Observability only — jobs themselves are untouched. */
export function clearScheduleEvents(): number {
  return getDb().prepare("DELETE FROM schedule_events").run().changes;
}

/** 30-day retention cull, run on the worker cadence (mirrors automation_events). */
export function cullScheduleEvents(): void {
  try {
    getDb()
      .prepare("DELETE FROM schedule_events WHERE created_at < datetime('now', ?)")
      .run(`-${EVENTS_RETENTION_DAYS} days`);
  } catch {
    /* non-fatal */
  }
}

// ─── Failure classification ──────────────────────────────────────────────────

/** Whether a failure is worth another attempt, or is a dead end. */
export function isRetryable(kind: FailureKind): boolean {
  return kind === "rate_limit" || kind === "network" || kind === "storage_cap";
}

/**
 * Backoff schedule, indexed by attempts already made. Deliberately coarse — the
 * failures worth retrying (rate limits, R2 cap pressure, transient network) all
 * resolve on the order of minutes, not seconds.
 */
const BACKOFF_MS = [60_000, 5 * 60_000, 20 * 60_000];

export function backoffFor(attempts: number): number {
  return BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length - 1)];
}
