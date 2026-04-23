"use client";

import { useUserInsights } from "./useUserInsights";
import { userInsightsToMultiSeries, type MultiSeriesPoint } from "@/lib/data/transforms";

const ENGAGEMENT_METRICS = ["total_interactions", "reach", "accounts_engaged"];

export function useEngagementTrend(periodDays: number): {
  data: MultiSeriesPoint[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
} {
  const { data, isLoading, isError, error, refetch } = useUserInsights(periodDays);

  const transformed = data
    ? userInsightsToMultiSeries(data, ENGAGEMENT_METRICS)
    : [];

  return { data: transformed, isLoading, isError, error, refetch };
}
