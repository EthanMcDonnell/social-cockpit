"use client";

import {
  ComposedChart,
  Bar,
  Line,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useQueries } from "@tanstack/react-query";
import { ChartSkeleton } from "@/components/ui/Skeleton";
import { ErrorState, isRateLimitError, RateLimitError } from "@/components/ui/ErrorState";
import { useMedia } from "@/hooks/useMedia";
import { usePlatform } from "@/hooks/usePlatform";
import { useYoutubeVideos } from "@/hooks/useYoutubeVideos";
import type { MediaInsights } from "@/lib/instagram/types";
import { formatCount } from "@/lib/utils/format";
import { Panel } from "./Panel";
import { cockpitTooltip } from "./chartTheme";

const HOURS = Array.from({ length: 24 }, (_, i) => i);
/** Below this many posts an hour's average is noise, so it can't be "best". */
const MIN_CONFIDENT_SAMPLE = 3;
/**
 * Views are plotted on a log axis. A single post that goes wide outruns a
 * typical one by two orders of magnitude, and on a linear axis it flattens
 * every other hour into the baseline — which is exactly what made the previous
 * heatmap a solid block of one colour.
 */
const VIEWS_DOMAIN: [number, string] = [100, "dataMax"];
const VIEWS_TICKS = [100, 1000, 10000, 100000];

/**
 * A post reduced to when it went out, how many views it drew, and how many
 * interactions it collected. Engagement is likes + comments only: those are the
 * two counts both Instagram and YouTube report. Shares and saves are
 * Instagram-only, and folding them in would make the metric mean something
 * different per platform.
 */
interface TimedPost {
  timestamp: string;
  views: number;
  engagement: number;
}

async function fetchInsights(mediaId: string): Promise<MediaInsights> {
  const res = await fetch(`/api/instagram/media/${mediaId}/insights?flat=true`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? "Failed to fetch insights");
  }
  return res.json();
}

interface HourPoint {
  hour: number;
  label: string;
  /** Mean views per post published in this hour, or null when none were. */
  views: number | null;
  /** Interactions per view as a percentage, or null when there were no views. */
  rate: number | null;
  count: number;
}

function formatHour12(h: number): string {
  if (h === 0) return "12a";
  if (h === 12) return "12p";
  return h < 12 ? `${h}a` : `${h - 12}p`;
}

function buildHours(posts: TimedPost[]): HourPoint[] {
  const cells = HOURS.map(() => ({ views: 0, engagement: 0, count: 0 }));
  for (const post of posts) {
    const c = cells[new Date(post.timestamp).getHours()];
    c.views += post.views;
    c.engagement += post.engagement;
    c.count++;
  }
  return cells.map((c, hour) => ({
    hour,
    label: String(hour).padStart(2, "0"),
    views: c.count > 0 ? c.views / c.count : null,
    // Aggregate ratio rather than the mean of each post's ratio: one tiny post
    // with a freak like count shouldn't outweigh everything else in the hour.
    rate: c.views > 0 ? (c.engagement / c.views) * 100 : null,
    count: c.count,
  }));
}

/** The best-performing hour by views, ignoring hours too thin to trust. */
function bestHour(hours: HourPoint[]): string | null {
  let best: HourPoint | null = null;
  for (const h of hours) {
    if (h.count < MIN_CONFIDENT_SAMPLE || h.views == null) continue;
    if (best === null || h.views > (best.views ?? 0)) best = h;
  }
  return best ? `best · ${formatHour12(best.hour)}` : null;
}

export function BestTimeChart() {
  const [platform] = usePlatform();
  const isIg = platform === "ig";

  // ── Instagram: per-post metrics come from each media's insights ──
  const mediaQuery = useMedia({ all: true });
  const mediaList = isIg ? mediaQuery.data?.data ?? [] : [];
  const insightQueries = useQueries({
    queries: mediaList.map((m) => ({
      queryKey: ["instagram", "media", m.id, "insights"],
      queryFn: () => fetchInsights(m.id),
      staleTime: 15 * 60 * 1000,
      enabled: isIg && mediaList.length > 0,
    })),
  });

  // ── YouTube: per-video counts come straight off the videos list ──
  const videosQuery = useYoutubeVideos(50, { enabled: !isIg });

  const igPosts: TimedPost[] = mediaList
    .map((media, i) => {
      const insights = insightQueries[i]?.data;
      if (insights?.views == null) return null;
      return {
        timestamp: media.timestamp,
        views: insights.views,
        engagement: (insights.likes ?? 0) + (insights.comments ?? 0),
      };
    })
    .filter((p): p is TimedPost => p !== null && p.views > 0);

  const ytPosts: TimedPost[] = (videosQuery.data ?? [])
    .filter((v) => v.viewCount > 0)
    .map((v) => ({
      timestamp: v.publishedAt,
      views: v.viewCount,
      engagement: v.likeCount + v.commentCount,
    }));

  const posts = isIg ? igPosts : ytPosts;

  const isLoading = isIg
    ? mediaQuery.isLoading || insightQueries.some((q) => q.isLoading)
    : videosQuery.isLoading;
  const isError = isIg
    ? mediaQuery.isError || insightQueries.some((q) => q.isError)
    : videosQuery.isError;
  const error = isIg
    ? mediaQuery.error ?? insightQueries.find((q) => q.isError)?.error
    : videosQuery.error;
  const refetch = () => (isIg ? mediaQuery.refetch() : videosQuery.refetch());

  const hours = buildHours(posts);
  const hasData = posts.length >= 3;
  const caption = (hasData && bestHour(hours)) || "by hour of day";

  return (
    <Panel tag="03" title="Best Time to Post" rhs={caption}>
      {isLoading && <ChartSkeleton height={272} />}
      {isError && isRateLimitError(error) ? (
        <RateLimitError onRetry={() => refetch()} />
      ) : isError ? (
        <ErrorState message={(error as Error)?.message} onRetry={() => refetch()} />
      ) : null}
      {!isLoading && !isError && !hasData && (
        <div className="flex-1 flex items-center justify-center min-h-[272px] text-xs text-[var(--mut)] font-mono">
          Not enough posts to show patterns
        </div>
      )}
      {!isLoading && !isError && hasData && (
        <>
          <ResponsiveContainer width="100%" height={236}>
            <ComposedChart data={hours} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="0" stroke="var(--hair)" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: "var(--mut)", fontFamily: "var(--mono)" }}
                tickLine={false}
                axisLine={false}
                interval={0}
                // Every third hour, so 24 columns don't collide.
                tickFormatter={(label: string) => (Number(label) % 3 === 0 ? label : "")}
              />
              <YAxis
                yAxisId="views"
                scale="log"
                domain={VIEWS_DOMAIN}
                ticks={VIEWS_TICKS}
                allowDataOverflow
                tick={{ fontSize: 10, fill: "var(--mut)", fontFamily: "var(--mono)" }}
                tickLine={false}
                axisLine={false}
                tickFormatter={formatCount}
                width={44}
              />
              <YAxis
                yAxisId="rate"
                orientation="right"
                tick={{ fontSize: 10, fill: "var(--amber-hi)", fontFamily: "var(--mono)" }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => `${v}%`}
                width={36}
              />
              <Tooltip
                {...cockpitTooltip}
                cursor={{ fill: "var(--amber)", opacity: 0.08 }}
                labelFormatter={(label: string) => formatHour12(Number(label))}
                formatter={(value: number, name: string, item: { payload?: HourPoint }) => {
                  const count = item?.payload?.count ?? 0;
                  const posts = `${count} post${count !== 1 ? "s" : ""}`;
                  return name === "Engagement"
                    ? [`${value.toFixed(1)}%`, name]
                    : [`${formatCount(Math.round(value))} avg · ${posts}`, name];
                }}
              />
              <Bar yAxisId="views" dataKey="views" name="Views" maxBarSize={26}>
                {hours.map((h) => (
                  // Thin hours are outlined rather than filled, so a bar backed
                  // by one post can't be mistaken for an established pattern.
                  <Cell
                    key={h.hour}
                    fill={h.count >= MIN_CONFIDENT_SAMPLE ? "var(--amber-dim)" : "transparent"}
                    stroke="var(--amber-dim)"
                    strokeDasharray={h.count >= MIN_CONFIDENT_SAMPLE ? "0" : "2 2"}
                  />
                ))}
              </Bar>
              <Line
                yAxisId="rate"
                type="linear"
                dataKey="rate"
                name="Engagement"
                stroke="var(--amber-hi)"
                strokeWidth={1.5}
                dot={{ r: 2.5, fill: "var(--amber-hi)", strokeWidth: 0 }}
                activeDot={{ r: 4 }}
                connectNulls
              />
            </ComposedChart>
          </ResponsiveContainer>

          <div className="legend">
            <span className="cell" style={{ background: "var(--amber-dim)", borderColor: "transparent" }} />
            avg views
            <span
              className="cell ml-3"
              style={{ background: "var(--amber-hi)", height: 2, borderColor: "transparent" }}
            />
            engagement
            <span
              className="cell ml-3"
              style={{ background: "transparent", border: "1px dashed var(--amber-dim)" }}
            />
            under 3 posts
          </div>
        </>
      )}
    </Panel>
  );
}
