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
import { useProfile } from "@/hooks/useProfile";
import { usePeriod } from "@/hooks/usePeriod";
import { userInsightsToTimeSeries, type TimeSeriesPoint } from "@/lib/data/transforms";
import { formatCount } from "@/lib/utils/format";

function buildCumulativeSeries(
  deltas: TimeSeriesPoint[],
  currentTotal: number
): TimeSeriesPoint[] {
  if (!deltas.length) return [];
  const sorted = [...deltas].sort((a, b) => a.isoDate.localeCompare(b.isoDate));
  const totals = new Array<number>(sorted.length);
  totals[sorted.length - 1] = currentTotal;
  for (let i = sorted.length - 2; i >= 0; i--) {
    totals[i] = totals[i + 1] - sorted[i + 1].value;
  }
  return sorted.map((point, i) => ({ ...point, value: totals[i] }));
}

/** Rounds a step up to a "nice" 1 / 2 / 5 × 10ⁿ value. */
function niceStep(rough: number): number {
  if (rough <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / pow;
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return nice * pow;
}

/**
 * Builds a tight, evenly-spaced Y axis around the data range so a near-flat
 * follower series doesn't collapse to repeated labels. Returns the domain and
 * explicit ticks (≈5) snapped to nice round numbers.
 */
function buildAxis(values: number[]): { domain: [number, number]; ticks: number[]; step: number } {
  const min = Math.min(...values);
  const max = Math.max(...values);
  // Flat series: invent a small band so ticks stay distinct.
  const span = max - min || Math.max(1, Math.round(max * 0.02));
  const step = niceStep(span / 4);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let t = lo; t <= hi + step / 2; t += step) ticks.push(t);
  return { domain: [lo, hi], ticks, step };
}

export function FollowerChart({ className }: { className?: string }) {
  const [period] = usePeriod();
  const insightsQuery = useUserInsights(period);
  const profileQuery = useProfile();

  const isLoading = insightsQuery.isLoading || profileQuery.isLoading;
  const isError = insightsQuery.isError || profileQuery.isError;
  const error = insightsQuery.error ?? profileQuery.error;

  const series =
    insightsQuery.data && profileQuery.data?.followers_count != null
      ? buildCumulativeSeries(
          userInsightsToTimeSeries(insightsQuery.data, "follower_count"),
          profileQuery.data.followers_count
        )
      : [];

  const axis =
    series.length > 0 ? buildAxis(series.map((p) => p.value)) : null;

  // When ticks are closer together than 1K, the K-suffix rounds neighbours to
  // the same label — fall back to grouped full numbers (e.g. "1,150").
  const formatTick = (v: number) =>
    axis && axis.step < 1000 ? Math.round(v).toLocaleString() : formatCount(v);

  const refetch = () => {
    insightsQuery.refetch();
    profileQuery.refetch();
  };

  return (
    <Card padding="lg" className={`flex flex-col gap-4 ${className ?? ""}`}>
      <p className="text-xs uppercase tracking-widest text-[var(--text-muted)] font-medium">
        Total Followers
      </p>
      {isLoading && <ChartSkeleton height={180} />}
      {isError && isRateLimitError(error) ? (
        <RateLimitError onRetry={refetch} />
      ) : isError ? (
        <ErrorState message={(error as Error)?.message} onRetry={refetch} />
      ) : null}
      {!isLoading && !isError && (
        <ResponsiveContainer width="100%" className="flex-1" height="100%" minHeight={180}>
          <AreaChart data={series} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="followerGrad" x1="0" y1="0" x2="0" y2="1">
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
              tickFormatter={formatTick}
              width={48}
              domain={axis ? axis.domain : ["auto", "auto"]}
              ticks={axis ? axis.ticks : undefined}
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
              formatter={(value: number) => [formatCount(value), "Followers"]}
              labelStyle={{ color: "var(--text-muted)" }}
              cursor={{ stroke: "var(--border)" }}
            />
            <Area
              type="monotone"
              dataKey="value"
              stroke="var(--accent-cyan)"
              strokeWidth={2}
              fill="url(#followerGrad)"
              dot={false}
              activeDot={{ r: 4, fill: "var(--accent-cyan)" }}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}
