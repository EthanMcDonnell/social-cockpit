"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useQueries } from "@tanstack/react-query";
import { ChartSkeleton } from "@/components/ui/Skeleton";
import { ErrorState, RateLimitError, isRateLimitError } from "@/components/ui/ErrorState";
import { useMedia } from "@/hooks/useMedia";
import type { MediaInsights } from "@/lib/instagram/types";
import { formatChartDate } from "@/lib/utils/dates";
import { formatCount } from "@/lib/utils/format";
import { Panel } from "./Panel";
import { cockpitTooltip } from "./chartTheme";

async function fetchInsightsFlat(mediaId: string): Promise<MediaInsights> {
  const res = await fetch(`/api/instagram/media/${mediaId}/insights?flat=true`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? "Failed to fetch insights");
  }
  return res.json();
}

export function VideoViewsChart() {
  const mediaQuery = useMedia({ limit: 30 });
  const mediaList = mediaQuery.data?.data ?? [];

  const insightQueries = useQueries({
    queries: mediaList.map((m) => ({
      queryKey: ["instagram", "media", m.id, "insights"],
      queryFn: () => fetchInsightsFlat(m.id),
      staleTime: 15 * 60 * 1000,
      enabled: mediaList.length > 0,
    })),
  });

  const isLoading = mediaQuery.isLoading || insightQueries.some((q) => q.isLoading);
  const isError = mediaQuery.isError || insightQueries.some((q) => q.isError);
  const error = mediaQuery.error ?? insightQueries.find((q) => q.isError)?.error;

  const series = mediaList
    .map((media, i) => ({
      date: formatChartDate(media.timestamp),
      isoDate: media.timestamp,
      views: insightQueries[i]?.data?.views ?? 0,
    }))
    .filter((p) => p.views > 0)
    .sort((a, b) => a.isoDate.localeCompare(b.isoDate));

  const peak = series.reduce((m, p) => Math.max(m, p.views), 0);

  return (
    <Panel tag="02" title="Video Views" rhs={peak > 0 ? `peak ${formatCount(peak)}` : "by post"}>
      {isLoading && <ChartSkeleton height={272} />}
      {isError && isRateLimitError(error) ? (
        <RateLimitError onRetry={() => mediaQuery.refetch()} />
      ) : isError ? (
        <ErrorState message={(error as Error)?.message} onRetry={() => mediaQuery.refetch()} />
      ) : null}
      {!isLoading && !isError && series.length === 0 && (
        <div className="flex-1 flex items-center justify-center min-h-[272px] text-xs text-[var(--mut)] font-mono">
          No video view data available
        </div>
      )}
      {!isLoading && !isError && series.length > 0 && (
        <ResponsiveContainer width="100%" height={272}>
          <BarChart data={series} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="ckViewsFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--amber)" stopOpacity={0.95} />
                <stop offset="100%" stopColor="var(--amber-dim)" stopOpacity={0.85} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="0" stroke="var(--hair)" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fill: "var(--mut)", fontFamily: "var(--mono)" }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
              minTickGap={24}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "var(--mut)", fontFamily: "var(--mono)" }}
              tickLine={false}
              axisLine={false}
              tickFormatter={formatCount}
              width={44}
            />
            <Tooltip
              {...cockpitTooltip}
              formatter={(value: number) => [formatCount(value), "Views"]}
              cursor={{ fill: "var(--amber)", opacity: 0.08 }}
            />
            <Bar dataKey="views" fill="url(#ckViewsFill)" maxBarSize={26} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </Panel>
  );
}
