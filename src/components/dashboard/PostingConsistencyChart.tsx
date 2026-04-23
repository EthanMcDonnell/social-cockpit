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
import { Card } from "@/components/ui/Card";
import { ChartSkeleton } from "@/components/ui/Skeleton";
import { ErrorState, isRateLimitError, RateLimitError } from "@/components/ui/ErrorState";
import { useMedia } from "@/hooks/useMedia";
import { usePeriod } from "@/hooks/usePeriod";
import type { PeriodDays } from "@/hooks/usePeriod";

interface Bucket {
  label: string;
  isoKey: string;
  count: number;
}

function buildBuckets(timestamps: string[], period: PeriodDays): Bucket[] {
  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - period);

  const map = new Map<string, Bucket>();

  for (let i = 0; i < period; i++) {
    const d = new Date(cutoff);
    d.setDate(d.getDate() + i);
    const key = dayKey(d);
    map.set(key, { label: dayLabel(d, period), isoKey: key, count: 0 });
  }

  for (const ts of timestamps) {
    const date = new Date(ts);
    if (date < cutoff) continue;
    const key = dayKey(date);
    const bucket = map.get(key);
    if (bucket) bucket.count++;
  }

  return Array.from(map.values()).sort((a, b) => a.isoKey.localeCompare(b.isoKey));
}

function dayKey(d: Date) {
  return d.toISOString().slice(0, 10);
}

function dayLabel(d: Date, period: PeriodDays) {
  if (period === 7) return d.toLocaleDateString("en-US", { weekday: "short" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}


// How many buckets to skip between x-axis ticks per period
const TICK_INTERVAL: Record<PeriodDays, number> = { 7: 0, 30: 1, 90: 6 };

export function PostingConsistencyChart() {
  const [period] = usePeriod();
  const { data, isLoading, isError, error, refetch } = useMedia({ all: true });

  const timestamps = data?.data.map((m) => m.timestamp) ?? [];
  const buckets = buildBuckets(timestamps, period);

  return (
    <Card padding="lg" className="flex flex-col gap-4">
      <p className="text-xs uppercase tracking-widest text-[var(--text-muted)] font-medium">
        Posting Consistency
      </p>
      {isLoading && <ChartSkeleton height={200} />}
      {isError && isRateLimitError(error) ? (
        <RateLimitError onRetry={() => refetch()} />
      ) : isError ? (
        <ErrorState message={(error as Error)?.message} onRetry={() => refetch()} />
      ) : null}
      {!isLoading && !isError && (
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={buckets} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: "var(--text-muted)", fontFamily: "var(--font-dm-mono)" }}
              tickLine={false}
              axisLine={false}
              interval={TICK_INTERVAL[period]}
            />
            <YAxis
              allowDecimals={false}
              tick={{ fontSize: 11, fill: "var(--text-muted)", fontFamily: "var(--font-dm-mono)" }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => String(v)}
              width={28}
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
              formatter={(value: number) => [value, "Posts"]}
              labelStyle={{ color: "var(--text-muted)" }}
              cursor={{ fill: "var(--border)", opacity: 0.4 }}
            />
            <Bar
              dataKey="count"
              fill="var(--accent-amber)"
              radius={[3, 3, 0, 0]}
              maxBarSize={32}
            />
          </BarChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}
