/**
 * Shared publish orchestration for the /api/publish routes.
 *
 * Both the URL/key entry point (POST /api/publish) and the local-file entry
 * point (POST /api/publish/local) end up in the same place: a PublishInput plus
 * an optional `r2` map of object keys. This module owns everything downstream of
 * that — validation, resolving keys to presigned GETs, the publish call, and
 * reclaiming the R2 source once Instagram has ingested it — so the two routes
 * can't drift.
 */

import { NextResponse } from "next/server";
import {
  publishMedia,
  getContainerStatus,
  ContainerFailedError,
  type PublishInput,
  type PublishOptions,
  type PublishResult,
} from "./endpoints/publish";
import { InstagramError, RateLimitError } from "./types";
import { presignGet } from "@/lib/storage/r2";
import { reclaimKeys } from "@/lib/storage/reclaim";

export { getContainerStatus };

const MEDIA_TYPES = new Set(["REELS", "IMAGE", "CAROUSEL", "STORIES"]);
const GRADUATION_STRATEGIES = new Set(["MANUAL", "SS_PERFORMANCE"]);

/** Reel cover frame default: 1s into the video, in milliseconds. */
const DEFAULT_REEL_THUMB_OFFSET_MS = 1000;

/**
 * Local-file sources uploaded to R2 (see docs/r2-integration.md). Each value is
 * an object key; `children` is index-aligned with `PublishInput.children`.
 * Resolved to a presigned GET and injected into the matching field before
 * publishMedia is called — the R2 key never reaches Instagram or publishMedia.
 */
export interface R2Sources {
  video_url?: string;
  image_url?: string;
  cover_url?: string;
  children?: (string | null | undefined)[];
}

/**
 * Validate a publish request body. Returns an error string, or null if valid.
 * Enforces the API's source requirements per media_type so we fail fast with a
 * clear message instead of a cryptic Graph API error. A local-file R2 key
 * (`r2.*`) satisfies the same requirement as the matching pasted-URL field.
 */
export function validatePublish(body: PublishInput & { r2?: R2Sources }): string | null {
  const type = body.media_type ?? "IMAGE";
  if (!MEDIA_TYPES.has(type)) {
    return `media_type must be one of REELS, IMAGE, CAROUSEL, STORIES (got "${type}")`;
  }

  switch (type) {
    case "REELS":
      if (!body.video_url && !body.r2?.video_url) return "REELS requires video_url or a local file";
      break;
    case "IMAGE":
      if (!body.image_url && !body.r2?.image_url) return "IMAGE requires image_url or a local file";
      break;
    case "CAROUSEL":
      if (!body.children?.length) return "CAROUSEL requires children (2–10 items)";
      break;
    case "STORIES":
      if (!body.image_url && !body.video_url && !body.r2?.image_url && !body.r2?.video_url) {
        return "STORIES requires image_url or video_url or a local file";
      }
      break;
  }

  if (body.trial_params) {
    if (type !== "REELS") return "trial_params is only valid for REELS";
    if (!GRADUATION_STRATEGIES.has(body.trial_params.graduation_strategy)) {
      return "trial_params.graduation_strategy must be MANUAL or SS_PERFORMANCE";
    }
  }

  if (body.caption && body.caption.length > 2200) {
    return "caption exceeds 2200 characters";
  }
  if (body.collaborators && body.collaborators.length > 3) {
    return "collaborators is limited to 3";
  }
  if (body.product_tags && body.product_tags.length > 5) {
    return "product_tags is limited to 5";
  }

  return null;
}

/**
 * Default a reel's cover frame to 1s into the video when the caller didn't pick
 * one (and isn't supplying an explicit cover image). Instagram ignores
 * thumb_offset for non-REELS media and when cover_url is set, so this only fires
 * for a REELS post with no cover — keeping callers off frame 0. Mutates `input`.
 */
export function applyReelDefaults(input: PublishInput, r2?: R2Sources): void {
  if (
    input.media_type === "REELS" &&
    input.thumb_offset == null &&
    !input.cover_url &&
    !r2?.cover_url
  ) {
    input.thumb_offset = DEFAULT_REEL_THUMB_OFFSET_MS;
  }
}

/**
 * Resolve every `r2.*` key to a presigned GET and inject it into the matching
 * `PublishInput` field (or carousel child's image_url — carousel local files in
 * this app are always images, per the Photo tab). Returns the keys touched so the
 * caller can reclaim them once Instagram has ingested the media.
 */
async function resolveR2Sources(
  input: PublishInput,
  r2: R2Sources | undefined
): Promise<{ resolved: PublishInput; keysUsed: string[] }> {
  if (!r2) return { resolved: input, keysUsed: [] };

  const keysUsed: string[] = [];
  const resolved: PublishInput = { ...input };

  if (r2.video_url) {
    resolved.video_url = await presignGet(r2.video_url);
    keysUsed.push(r2.video_url);
  }
  if (r2.image_url) {
    resolved.image_url = await presignGet(r2.image_url);
    keysUsed.push(r2.image_url);
  }
  if (r2.cover_url) {
    resolved.cover_url = await presignGet(r2.cover_url);
    keysUsed.push(r2.cover_url);
  }
  if (r2.children?.length && resolved.children?.length) {
    const children = [...resolved.children];
    for (let i = 0; i < r2.children.length; i++) {
      const key = r2.children[i];
      if (!key) continue;
      const existing = children[i];
      const base = typeof existing === "string" ? {} : (existing ?? {});
      children[i] = { ...base, image_url: await presignGet(key) };
      keysUsed.push(key);
    }
    resolved.children = children;
  }

  return { resolved, keysUsed };
}

export interface PublishHttpResult {
  result: PublishResult;
  /** 200 published/FINISHED, 202 still processing. */
  status: number;
}

/**
 * Resolve R2 keys, create + (by default) publish the container, and reclaim the
 * R2 source once Instagram no longer needs it.
 *
 * Reclaim timing mirrors the browser flow: only delete the source when the media
 * is published or the container reached FINISHED (bytes fully ingested). On a 202
 * the container is still IN_PROGRESS and may still be fetching the source, so the
 * objects are left in place (the bucket lifecycle rule backstops them). On an
 * outright failure the container will never fetch the source, so reclaim now.
 *
 * `keysUsed` equals the `r2` keys, so passing freshly-uploaded local-file keys
 * here means this function also cleans them up on failure.
 */
export async function publishFromR2(
  input: PublishInput,
  r2: R2Sources | undefined,
  opts: PublishOptions
): Promise<PublishHttpResult> {
  let keysUsed: string[] = [];
  try {
    const { resolved, keysUsed: used } = await resolveR2Sources(input, r2);
    keysUsed = used;

    const result = await publishMedia(resolved, opts);
    const status = result.published ? 200 : result.status_code === "FINISHED" ? 200 : 202;

    if (keysUsed.length && (result.published || result.status_code === "FINISHED")) {
      await reclaimKeys(keysUsed);
    }
    return { result, status };
  } catch (err) {
    if (keysUsed.length) await reclaimKeys(keysUsed);
    throw err;
  }
}

/** Map a publish/Graph error to the routes' shared JSON error response. */
export function handlePublishError(err: unknown): NextResponse {
  if (err instanceof RateLimitError) {
    return NextResponse.json({ error: "rate_limit", message: err.message }, { status: 429 });
  }
  if (err instanceof ContainerFailedError) {
    return NextResponse.json(
      { error: "processing_failed", message: err.message, container_id: err.containerId },
      { status: 422 }
    );
  }
  if (err instanceof InstagramError) {
    return NextResponse.json(
      { error: "instagram_api", message: err.message, code: err.code },
      { status: 400 }
    );
  }
  const message = err instanceof Error ? err.message : "Unknown error";
  return NextResponse.json({ error: "internal", message }, { status: 500 });
}
