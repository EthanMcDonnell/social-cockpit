import { NextRequest, NextResponse } from "next/server";
import { requireScheduleAuth } from "@/lib/schedule/auth";
import {
  clearPool,
  deleteSlug,
  eligibleVideos,
  getSlug,
  linkedAutomation,
  normalizeSlug,
  updateSlug,
} from "@/lib/slugs/store";
import { selectVideo, viewPool } from "@/lib/slugs/select";
import { slugPostHistory } from "@/lib/slugs/history";
import { viewRepostPool } from "@/lib/repost/candidates";
import { resolveSelectionMethod } from "@/lib/slugs/settings";
import {
  isSelectionFailure,
  isSelectionMethod,
  SELECTION_METHODS,
  isSlugMode,
  type SchedulePlatformParam,
} from "@/lib/slugs/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/slugs/:slug?platform=ig — one pool, scored.
 *
 * `next_up` runs the real selector rather than a description of it, so the
 * preview and the 9:30 decision can never disagree about what would go out.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  const denied = requireScheduleAuth(request);
  if (denied) return denied;

  const slug = normalizeSlug(params.slug);
  const record = getSlug(slug);
  if (!record) {
    return NextResponse.json({ error: "not_found", message: `No slug "${slug}".` }, { status: 404 });
  }

  const raw = request.nextUrl.searchParams.get("platform");
  const platform: SchedulePlatformParam = raw === "yt" ? "yt" : "ig";
  const videos = await viewPool(slug);
  const method = resolveSelectionMethod(slug);
  const selection = await selectVideo({ slug, platform, method });

  /**
   * A repost pool holds no `slug_videos` rows — it draws from the archive — so
   * counting them would report "0 videos, 0 eligible" directly above a `next_up`
   * naming the video it is about to post. Its counts come from the archive
   * instead, and the candidates ride along under `repost` so a client can show
   * the tiers and the retired ones rather than an empty table.
   *
   * `yt` is genuinely 0: reposts publish as trial reels, which YouTube has no
   * equivalent of, and booking one for `yt` is refused.
   */
  const repost = record.mode === "repost" ? await viewRepostPool(slug, platform) : null;

  return NextResponse.json({
    slug: {
      ...record,
      video_count: repost ? repost.candidates.length : videos.length,
      eligible: repost
        ? { ig: repost.tier1 + repost.tier2, yt: 0 }
        : {
            ig: eligibleVideos(slug, "ig", videos).length,
            yt: eligibleVideos(slug, "yt", videos).length,
          },
      automation: linkedAutomation(slug),
      videos,
    },
    repost,
    // What has already gone out under this slug, so a candidate can be pointed
    // at the post it produced and inherit its numbers.
    history: slugPostHistory(slug),
    effective_method: method,
    next_up: isSelectionFailure(selection) ? null : selection,
    blocked: isSelectionFailure(selection) ? selection : null,
  });
}

/** PATCH /api/slugs/:slug — rename, or set/clear the selection override. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  const denied = requireScheduleAuth(request);
  if (denied) return denied;

  const slug = normalizeSlug(params.slug);
  const body = await request.json().catch(() => ({}));

  if (
    body?.selection_method !== undefined &&
    body.selection_method !== null &&
    !isSelectionMethod(body.selection_method)
  ) {
    return NextResponse.json(
      {
        error: "invalid_param",
        message: `selection_method must be null or one of: ${SELECTION_METHODS.join(", ")}.`,
      },
      { status: 400 }
    );
  }

  // The repost opt-in. Explicitly a boolean rather than coerced: `false` and
  // `"false"` must not both mean "off" in one direction while `0` quietly means
  // "on" in another, on a flag whose whole job is to be unambiguous.
  if (body?.repost_eligible !== undefined && typeof body.repost_eligible !== "boolean") {
    return NextResponse.json(
      { error: "invalid_param", message: "repost_eligible must be a boolean." },
      { status: 400 }
    );
  }
  if (body?.mode !== undefined && !isSlugMode(body.mode)) {
    return NextResponse.json(
      { error: "invalid_param", message: 'mode must be "pool" or "repost".' },
      { status: 400 }
    );
  }

  const updated = updateSlug(slug, {
    ...(body?.name !== undefined ? { name: body.name } : {}),
    ...(body?.selection_method !== undefined ? { selection_method: body.selection_method } : {}),
    ...(body?.repost_eligible !== undefined ? { repost_eligible: body.repost_eligible } : {}),
    ...(body?.mode !== undefined ? { mode: body.mode } : {}),
  });
  if (!updated) {
    return NextResponse.json({ error: "not_found", message: `No slug "${slug}".` }, { status: 404 });
  }
  return NextResponse.json({ slug: updated });
}

/**
 * DELETE /api/slugs/:slug — drop the slug and its pool.
 *
 * Refused while an automation flow still fires on it: the slug is that flow's
 * identity, and tearing down a live comment funnel is not something a pool page
 * should do quietly. `?pool=1` empties the pool and keeps the slug, which is the
 * part this page actually owns.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  const denied = requireScheduleAuth(request);
  if (denied) return denied;

  const slug = normalizeSlug(params.slug);
  if (!getSlug(slug)) {
    return NextResponse.json({ error: "not_found", message: `No slug "${slug}".` }, { status: 404 });
  }

  if (request.nextUrl.searchParams.get("pool") === "1") {
    return NextResponse.json({ slug, cleared: clearPool(slug) });
  }

  const outcome = deleteSlug(slug);
  if (!outcome.deleted) {
    return NextResponse.json(
      {
        error: "conflict",
        message: `"${slug}" is the automation flow "${outcome.blockedBy}" — delete that flow first, or clear the pool instead.`,
      },
      { status: 409 }
    );
  }
  return NextResponse.json({ deleted: slug });
}
