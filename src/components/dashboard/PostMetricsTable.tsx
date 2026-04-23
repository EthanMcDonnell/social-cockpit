"use client";

import { useState } from "react";
import { useQueries } from "@tanstack/react-query";
import Link from "next/link";
import { clsx } from "clsx";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { ErrorState, EmptyState } from "@/components/ui/ErrorState";
import { useMedia } from "@/hooks/useMedia";
import { useProfile } from "@/hooks/useProfile";
import { mediaWithInsightsToTableRows, type PostTableRow } from "@/lib/data/transforms";
import { formatCount, formatPercent } from "@/lib/utils/format";
import type { MediaInsights } from "@/lib/instagram/types";

type SortKey = keyof Pick<
  PostTableRow,
  "timestamp" | "likes" | "comments" | "shares" | "saves" | "reach" | "views" | "engagementRate"
>;

interface Column {
  key: SortKey;
  label: string;
  format: (v: number) => string;
}

const COLUMNS: Column[] = [
  { key: "likes", label: "Likes", format: formatCount },
  { key: "comments", label: "Comments", format: formatCount },
  { key: "shares", label: "Shares", format: formatCount },
  { key: "saves", label: "Saves", format: formatCount },
  { key: "reach", label: "Reach", format: formatCount },
  { key: "views", label: "Views", format: formatCount },
  { key: "engagementRate", label: "Eng. Rate", format: (v) => formatPercent(v) },
];

async function fetchInsights(mediaId: string): Promise<MediaInsights> {
  const res = await fetch(`/api/instagram/media/${mediaId}/insights?flat=true`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    if (res.status === 429 || body.error === "rate_limit") {
      throw new Error(`rate_limit:${body.message ?? "Instagram API rate limit reached"}`);
    }
    throw new Error(body.message ?? "Failed to fetch insights");
  }
  return res.json();
}

export function PostMetricsTable() {
  const mediaQuery = useMedia({ limit: 30 });
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

  const insightsMap = new Map<string, MediaInsights>();
  const loadingIds = new Set<string>();
  insightQueries.forEach((q, i) => {
    const media = mediaList[i];
    if (!media) return;
    if (q.data) insightsMap.set(media.id, q.data);
    if (q.isPending) loadingIds.add(media.id);
  });

  const rows = mediaList.length > 0
    ? mediaWithInsightsToTableRows(
        mediaList,
        insightsMap,
        profileQuery.data?.followers_count
      )
    : [];

  const [sortKey, setSortKey] = useState<SortKey>("engagementRate");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const sorted = [...rows].sort((a, b) => {
    if (sortKey === "timestamp") {
      return sortDir === "asc"
        ? a.isoTimestamp.localeCompare(b.isoTimestamp)
        : b.isoTimestamp.localeCompare(a.isoTimestamp);
    }
    const av = a[sortKey] as number;
    const bv = b[sortKey] as number;
    return sortDir === "asc" ? av - bv : bv - av;
  });

  const isLoading = mediaQuery.isLoading;

  return (
    <Card padding="none" className="overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
        <p className="text-xs uppercase tracking-widest text-[var(--text-muted)] font-medium">
          Post Metrics
        </p>
        <p className="text-xs text-[var(--text-muted)] font-mono">
          {rows.length} posts
        </p>
      </div>
      {isLoading ? (
        <div className="p-5 space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : mediaQuery.isError ? (
        <ErrorState message={(mediaQuery.error as Error)?.message} />
      ) : rows.length === 0 ? (
        <EmptyState title="No posts found" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th className="px-4 py-3 text-left font-medium text-[var(--text-muted)] w-8" />
                <th className="px-4 py-3 text-left font-medium text-[var(--text-muted)] min-w-[140px]">
                  Post
                </th>
                <th
                  className="px-3 py-3 text-center font-medium text-[var(--text-muted)] cursor-pointer hover:text-[var(--text-primary)] whitespace-nowrap"
                  onClick={() => handleSort("timestamp")}
                >
                  Date{sortKey === "timestamp" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                </th>
                {COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    className={clsx(
                      "px-3 py-3 text-right font-medium cursor-pointer hover:text-[var(--text-primary)] whitespace-nowrap",
                      sortKey === col.key
                        ? "text-[var(--accent-cyan)]"
                        : "text-[var(--text-muted)]"
                    )}
                    onClick={() => handleSort(col.key)}
                  >
                    {col.label}
                    {sortKey === col.key ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((row, idx) => (
                <tr
                  key={row.id}
                  className={clsx(
                    "border-b border-[var(--border)] hover:bg-[var(--bg-base)] transition-colors",
                    idx % 2 === 1 && "bg-[var(--bg-base)]/40"
                  )}
                >
                  <td className="px-4 py-3 text-center">
                    {row.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={row.thumbnail}
                        alt=""
                        className="w-8 h-8 rounded object-cover"
                      />
                    ) : (
                      <div className="w-8 h-8 rounded bg-[var(--border)]" />
                    )}
                  </td>
                  <td className="px-4 py-3 max-w-[180px]">
                    <Link
                      href={`/posts/${row.id}`}
                      className="text-[var(--text-primary)] hover:text-[var(--accent-cyan)] transition-colors line-clamp-2"
                    >
                      {row.caption || <span className="text-[var(--text-muted)] italic">No caption</span>}
                    </Link>
                    <p className="text-[var(--text-muted)] mt-0.5 uppercase text-[10px] tracking-wider">
                      {row.mediaType}
                    </p>
                  </td>
                  <td className="px-3 py-3 text-center font-mono text-[var(--text-muted)]">
                    {row.timestamp}
                  </td>
                  {COLUMNS.map((col) => (
                    <td
                      key={col.key}
                      className={clsx(
                        "px-3 py-3 text-right font-mono",
                        sortKey === col.key
                          ? "text-[var(--text-primary)]"
                          : "text-[var(--text-muted)]"
                      )}
                    >
                      {loadingIds.has(row.id) ? (
                        <div className="animate-pulse h-3 w-10 rounded bg-[var(--border)] ml-auto" />
                      ) : (
                        col.format(row[col.key] as number)
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
