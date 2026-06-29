"use client";

import { useQuery } from "@tanstack/react-query";
import type { Transcript } from "@/lib/transcription/db";

// Fetch a cached transcript. Resolves to null when none exists yet (404).
async function fetchTranscript(mediaId: string): Promise<Transcript | null> {
  const res = await fetch(`/api/transcripts/${mediaId}`);
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? "Failed to load transcript");
  }
  return res.json();
}

export function useTranscript(mediaId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["transcript", mediaId],
    queryFn: () => fetchTranscript(mediaId),
    enabled: enabled && !!mediaId,
    staleTime: Infinity,
    // The background worker fills transcripts in asynchronously. Poll until one
    // appears, then stop — the panel flips to the text automatically.
    refetchInterval: (query) => (query.state.data ? false : 5000),
  });
}
