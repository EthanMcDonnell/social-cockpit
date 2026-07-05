"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PostListItem } from "@/lib/posts";
import type { PostsSummary } from "@/lib/cache/store";

interface PostsResponse {
  data: PostListItem[];
  paging: { limit: number; nextCursor: string | null; next: string | null };
}

async function fetchAllPosts(mediaType?: string): Promise<PostListItem[]> {
  const params = new URLSearchParams({ all: "true" });
  if (mediaType) params.set("mediaType", mediaType);
  const res = await fetch(`/api/posts?${params}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? "Failed to load posts");
  }
  const body: PostsResponse = await res.json();
  return body.data;
}

// Loads the full post catalog (insights embedded) from the cache in one cheap
// call — the posts page ranks across every post, so it needs them all.
export function useAllPosts(mediaType?: string) {
  return useQuery({
    queryKey: ["posts", "all", mediaType ?? "ALL"],
    queryFn: () => fetchAllPosts(mediaType),
    staleTime: 5 * 60 * 1000,
  });
}

// Forces the server to re-fetch the media list from Meta (bypassing the cache
// TTL), then invalidates the client query cache so the UI reloads the fresh
// data. Used by the "Refresh" button on the posts page.
export function useRefreshPosts() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/posts?refresh=true&limit=1");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? "Failed to refresh posts");
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["posts"] }),
  });
}

async function fetchPostsSummary(mediaType?: string): Promise<PostsSummary> {
  const params = new URLSearchParams();
  if (mediaType) params.set("mediaType", mediaType);
  const res = await fetch(`/api/posts/summary?${params}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? "Failed to load posts summary");
  }
  return res.json();
}

export function usePostsSummary(mediaType?: string) {
  return useQuery({
    queryKey: ["posts", "summary", mediaType ?? "ALL"],
    queryFn: () => fetchPostsSummary(mediaType),
    staleTime: 5 * 60 * 1000,
  });
}
