"use client";

import { useQueries } from "@tanstack/react-query";
import { ChartSkeleton } from "@/components/ui/Skeleton";
import { ErrorState, isRateLimitError, RateLimitError } from "@/components/ui/ErrorState";
import { useMedia } from "@/hooks/useMedia";
import { useProfile } from "@/hooks/useProfile";
import { calcEngagementRate } from "@/lib/data/calculations";
import type { MediaInsights } from "@/lib/instagram/types";
import { Panel } from "./Panel";

const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const HOURS = Array.from({ length: 24 }, (_, i) => i);
// Amber intensity ramp (low → high), matching the COCKPIT v2 style guide.
const RAMP = ["#6B4E14", "#8F6A18", "#B3871C", "#D9A621", "#FFC72E"];

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

function buildGrid(posts: Array<{ timestamp: string; engagementRate: number }>): {
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
    cells[day][hour].sum += post.engagementRate;
    cells[day][hour].count++;
  }
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
  const mediaQuery = useMedia({ all: true });
  const profileQuery = useProfile();
  const mediaList = mediaQuery.data?.data ?? [];

  const insightQueries = useQueries({
    queries: mediaList.map((m) => ({
      queryKey: ["instagram", "media", m.id, "insights"],
      queryFn: () => fetchInsights(m.id),
      staleTime: 15 * 60 * 1000,
      enabled: mediaList.length > 0,
    })),
  });

  const isLoading = mediaQuery.isLoading || insightQueries.some((q) => q.isLoading);
  const isError = mediaQuery.isError || insightQueries.some((q) => q.isError);
  const error = mediaQuery.error ?? insightQueries.find((q) => q.isError)?.error;

  const followerCount = profileQuery.data?.followers_count;

  const postsWithEngagement = mediaList
    .map((media, i) => {
      const insights = insightQueries[i]?.data;
      if (!insights) return null;
      return {
        timestamp: media.timestamp,
        engagementRate: calcEngagementRate(insights, followerCount),
      };
    })
    .filter((p): p is { timestamp: string; engagementRate: number } => p !== null);

  const { grid, postCounts } = buildGrid(postsWithEngagement);
  const maxVal = Math.max(...grid.flat(), 0);

  function cellFill(value: number): string | undefined {
    if (value <= 0) return undefined; // empty → outlined only
    const intensity = maxVal > 0 ? value / maxVal : 0;
    const idx = Math.min(RAMP.length - 1, Math.floor(intensity * RAMP.length));
    return RAMP[idx];
  }

  const hasData = postsWithEngagement.length >= 3;

  return (
    <Panel tag="03" title="Best Time to Post" rhs="avg engagement · weekday × hour">
      {isLoading && <ChartSkeleton height={200} />}
      {isError && isRateLimitError(error) ? (
        <RateLimitError onRetry={() => mediaQuery.refetch()} />
      ) : isError ? (
        <ErrorState message={(error as Error)?.message} onRetry={() => mediaQuery.refetch()} />
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
                  const pct = value > 0 ? `${(value * 100).toFixed(1)}%` : "—";
                  const title =
                    count > 0
                      ? `${day} ${formatHour12(hour)}: ${pct} avg engagement (${count} post${count !== 1 ? "s" : ""})`
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
