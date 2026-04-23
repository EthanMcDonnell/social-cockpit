"use client";

import { useQuery } from "@tanstack/react-query";
import type { TokenState } from "@/lib/token/types";

async function fetchTokenStatus(): Promise<TokenState> {
  const res = await fetch("/api/token/status");
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? "Failed to fetch token status");
  }
  return res.json();
}

export function useTokenStatus() {
  return useQuery({
    queryKey: ["token", "status"],
    queryFn: fetchTokenStatus,
    // Poll every 6 hours — token expiry doesn't change rapidly
    staleTime: 6 * 60 * 60 * 1000,
    refetchInterval: 6 * 60 * 60 * 1000,
  });
}
