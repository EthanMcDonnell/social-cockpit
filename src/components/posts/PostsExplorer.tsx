"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { clsx } from "clsx";
import { Skeleton } from "@/components/ui/Skeleton";
import { ErrorState, EmptyState } from "@/components/ui/ErrorState";
import { PostCard } from "./PostCard";
import { PostsTable } from "./PostsTable";
import { PostsCompare } from "./PostsCompare";
import { METRICS, METRIC_MAP, MEDIA_TYPE_LABEL, type MetricKey } from "./metrics";
import { useAllPosts } from "@/hooks/usePosts";
import { useProfile } from "@/hooks/useProfile";
import { mediaWithInsightsToTableRows, type PostTableRow } from "@/lib/data/transforms";
import { formatCount } from "@/lib/utils/format";
import type { InstagramMedia, MediaInsights } from "@/lib/instagram/types";

type View = "grid" | "compare" | "table";
type TypeFilter = "ALL" | string;

// How many rows to render at a time; more are appended as the user scrolls.
const RENDER_PAGE = 24;

const VIEWS: { value: View; label: string; icon: React.ReactNode }[] = [
  {
    value: "grid",
    label: "Grid",
    icon: (
      <svg viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
        <rect x="1" y="1" width="6" height="6" rx="1" />
        <rect x="9" y="1" width="6" height="6" rx="1" />
        <rect x="1" y="9" width="6" height="6" rx="1" />
        <rect x="9" y="9" width="6" height="6" rx="1" />
      </svg>
    ),
  },
  {
    value: "compare",
    label: "Compare",
    icon: (
      <svg viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
        <rect x="1" y="2" width="6" height="3" rx="1" />
        <rect x="1" y="6.5" width="13" height="3" rx="1" />
        <rect x="1" y="11" width="9" height="3" rx="1" />
      </svg>
    ),
  },
  {
    value: "table",
    label: "Table",
    icon: (
      <svg viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
        <rect x="1" y="2" width="14" height="2.5" rx="1" />
        <rect x="1" y="6.75" width="14" height="2.5" rx="1" />
        <rect x="1" y="11.5" width="14" height="2.5" rx="1" />
      </svg>
    ),
  },
];

function ViewToggle({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  return (
    <div className="flex items-center gap-1 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-1">
      {VIEWS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={clsx(
            "flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors",
            view === opt.value
              ? "bg-[var(--accent-cyan)] text-[var(--bg-base)]"
              : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          )}
          aria-pressed={view === opt.value}
        >
          {opt.icon}
          <span className="hidden sm:inline">{opt.label}</span>
        </button>
      ))}
    </div>
  );
}

function StatTile({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] px-3.5 py-3">
      <p className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)]">{label}</p>
      <p
        className={clsx(
          "mt-1 font-mono text-xl font-medium tabular-nums",
          accent ? "text-[var(--accent-cyan)]" : "text-[var(--text-primary)]"
        )}
      >
        {value}
      </p>
      {sub && <div className="mt-0.5 truncate text-[11px] text-[var(--text-muted)]">{sub}</div>}
    </div>
  );
}

export function PostsExplorer() {
  const [view, setView] = useState<View>("table");
  const [metric, setMetric] = useState<MetricKey>("engagementRate");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("ALL");

  const postsQuery = useAllPosts();
  const profileQuery = useProfile();
  const posts = useMemo(() => postsQuery.data ?? [], [postsQuery.data]);

  // Adapt cached PostListItem[] (insights already embedded) into the existing
  // table-row shape — no per-post insights fan-out.
  const { mediaList, insightsMap } = useMemo(() => {
    const list: InstagramMedia[] = [];
    const map = new Map<string, MediaInsights>();
    for (const p of posts) {
      list.push({
        id: p.id,
        caption: p.caption ?? undefined,
        media_type: p.mediaType,
        media_product_type: p.mediaProductType,
        permalink: p.permalink,
        thumbnail_url: p.thumbnailUrl,
        timestamp: p.timestamp,
        like_count: p.likeCount,
        comments_count: p.commentsCount,
        shortcode: p.shortcode,
      });
      if (p.insights) map.set(p.id, p.insights);
    }
    return { mediaList: list, insightsMap: map };
  }, [posts]);

  // All insights arrive together now, so nothing is individually "loading".
  const loadingIds = useMemo(() => new Set<string>(), []);
  const followersCount = profileQuery.data?.followers_count;
  const allRows: PostTableRow[] = useMemo(
    () =>
      mediaList.length > 0
        ? mediaWithInsightsToTableRows(mediaList, insightsMap, followersCount)
        : [],
    [mediaList, insightsMap, followersCount]
  );

  // Media types actually present, for the filter chips
  const presentTypes = useMemo(() => {
    const seen = new Set<string>();
    for (const r of allRows) seen.add(r.mediaType);
    return Array.from(seen);
  }, [allRows]);

  const rows = useMemo(() => {
    const filtered = typeFilter === "ALL" ? allRows : allRows.filter((r) => r.mediaType === typeFilter);
    return [...filtered].sort((a, b) => b[metric] - a[metric]);
  }, [allRows, typeFilter, metric]);

  const def = METRIC_MAP[metric];
  const metricMax = rows.reduce((m, r) => Math.max(m, r[metric]), 0);

  const summary = useMemo(() => {
    if (rows.length === 0) return null;
    const top = rows[0];
    const sum = rows.reduce((s, r) => s + r[metric], 0);
    const avg = sum / rows.length;
    const totalReach = rows.reduce((s, r) => s + r.reach, 0);
    return { top, avg, totalReach };
  }, [rows, metric]);

  // Lazy rendering: render a window of the (globally-ranked) rows, growing as
  // the user scrolls. The full dataset is already loaded, so ranking is correct.
  const [visibleCount, setVisibleCount] = useState(RENDER_PAGE);
  useEffect(() => setVisibleCount(RENDER_PAGE), [typeFilter, metric, view]);
  const visibleRows = useMemo(() => rows.slice(0, visibleCount), [rows, visibleCount]);
  const hasMore = visibleCount < rows.length;
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((c) => Math.min(c + RENDER_PAGE, rows.length));
        }
      },
      { rootMargin: "600px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [rows.length]);

  if (postsQuery.isLoading) {
    return (
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        {Array.from({ length: 18 }).map((_, i) => (
          <div key={i} className="overflow-hidden rounded-xl border border-[var(--border)]">
            <Skeleton className="aspect-square w-full" />
            <div className="space-y-1.5 p-2">
              <Skeleton className="h-2.5 w-full" />
              <Skeleton className="h-2.5 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (postsQuery.isError) {
    return <ErrorState message={(postsQuery.error as Error)?.message} />;
  }

  if (allRows.length === 0) {
    return <EmptyState title="No posts found" message="Your Instagram posts will appear here." />;
  }

  return (
    <div className="space-y-5">
      {/* Summary strip */}
      {summary && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            label="Posts"
            value={rows.length.toString()}
            sub={typeFilter === "ALL" ? "all types" : MEDIA_TYPE_LABEL[typeFilter] ?? typeFilter}
          />
          <StatTile
            label={`Top ${def.label}`}
            accent
            value={def.format(summary.top[metric])}
            sub={
              <span className="flex items-center gap-1.5">
                <span className="opacity-70">▲</span>
                <span className="truncate">{summary.top.caption || "No caption"}</span>
              </span>
            }
          />
          <StatTile
            label={`Avg ${def.label}`}
            value={def.format(summary.avg)}
            sub="across selection"
          />
          <StatTile label="Total Reach" value={formatCount(summary.totalReach)} sub="across selection" />
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Type filter */}
          <div className="flex flex-wrap items-center gap-1.5">
            <FilterChip active={typeFilter === "ALL"} onClick={() => setTypeFilter("ALL")}>
              All
            </FilterChip>
            {presentTypes.map((t) => (
              <FilterChip key={t} active={typeFilter === t} onClick={() => setTypeFilter(t)}>
                {MEDIA_TYPE_LABEL[t] ?? t}
              </FilterChip>
            ))}
          </div>
          <ViewToggle view={view} onChange={setView} />
        </div>

        {/* Rank-by metric selector */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-0.5 font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
            Rank by
          </span>
          {METRICS.map((m) => (
            <button
              key={m.key}
              onClick={() => setMetric(m.key)}
              className={clsx(
                "flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium transition-colors",
                metric === m.key
                  ? "border-[var(--accent-cyan)] bg-[var(--accent-cyan)]/10 text-[var(--accent-cyan)]"
                  : "border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              )}
              aria-pressed={metric === m.key}
            >
              <span className="opacity-70">{m.glyph}</span>
              {m.short}
            </button>
          ))}
        </div>
      </div>

      {/* Views */}
      {rows.length === 0 ? (
        <EmptyState title="No matching posts" message="Try a different media type filter." />
      ) : view === "grid" ? (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {visibleRows.map((row, i) => (
            <PostCard
              key={row.id}
              row={row}
              metric={metric}
              metricMax={metricMax}
              rank={i + 1}
              isLoadingInsights={loadingIds.has(row.id)}
            />
          ))}
        </div>
      ) : view === "compare" ? (
        <PostsCompare rows={visibleRows} metric={metric} loadingIds={loadingIds} />
      ) : (
        <PostsTable rows={visibleRows} metric={metric} loadingIds={loadingIds} />
      )}

      {/* Infinite-scroll sentinel: appends more rows as it scrolls into view */}
      {hasMore && (
        <div ref={sentinelRef} className="flex justify-center py-4">
          <span className="text-[11px] text-[var(--text-muted)]">
            Showing {visibleRows.length} of {rows.length}
          </span>
        </div>
      )}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "rounded-lg px-2.5 py-1 text-xs font-medium transition-colors",
        active
          ? "bg-[var(--text-primary)] text-[var(--bg-base)]"
          : "text-[var(--text-muted)] hover:bg-[var(--bg-card)] hover:text-[var(--text-primary)]"
      )}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}
