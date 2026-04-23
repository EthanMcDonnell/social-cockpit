"use client";

import { useQuery } from "@tanstack/react-query";
import type { MediaListResponse, InstagramMedia } from "@/lib/instagram/types";

async function fetchMedia(limit?: number, all?: boolean): Promise<MediaListResponse> {
  const params = new URLSearchParams();
  if (limit !== undefined) params.set("limit", limit.toString());
  if (all) params.set("all", "true");
  const res = await fetch(`/api/instagram/media?${params}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? "Failed to fetch media");
  }
  return res.json();
}

export function useMedia(options?: { limit?: number; all?: boolean }) {
  const { limit, all } = options ?? {};
  return useQuery({
    queryKey: ["instagram", "media", { limit, all }],
    queryFn: () => fetchMedia(limit, all),
    staleTime: 15 * 60 * 1000,
  });
}

async function fetchSingleMedia(id: string): Promise<InstagramMedia> {
  const res = await fetch(`/api/instagram/media/${id}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? "Failed to fetch media");
  }
  return res.json();
}

export function useSingleMedia(id: string) {
  return useQuery({
    queryKey: ["instagram", "media", id],
    queryFn: () => fetchSingleMedia(id),
    staleTime: 15 * 60 * 1000,
    enabled: !!id,
  });
}
