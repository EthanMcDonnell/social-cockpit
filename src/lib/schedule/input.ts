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
  SchedulePayload,
  SchedulePlatform,
  YoutubeJobPayload,
} from "./types";
import { ensureSlug, getSlug, normalizeSlug } from "@/lib/slugs/store";
import { isSelectionMethod, SELECTION_METHODS, type SelectionMethod } from "@/lib/slugs/types";

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
    /**
     * Book the slot against a slug's content pool instead of a file. The video
     * is chosen when the slot arrives — see docs/slug-scheduling.md.
     */
    slug?: string;
    selection_method?: string;
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

/**
 * Validate an automation spec at booking time so a bad one is a 400 on this
 * call. The resolved plan is deliberately DISCARDED: create-vs-append must be
 * decided at fire time, because another post may claim this key between now and
 * then. We store the raw spec and re-plan in the worker.
 */
function checkAutomation(
  automation: AutomationSpec | undefined
): { automation?: AutomationSpec } | ParseFailure {
  if (!automation) return {};

  const planned = planAutomation(getDb(), automation);
  if ("error" in planned) return fail("invalid_param", planned.error);

  // Preserve the scheduling-time contract for a key-only/append request. If its
  // owner is later deleted, publishing must not silently create a new flow from
  // fields that were ignored on the original append.
  if (planned.plan.mode === "append") {
    return { automation: { ...automation, existing_key_required: true } };
  }
  return { automation };
}

/**
 * One slug, two facets: an automation block that names no key of its own
 * inherits the slug, so the pool a video belongs to and the flow it fires stay
 * the same string rather than drifting into two things to keep straight.
 */
function withSlugKey(
  automation: AutomationSpec | undefined,
  slug: string
): AutomationSpec | undefined {
  if (!automation || !slug || automation.key?.trim()) return automation;
  return { ...automation, key: slug };
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
  if (scheduledAt <= Date.now()) {
    return fail("invalid_param", "scheduled_at must be in the future; use the run-now endpoint to publish immediately.");
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
    "slug",
    "selection_method",
    "video_path",
    "image_path",
    "cover_path",
    "children_paths",
  ]);

  // ── slug ──
  if (body.slug !== undefined && typeof body.slug !== "string") {
    return fail("invalid_param", "slug must be a string.");
  }
  if (body.selection_method !== undefined && !isSelectionMethod(body.selection_method)) {
    return fail(
      "invalid_param",
      `selection_method must be one of: ${SELECTION_METHODS.join(", ")}.`
    );
  }
  const selectionMethod: SelectionMethod | undefined = isSelectionMethod(body.selection_method)
    ? body.selection_method
    : undefined;

  const slug = body.slug?.trim() ? normalizeSlug(body.slug) : "";
  if (body.slug?.trim() && !slug) {
    return fail("invalid_param", "A slug needs at least one letter or digit.");
  }

  // A repost publishes as a trial reel, and trial reels are an Instagram
  // feature with no YouTube equivalent. Caught here rather than at fire time:
  // the alternative is a slot that looks fine on the calendar for a fortnight
  // and then fails at 3am with nothing the user can do about it.
  if (slug && platform === "yt" && getSlug(slug)?.mode === "repost") {
    return fail(
      "invalid_param",
      `#${slug} is a repost pool, and reposts publish as Instagram trial reels. Book it for Instagram, or use an ordinary pool for YouTube.`
    );
  }

  /**
   * Create the pool on first mention, mirroring how a new automation_key
   * creates its flow — booking should not need a separate setup call for what
   * is one obvious intent.
   *
   * Called only once a request is known to be good. Doing it up front would
   * leave a phantom pool behind every rejected booking, including one rejected
   * for the typo in its own slug.
   */
  const claimSlug = () => {
    if (slug) ensureSlug(slug);
  };

  const hasSource =
    !!body.media?.length ||
    !!body.video_path ||
    !!body.image_path ||
    !!body.cover_path ||
    !!body.children_paths?.length;

  // A slug with a file means "post this one, and it belongs to the pool" — it
  // is enrolled when it publishes. A slug on its own books the *slot*, and only
  // that case defers the choice of video to fire time: there is no media to
  // resolve, and no payload to validate against a media type nobody has picked.
  if (slug && !hasSource) {
    const checked = checkAutomation(platform === "ig" ? withSlugKey(automation, slug) : undefined);
    if (isFailure(checked)) return checked;

    claimSlug();
    return {
      job: {
        platform,
        scheduledAt,
        // Whatever payload came with the request is kept as an override — the
        // rest is filled from the chosen candidate at fire time.
        payload: (platform === "yt"
          ? (rest as Partial<YoutubeJobPayload>)
          : (rest as PublishInput)) as SchedulePayload,
        media: [],
        automation: checked.automation,
        slug: slug,
        selectionMethod,
        graceMinutes: grace_minutes ?? defaultGraceMinutes(),
        maxAttempts: max_attempts,
      },
    };
  }

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
    claimSlug();
    return {
      job: {
        platform,
        scheduledAt,
        payload,
        media,
        slug: slug || undefined,
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
  const checked = checkAutomation(withSlugKey(automation, slug));
  if (isFailure(checked)) return checked;

  claimSlug();
  return {
    job: {
      platform,
      scheduledAt,
      payload: input,
      media,
      automation: checked.automation,
      // Carried even though this job has its own file: publishing it enrols the
      // video in the pool, which is how a pool fills up in the first place.
      slug: slug || undefined,
      graceMinutes: grace_minutes ?? defaultGraceMinutes(),
      maxAttempts: max_attempts,
    },
  };
}
