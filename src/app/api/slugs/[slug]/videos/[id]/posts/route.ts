import { NextRequest, NextResponse } from "next/server";
import { requireScheduleAuth } from "@/lib/schedule/auth";
import { forgetPost, getVideo, normalizeSlug, postIsLinked, recordPost } from "@/lib/slugs/store";

export const dynamic = "force-dynamic";

/**
 * POST /api/slugs/:slug/videos/:id/posts — say that this local file is the one
 * behind an already-published post.
 *
 *   { "platform": "ig", "external_id": "18617009902035719" }
 *
 * This is how an established account gets its history into the pool. Without
 * it, a clip that did 24k on Instagram joins as unscored and ranks below
 * nothing, because the app has no way to know the file and the post are the
 * same video. Linking is also what takes the candidate out of that platform's
 * pool — it has already run there.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { slug: string; id: string } }
) {
  const denied = requireScheduleAuth(request);
  if (denied) return denied;

  const video = getVideo(params.id);
  if (!video || video.slug !== normalizeSlug(params.slug)) {
    return NextResponse.json({ error: "not_found", message: "No such video." }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const platform = body?.platform === "yt" ? "yt" : "ig";
  const externalId = typeof body?.external_id === "string" ? body.external_id.trim() : "";
  if (!externalId) {
    return NextResponse.json(
      { error: "invalid_param", message: "external_id is required." },
      { status: 400 }
    );
  }

  // One post has one source file. Allowing two candidates to claim it would
  // double-count its views and retire the wrong clip from the pool.
  if (postIsLinked(externalId, platform)) {
    return NextResponse.json(
      { error: "conflict", message: "Another video in this pool is already linked to that post." },
      { status: 409 }
    );
  }

  recordPost(video.id, platform, externalId);
  return NextResponse.json({ video: getVideo(video.id) }, { status: 201 });
}

/** DELETE …/posts?platform=ig&external_id=… — undo a link. */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { slug: string; id: string } }
) {
  const denied = requireScheduleAuth(request);
  if (denied) return denied;

  const video = getVideo(params.id);
  if (!video || video.slug !== normalizeSlug(params.slug)) {
    return NextResponse.json({ error: "not_found", message: "No such video." }, { status: 404 });
  }

  const query = request.nextUrl.searchParams;
  const platform = query.get("platform") === "yt" ? "yt" : "ig";
  const externalId = query.get("external_id") ?? "";
  if (!forgetPost(video.id, platform, externalId)) {
    return NextResponse.json({ error: "not_found", message: "No such link." }, { status: 404 });
  }
  return NextResponse.json({ video: getVideo(video.id) });
}
