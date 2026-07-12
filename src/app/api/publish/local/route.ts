import { NextRequest, NextResponse } from "next/server";
import { readFile, stat } from "fs/promises";
import path from "path";
import type { PublishInput } from "@/lib/instagram/endpoints/publish";
import {
  validatePublish,
  applyReelDefaults,
  publishFromR2,
  handlePublishError,
  type R2Sources,
} from "@/lib/instagram/publish-flow";
import { generateKey, putObject } from "@/lib/storage/r2";
import { reserve, release } from "@/lib/storage/usage";
import { reclaimKeys } from "@/lib/storage/reclaim";

export const dynamic = "force-dynamic";

/** Filesystem-path source fields (parallel to /api/publish's `r2` key map). */
interface LocalSources {
  /** Reel/Story video on disk. */
  video_path?: string;
  /** Story or single-image photo on disk. */
  image_path?: string;
  /** Reel cover image on disk. */
  cover_path?: string;
  /** Carousel images on disk — index-aligned with the resulting children. */
  children_paths?: (string | null)[];
}

/** Extension → Content-Type for the local media we support publishing. */
const CONTENT_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  mov: "video/quicktime",
  m4v: "video/x-m4v",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
};

function contentTypeFor(filePath: string): string {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

/** A bad/missing/out-of-bounds filesystem path — surfaces as a 400. */
class PathError extends Error {}
/** The upload would exceed R2_CAP_BYTES — surfaces as a 429. */
class CapError extends Error {}

/**
 * Resolve a caller-supplied path to an absolute path, enforcing LOCAL_MEDIA_ROOT
 * when set: the resolved path must be the root itself or sit inside it. This
 * keeps the endpoint from being an arbitrary-file-read surface. When the env is
 * unset (default for a single-user local install), any absolute path is allowed.
 */
function resolveLocalPath(input: string): string {
  const abs = path.resolve(input);
  const root = process.env.LOCAL_MEDIA_ROOT;
  if (root) {
    const absRoot = path.resolve(root);
    if (abs !== absRoot && !abs.startsWith(absRoot + path.sep)) {
      throw new PathError(`Path is outside LOCAL_MEDIA_ROOT: ${input}`);
    }
  }
  return abs;
}

/**
 * Read a local file, reserve headroom against the cap, and upload it to R2.
 * Returns the object key and records it in `uploaded` so the caller can reclaim
 * on a later failure. Throws PathError (bad path) or CapError (cap reached).
 */
async function uploadPath(localPath: string, uploaded: string[]): Promise<string> {
  const abs = resolveLocalPath(localPath);

  let info;
  try {
    info = await stat(abs);
  } catch {
    throw new PathError(`File not found: ${localPath}`);
  }
  if (!info.isFile()) throw new PathError(`Not a file: ${localPath}`);

  const buf = await readFile(abs);
  const size = buf.length;
  const key = generateKey(path.extname(abs).slice(1));

  if (!reserve(key, size)) throw new CapError();
  try {
    await putObject(key, buf, contentTypeFor(abs), size);
  } catch (err) {
    release(key); // nothing landed in the bucket — don't strand the reservation
    throw err;
  }
  uploaded.push(key);
  return key;
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
    ...input
  } = body;

  // A lone video_path almost always means a reel; save the caller the field.
  if (!input.media_type && video_path) input.media_type = "REELS";

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
    // publishFromR2 reclaims the uploaded keys on success (FINISHED) or failure;
    // on a 202 it leaves them for the bucket lifecycle rule, same as the UI flow.
    const { result, status } = await publishFromR2(input, r2, { finalize, timeoutMs, intervalMs });
    return NextResponse.json(result, { status });
  } catch (err) {
    return handlePublishError(err);
  }
}
