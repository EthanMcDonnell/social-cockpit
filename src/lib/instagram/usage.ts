/**
 * API-usage introspection.
 *
 * Makes ONE minimal Graph API read (account `id` only) purely to harvest the
 * `x-app-usage` and `x-business-use-case-usage` response headers, which report
 * how much of your rate-limit allotment is consumed (0–100%).
 *
 * Reads no DB and mutates nothing — safe to call on demand. Note: the check
 * itself counts as one API call against your quota.
 *
 * Server-side only — never import the runtime from a client component (types
 * are fine via `import type`).
 */

const BASE_URL = "https://graph.instagram.com/v25.0";

/** One bucket of the per-business-account usage header. Values are percentages. */
export interface BucUsageEntry {
  type?: string;
  call_count?: number;
  total_cputime?: number;
  total_time?: number;
  estimated_time_to_regain_access?: number;
}

/** A single app-level usage metric, normalised to a display label + percent. */
export interface UsageMetric {
  key: string;
  label: string;
  pct: number;
}

export interface UsageSnapshot {
  checkedAt: string;
  /**
   * App-level metrics parsed from `x-app-usage`. Adapts to whichever fields the
   * surface returns — `graph.instagram.com` sends `call_volume`/`cpu_time`,
   * while `graph.facebook.com` sends `call_count`/`total_cputime`/`total_time`.
   */
  metrics: UsageMetric[];
  /** Parsed `x-business-use-case-usage`, keyed by business-account id (Facebook surface only). */
  businessUsage: Record<string, BucUsageEntry[]> | null;
  /** True when any app-level metric is ≥ 90%. */
  throttled: boolean;
}

/** Map raw usage keys (either surface's naming) to a stable display label. */
const APP_USAGE_LABELS: Record<string, string> = {
  call_volume: "Calls",
  call_count: "Calls",
  cpu_time: "CPU",
  total_cputime: "CPU",
  total_time: "Total",
};

function parseAppMetrics(raw: string | null): UsageMetric[] {
  if (!raw) return [];
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return [];
  }
  const seen = new Set<string>();
  const metrics: UsageMetric[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const label = APP_USAGE_LABELS[key] ?? key;
    if (seen.has(label)) continue; // collapse duplicate labels across naming variants
    seen.add(label);
    metrics.push({ key, label, pct: typeof value === "number" ? value : 0 });
  }
  return metrics;
}

function parseBusinessUsage(
  raw: string | null
): Record<string, BucUsageEntry[]> | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, BucUsageEntry[]>;
  } catch {
    return null;
  }
}

export async function fetchUsageSnapshot(): Promise<UsageSnapshot> {
  const token = process.env.INSTAGRAM_ACCESS_TOKEN;
  const accountId = process.env.INSTAGRAM_ACCOUNT_ID;
  if (!token) throw new Error("INSTAGRAM_ACCESS_TOKEN is not set. Add it to .env.local.");
  if (!accountId) throw new Error("INSTAGRAM_ACCOUNT_ID is not set. Add it to .env.local.");

  const res = await fetch(`${BASE_URL}/${accountId}?fields=id`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  // Parse headers first — they're present on error responses too.
  const metrics = parseAppMetrics(res.headers.get("x-app-usage"));
  const businessUsage = parseBusinessUsage(res.headers.get("x-business-use-case-usage"));

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as
      | { error?: { message?: string } }
      | null;
    throw new Error(
      body?.error?.message ?? `Instagram usage check failed (${res.status} ${res.statusText})`
    );
  }

  const throttled = metrics.some((m) => m.pct >= 90);

  return {
    checkedAt: new Date().toISOString(),
    metrics,
    businessUsage,
    throttled,
  };
}
