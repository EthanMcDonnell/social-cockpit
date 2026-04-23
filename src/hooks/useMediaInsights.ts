"use client";

import { useQuery } from "@tanstack/react-query";
import type { MediaInsights } from "@/lib/instagram/types";

async function fetchMediaInsights(mediaId: string): Promise<MediaInsights> {
  const res = await fetch(`/api/instagram/media/${mediaId}/insights?flat=true`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    if (res.status === 429 || body.error === "rate_limit") {
      throw new Error(`rate_limit:${body.message ?? "Instagram API rate limit reached"}`);
    }
    throw new Error(body.message ?? "Failed to fetch media insights");
  }
  return res.json();
}

export function useMediaInsights(mediaId: string) {
  return useQuery({
    queryKey: ["instagram", "media", mediaId, "insights"],
    queryFn: () => fetchMediaInsights(mediaId),
    staleTime: 15 * 60 * 1000,
    enabled: !!mediaId,
  });
}
