"use client";

import { tabsForPlatform, type ComposeTab } from "@/lib/compose/draft";
import type { Platform } from "@/hooks/usePlatform";

export function MediaTypeStrip({
  platform,
  value,
  onChange,
}: {
  platform: Platform;
  value: ComposeTab;
  onChange: (value: ComposeTab) => void;
}) {
  const tabs = tabsForPlatform(platform);
  return (
    <div className="cs-seg" role="tablist" aria-label="Media type">
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          aria-selected={t.value === value}
          className={t.value === value ? "on" : undefined}
          onClick={() => onChange(t.value)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
