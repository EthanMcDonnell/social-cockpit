/**
 * Local filesystem → R2 source staging.
 *
 * Shared by the local publish route (POST /api/publish/local) and the scheduler
 * worker, which both need the same thing: take a path on this machine, check
 * it's readable and allowed, and push its bytes into R2 just long enough for
 * Instagram/YouTube to fetch them.
 *
 * Extracted from the route so the scheduler can reuse it verbatim — which also
 * means LOCAL_MEDIA_ROOT confinement and R2 cap accounting apply identically to
 * a scheduled job and an immediate publish, rather than being re-derived.
 */

import { readFile, stat } from "fs/promises";
import { config } from "@/lib/config";
import path from "path";
import { generateKey, putObject } from "@/lib/storage/r2";
import { reserve, release } from "@/lib/storage/usage";

/** Extension → Content-Type for the local media we support publishing. */
export const CONTENT_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  mov: "video/quicktime",
  m4v: "video/x-m4v",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
};

export function contentTypeFor(filePath: string): string {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

/** A bad/missing/out-of-bounds filesystem path — surfaces as a 400. */
export class PathError extends Error {}

/** The upload would exceed R2_CAP_BYTES — surfaces as a 429. */
export class CapError extends Error {}

/**
 * Resolve a caller-supplied path to an absolute path, enforcing LOCAL_MEDIA_ROOT
 * when set: the resolved path must be the root itself or sit inside it. This
 * keeps the endpoint from being an arbitrary-file-read surface. When the env is
 * unset (default for a single-user local install), any absolute path is allowed.
 */
export function resolveLocalPath(input: string): string {
  const abs = path.resolve(input);
  const root = config.localMediaRoot;
  if (root) {
    const absRoot = path.resolve(root);
    if (abs !== absRoot && !abs.startsWith(absRoot + path.sep)) {
      throw new PathError(`Path is outside LOCAL_MEDIA_ROOT: ${input}`);
    }
  }
  return abs;
}

export interface LocalFileInfo {
  /** Absolute, LOCAL_MEDIA_ROOT-checked path. */
  path: string;
  size: number;
  contentType: string;
}

/**
 * Pre-flight a local source without reading or uploading it: resolve + confine
 * the path, confirm it's a readable regular file, and measure it.
 *
 * The scheduler leans on this twice — once at schedule time so a typo 400s
 * immediately, and again at fire time, because a path scheduled last Tuesday may
 * point at a file that has since been moved or deleted. Cheap enough to call on
 * every calendar load.
 */
export async function statLocalFile(input: string): Promise<LocalFileInfo> {
  const abs = resolveLocalPath(input);

  let info;
  try {
    info = await stat(abs);
  } catch {
    throw new PathError(`File not found: ${input}`);
  }
  if (!info.isFile()) throw new PathError(`Not a file: ${input}`);

  return { path: abs, size: info.size, contentType: contentTypeFor(abs) };
}

export interface UploadedSource {
  /** R2 object key. */
  key: string;
  /** Bytes actually uploaded. */
  size: number;
  contentType: string;
}

/**
 * Read a local file, reserve headroom against the cap, and upload it to R2.
 * Records the key in `uploaded` so the caller can reclaim on a later failure.
 * Throws PathError (bad path) or CapError (cap reached).
 *
 * Returns the size and content type as well as the key, because the YouTube
 * upload path needs both for its resumable session's Content-Length.
 */
export async function uploadLocalFile(
  localPath: string,
  uploaded: string[]
): Promise<UploadedSource> {
  const { path: abs, contentType } = await statLocalFile(localPath);

  const buf = await readFile(abs);
  const key = generateKey(path.extname(abs).slice(1));

  // The buffer is what we actually send, so its length — not the earlier stat —
  // is what the reservation and the Content-Length record.
  if (!reserve(key, buf.length)) throw new CapError();
  try {
    await putObject(key, buf, contentType, buf.length);
  } catch (err) {
    release(key); // nothing landed in the bucket — don't strand the reservation
    throw err;
  }
  uploaded.push(key);
  return { key, size: buf.length, contentType };
}

/** Key-only convenience for the publish routes, which build an `r2` key map. */
export async function uploadPath(localPath: string, uploaded: string[]): Promise<string> {
  return (await uploadLocalFile(localPath, uploaded)).key;
}
