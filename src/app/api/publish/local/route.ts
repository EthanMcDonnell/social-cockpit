import { NextRequest, NextResponse } from "next/server";
import type { PublishInput } from "@/lib/instagram/endpoints/publish";
import {
  validatePublish,
  applyReelDefaults,
  handlePublishError,
  type R2Sources,
} from "@/lib/instagram/publish-flow";
import { executePublish } from "@/lib/publish/execute";
import { uploadPath, PathError, CapError } from "@/lib/publish/local-source";
import { reclaimKeys } from "@/lib/storage/reclaim";
import { getDb } from "@/lib/db";
import {
  planAutomation,
  type AutomationSpec,
  type AutomationPlan,
} from "@/lib/automation/attach";

export const dynamic = "force-dynamic";

/** Filesystem-path source fields (parallel to /api/publish's `r2` key map). */
export interface LocalSources {
  /** Reel/Story video on disk. */
  video_path?: string;
  /** Story or single-image photo on disk. */
  image_path?: string;
  /** Reel cover image on disk. */
  cover_path?: string;
  /** Carousel images on disk — index-aligned with the resulting children. */
  children_paths?: (string | null)[];
}

/**
 * POST /api/publish/local — publish media from a local filesystem path. The
 * server reads each `*_path`, uploads it to R2, resolves a presigned URL, and
 * runs the same publish flow as POST /api/publish. Everything (R2 upload,
 * Instagram call, cleanup) is managed here — no browser upload step.
 *
 * Body: the PublishInput fields (caption, trial_params, thumb_offset, …) plus
 * any of video_path / image_path / cover_path / children_paths. media_type
 * defaults to REELS when video_path is given. As with /api/publish, a REELS post
 * with no cover gets a 1s thumbnail automatically.
 *
 * Also accepts an optional `automation` block (same as POST /api/publish) to wire
 * the published post into a comment automation in one call — see
 * docs/publish-with-automation.md. Attaches only once the post publishes (has a
 * media_id); with automation present and no explicit timeout, the publish waits
 * up to 5 minutes so a slow reel still resolves synchronously.
 *
 * To publish this same body *later*, POST it to /api/schedule with a
 * `scheduled_at` — the file stays on disk until the slot arrives.
 *
 *   curl -X POST localhost:3000/api/publish/local -H 'Content-Type: application/json' \
 *     -d '{"video_path":"/Users/me/reel.mp4","caption":"gm",
 *          "trial_params":{"graduation_strategy":"MANUAL"}}'
 */
export async function POST(request: NextRequest) {
  let body: PublishInput &
    LocalSources & {
      finalize?: boolean;
      timeoutMs?: number;
      intervalMs?: number;
      automation?: AutomationSpec;
    };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "bad_request", message: "Body must be valid JSON" },
      { status: 400 }
    );
  }

  const {
    video_path,
    image_path,
    cover_path,
    children_paths,
    finalize,
    timeoutMs,
    intervalMs,
    automation,
    ...input
  } = body;

  // A lone video_path almost always means a reel; save the caller the field.
  if (!input.media_type && video_path) input.media_type = "REELS";

  // Validate + resolve the automation (create vs append) before uploading a big
  // file, so a bad automation spec fails fast without a wasted R2 upload.
  let plan: AutomationPlan | undefined;
  if (automation) {
    const planned = planAutomation(getDb(), automation);
    if ("error" in planned) {
      return NextResponse.json({ error: "invalid_param", message: planned.error }, { status: 400 });
    }
    plan = planned.plan;
  }

  // Upload every provided local path to R2, building the `r2` key map. On any
  // failure, reclaim whatever already landed so a partial upload can't leak.
  const r2: R2Sources = {};
  const uploaded: string[] = [];
  try {
    if (video_path) r2.video_url = await uploadPath(video_path, uploaded);
    if (image_path) r2.image_url = await uploadPath(image_path, uploaded);
    if (cover_path) r2.cover_url = await uploadPath(cover_path, uploaded);
    if (Array.isArray(children_paths) && children_paths.length) {
      r2.children = [];
      for (const child of children_paths) {
        r2.children.push(child ? await uploadPath(child, uploaded) : null);
      }
    }
  } catch (err) {
    if (uploaded.length) await reclaimKeys(uploaded);
    if (err instanceof CapError) {
      return NextResponse.json(
        { error: "storage_cap", message: "R2 storage cap reached — try again shortly." },
        { status: 429 }
      );
    }
    if (err instanceof PathError) {
      return NextResponse.json({ error: "invalid_path", message: err.message }, { status: 400 });
    }
    return handlePublishError(err);
  }

  // Validate with the uploaded keys in hand (they satisfy the source requirement).
  const problem = validatePublish({ ...input, r2 });
  if (problem) {
    if (uploaded.length) await reclaimKeys(uploaded);
    return NextResponse.json({ error: "invalid_param", message: problem }, { status: 400 });
  }

  applyReelDefaults(input, r2);

  try {
    // executePublish reclaims the uploaded keys on success (FINISHED) or failure;
    // on a 202 it leaves them for the bucket lifecycle rule, same as the UI flow.
    const { result, status, automation: attach } = await executePublish({
      input,
      r2,
      finalize,
      timeoutMs,
      intervalMs,
      plan,
    });
    return NextResponse.json(attach ? { ...result, automation: attach } : result, { status });
  } catch (err) {
    return handlePublishError(err);
  }
}
