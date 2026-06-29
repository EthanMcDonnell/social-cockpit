import { NextRequest, NextResponse } from "next/server";
import { getMedia } from "@/lib/instagram/endpoints/media";
import { getCachedMedia } from "@/lib/cache/store";
import { InstagramError, RateLimitError } from "@/lib/instagram/types";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params;

  try {
    // Serve from cache when present; fall back to a live fetch on a miss.
    const cached = getCachedMedia(id);
    const media = cached ?? (await getMedia(id));
    return NextResponse.json(media);
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
