import { NextRequest, NextResponse } from "next/server";
import { getRecentVideos } from "@/lib/youtube/endpoints/videos";
import { YoutubeError, YoutubeQuotaError } from "@/lib/youtube/types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const limitParam = request.nextUrl.searchParams.get("limit");
  const limit = limitParam ? Number(limitParam) : undefined;

  try {
    const videos = await getRecentVideos(Number.isFinite(limit) ? limit : undefined);
    return NextResponse.json({ data: videos });
  } catch (err) {
    if (err instanceof YoutubeQuotaError) {
      return NextResponse.json(
        { error: "quota", message: err.message },
        { status: 429 }
      );
    }
    if (err instanceof YoutubeError) {
      return NextResponse.json(
        { error: "youtube_api", message: err.message, code: err.code },
        { status: 400 }
      );
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: "internal", message }, { status: 500 });
  }
}
