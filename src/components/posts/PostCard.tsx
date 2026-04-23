"use client";

import Link from "next/link";
import { clsx } from "clsx";
import { formatCount, formatPercent } from "@/lib/utils/format";
import { isWithin48Hours, hoursUntilInsightsAvailable } from "@/lib/utils/dates";
import type { InstagramMedia, MediaInsights } from "@/lib/instagram/types";

interface PostCardProps {
  media: InstagramMedia;
  insights?: MediaInsights;
  isLoadingInsights?: boolean;
}

const mediaTypeLabel: Record<string, string> = {
  IMAGE: "Photo",
  VIDEO: "Video",
  CAROUSEL_ALBUM: "Carousel",
  REEL: "Reel",
};

export function PostCard({ media, insights, isLoadingInsights }: PostCardProps) {
  const thumbnail = media.thumbnail_url ?? media.media_url;
  const tooNew = isWithin48Hours(media.timestamp);
  const hoursLeft = tooNew ? hoursUntilInsightsAvailable(media.timestamp) : 0;
  const caption = media.caption ?? "";
  const typeLabel = mediaTypeLabel[media.media_type] ?? media.media_type;

  return (
    <Link
      href={`/posts/${media.id}`}
      className="group rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] overflow-hidden hover:border-[var(--accent-cyan)]/50 transition-colors flex flex-col"
    >
      {/* Thumbnail */}
      <div className="relative aspect-square bg-[var(--border)] overflow-hidden">
        {thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbnail}
            alt=""
            className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[var(--text-muted)] text-2xl">
            ▶
          </div>
        )}
        {/* Media type badge */}
        <span className="absolute top-2 left-2 text-[10px] font-mono font-medium uppercase tracking-wider px-1.5 py-0.5 rounded-lg bg-black/50 text-white">
          {typeLabel}
        </span>
      </div>

      {/* Content */}
      <div className="flex flex-col gap-2 p-3 flex-1">
        {/* Caption */}
        <p className="text-xs text-[var(--text-primary)] line-clamp-2 flex-1">
          {caption || <span className="italic text-[var(--text-muted)]">No caption</span>}
        </p>

        {/* Metrics */}
        {tooNew ? (
          <p className="text-[10px] text-[var(--accent-amber)] font-mono">
            Insights in ~{hoursLeft}h
          </p>
        ) : isLoadingInsights ? (
          <div className="h-3 w-24 rounded bg-[var(--border)] animate-pulse" />
        ) : insights ? (
          <div className="flex items-center gap-3">
            <MetricPip label="♥" value={formatCount(insights.likes ?? 0)} />
            <MetricPip label="✦" value={formatCount(insights.reach ?? 0)} />
            <MetricPip
              label="Eng"
              value={
                insights.reach && insights.reach > 0
                  ? formatPercent((insights.total_interactions ?? 0) / insights.reach)
                  : "—"
              }
              accent
            />
          </div>
        ) : null}
      </div>
    </Link>
  );
}

function MetricPip({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <span
      className={clsx(
        "font-mono text-[10px]",
        accent ? "text-[var(--accent-cyan)]" : "text-[var(--text-muted)]"
      )}
    >
      {label} {value}
    </span>
  );
}
