"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { Card } from "@/components/ui/Card";
import { ChartSkeleton } from "@/components/ui/Skeleton";
import { ErrorState, RateLimitError, isRateLimitError } from "@/components/ui/ErrorState";
import { useEngagementTrend } from "@/hooks/useEngagementTrend";
import { usePeriod } from "@/hooks/usePeriod";
import { formatCount } from "@/lib/utils/format";

const SERIES = [
  { key: "total_interactions", label: "Interactions", color: "var(--chart-1)" },
  { key: "reach", label: "Reach", color: "var(--chart-2)" },
  { key: "accounts_engaged", label: "Engaged Accounts", color: "var(--chart-3)" },
];

export function EngagementChart() {
  const [period] = usePeriod();
  const { data, isLoading, isError, error, refetch } = useEngagementTrend(period);

  return (
    <Card padding="lg" className="flex flex-col gap-4">
      <p className="text-xs uppercase tracking-widest text-[var(--text-muted)] font-medium">
        Engagement Overview
      </p>
      {isLoading && <ChartSkeleton height={220} />}
      {isError && isRateLimitError(error) ? (
        <RateLimitError onRetry={() => refetch()} />
      ) : isError ? (
        <ErrorState message={(error as Error)?.message} onRetry={() => refetch()} />
      ) : null}
      {!isLoading && !isError && (
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
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
              formatter={(value: number, name: string) => {
                const s = SERIES.find((s) => s.key === name);
                return [formatCount(value), s?.label ?? name];
              }}
              labelStyle={{ color: "var(--text-muted)" }}
              cursor={{ stroke: "var(--border)" }}
            />
            <Legend
              iconType="circle"
              iconSize={8}
              formatter={(value) =>
                SERIES.find((s) => s.key === value)?.label ?? value
              }
              wrapperStyle={{
                fontSize: 11,
                fontFamily: "var(--font-dm-mono)",
                color: "var(--text-muted)",
              }}
            />
            {SERIES.map(({ key, color }) => (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                stroke={color}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}
