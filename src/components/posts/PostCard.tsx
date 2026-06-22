"use client";

import Link from "next/link";
import { useState } from "react";
import { clsx } from "clsx";
import { isWithin48Hours, hoursUntilInsightsAvailable } from "@/lib/utils/dates";
import type { PostTableRow } from "@/lib/data/transforms";
import { MEDIA_TYPE_LABEL, METRIC_MAP, type MetricKey } from "./metrics";

interface PostCardProps {
  row: PostTableRow;
  metric: MetricKey;
  /** Largest value of `metric` across the current set — sizes the performance bar */
  metricMax: number;
  rank?: number;
  isLoadingInsights?: boolean;
}

function CopyIdButton({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  function handleCopy(e: React.MouseEvent) {
    e.preventDefault();
    navigator.clipboard.writeText(id).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }
  return (
    <button
      onClick={handleCopy}
      title="Copy post ID"
      className={clsx(
        "absolute top-1.5 right-1.5 flex items-center gap-1 rounded-md bg-black/55 px-1.5 py-1 font-mono text-[9px] text-white/90 backdrop-blur-sm transition-opacity hover:text-[var(--accent-cyan)]",
        copied ? "opacity-100" : "opacity-0 group-hover:opacity-100"
      )}
    >
      {copied ? (
        "Copied!"
      ) : (
        <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-2.5 w-2.5">
          <rect x="4" y="4" width="7" height="7" rx="1" />
          <path d="M8 4V2a1 1 0 0 0-1-1H2a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1h2" />
        </svg>
      )}
    </button>
  );
}

export function PostCard({ row, metric, metricMax, rank, isLoadingInsights }: PostCardProps) {
  const tooNew = isWithin48Hours(row.isoTimestamp);
  const hoursLeft = tooNew ? hoursUntilInsightsAvailable(row.isoTimestamp) : 0;
  const typeLabel = MEDIA_TYPE_LABEL[row.mediaType] ?? row.mediaType;
  const def = METRIC_MAP[metric];
  const value = row[metric];
  const pct = metricMax > 0 ? Math.max((value / metricMax) * 100, 2) : 0;
  const isTop = rank === 1;

  return (
    <Link
      href={`/posts/${row.id}`}
      className={clsx(
        "group relative flex flex-col overflow-hidden rounded-xl border bg-[var(--bg-card)] transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--accent-cyan)]/60 hover:shadow-[0_8px_24px_-12px_rgba(var(--accent-cyan-rgb),0.45)]",
        isTop ? "border-[var(--accent-cyan)]/40" : "border-[var(--border)]"
      )}
    >
      {/* Thumbnail */}
      <div className="relative aspect-square overflow-hidden bg-[var(--border)]">
        {row.thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={row.thumbnail}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xl text-[var(--text-muted)]">
            ▶
          </div>
        )}
        <span className="absolute left-1.5 top-1.5 rounded bg-black/55 px-1.5 py-0.5 font-mono text-[9px] font-medium uppercase tracking-wider text-white backdrop-blur-sm">
          {typeLabel}
        </span>
        {rank !== undefined && rank <= 3 && (
          <span
            className={clsx(
              "absolute bottom-1.5 left-1.5 flex h-5 w-5 items-center justify-center rounded-md font-mono text-[10px] font-bold backdrop-blur-sm",
              rank === 1
                ? "bg-[var(--accent-cyan)] text-[var(--bg-base)]"
                : "bg-black/60 text-white"
            )}
          >
            {rank}
          </span>
        )}
        <CopyIdButton id={row.id} />
      </div>

      {/* Content */}
      <div className="flex flex-col gap-1.5 p-2">
        <p className="line-clamp-1 text-[11px] leading-tight text-[var(--text-primary)]">
          {row.caption || <span className="italic text-[var(--text-muted)]">No caption</span>}
        </p>

        {tooNew ? (
          <p className="font-mono text-[9px] text-[var(--accent-amber)]">Insights in ~{hoursLeft}h</p>
        ) : isLoadingInsights ? (
          <div className="h-2.5 w-full animate-pulse rounded bg-[var(--border)]" />
        ) : (
          <div className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between font-mono">
              <span className="flex items-center gap-1 text-[10px] text-[var(--text-muted)]">
                <span>{def.glyph}</span>
                {def.short}
              </span>
              <span className="text-[12px] font-medium text-[var(--text-primary)]">
                {def.format(value)}
              </span>
            </div>
            {/* Performance bar — relative to top post in current set */}
            <div className="h-1 w-full overflow-hidden rounded-full bg-[var(--border)]">
              <div
                className={clsx(
                  "h-full rounded-full bg-[var(--accent-cyan)] transition-all duration-500",
                  !isTop && "opacity-80"
                )}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </Link>
  );
}
