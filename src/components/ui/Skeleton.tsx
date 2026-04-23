import { clsx } from "clsx";

interface SkeletonProps {
  className?: string;
  /** For building multi-line text skeletons */
  lines?: number;
}

export function Skeleton({ className, lines }: SkeletonProps) {
  if (lines && lines > 1) {
    return (
      <div className="space-y-2">
        {Array.from({ length: lines }).map((_, i) => (
          <div
            key={i}
            className={clsx(
              "animate-pulse rounded bg-[var(--border)]",
              i === lines - 1 ? "w-3/4" : "w-full",
              className ?? "h-4"
            )}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      className={clsx(
        "animate-pulse rounded bg-[var(--border)]",
        className ?? "h-4 w-full"
      )}
    />
  );
}

/** Full-height skeleton for a chart area */
export function ChartSkeleton({ height = 200 }: { height?: number }) {
  return (
    <div
      className="animate-pulse rounded bg-[var(--border)] w-full"
      style={{ height }}
    />
  );
}
