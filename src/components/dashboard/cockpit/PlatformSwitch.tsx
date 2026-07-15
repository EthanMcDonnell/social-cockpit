"use client";

import { usePlatform, PLATFORMS, type Platform } from "@/hooks/usePlatform";
import { PlatformGlyph } from "./PlatformGlyph";

const LABEL: Record<Platform, string> = { ig: "IG", yt: "YT" };

/** The segmented control itself — fully controlled, no data source of its own. */
function PlatformSwitchView({
  value,
  onChange,
}: {
  value: Platform;
  onChange: (p: Platform) => void;
}) {
  return (
    <div className="ck-pswitch" role="group" aria-label="Platform">
      {PLATFORMS.map((p) => (
        <button
          key={p}
          type="button"
          aria-pressed={p === value}
          className={p === value ? "on" : undefined}
          onClick={() => onChange(p)}
        >
          <PlatformGlyph platform={p} size={12} />
          {LABEL[p]}
        </button>
      ))}
    </div>
  );
}

/** Uncontrolled variant bound to the dashboard-wide `?platform=` URL param. */
function UrlPlatformSwitch() {
  const [platform, setPlatform] = usePlatform();
  return <PlatformSwitchView value={platform} onChange={setPlatform} />;
}

interface PlatformSwitchProps {
  /** Controlled value. Omit to bind to the shared `?platform=` URL param. */
  value?: Platform;
  onChange?: (p: Platform) => void;
}

/**
 * Segmented IG/YT control. By default it drives the dashboard-wide `?platform=`
 * URL param; pass `value`/`onChange` to use it as a controlled input elsewhere
 * (Compose keeps the active platform in the draft, not the URL). Rendering splits
 * so the URL-reading hook only runs in the uncontrolled case — a controlled
 * caller (Compose) pulls in no `useSearchParams`, hence needs no Suspense
 * boundary. Fixed footprint no matter how many platforms are added.
 */
export function PlatformSwitch({ value, onChange }: PlatformSwitchProps = {}) {
  if (value !== undefined && onChange) {
    return <PlatformSwitchView value={value} onChange={onChange} />;
  }
  return <UrlPlatformSwitch />;
}
