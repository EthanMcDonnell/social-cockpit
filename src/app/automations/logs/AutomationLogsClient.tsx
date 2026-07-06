"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";

interface AutomationEvent {
  id: number;
  flow_id: string | null;
  recipient_id: string | null;
  comment_id: string | null;
  level: "info" | "warn" | "error";
  kind: string;
  message: string | null;
  meta: string | null;
  created_at: string;
}

interface EventsResponse {
  events: AutomationEvent[];
  counts: { info: number; warn: number; error: number };
  kinds: string[];
}

type LevelFilter = "all" | "warn_error" | "info" | "warn" | "error";

const LEVEL_PARAM: Record<LevelFilter, string> = {
  all: "",
  warn_error: "warn,error",
  info: "info",
  warn: "warn",
  error: "error",
};

function useEvents(level: LevelFilter, kind: string) {
  const params = new URLSearchParams();
  if (LEVEL_PARAM[level]) params.set("level", LEVEL_PARAM[level]);
  if (kind) params.set("kind", kind);
  params.set("limit", "300");
  return useQuery<EventsResponse>({
    queryKey: ["automation-events", level, kind],
    queryFn: async () => {
      const res = await fetch(`/api/automation-events?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? "Failed to fetch events");
      }
      return res.json();
    },
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });
}

const LEVEL_STYLES: Record<AutomationEvent["level"], string> = {
  info: "text-text-muted border-border bg-bg-base",
  warn: "text-accent-amber border-accent-amber/30 bg-accent-amber/10",
  error: "text-accent-red border-accent-red/30 bg-accent-red/10",
};

const ROW_TINT: Record<AutomationEvent["level"], string> = {
  info: "",
  warn: "bg-accent-amber/[0.04]",
  error: "bg-accent-red/[0.05]",
};

function fmtTime(iso: string): string {
  // Stored as UTC "YYYY-MM-DD HH:MM:SS" (datetime('now')).
  const d = new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

const LEVEL_TABS: { key: LevelFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "warn_error", label: "Warn + Error" },
  { key: "info", label: "Info" },
  { key: "warn", label: "Warn" },
  { key: "error", label: "Error" },
];

export function AutomationLogsClient() {
  const [level, setLevel] = useState<LevelFilter>("all");
  const [kind, setKind] = useState("");
  const { data, isLoading, isFetching, error, refetch } = useEvents(level, kind);

  const events = data?.events ?? [];
  const counts = data?.counts ?? { info: 0, warn: 0, error: 0 };
  const kinds = data?.kinds ?? [];
  const issues = counts.warn + counts.error;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header bar */}
      <div className="h-12 px-6 flex items-center gap-3 border-b border-border flex-shrink-0">
        <Link
          href="/automations"
          className="text-xs text-text-muted hover:text-accent-cyan transition-colors"
        >
          ← Flows
        </Link>
        <span className="text-border">·</span>
        <span className="text-xs font-semibold text-text-muted uppercase tracking-widest">
          Automation Logs
        </span>
        {issues > 0 && (
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-accent-red/30 bg-accent-red/10 text-accent-red">
            {issues} {issues === 1 ? "issue" : "issues"}
          </span>
        )}
        <div className="flex-1" />
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="text-[11px] text-accent-cyan hover:opacity-80 disabled:opacity-40 transition-opacity"
        >
          {isFetching ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {/* Filters */}
      <div className="px-6 py-3 flex items-center gap-3 border-b border-border flex-shrink-0 flex-wrap">
        <div className="flex gap-1 p-0.5 bg-bg-base border border-border rounded-xl">
          {LEVEL_TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setLevel(t.key)}
              className={clsx(
                "px-3 py-1.5 rounded-[10px] text-[10px] font-medium transition-all",
                level === t.key
                  ? "bg-bg-card text-text-primary shadow-sm"
                  : "text-text-muted hover:text-text-primary"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          className="text-xs bg-bg-base border border-border rounded-xl px-3 py-2 text-text-primary focus:outline-none focus:border-accent-cyan/50 transition-colors appearance-none"
        >
          <option value="">All kinds</option>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <span className="text-[10px] text-text-muted/60 font-mono">
          info {counts.info} · warn {counts.warn} · error {counts.error}
        </span>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {error && (
          <p className="text-xs text-accent-red p-6">{(error as Error).message}</p>
        )}
        {isLoading ? (
          <div className="p-6 space-y-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-8 rounded-lg bg-border/40 animate-pulse" />
            ))}
          </div>
        ) : events.length === 0 ? (
          <p className="text-xs text-text-muted p-6">No events logged yet.</p>
        ) : (
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0 bg-bg-base/95 backdrop-blur border-b border-border">
              <tr className="text-[10px] uppercase tracking-wider text-text-muted/70">
                <th className="text-left font-medium px-4 py-2 whitespace-nowrap">Time</th>
                <th className="text-left font-medium px-2 py-2">Level</th>
                <th className="text-left font-medium px-2 py-2">Kind</th>
                <th className="text-left font-medium px-2 py-2">Recipient</th>
                <th className="text-left font-medium px-2 py-2 w-full">Message</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr
                  key={e.id}
                  className={clsx("border-b border-border/50 align-top", ROW_TINT[e.level])}
                >
                  <td className="px-4 py-2 whitespace-nowrap font-mono text-[10px] text-text-muted/70">
                    {fmtTime(e.created_at)}
                  </td>
                  <td className="px-2 py-2">
                    <span
                      className={clsx(
                        "text-[9px] font-mono uppercase px-1.5 py-0.5 rounded border",
                        LEVEL_STYLES[e.level]
                      )}
                    >
                      {e.level}
                    </span>
                  </td>
                  <td className="px-2 py-2 font-mono text-[11px] text-text-primary whitespace-nowrap">
                    {e.kind}
                  </td>
                  <td className="px-2 py-2 font-mono text-[10px] text-text-muted/70 whitespace-nowrap">
                    {e.recipient_id ?? "—"}
                  </td>
                  <td className="px-2 py-2 text-text-secondary break-words">
                    {e.message ?? ""}
                    {e.meta && (
                      <span className="block mt-0.5 font-mono text-[10px] text-text-muted/50 break-all">
                        {e.meta}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
