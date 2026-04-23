import { NextRequest, NextResponse } from "next/server";
import { getUserInsights } from "@/lib/instagram/endpoints/insights";
import { getPeriodRange } from "@/lib/utils/dates";
import { InstagramError, RateLimitError } from "@/lib/instagram/types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const days = parseInt(searchParams.get("days") ?? "30", 10);
  const { since, until } = getPeriodRange(days);

  const metricsParam = searchParams.get("metrics");
  const metrics = metricsParam ? (metricsParam.split(",") as import("@/lib/instagram/types").UserInsightMetric[]) : undefined;

  try {
    const data = await getUserInsights("day", metrics, since, until);
    return NextResponse.json(data, {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    if (err instanceof RateLimitError) {
      return NextResponse.json({ error: "rate_limit", message: err.message }, { status: 429 });
    }
    if (err instanceof InstagramError) {
      return NextResponse.json({ error: "instagram_api", message: err.message, code: err.code }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: "internal", message }, { status: 500 });
  }
}
