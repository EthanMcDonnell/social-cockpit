import type { AppUsage, RateLimitInfo } from "./types";

const THROTTLE_THRESHOLD = 90;

/**
 * Parse the X-App-Usage response header from Instagram Graph API.
 * Returns rate limit info including whether we are throttled (any field ≥ 90%).
 */
export function parseRateLimit(headers: Headers): RateLimitInfo {
  const raw = headers.get("x-app-usage");
  if (!raw) {
    return { usage: null, isThrottled: false };
  }

  let parsed: Record<string, number>;
  try {
    parsed = JSON.parse(raw) as Record<string, number>;
  } catch {
    return { usage: null, isThrottled: false };
  }

  // Normalise across the two Graph surfaces: graph.instagram.com sends
  // `call_volume`/`cpu_time`; graph.facebook.com sends
  // `call_count`/`total_cputime`/`total_time`. Keying only on `call_count`
  // previously left the Instagram surface's call metric read as 0 (blind).
  const usage: AppUsage = {
    call_count: parsed.call_volume ?? parsed.call_count ?? 0,
    cpu_time: parsed.cpu_time ?? parsed.total_cputime ?? 0,
    total_time: parsed.total_time ?? 0,
  };

  const fields: (keyof AppUsage)[] = ["call_count", "cpu_time", "total_time"];
  for (const field of fields) {
    if (usage[field] >= THROTTLE_THRESHOLD) {
      return { usage, isThrottled: true, throttledField: field };
    }
  }

  return { usage, isThrottled: false };
}
