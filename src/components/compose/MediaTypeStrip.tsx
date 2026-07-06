"use client";

import type { ComposeTab } from "@/lib/compose/draft";

const TABS: { value: ComposeTab; label: string }[] = [
  { value: "REEL", label: "Reel" },
  { value: "PHOTO", label: "Photo" },
  { value: "STORY", label: "Story" },
];

export function MediaTypeStrip({
  value,
  onChange,
}: {
  value: ComposeTab;
  onChange: (value: ComposeTab) => void;
}) {
  return (
    <div className="cs-seg" role="tablist" aria-label="Media type">
      {TABS.map((t) => (
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
