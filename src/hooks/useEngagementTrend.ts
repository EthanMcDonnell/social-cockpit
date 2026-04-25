"use client";

import { useUserInsights } from "./useUserInsights";
import { userInsightsToMultiSeries, type MultiSeriesPoint } from "@/lib/data/transforms";

export function useEngagementTrend(periodDays: number): {
  data: MultiSeriesPoint[];
  metric: string;
  label: string;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
} {
  const { data, isLoading, isError, error, refetch } = useUserInsights(periodDays);

  const transformed = data
    ? userInsightsToMultiSeries(data, ["total_interactions", "accounts_engaged"])
    : [];

  // Prefer total_interactions; fall back to accounts_engaged if absent or all-zero
  const hasInteractions = transformed.some(
    (p) => typeof p.total_interactions === "number" && (p.total_interactions as number) > 0
  );
  const metric = hasInteractions ? "total_interactions" : "accounts_engaged";
  const label = hasInteractions ? "Interactions" : "Engaged Accounts";

  return { data: transformed, metric, label, isLoading, isError, error, refetch };
}
