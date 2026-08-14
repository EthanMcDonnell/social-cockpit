/**
 * DB-backed scheduler worker. Every external publish/finalize operation is
 * performed only by the holder of a durable, fenced SQLite lease.
 */

import { existsSync } from "fs";
import { config } from "@/lib/config";
import { getDb, hasSchedulerLeaseSchema } from "@/lib/db";
import { planAutomation, type AutomationPlan } from "@/lib/automation/attach";
import {
  AUTOMATION_TIMEOUT_MS,
  executePublish,
  attachAutomationStrict,
} from "@/lib/publish/execute";
import { uploadLocalFile, CapError, PathError } from "@/lib/publish/local-source";
import { getContainerStatus, type R2Sources } from "@/lib/instagram/publish-flow";
import {
  publishContainer,
  ContainerFailedError,
  type PublishInput,
  type PublishResult,
} from "@/lib/instagram/endpoints/publish";
import { getMedia } from "@/lib/instagram/endpoints/media";
import { InstagramError, RateLimitError } from "@/lib/instagram/types";
import { reclaimKeys } from "@/lib/storage/reclaim";
import { uploadVideoFromR2, YoutubeUploadError } from "@/lib/youtube/upload";
import {
  backoffFor,
  claimDueJob,
  claimFinalizingJob,
  cullScheduleEvents,
  isRetryable,
  claimTerminalCleanup,
  finishTerminalCleanup,
  logScheduleEvent,
  LEASE_MS,
  markMissed,
  recoverExpiredLeases,
  renewLease,
  updateClaimedJob,
  type ClaimedScheduledPost,
} from "./store";
import { getStagedMediaMany, releaseStaged, sweepOrphanedStaged } from "./media";
import { schedulerEnabled as configuredSchedulerEnabled, dryRunActive } from "./settings";
import type { FailureKind, ScheduleResult, ScheduledPost, YoutubeJobPayload } from "./types";

export const INTERVAL_MS = config.schedule.intervalMs;
const FINALIZE_POLL_MS = 30_000;
const HOUSEKEEPING_MS = 60 * 60 * 1000;
const MAX_FINALIZERS_PER_CYCLE = 5;
let lastHousekeeping = 0;
let warnedMissingLeaseSchema = false;

/**
 * The scheduler will not run against a database that has not passed the explicit
 * integrity migration. Normal startup does not repair or mutate that database.
 */
export function schedulerEnabled(): boolean {
  if (!configuredSchedulerEnabled()) return false;
  if (hasSchedulerLeaseSchema()) return true;
  if (!warnedMissingLeaseSchema) {
    warnedMissingLeaseSchema = true;
    console.error(
      "[schedule] worker disabled: the reviewed scheduler integrity migration is missing. Run it before enabling publishing."
    );
  }
  return false;
}

/** Dry run exercises state transitions without R2 or platform calls. */
export const isDryRun = dryRunActive;

export async function runScheduleCycle(): Promise<void> {
  if (!schedulerEnabled()) return;
  const now = Date.now();

  for (const recovered of recoverExpiredLeases(now)) {
    logScheduleEvent(
      "warn",
      recovered.terminal ? "lease_failed" : "lease_recovered",
      recovered.terminal ? "Expired worker lease exhausted its attempts" : "Expired worker lease recovered",
      { jobId: recovered.id }
    );
  }
  await cleanTerminalArtifacts();
  for (const id of markMissed(now)) {
    logScheduleEvent("warn", "missed", "Scheduled time passed outside the grace window", { jobId: id });
  }

  if (!isDryRun()) {
    for (let index = 0; index < MAX_FINALIZERS_PER_CYCLE; index++) {
      const job = claimFinalizingJob(Date.now());
      if (!job) break;
      await progressFinalizing(job);
    }
  }

  const job = claimDueJob(now);
  if (job) await runJob(job);

  if (now - lastHousekeeping > HOUSEKEEPING_MS) {
    lastHousekeeping = now;
    cullScheduleEvents();
    const swept = await sweepOrphanedStaged();
    if (swept) logScheduleEvent("info", "swept", `Removed ${swept} orphaned staged file(s)`);
  }
}

async function cleanTerminalArtifacts(): Promise<void> {
  for (let index = 0; index < 25; index++) {
    const job = claimTerminalCleanup(Date.now());
    if (!job) break;
    const keys = job.result?.r2_keys ?? [];
    if (keys.length && !job.result?.skip_r2_cleanup) await reclaimKeys(keys);
    await releaseStaged(job.media.map((media) => media.staged_id));
    finishTerminalCleanup(job);
  }
}

async function runJob(job: ClaimedScheduledPost): Promise<void> {
  logScheduleEvent("info", "publishing", `Attempt ${job.attempts} of ${job.max_attempts}`, {
    jobId: job.id,
  });
  try {
    if (job.platform === "yt") await runYoutubeJob(job);
    else await runInstagramJob(job);
  } catch (err) {
    await handlePublishingFailure(job, err);
  }
}

function resolveSources(job: ScheduledPost): {
  video?: string;
  image?: string;
  cover?: string;
  children: (string | null)[];
} {
  const staged = getStagedMediaMany(job.media.map((media) => media.staged_id));
  const out: { video?: string; image?: string; cover?: string; children: (string | null)[] } = {
    children: [],
  };
  for (const ref of job.media) {
    const media = staged.get(ref.staged_id);
    if (!media) throw new MissingSourceError(`Staged media ${ref.staged_id} is no longer registered.`);
    if (!existsSync(media.path)) throw new MissingSourceError(`Source file is gone: ${media.path}`);
    if (ref.role === "video") out.video = media.path;
    else if (ref.role === "image") out.image = media.path;
    else if (ref.role === "cover") out.cover = media.path;
    else if (ref.role === "child") out.children[ref.index ?? out.children.length] = media.path;
  }
  return out;
}

class MissingSourceError extends Error {}
class AutomationAttachError extends Error {}

function retainR2Keys(job: ClaimedScheduledPost, keys: string[]): boolean {
  const result = { ...(job.result ?? {}), r2_keys: [...keys] };
  const retained = updateClaimedJob(job, "publishing", { result });
  if (retained) job.result = result;
  return retained;
}

function ownsLease(job: ClaimedScheduledPost): boolean {
  return renewLease(job, Date.now());
}

/** Keep ownership alive while a platform call legitimately exceeds one lease. */
async function withLeaseHeartbeat<T>(
  job: ClaimedScheduledPost,
  operation: () => Promise<T>
): Promise<T | undefined> {
  if (!ownsLease(job)) return undefined;
  let lost = false;
  const interval = setInterval(() => {
    if (!renewLease(job, Date.now())) lost = true;
  }, Math.max(1_000, Math.floor(LEASE_MS / 3)));
  try {
    const value = await operation();
    return !lost && ownsLease(job) ? value : undefined;
  } finally {
    clearInterval(interval);
  }
}

// ─── Instagram ───────────────────────────────────────────────────────────────

async function runInstagramJob(job: ClaimedScheduledPost): Promise<void> {
  const input = { ...(job.payload as PublishInput) };
  const sources = resolveSources(job);
  const plan = replanAutomation(job);
  if (isDryRun()) return finishDryRun(job, plan);

  const uploaded: string[] = [];
  const r2: R2Sources = {};
  const upload = async (source: string): Promise<string | undefined> => {
    const file = await uploadLocalFile(source, uploaded);
    if (!retainR2Keys(job, uploaded)) {
      // No platform call has started yet, and every source key is unique to this
      // attempt. Reclaim immediately rather than leaving an unowned upload until
      // the bucket lifecycle catches it.
      await reclaimKeys(uploaded);
      return undefined;
    }
    return file.key;
  };

  try {
    if (sources.video) {
      const key = await upload(sources.video);
      if (!key) return;
      r2.video_url = key;
    }
    if (sources.image) {
      const key = await upload(sources.image);
      if (!key) return;
      r2.image_url = key;
    }
    if (sources.cover) {
      const key = await upload(sources.cover);
      if (!key) return;
      r2.cover_url = key;
    }
    if (sources.children.length) {
      r2.children = [];
      for (const child of sources.children) {
        if (!child) {
          r2.children.push(null);
          continue;
        }
        const key = await upload(child);
        if (!key) return;
        r2.children.push(key);
      }
    }
  } catch (err) {
    if (uploaded.length) await reclaimKeys(uploaded);
    throw err;
  }

  if (!ownsLease(job)) return;
  // publishFromR2 owns the R2 lifecycle for direct success/failure. A 202 keeps
  // the persisted ledger because Instagram may still be fetching the bytes. Do
  // attachment separately: if SQLite is transiently unavailable after a real
  // publish, keep the job finalizing and retry only the attachment—not the post.
  const executed = await withLeaseHeartbeat(job, () =>
    executePublish({
      input,
      r2,
      timeoutMs: plan ? AUTOMATION_TIMEOUT_MS : undefined,
    })
  );
  if (!executed) return;
  const { result } = executed;
  if (result.published && result.media_id) {
    try {
      const automation = plan ? attachAutomationStrict(result, plan) : undefined;
      await succeed(job, {
        media_id: result.media_id,
        permalink: result.permalink,
        automation,
        finished_at: new Date().toISOString(),
      });
    } catch (err) {
      await holdAttachmentRetry(job, result, err);
    }
    return;
  }

  const transitioned = updateClaimedJob(job, "publishing", {
    status: "finalizing",
    containerId: result.container_id,
    nextAttemptAt: Date.now() + FINALIZE_POLL_MS,
    leaseUntil: null,
    leaseToken: null,
    result: { ...(job.result ?? {}), r2_keys: uploaded },
  });
  if (!transitioned) return;
  logScheduleEvent(
    "info",
    "processing",
    `Container ${result.container_id} still processing — will finalize when ready`,
    { jobId: job.id }
  );
}

/** Persist an already-live post so only its automation attach is retried. */
async function holdAttachmentRetry(
  job: ClaimedScheduledPost,
  result: PublishResult,
  cause: unknown
): Promise<void> {
  const message = cause instanceof Error ? cause.message : String(cause);
  const held = updateClaimedJob(job, "publishing", {
    status: "finalizing",
    containerId: result.container_id,
    nextAttemptAt: Date.now() + FINALIZE_POLL_MS,
    leaseUntil: null,
    leaseToken: null,
    result: {
      media_id: result.media_id,
      permalink: result.permalink,
      error: message,
      error_kind: "network",
    },
  });
  if (held) {
    logScheduleEvent("warn", "automation_retry", `${message} — retrying automation attachment`, {
      jobId: job.id,
    });
  }
}

async function progressFinalizing(job: ClaimedScheduledPost): Promise<void> {
  // The post already reached the platform, but its automation transaction failed.
  // This branch intentionally never polls or republishes the old container.
  if (job.result?.media_id) {
    try {
      const plan = replanAutomation(job);
      const result: PublishResult = {
        container_id: job.container_id ?? "already-published",
        media_id: job.result.media_id,
        permalink: job.result.permalink,
        status_code: "PUBLISHED",
        published: true,
      };
      const automation = plan ? attachAutomationStrict(result, plan) : undefined;
      await succeed(job, {
        media_id: result.media_id,
        permalink: result.permalink,
        automation,
        finished_at: new Date().toISOString(),
      });
    } catch (err) {
      await handleFinalizingFailure(
        job,
        new AutomationAttachError(err instanceof Error ? err.message : String(err))
      );
    }
    return;
  }

  if (!job.container_id) {
    await handleFinalizingFailure(job, new MissingSourceError("Finalizing job has no Instagram container."));
    return;
  }

  try {
    const containerStatus = await withLeaseHeartbeat(job, () => getContainerStatus(job.container_id!));
    if (!containerStatus) return;
    const { status_code } = containerStatus;
    if (status_code === "IN_PROGRESS") {
      updateClaimedJob(job, "finalizing", {
        nextAttemptAt: Date.now() + FINALIZE_POLL_MS,
        leaseUntil: null,
        leaseToken: null,
      });
      return;
    }
    if (status_code === "ERROR" || status_code === "EXPIRED") {
      throw new ContainerFailedError(job.container_id, status_code);
    }

    // Instagram has ingested the source once the container is ready. Persist the
    // cleared ledger first; after this point a retry must use the same container.
    const keys = job.result?.r2_keys ?? [];
    if (keys.length) {
      // Keep the durable ledger until cleanup completes. A crash after the
      // idempotent reclaim but before this fenced clear merely retries cleanup;
      // clearing first would lose the only recovery reference.
      await reclaimKeys(keys);
      const cleared = updateClaimedJob(job, "finalizing", {
        result: { ...(job.result ?? {}), r2_keys: undefined },
      });
      if (!cleared) return;
      job.result = { ...(job.result ?? {}), r2_keys: undefined };
    }

    const published = await withLeaseHeartbeat(job, () => publishContainer(job.container_id!));
    if (!published) return;
    const permalink = await getMedia(published.id, ["id", "permalink"])
      .then((media) => media.permalink)
      .catch(() => undefined);
    if (!ownsLease(job)) return;

    const result: PublishResult = {
      container_id: job.container_id,
      media_id: published.id,
      permalink,
      status_code: "PUBLISHED",
      published: true,
    };
    const plan = replanAutomation(job);
    let automation;
    try {
      automation = plan ? attachAutomationStrict(result, plan) : undefined;
    } catch (err) {
      throw new AutomationAttachError(err instanceof Error ? err.message : String(err));
    }
    await succeed(job, {
      media_id: published.id,
      permalink,
      automation,
      finished_at: new Date().toISOString(),
    });
  } catch (err) {
    await handleFinalizingFailure(job, err);
  }
}

// ─── YouTube ─────────────────────────────────────────────────────────────────

async function runYoutubeJob(job: ClaimedScheduledPost): Promise<void> {
  const payload = job.payload as YoutubeJobPayload;
  const sources = resolveSources(job);
  if (!sources.video) throw new MissingSourceError("This YouTube post has no video source.");
  if (isDryRun()) return finishDryRun(job, undefined);

  let source;
  try {
    const uploaded: string[] = [];
    source = await uploadLocalFile(sources.video, uploaded);
    if (!retainR2Keys(job, uploaded)) {
      await reclaimKeys(uploaded);
      return;
    }
  } catch (err) {
    throw err;
  }
  try {
    const result = await withLeaseHeartbeat(job, () =>
      uploadVideoFromR2({
        key: source.key,
        size: source.size,
        contentType: source.contentType,
        title: payload.title,
        description: payload.description,
        isShort: payload.isShort,
        tags: payload.tags,
        ...(youtubeAuditPassed() && payload.publish_at ? { publishAt: payload.publish_at } : {}),
      })
    );
    if (!result) return;
    await reclaimKeys([source.key]);
    await succeed(job, {
      video_id: result.videoId,
      watch_url: result.watchUrl,
      studio_url: result.studioUrl,
      privacy_status: result.privacyStatus,
      finished_at: new Date().toISOString(),
    });
  } catch (err) {
    await reclaimKeys([source.key]);
    throw err;
  }
}

export function youtubeAuditPassed(): boolean {
  return config.youtube.auditPassed;
}

// ─── Outcomes ────────────────────────────────────────────────────────────────

async function succeed(job: ClaimedScheduledPost, result: ScheduleResult): Promise<void> {
  const expected = job.status === "finalizing" ? "finalizing" : "publishing";
  const completed = updateClaimedJob(job, expected, {
    status: "published",
    leaseUntil: null,
    leaseToken: null,
    result,
    containerId: null,
  });
  if (!completed) return;

  await releaseStaged(job.media.map((media) => media.staged_id));
  logScheduleEvent("info", "published", describeSuccess(result), {
    jobId: job.id,
    meta: { media_id: result.media_id, video_id: result.video_id },
  });
  if (result.automation && "action" in result.automation) {
    logScheduleEvent(
      "info",
      "automation_attached",
      `Automation ${result.automation.action} (flow ${result.automation.flow_id})`,
      { jobId: job.id }
    );
  } else if (result.automation) {
    logScheduleEvent("warn", "automation_skipped", result.automation.reason, { jobId: job.id });
  }
}

async function handlePublishingFailure(job: ClaimedScheduledPost, err: unknown): Promise<void> {
  const kind = classify(err);
  const message = err instanceof Error ? err.message : String(err);
  const canRetry = isRetryable(kind) && job.attempts < job.max_attempts;
  if (canRetry) {
    const delay = backoffFor(job.attempts);
    const retried = updateClaimedJob(job, "publishing", {
      status: "pending",
      leaseUntil: null,
      leaseToken: null,
      containerId: null,
      nextAttemptAt: Date.now() + delay,
      result: { error: message, error_kind: kind },
    });
    if (retried) {
      logScheduleEvent("warn", "retry", `${message} — retrying in ${Math.round(delay / 60000)}m`, {
        jobId: job.id,
        meta: { kind, attempt: job.attempts },
      });
    }
    return;
  }

  const failed = updateClaimedJob(job, "publishing", {
    status: "failed",
    leaseUntil: null,
    leaseToken: null,
    containerId: null,
    result: {
      ...(job.result ?? {}),
      error: message,
      error_kind: kind,
      finished_at: new Date().toISOString(),
      cleanup_done: false,
    },
  });
  if (!failed) return;
  await cleanTerminalArtifacts();
  logScheduleEvent("error", "failed", message, { jobId: job.id, meta: { kind } });
}

async function handleFinalizingFailure(job: ClaimedScheduledPost, err: unknown): Promise<void> {
  const kind = classify(err);
  const message = err instanceof Error ? err.message : String(err);
  if (isRetryable(kind) && job.attempts < job.max_attempts) {
    const delay = backoffFor(job.attempts);
    const retried = updateClaimedJob(job, "finalizing", {
      attempts: job.attempts + 1,
      nextAttemptAt: Date.now() + delay,
      leaseUntil: null,
      leaseToken: null,
      result: { ...(job.result ?? {}), error: message, error_kind: kind },
    });
    if (retried) {
      logScheduleEvent("warn", "finalize_retry", `${message} — retrying in ${Math.round(delay / 60000)}m`, {
        jobId: job.id,
        meta: { kind },
      });
    }
    return;
  }

  const failed = updateClaimedJob(job, "finalizing", {
    status: "failed",
    leaseUntil: null,
    leaseToken: null,
    containerId: null,
    result: {
      ...(job.result ?? {}),
      error: message,
      error_kind: kind,
      finished_at: new Date().toISOString(),
      cleanup_done: false,
      // If a poll/publish failure leaves container ingestion unknown, keep its
      // source URLs alive for lifecycle cleanup instead of breaking Instagram's
      // still-running fetch. ERROR/EXPIRED explicitly proves ingestion stopped.
      skip_r2_cleanup: kind !== "processing_failed",
    },
  });
  if (!failed) return;
  await cleanTerminalArtifacts();
  logScheduleEvent("error", "failed", message, { jobId: job.id, meta: { kind } });
}

function classify(err: unknown): FailureKind {
  if (err instanceof RateLimitError) return "rate_limit";
  if (err instanceof CapError) return "storage_cap";
  if (err instanceof MissingSourceError || err instanceof PathError) return "missing_file";
  if (err instanceof ContainerFailedError) return "processing_failed";
  if (err instanceof AutomationAttachError) return "network";
  if (err instanceof InstagramError) return "invalid_param";
  if (err instanceof YoutubeUploadError) return err.status === 429 || err.status >= 500 ? "network" : "invalid_param";
  if (err instanceof TypeError && /fetch/i.test(err.message)) return "network";
  return "internal";
}

function describeSuccess(result: ScheduleResult): string {
  if (result.dry_run) return "Dry run — nothing was actually published";
  if (result.permalink) return `Published → ${result.permalink}`;
  if (result.watch_url) return `Uploaded → ${result.watch_url}`;
  return "Published";
}

// ─── Dry run ─────────────────────────────────────────────────────────────────

async function finishDryRun(job: ClaimedScheduledPost, plan?: AutomationPlan): Promise<void> {
  const fakeId = `dry-${job.id.slice(0, 8)}`;
  await succeed(job, {
    media_id: job.platform === "ig" ? fakeId : undefined,
    video_id: job.platform === "yt" ? fakeId : undefined,
    automation: plan ? { skipped: true, reason: describePlan(plan) } : undefined,
    dry_run: true,
    finished_at: new Date().toISOString(),
  });
}

function describePlan(plan: AutomationPlan): string {
  return plan.mode === "append"
    ? `dry run — would have appended this post to key "${plan.spec.key}"`
    : `dry run — would have created flow "${plan.spec.name ?? plan.spec.key}" with keywords ${plan.spec.keywords.join(", ")}`;
}

function replanAutomation(job: ScheduledPost): AutomationPlan | undefined {
  if (!job.automation) return undefined;
  const planned = planAutomation(getDb(), job.automation);
  if ("error" in planned) {
    logScheduleEvent("warn", "automation_invalid", planned.error, { jobId: job.id });
    return undefined;
  }
  return planned.plan;
}
