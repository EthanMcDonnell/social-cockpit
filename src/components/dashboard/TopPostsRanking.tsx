"use client";

import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { ErrorState, EmptyState } from "@/components/ui/ErrorState";
import { useTopPosts } from "@/hooks/useTopPosts";
import { formatPercent } from "@/lib/utils/format";
import type { PostWithInsights } from "@/lib/data/calculations";

function PostRankRow({
  post,
  rank,
  maxRate,
}: {
  post: PostWithInsights;
  rank: number;
  maxRate: number;
}) {
  const barPct = maxRate > 0 ? (post.engagementRate / maxRate) * 100 : 0;
  const caption = post.media.caption ?? "";
  const thumbnail = post.media.thumbnail_url ?? post.media.media_url;

  return (
    <Link
      href={`/posts/${post.media.id}`}
      className="flex items-center gap-3 py-2.5 px-4 hover:bg-[var(--bg-base)] transition-colors group"
    >
      {/* Rank number */}
      <span className="font-mono text-xs text-[var(--text-muted)] w-4 shrink-0 text-center">
        {rank}
      </span>

      {/* Thumbnail */}
      {thumbnail ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={thumbnail}
          alt=""
          className="w-9 h-9 rounded object-cover shrink-0"
        />
      ) : (
        <div className="w-9 h-9 rounded bg-[var(--border)] shrink-0" />
      )}

      {/* Caption + bar */}
      <div className="flex-1 min-w-0">
        <p className="text-xs text-[var(--text-primary)] truncate group-hover:text-[var(--accent-cyan)] transition-colors">
          {caption || <span className="italic text-[var(--text-muted)]">No caption</span>}
        </p>
        {/* Relative engagement bar */}
        <div className="mt-1.5 h-1 w-full rounded-full bg-[var(--border)]">
          <div
            className="h-1 rounded-full bg-[var(--accent-cyan)] transition-all duration-300"
            style={{ width: `${barPct}%` }}
          />
        </div>
      </div>

      {/* Engagement rate */}
      <span className="font-mono text-xs text-[var(--accent-cyan)] shrink-0">
        {formatPercent(post.engagementRate)}
      </span>
    </Link>
  );
}

export function TopPostsRanking({ limit = 5 }: { limit?: number }) {
  const { data, isLoading, isError, error } = useTopPosts(limit);

  const maxRate = data.length > 0 ? data[0].engagementRate : 0;

  return (
    <Card padding="none" className="overflow-hidden">
      <div className="px-5 py-4 border-b border-[var(--border)]">
        <p className="text-xs uppercase tracking-widest text-[var(--text-muted)] font-medium">
          Top Posts
        </p>
      </div>

      {isLoading ? (
        <div className="p-4 space-y-3">
          {Array.from({ length: limit }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="h-9 w-9 rounded" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3 w-3/4" />
                <Skeleton className="h-1 w-full" />
              </div>
              <Skeleton className="h-3 w-10" />
            </div>
          ))}
        </div>
      ) : isError ? (
        <ErrorState message={(error as Error)?.message} />
      ) : data.length === 0 ? (
        <EmptyState title="No posts yet" />
      ) : (
        <div className="divide-y divide-[var(--border)]">
          {data.map((post, i) => (
            <PostRankRow
              key={post.media.id}
              post={post}
              rank={i + 1}
              maxRate={maxRate}
            />
          ))}
        </div>
      )}
    </Card>
  );
}
