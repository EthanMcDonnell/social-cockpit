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

const HOURS = Array.from({ length: 24 }, (_, i) => i);
/**
 * One track definition for the hour labels and every strip, so a column can't
 * drift away from the label above it. `minmax(0, 1fr)` rather than `1fr` because
 * a bare `1fr` lets an hour label's own text widen its track — which is exactly
 * how the label row and the cell row end up disagreeing.
 */
const COLS = { gridTemplateColumns: "repeat(24, minmax(0, 1fr))" } as const;
// Amber intensity ramp (low → high), matching the COCKPIT v2 style guide.
const RAMP = ["#6B4E14", "#8F6A18", "#B3871C", "#D9A621", "#FFC72E"];
/** Below this many posts an hour's average is noise, so it can't be "best". */
const MIN_CONFIDENT_SAMPLE = 3;

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

interface HourStats {
  /** Mean views per post published in this hour, or null when none were. */
  views: number | null;
  /** Interactions per view, aggregated across the hour, or null when no views. */
  rate: number | null;
  count: number;
  engagement: number;
}

function buildHours(posts: TimedPost[]): HourStats[] {
  const cells = HOURS.map(() => ({ views: 0, engagement: 0, count: 0 }));
  for (const post of posts) {
    const c = cells[new Date(post.timestamp).getHours()];
    c.views += post.views;
    c.engagement += post.engagement;
    c.count++;
  }
  return cells.map((c) => ({
    views: c.count > 0 ? c.views / c.count : null,
    // Aggregate ratio rather than the mean of each post's ratio: one tiny post
    // with a freak like count shouldn't outweigh everything else in the hour.
    rate: c.views > 0 ? c.engagement / c.views : null,
    count: c.count,
    engagement: c.engagement,
  }));
}

function formatHour12(h: number): string {
  if (h === 0) return "12a";
  if (h === 12) return "12p";
  return h < 12 ? `${h}a` : `${h - 12}p`;
}

function formatRate(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

/** The best-performing hour by views, ignoring hours too thin to trust. */
function bestHour(hours: HourStats[]): string | null {
  let best = -1;
  hours.forEach((h, i) => {
    if (h.count < MIN_CONFIDENT_SAMPLE || h.views == null) return;
    if (best < 0 || h.views > (hours[best].views ?? 0)) best = i;
  });
  return best < 0 ? null : `best · ${formatHour12(best)}`;
}

interface StripProps {
  label: string;
  hours: HourStats[];
  /** Pulls the value being coloured out of an hour. */
  value: (h: HourStats) => number | null;
  /** Tooltip text for one hour. */
  title: (h: HourStats, hour: number) => string;
}

/** One full-width row of 24 hour cells, coloured against its own maximum. */
function Strip({ label, hours, value, title }: StripProps) {
  const max = Math.max(0, ...hours.map((h) => value(h) ?? 0));

  return (
    <div>
      <div className="text-[9px] text-[var(--mut)] font-mono tracking-wider mb-1">{label}</div>
      <div className="grid gap-x-[2px]" style={COLS}>
        {HOURS.map((hour) => {
          const v = value(hours[hour]);
          // Each strip is scaled to its own max, so a strong views hour and a
          // strong engagement hour both read as full amber in their own row.
          const idx =
            v != null && v > 0 && max > 0
              ? Math.min(RAMP.length - 1, Math.floor((v / max) * RAMP.length))
              : null;
          return (
            <div
              key={hour}
              title={title(hours[hour], hour)}
              className="h-[72px] cursor-default transition-opacity hover:opacity-80"
              style={
                idx != null
                  ? { backgroundColor: RAMP[idx], borderRadius: 1.5 }
                  : { border: "1px solid var(--hair)", borderRadius: 1.5 }
              }
            />
          );
        })}
      </div>
    </div>
  );
}

export function BestTimeHeatmap() {
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

  const postsLabel = (c: number) => `${c} post${c !== 1 ? "s" : ""}`;

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
        <div className="flex flex-col gap-3">
          {/* Hour labels — same grid as the strips below. */}
          <div className="grid gap-x-[2px]" style={COLS}>
            {HOURS.map((h) => (
              <div
                key={h}
                className="text-left text-[9px] text-[var(--mut)] font-mono leading-none overflow-visible"
              >
                {h % 3 === 0 ? String(h).padStart(2, "0") : ""}
              </div>
            ))}
          </div>

          <Strip
            label="AVG VIEWS"
            hours={hours}
            value={(h) => h.views}
            title={(h, hour) =>
              h.count > 0
                ? `${formatHour12(hour)}: ${formatCount(Math.round(h.views ?? 0))} avg views (${postsLabel(h.count)})`
                : `${formatHour12(hour)}: no posts`
            }
          />

          <Strip
            label="ENGAGEMENT RATE"
            hours={hours}
            value={(h) => h.rate}
            title={(h, hour) =>
              h.rate != null
                ? `${formatHour12(hour)}: ${formatRate(h.rate)} engagement (${formatCount(h.engagement)} likes + comments, ${postsLabel(h.count)})`
                : `${formatHour12(hour)}: no posts`
            }
          />

          {/* Discrete color scale legend — each strip is scaled to its own max */}
          <div className="legend">
            low
            <span className="cell" />
            {RAMP.map((c) => (
              <span key={c} className="cell" style={{ background: c, borderColor: "transparent" }} />
            ))}
            high
          </div>
        </div>
      )}
    </Panel>
  );
}
