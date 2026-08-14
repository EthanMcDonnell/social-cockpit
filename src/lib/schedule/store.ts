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
  lease_token: string | null;
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

/** Server-only credential proving a worker owns the current lease. */
export type ClaimedScheduledPost = ScheduledPost & { leaseToken: string };
export interface RecoveredLease {
  id: string;
  terminal: boolean;
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

function rowToClaimedPost(row: ScheduledPostRow): ClaimedScheduledPost | null {
  const post = rowToPost(row);
  return row.lease_token ? { ...post, leaseToken: row.lease_token } : null;
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

const CAP_OCCUPYING_STATUSES: ScheduleStatus[] = [
  "pending",
  "paused",
  "publishing",
  "finalizing",
  "published",
];

/**
 * Serialize scheduler-owned capacity reservations with the insert. External
 * cached posts are counted by the route before this call; concurrent scheduler
 * requests cannot overbook the remaining capacity.
 */
export function createJobWithinScheduledCap(
  input: CreateJobInput,
  dayStart: number,
  dayEnd: number,
  remainingScheduledCapacity: number
): ScheduledPost | null {
  const db = getDb();
  const reserve = db.transaction(() => {
    const count = (db
      .prepare(
        `SELECT COUNT(*) AS count FROM scheduled_posts
          WHERE scheduled_at >= ? AND scheduled_at < ?
            AND status IN (${CAP_OCCUPYING_STATUSES.map(() => "?").join(",")})`
      )
      .get(dayStart, dayEnd, ...CAP_OCCUPYING_STATUSES) as { count: number }).count;
    return count >= remainingScheduledCapacity ? null : createJob(input);
  });
  return reserve.immediate();
}

// ─── Read ────────────────────────────────────────────────────────────────────

export function getJob(id: string): ScheduledPost | null {
  const row = getDb()
    .prepare("SELECT * FROM scheduled_posts WHERE id = ?")
    .get(id) as ScheduledPostRow | undefined;
  return row ? rowToPost(row) : null;
}

/**
 * Claim one failed job's idempotent artifact cleanup. Holding a lease keeps an
 * operator from reviving the job and losing its staged media mid-cleanup.
 */
export function claimTerminalCleanup(now: number): ClaimedScheduledPost | null {
  const token = randomUUID();
  const row = getDb()
    .prepare(
      `UPDATE scheduled_posts
          SET lease_until = ?, lease_token = ?, updated_at = datetime('now')
        WHERE id = (
          SELECT id FROM scheduled_posts
           WHERE status = 'failed'
             AND (result IS NULL OR result NOT LIKE '%"cleanup_done":true%')
             AND (lease_until IS NULL OR lease_until < ?)
           ORDER BY updated_at ASC LIMIT 1
        )
          AND status = 'failed'
          AND (lease_until IS NULL OR lease_until < ?)
      RETURNING *`
    )
    .get(now + LEASE_MS, token, now, now) as ScheduledPostRow | undefined;
  return row ? rowToClaimedPost(row) : null;
}

export function finishTerminalCleanup(job: ClaimedScheduledPost): boolean {
  const info = getDb()
    .prepare(
      `UPDATE scheduled_posts
          SET result = ?, lease_until = NULL, lease_token = NULL, updated_at = datetime('now')
        WHERE id = ? AND status = 'failed' AND lease_token = ?`
    )
    .run(JSON.stringify({ ...(job.result ?? {}), cleanup_done: true }), job.id, job.leaseToken);
  return info.changes === 1;
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
  /** Internal worker fencing credential; never supplied by a public route. */
  leaseToken?: string | null;
  containerId?: string | null;
  result?: ScheduleResult | null;
}

export function updateJob(
  id: string,
  patch: JobPatch,
  expectedStatuses?: readonly ScheduleStatus[]
): ScheduledPost | null {
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
  if (patch.leaseToken !== undefined) put("lease_token", patch.leaseToken);
  if (patch.containerId !== undefined) put("container_id", patch.containerId);
  if (patch.result !== undefined) {
    put("result", patch.result ? JSON.stringify(patch.result) : null);
  }

  if (!sets.length) return getJob(id);

  sets.push("updated_at = datetime('now')");
  const statuses = expectedStatuses?.length ? ` AND status IN (${expectedStatuses.map(() => "?").join(", ")})` : "";
  const unleased = expectedStatuses?.length ? " AND lease_token IS NULL" : "";
  const info = getDb()
    .prepare(`UPDATE scheduled_posts SET ${sets.join(", ")} WHERE id = ?${statuses}${unleased}`)
    .run(...params, id, ...(expectedStatuses?.length ? expectedStatuses : []));

  return info.changes ? getJob(id) : null;
}

/** Atomically reserve destination-day scheduler capacity while applying an edit. */
export function updateJobWithinScheduledCap(
  id: string,
  patch: JobPatch,
  dayStart: number,
  dayEnd: number,
  remainingScheduledCapacity: number,
  expectedStatuses: readonly ScheduleStatus[]
): ScheduledPost | null {
  const db = getDb();
  const reserve = db.transaction(() => {
    const count = (db
      .prepare(
        `SELECT COUNT(*) AS count FROM scheduled_posts
          WHERE id != ? AND scheduled_at >= ? AND scheduled_at < ?
            AND status IN (${CAP_OCCUPYING_STATUSES.map(() => "?").join(",")})`
      )
      .get(id, dayStart, dayEnd, ...CAP_OCCUPYING_STATUSES) as { count: number }).count;
    return count >= remainingScheduledCapacity ? null : updateJob(id, patch, expectedStatuses);
  });
  return reserve.immediate();
}

export function deleteJob(id: string, expectedStatuses?: readonly ScheduleStatus[]): boolean {
  const statuses = expectedStatuses?.length ? ` AND status IN (${expectedStatuses.map(() => "?").join(", ")})` : "";
  const unleased = expectedStatuses?.length ? " AND lease_token IS NULL" : "";
  const info = getDb()
    .prepare(`DELETE FROM scheduled_posts WHERE id = ?${statuses}${unleased}`)
    .run(id, ...(expectedStatuses?.length ? expectedStatuses : []));
  return info.changes > 0;
}

// ─── Worker claim / recovery ─────────────────────────────────────────────────

/** Atomically lease one due publishing job and return its fenced credential. */
export function claimDueJob(now: number): ClaimedScheduledPost | null {
  const token = randomUUID();
  const row = getDb()
    .prepare(
      `UPDATE scheduled_posts
          SET status = 'publishing',
              lease_until = ?,
              lease_token = ?,
              attempts = attempts + 1,
              updated_at = datetime('now')
        WHERE id = (
          SELECT id FROM scheduled_posts
           WHERE status = 'pending'
             AND scheduled_at <= ?
             AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
           ORDER BY scheduled_at ASC
           LIMIT 1
        ) AND status = 'pending'
      RETURNING *`
    )
    .get(now + LEASE_MS, token, now, now) as ScheduledPostRow | undefined;
  return row ? rowToClaimedPost(row) : null;
}

/** Atomically lease one container poll without changing publication attempts. */
export function claimFinalizingJob(now: number): ClaimedScheduledPost | null {
  const token = randomUUID();
  const row = getDb()
    .prepare(
      `UPDATE scheduled_posts
          SET lease_until = ?, lease_token = ?, updated_at = datetime('now')
        WHERE id = (
          SELECT id FROM scheduled_posts
           WHERE status = 'finalizing'
             AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
             AND (lease_until IS NULL OR lease_until < ?)
           ORDER BY scheduled_at ASC
           LIMIT 1
        )
          AND status = 'finalizing'
          AND (lease_until IS NULL OR lease_until < ?)
      RETURNING *`
    )
    .get(now + LEASE_MS, token, now, now, now) as ScheduledPostRow | undefined;
  return row ? rowToClaimedPost(row) : null;
}

/** Renew a still-owned active lease. False means another worker owns the job. */
export function renewLease(job: ClaimedScheduledPost, now: number): boolean {
  const info = getDb()
    .prepare(
      `UPDATE scheduled_posts SET lease_until = ?, updated_at = datetime('now')
        WHERE id = ? AND lease_token = ?
          AND status IN ('publishing', 'finalizing')
          AND lease_until >= ?`
    )
    .run(now + LEASE_MS, job.id, job.leaseToken, now);
  return info.changes === 1;
}

/**
 * Fenced worker transition. A false result is ownership loss; callers must not
 * perform resource cleanup or further external side effects after that point.
 */
export function updateClaimedJob(
  job: ClaimedScheduledPost,
  expectedStatus: "publishing" | "finalizing",
  patch: JobPatch,
  now = Date.now()
): boolean {
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
  if (patch.automation !== undefined) put("automation", patch.automation ? JSON.stringify(patch.automation) : null);
  if (patch.graceMinutes !== undefined) put("grace_minutes", patch.graceMinutes);
  if (patch.maxAttempts !== undefined) put("max_attempts", patch.maxAttempts);
  if (patch.nextAttemptAt !== undefined) put("next_attempt_at", patch.nextAttemptAt);
  if (patch.leaseUntil !== undefined) put("lease_until", patch.leaseUntil);
  if (patch.leaseToken !== undefined) put("lease_token", patch.leaseToken);
  if (patch.containerId !== undefined) put("container_id", patch.containerId);
  if (patch.result !== undefined) put("result", patch.result ? JSON.stringify(patch.result) : null);
  if (!sets.length) return false;

  sets.push("updated_at = datetime('now')");
  const info = getDb()
    .prepare(
      `UPDATE scheduled_posts SET ${sets.join(", ")}
        WHERE id = ? AND status = ? AND lease_token = ? AND lease_until >= ?`
    )
    .run(...params, job.id, expectedStatus, job.leaseToken, now);
  return info.changes === 1;
}

/**
 * Recover only rows that are still expired in the same state seen by recovery.
 * Finalizing rows retain their container and become available for a later poll;
 * they are never sent through a new upload/container creation path.
 */
export function recoverExpiredLeases(now: number): RecoveredLease[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, status, attempts, max_attempts, lease_token, result FROM scheduled_posts
        WHERE status IN ('publishing', 'finalizing')
          AND lease_until IS NOT NULL AND lease_until < ?`
    )
    .all(now) as {
      id: string;
      status: "publishing" | "finalizing";
      attempts: number;
      max_attempts: number;
      lease_token: string | null;
      result: string | null;
    }[];

  const recovered: RecoveredLease[] = [];
  for (const row of rows) {
    if (row.status === "finalizing") {
      const info = db
        .prepare(
          `UPDATE scheduled_posts SET lease_until = NULL, lease_token = NULL, updated_at = datetime('now')
            WHERE id = ? AND status = 'finalizing' AND lease_token IS ? AND lease_until < ?`
        )
        .run(row.id, row.lease_token, now);
      if (info.changes) recovered.push({ id: row.id, terminal: false });
      continue;
    }

    // A crashed `publishing` worker may have crossed the external platform
    // boundary but failed before it durably recorded the response. Retrying that
    // ambiguity can double-post, so fail closed for operator review instead.
    const terminal = true;
    const terminalResult: ScheduleResult = {
      ...parseJson<ScheduleResult>(row.result, {}),
      error: "Interrupted during an unknown publish boundary; manual review required before retrying.",
      error_kind: "internal",
      finished_at: new Date().toISOString(),
      cleanup_done: false,
    };
    const info = db
      .prepare(
        `UPDATE scheduled_posts
            SET status = ?, lease_until = NULL, lease_token = NULL,
                result = CASE WHEN ? THEN ? ELSE result END,
                updated_at = datetime('now')
          WHERE id = ? AND status = 'publishing' AND lease_token IS ? AND lease_until < ?`
      )
      .run(
        terminal ? "failed" : "pending",
        terminal ? 1 : 0,
        JSON.stringify(terminalResult),
        row.id,
        row.lease_token,
        now
      );
    if (info.changes) recovered.push({ id: row.id, terminal });
  }
  return recovered;
}

/** Retire only rows that remain pending at the moment the write runs. */
export function markMissed(now: number): string[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id FROM scheduled_posts WHERE status = 'pending'
        AND scheduled_at + (grace_minutes * 60000) < ?`
    )
    .all(now) as { id: string }[];
  const missed: string[] = [];
  for (const row of rows) {
    const info = db
      .prepare(
        `UPDATE scheduled_posts SET status = 'missed', result = ?, updated_at = datetime('now')
          WHERE id = ? AND status = 'pending'
            AND scheduled_at + (grace_minutes * 60000) < ?`
      )
      .run(
        JSON.stringify({ error: "The scheduled time passed outside the grace window.", finished_at: new Date().toISOString() }),
        row.id,
        now
      );
    if (info.changes) missed.push(row.id);
  }
  return missed;
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
