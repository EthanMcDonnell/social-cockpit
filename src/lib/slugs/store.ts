/**
 * Every read and write against the slug content-pool tables.
 *
 * A slug is one string with two facets: the automation flow it fires (which
 * already existed as `automation_flows.automation_key`) and the pool of videos
 * it can post (this module). Neither facet requires the other — the join is the
 * string itself, looked up when a view wants to show both.
 *
 * Enrolment is deliberately incremental and idempotent: the same path enrolled
 * twice is one candidate, not two, so a video re-posted under its slug does not
 * quietly double its own odds of being picked again.
 *
 * Server-side only.
 */

import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { getDb } from "@/lib/db";
import { reservedSlugVideoIds } from "@/lib/schedule/store";
import { statLocalFile, PathError } from "@/lib/publish/local-source";
import type { SchedulePlatform } from "@/lib/schedule/types";
import {
  isSelectionMethod,
  type Slug,
  type SelectionMethod,
  type SlugVideo,
  type SlugVideoPayload,
  type SlugVideoPost,
  type SlugSummary,
} from "./types";

const PLATFORMS: SchedulePlatform[] = ["ig", "yt"];

/**
 * Slugs are matched exactly, so they are normalised once on the way in rather
 * than case-folded on every lookup. Mirrors the shape `automation_key` already
 * takes in practice, so the two facets keep meeting on the same string.
 */
export function normalizeSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

interface SlugRow {
  slug: string;
  name: string | null;
  selection_method: string | null;
  created_at: string;
  updated_at: string;
}

interface VideoRow {
  id: string;
  seq: number;
  slug: string;
  path: string;
  label: string | null;
  payload: string;
  created_at: string;
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function rowToSlug(row: SlugRow): Slug {
  return {
    slug: row.slug,
    name: row.name ?? undefined,
    selection_method: isSelectionMethod(row.selection_method)
      ? row.selection_method
      : undefined,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function rowToVideo(row: VideoRow, posts: SlugVideoPost[]): SlugVideo {
  return {
    id: row.id,
    seq: row.seq,
    slug: row.slug,
    path: row.path,
    label: row.label ?? undefined,
    payload: parseJson<SlugVideoPayload>(row.payload, {}),
    created_at: row.created_at,
    posts,
  };
}

// ─── Slugs ───────────────────────────────────────────────────────────────────

export function getSlug(slug: string): Slug | null {
  const row = getDb()
    .prepare("SELECT * FROM slugs WHERE slug = ?")
    .get(slug) as SlugRow | undefined;
  return row ? rowToSlug(row) : null;
}

/**
 * Create the slug if it is new, leave it alone if it is not.
 *
 * Called from every path that brings a slug into existence — enrolling a video,
 * booking a slot, creating a keyed automation flow — so that the registry is
 * never behind the thing referencing it. It must never clobber a name or a
 * selection override the user set by hand.
 *
 * The string is stored as given. Normalisation belongs at the input boundary,
 * where a person typed something; an automation key that predates this table
 * has to be adopted exactly as the flow spells it, or the flow and its slug
 * would stop matching.
 */
export function ensureSlug(slug: string, name?: string): Slug {
  const trimmed = slug.trim();
  if (!trimmed) throw new Error("A slug needs at least one letter or digit.");
  getDb()
    .prepare("INSERT OR IGNORE INTO slugs (slug, name) VALUES (?, ?)")
    .run(trimmed, name?.trim() || null);
  return getSlug(trimmed)!;
}

export function updateSlug(
  slug: string,
  patch: { name?: string | null; selection_method?: SelectionMethod | null }
): Slug | null {
  const sets: string[] = [];
  const params: (string | null)[] = [];
  if (patch.name !== undefined) {
    sets.push("name = ?");
    params.push(patch.name?.trim() || null);
  }
  if (patch.selection_method !== undefined) {
    sets.push("selection_method = ?");
    params.push(patch.selection_method ?? null);
  }
  if (!sets.length) return getSlug(slug);

  sets.push("updated_at = datetime('now')");
  const info = getDb()
    .prepare(`UPDATE slugs SET ${sets.join(", ")} WHERE slug = ?`)
    .run(...params, slug);
  return info.changes ? getSlug(slug) : null;
}

/**
 * Drop a slug and its pool.
 *
 * Refused while an automation flow still fires on it: the slug is that flow's
 * identity, and removing the registry row would leave the flow pointing at
 * nothing. Clearing the pool is offered instead, which is the part a pool page
 * actually owns.
 */
export function deleteSlug(slug: string): { deleted: boolean; blockedBy?: string } {
  if (linkedAutomation(slug)) {
    return { deleted: false, blockedBy: linkedAutomation(slug)!.name };
  }

  const db = getDb();
  const remove = db.transaction(() => {
    clearPoolWithin(db, slug);
    return db.prepare("DELETE FROM slugs WHERE slug = ?").run(slug).changes > 0;
  });
  return { deleted: remove.immediate() };
}

/** Empty a pool without touching the slug itself, or the files on disk. */
export function clearPool(slug: string): number {
  const db = getDb();
  return db.transaction(() => clearPoolWithin(db, slug)).immediate();
}

function clearPoolWithin(db: ReturnType<typeof getDb>, slug: string): number {
  const ids = (db.prepare("SELECT id FROM slug_videos WHERE slug = ?").all(slug) as {
    id: string;
  }[]).map((row) => row.id);
  if (ids.length) {
    db.prepare(
      `DELETE FROM slug_video_posts WHERE video_id IN (${ids.map(() => "?").join(",")})`
    ).run(...ids);
  }
  db.prepare("DELETE FROM slug_videos WHERE slug = ?").run(slug);
  return ids.length;
}

export function listSlugs(): SlugSummary[] {
  const rows = getDb()
    .prepare("SELECT * FROM slugs ORDER BY slug ASC")
    .all() as SlugRow[];

  return rows.map((row) => {
    const videos = listVideos(row.slug);
    const eligible = {} as Record<SchedulePlatform, number>;
    for (const platform of PLATFORMS) {
      eligible[platform] = eligibleVideos(row.slug, platform, videos).length;
    }
    return {
      ...rowToSlug(row),
      video_count: videos.length,
      eligible,
      automation: linkedAutomation(row.slug),
    };
  });
}

/**
 * The automation flow firing on this slug, if any.
 *
 * Not a second home for the slug — the registry row is the slug. This is the
 * other thing that references it, surfaced so the page can say what a pool is
 * wired to.
 */
export function linkedAutomation(
  slug: string
): { flow_id: string; name: string; is_active: boolean } | undefined {
  const row = getDb()
    .prepare(
      "SELECT id, name, is_active FROM automation_flows WHERE automation_key = ? LIMIT 1"
    )
    .get(slug) as { id: string; name: string; is_active: number } | undefined;
  return row ? { flow_id: row.id, name: row.name, is_active: row.is_active === 1 } : undefined;
}

// ─── Videos ──────────────────────────────────────────────────────────────────

export function listVideos(slug: string): SlugVideo[] {
  const rows = getDb()
    .prepare("SELECT rowid AS seq, * FROM slug_videos WHERE slug = ? ORDER BY rowid ASC")
    .all(slug) as VideoRow[];
  if (!rows.length) return [];

  const posts = postsFor(rows.map((row) => row.id));
  return rows.map((row) => rowToVideo(row, posts.get(row.id) ?? []));
}

export function getVideo(id: string): SlugVideo | null {
  const row = getDb()
    .prepare("SELECT rowid AS seq, * FROM slug_videos WHERE id = ?")
    .get(id) as VideoRow | undefined;
  return row ? rowToVideo(row, postsFor([row.id]).get(row.id) ?? []) : null;
}

function postsFor(ids: string[]): Map<string, SlugVideoPost[]> {
  const out = new Map<string, SlugVideoPost[]>();
  if (!ids.length) return out;
  const rows = getDb()
    .prepare(
      `SELECT * FROM slug_video_posts WHERE video_id IN (${ids.map(() => "?").join(",")})
        ORDER BY posted_at ASC`
    )
    .all(...ids) as {
      video_id: string;
      platform: string;
      external_id: string;
      job_id: string | null;
      posted_at: string;
    }[];

  for (const row of rows) {
    const list = out.get(row.video_id) ?? [];
    list.push({
      platform: row.platform as SchedulePlatform,
      external_id: row.external_id,
      job_id: row.job_id ?? undefined,
      posted_at: row.posted_at,
    });
    out.set(row.video_id, list);
  }
  return out;
}

export interface EnrolInput {
  slug: string;
  /** Absolute path on this machine. Validated, measured, never copied. */
  path: string;
  label?: string;
  payload?: SlugVideoPayload;
}

/**
 * Add a candidate to a pool, creating the slug if this is its first video.
 *
 * Idempotent on (slug, path): re-enrolling a file already in the pool returns
 * the existing candidate and merges any new payload defaults into it, rather
 * than inserting a duplicate. That is what makes automatic enrolment safe to
 * run on every publish — the third time a video goes out under its slug is a
 * no-op, not a third entry in the pool.
 *
 * The path is checked here (exists, is a file, inside LOCAL_MEDIA_ROOT) so a
 * typo fails the enrolment call rather than the publish it was meant to feed.
 */
export async function enrolVideo(input: EnrolInput): Promise<SlugVideo> {
  const info = await statLocalFile(input.path);
  // A pool exists to be posted from, and every method that draws on one treats
  // its members as interchangeable videos. Catching a photo (or a .txt) here
  // makes it a failed enrolment rather than a failed publish at 3am.
  if (!info.contentType.startsWith("video/")) {
    throw new PathError(
      `A slug pool holds videos — ${info.path} is ${info.contentType === "application/octet-stream" ? "not a recognised video file" : info.contentType}.`
    );
  }

  const slug = normalizeSlug(input.slug);
  if (!slug) throw new Error("A slug needs at least one letter or digit.");

  const db = getDb();
  // Serialize the read-then-write: two callers enrolling the same file at once
  // (a publish finishing while the pool page adds it by hand) must converge on
  // one candidate, not race and lose one to the unique index.
  const enrol = db.transaction(() => {
    ensureSlug(slug);

    const existing = db
      .prepare("SELECT rowid AS seq, * FROM slug_videos WHERE slug = ? AND path = ?")
      .get(slug, info.path) as VideoRow | undefined;

    if (existing) {
      const merged: SlugVideoPayload = {
        ...parseJson<SlugVideoPayload>(existing.payload, {}),
        ...(input.payload ?? {}),
      };
      db.prepare("UPDATE slug_videos SET label = COALESCE(?, label), payload = ? WHERE id = ?").run(
        input.label?.trim() || null,
        JSON.stringify(merged),
        existing.id
      );
      return existing.id;
    }

    const id = randomUUID();
    db.prepare(
      "INSERT INTO slug_videos (id, slug, path, label, payload) VALUES (?, ?, ?, ?, ?)"
    ).run(id, slug, info.path, input.label?.trim() || null, JSON.stringify(input.payload ?? {}));
    return id;
  });

  try {
    return getVideo(enrol.immediate())!;
  } catch (err) {
    // The unique index is the cross-process backstop. Another writer got there
    // first; its candidate is the one that exists, so adopt it.
    if (!(err instanceof Error) || !/UNIQUE constraint failed/.test(err.message)) throw err;
    const row = db
      .prepare("SELECT rowid AS seq, * FROM slug_videos WHERE slug = ? AND path = ?")
      .get(slug, info.path) as VideoRow | undefined;
    if (!row) throw err;
    return rowToVideo(row, postsFor([row.id]).get(row.id) ?? []);
  }
}

export function updateVideo(
  id: string,
  patch: { label?: string | null; payload?: SlugVideoPayload }
): SlugVideo | null {
  const sets: string[] = [];
  const params: (string | null)[] = [];
  if (patch.label !== undefined) {
    sets.push("label = ?");
    params.push(patch.label?.trim() || null);
  }
  if (patch.payload !== undefined) {
    sets.push("payload = ?");
    params.push(JSON.stringify(patch.payload));
  }
  if (!sets.length) return getVideo(id);

  const info = getDb()
    .prepare(`UPDATE slug_videos SET ${sets.join(", ")} WHERE id = ?`)
    .run(...params, id);
  return info.changes ? getVideo(id) : null;
}

/**
 * Remove a candidate and its posting history.
 *
 * The file itself is never touched: a pool holds references to the user's own
 * library, exactly as `scheduled_media` does with owned=0.
 */
export function removeVideo(id: string): boolean {
  const db = getDb();
  const remove = db.transaction(() => {
    db.prepare("DELETE FROM slug_video_posts WHERE video_id = ?").run(id);
    return db.prepare("DELETE FROM slug_videos WHERE id = ?").run(id).changes > 0;
  });
  return remove.immediate();
}

// ─── Posting ledger ──────────────────────────────────────────────────────────

/**
 * Record that a candidate went out. This row is the whole reason the feature
 * can work: it is the only link between a file on disk and the post it became,
 * and selection reads it for both ranking (metrics live under the external id)
 * and eligibility (a candidate already posted to a platform is out of that
 * platform's pool).
 *
 * Idempotent on its primary key, so a retried attach cannot double-record.
 */
export function recordPost(
  videoId: string,
  platform: SchedulePlatform,
  externalId: string,
  jobId?: string
): boolean {
  const db = getDb();
  const write = db.transaction(() => {
    // The candidate can be removed from the pool between a worker picking it
    // and the post going live. Recording against it then would leave a row
    // nothing can reach, so report the miss and let the caller re-enrol.
    const exists = db.prepare("SELECT 1 FROM slug_videos WHERE id = ?").get(videoId);
    if (!exists) return false;

    db.prepare(
      `INSERT INTO slug_video_posts (video_id, platform, external_id, job_id)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(video_id, platform, external_id) DO NOTHING`
    ).run(videoId, platform, externalId, jobId ?? null);
    return true;
  });
  return write.immediate();
}

/**
 * Undo a link. The post stays published — this only says the pool candidate is
 * not the file behind it, which also puts the candidate back in that platform's
 * pool.
 */
export function forgetPost(
  videoId: string,
  platform: SchedulePlatform,
  externalId: string
): boolean {
  return (
    getDb()
      .prepare(
        "DELETE FROM slug_video_posts WHERE video_id = ? AND platform = ? AND external_id = ?"
      )
      .run(videoId, platform, externalId).changes > 0
  );
}

/** Whether any candidate already claims this post. One post, one source file. */
export function postIsLinked(externalId: string, platform: SchedulePlatform): boolean {
  return !!getDb()
    .prepare("SELECT 1 FROM slug_video_posts WHERE external_id = ? AND platform = ? LIMIT 1")
    .get(externalId, platform);
}

// ─── Eligibility ─────────────────────────────────────────────────────────────

/** Has this candidate already gone out on this platform? */
export function postedTo(video: SlugVideo, platform: SchedulePlatform): boolean {
  return video.posts.some((post) => post.platform === platform);
}

/**
 * The candidates that could go out on this platform right now: not already
 * posted there, file still on disk, and not spoken for by a job mid-publish.
 *
 * One definition, shared by the pool page, the calendar badge and the count in
 * the composer's slug picker. A card that says "3 left" over a slot that then
 * finds nothing is worse than no count at all, so they all ask the same
 * question the selector does.
 */
export function eligibleVideos(
  slug: string,
  platform: SchedulePlatform,
  pool?: SlugVideo[]
): SlugVideo[] {
  const videos = pool ?? listVideos(slug);
  if (!videos.length) return [];

  const reserved = reservedSlugVideoIds(slug, platform);
  return videos.filter(
    (video) => !postedTo(video, platform) && !isMissing(video) && !reserved.has(video.id)
  );
}

// ─── Display helpers ─────────────────────────────────────────────────────────

export function filenameOf(video: SlugVideo): string {
  return path.basename(video.path);
}

export function isMissing(video: SlugVideo): boolean {
  return !fs.existsSync(video.path);
}
