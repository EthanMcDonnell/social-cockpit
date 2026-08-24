import { NextRequest, NextResponse } from "next/server";
import { requireScheduleAuth } from "@/lib/schedule/auth";
import {
  deleteSlug,
  eligibleVideos,
  getSlug,
  linkedAutomation,
  normalizeSlug,
  updateSlug,
} from "@/lib/slugs/store";
import { selectVideo, viewPool } from "@/lib/slugs/select";
import { resolveSelectionMethod } from "@/lib/slugs/settings";
import {
  isSelectionFailure,
  isSelectionMethod,
  SELECTION_METHODS,
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

  return NextResponse.json({
    slug: {
      ...record,
      video_count: videos.length,
      eligible: {
        ig: eligibleVideos(slug, "ig", videos).length,
        yt: eligibleVideos(slug, "yt", videos).length,
      },
      automation: linkedAutomation(slug),
      videos,
    },
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

  const updated = updateSlug(slug, {
    ...(body?.name !== undefined ? { name: body.name } : {}),
    ...(body?.selection_method !== undefined ? { selection_method: body.selection_method } : {}),
  });
  if (!updated) {
    return NextResponse.json({ error: "not_found", message: `No slug "${slug}".` }, { status: 404 });
  }
  return NextResponse.json({ slug: updated });
}

/**
 * DELETE /api/slugs/:slug — drop the pool and its posting history.
 *
 * The automation flow sharing this name is deliberately left running: deleting
 * a pool must not silently tear down a live comment funnel.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  const denied = requireScheduleAuth(request);
  if (denied) return denied;

  const slug = normalizeSlug(params.slug);
  if (!deleteSlug(slug)) {
    return NextResponse.json({ error: "not_found", message: `No slug "${slug}".` }, { status: 404 });
  }
  return NextResponse.json({ deleted: slug });
}
