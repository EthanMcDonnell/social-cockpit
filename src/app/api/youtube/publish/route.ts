import { NextRequest, NextResponse } from "next/server";
import { uploadVideoFromR2, YoutubeUploadError } from "@/lib/youtube/upload";
import { reclaimKeys } from "@/lib/storage/reclaim";
import type { YoutubePublishRequest } from "@/lib/youtube/publish-types";

export const dynamic = "force-dynamic";

/**
 * POST /api/youtube/publish — upload an already-R2-hosted video to YouTube.
 *
 * Body: { key, size, contentType, title, description?, isShort, tags? }. The
 * browser has already reserved cap + PUT the file to R2 via /api/publish/r2-sign
 * (shared with the Instagram path), so this only resolves the key to a signed GET
 * and streams it into videos.insert. The R2 source is reclaimed once YouTube has
 * ingested it (or on failure). Pre-audit the video lands as a private draft.
 */
export async function POST(request: NextRequest) {
  let body: YoutubePublishRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "bad_request", message: "Body must be valid JSON" },
      { status: 400 }
    );
  }

  const { key, size, contentType, title } = body;
  if (!key || typeof key !== "string") {
    return NextResponse.json({ error: "missing_param", message: "key is required" }, { status: 400 });
  }
  if (!Number.isFinite(size) || !size || size <= 0) {
    return NextResponse.json(
      { error: "missing_param", message: "size (bytes, > 0) is required" },
      { status: 400 }
    );
  }
  if (!contentType || typeof contentType !== "string") {
    return NextResponse.json(
      { error: "missing_param", message: "contentType is required" },
      { status: 400 }
    );
  }
  if (!title?.trim()) {
    return NextResponse.json({ error: "missing_param", message: "title is required" }, { status: 400 });
  }

  try {
    const result = await uploadVideoFromR2(body);
    // YouTube has fully ingested the bytes by the time the PUT returns, so the R2
    // source is safe to drop now (mirrors the Instagram reclaim-on-FINISHED rule).
    await reclaimKeys([key]);
    return NextResponse.json(result);
  } catch (err) {
    // The insert failed, so YouTube won't be fetching the source — reclaim it now.
    await reclaimKeys([key]);
    if (err instanceof YoutubeUploadError) {
      return NextResponse.json(
        { error: "youtube_upload", message: err.message },
        { status: err.status >= 400 && err.status < 600 ? err.status : 502 }
      );
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: "internal", message }, { status: 500 });
  }
}
