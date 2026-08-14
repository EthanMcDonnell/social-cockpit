"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";
import { RadarScope } from "./RadarScope";
import { usePeriod, type PeriodDays } from "@/hooks/usePeriod";
import { usePlatform } from "@/hooks/usePlatform";

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/posts", label: "Posts" },
  { href: "/compose", label: "Compose" },
  { href: "/calendar", label: "Calendar" },
  { href: "/automations", label: "Automations" },
  { href: "/inbox", label: "Inbox" },
];

const WINDOWS: PeriodDays[] = [7, 30, 90];

function formatToday(): string {
  return new Date()
    .toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "2-digit",
      year: "numeric",
    })
    .toUpperCase();
}

function WindowSelector() {
  const [period, setPeriod] = usePeriod();
  return (
    <span className="ck-window">
      {WINDOWS.map((w) => (
        <button
          key={w}
          type="button"
          className={w === period ? "on" : undefined}
          onClick={() => setPeriod(w)}
        >
          {w}D
        </button>
      ))}
    </span>
  );
}

function SettingsGlyph({ size = 15 }: { size?: number }) {
  return (
    // A cog, not a sun. The previous glyph was a circle with eight straight
    // radiating spokes, which is the standard brightness/sun mark — the teeth
    // are what make this read as settings.
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="3.1" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M19.14 12.94a7.07 7.07 0 0 0 0-1.88l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.61-.22l-2.39.96a7.03 7.03 0 0 0-1.62-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.58.24-1.12.55-1.62.94l-2.39-.96a.5.5 0 0 0-.61.22L2.65 8.84a.5.5 0 0 0 .12.64l2.03 1.58a7.07 7.07 0 0 0 0 1.88l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.12.22.38.3.61.22l2.39-.96c.5.39 1.04.7 1.62.94l.36 2.54a.5.5 0 0 0 .5.42h3.84a.5.5 0 0 0 .5-.42l.36-2.54c.58-.24 1.12-.55 1.62-.94l2.39.96c.23.08.49 0 .61-.22l1.92-3.32a.5.5 0 0 0-.12-.64z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function CockpitHeader() {
  const pathname = usePathname();
  const [platform] = usePlatform();
  const active = NAV.find(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`)
  );
  const isDashboard = active?.href === "/dashboard";
  const isSettings = pathname === "/settings" || pathname.startsWith("/settings/");

  return (
    <header className="ck-header">
      <RadarScope />
      <div className="ck-sig">
        SOCIAL·<b>COCKPIT</b>
      </div>
      <nav className="ck-nav">
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={item === active ? "on" : undefined}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="ck-hud">
        {platform.toUpperCase()}/MAIN · <b>{formatToday()}</b>
        {isDashboard && (
          <>
            {" "}
            · WINDOW
            <Suspense fallback={<span className="ck-window" />}>
              <WindowSelector />
            </Suspense>
          </>
        )}
        <br />
        {isDashboard ? (
          platform === "yt" ? (
            <span>
              SOURCE <b>YOUTUBE DATA API v3</b> · PUBLIC METRICS
            </span>
          ) : (
            <span className="warn">▲ INSIGHTS DELAYED ≤48H — LAST 2 DAYS OMITTED</span>
          )
        ) : (
          <span>
            SECTION <b>{(active?.label ?? "SYSTEM").toUpperCase()}</b> · STATUS{" "}
            <b>NOMINAL</b>
          </span>
        )}
      </div>
      <Link href="/settings" aria-label="Settings" className={`ck-settings${isSettings ? " on" : ""}`}>
        <SettingsGlyph />
      </Link>
    </header>
  );
}
