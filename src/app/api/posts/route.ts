import { NextRequest, NextResponse } from "next/server";
import { ensureMediaFresh, refreshMedia } from "@/lib/cache/sync";
import {
  getAllCachedMedia,
  getCachedMediaPage,
  getCachedInsightsMany,
} from "@/lib/cache/store";
import { getTranscriptSummaries } from "@/lib/transcription/service";
import { toPostListItem } from "@/lib/posts";
import { InstagramError, RateLimitError } from "@/lib/instagram/types";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

// GET /api/posts?limit=25&after=<cursor>&mediaType=VIDEO,REEL
//
// Cursor-paginated posts from the local cache, each enriched with cached
// insights and a lightweight transcript summary (preview only — fetch
// GET /api/posts/:id or GET /api/transcripts/:id for full text).
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  const after = searchParams.get("after") ?? undefined;
  const all = searchParams.get("all") === "true";
  // Force an immediate re-fetch of the media list from Meta, bypassing the
  // stale-while-revalidate TTL — used by the "Refresh" button so new posts
  // show up without waiting for the cache to expire.
  const refresh = searchParams.get("refresh") === "true";

  const rawLimit = parseInt(searchParams.get("limit") ?? "", 10);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(rawLimit, 1), MAX_LIMIT)
    : DEFAULT_LIMIT;

  const mediaTypeParam = searchParams.get("mediaType");
  const mediaTypes = mediaTypeParam
    ? new Set(mediaTypeParam.split(",").map((s) => s.trim().toUpperCase()))
    : undefined;

  try {
    if (refresh) {
      await refreshMedia();
    } else {
      await ensureMediaFresh();
    }

    // `all=true` returns the full catalog (insights embedded) in one cheap local
    // query — used by the posts page, which ranks across every post.
    let items;
    let nextCursor: string | null;
    if (all) {
      items = getAllCachedMedia();
      if (mediaTypes) items = items.filter((m) => mediaTypes.has(m.media_type));
      nextCursor = null;
    } else {
      const page = getCachedMediaPage({ limit, after, mediaTypes });
      items = page.items;
      nextCursor = page.nextCursor;
    }
    const ids = items.map((m) => m.id);

    // Two batched local lookups — one per cache DB — joined in memory.
    const insights = getCachedInsightsMany(ids);
    const summaries = getTranscriptSummaries(ids);

    const data = items.map((m) =>
      toPostListItem(m, summaries.get(m.id), insights.get(m.id) ?? null)
    );

    const next = nextCursor
      ? `/api/posts?limit=${limit}` +
        (mediaTypeParam ? `&mediaType=${encodeURIComponent(mediaTypeParam)}` : "") +
        `&after=${encodeURIComponent(nextCursor)}`
      : null;

    return NextResponse.json({
      data,
      paging: { limit, nextCursor, next },
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
