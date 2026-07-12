import { NextResponse } from "next/server";
import { getChannelStats } from "@/lib/youtube/endpoints/channel";
import { YoutubeError, YoutubeQuotaError } from "@/lib/youtube/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const stats = await getChannelStats();
    return NextResponse.json(stats);
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
