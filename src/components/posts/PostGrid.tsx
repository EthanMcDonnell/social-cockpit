"use client";

import { useQueries } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/Skeleton";
import { ErrorState, EmptyState } from "@/components/ui/ErrorState";
import { PostCard } from "./PostCard";
import { useMedia } from "@/hooks/useMedia";
import type { MediaInsights } from "@/lib/instagram/types";

async function fetchInsights(mediaId: string): Promise<MediaInsights> {
  const res = await fetch(`/api/instagram/media/${mediaId}/insights?flat=true`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? "Failed to fetch insights");
  }
  return res.json();
}

export function PostGrid() {
  const mediaQuery = useMedia({ all: true });
  const mediaList = mediaQuery.data?.data ?? [];

  const insightQueries = useQueries({
    queries: mediaList.map((m) => ({
      queryKey: ["instagram", "media", m.id, "insights"],
      queryFn: () => fetchInsights(m.id),
      staleTime: 15 * 60 * 1000,
      enabled: mediaList.length > 0,
    })),
  });

  if (mediaQuery.isLoading) {
    return (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-[var(--border)] overflow-hidden">
            <Skeleton className="aspect-square w-full" />
            <div className="p-3 space-y-1.5">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-3/4" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (mediaQuery.isError) {
    return <ErrorState message={(mediaQuery.error as Error)?.message} />;
  }

  if (mediaList.length === 0) {
    return <EmptyState title="No posts found" message="Your Instagram posts will appear here." />;
  }

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {mediaList.map((media, i) => {
        const insightQuery = insightQueries[i];
        return (
          <PostCard
            key={media.id}
            media={media}
            insights={insightQuery?.data}
            isLoadingInsights={insightQuery?.isLoading}
          />
        );
      })}
    </div>
  );
}
