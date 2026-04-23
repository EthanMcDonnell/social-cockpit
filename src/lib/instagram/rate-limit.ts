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

  let usage: AppUsage;
  try {
    usage = JSON.parse(raw) as AppUsage;
  } catch {
    return { usage: null, isThrottled: false };
  }

  const fields: (keyof AppUsage)[] = ["call_count", "cpu_time", "total_time"];
  for (const field of fields) {
    if ((usage[field] ?? 0) >= THROTTLE_THRESHOLD) {
      return { usage, isThrottled: true, throttledField: field };
    }
  }

  return { usage, isThrottled: false };
}
