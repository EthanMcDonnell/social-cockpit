import { NextRequest, NextResponse } from "next/server";
import { ensureMediaFresh } from "@/lib/cache/sync";
import { getRankedPosts, isRankMetric, type RankMetric } from "@/lib/cache/store";
import { getTranscriptSummaries } from "@/lib/transcription/service";
import { toPostListItem } from "@/lib/posts";
import { InstagramError, RateLimitError } from "@/lib/instagram/types";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;
const DEFAULT_METRIC: RankMetric = "engagement";

// GET /api/scripts/top?metric=engagement&limit=10&mediaType=VIDEO,REEL
//
// Top-performing "scripts" — posts that have a stored transcript — ranked by a
// cached performance metric. Only transcribed posts are returned, so this is
// empty until the transcript backlog has run.
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  const metricParam = (searchParams.get("metric") ?? DEFAULT_METRIC).toLowerCase();
  if (!isRankMetric(metricParam)) {
    return NextResponse.json(
      {
        error: "invalid_metric",
        message: `Unknown metric "${metricParam}". Valid: likes, comments, reach, views, saved, shares, total_interactions, avg_watch_time, engagement.`,
      },
      { status: 400 }
    );
  }
  const metric = metricParam;

  const rawLimit = parseInt(searchParams.get("limit") ?? "", 10);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(rawLimit, 1), MAX_LIMIT)
    : DEFAULT_LIMIT;

  const mediaTypeParam = searchParams.get("mediaType");
  const mediaTypes = mediaTypeParam
    ? new Set(mediaTypeParam.split(",").map((s) => s.trim().toUpperCase()))
    : undefined;

  try {
    await ensureMediaFresh();

    // Rank all candidates, then keep only those with a transcript and slice to N.
    const ranked = getRankedPosts({ metric, mediaTypes });
    const summaries = getTranscriptSummaries(ranked.map((r) => r.media.id));

    const data = ranked
      .filter((r) => summaries.has(r.media.id))
      .slice(0, limit)
      .map((r) => ({
        ...toPostListItem(r.media, summaries.get(r.media.id), r.insights),
        metricValue: r.metricValue,
      }));

    return NextResponse.json({ metric, limit, data });
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
