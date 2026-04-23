"use client";

import { clsx } from "clsx";
import type { InstagramMedia } from "@/lib/instagram/types";

interface PostListProps {
  posts: InstagramMedia[];
  selectedPostId: string | null;
  onSelect: (id: string) => void;
  loading: boolean;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function PostList({ posts, selectedPostId, onSelect, loading }: PostListProps) {
  if (loading) {
    return (
      <div className="p-3 space-y-1.5">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex gap-3 items-center p-2.5 rounded-xl">
            <div className="w-12 h-12 rounded-xl bg-[var(--border)] animate-pulse shrink-0" />
            <div className="flex-1 space-y-1.5">
              <div className="h-2.5 bg-[var(--border)] rounded-full animate-pulse w-3/4" />
              <div className="h-2 bg-[var(--border)] rounded-full animate-pulse w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (posts.length === 0) {
    return (
      <div className="p-4 text-xs text-[var(--text-muted)] text-center mt-8">
        No posts found
      </div>
    );
  }

  return (
    <div className="p-2 space-y-0.5">
      {posts.map((post) => {
        const isSelected = post.id === selectedPostId;
        const thumb = post.thumbnail_url ?? post.media_url;
        const caption = post.caption?.replace(/\n/g, " ") ?? "(no caption)";

        return (
          <button
            key={post.id}
            onClick={() => onSelect(post.id)}
            className={clsx(
              "w-full flex gap-3 items-center px-3 py-2.5 text-left transition-colors rounded-xl border-l-2",
              isSelected
                ? "bg-[var(--accent-cyan)]/10 text-[var(--text-primary)] border-[var(--accent-cyan)]"
                : "hover:bg-[var(--border)]/40 text-[var(--text-muted)] border-transparent"
            )}
          >
            {thumb ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={thumb}
                alt=""
                className="w-12 h-12 rounded-xl object-cover shrink-0 bg-[var(--border)]"
              />
            ) : (
              <div className="w-12 h-12 rounded-xl bg-[var(--border)] shrink-0 flex items-center justify-center">
                <span className="text-[var(--text-muted)] text-xs">▣</span>
              </div>
            )}

            <div className="flex-1 min-w-0">
              <p className={clsx("text-xs leading-snug truncate", isSelected && "text-[var(--text-primary)]")}>
                {caption.length > 55 ? caption.slice(0, 55) + "…" : caption}
              </p>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[10px] text-[var(--text-muted)]">{formatDate(post.timestamp)}</span>
                {post.comments_count != null && (
                  <span className="text-[10px] text-[var(--text-muted)]">
                    {post.comments_count} comment{post.comments_count !== 1 ? "s" : ""}
                  </span>
                )}
              </div>
            </div>


          </button>
        );
      })}
    </div>
  );
}
