import { NextRequest, NextResponse } from "next/server";
import { getMedia } from "@/lib/instagram/endpoints/media";
import { getCachedMedia } from "@/lib/cache/store";
import { getTranscript } from "@/lib/transcription/service";
import { toPostDetail } from "@/lib/posts";
import { InstagramError, RateLimitError } from "@/lib/instagram/types";

export const dynamic = "force-dynamic";

// GET /api/posts/:id
//
// A single post with its full transcript (text + segments) embedded under
// `transcript.data`, or null when none is stored.
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params;

  try {
    // Cache-first; fall back to a live fetch on a miss.
    const media = getCachedMedia(id) ?? (await getMedia(id));
    const transcript = getTranscript(id);
    return NextResponse.json(toPostDetail(media, transcript));
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
