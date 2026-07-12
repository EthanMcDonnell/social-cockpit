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
import { ChartSkeleton } from "@/components/ui/Skeleton";
import { ErrorState, isRateLimitError, RateLimitError } from "@/components/ui/ErrorState";
import { useMedia } from "@/hooks/useMedia";
import { usePlatform } from "@/hooks/usePlatform";
import { useYoutubeVideos } from "@/hooks/useYoutubeVideos";
import { usePeriod, type PeriodDays } from "@/hooks/usePeriod";
import { Panel } from "./Panel";
import { cockpitTooltip } from "./chartTheme";

interface Bucket {
  label: string;
  isoKey: string;
  count: number;
}

function dayKey(d: Date) {
  return d.toISOString().slice(0, 10);
}

function dayLabel(d: Date, period: PeriodDays) {
  if (period === 7) return d.toLocaleDateString("en-US", { weekday: "short" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
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
    const bucket = map.get(dayKey(date));
    if (bucket) bucket.count++;
  }
  return Array.from(map.values()).sort((a, b) => a.isoKey.localeCompare(b.isoKey));
}

const TICK_INTERVAL: Record<PeriodDays, number> = { 7: 0, 30: 1, 90: 6 };

export function PostsPerDayChart() {
  const [period] = usePeriod();
  const [platform] = usePlatform();
  const isIg = platform === "ig";

  const mediaQuery = useMedia({ all: true });
  const videosQuery = useYoutubeVideos(50, { enabled: !isIg });

  const timestamps = isIg
    ? mediaQuery.data?.data.map((m) => m.timestamp) ?? []
    : (videosQuery.data ?? []).map((v) => v.publishedAt);

  const isLoading = isIg ? mediaQuery.isLoading : videosQuery.isLoading;
  const isError = isIg ? mediaQuery.isError : videosQuery.isError;
  const error = isIg ? mediaQuery.error : videosQuery.error;
  const refetch = () => (isIg ? mediaQuery.refetch() : videosQuery.refetch());

  const buckets = buildBuckets(timestamps, period);
  const rangeLabel =
    buckets.length > 0 ? `${buckets[0].label} → ${buckets[buckets.length - 1].label}` : "";

  return (
    <Panel tag="04" title={isIg ? "Posts Per Day" : "Uploads Per Day"} rhs={rangeLabel}>
      {isLoading && <ChartSkeleton height={150} />}
      {isError && isRateLimitError(error) ? (
        <RateLimitError onRetry={() => refetch()} />
      ) : isError ? (
        <ErrorState message={(error as Error)?.message} onRetry={() => refetch()} />
      ) : null}
      {!isLoading && !isError && (
        <ResponsiveContainer width="100%" height={150}>
          <BarChart data={buckets} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="0" stroke="var(--hair)" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10, fill: "var(--mut)", fontFamily: "var(--mono)" }}
              tickLine={false}
              axisLine={false}
              interval={TICK_INTERVAL[period]}
            />
            <YAxis
              allowDecimals={false}
              tick={{ fontSize: 10, fill: "var(--mut)", fontFamily: "var(--mono)" }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => String(v)}
              width={28}
              domain={[0, "auto"]}
            />
            <Tooltip
              {...cockpitTooltip}
              formatter={(value: number) => [value, isIg ? "Posts" : "Uploads"]}
              cursor={{ fill: "var(--amber)", opacity: 0.08 }}
            />
            <Bar dataKey="count" fill="var(--amber-dim)" maxBarSize={20} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </Panel>
  );
}
