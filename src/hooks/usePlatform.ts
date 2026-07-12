"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback } from "react";

// Which social platform the dashboard is currently showing. Shared across the
// readout rail and every instrument chart via the ?platform= URL param, mirroring
// usePeriod so the state survives reloads and is linkable.
export type Platform = "ig" | "yt";
export const PLATFORMS: Platform[] = ["ig", "yt"];
const DEFAULT_PLATFORM: Platform = "ig";

export function usePlatform(): [Platform, (p: Platform) => void] {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  const raw = searchParams.get("platform");
  const platform = (PLATFORMS.includes(raw as Platform) ? raw : DEFAULT_PLATFORM) as Platform;

  const setPlatform = useCallback(
    (p: Platform) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("platform", p);
      router.push(`${pathname}?${params.toString()}`);
    },
    [pathname, router, searchParams]
  );

  return [platform, setPlatform];
}
