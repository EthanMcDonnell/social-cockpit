"use client";

import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import type { UsageSnapshot } from "@/lib/instagram/usage";

function tone(pct: number) {
  if (pct >= 90) return { bar: "bg-red-500", text: "text-red-400" };
  if (pct >= 70) return { bar: "bg-amber-500", text: "text-amber-400" };
  return { bar: "bg-accent-cyan", text: "text-text-secondary" };
}

function UsageBar({ label, pct }: { label: string; pct: number }) {
  const clamped = Math.min(100, Math.max(0, pct));
  const t = tone(pct);
  return (
    <div>
      <div className="flex items-center justify-between text-[10px] mb-0.5">
        <span className="text-text-muted uppercase tracking-wider">{label}</span>
        <span className={clsx("font-mono font-semibold", t.text)}>{Math.round(pct)}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-border overflow-hidden">
        <div
          className={clsx("h-full rounded-full transition-all duration-500", t.bar)}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}

/**
 * Live Instagram API rate-limit meter. Fetches /api/instagram/usage, which
 * makes one lightweight Graph call and reads the usage headers. The check
 * itself costs one call — surfaced in the footer so it's never a surprise.
 */
export function ApiUsageMeter() {
  const { data, isFetching, refetch, error } = useQuery<UsageSnapshot>({
    queryKey: ["instagram-usage"],
    queryFn: async () => {
      const res = await fetch("/api/instagram/usage");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? "Failed to fetch usage");
      }
      return res.json();
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const metrics = data?.metrics ?? [];
  // Flatten the business-use-case buckets into labelled rows (Facebook surface
  // only — graph.instagram.com does not send this header).
  const buc = data?.businessUsage
    ? Object.values(data.businessUsage).flat()
    : [];

  return (
    <div className="border-t border-border p-3 space-y-2 flex-shrink-0">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold text-text-muted uppercase tracking-widest">
          API usage
        </span>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="text-[10px] text-accent-cyan hover:opacity-80 disabled:opacity-40 transition-opacity"
        >
          {isFetching ? "Checking…" : "Refresh"}
        </button>
      </div>

      {error && (
        <p className="text-[10px] text-red-400 leading-snug">{(error as Error).message}</p>
      )}

      {metrics.length > 0 ? (
        <div className="space-y-1.5">
          {metrics.map((m) => (
            <UsageBar key={m.key} label={m.label} pct={m.pct} />
          ))}
        </div>
      ) : !error && !isFetching ? (
        <p className="text-[10px] text-text-muted">No usage data reported yet.</p>
      ) : null}

      {buc.length > 0 && (
        <div className="pt-1.5 mt-1.5 border-t border-border/50 space-y-1.5">
          {buc.map((b, i) => (
            <UsageBar
              key={`${b.type ?? "buc"}-${i}`}
              label={b.type ?? "business"}
              pct={b.call_count ?? 0}
            />
          ))}
        </div>
      )}

      {data?.checkedAt && (
        <p className="text-[9px] text-text-muted/70 leading-snug">
          Checked {new Date(data.checkedAt).toLocaleTimeString()} · a check costs 1 call
        </p>
      )}
    </div>
  );
}
