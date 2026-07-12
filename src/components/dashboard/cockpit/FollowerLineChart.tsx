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
import { ChartSkeleton } from "@/components/ui/Skeleton";
import { ErrorState, RateLimitError, isRateLimitError } from "@/components/ui/ErrorState";
import { useUserInsights } from "@/hooks/useUserInsights";
import { useProfile } from "@/hooks/useProfile";
import { usePeriod } from "@/hooks/usePeriod";
import { usePlatform } from "@/hooks/usePlatform";
import { useYoutubeChannel } from "@/hooks/useYoutubeChannel";
import { userInsightsToTimeSeries, type TimeSeriesPoint } from "@/lib/data/transforms";
import { formatCount } from "@/lib/utils/format";
import { Panel } from "./Panel";
import { cockpitTooltip } from "./chartTheme";

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

function niceStep(rough: number): number {
  if (rough <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / pow;
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return nice * pow;
}

function buildAxis(values: number[]): { domain: [number, number]; ticks: number[]; step: number } {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || Math.max(1, Math.round(max * 0.02));
  const step = niceStep(span / 4);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let t = lo; t <= hi + step / 2; t += step) ticks.push(t);
  return { domain: [lo, hi], ticks, step };
}

export function FollowerLineChart() {
  const [period] = usePeriod();
  const [platform] = usePlatform();
  const isIg = platform === "ig";

  const insightsQuery = useUserInsights(period);
  const profileQuery = useProfile();
  const channelQuery = useYoutubeChannel({ enabled: !isIg });

  // ── YouTube: the Data API key exposes only the current subscriber total, no
  //    history — so we show the standing figure rather than a fabricated line. ──
  if (!isIg) {
    const subs = channelQuery.data?.subscriberCount;
    return (
      <Panel tag="01" title="Subscribers" rhs="current total">
        {channelQuery.isLoading && <ChartSkeleton height={264} />}
        {channelQuery.isError && (
          <ErrorState
            message={(channelQuery.error as Error)?.message}
            onRetry={() => channelQuery.refetch()}
          />
        )}
        {!channelQuery.isLoading && !channelQuery.isError && (
          <div className="flex flex-col items-center justify-center h-[264px] gap-3 text-center">
            <div
              style={{
                fontFamily: "var(--cond)",
                fontWeight: 700,
                fontSize: 68,
                lineHeight: 1,
                color: "var(--amber-hi)",
                textShadow: "0 0 26px rgba(255,179,36,.3)",
              }}
            >
              {subs != null ? subs.toLocaleString() : "—"}
            </div>
            <div className="text-[10px] text-[var(--mut)] font-mono tracking-wide max-w-[300px] leading-relaxed">
              Subscriber history isn&rsquo;t available from the YouTube Data API key — only the
              current total.
            </div>
          </div>
        )}
      </Panel>
    );
  }

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

  const axis = series.length > 0 ? buildAxis(series.map((p) => p.value)) : null;
  const net = series.length > 1 ? series[series.length - 1].value - series[0].value : 0;

  const formatTick = (v: number) =>
    axis && axis.step < 1000 ? Math.round(v).toLocaleString() : formatCount(v);

  const refetch = () => {
    insightsQuery.refetch();
    profileQuery.refetch();
  };

  const rhs =
    series.length > 1
      ? `${series[0].date} → ${series[series.length - 1].date} · daily · ${net >= 0 ? "+" : ""}${net}`
      : "daily";

  return (
    <Panel tag="01" title="Followers" rhs={rhs}>
      {isLoading && <ChartSkeleton height={264} />}
      {isError && isRateLimitError(error) ? (
        <RateLimitError onRetry={refetch} />
      ) : isError ? (
        <ErrorState message={(error as Error)?.message} onRetry={refetch} />
      ) : null}
      {!isLoading && !isError && (
        <ResponsiveContainer width="100%" height={264}>
          <AreaChart data={series} margin={{ top: 8, right: 52, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="ckFollowerFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--amber)" stopOpacity={0.16} />
                <stop offset="100%" stopColor="var(--amber)" stopOpacity={0} />
              </linearGradient>
              <filter id="ckFollowerGlow" x="-30%" y="-30%" width="160%" height="160%">
                <feGaussianBlur stdDeviation="3" result="b" />
                <feMerge>
                  <feMergeNode in="b" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            <CartesianGrid strokeDasharray="0" stroke="var(--hair)" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fill: "var(--mut)", fontFamily: "var(--mono)" }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
              minTickGap={40}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "var(--mut)", fontFamily: "var(--mono)" }}
              tickLine={false}
              axisLine={false}
              tickFormatter={formatTick}
              width={52}
              domain={axis ? axis.domain : ["auto", "auto"]}
              ticks={axis ? axis.ticks : undefined}
            />
            <Tooltip
              {...cockpitTooltip}
              formatter={(value: number) => [formatCount(value), "Followers"]}
              cursor={{ stroke: "var(--amber-dim)", strokeDasharray: "2 4" }}
            />
            <Area
              type="monotone"
              dataKey="value"
              stroke="var(--amber)"
              strokeWidth={2.2}
              fill="url(#ckFollowerFill)"
              dot={false}
              activeDot={{ r: 4, fill: "var(--amber-hi)", stroke: "var(--char)", strokeWidth: 2 }}
              style={{ filter: "url(#ckFollowerGlow)" }}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </Panel>
  );
}
