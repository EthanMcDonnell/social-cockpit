/**
 * Media staging for scheduled posts — the module that enforces the rule this
 * whole feature is built around: **nothing reaches Cloudflare R2 until publish
 * time.**
 *
 * Between scheduling and firing, a job's media is always just a path on this
 * machine. Two ways it gets there:
 *
 *   owned=0  The caller passed `video_path` etc. to POST /api/schedule. We
 *            record the path and never touch the file — no copy, no upload.
 *   owned=1  The browser dropped a file on the calendar. A File can't survive a
 *            reload and isn't allowed in R2, so it's streamed to data/staged/
 *            and we own that copy until the job publishes or is cancelled.
 *
 * The owned/referenced split is the whole cleanup story: owned files are deleted
 * when they're done, referenced files are never ours to delete.
 *
 * Server-side only.
 */

import { randomUUID } from "crypto";
import fs from "fs";
import { mkdir, stat, unlink } from "fs/promises";
import path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { getDb } from "@/lib/db";
import { statLocalFile, contentTypeFor, PathError } from "@/lib/publish/local-source";
import { referencedStagedIds } from "./store";
import type { StagedMedia, StagedMediaStatus } from "./types";

/** Where browser uploads land. Sits beside the SQLite files, so one backup covers both. */
export const STAGE_DIR =
  process.env.SCHEDULE_MEDIA_DIR ?? path.join(process.cwd(), "data", "staged");

/** Owned files with no job referencing them are swept after this long. */
const ORPHAN_TTL_HOURS = 24 * 7;

/** The upload would exceed SCHEDULE_MEDIA_CAP_BYTES. */
export class StageCapError extends Error {}

export { PathError };

/**
 * Local-disk ceiling for *owned* staged media. Referenced paths don't count —
 * they're the user's own files, sitting where they already were. Mirrors the R2
 * cap in src/lib/storage/usage.ts, for the same reason: nothing else bounds it.
 */
function capBytes(): number {
  const raw = Number(process.env.SCHEDULE_MEDIA_CAP_BYTES);
  return Number.isFinite(raw) && raw > 0 ? raw : 20 * 1024 * 1024 * 1024;
}

interface StagedRow {
  id: string;
  path: string;
  owned: number;
  size_bytes: number;
  content_type: string;
  created_at: string;
}

function rowToStaged(row: StagedRow): StagedMedia {
  return {
    id: row.id,
    path: row.path,
    owned: row.owned === 1,
    size_bytes: row.size_bytes,
    content_type: row.content_type,
    created_at: row.created_at,
  };
}

export function stagedBytes(): number {
  const row = getDb()
    .prepare("SELECT COALESCE(SUM(size_bytes), 0) AS total FROM scheduled_media WHERE owned = 1")
    .get() as { total: number } | undefined;
  return row?.total ?? 0;
}

export function stageUsage(): { used: number; cap: number } {
  return { used: stagedBytes(), cap: capBytes() };
}

// ─── Registering media ───────────────────────────────────────────────────────

/**
 * Record a path the caller already has on disk. Validates it now (exists, is a
 * file, inside LOCAL_MEDIA_ROOT) so a typo fails the schedule call rather than
 * the 3am publish. Nothing is copied and nothing is uploaded.
 */
export async function registerLocalPath(inputPath: string): Promise<StagedMedia> {
  const info = await statLocalFile(inputPath);
  const id = randomUUID();

  getDb()
    .prepare(
      `INSERT INTO scheduled_media (id, path, owned, size_bytes, content_type)
       VALUES (?, ?, 0, ?, ?)`
    )
    .run(id, info.path, info.size, info.contentType);

  return {
    id,
    path: info.path,
    owned: false,
    size_bytes: info.size,
    content_type: info.contentType,
    created_at: new Date().toISOString(),
  };
}

/**
 * Stream a browser upload to data/staged and take ownership of it.
 *
 * `declaredSize` (the request's Content-Length) gates the cap *before* we write
 * a byte, so an oversized upload is rejected rather than filling the disk and
 * then being deleted. The actual bytes written are re-checked afterwards, since
 * a client can lie about Content-Length.
 */
export async function stageUpload(
  body: ReadableStream<Uint8Array>,
  opts: { filename?: string; contentType?: string; declaredSize?: number }
): Promise<StagedMedia> {
  const cap = capBytes();
  const used = stagedBytes();
  if (opts.declaredSize && used + opts.declaredSize > cap) {
    throw new StageCapError(
      `Staging cap reached (${formatBytes(used)} of ${formatBytes(cap)} used).`
    );
  }

  await mkdir(STAGE_DIR, { recursive: true });

  const ext = opts.filename ? path.extname(opts.filename).slice(0, 12) : "";
  const id = randomUUID();
  const dest = path.join(STAGE_DIR, `${id}${ext}`);

  try {
    await pipeline(Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0]), fs.createWriteStream(dest));
  } catch (err) {
    await unlink(dest).catch(() => {});
    throw err;
  }

  const written = (await stat(dest)).size;
  if (used + written > cap) {
    await unlink(dest).catch(() => {});
    throw new StageCapError(
      `Staging cap reached (${formatBytes(used)} of ${formatBytes(cap)} used).`
    );
  }

  const contentType =
    opts.contentType && opts.contentType !== "application/octet-stream"
      ? opts.contentType
      : contentTypeFor(opts.filename ?? dest);

  getDb()
    .prepare(
      `INSERT INTO scheduled_media (id, path, owned, size_bytes, content_type)
       VALUES (?, ?, 1, ?, ?)`
    )
    .run(id, dest, written, contentType);

  return {
    id,
    path: dest,
    owned: true,
    size_bytes: written,
    content_type: contentType,
    created_at: new Date().toISOString(),
  };
}

// ─── Reading ─────────────────────────────────────────────────────────────────

export function getStagedMedia(id: string): StagedMedia | null {
  const row = getDb()
    .prepare("SELECT * FROM scheduled_media WHERE id = ?")
    .get(id) as StagedRow | undefined;
  return row ? rowToStaged(row) : null;
}

export function getStagedMediaMany(ids: string[]): Map<string, StagedMedia> {
  const out = new Map<string, StagedMedia>();
  if (!ids.length) return out;
  const rows = getDb()
    .prepare(
      `SELECT * FROM scheduled_media WHERE id IN (${ids.map(() => "?").join(",")})`
    )
    .all(...ids) as StagedRow[];
  for (const row of rows) out.set(row.id, rowToStaged(row));
  return out;
}

/**
 * Add a liveness check. A referenced path can be moved or deleted between
 * scheduling and firing, and the calendar badges that *before* the slot arrives
 * rather than letting it surface as a 3am failure.
 */
export function withStatus(media: StagedMedia): StagedMediaStatus {
  return {
    ...media,
    missing: !fs.existsSync(media.path),
    filename: path.basename(media.path),
  };
}

// ─── Cleanup ─────────────────────────────────────────────────────────────────

/**
 * Drop staged media by id: deletes the file only when we own it, always drops
 * the row. Called when a job publishes, fails terminally, or is cancelled.
 */
export async function releaseStaged(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const media = getStagedMediaMany(ids);

  for (const item of Array.from(media.values())) {
    if (item.owned) {
      await unlink(item.path).catch(() => {
        /* already gone — the row still goes */
      });
    }
  }

  getDb()
    .prepare(`DELETE FROM scheduled_media WHERE id IN (${ids.map(() => "?").join(",")})`)
    .run(...ids);
}

/**
 * Sweep owned files that no job references and that are older than the TTL —
 * the "uploaded a video, then closed the tab" case, which would otherwise hold
 * disk (and cap headroom) forever. Referenced-path rows are dropped too, but
 * their files are left alone.
 */
export async function sweepOrphanedStaged(): Promise<number> {
  const referenced = referencedStagedIds();
  const rows = getDb()
    .prepare(
      "SELECT * FROM scheduled_media WHERE created_at < datetime('now', ?)"
    )
    .all(`-${ORPHAN_TTL_HOURS} hours`) as StagedRow[];

  const orphans = rows.filter((r) => !referenced.has(r.id));
  if (!orphans.length) return 0;

  await releaseStaged(orphans.map((r) => r.id));
  return orphans.length;
}

function formatBytes(n: number): string {
  const gb = n / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${(n / 1024 ** 2).toFixed(0)} MB`;
}
