"use client";

import Link from "next/link";
import { clsx } from "clsx";
import { Card } from "@/components/ui/Card";
import { formatCount } from "@/lib/utils/format";
import type { PostTableRow } from "@/lib/data/transforms";
import { MEDIA_TYPE_LABEL, METRIC_MAP, METRICS, type MetricKey } from "./metrics";

interface PostsCompareProps {
  /** Already sorted descending by `metric` */
  rows: PostTableRow[];
  metric: MetricKey;
  loadingIds: Set<string>;
}

/** Secondary metrics shown as small context numbers (excludes the active one) */
function secondaryFor(metric: MetricKey) {
  return METRICS.filter(
    (m) => m.key !== metric && ["likes", "comments", "reach", "engagementRate"].includes(m.key)
  ).slice(0, 3);
}

export function PostsCompare({ rows, metric, loadingIds }: PostsCompareProps) {
  const def = METRIC_MAP[metric];
  const max = rows.reduce((m, r) => Math.max(m, r[metric]), 0);
  const secondaries = secondaryFor(metric);

  return (
    <Card padding="none" className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-2.5">
        <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
          Ranked by {def.label}
        </span>
        <span className="font-mono text-[10px] text-[var(--text-muted)]">
          peak {def.format(max)}
        </span>
      </div>

      <ul className="divide-y divide-[var(--border)]">
        {rows.map((row, idx) => {
          const value = row[metric];
          const pct = max > 0 ? Math.max((value / max) * 100, 1.5) : 0;
          const rank = idx + 1;
          const isLoading = loadingIds.has(row.id);
          return (
            <li key={row.id}>
              <Link
                href={`/posts/${row.id}`}
                className="group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-[var(--bg-base)]"
              >
                {/* Rank */}
                <span
                  className={clsx(
                    "w-6 shrink-0 text-right font-mono text-sm tabular-nums",
                    rank === 1
                      ? "font-bold text-[var(--accent-cyan)]"
                      : rank <= 3
                        ? "font-semibold text-[var(--text-primary)]"
                        : "text-[var(--text-muted)]"
                  )}
                >
                  {rank}
                </span>

                {/* Thumb */}
                <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-md bg-[var(--border)]">
                  {row.thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={row.thumbnail} alt="" loading="lazy" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-xs text-[var(--text-muted)]">
                      ▶
                    </div>
                  )}
                </div>

                {/* Caption + meta */}
                <div className="hidden min-w-0 basis-48 shrink-0 sm:block">
                  <p className="line-clamp-1 text-xs text-[var(--text-primary)] transition-colors group-hover:text-[var(--accent-cyan)]">
                    {row.caption || <span className="italic text-[var(--text-muted)]">No caption</span>}
                  </p>
                  <p className="mt-0.5 font-mono text-[10px] text-[var(--text-muted)]">
                    {MEDIA_TYPE_LABEL[row.mediaType] ?? row.mediaType} · {row.timestamp}
                  </p>
                </div>

                {/* Bar */}
                <div className="flex flex-1 items-center gap-3">
                  <div className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-[var(--border)]">
                    <div
                      className={clsx(
                        "h-full rounded-full bg-[var(--accent-cyan)] transition-all duration-700 ease-out",
                        rank !== 1 && "opacity-75 group-hover:opacity-100"
                      )}
                      style={{ width: isLoading ? "0%" : `${pct}%` }}
                    />
                  </div>
                  <span className="w-16 shrink-0 text-right font-mono text-sm font-medium tabular-nums text-[var(--text-primary)]">
                    {isLoading ? (
                      <span className="ml-auto block h-3 w-10 animate-pulse rounded bg-[var(--border)]" />
                    ) : (
                      def.format(value)
                    )}
                  </span>
                </div>

                {/* Secondary context metrics */}
                <div className="hidden shrink-0 items-center gap-4 lg:flex">
                  {secondaries.map((s) => (
                    <span key={s.key} className="flex w-16 items-center justify-end gap-1 font-mono text-[11px] text-[var(--text-muted)]">
                      <span className="opacity-70">{s.glyph}</span>
                      {isLoading ? "—" : s.format(row[s.key])}
                    </span>
                  ))}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>

      {rows.length > 0 && (
        <div className="border-t border-[var(--border)] px-4 py-2 text-right font-mono text-[10px] text-[var(--text-muted)]">
          {rows.length} posts · total {def.key === "engagementRate" ? "avg " : ""}
          {def.key === "engagementRate"
            ? def.format(rows.reduce((s, r) => s + r[metric], 0) / rows.length)
            : formatCount(rows.reduce((s, r) => s + r[metric], 0))}
        </div>
      )}
    </Card>
  );
}
