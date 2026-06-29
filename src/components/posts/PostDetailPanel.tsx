"use client";

import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { useSingleMedia } from "@/hooks/useMedia";
import { useMediaInsights } from "@/hooks/useMediaInsights";
import { TranscriptPanel } from "./TranscriptPanel";
import { formatCount, formatPercent, formatDuration } from "@/lib/utils/format";
import { formatChartDate, isWithin48Hours, hoursUntilInsightsAvailable } from "@/lib/utils/dates";

interface MetricRowProps {
  label: string;
  value: string | number;
  accent?: boolean;
}

function MetricRow({ label, value, accent }: MetricRowProps) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-[var(--border)] last:border-0">
      <span className="text-xs text-[var(--text-muted)]">{label}</span>
      <span
        className={`font-mono text-sm font-medium ${
          accent ? "text-[var(--accent-cyan)]" : "text-[var(--text-primary)]"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

const mediaTypeColor: Record<string, "cyan" | "amber" | "green" | "default"> = {
  IMAGE: "default",
  VIDEO: "amber",
  CAROUSEL_ALBUM: "cyan",
  REEL: "green",
};

interface PostDetailPanelProps {
  mediaId: string;
}

export function PostDetailPanel({ mediaId }: PostDetailPanelProps) {
  const mediaQuery = useSingleMedia(mediaId);
  const insightsQuery = useMediaInsights(mediaId);

  if (mediaQuery.isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex gap-6">
          <Skeleton className="aspect-square w-64 rounded-lg shrink-0" />
          <div className="flex-1 space-y-3">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
        <Skeleton className="h-48 w-full rounded-lg" />
      </div>
    );
  }

  if (mediaQuery.isError) {
    return <ErrorState message={(mediaQuery.error as Error)?.message} />;
  }

  const media = mediaQuery.data;
  if (!media) return null;

  const thumbnail = media.thumbnail_url ?? media.media_url;
  const tooNew = isWithin48Hours(media.timestamp);
  const hoursLeft = tooNew ? hoursUntilInsightsAvailable(media.timestamp) : 0;
  const insights = insightsQuery.data;
  const badgeVariant = mediaTypeColor[media.media_type] ?? "default";

  const engagementRate =
    insights?.reach && insights.reach > 0
      ? (insights.total_interactions ?? 0) / insights.reach
      : undefined;

  return (
    <div className="space-y-6">
      {/* Media + metadata */}
      <div className="flex flex-col gap-6 sm:flex-row">
        {/* Thumbnail */}
        <div className="shrink-0 w-full sm:w-56">
          {thumbnail ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={thumbnail}
              alt=""
              className="w-full aspect-square object-cover rounded-lg border border-[var(--border)]"
            />
          ) : (
            <div className="w-full aspect-square rounded-lg bg-[var(--border)] flex items-center justify-center text-[var(--text-muted)] text-4xl">
              ▶
            </div>
          )}
        </div>

        {/* Metadata */}
        <div className="flex-1 space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant={badgeVariant}>{media.media_type.replace("_", " ")}</Badge>
            {media.media_product_type && (
              <Badge variant="default">{media.media_product_type}</Badge>
            )}
          </div>

          <p className="text-sm text-[var(--text-primary)] leading-relaxed">
            {media.caption || (
              <span className="italic text-[var(--text-muted)]">No caption</span>
            )}
          </p>

          <div className="space-y-1">
            <p className="text-xs text-[var(--text-muted)]">
              Published{" "}
              <span className="font-mono text-[var(--text-primary)]">
                {formatChartDate(media.timestamp)}
              </span>
            </p>
            {media.permalink && (
              <a
                href={media.permalink}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-[var(--accent-cyan)] hover:underline"
              >
                View on Instagram ↗
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Insights */}
      <Card padding="none">
        <div className="px-5 py-4 border-b border-[var(--border)]">
          <p className="text-xs uppercase tracking-widest text-[var(--text-muted)] font-medium">
            Post Insights
          </p>
        </div>

        {tooNew ? (
          <div className="p-6 text-center">
            <p className="text-sm text-[var(--accent-amber)] font-medium">
              Insights available in ~{hoursLeft} hours
            </p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Instagram requires 48 hours after publishing before insights are accessible.
            </p>
          </div>
        ) : insightsQuery.isLoading ? (
          <div className="p-5 space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : insightsQuery.isError ? (
          <ErrorState message={(insightsQuery.error as Error)?.message} />
        ) : insights ? (
          <div className="px-5">
            <MetricRow label="Reach" value={formatCount(insights.reach ?? 0)} />
            <MetricRow label="Likes" value={formatCount(insights.likes ?? 0)} />
            <MetricRow label="Comments" value={formatCount(insights.comments ?? 0)} />
            <MetricRow label="Shares" value={formatCount(insights.shares ?? 0)} />
            <MetricRow label="Saves" value={formatCount(insights.saved ?? 0)} />
            <MetricRow label="Views" value={formatCount(insights.views ?? 0)} />
            <MetricRow label="Total Interactions" value={formatCount(insights.total_interactions ?? 0)} />
            {insights.ig_reels_avg_watch_time !== undefined && (
              <MetricRow label="Avg Watch Time" value={formatDuration(insights.ig_reels_avg_watch_time)} />
            )}
            {insights.ig_reels_video_view_total_time !== undefined && (
              <MetricRow label="Total Watch Time" value={formatDuration(insights.ig_reels_video_view_total_time)} />
            )}
            {engagementRate !== undefined && (
              <MetricRow
                label="Engagement Rate"
                value={formatPercent(engagementRate)}
                accent
              />
            )}
          </div>
        ) : (
          <div className="p-5 text-center text-xs text-[var(--text-muted)]">
            No insights available.
          </div>
        )}
      </Card>

      {/* Transcript — renders only for videos/reels when the feature is enabled */}
      <TranscriptPanel mediaId={mediaId} mediaType={media.media_type} />

      <div className="flex justify-start">
        <Link
          href="/posts"
          className="text-xs text-[var(--text-muted)] hover:text-[var(--accent-cyan)] transition-colors"
        >
          ← Back to Posts
        </Link>
      </div>
    </div>
  );
}
