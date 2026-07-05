"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { clsx } from "clsx";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import type { PostTableRow } from "@/lib/data/transforms";
import { MEDIA_TYPE_LABEL, METRICS, METRIC_MAP, type MetricKey } from "./metrics";
import { useTranscript } from "@/hooks/useTranscript";
import { useTranscriptionSetting } from "@/hooks/useTranscriptionSetting";

function InlineTranscript({ mediaId, mediaType }: { mediaId: string; mediaType: string }) {
  const settingQuery = useTranscriptionSetting();
  const enabled = settingQuery.data === true;
  const isVideo = mediaType === "VIDEO" || mediaType === "REEL";
  const transcriptQuery = useTranscript(mediaId, enabled && isVideo);

  if (!enabled || !isVideo) return null;

  const transcript = transcriptQuery.data;

  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Script</p>
      <div className="mt-1">
        {transcriptQuery.isLoading ? (
          <div className="space-y-1.5">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-2.5 w-full" />
            ))}
          </div>
        ) : transcript ? (
          <p className="text-sm leading-relaxed text-[var(--text-primary)] whitespace-pre-wrap">
            {transcript.text || (
              <span className="italic text-[var(--text-muted)]">No speech detected.</span>
            )}
          </p>
        ) : (
          <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
            Queued for transcription…
          </div>
        )}
      </div>
    </div>
  );
}

type SortKey = MetricKey | "timestamp";

interface PostsTableProps {
  rows: PostTableRow[];
  metric: MetricKey;
  /** Active sort from the explorer; "recent" maps to the Post (date) column */
  sort: MetricKey | "recent";
  loadingIds: Set<string>;
}

/** Compact secondary metrics shown inline on each large row (excludes active) */
const SECONDARY_KEYS: MetricKey[] = ["likes", "comments", "reach", "engagementRate"];

export function PostsTable({ rows, metric, sort, loadingIds }: PostsTableProps) {
  const activeSort: SortKey = sort === "recent" ? "timestamp" : sort;
  const [sortKey, setSortKey] = useState<SortKey>(activeSort);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    setSortKey(activeSort);
    setSortDir("desc");
  }, [activeSort]);

  function handleSort(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const max = rows.reduce((m, r) => Math.max(m, r[metric]), 0);
  const def = METRIC_MAP[metric];
  const secondaries = SECONDARY_KEYS.filter((k) => k !== metric).map((k) => METRIC_MAP[k]);

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      if (sortKey === "timestamp") {
        return sortDir === "asc"
          ? a.isoTimestamp.localeCompare(b.isoTimestamp)
          : b.isoTimestamp.localeCompare(a.isoTimestamp);
      }
      return sortDir === "asc" ? a[sortKey] - b[sortKey] : b[sortKey] - a[sortKey];
    });
  }, [rows, sortKey, sortDir]);

  const arrow = (key: SortKey) => (sortKey === key ? (sortDir === "asc" ? "↑" : "↓") : "");

  return (
    <Card padding="none" className="overflow-hidden">
      {/* Sort / header bar */}
      <div className="flex items-center gap-3 border-b border-[var(--border)] bg-[var(--bg-base)]/40 px-4 py-2.5">
        <span className="w-7 shrink-0 text-center font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
          #
        </span>
        <button
          onClick={() => handleSort("timestamp")}
          className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
        >
          Post {arrow("timestamp")}
        </button>
        <div className="ml-auto flex items-center gap-1.5">
          {METRICS.map((col) => (
            <button
              key={col.key}
              onClick={() => handleSort(col.key)}
              className={clsx(
                "rounded-md px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors",
                sortKey === col.key
                  ? "bg-[var(--accent-cyan)]/15 text-[var(--accent-cyan)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              )}
            >
              {col.short} {arrow(col.key)}
            </button>
          ))}
        </div>
      </div>

      <ul className="divide-y divide-[var(--border)]">
        {sorted.map((row, idx) => {
          const rank = idx + 1;
          const value = row[metric];
          const pct = max > 0 ? Math.max((value / max) * 100, 1.5) : 0;
          const isLoading = loadingIds.has(row.id);
          const isOpen = expanded === row.id;

          return (
            <li key={row.id}>
              {/* Main row — clickable to expand */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => setExpanded(isOpen ? null : row.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setExpanded(isOpen ? null : row.id);
                  }
                }}
                className={clsx(
                  "group flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors",
                  isOpen ? "bg-[var(--bg-base)]" : "hover:bg-[var(--bg-base)]"
                )}
              >
                {/* Rank */}
                <span
                  className={clsx(
                    "w-7 shrink-0 text-center font-mono text-sm tabular-nums",
                    rank === 1
                      ? "font-bold text-[var(--accent-cyan)]"
                      : rank <= 3
                        ? "font-semibold text-[var(--text-primary)]"
                        : "text-[var(--text-muted)]"
                  )}
                >
                  {rank}
                </span>

                {/* Thumbnail */}
                <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-[var(--border)]">
                  {row.thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={row.thumbnail} alt="" loading="lazy" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-base text-[var(--text-muted)]">
                      ▶
                    </div>
                  )}
                </div>

                {/* Caption + meta */}
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-1 text-sm text-[var(--text-primary)]">
                    {row.caption || <span className="italic text-[var(--text-muted)]">No caption</span>}
                  </p>
                  <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                    {MEDIA_TYPE_LABEL[row.mediaType] ?? row.mediaType} · {row.timestamp}
                  </p>
                </div>

                {/* Secondary metrics (md+) */}
                <div className="hidden shrink-0 items-center gap-5 md:flex">
                  {secondaries.map((s) => (
                    <div key={s.key} className="w-14 text-right">
                      <p className="font-mono text-[9px] uppercase tracking-wider text-[var(--text-muted)]/70">
                        {s.short}
                      </p>
                      <p className="font-mono text-xs tabular-nums text-[var(--text-muted)]">
                        {isLoading ? "—" : s.format(row[s.key])}
                      </p>
                    </div>
                  ))}
                </div>

                {/* Active metric — value + bar */}
                <div className="flex w-44 shrink-0 flex-col items-end gap-1.5">
                  <div className="flex items-baseline gap-1.5">
                    <span className="font-mono text-[9px] uppercase tracking-wider text-[var(--text-muted)]/70">
                      {def.short}
                    </span>
                    <span className="font-mono text-base font-semibold tabular-nums text-[var(--text-primary)]">
                      {isLoading ? "—" : def.format(value)}
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--border)]">
                    <div
                      className={clsx(
                        "h-full rounded-full bg-[var(--accent-cyan)] transition-all duration-700 ease-out",
                        rank !== 1 && "opacity-75"
                      )}
                      style={{ width: isLoading ? "0%" : `${pct}%` }}
                    />
                  </div>
                </div>

                {/* Chevron */}
                <svg
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.75}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={clsx(
                    "h-4 w-4 shrink-0 text-[var(--text-muted)] transition-transform duration-200",
                    isOpen && "rotate-90 text-[var(--accent-cyan)]"
                  )}
                >
                  <path d="M6 4l4 4-4 4" />
                </svg>
              </div>

              {/* Expanded detail */}
              {isOpen && (
                <div className="border-t border-[var(--border)] bg-[var(--bg-base)]/60 px-4 py-4">
                  <div className="grid gap-4 md:grid-cols-[1fr_auto]">
                    <div className="min-w-0 space-y-3">
                      <div>
                        <p className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                          Caption
                        </p>
                        <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--text-primary)]">
                          {row.caption || <span className="italic text-[var(--text-muted)]">No caption</span>}
                        </p>
                      </div>
                      <InlineTranscript mediaId={row.id} mediaType={row.mediaType} />
                    </div>

                    {/* All metrics */}
                    <div className="grid grid-cols-4 gap-x-5 gap-y-3 self-start md:grid-cols-2 lg:grid-cols-4">
                      {METRICS.map((m) => (
                        <div key={m.key} className="text-right">
                          <p className="font-mono text-[9px] uppercase tracking-wider text-[var(--text-muted)]/70">
                            {m.glyph} {m.short}
                          </p>
                          <p
                            className={clsx(
                              "font-mono text-sm tabular-nums",
                              m.key === metric
                                ? "font-semibold text-[var(--accent-cyan)]"
                                : "text-[var(--text-primary)]"
                            )}
                          >
                            {isLoading ? "—" : m.format(row[m.key])}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="mt-4 flex justify-end">
                    <Link
                      href={`/posts/${row.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-cyan)] px-3 py-1.5 text-xs font-medium text-[var(--bg-base)] transition-opacity hover:opacity-90"
                    >
                      Open full post
                      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-3.5 w-3.5">
                        <path d="M6 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </Link>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
