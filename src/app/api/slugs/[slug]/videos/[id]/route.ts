import { NextRequest, NextResponse } from "next/server";
import { requireScheduleAuth } from "@/lib/schedule/auth";
import { getVideo, removeVideo, updateVideo } from "@/lib/slugs/store";
import { toView } from "@/lib/slugs/select";
import type { SlugVideoPayload } from "@/lib/slugs/types";

export const dynamic = "force-dynamic";

/** PATCH /api/slugs/:slug/videos/:id — rename, or change its payload defaults. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const denied = requireScheduleAuth(request);
  if (denied) return denied;

  const body = await request.json().catch(() => ({}));
  const updated = updateVideo(params.id, {
    ...(body?.label !== undefined ? { label: body.label } : {}),
    ...(body?.payload !== undefined ? { payload: body.payload as SlugVideoPayload } : {}),
  });
  if (!updated) {
    return NextResponse.json({ error: "not_found", message: "No such video." }, { status: 404 });
  }
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
  { params }: { params: { id: string } }
) {
  const denied = requireScheduleAuth(request);
  if (denied) return denied;

  const video = getVideo(params.id);
  if (!video || !removeVideo(params.id)) {
    return NextResponse.json({ error: "not_found", message: "No such video." }, { status: 404 });
  }
  return NextResponse.json({ deleted: params.id });
}
