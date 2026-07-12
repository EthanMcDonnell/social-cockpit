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

export function CockpitHeader() {
  const pathname = usePathname();
  const [platform] = usePlatform();
  const active = NAV.find(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`)
  );
  const isDashboard = active?.href === "/dashboard";

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
    </header>
  );
}
