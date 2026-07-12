"use client";

import { useQuery } from "@tanstack/react-query";
import type { YoutubeChannelStats } from "@/lib/youtube/types";

async function fetchChannel(): Promise<YoutubeChannelStats> {
  const res = await fetch("/api/youtube/channel");
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? "Failed to fetch YouTube channel");
  }
  return res.json();
}

export function useYoutubeChannel(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["youtube", "channel"],
    queryFn: fetchChannel,
    staleTime: 15 * 60 * 1000,
    enabled: options?.enabled ?? true,
  });
}
