"use client";

import { useQuery } from "@tanstack/react-query";
import type { InsightsResponse } from "@/lib/instagram/types";
import { getPeriodRange } from "@/lib/utils/dates";

async function fetchUserInsights(
  period: number
): Promise<InsightsResponse> {
  const { since, until } = getPeriodRange(period);
  const params = new URLSearchParams({ period: "day", since, until });
  const res = await fetch(`/api/instagram/insights?${params}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    if (res.status === 429 || body.error === "rate_limit") {
      throw new Error(`rate_limit:${body.message ?? "Instagram API rate limit reached"}`);
    }
    throw new Error(body.message ?? "Failed to fetch user insights");
  }
  return res.json();
}

export function useUserInsights(periodDays: number) {
  return useQuery({
    queryKey: ["instagram", "insights", "user", periodDays],
    queryFn: () => fetchUserInsights(periodDays),
    staleTime: 15 * 60 * 1000,
  });
}
