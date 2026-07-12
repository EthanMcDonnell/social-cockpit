"use client";

import { useQuery } from "@tanstack/react-query";
import type { YoutubeVideo } from "@/lib/youtube/types";

async function fetchVideos(limit: number): Promise<YoutubeVideo[]> {
  const res = await fetch(`/api/youtube/videos?limit=${limit}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? "Failed to fetch YouTube videos");
  }
  const body = await res.json();
  return body.data as YoutubeVideo[];
}

export function useYoutubeVideos(limit = 25, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["youtube", "videos", limit],
    queryFn: () => fetchVideos(limit),
    staleTime: 15 * 60 * 1000,
    enabled: options?.enabled ?? true,
  });
}
