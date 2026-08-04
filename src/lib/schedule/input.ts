/**
 * Parse and validate a schedule request body into a job.
 *
 * The contract is deliberate: **anything you can POST to /api/publish/local
 * becomes a scheduled post by adding `scheduled_at`.** Same field names, same
 * semantics, same automation block — the only new idea is *when*.
 *
 * Everything that can be checked now is checked now — the time parses, the files
 * exist, the payload satisfies Instagram's per-media-type rules, the automation
 * spec is well-formed. A scheduler that accepts a broken job and discovers it at
 * 3am is worse than one that rejects it at the terminal.
 *
 * Server-side only.
 */

import { validatePublish, type R2Sources } from "@/lib/instagram/publish-flow";
import type { PublishInput } from "@/lib/instagram/endpoints/publish";
import { planAutomation, type AutomationSpec } from "@/lib/automation/attach";
import { getDb } from "@/lib/db";
import { getStagedMedia, registerLocalPath, PathError } from "./media";
import { getTimeZone } from "./settings";
import { parseScheduledAt } from "./tz";
import type {
  CreateJobInput,
} from "./store";
import { defaultGraceMinutes } from "./store";
import type {
  MediaRole,
  ScheduledMediaRef,
  SchedulePlatform,
  YoutubeJobPayload,
} from "./types";

/** Filesystem-path sources, mirroring POST /api/publish/local. */
export interface ScheduleSources {
  video_path?: string;
  image_path?: string;
  cover_path?: string;
  children_paths?: (string | null)[];
}

/** Media already staged via POST /api/schedule/media (the browser path). */
export interface StagedRefInput {
  role: MediaRole;
  staged_id: string;
  index?: number;
}

export type ScheduleRequestBody = Partial<PublishInput> &
  ScheduleSources &
  Partial<YoutubeJobPayload> & {
    scheduled_at?: string | number;
    platform?: string;
    grace_minutes?: number;
    max_attempts?: number;
    media?: StagedRefInput[];
    automation?: AutomationSpec;
  };

export interface ParseFailure {
  error: string;
  status: number;
  code: string;
}

export type ParseResult = { job: CreateJobInput } | ParseFailure;

export function isFailure<T extends object>(r: T | ParseFailure): r is ParseFailure {
  return "error" in r;
}

const fail = (code: string, error: string, status = 400): ParseFailure => ({
  code,
  error,
  status,
});

/** Shallow copy without the listed keys. */
function omit<T extends object>(source: T, keys: (keyof T | string)[]): Record<string, unknown> {
  const drop = new Set(keys as string[]);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (!drop.has(key)) out[key] = value;
  }
  return out;
}

/**
 * Resolve every source — filesystem paths get registered (validated, measured,
 * never copied), staged ids get verified. Returns the job's media refs.
 */
async function resolveMedia(
  body: ScheduleRequestBody
): Promise<{ media: ScheduledMediaRef[] } | ParseFailure> {
  const media: ScheduledMediaRef[] = [];

  // Already-staged browser uploads.
  for (const ref of body.media ?? []) {
    if (!ref?.staged_id) return fail("invalid_param", "media[] entries need a staged_id");
    if (!getStagedMedia(ref.staged_id)) {
      return fail("invalid_param", `Unknown staged media: ${ref.staged_id}`);
    }
    media.push({ role: ref.role, staged_id: ref.staged_id, index: ref.index });
  }

  // Filesystem paths.
  const paths: [MediaRole, string | undefined][] = [
    ["video", body.video_path],
    ["image", body.image_path],
    ["cover", body.cover_path],
  ];

  try {
    for (const [role, p] of paths) {
      if (!p) continue;
      const staged = await registerLocalPath(p);
      media.push({ role, staged_id: staged.id });
    }

    if (Array.isArray(body.children_paths)) {
      for (let i = 0; i < body.children_paths.length; i++) {
        const p = body.children_paths[i];
        if (!p) continue;
        const staged = await registerLocalPath(p);
        media.push({ role: "child", staged_id: staged.id, index: i });
      }
    }
  } catch (err) {
    if (err instanceof PathError) return fail("invalid_path", err.message);
    throw err;
  }

  return { media };
}

/**
 * A stand-in `r2` map so `validatePublish` sees the same "a source is present"
 * signal it would at publish time. The keys are never used — at fire time the
 * worker builds the real map from the staged files.
 */
function previewSources(media: ScheduledMediaRef[]): R2Sources {
  const r2: R2Sources = {};
  for (const m of media) {
    if (m.role === "video") r2.video_url = m.staged_id;
    if (m.role === "image") r2.image_url = m.staged_id;
    if (m.role === "cover") r2.cover_url = m.staged_id;
    if (m.role === "child") {
      r2.children ??= [];
      r2.children[m.index ?? r2.children.length] = m.staged_id;
    }
  }
  return r2;
}

export async function parseScheduleBody(body: ScheduleRequestBody): Promise<ParseResult> {
  const timeZone = getTimeZone();

  // ── when ──
  if (body.scheduled_at == null) {
    return fail("missing_param", "scheduled_at is required");
  }
  const scheduledAt = parseScheduledAt(body.scheduled_at, timeZone);
  if (scheduledAt == null) {
    return fail(
      "invalid_param",
      `Could not read scheduled_at (${String(body.scheduled_at)}). Use ISO-8601, e.g. "2026-08-12T09:30" or "2026-08-12T09:30:00-05:00".`
    );
  }

  const platform: SchedulePlatform = body.platform === "yt" ? "yt" : "ig";

  const { grace_minutes, max_attempts, automation } = body;

  // Everything that isn't a scheduling directive or a media source is the
  // platform payload, passed through untouched — that's what keeps this endpoint
  // a drop-in for /api/publish/local.
  const rest = omit(body, [
    "scheduled_at",
    "platform",
    "grace_minutes",
    "max_attempts",
    "media",
    "automation",
    "video_path",
    "image_path",
    "cover_path",
    "children_paths",
  ]);

  // ── media ──
  const resolved = await resolveMedia(body);
  if (isFailure(resolved)) return resolved;
  const { media } = resolved;

  // ── payload ──
  if (platform === "yt") {
    const yt = rest as Partial<YoutubeJobPayload>;
    if (!yt.title?.trim()) return fail("missing_param", "title is required for a YouTube post");
    if (!media.some((m) => m.role === "video")) {
      return fail("missing_param", "a YouTube post needs a video (video_path or staged media)");
    }
    const payload: YoutubeJobPayload = {
      title: yt.title.trim(),
      description: yt.description,
      isShort: yt.isShort !== false,
      tags: yt.tags,
      publish_at: yt.publish_at,
    };
    return {
      job: {
        platform,
        scheduledAt,
        payload,
        media,
        graceMinutes: grace_minutes ?? defaultGraceMinutes(),
        maxAttempts: max_attempts,
      },
    };
  }

  const input = rest as PublishInput;
  // A lone video source almost always means a reel; save the caller the field.
  if (!input.media_type && media.some((m) => m.role === "video")) {
    input.media_type = "REELS";
  }

  const problem = validatePublish({ ...input, r2: previewSources(media) });
  if (problem) return fail("invalid_param", problem);

  // ── automation ──
  // Validated now so a bad spec is a 400 on this call. The resolved plan is
  // deliberately DISCARDED: create-vs-append must be decided at fire time,
  // because another post may claim this key between now and then. We store the
  // raw spec and re-plan in the worker.
  if (automation) {
    const planned = planAutomation(getDb(), automation);
    if ("error" in planned) return fail("invalid_param", planned.error);
  }

  return {
    job: {
      platform,
      scheduledAt,
      payload: input,
      media,
      automation,
      graceMinutes: grace_minutes ?? defaultGraceMinutes(),
      maxAttempts: max_attempts,
    },
  };
}
