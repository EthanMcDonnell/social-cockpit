import { NextRequest, NextResponse } from "next/server";
import { ensureMediaFresh } from "@/lib/cache/sync";
import { getPostsSummary } from "@/lib/cache/store";
import { InstagramError, RateLimitError } from "@/lib/instagram/types";

export const dynamic = "force-dynamic";

// GET /api/posts/summary?mediaType=VIDEO,REEL
//
// Cheap cached aggregates (post count, counts by type, summed engagement) so
// the posts page header stays accurate regardless of how many pages are loaded.
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const mediaTypeParam = searchParams.get("mediaType");
  const mediaTypes = mediaTypeParam
    ? new Set(mediaTypeParam.split(",").map((s) => s.trim().toUpperCase()))
    : undefined;

  try {
    await ensureMediaFresh();
    return NextResponse.json(getPostsSummary(mediaTypes));
  } catch (err) {
    if (err instanceof RateLimitError) {
      return NextResponse.json(
        { error: "rate_limit", message: err.message, usage: err.usage },
        { status: 429 }
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
