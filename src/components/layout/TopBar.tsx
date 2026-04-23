"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTheme } from "next-themes";
import { clsx } from "clsx";
import { useEffect, useState, Suspense } from "react";

const PERIODS = [
  { label: "7d", value: "7" },
  { label: "30d", value: "30" },
  { label: "90d", value: "90" },
];

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return <div className="w-9 h-9" />;
  }

  const isDark = theme === "dark";

  return (
    <button
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="w-9 h-9 flex items-center justify-center rounded-xl text-text-muted hover:text-text-primary hover:bg-bg-card transition-colors"
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {isDark ? (
        // Sun icon
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-5 h-5"
        >
          <circle cx="12" cy="12" r="5" />
          <line x1="12" y1="1" x2="12" y2="3" />
          <line x1="12" y1="21" x2="12" y2="23" />
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
          <line x1="1" y1="12" x2="3" y2="12" />
          <line x1="21" y1="12" x2="23" y2="12" />
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
        </svg>
      ) : (
        // Moon icon
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-5 h-5"
        >
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )}
    </button>
  );
}

function PeriodSelector() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentPeriod = searchParams.get("period") ?? "30";

  function selectPeriod(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("period", value);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex items-center gap-1 bg-bg-card border border-border rounded-xl p-1">
      {PERIODS.map(({ label, value }) => (
        <button
          key={value}
          onClick={() => selectPeriod(value)}
          className={clsx(
            "px-3 py-1 rounded-lg text-xs font-mono font-medium transition-colors",
            currentPeriod === value
              ? "bg-accent-cyan text-bg-base"
              : "text-text-muted hover:text-text-primary"
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export interface TopBarProps {
  title: string;
  showPeriodSelector?: boolean;
}

export function TopBar({ title, showPeriodSelector = false }: TopBarProps) {
  return (
    <header className="h-14 flex items-center justify-between px-6 border-b border-border bg-bg-base flex-shrink-0">
      <h1 className="font-heading text-xl font-bold text-text-primary">
        {title}
      </h1>
      <div className="flex items-center gap-3">
        {showPeriodSelector && (
          <Suspense fallback={<div className="h-8 w-32" />}>
            <PeriodSelector />
          </Suspense>
        )}
        <ThemeToggle />
      </div>
    </header>
  );
}
