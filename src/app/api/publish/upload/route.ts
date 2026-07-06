import { NextRequest, NextResponse } from "next/server";
import {
  publishLocalMedia,
  ContainerFailedError,
  type PublishInput,
} from "@/lib/instagram/endpoints/publish";
import { InstagramError, RateLimitError } from "@/lib/instagram/types";

export const dynamic = "force-dynamic";
// Video processing can run long; don't let the platform cut the request short.
export const maxDuration = 300;

/**
 * POST /api/publish/upload — publish a LOCAL file (Reels or video Stories) via
 * the resumable upload flow. Images aren't supported here (they need image_url;
 * use POST /api/publish).
 *
 * Content-Type: multipart/form-data
 *   file     — the video binary
 *   payload  — JSON of the container params (PublishInput, minus video_url)
 */
export async function POST(request: NextRequest) {
  const form = await request.formData().catch(() => null);
  if (!form) {
    return NextResponse.json(
      { error: "bad_request", message: "Expected multipart/form-data" },
      { status: 400 }
    );
  }

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json(
      { error: "missing_param", message: "A non-empty file field is required" },
      { status: 400 }
    );
  }

  let input: PublishInput & { finalize?: boolean; timeoutMs?: number; intervalMs?: number };
  try {
    const raw = form.get("payload");
    input = raw ? JSON.parse(String(raw)) : {};
  } catch {
    return NextResponse.json(
      { error: "bad_request", message: "payload must be valid JSON" },
      { status: 400 }
    );
  }

  const type = input.media_type ?? "REELS";
  if (type !== "REELS" && type !== "STORIES") {
    return NextResponse.json(
      {
        error: "invalid_param",
        message: "Local file upload supports REELS or STORIES only. Images need image_url via /api/publish.",
      },
      { status: 400 }
    );
  }
  if (input.caption && input.caption.length > 2200) {
    return NextResponse.json(
      { error: "invalid_param", message: "caption exceeds 2200 characters" },
      { status: 400 }
    );
  }

  const { finalize, timeoutMs, intervalMs, ...container } = input;
  // video_url is meaningless with a resumable upload — the bytes come from `file`.
  delete container.video_url;
  // Carousels don't use this route; drop any children so nothing leaks through.
  delete container.children;

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await publishLocalMedia(
      container,
      { data: bytes, size: bytes.byteLength },
      { finalize, timeoutMs, intervalMs }
    );
    const status = result.published ? 200 : result.status_code === "FINISHED" ? 200 : 202;
    return NextResponse.json(result, { status });
  } catch (err) {
    if (err instanceof RateLimitError) {
      return NextResponse.json({ error: "rate_limit", message: err.message }, { status: 429 });
    }
    if (err instanceof ContainerFailedError) {
      return NextResponse.json(
        { error: "processing_failed", message: err.message, container_id: err.containerId },
        { status: 422 }
      );
    }
    if (err instanceof InstagramError) {
      return NextResponse.json(
        { error: "instagram_api", message: err.message, code: err.code },
        { status: 400 }
      );
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: "internal", message }, { status: 500 });
  }
}
