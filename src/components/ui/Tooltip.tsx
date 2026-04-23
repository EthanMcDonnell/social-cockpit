"use client";

import { useState } from "react";
import { clsx } from "clsx";

interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  className?: string;
}

export function Tooltip({ content, children, side = "top", className }: TooltipProps) {
  const [visible, setVisible] = useState(false);

  const sideClasses = {
    top: "bottom-full left-1/2 -translate-x-1/2 mb-1.5",
    bottom: "top-full left-1/2 -translate-x-1/2 mt-1.5",
    left: "right-full top-1/2 -translate-y-1/2 mr-1.5",
    right: "left-full top-1/2 -translate-y-1/2 ml-1.5",
  };

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      {children}
      {visible && (
        <span
          className={clsx(
            "pointer-events-none absolute z-50 whitespace-nowrap rounded bg-[var(--bg-card)] border border-[var(--border)] px-2 py-1 text-xs text-[var(--text-primary)] shadow-lg",
            sideClasses[side],
            className
          )}
        >
          {content}
        </span>
      )}
    </span>
  );
}
