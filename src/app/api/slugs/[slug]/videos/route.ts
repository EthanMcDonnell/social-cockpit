import { NextRequest, NextResponse } from "next/server";
import { requireScheduleAuth } from "@/lib/schedule/auth";
import { enrolVideo, getSlug, normalizeSlug } from "@/lib/slugs/store";
import { toView } from "@/lib/slugs/select";
import { PathError } from "@/lib/publish/local-source";
import type { SlugVideoPayload } from "@/lib/slugs/types";

export const dynamic = "force-dynamic";

/**
 * POST /api/slugs/:slug/videos — add a candidate to the pool.
 *
 *   { "path": "/Users/me/clips/gym-3.mp4",
 *     "label": "Gym tips 3",
 *     "payload": { "ig": { "caption": "Comment GYM 👇" } } }
 *
 * Nothing is copied and nothing is uploaded: the pool holds a reference to your
 * own file, exactly as a scheduled post does. `payload` is the per-platform
 * default a slug job uses when it picks this candidate and the job itself
 * carried no caption or title.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  const denied = requireScheduleAuth(request);
  if (denied) return denied;

  const slug = normalizeSlug(params.slug);
  const body = await request.json().catch(() => ({}));

  if (typeof body?.path !== "string" || !body.path.trim()) {
    return NextResponse.json(
      { error: "invalid_param", message: "path is required — an absolute path on this machine." },
      { status: 400 }
    );
  }
  if (
    body.payload !== undefined &&
    (typeof body.payload !== "object" || body.payload === null || Array.isArray(body.payload))
  ) {
    return NextResponse.json(
      { error: "invalid_param", message: "payload must be an object." },
      { status: 400 }
    );
  }

  try {
    const video = await enrolVideo({
      slug,
      path: body.path,
      label: typeof body.label === "string" ? body.label : undefined,
      payload: body.payload as SlugVideoPayload | undefined,
    });
    return NextResponse.json({ video: toView(video), slug: getSlug(slug) }, { status: 201 });
  } catch (err) {
    if (err instanceof PathError) {
      return NextResponse.json({ error: "invalid_path", message: err.message }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : "Could not add that video.";
    return NextResponse.json({ error: "internal", message }, { status: 500 });
  }
}
