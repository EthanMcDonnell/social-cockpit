/**
 * Formats a number with K/M suffixes.
 * e.g. 1500 → "1.5K", 2300000 → "2.3M"
 */
export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return n.toString();
}

/**
 * Formats a number as a percentage with one decimal.
 * e.g. 0.0423 → "4.2%"
 */
export function formatPercent(ratio: number, decimals = 1): string {
  return `${(ratio * 100).toFixed(decimals)}%`;
}

/**
 * Formats a delta value with +/- prefix.
 * e.g. 150 → "+150", -30 → "-30"
 */
export function formatDelta(delta: number, useK = false): string {
  const formatted = useK ? formatCount(Math.abs(delta)) : Math.abs(delta).toString();
  return delta >= 0 ? `+${formatted}` : `-${formatted}`;
}

/**
 * Formats a duration in milliseconds as a human-readable string.
 * e.g. 4200 → "4.2s", 90000 → "1m 30s"
 */
export function formatDuration(ms: number): string {
  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1).replace(/\.0$/, "")}s`;
  const m = Math.floor(totalSeconds / 60);
  const s = Math.round(totalSeconds % 60);
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

/**
 * Formats a percentage delta with +/- prefix.
 * e.g. 0.05 → "+5.0%"
 */
export function formatPercentDelta(delta: number, decimals = 1): string {
  const sign = delta >= 0 ? "+" : "-";
  return `${sign}${(Math.abs(delta) * 100).toFixed(decimals)}%`;
}
