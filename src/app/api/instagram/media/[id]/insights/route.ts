import { NextRequest, NextResponse } from "next/server";
import { getMediaInsights, getMediaInsightsFlat } from "@/lib/instagram/endpoints/insights";
import { ensureMediaFresh, ensureInsightsFresh } from "@/lib/cache/sync";
import { getCachedMedia, getCachedInsights } from "@/lib/cache/store";
import { InstagramError, RateLimitError, type MediaInsightMetric } from "@/lib/instagram/types";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params;
  const { searchParams } = request.nextUrl;
  const flat = searchParams.get("flat") === "true";
  const metricsParam = searchParams.get("metrics");
  const metrics = metricsParam
    ? (metricsParam.split(",") as MediaInsightMetric[])
    : undefined;

  try {
    // Cache fast-path: the common flat request with the default metric set is
    // served from the local cache (read-through). Raw or custom-metric requests
    // fall through to a live fetch.
    if (flat && !metricsParam) {
      await ensureMediaFresh();
      const media = getCachedMedia(id);
      if (media) {
        await ensureInsightsFresh(media);
        const cached = getCachedInsights(id);
        if (cached) return NextResponse.json(cached);
      }
    }

    if (flat) {
      const insights = await getMediaInsightsFlat(id, metrics);
      return NextResponse.json(insights);
    } else {
      const insights = await getMediaInsights(id, metrics);
      return NextResponse.json(insights);
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
