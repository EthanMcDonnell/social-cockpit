// Date utilities with 48-hour Instagram data delay handling

/**
 * Returns unix timestamps for a period range, offsetting `until` by 48h
 * so we never query data that isn't yet available.
 */
export function getPeriodRange(days: number): { since: string; until: string } {
  const now = new Date();
  // Subtract 48h from "until" — Instagram data is delayed up to 48h
  const until = new Date(now.getTime() - 48 * 60 * 60 * 1000);
  const since = new Date(until.getTime() - days * 24 * 60 * 60 * 1000);

  return {
    since: Math.floor(since.getTime() / 1000).toString(),
    until: Math.floor(until.getTime() / 1000).toString(),
  };
}

/**
 * Returns ISO date strings for labeling the period delta in StatCards.
 * e.g. "vs Apr 7" instead of "vs today"
 */
export function getPeriodDeltaLabel(days: number): string {
  const now = new Date();
  const until = new Date(now.getTime() - 48 * 60 * 60 * 1000);
  const since = new Date(until.getTime() - days * 24 * 60 * 60 * 1000);
  return `vs ${formatChartDate(since.toISOString())}`;
}

/**
 * Formats an ISO date string for chart x-axis labels.
 * e.g. "2024-03-15T00:00:00Z" → "Mar 15"
 */
export function formatChartDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Returns true if the given ISO timestamp is less than 48h old.
 * Used to show "Insights available in X hours" instead of zero metrics.
 */
export function isWithin48Hours(isoTimestamp: string): boolean {
  const age = Date.now() - new Date(isoTimestamp).getTime();
  return age < 48 * 60 * 60 * 1000;
}

/**
 * Returns how many hours until insights will be available for a post
 * published at `isoTimestamp`. Returns 0 if already available.
 */
export function hoursUntilInsightsAvailable(isoTimestamp: string): number {
  const ageMs = Date.now() - new Date(isoTimestamp).getTime();
  const delayMs = 48 * 60 * 60 * 1000;
  if (ageMs >= delayMs) return 0;
  return Math.ceil((delayMs - ageMs) / (60 * 60 * 1000));
}
