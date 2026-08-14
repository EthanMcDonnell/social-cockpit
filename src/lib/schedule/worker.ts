/**
 * The scheduler worker: a stateless poll over `scheduled_posts`.
 *
 * It holds nothing in memory. Every tick it asks the DB what's due, claims one
 * job atomically, and publishes it — so a restart mid-week loses nothing, and a
 * crash mid-publish is recovered by the lease rather than by a timer that
 * evaporated with the process.
 *
 * Serial by design: one job per tick. An Instagram reel with automation attached
 * can block for five minutes, and running those concurrently would make Graph
 * API pressure unpredictable for no real gain — a backlog drains one per tick.
 *
 * ── The R2 rule ──
 * This is the only place media reaches Cloudflare, and only for the duration of
 * the publish. Sources are read from local disk at fire time, uploaded, handed
 * to the platform, and reclaimed. Between scheduling and firing, nothing of the
 * user's is in anyone else's bucket.
 *
 * Server-side only.
 */

import { existsSync } from "fs";
import { config } from "@/lib/config";
import { getDb } from "@/lib/db";
import { planAutomation, type AutomationPlan } from "@/lib/automation/attach";
import { executePublish, attachAutomation } from "@/lib/publish/execute";
import { uploadLocalFile, CapError, PathError } from "@/lib/publish/local-source";
import {
  getContainerStatus,
  type R2Sources,
} from "@/lib/instagram/publish-flow";
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
  cullScheduleEvents,
  getJob,
  isRetryable,
  listFinalizing,
  logScheduleEvent,
  markMissed,
  recoverExpiredLeases,
  renewLease,
  updateJob,
} from "./store";
import { getStagedMediaMany, releaseStaged, sweepOrphanedStaged } from "./media";
import { schedulerEnabled, dryRunActive } from "./settings";
import type {
  FailureKind,
  ScheduleResult,
  ScheduledPost,
  YoutubeJobPayload,
} from "./types";

export const INTERVAL_MS = config.schedule.intervalMs;

/** How long to wait before re-polling a container that's still processing. */
const FINALIZE_POLL_MS = 30_000;

/** Orphan sweep + event cull cadence — hourly is plenty for housekeeping. */
const HOUSEKEEPING_MS = 60 * 60 * 1000;
let lastHousekeeping = 0;

/**
 * Master kill switch. Any instance that isn't production runs with SCHEDULER_ENABLED
 * false so that even a mispointed DB_PATH can't publish to a real account.
 *
 * Composed with the stored pause in `./settings`, where the reasoning and the
 * tests for it live. Re-exported here because this is where callers expect it.
 */
export { schedulerEnabled };

/**
 * Dry run: everything except the platform call. Claims, leases, stats the files,
 * plans the automation, walks the whole state machine, and returns a synthetic
 * id — with no R2 upload and no Instagram/YouTube request. This is how the
 * scheduler is tested without touching the live account (or needing R2
 * credentials at all).
 */
export const isDryRun = dryRunActive;

// ─── Cycle ───────────────────────────────────────────────────────────────────

export async function runScheduleCycle(): Promise<void> {
  if (!schedulerEnabled()) return;

  const now = Date.now();

  // 1. Recover anything a dead process left mid-flight.
  for (const id of recoverExpiredLeases(now)) {
    logScheduleEvent("warn", "requeued", "Lease expired — requeued after an interrupted run", {
      jobId: id,
    });
  }

  // 2. Retire jobs whose slot passed by more than their grace window, so coming
  //    back from downtime doesn't fire a backlog of stale posts at once.
  for (const id of markMissed(now)) {
    logScheduleEvent("warn", "missed", "Scheduled time passed outside the grace window", {
      jobId: id,
    });
  }

  // 3. Advance containers that returned a 202 and are still processing.
  await progressFinalizing();

  // 4. One due job.
  const job = claimDueJob(now);
  if (job) await runJob(job);

  // 5. Housekeeping, hourly.
  if (now - lastHousekeeping > HOUSEKEEPING_MS) {
    lastHousekeeping = now;
    cullScheduleEvents();
    const swept = await sweepOrphanedStaged();
    if (swept) {
      logScheduleEvent("info", "swept", `Removed ${swept} orphaned staged file(s)`);
    }
  }
}

// ─── Running one job ─────────────────────────────────────────────────────────

async function runJob(job: ScheduledPost): Promise<void> {
  logScheduleEvent("info", "publishing", `Attempt ${job.attempts} of ${job.max_attempts}`, {
    jobId: job.id,
  });

  try {
    if (job.platform === "yt") {
      await runYoutubeJob(job);
    } else {
      await runInstagramJob(job);
    }
  } catch (err) {
    await handleFailure(job, err);
  }
}

/**
 * Resolve a job's media to absolute paths, failing loudly if a source has moved
 * or been deleted since it was scheduled. Runs before any upload, so a missing
 * file costs nothing.
 */
function resolveSources(job: ScheduledPost): {
  video?: string;
  image?: string;
  cover?: string;
  children: (string | null)[];
} {
  const staged = getStagedMediaMany(job.media.map((m) => m.staged_id));
  const out: { video?: string; image?: string; cover?: string; children: (string | null)[] } = {
    children: [],
  };

  for (const ref of job.media) {
    const media = staged.get(ref.staged_id);
    if (!media) {
      throw new MissingSourceError(`Staged media ${ref.staged_id} is no longer registered.`);
    }
    if (!existsSync(media.path)) {
      throw new MissingSourceError(`Source file is gone: ${media.path}`);
    }
    if (ref.role === "video") out.video = media.path;
    else if (ref.role === "image") out.image = media.path;
    else if (ref.role === "cover") out.cover = media.path;
    else if (ref.role === "child") out.children[ref.index ?? out.children.length] = media.path;
  }

  return out;
}

class MissingSourceError extends Error {}

// ─── Instagram ───────────────────────────────────────────────────────────────

async function runInstagramJob(job: ScheduledPost): Promise<void> {
  const input = { ...(job.payload as PublishInput) };
  const sources = resolveSources(job);

  // Re-plan the automation NOW, not at schedule time. Between then and now
  // another post may have created the flow that owns this key, and a plan
  // resolved a week ago would create a duplicate instead of appending.
  const plan = replanAutomation(job);

  if (isDryRun()) {
    return finishDryRun(job, plan);
  }

  // ── the only moment media touches R2 ──
  const uploaded: string[] = [];
  const r2: R2Sources = {};
  try {
    if (sources.video) r2.video_url = (await uploadLocalFile(sources.video, uploaded)).key;
    if (sources.image) r2.image_url = (await uploadLocalFile(sources.image, uploaded)).key;
    if (sources.cover) r2.cover_url = (await uploadLocalFile(sources.cover, uploaded)).key;
    if (sources.children.length) {
      r2.children = [];
      for (const child of sources.children) {
        r2.children.push(child ? (await uploadLocalFile(child, uploaded)).key : null);
      }
    }
  } catch (err) {
    if (uploaded.length) await reclaimKeys(uploaded);
    throw err;
  }

  renewLease(job.id, Date.now());

  // executePublish reclaims the R2 sources on success and on failure; on a 202
  // it leaves them, because the container may still be fetching them.
  const { result, automation } = await executePublish({ input, r2, plan });

  if (result.published && result.media_id) {
    await succeed(job, {
      media_id: result.media_id,
      permalink: result.permalink,
      automation,
      finished_at: new Date().toISOString(),
    });
    return;
  }

  // 202 — the container exists but is still processing. Not a failure: hold the
  // job in `finalizing` and publish it once Instagram reports FINISHED.
  updateJob(job.id, {
    status: "finalizing",
    containerId: result.container_id,
    nextAttemptAt: Date.now() + FINALIZE_POLL_MS,
    result: { r2_keys: uploaded },
  });
  logScheduleEvent(
    "info",
    "processing",
    `Container ${result.container_id} still processing — will finalize when ready`,
    { jobId: job.id }
  );
}

/**
 * Poll containers parked in `finalizing` and publish the ones that are ready.
 *
 * The browser publish flow already does this (usePublish polls, then calls
 * /api/publish/finalize). Without the same step here, every reel slow enough to
 * return a 202 would silently never publish.
 */
async function progressFinalizing(): Promise<void> {
  if (isDryRun()) return;

  for (const job of listFinalizing()) {
    if (!job.container_id) {
      updateJob(job.id, { status: "pending", containerId: null });
      continue;
    }

    try {
      const { status_code } = await getContainerStatus(job.container_id);

      if (status_code === "IN_PROGRESS") {
        updateJob(job.id, { nextAttemptAt: Date.now() + FINALIZE_POLL_MS });
        continue;
      }

      if (status_code === "ERROR" || status_code === "EXPIRED") {
        throw new ContainerFailedError(job.container_id, status_code);
      }

      // FINISHED or PUBLISHED — the bytes are ingested, so the R2 sources we
      // held across the 202 can go regardless of how the publish itself lands.
      const keys = job.result?.r2_keys ?? [];
      if (keys.length) await reclaimKeys(keys);

      const published = await publishContainer(job.container_id);
      const permalink = await getMedia(published.id, ["id", "permalink"])
        .then((m) => m.permalink)
        .catch(() => undefined);

      const result: PublishResult = {
        container_id: job.container_id,
        media_id: published.id,
        permalink,
        status_code: "PUBLISHED",
        published: true,
      };

      const plan = replanAutomation(job);
      const automation = plan ? attachAutomation(result, plan) : undefined;

      await succeed(job, {
        media_id: published.id,
        permalink,
        automation,
        finished_at: new Date().toISOString(),
      });
    } catch (err) {
      await handleFailure(job, err);
    }
  }
}

// ─── YouTube ─────────────────────────────────────────────────────────────────

async function runYoutubeJob(job: ScheduledPost): Promise<void> {
  const payload = job.payload as YoutubeJobPayload;
  const sources = resolveSources(job);
  if (!sources.video) {
    throw new MissingSourceError("This YouTube post has no video source.");
  }

  if (isDryRun()) {
    return finishDryRun(job, undefined);
  }

  const uploaded: string[] = [];
  let source;
  try {
    source = await uploadLocalFile(sources.video, uploaded);
  } catch (err) {
    if (uploaded.length) await reclaimKeys(uploaded);
    throw err;
  }

  renewLease(job.id, Date.now());

  try {
    const result = await uploadVideoFromR2({
      key: source.key,
      size: source.size,
      contentType: source.contentType,
      title: payload.title,
      description: payload.description,
      isShort: payload.isShort,
      tags: payload.tags,
      // Pre-audit Google forces every API upload to private, so a publishAt is
      // meaningless — we hold the schedule ourselves instead. Post-audit, this
      // hands it to YouTube. See docs/youtube-shorts-integration.md.
      ...(youtubeAuditPassed() && payload.publish_at
        ? { publishAt: payload.publish_at }
        : {}),
    });

    // YouTube has fully ingested the bytes by the time the PUT returns.
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

async function succeed(job: ScheduledPost, result: ScheduleResult): Promise<void> {
  updateJob(job.id, { status: "published", leaseUntil: null, result, containerId: null });
  // The bytes are live on the platform now; our copy has done its job.
  await releaseStaged(job.media.map((m) => m.staged_id));

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

/**
 * Decide whether a failure gets another go. Retry only what genuinely resolves
 * on its own — rate limits, cap pressure, transient network. A rejected caption
 * or a deleted source file will fail identically forever, so it's terminal.
 */
async function handleFailure(job: ScheduledPost, err: unknown): Promise<void> {
  const kind = classify(err);
  const message = err instanceof Error ? err.message : String(err);
  const fresh = getJob(job.id) ?? job;
  const canRetry = isRetryable(kind) && fresh.attempts < fresh.max_attempts;

  if (canRetry) {
    const delay = backoffFor(fresh.attempts);
    updateJob(job.id, {
      status: "pending",
      leaseUntil: null,
      containerId: null,
      nextAttemptAt: Date.now() + delay,
      result: { error: message, error_kind: kind },
    });
    logScheduleEvent("warn", "retry", `${message} — retrying in ${Math.round(delay / 60000)}m`, {
      jobId: job.id,
      meta: { kind, attempt: fresh.attempts },
    });
    return;
  }

  updateJob(job.id, {
    status: "failed",
    leaseUntil: null,
    containerId: null,
    result: { error: message, error_kind: kind, finished_at: new Date().toISOString() },
  });
  logScheduleEvent("error", "failed", message, { jobId: job.id, meta: { kind } });
}

function classify(err: unknown): FailureKind {
  if (err instanceof RateLimitError) return "rate_limit";
  if (err instanceof CapError) return "storage_cap";
  if (err instanceof MissingSourceError || err instanceof PathError) return "missing_file";
  if (err instanceof ContainerFailedError) return "processing_failed";
  if (err instanceof InstagramError) return "invalid_param";
  if (err instanceof YoutubeUploadError) {
    return err.status === 429 || err.status >= 500 ? "network" : "invalid_param";
  }
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

/**
 * Complete the job without calling any platform. The sources have already been
 * stat'd by resolveSources and the automation plan resolved, so everything up to
 * the network boundary has genuinely been exercised.
 *
 * The automation is deliberately *planned but not written*. Attaching would
 * write a real flow pointing at a synthetic media_id, which the automation
 * worker then correctly prunes as a deleted post — deactivating the flow and
 * leaving debris behind. Reporting the decision proves the create-vs-append
 * logic ran without leaving anything for another worker to trip over.
 */
async function finishDryRun(job: ScheduledPost, plan?: AutomationPlan): Promise<void> {
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
    ? `dry run — would have appended this post to flow "${plan.flow.name}"`
    : `dry run — would have created flow "${plan.spec.name ?? plan.spec.key}" with keywords ${plan.spec.keywords.join(", ")}`;
}

// ─── Automation ──────────────────────────────────────────────────────────────

/**
 * Resolve the job's stored automation spec into a plan, at fire time.
 *
 * Re-planning is the whole reason the raw spec is stored rather than a resolved
 * plan: `planAutomation` decides create-vs-append by looking up the flow that
 * owns `automation.key`, and between scheduling and firing another post may have
 * created it. Deciding once at schedule time would produce duplicate flows for
 * exactly the case the key exists to prevent.
 */
function replanAutomation(job: ScheduledPost): AutomationPlan | undefined {
  if (!job.automation) return undefined;

  const planned = planAutomation(getDb(), job.automation);
  if ("error" in planned) {
    // The post is worth publishing even if its automation spec has gone stale.
    logScheduleEvent("warn", "automation_invalid", planned.error, { jobId: job.id });
    return undefined;
  }
  return planned.plan;
}
