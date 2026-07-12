"use client";

import { usePlatform, PLATFORMS, type Platform } from "@/hooks/usePlatform";
import { PlatformGlyph } from "./PlatformGlyph";

const LABEL: Record<Platform, string> = { ig: "IG", yt: "YT" };

/**
 * Segmented IG/YT control that drives which platform the whole dashboard shows.
 * Fixed footprint no matter how many platforms are added — tabs, not sections.
 */
export function PlatformSwitch() {
  const [platform, setPlatform] = usePlatform();

  return (
    <div className="ck-pswitch" role="group" aria-label="Platform">
      {PLATFORMS.map((p) => (
        <button
          key={p}
          type="button"
          aria-pressed={p === platform}
          className={p === platform ? "on" : undefined}
          onClick={() => setPlatform(p)}
        >
          <PlatformGlyph platform={p} size={12} />
          {LABEL[p]}
        </button>
      ))}
    </div>
  );
}
