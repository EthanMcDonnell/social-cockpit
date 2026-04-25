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
import { useEngagementTrend } from "@/hooks/useEngagementTrend";
import { usePeriod } from "@/hooks/usePeriod";
import { formatCount } from "@/lib/utils/format";

export function EngagementChart() {
  const [period] = usePeriod();
  const { data, metric, label, isLoading, isError, error, refetch } = useEngagementTrend(period);

  return (
    <Card padding="lg" className="flex flex-col gap-4">
      <p className="text-xs uppercase tracking-widest text-[var(--text-muted)] font-medium">
        Engagement Overview
      </p>
      {isLoading && <ChartSkeleton height={140} />}
      {isError && isRateLimitError(error) ? (
        <RateLimitError onRetry={() => refetch()} />
      ) : isError ? (
        <ErrorState message={(error as Error)?.message} onRetry={() => refetch()} />
      ) : null}
      {!isLoading && !isError && (
        <ResponsiveContainer width="100%" height={140}>
          <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="grad-engagement" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent-cyan)" stopOpacity={0.22} />
                <stop offset="100%" stopColor="var(--accent-cyan)" stopOpacity={0} />
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
              domain={[0, "auto"]}
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
              formatter={(value: number) => [formatCount(value), label]}
              labelStyle={{ color: "var(--text-muted)" }}
              cursor={{ stroke: "var(--border)" }}
            />
            <Area
              type="monotone"
              dataKey={metric}
              stroke="var(--accent-cyan)"
              strokeWidth={2}
              fill="url(#grad-engagement)"
              dot={false}
              activeDot={{ r: 4, fill: "var(--accent-cyan)" }}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}
