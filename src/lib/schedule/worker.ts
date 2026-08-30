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
import { getContainerStatus, validatePublish, type R2Sources } from "@/lib/instagram/publish-flow";
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
import { getStagedMediaMany, registerLocalPath, releaseStaged, sweepOrphanedStaged } from "./media";
import { selectVideo } from "@/lib/slugs/select";
import { enrolVideo, recordPost } from "@/lib/slugs/store";
import { resolveSelectionMethod } from "@/lib/slugs/settings";
import { isSelectionFailure, type SlugVideoPayload } from "@/lib/slugs/types";
import { tryArchiveVideo, linkCandidate } from "@/lib/archive/store";
import { asTrialRepost } from "@/lib/repost/publish";
import { recordRepost } from "@/lib/repost/store";
import { evaluateReposts } from "@/lib/repost/evaluate";
import { autobookReposts } from "@/lib/repost/autobook";
import { getEvaluateAfterHours } from "@/lib/repost/settings";
import { schedulerEnabled as configuredSchedulerEnabled, dryRunActive } from "./settings";
import type {
  FailureKind,
  ScheduleResult,
  ScheduledPost,
  ScheduledMediaRef,
  YoutubeJobPayload,
} from "./types";
import type { PublishInput as IgPublishInput } from "@/lib/instagram/endpoints/publish";
import { reportError } from "@/lib/observability";

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
    reportError(
      "schedule",
      "worker_disabled",
      "worker disabled: the reviewed scheduler integrity migration is missing. Run it before enabling publishing."
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

    // Reposting rides this cadence rather than starting a worker of its own.
    // Both passes are cheap — evaluation reads view counts the cache worker has
    // already synced and makes no API call, and auto-booking is a no-op unless
    // a slug is in repost mode. Neither is allowed to take the cycle down with
    // it: a failure here must not stop the scheduler publishing.
    try {
      const judged = await evaluateReposts(now);
      if (judged.blocked) {
        logScheduleEvent(
          "info",
          "reposts_evaluated",
          `Judged ${judged.evaluated} repost(s); ${judged.blocked} retired for underperforming`
        );
      }
    } catch (err) {
      reportError("repost", "evaluation_failed", "repost evaluation failed", { error: err });
    }

    try {
      const booked = await autobookReposts(now);
      if (booked.booked) {
        logScheduleEvent("info", "reposts_autobooked", `Booked ${booked.booked} repost slot(s)`);
      }
    } catch (err) {
      reportError("repost", "autobook_failed", "repost auto-booking failed", { error: err });
    }
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
    // A slug job has no video until now. Resolving under the lease is the whole
    // point of the feature: the pick reflects the state of the pool at the
    // moment the slot arrives, not at the moment it was booked.
    if (job.slug && !job.media.length && !(await resolveSlugJob(job))) return;
    if (job.platform === "yt") await runYoutubeJob(job);
    else await runInstagramJob(job);
  } catch (err) {
    await handlePublishingFailure(job, err);
  }
}

/** No video in the pool can go out on this platform right now. */
class NoCandidateError extends Error {}
/** A resolved slug job produced a payload the platform would reject. */
class InvalidPayloadError extends Error {}

/**
 * Turn a slug job into an ordinary one: pick a candidate, register its file,
 * and write the resolved media and payload back onto the row. After this
 * returns true the job is indistinguishable from one booked against a file, and
 * takes the unchanged publish path.
 *
 * Returns false when the lease was lost mid-resolution — the caller must then
 * stop without side effects, exactly as everywhere else in this worker.
 */
async function resolveSlugJob(job: ClaimedScheduledPost): Promise<boolean> {
  const slug = job.slug!;
  const method = resolveSelectionMethod(slug, job.selection_method);

  // An earlier attempt may have registered a source before failing. Drop it
  // rather than leaking a row per retry — and re-pick, since the reason the
  // last attempt failed may be the very candidate it chose. The row is cleared
  // in the same breath: if the pick below fails, the job must not be left
  // pointing at media rows that no longer exist.
  if (job.media.length) {
    await releaseStaged(job.media.map((media) => media.staged_id));
    if (!updateClaimedJob(job, "publishing", { media: [] })) return false;
    job.media = [];
  }

  const selection = await selectVideo({ slug, platform: job.platform, method });
  if (isSelectionFailure(selection)) throw new NoCandidateError(selection.error);

  const staged = await registerLocalPath(selection.video.path);
  const media: ScheduledMediaRef[] = [{ role: "video", staged_id: staged.id }];
  const merged = mergeSlugPayload(job, selection.video.payload, selection.video.label ?? selection.video.filename);

  // A repost always goes out as a trial reel promoted by hand. Forced here,
  // after the merge, so nothing a caller supplied — including `trial_params`
  // copied from the original publish — can turn a repost into an ordinary feed
  // post that followers see again unannounced. YouTube has no trial concept and
  // is rejected at booking time, so this only ever applies to Instagram.
  const payload =
    selection.repost && job.platform === "ig"
      ? asTrialRepost(merged as IgPublishInput)
      : merged;

  // Every other route into a publish validates its payload before booking. A
  // slug job cannot: there is no video to validate against until now. This is
  // the only chance, and `publishFromR2` does not check for us.
  if (job.platform === "ig") {
    const problem = validatePublish({
      ...(payload as IgPublishInput),
      r2: { video_url: staged.id },
    });
    if (problem) {
      await releaseStaged([staged.id]);
      throw new InvalidPayloadError(`#${slug} picked ${selection.video.filename}, but: ${problem}`);
    }
  }

  const resolved = updateClaimedJob(job, "publishing", {
    media,
    payload,
    result: {
      ...(job.result ?? {}),
      slug_video_id: selection.video.id,
      slug_reason: selection.reason,
      repost_archive_id: selection.repost?.archive_id,
      repost_tier: selection.repost?.tier,
    },
  });
  if (!resolved) {
    // Another worker owns the job now. Release what this attempt registered so
    // the row does not outlive the attempt that created it.
    await releaseStaged([staged.id]);
    return false;
  }

  job.media = media;
  job.payload = payload;
  job.result = {
    ...(job.result ?? {}),
    slug_video_id: selection.video.id,
    slug_reason: selection.reason,
    repost_archive_id: selection.repost?.archive_id,
    repost_tier: selection.repost?.tier,
  };

  logScheduleEvent(
    "info",
    selection.repost ? "repost_resolved" : "slug_resolved",
    `#${slug} → ${selection.reason}${selection.repost ? " (trial reel, manual promotion)" : ""}`,
    {
      jobId: job.id,
      meta: {
        slug,
        method,
        video_id: selection.video.id,
        considered: selection.considered,
        ...(selection.repost
          ? { repost: true, archive_id: selection.repost.archive_id, tier: selection.repost.tier }
          : {}),
      },
    }
  );
  return true;
}

/**
 * The job's own payload wins over the candidate's stored defaults — a slot
 * booked with a caption meant that caption, whichever video turns up.
 */
function mergeSlugPayload(
  job: ScheduledPost,
  defaults: SlugVideoPayload,
  fallbackTitle: string
) {
  if (job.platform === "yt") {
    const booked = job.payload as Partial<YoutubeJobPayload>;
    const stored = defaults.yt ?? {};
    return {
      // YouTube refuses an untitled upload, so this can never be left empty:
      // the candidate's label (or its filename) is the last resort.
      title: booked.title?.trim() || stored.title?.trim() || fallbackTitle,
      description: booked.description ?? stored.description,
      isShort: booked.isShort ?? stored.isShort !== false,
      tags: booked.tags ?? stored.tags,
      publish_at: booked.publish_at,
    } satisfies YoutubeJobPayload;
  }

  const booked = job.payload as Partial<IgPublishInput>;
  return {
    ...booked,
    caption: booked.caption ?? defaults.ig?.caption,
    // A slug pool holds videos, so the media type is never in question.
    media_type: booked.media_type ?? "REELS",
  } as IgPublishInput;
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
      // Carried explicitly rather than by spreading the old result, which would
      // resurrect an r2_keys ledger that publishFromR2 has already reclaimed.
      slug_video_id: job.result?.slug_video_id,
      slug_reason: job.result?.slug_reason,
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
  const final = withSlugTrace(job, result);
  const completed = updateClaimedJob(job, expected, {
    status: "published",
    leaseUntil: null,
    leaseToken: null,
    result: final,
    containerId: null,
  });
  if (!completed) return;

  await recordSlugPost(job, final);
  await releaseStaged(job.media.map((media) => media.staged_id));
  logScheduleEvent("info", "published", describeSuccess(final), {
    jobId: job.id,
    meta: { media_id: final.media_id, video_id: final.video_id },
  });
  if (final.automation && "action" in final.automation) {
    logScheduleEvent(
      "info",
      "automation_attached",
      `Automation ${final.automation.action} (flow ${final.automation.flow_id})`,
      { jobId: job.id }
    );
  } else if (final.automation) {
    logScheduleEvent("warn", "automation_skipped", final.automation.reason, { jobId: job.id });
  }
}

/**
 * Carry the slug decision onto the final result.
 *
 * Each outcome builds its own result object from the platform response, so
 * without this the record of *why this video* would be dropped at the last
 * step — including across the finalizing hand-off, where the trace is read back
 * from the stored row rather than from memory.
 */
function withSlugTrace(job: ScheduledPost, result: ScheduleResult): ScheduleResult {
  if (!job.slug || !job.result?.slug_video_id) return result;
  return {
    ...result,
    slug_video_id: job.result.slug_video_id,
    slug_reason: job.result.slug_reason,
    repost_archive_id: job.result.repost_archive_id,
    repost_tier: job.result.repost_tier,
  };
}

/**
 * Write the local file → published post link that every future selection reads:
 * it is both the metrics key for ranking and the record that takes this
 * candidate out of the platform's pool.
 *
 * This is also where a pool fills up. A job booked against a *file* and tagged
 * with a slug enrols that file here, on the way out — the same bargain the
 * automation key already makes, where posting under a key is what joins the
 * flow. Enrolment is idempotent on (slug, path), so a video posted three times
 * under its slug is one candidate with three ledger rows.
 *
 * A dry run is deliberately excluded — its media id is a stub, and recording it
 * would silently retire a candidate that never actually posted.
 */
async function recordSlugPost(job: ScheduledPost, result: ScheduleResult): Promise<void> {
  const externalId = job.platform === "yt" ? result.video_id : result.media_id;
  if (!externalId || result.dry_run) return;

  // A repost is the same video going out a second time. It must NOT reach the
  // enrolment path below: that path records a pool post, which retires the
  // candidate from its platform's pool and would score the repost's own media
  // id into the video's original view total. Its ledger is a different table.
  if (result.repost_archive_id) {
    await recordRepostPost(job, result, externalId);
    return;
  }

  // Preserve the bytes on the way out, whatever else this job was. Archiving is
  // unconditional — a video published without a slug still gets a copy, so that
  // enabling reposting on its slug later works retroactively rather than only
  // for whatever happens to be published afterwards.
  const archived = await archivePublished(job);

  if (!job.slug) return;

  try {
    // The pick made at fire time, when its candidate is still in the pool. One
    // removed since then is treated as no pick at all — the enrolment below
    // puts the file back, so the post is recorded either way.
    if (result.slug_video_id && recordPost(result.slug_video_id, job.platform, externalId, job.id)) {
      // The candidate existed already, so enrolment never runs and this is the
      // only chance to attach the copy that will keep it alive.
      if (archived) linkCandidate(result.slug_video_id, archived.id);
      return;
    }

    const source = videoSourceOf(job);
    if (!source) return;

    // A browser upload lives in data/staged and is deleted the moment this job
    // finishes, so its own path cannot back a pool candidate. The archived copy
    // can: it is ours, it is permanent, and it is the same bytes. Enrolling
    // against it is what lets a video dropped onto the calendar be reposted
    // later — before the archive existed this case could only be refused.
    const enrolPath = source.owned ? archived?.path : source.path;
    if (!enrolPath) {
      logScheduleEvent(
        "warn",
        "slug_enrol_skipped",
        `#${job.slug} — the upload could not be archived, so it can't join a pool; schedule it by path instead`,
        { jobId: job.id, meta: { slug: job.slug } }
      );
      return;
    }

    const enrolled = await enrolVideo({
      slug: job.slug,
      path: enrolPath,
      payload: payloadDefaultsOf(job),
      archiveId: archived?.id,
      trusted: source.owned,
    });
    recordPost(enrolled.id, job.platform, externalId, job.id);
    logScheduleEvent("info", "slug_enrolled", `Added to #${job.slug}`, {
      jobId: job.id,
      meta: { slug: job.slug, video_id: enrolled.id },
    });
  } catch (err) {
    // The post is live; losing the ledger row costs a future selection its
    // metrics and lets this candidate come round again. Worth an alert, not
    // worth failing an already-published job over.
    reportError("slugs", "ledger_write_failed", "could not record a slug post", {
      error: err,
      meta: { job: job.id, slug: job.slug, video: result.slug_video_id },
    });
  }
}

/**
 * Preserve the bytes this job just published.
 *
 * Runs for every successful publish, slug or not. The archive is what makes
 * reposting possible at all, and deciding at publish time which videos will one
 * day be worth reposting is a decision we cannot make — so it keeps everything
 * and lets the eligibility rules filter later. Never throws: the post is
 * already live, and a failed copy is not worth failing a published job over.
 */
async function archivePublished(job: ScheduledPost) {
  const source = videoSourceOf(job);
  if (!source) return null;
  return tryArchiveVideo({
    path: source.path,
    slug: job.slug,
    label: labelOf(job),
  });
}

/**
 * Record that a repost went out, and set the clock on judging it.
 *
 * Deliberately writes `repost_events` and nothing else. The pool ledger is not
 * touched: a repost is the same video appearing again, not a new candidate, and
 * recording it as a pool post would both retire the candidate from its
 * platform's pool and fold the repost's own views into the original's total —
 * which is the number the next eligibility check reads.
 */
async function recordRepostPost(
  job: ScheduledPost,
  result: ScheduleResult,
  externalId: string
): Promise<void> {
  try {
    recordRepost({
      archiveId: result.repost_archive_id!,
      slug: job.slug,
      platform: job.platform,
      externalId,
      jobId: job.id,
      evaluateAfter: Date.now() + getEvaluateAfterHours() * 60 * 60 * 1000,
    });
    logScheduleEvent(
      "info",
      "repost_recorded",
      `Repost published as a trial reel — views will be judged in ${getEvaluateAfterHours()}h`,
      {
        jobId: job.id,
        meta: {
          slug: job.slug,
          archive_id: result.repost_archive_id,
          tier: result.repost_tier,
          media_id: externalId,
        },
      }
    );
  } catch (err) {
    // Losing this row means the repost is never judged and the video never
    // rests — worth an alert, not worth failing an already-published job.
    reportError("repost", "ledger_write_failed", "could not record a repost", {
      error: err,
      meta: { job: job.id, archive: result.repost_archive_id },
    });
  }
}

/** A human-readable name for an archived video, from whatever the job carried. */
function labelOf(job: ScheduledPost): string | undefined {
  if (job.platform === "yt") return (job.payload as YoutubeJobPayload).title;
  const caption = (job.payload as IgPublishInput).caption;
  return caption?.split("\n")[0]?.slice(0, 80) || undefined;
}

/**
 * The job's video source, still resolvable because cleanup runs after this.
 *
 * `owned` is the part that matters to enrolment: an owned file is a copy this
 * app made and is about to delete, a referenced one is the user's own file
 * sitting where it always was.
 */
function videoSourceOf(job: ScheduledPost): { path: string; owned: boolean } | undefined {
  const ref = job.media.find((media) => media.role === "video");
  if (!ref) return undefined;
  const staged = getStagedMediaMany([ref.staged_id]).get(ref.staged_id);
  return staged ? { path: staged.path, owned: staged.owned } : undefined;
}

/**
 * Seed the new candidate with the payload it just published under, so a later
 * slug job that picks it has a caption or a title to use without one being
 * written twice.
 */
function payloadDefaultsOf(job: ScheduledPost): SlugVideoPayload {
  if (job.platform === "yt") {
    const payload = job.payload as YoutubeJobPayload;
    return {
      yt: {
        title: payload.title,
        description: payload.description,
        tags: payload.tags,
        isShort: payload.isShort,
      },
    };
  }
  const payload = job.payload as IgPublishInput;
  return { ig: { caption: payload.caption } };
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
  if (err instanceof NoCandidateError) return "no_candidate";
  if (err instanceof InvalidPayloadError) return "invalid_param";
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
