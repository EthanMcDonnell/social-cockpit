"use client";

import { useQuery } from "@tanstack/react-query";
import type { InstagramProfile } from "@/lib/instagram/types";

async function fetchProfile(): Promise<InstagramProfile> {
  const res = await fetch("/api/instagram/profile");
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? "Failed to fetch profile");
  }
  return res.json();
}

export function useProfile() {
  return useQuery({
    queryKey: ["instagram", "profile"],
    queryFn: fetchProfile,
    staleTime: 15 * 60 * 1000,
  });
}
