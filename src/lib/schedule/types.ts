/**
 * Wire types for the scheduler, shared between the worker, the API routes, and
 * the calendar UI.
 *
 * `import type` only, so this module is fully erased at runtime and can be
 * pulled into the browser bundle without dragging better-sqlite3 along (same
 * discipline as src/lib/compose/draft.ts).
 */

import type { PublishInput } from "@/lib/instagram/endpoints/publish";
import type { AutomationSpec } from "@/lib/automation/attach";
import type { AttachResult } from "@/lib/automation/attach";

export type { AutomationSpec };

export type SchedulePlatform = "ig" | "yt";

/**
 * Job lifecycle.
 *
 *   pending ──(due)──► publishing ──► published
 *      ▲                    │
 *      │                    ├──► finalizing ──► published   (Instagram 202)
 *      └──(backoff)─────────┴──► failed                     (terminal)
 *
 *   pending ──(past grace)──► missed
 *   pending ◄──► paused                                     (user)
 *   pending ──► cancelled                                   (user)
 */
export type ScheduleStatus =
  | "pending"
  | "publishing"
  | "finalizing"
  | "published"
  | "failed"
  | "missed"
  | "cancelled"
  | "paused";

/** Statuses the worker will never pick up again. */
export const TERMINAL_STATUSES: ScheduleStatus[] = [
  "published",
  "failed",
  "cancelled",
  "missed",
];

/** Which slot in the publish input a staged file feeds. */
export type MediaRole = "video" | "image" | "cover" | "child";

export interface ScheduledMediaRef {
  role: MediaRole;
  staged_id: string;
  /** Carousel children only — position in the `children` array. */
  index?: number;
}

export interface StagedMedia {
  id: string;
  /** Absolute path on the server's disk. Never an R2 key — that's the point. */
  path: string;
  /** True when the app copied the file in and is responsible for deleting it. */
  owned: boolean;
  size_bytes: number;
  content_type: string;
  created_at: string;
}

/** A staged file plus a liveness check, for the calendar's missing-file badge. */
export interface StagedMediaStatus extends StagedMedia {
  missing: boolean;
  /** Basename, for display — the full path is noise in a calendar card. */
  filename: string;
}

/**
 * YouTube job payload — `YoutubePublishRequest` minus the R2 fields, which only
 * exist at fire time.
 */
export interface YoutubeJobPayload {
  title: string;
  description?: string;
  isShort: boolean;
  tags?: string[];
  /**
   * Post-audit only: hand the schedule to YouTube's own `status.publishAt`
   * instead of holding it here. Ignored unless YOUTUBE_AUDIT_PASSED is set,
   * because Google forces every API upload to private pre-audit.
   */
  publish_at?: string;
}

export type SchedulePayload = PublishInput | YoutubeJobPayload;

/** Why a job failed, which decides retry-vs-terminal. */
export type FailureKind =
  | "rate_limit"
  | "network"
  | "processing_failed"
  | "invalid_param"
  | "missing_file"
  | "storage_cap"
  | "internal";

export interface ScheduleResult {
  /** Instagram */
  media_id?: string;
  permalink?: string;
  /** YouTube */
  video_id?: string;
  watch_url?: string;
  studio_url?: string;
  privacy_status?: string;
  /** Automation attach outcome, when the job carried a spec. */
  automation?: AttachResult | { skipped: true; reason: string };
  /** Set on failure. */
  error?: string;
  error_kind?: FailureKind;
  /** True when SCHEDULE_DRY_RUN stubbed the platform call. */
  dry_run?: boolean;
  finished_at?: string;
  /**
   * Durable scheduler cleanup ledger for R2 source keys. It is written as files
   * upload and retained across a `finalizing` window; cleanup drops it only once
   * the platform has ingested the bytes or the job reaches terminal failure.
   */
  r2_keys?: string[];
  /** Terminal R2/staged-media cleanup completed (or is intentionally empty). */
  cleanup_done?: boolean;
  /** Leave sources to their lifecycle when container ingestion is unknown. */
  skip_r2_cleanup?: boolean;
}

export interface ScheduledPost {
  id: string;
  platform: SchedulePlatform;
  status: ScheduleStatus;
  /** Epoch ms, UTC. */
  scheduled_at: number;
  payload: SchedulePayload;
  media: ScheduledMediaRef[];
  automation?: AutomationSpec;
  attempts: number;
  max_attempts: number;
  next_attempt_at?: number;
  grace_minutes: number;
  container_id?: string;
  result?: ScheduleResult;
  created_at: string;
  updated_at: string;
}

/** A job as the calendar sees it: media resolved and liveness-checked. */
export interface ScheduledPostView extends ScheduledPost {
  media_files: StagedMediaStatus[];
  /** Any referenced source file has gone missing since scheduling. */
  media_missing: boolean;
}

export interface ScheduleEvent {
  id: number;
  job_id?: string;
  level: "info" | "warn" | "error";
  kind: string;
  message?: string;
  meta?: Record<string, unknown>;
  created_at: string;
}
