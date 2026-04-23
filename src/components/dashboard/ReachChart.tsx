"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Card } from "@/components/ui/Card";
import { ChartSkeleton } from "@/components/ui/Skeleton";
import { ErrorState, RateLimitError, isRateLimitError } from "@/components/ui/ErrorState";
import { useUserInsights } from "@/hooks/useUserInsights";
import { usePeriod } from "@/hooks/usePeriod";
import { userInsightsToTimeSeries } from "@/lib/data/transforms";
import { formatCount } from "@/lib/utils/format";

export function ReachChart() {
  const [period] = usePeriod();
  const { data, isLoading, isError, error, refetch } = useUserInsights(period);

  const series = data
    ? userInsightsToTimeSeries(data, "profile_views")
    : [];

  return (
    <Card padding="lg" className="flex flex-col gap-4">
      <p className="text-xs uppercase tracking-widest text-[var(--text-muted)] font-medium">
        Profile Views
      </p>
      {isLoading && <ChartSkeleton height={200} />}
      {isError && isRateLimitError(error) ? (
        <RateLimitError onRetry={() => refetch()} />
      ) : isError ? (
        <ErrorState message={(error as Error)?.message} onRetry={() => refetch()} />
      ) : null}
      {!isLoading && !isError && series.length === 0 && (
        <div className="flex items-center justify-center h-[200px] text-xs text-[var(--text-muted)] font-mono">
          No profile view data available for this period
        </div>
      )}
      {!isLoading && !isError && series.length > 0 && (
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={series} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="profileViewsGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--accent-amber)" stopOpacity={0.25} />
                <stop offset="95%" stopColor="var(--accent-amber)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--border)"
              vertical={false}
            />
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
              formatter={(value: number) => [formatCount(value), "Profile Views"]}
              labelStyle={{ color: "var(--text-muted)" }}
              cursor={{ stroke: "var(--border)" }}
            />
            <Area
              type="monotone"
              dataKey="value"
              stroke="var(--accent-amber)"
              strokeWidth={2}
              fill="url(#profileViewsGrad)"
              dot={false}
              activeDot={{ r: 4, fill: "var(--accent-amber)" }}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}
