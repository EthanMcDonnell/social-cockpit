"use client";

import { useState } from "react";
import { clsx } from "clsx";
import { useMedia } from "@/hooks/useMedia";
import { PostList } from "@/components/inbox/PostList";
import { CommentThread, CommentThreadHeader } from "@/components/inbox/CommentThread";

export function InboxClient() {
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);

  const { data: mediaData, isLoading: mediaLoading } = useMedia({ all: true });
  const posts = mediaData?.data ?? [];

  function handleSelect(postId: string) {
    setSelectedPostId(postId);
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Post list sidebar */}
      <div className={clsx(
        "border-r border-[var(--border)] flex flex-col overflow-hidden shrink-0",
        "w-full md:w-72",
        selectedPostId ? "hidden md:flex" : "flex"
      )}>
        <div className="h-12 px-4 flex items-center border-b border-[var(--border)]">
          <h2 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-widest">Posts</h2>
        </div>
        <div className="flex-1 overflow-y-auto">
          <PostList
            posts={posts}
            selectedPostId={selectedPostId}
            onSelect={handleSelect}
            loading={mediaLoading}
          />
        </div>
      </div>

      {/* Main panel */}
      {selectedPostId ? (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Unified top bar — same h-12 as sidebar header */}
          <div className="h-12 px-4 border-b border-[var(--border)] flex items-center gap-3 shrink-0">
            <button
              onClick={() => setSelectedPostId(null)}
              className="md:hidden text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            >
              ← Posts
            </button>
            <CommentThreadHeader postId={selectedPostId} />
          </div>

          <div className="flex-1 overflow-hidden flex flex-col">
            <CommentThread postId={selectedPostId} />
          </div>
        </div>
      ) : (
        <div className="hidden md:flex flex-1 items-center justify-center text-xs text-[var(--text-muted)]">
          Select a post to view comments
        </div>
      )}
    </div>
  );
}
