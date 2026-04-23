import { NextRequest, NextResponse } from "next/server";
import { listMedia, getAllMedia } from "@/lib/instagram/endpoints/media";
import { InstagramError, RateLimitError } from "@/lib/instagram/types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const limitParam = searchParams.get("limit");
  const all = searchParams.get("all") === "true";
  const limit = limitParam ? parseInt(limitParam, 10) : 25;

  try {
    if (all) {
      const media = await getAllMedia();
      return NextResponse.json({ data: media });
    } else {
      const result = await listMedia(limit);
      return NextResponse.json(result);
    }
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
