"use client";

import { useQuery } from "@tanstack/react-query";
import type { YoutubeConnectionStatus } from "@/app/api/youtube/oauth/status/route";

async function fetchYoutubeStatus(): Promise<YoutubeConnectionStatus> {
  const res = await fetch("/api/youtube/oauth/status");
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? "Failed to fetch YouTube status");
  }
  return res.json();
}

export function useYoutubeStatus() {
  return useQuery({
    queryKey: ["youtube", "oauth", "status"],
    queryFn: fetchYoutubeStatus,
    staleTime: 5 * 60 * 1000,
  });
}
