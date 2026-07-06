import type { ReactNode } from "react";

interface PanelProps {
  /** Instrument index shown in the corner tag, e.g. "01" */
  tag: string;
  /** Uppercase panel title */
  title: string;
  /** Right-hand caption (units / range annotation) */
  rhs?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * Instrument panel with corner brackets and a tagged header, matching the
 * COCKPIT v2 style guide. Purely presentational.
 */
export function Panel({ tag, title, rhs, children, className }: PanelProps) {
  return (
    <div className={`panel${className ? ` ${className}` : ""}`}>
      <div className="p-h">
        <span className="tag">{tag}</span>
        <h2>{title}</h2>
        {rhs != null && <span className="rhs">{rhs}</span>}
      </div>
      {children}
    </div>
  );
}
