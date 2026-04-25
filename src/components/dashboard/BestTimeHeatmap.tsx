"use client";

import { useQueries } from "@tanstack/react-query";
import { Card } from "@/components/ui/Card";
import { ChartSkeleton } from "@/components/ui/Skeleton";
import { ErrorState, isRateLimitError, RateLimitError } from "@/components/ui/ErrorState";
import { useMedia } from "@/hooks/useMedia";
import { useProfile } from "@/hooks/useProfile";
import { calcEngagementRate } from "@/lib/data/calculations";
import type { MediaInsights } from "@/lib/instagram/types";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

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

function buildGrid(
  posts: Array<{ timestamp: string; engagementRate: number }>
): { grid: number[][]; postCounts: number[][] } {
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

  const grid = cells.map((row) =>
    row.map((c) => (c.count > 0 ? c.sum / c.count : 0))
  );
  const postCounts = cells.map((row) => row.map((c) => c.count));
  return { grid, postCounts };
}

function formatHour(h: number): string {
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

  const isLoading =
    mediaQuery.isLoading || insightQueries.some((q) => q.isLoading);
  const isError =
    mediaQuery.isError || insightQueries.some((q) => q.isError);
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

  const maxVal = Math.max(...grid.flat());

  function cellStyle(value: number): React.CSSProperties {
    if (value === 0) {
      return { backgroundColor: "var(--border)" };
    }
    const intensity = maxVal > 0 ? value / maxVal : 0;
    const alpha = 0.12 + intensity * 0.88;
    return {
      backgroundColor: `rgba(var(--accent-cyan-rgb), ${alpha.toFixed(2)})`,
    };
  }

  const hasData = postsWithEngagement.length >= 3;

  return (
    <Card padding="lg" className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <p className="text-xs uppercase tracking-widest text-[var(--text-muted)] font-medium">
          Best Time to Post
        </p>
        <p className="text-[10px] text-[var(--text-muted)] font-mono">
          avg engagement rate
        </p>
      </div>

      {isLoading && <ChartSkeleton height={160} />}

      {isError && isRateLimitError(error) ? (
        <RateLimitError onRetry={() => mediaQuery.refetch()} />
      ) : isError ? (
        <ErrorState message={(error as Error)?.message} onRetry={() => mediaQuery.refetch()} />
      ) : null}

      {!isLoading && !isError && !hasData && (
        <div className="flex items-center justify-center h-[160px] text-xs text-[var(--text-muted)] font-mono">
          Not enough posts to show patterns
        </div>
      )}

      {!isLoading && !isError && hasData && (
        <div className="overflow-x-auto">
          <div className="min-w-[480px]">
            {/* Hour labels */}
            <div className="flex ml-10 mb-1">
              {HOURS.map((h) => (
                <div
                  key={h}
                  className="flex-1 text-center text-[9px] text-[var(--text-muted)] font-mono leading-none"
                >
                  {h % 3 === 0 ? formatHour(h) : ""}
                </div>
              ))}
            </div>

            {/* Grid rows */}
            {DAYS.map((day, dayIdx) => (
              <div key={day} className="flex items-center gap-0 mb-[3px]">
                <span className="w-10 shrink-0 text-[10px] text-[var(--text-muted)] font-mono">
                  {day}
                </span>
                {HOURS.map((hour) => {
                  const value = grid[dayIdx][hour];
                  const count = postCounts[dayIdx][hour];
                  const pct = value > 0 ? `${(value * 100).toFixed(1)}%` : "—";
                  const title =
                    count > 0
                      ? `${day} ${formatHour(hour)}: ${pct} avg engagement (${count} post${count !== 1 ? "s" : ""})`
                      : `${day} ${formatHour(hour)}: no posts`;
                  return (
                    <div
                      key={hour}
                      title={title}
                      style={cellStyle(value)}
                      className="flex-1 h-[22px] rounded-[2px] mx-[1px] cursor-default transition-opacity hover:opacity-80"
                    />
                  );
                })}
              </div>
            ))}

            {/* Color scale legend */}
            <div className="flex items-center gap-2 mt-3 ml-10">
              <span className="text-[9px] text-[var(--text-muted)] font-mono">Low</span>
              <div className="flex flex-1 max-w-[120px] h-2 rounded overflow-hidden">
                {Array.from({ length: 10 }, (_, i) => {
                  const alpha = 0.12 + (i / 9) * 0.88;
                  return (
                    <div
                      key={i}
                      className="flex-1"
                      style={{ backgroundColor: `rgba(var(--accent-cyan-rgb), ${alpha.toFixed(2)})` }}
                    />
                  );
                })}
              </div>
              <span className="text-[9px] text-[var(--text-muted)] font-mono">High</span>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
