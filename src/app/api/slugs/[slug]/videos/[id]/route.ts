import { NextRequest, NextResponse } from "next/server";
import { requireScheduleAuth } from "@/lib/schedule/auth";
import { getVideo, normalizeSlug, removeVideo, updateVideo } from "@/lib/slugs/store";
import { toView } from "@/lib/slugs/select";
import type { SlugVideoPayload } from "@/lib/slugs/types";

export const dynamic = "force-dynamic";

/** PATCH /api/slugs/:slug/videos/:id — rename, or change its payload defaults. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { slug: string; id: string } }
) {
  const denied = requireScheduleAuth(request);
  if (denied) return denied;
  if (!owns(params)) return notFound();

  const body = await request.json().catch(() => ({}));
  const updated = updateVideo(params.id, {
    ...(body?.label !== undefined ? { label: body.label } : {}),
    ...(body?.payload !== undefined ? { payload: body.payload as SlugVideoPayload } : {}),
  });
  if (!updated) return notFound();
  return NextResponse.json({ video: toView(updated) });
}

/**
 * DELETE /api/slugs/:slug/videos/:id — take a candidate out of the pool.
 *
 * The file itself is never touched. Its posting history goes with it, so
 * re-adding the same path later starts it fresh and eligible again.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { slug: string; id: string } }
) {
  const denied = requireScheduleAuth(request);
  if (denied) return denied;
  if (!owns(params) || !removeVideo(params.id)) return notFound();

  return NextResponse.json({ deleted: params.id });
}

/**
 * The id alone is enough to find a candidate, but not enough to authorise the
 * change: a request must come through the slug that actually holds it, or a
 * stale page could quietly edit another pool's video.
 */
function owns(params: { slug: string; id: string }): boolean {
  return getVideo(params.id)?.slug === normalizeSlug(params.slug);
}

const notFound = () =>
  NextResponse.json({ error: "not_found", message: "No such video." }, { status: 404 });
