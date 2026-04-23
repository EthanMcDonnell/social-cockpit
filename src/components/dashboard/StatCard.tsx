import { clsx } from "clsx";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatCount, formatPercentDelta } from "@/lib/utils/format";

export interface StatCardProps {
  label: string;
  value: number | undefined;
  /** Raw delta value (e.g. +150 followers) */
  delta?: number;
  /** Ratio delta (0.05 = +5%). Used for percentage display when provided. */
  deltaRatio?: number;
  /** Suffix appended after the value, e.g. "%" */
  suffix?: string;
  /** Format value as percentage (multiplied by 100) */
  isPercent?: boolean;
  isLoading?: boolean;
}

export function StatCard({
  label,
  value,
  delta,
  deltaRatio,
  suffix,
  isPercent,
  isLoading,
}: StatCardProps) {
  const formattedValue =
    value === undefined
      ? "—"
      : isPercent
      ? `${(value * 100).toFixed(1)}%`
      : formatCount(value) + (suffix ?? "");

  const hasDelta = delta !== undefined || deltaRatio !== undefined;
  const deltaPositive = (deltaRatio ?? delta ?? 0) >= 0;
  const deltaLabel = deltaRatio !== undefined ? formatPercentDelta(deltaRatio) : delta !== undefined ? formatPercentDelta(delta) : "";

  return (
    <Card padding="lg" className="flex flex-col gap-3">
      <p className="text-xs uppercase tracking-widest text-[var(--text-muted)] font-medium">
        {label}
      </p>
      {isLoading ? (
        <>
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-3 w-16" />
        </>
      ) : (
        <>
          <p
            className="font-mono text-3xl font-semibold tracking-tight text-[var(--text-primary)]"
            style={{ fontFamily: "var(--font-dm-mono), monospace" }}
          >
            {formattedValue}
          </p>
          {hasDelta && (
            <p
              className={clsx(
                "text-xs font-mono font-medium",
                deltaPositive
                  ? "text-[var(--accent-green)]"
                  : "text-[var(--accent-red)]"
              )}
            >
              {deltaLabel} <span className="text-[var(--text-muted)]">this period</span>
            </p>
          )}
        </>
      )}
    </Card>
  );
}
