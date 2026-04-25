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
import { Card } from "@/components/ui/Card";
import { ChartSkeleton } from "@/components/ui/Skeleton";
import { ErrorState, RateLimitError, isRateLimitError } from "@/components/ui/ErrorState";
import { useMedia } from "@/hooks/useMedia";
import type { MediaInsights } from "@/lib/instagram/types";
import { formatChartDate } from "@/lib/utils/dates";
import { formatCount } from "@/lib/utils/format";

async function fetchInsightsFlat(mediaId: string): Promise<MediaInsights> {
  const res = await fetch(`/api/instagram/media/${mediaId}/insights?flat=true`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? "Failed to fetch insights");
  }
  return res.json();
}

export function VideoViewsChart({ className }: { className?: string }) {
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

  return (
    <Card padding="lg" className={`flex flex-col gap-4 ${className ?? ""}`}>
      <p className="text-xs uppercase tracking-widest text-[var(--text-muted)] font-medium">
        Video Views
      </p>
      {isLoading && <ChartSkeleton height={180} />}
      {isError && isRateLimitError(error) ? (
        <RateLimitError onRetry={() => mediaQuery.refetch()} />
      ) : isError ? (
        <ErrorState message={(error as Error)?.message} onRetry={() => mediaQuery.refetch()} />
      ) : null}
      {!isLoading && !isError && series.length === 0 && (
        <div className="flex-1 flex items-center justify-center min-h-[180px] text-xs text-[var(--text-muted)] font-mono">
          No video view data available
        </div>
      )}
      {!isLoading && !isError && series.length > 0 && (
        <ResponsiveContainer width="100%" className="flex-1" height="100%" minHeight={180}>
          <BarChart data={series} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11, fill: "var(--text-muted)", fontFamily: "var(--font-dm-mono)" }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fontSize: 11, fill: "var(--text-muted)", fontFamily: "var(--font-dm-mono)" }}
              tickLine={false}
              axisLine={false}
              tickFormatter={formatCount}
              width={48}
            />
            <Tooltip
              contentStyle={{
                background: "var(--bg-card)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                fontSize: 12,
                fontFamily: "var(--font-dm-mono)",
                color: "var(--text-primary)",
              }}
              formatter={(value: number) => [formatCount(value), "Views"]}
              labelStyle={{ color: "var(--text-muted)" }}
              cursor={{ fill: "var(--border)", opacity: 0.4 }}
            />
            <Bar
              dataKey="views"
              fill="var(--accent-cyan)"
              radius={[3, 3, 0, 0]}
              maxBarSize={32}
            />
          </BarChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}
