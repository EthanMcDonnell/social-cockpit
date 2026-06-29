import { NextRequest, NextResponse } from "next/server";
import { ensureMediaFresh } from "@/lib/cache/sync";
import { getAllCachedMedia, getCachedMediaPage } from "@/lib/cache/store";
import { InstagramError, RateLimitError } from "@/lib/instagram/types";

export const dynamic = "force-dynamic";

// Served from the local Meta cache (read-through: a cold cache is populated
// from Instagram before responding; a stale one is refreshed in the background).
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const limitParam = searchParams.get("limit");
  const all = searchParams.get("all") === "true";
  const limit = limitParam ? parseInt(limitParam, 10) : 25;

  try {
    await ensureMediaFresh();

    if (all) {
      return NextResponse.json({ data: getAllCachedMedia() });
    }

    const page = getCachedMediaPage({ limit });
    return NextResponse.json({
      data: page.items,
      paging: page.nextCursor
        ? { cursors: { before: "", after: page.nextCursor } }
        : undefined,
    });
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
