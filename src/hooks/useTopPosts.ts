"use client";

import { useQueries } from "@tanstack/react-query";
import { useMedia } from "./useMedia";
import { useProfile } from "./useProfile";
import type { MediaInsights } from "@/lib/instagram/types";
import { mediaWithInsightsToRanked } from "@/lib/data/transforms";
import { rankPostsByEngagement } from "@/lib/data/calculations";

async function fetchMediaInsights(mediaId: string): Promise<MediaInsights> {
  const res = await fetch(`/api/instagram/media/${mediaId}/insights`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? "Failed to fetch media insights");
  }
  return res.json();
}

/**
 * Fetches the top N posts by engagement rate.
 * Fan-out: fetches insights for each media item in parallel.
 */
export function useTopPosts(limit = 5) {
  const mediaQuery = useMedia({ limit: 20 });
  const profileQuery = useProfile();
  const mediaList = mediaQuery.data?.data ?? [];

  const insightQueries = useQueries({
    queries: mediaList.map((media) => ({
      queryKey: ["instagram", "media", media.id, "insights"],
      queryFn: () => fetchMediaInsights(media.id),
      staleTime: 15 * 60 * 1000,
      enabled: mediaList.length > 0,
    })),
  });

  const allInsightsLoaded = insightQueries.every((q) => !q.isLoading);
  const insightsMap = new Map<string, MediaInsights>();
  insightQueries.forEach((q, i) => {
    if (q.data && mediaList[i]) {
      insightsMap.set(mediaList[i].id, q.data);
    }
  });

  const followerCount = profileQuery.data?.followers_count;
  const ranked =
    allInsightsLoaded && mediaList.length > 0
      ? rankPostsByEngagement(
          mediaWithInsightsToRanked(mediaList, insightsMap, followerCount),
          limit
        )
      : [];

  return {
    data: ranked,
    isLoading: mediaQuery.isLoading || insightQueries.some((q) => q.isLoading),
    isError:
      mediaQuery.isError || insightQueries.some((q) => q.isError),
    error: mediaQuery.error ?? insightQueries.find((q) => q.error)?.error,
  };
}
