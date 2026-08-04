import { NextRequest, NextResponse } from "next/server";
import { stageUpload, stageUsage, StageCapError } from "@/lib/schedule/media";
import { requireScheduleAuth } from "@/lib/schedule/auth";

export const dynamic = "force-dynamic";
// The body is streamed straight to disk, so it never lands in memory — a 500 MB
// video costs the same RSS as a thumbnail.
export const maxDuration = 300;

/**
 * POST /api/schedule/media?filename=reel.mp4 — stage a browser upload.
 *
 * Raw body, not multipart: the file goes onto local disk and stays there until
 * its scheduled slot arrives. This is the browser's equivalent of passing a
 * `video_path` from the CLI, and exists precisely so the calendar never has to
 * park media in R2 to hold onto it.
 *
 * Returns `{ id }` — pass it back as `media: [{ role, staged_id }]` on
 * POST /api/schedule.
 */
export async function POST(request: NextRequest) {
  const denied = requireScheduleAuth(request);
  if (denied) return denied;

  if (!request.body) {
    return NextResponse.json(
      { error: "bad_request", message: "Expected a file body." },
      { status: 400 }
    );
  }

  const filename = request.nextUrl.searchParams.get("filename") ?? undefined;
  const contentType = request.headers.get("content-type") ?? undefined;
  const declared = Number(request.headers.get("content-length"));

  try {
    const staged = await stageUpload(request.body, {
      filename,
      contentType,
      declaredSize: Number.isFinite(declared) && declared > 0 ? declared : undefined,
    });
    return NextResponse.json(
      {
        id: staged.id,
        size_bytes: staged.size_bytes,
        content_type: staged.content_type,
        usage: stageUsage(),
      },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof StageCapError) {
      return NextResponse.json({ error: "storage_cap", message: err.message }, { status: 429 });
    }
    const message = err instanceof Error ? err.message : "Upload failed";
    return NextResponse.json({ error: "internal", message }, { status: 500 });
  }
}

/** GET /api/schedule/media — staging disk usage, for the calendar's meter. */
export async function GET(request: NextRequest) {
  const denied = requireScheduleAuth(request);
  if (denied) return denied;
  return NextResponse.json(stageUsage());
}
