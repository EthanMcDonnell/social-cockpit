"use client";

import { useEffect, useState } from "react";

const DISMISS_KEY = "social-cockpit:data-delay-banner-dismissed";

export function DataDelayBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const dismissed = sessionStorage.getItem(DISMISS_KEY);
    if (!dismissed) setVisible(true);
  }, []);

  function dismiss() {
    sessionStorage.setItem(DISMISS_KEY, "1");
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-[var(--accent-amber)]/30 bg-[var(--accent-amber)]/8 px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="text-[var(--accent-amber)] text-sm shrink-0">⚠</span>
        <p className="text-xs text-[var(--text-muted)]">
          <span className="font-medium text-[var(--text-primary)]">Data delayed up to 48 hours.</span>
          {" "}Instagram insights are not available in real time. Charts do not include data from the last two days.
        </p>
      </div>
      <button
        onClick={dismiss}
        aria-label="Dismiss"
        className="shrink-0 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors text-lg leading-none"
      >
        ×
      </button>
    </div>
  );
}
