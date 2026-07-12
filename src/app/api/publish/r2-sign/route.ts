import { NextRequest, NextResponse } from "next/server";
import { generateKey, presignPut } from "@/lib/storage/r2";
import { reserve, release } from "@/lib/storage/usage";

export const dynamic = "force-dynamic";

interface SignRequest {
  contentType?: string;
  size?: number;
  ext?: string;
}

/**
 * POST /api/publish/r2-sign — reserve storage headroom and issue a presigned PUT
 * for a local file the browser is about to upload directly to R2.
 *
 * Body: { contentType, size, ext }. Returns { key, uploadUrl } (200), or 429 with
 * no URL issued when the upload would exceed R2_CAP_BYTES.
 */
export async function POST(request: NextRequest) {
  let body: SignRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "bad_request", message: "Body must be valid JSON" },
      { status: 400 }
    );
  }

  const { contentType, size, ext } = body;
  if (!contentType || typeof contentType !== "string") {
    return NextResponse.json(
      { error: "missing_param", message: "contentType is required" },
      { status: 400 }
    );
  }
  if (!Number.isFinite(size) || !size || size <= 0) {
    return NextResponse.json(
      { error: "missing_param", message: "size (bytes, > 0) is required" },
      { status: 400 }
    );
  }

  const key = generateKey(ext ?? "");

  if (!reserve(key, size)) {
    return NextResponse.json(
      { error: "storage_cap", message: "R2 storage cap reached — try again shortly." },
      { status: 429 }
    );
  }

  try {
    const uploadUrl = await presignPut(key, contentType, size);
    return NextResponse.json({ key, uploadUrl });
  } catch (err) {
    // No URL reached the client, so no upload will ever happen for this key —
    // don't leave a phantom reservation counted against the cap.
    release(key);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: "internal", message }, { status: 500 });
  }
}
