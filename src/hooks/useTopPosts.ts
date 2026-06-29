"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useProfile } from "./useProfile";
import type { PostListItem } from "@/lib/posts";
import type { InstagramMedia, MediaInsights } from "@/lib/instagram/types";
import { mediaWithInsightsToRanked } from "@/lib/data/transforms";
import { rankPostsByEngagement } from "@/lib/data/calculations";

// Pull the most recent posts (insights embedded from cache — no per-post
// fan-out) and rank them by engagement rate client-side.
const SOURCE_LIMIT = 20;

async function fetchRecentPosts(): Promise<PostListItem[]> {
  const res = await fetch(`/api/posts?limit=${SOURCE_LIMIT}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? "Failed to fetch posts");
  }
  const body = await res.json();
  return body.data as PostListItem[];
}

/**
 * Top N posts by engagement rate. Sourced from the local Meta cache in a single
 * request (insights embedded), replacing the previous per-post insights fan-out.
 */
export function useTopPosts(limit = 5) {
  const postsQuery = useQuery({
    queryKey: ["posts", "recent", SOURCE_LIMIT],
    queryFn: fetchRecentPosts,
    staleTime: 15 * 60 * 1000,
  });
  const profileQuery = useProfile();
  const followerCount = profileQuery.data?.followers_count;

  const ranked = useMemo(() => {
    const posts = postsQuery.data ?? [];
    if (posts.length === 0) return [];

    const mediaList: InstagramMedia[] = [];
    const insightsMap = new Map<string, MediaInsights>();
    for (const p of posts) {
      mediaList.push({
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
      if (p.insights) insightsMap.set(p.id, p.insights);
    }

    return rankPostsByEngagement(
      mediaWithInsightsToRanked(mediaList, insightsMap, followerCount),
      limit
    );
  }, [postsQuery.data, followerCount, limit]);

  return {
    data: ranked,
    isLoading: postsQuery.isLoading,
    isError: postsQuery.isError,
    error: postsQuery.error,
  };
}
