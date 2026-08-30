/**
 * The durable copy of every video this app publishes.
 *
 * Everything else in this codebase deliberately avoids copying the user's
 * files: `scheduled_media` with owned=0 and `slug_videos.path` both reference a
 * library in place, and that is the right call for cross-posting — a pool works
 * through a library over a few weeks, and the files are still where they were.
 *
 * Reposting breaks that assumption. It asks to publish something from eight
 * months ago, by which time the original has plausibly been moved, renamed,
 * archived to an external drive, or deleted. A reference is not enough; the
 * bytes have to be ours. So this module is the one place that does copy, and it
 * keeps what it copies indefinitely.
 *
 * Identity is the SHA-256 of the content, not the path. Publishing the same
 * clip twice from two directories is one archived video with one repost
 * history, rather than two that each get their own turn in the rotation.
 *
 * Server-side only.
 */

import { randomUUID, createHash } from "crypto";
import fs from "fs";
import { copyFile, mkdir, rename, stat, unlink } from "fs/promises";
import path from "path";
import { pipeline } from "stream/promises";
import { config } from "@/lib/config";
import { getDb } from "@/lib/db";
import { contentTypeFor } from "@/lib/publish/local-source";
import { reportWarn } from "@/lib/observability";
import type { ArchivedVideo, ArchiveUsage } from "./types";

export type { ArchivedVideo, ArchiveUsage };

export const ARCHIVE_DIR = config.archive.dir;

/** The archive would exceed ARCHIVE_CAP_BYTES. */
export class ArchiveCapError extends Error {}

interface ArchiveRow {
  id: string;
  sha256: string;
  path: string;
  source_path: string | null;
  size_bytes: number;
  content_type: string;
  label: string | null;
  origin_slug: string | null;
  created_at: string;
}

function rowToArchived(row: ArchiveRow): ArchivedVideo {
  return {
    id: row.id,
    sha256: row.sha256,
    path: row.path,
    source_path: row.source_path ?? undefined,
    size_bytes: row.size_bytes,
    content_type: row.content_type,
    label: row.label ?? undefined,
    origin_slug: row.origin_slug ?? undefined,
    created_at: row.created_at,
  };
}

// ─── Reading ─────────────────────────────────────────────────────────────────

export function getArchived(id: string): ArchivedVideo | null {
  const row = getDb()
    .prepare("SELECT * FROM archived_videos WHERE id = ?")
    .get(id) as ArchiveRow | undefined;
  return row ? rowToArchived(row) : null;
}

export function getArchivedByHash(sha256: string): ArchivedVideo | null {
  const row = getDb()
    .prepare("SELECT * FROM archived_videos WHERE sha256 = ?")
    .get(sha256) as ArchiveRow | undefined;
  return row ? rowToArchived(row) : null;
}

export function listArchived(): ArchivedVideo[] {
  return (
    getDb()
      .prepare("SELECT * FROM archived_videos ORDER BY created_at DESC")
      .all() as ArchiveRow[]
  ).map(rowToArchived);
}

export function archivedBytes(): number {
  const row = getDb()
    .prepare("SELECT COALESCE(SUM(size_bytes), 0) AS total, COUNT(*) AS n FROM archived_videos")
    .get() as { total: number; n: number } | undefined;
  return row?.total ?? 0;
}

export function archiveUsage(): ArchiveUsage {
  const row = getDb()
    .prepare("SELECT COALESCE(SUM(size_bytes), 0) AS total, COUNT(*) AS n FROM archived_videos")
    .get() as { total: number; n: number } | undefined;
  return { used: row?.total ?? 0, cap: config.archive.capBytes, count: row?.n ?? 0 };
}

/** The archived copy exists on disk. A row whose file was deleted is not usable. */
export function archiveFileExists(video: ArchivedVideo): boolean {
  return fs.existsSync(video.path);
}

// ─── Writing ─────────────────────────────────────────────────────────────────

export interface ArchiveInput {
  /** Absolute path to the file that was just published. */
  path: string;
  /** The slug it went out under, if any — the repost opt-in is read from it. */
  slug?: string;
  label?: string;
}

/**
 * Preserve a published video, or recognise one we already hold.
 *
 * Idempotent on content: hashing first means re-publishing the same clip is a
 * cheap no-op rather than a second copy, and means a file that was moved
 * between publishes is still recognised as the video it always was.
 *
 * The copy lands under a `YYYY/MM/` prefix so the directory stays browsable by
 * hand after a few hundred videos, and is written to a temporary name and
 * renamed into place — a crash mid-copy must not leave a truncated file that a
 * later publish would happily hand to Instagram.
 */
export async function archiveVideo(input: ArchiveInput): Promise<ArchivedVideo> {
  const info = await stat(input.path);
  if (!info.isFile()) throw new Error(`Not a file: ${input.path}`);

  const sha256 = await hashFile(input.path);

  // Content we already hold. Refresh the origin slug only if we never had one:
  // the first slug a video published under is the one whose repost opt-in
  // governs it, and a later cross-post must not silently reassign that.
  const existing = getArchivedByHash(sha256);
  if (existing) {
    if (!existing.origin_slug && input.slug) {
      getDb()
        .prepare("UPDATE archived_videos SET origin_slug = ? WHERE id = ?")
        .run(input.slug, existing.id);
      return { ...existing, origin_slug: input.slug };
    }
    return existing;
  }

  const usage = archiveUsage();
  if (usage.used + info.size > usage.cap) {
    throw new ArchiveCapError(
      `Archive cap reached (${formatBytes(usage.used)} of ${formatBytes(usage.cap)} used).`
    );
  }

  const now = new Date();
  const dir = path.join(
    ARCHIVE_DIR,
    String(now.getUTCFullYear()),
    String(now.getUTCMonth() + 1).padStart(2, "0")
  );
  await mkdir(dir, { recursive: true });

  const id = randomUUID();
  const ext = path.extname(input.path).slice(0, 12);
  const dest = path.join(dir, `${id}${ext}`);
  const temp = `${dest}.partial`;

  try {
    await copyFile(input.path, temp);
    await rename(temp, dest);
  } catch (err) {
    await unlink(temp).catch(() => {});
    throw err;
  }

  try {
    getDb()
      .prepare(
        `INSERT INTO archived_videos
           (id, sha256, path, source_path, size_bytes, content_type, label, origin_slug)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        sha256,
        dest,
        input.path,
        info.size,
        contentTypeFor(input.path),
        input.label?.trim() || null,
        input.slug?.trim() || null
      );
  } catch (err) {
    // The UNIQUE index on sha256 is the cross-process backstop: another worker
    // archived the same bytes while we were copying. Its copy is the one that
    // exists, so drop ours and adopt it rather than stranding a duplicate file.
    const winner = getArchivedByHash(sha256);
    await unlink(dest).catch(() => {});
    if (winner) return winner;
    throw err;
  }

  return getArchived(id)!;
}

/**
 * Archive without ever failing the caller.
 *
 * Called on the way out of a publish that has *already happened*. The post is
 * live; losing the archived copy costs a future repost, and is not worth
 * turning a successful publish into a failed job over. Reports and returns
 * null instead.
 */
export async function tryArchiveVideo(input: ArchiveInput): Promise<ArchivedVideo | null> {
  try {
    return await archiveVideo(input);
  } catch (err) {
    reportWarn(
      "archive",
      "archive_failed",
      `could not archive ${input.path}: ${err instanceof Error ? err.message : String(err)}`,
      { meta: { path: input.path, slug: input.slug } }
    );
    return null;
  }
}

/**
 * Forget an archived video and delete its copy.
 *
 * Unlike a pool candidate, this file *is* ours, so removing the row without
 * deleting the bytes would leak disk with nothing left pointing at it.
 */
export async function removeArchived(id: string): Promise<boolean> {
  const video = getArchived(id);
  if (!video) return false;

  await unlink(video.path).catch(() => {
    /* already gone — the row still goes */
  });

  const db = getDb();
  const remove = db.transaction(() => {
    db.prepare("UPDATE slug_videos SET archive_id = NULL WHERE archive_id = ?").run(id);
    db.prepare("DELETE FROM repost_blocks WHERE archive_id = ?").run(id);
    db.prepare("DELETE FROM repost_events WHERE archive_id = ?").run(id);
    return db.prepare("DELETE FROM archived_videos WHERE id = ?").run(id).changes > 0;
  });
  return remove.immediate();
}

/** Point a pool candidate at its archived copy, so it outlives the original. */
export function linkCandidate(videoId: string, archiveId: string): void {
  getDb().prepare("UPDATE slug_videos SET archive_id = ? WHERE id = ?").run(archiveId, videoId);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Streamed rather than read whole: this runs on the publish path for files that
 * are routinely hundreds of megabytes, and buffering one to hash it would spike
 * memory on a box that is also serving the app.
 */
async function hashFile(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(fs.createReadStream(filePath), hash);
  return hash.digest("hex");
}

function formatBytes(n: number): string {
  const gb = n / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${(n / 1024 ** 2).toFixed(0)} MB`;
}
