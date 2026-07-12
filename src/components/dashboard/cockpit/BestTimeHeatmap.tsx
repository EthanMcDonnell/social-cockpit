"use client";

import { useQueries } from "@tanstack/react-query";
import { ChartSkeleton } from "@/components/ui/Skeleton";
import { ErrorState, isRateLimitError, RateLimitError } from "@/components/ui/ErrorState";
import { useMedia } from "@/hooks/useMedia";
import { usePlatform } from "@/hooks/usePlatform";
import { useYoutubeVideos } from "@/hooks/useYoutubeVideos";
import type { MediaInsights } from "@/lib/instagram/types";
import { formatCount } from "@/lib/utils/format";
import { Panel } from "./Panel";

const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const HOURS = Array.from({ length: 24 }, (_, i) => i);
// Amber intensity ramp (low → high), matching the COCKPIT v2 style guide.
const RAMP = ["#6B4E14", "#8F6A18", "#B3871C", "#D9A621", "#FFC72E"];

// A post reduced to when it went out and how many views it drew.
interface TimedPost {
  timestamp: string;
  views: number;
}

async function fetchInsights(mediaId: string): Promise<MediaInsights> {
  const res = await fetch(`/api/instagram/media/${mediaId}/insights?flat=true`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? "Failed to fetch insights");
  }
  return res.json();
}

interface Cell {
  sum: number;
  count: number;
}

function buildGrid(posts: TimedPost[]): {
  grid: number[][];
  postCounts: number[][];
} {
  const cells: Cell[][] = Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, () => ({ sum: 0, count: 0 }))
  );
  for (const post of posts) {
    const d = new Date(post.timestamp);
    const day = (d.getDay() + 6) % 7; // 0=Mon … 6=Sun
    const hour = d.getHours();
    cells[day][hour].sum += post.views;
    cells[day][hour].count++;
  }
  // Cell value = mean views for posts published in that weekday × hour slot.
  const grid = cells.map((row) => row.map((c) => (c.count > 0 ? c.sum / c.count : 0)));
  const postCounts = cells.map((row) => row.map((c) => c.count));
  return { grid, postCounts };
}

function formatHourLabel(h: number): string {
  return String(h).padStart(2, "0");
}

function formatHour12(h: number): string {
  if (h === 0) return "12a";
  if (h === 12) return "12p";
  return h < 12 ? `${h}a` : `${h - 12}p`;
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

  const { grid, postCounts } = buildGrid(posts);
  const maxVal = Math.max(...grid.flat(), 0);

  function cellFill(value: number): string | undefined {
    if (value <= 0) return undefined; // empty → outlined only
    const intensity = maxVal > 0 ? value / maxVal : 0;
    const idx = Math.min(RAMP.length - 1, Math.floor(intensity * RAMP.length));
    return RAMP[idx];
  }

  const hasData = posts.length >= 3;

  return (
    <Panel tag="03" title="Best Time to Post" rhs="avg views · weekday × hour">
      {isLoading && <ChartSkeleton height={200} />}
      {isError && isRateLimitError(error) ? (
        <RateLimitError onRetry={() => refetch()} />
      ) : isError ? (
        <ErrorState message={(error as Error)?.message} onRetry={() => refetch()} />
      ) : null}
      {!isLoading && !isError && !hasData && (
        <div className="flex items-center justify-center h-[200px] text-xs text-[var(--mut)] font-mono">
          Not enough posts to show patterns
        </div>
      )}
      {!isLoading && !isError && hasData && (
        <div className="overflow-x-auto">
          <div className="min-w-[440px]">
            {/* Hour labels */}
            <div className="flex ml-8 mb-1.5">
              {HOURS.map((h) => (
                <div
                  key={h}
                  className="flex-1 text-left text-[9px] text-[var(--mut)] font-mono leading-none"
                >
                  {h % 3 === 0 ? formatHourLabel(h) : ""}
                </div>
              ))}
            </div>

            {/* Grid rows */}
            {DAYS.map((day, dayIdx) => (
              <div key={day} className="flex items-center gap-0 mb-[3px]">
                <span className="w-8 shrink-0 text-[9px] text-[var(--mut)] font-mono tracking-wider">
                  {day}
                </span>
                {HOURS.map((hour) => {
                  const value = grid[dayIdx][hour];
                  const count = postCounts[dayIdx][hour];
                  const fill = cellFill(value);
                  const label = value > 0 ? formatCount(Math.round(value)) : "—";
                  const title =
                    count > 0
                      ? `${day} ${formatHour12(hour)}: ${label} avg views (${count} post${count !== 1 ? "s" : ""})`
                      : `${day} ${formatHour12(hour)}: no posts`;
                  return (
                    <div
                      key={hour}
                      title={title}
                      className="flex-1 h-[20px] mx-[1px] cursor-default transition-opacity hover:opacity-80"
                      style={
                        fill
                          ? { backgroundColor: fill, borderRadius: 1.5 }
                          : { border: "1px solid var(--hair)", borderRadius: 1.5 }
                      }
                    />
                  );
                })}
              </div>
            ))}

            {/* Discrete color scale legend */}
            <div className="legend ml-8 mt-3">
              low
              <span className="cell" />
              {RAMP.map((c) => (
                <span key={c} className="cell" style={{ background: c, borderColor: "transparent" }} />
              ))}
              high
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
}
