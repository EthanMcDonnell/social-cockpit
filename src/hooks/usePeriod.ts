"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback } from "react";

export type PeriodDays = 7 | 30 | 90;
const VALID_PERIODS: PeriodDays[] = [7, 30, 90];
const DEFAULT_PERIOD: PeriodDays = 30;

export function usePeriod(): [PeriodDays, (p: PeriodDays) => void] {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  const raw = Number(searchParams.get("period"));
  const period = (VALID_PERIODS.includes(raw as PeriodDays) ? raw : DEFAULT_PERIOD) as PeriodDays;

  const setPeriod = useCallback(
    (p: PeriodDays) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("period", p.toString());
      router.push(`${pathname}?${params.toString()}`);
    },
    [pathname, router, searchParams]
  );

  return [period, setPeriod];
}
