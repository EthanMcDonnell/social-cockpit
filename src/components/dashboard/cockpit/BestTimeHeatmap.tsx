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
import { ErrorState, isRateLimitError, RateLimitError } from "@/components/ui/ErrorState";
import { useMedia } from "@/hooks/useMedia";
import { usePlatform } from "@/hooks/usePlatform";
import { useYoutubeVideos } from "@/hooks/useYoutubeVideos";
import type { MediaInsights } from "@/lib/instagram/types";
import { formatCount } from "@/lib/utils/format";
import { Panel } from "./Panel";
import { cockpitTooltip } from "./chartTheme";

/**
 * Six four-hour blocks rather than 24 separate hours: with the handful of posts
 * a single account publishes, per-hour averages are mostly noise, and a wide
 * block still answers the only question the panel is asked — morning, midday or
 * evening?
 */
const BLOCKS = [
  { label: "12–4a", start: 0 },
  { label: "4–8a", start: 4 },
  { label: "8a–12p", start: 8 },
  { label: "12–4p", start: 12 },
  { label: "4–8p", start: 16 },
  { label: "8p–12a", start: 20 },
];

const WEEKDAY_COLOR = "var(--amber)";
const WEEKEND_COLOR = "var(--amber-dim)";

// A post reduced to when it went out and how many views it drew.
interface TimedPost {
  timestamp: string;
  views: number;
}

interface Bucket {
  label: string;
  weekday: number | null;
  weekend: number | null;
  weekdayCount: number;
  weekendCount: number;
}

async function fetchInsights(mediaId: string): Promise<MediaInsights> {
  const res = await fetch(`/api/instagram/media/${mediaId}/insights?flat=true`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? "Failed to fetch insights");
  }
  return res.json();
}

function buildBuckets(posts: TimedPost[]): Bucket[] {
  // [blockIdx][0 = weekday, 1 = weekend] → running sum + count
  const cells = BLOCKS.map(() => [
    { sum: 0, count: 0 },
    { sum: 0, count: 0 },
  ]);
  for (const post of posts) {
    const d = new Date(post.timestamp);
    const day = d.getDay();
    const lane = day === 0 || day === 6 ? 1 : 0;
    const block = Math.floor(d.getHours() / 4);
    cells[block][lane].sum += post.views;
    cells[block][lane].count++;
  }
  // Bar value = mean views for posts published in that block, or null when
  // nothing was posted there so the bar is omitted instead of drawn at zero.
  return BLOCKS.map((b, i) => {
    const [wd, we] = cells[i];
    return {
      label: b.label,
      weekday: wd.count > 0 ? wd.sum / wd.count : null,
      weekend: we.count > 0 ? we.sum / we.count : null,
      weekdayCount: wd.count,
      weekendCount: we.count,
    };
  });
}

/** The single best-performing block across both lanes, for the panel caption. */
function bestSlot(buckets: Bucket[]): string | null {
  let best: { label: string; lane: string; value: number } | null = null;
  for (const b of buckets) {
    for (const [lane, value] of [
      ["weekday", b.weekday],
      ["weekend", b.weekend],
    ] as const) {
      if (value != null && (best === null || value > best.value)) {
        best = { label: b.label, lane, value };
      }
    }
  }
  return best ? `best · ${best.lane} ${best.label}` : null;
}

export function BestTimeHeatmap() {
  const [platform] = usePlatform();
  const isIg = platform === "ig";

  // ── Instagram: per-post views come from each media's insights ──
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

  // ── YouTube: per-video view counts come straight off the videos list ──
  const videosQuery = useYoutubeVideos(50, { enabled: !isIg });

  const igPosts: TimedPost[] = mediaList
    .map((media, i) => {
      const views = insightQueries[i]?.data?.views;
      if (views == null) return null;
      return { timestamp: media.timestamp, views };
    })
    .filter((p): p is TimedPost => p !== null && p.views > 0);

  const ytPosts: TimedPost[] = (videosQuery.data ?? [])
    .filter((v) => v.viewCount > 0)
    .map((v) => ({ timestamp: v.publishedAt, views: v.viewCount }));

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

  const buckets = buildBuckets(posts);
  const hasData = posts.length >= 3;
  const caption = (hasData && bestSlot(buckets)) || "avg views · time of day";

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
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={buckets} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="0" stroke="var(--hair)" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: "var(--mut)", fontFamily: "var(--mono)" }}
                tickLine={false}
                axisLine={false}
                interval={0}
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
                cursor={{ fill: "var(--amber)", opacity: 0.08 }}
                formatter={(value: number, name: string, item: { payload?: Bucket }) => {
                  const p = item?.payload;
                  const count =
                    (name === "Weekend" ? p?.weekendCount : p?.weekdayCount) ?? 0;
                  return [
                    `${formatCount(Math.round(value))} avg · ${count} post${count !== 1 ? "s" : ""}`,
                    name,
                  ];
                }}
              />
              <Bar dataKey="weekday" name="Weekday" fill={WEEKDAY_COLOR} maxBarSize={26} />
              <Bar dataKey="weekend" name="Weekend" fill={WEEKEND_COLOR} maxBarSize={26} />
            </BarChart>
          </ResponsiveContainer>

          <div className="legend ml-[44px]">
            <span className="cell" style={{ background: WEEKDAY_COLOR, borderColor: "transparent" }} />
            weekday
            <span className="cell ml-3" style={{ background: WEEKEND_COLOR, borderColor: "transparent" }} />
            weekend
          </div>
        </>
      )}
    </Panel>
  );
}
