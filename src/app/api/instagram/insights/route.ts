import { NextRequest, NextResponse } from "next/server";
import { getUserInsights } from "@/lib/instagram/endpoints/insights";
import {
  InstagramError,
  RateLimitError,
  type InsightPeriod,
  type UserInsightMetric,
} from "@/lib/instagram/types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const period = (searchParams.get("period") ?? "day") as InsightPeriod;
  const since = searchParams.get("since") ?? undefined;
  const until = searchParams.get("until") ?? undefined;
  const metricsParam = searchParams.get("metrics");
  const metrics = metricsParam
    ? (metricsParam.split(",") as UserInsightMetric[])
    : undefined;

  try {
    const insights = await getUserInsights(period, metrics, since, until);
    return NextResponse.json(insights);
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
