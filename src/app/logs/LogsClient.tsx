"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";

interface LogRow {
  id: string;
  stream: "system" | "automation" | "schedule";
  source: string;
  level: "info" | "warn" | "error";
  kind: string;
  message: string | null;
  meta: string | null;
  ref: string | null;
  created_at: string;
}

interface LogsResponse {
  events: LogRow[];
  counts: { info: number; warn: number; error: number };
  kinds: string[];
  sources: string[];
}

/**
 * Defaults to Warn + Error.
 *
 * This page exists because failures were invisible, and the info rows — every
 * DM sent, every job published — outnumber them by orders of magnitude. Opening
 * on "All" would bury the thing you came to find under the thing that worked.
 */
type LevelFilter = "warn_error" | "all" | "info" | "warn" | "error";

const LEVEL_PARAM: Record<LevelFilter, string> = {
  warn_error: "warn,error",
  all: "",
  info: "info",
  warn: "warn",
  error: "error",
};

const LEVEL_TABS: { key: LevelFilter; label: string }[] = [
  { key: "warn_error", label: "Issues" },
  { key: "all", label: "All" },
  { key: "info", label: "Info" },
  { key: "warn", label: "Warn" },
  { key: "error", label: "Error" },
];

const LEVEL_STYLES: Record<LogRow["level"], string> = {
  info: "text-text-muted border-border bg-bg-base",
  warn: "text-accent-amber border-accent-amber/30 bg-accent-amber/10",
  error: "text-accent-red border-accent-red/30 bg-accent-red/10",
};

const ROW_TINT: Record<LogRow["level"], string> = {
  info: "",
  warn: "bg-accent-amber/[0.04]",
  error: "bg-accent-red/[0.05]",
};

function fmtTime(iso: string): string {
  // Stored as UTC "YYYY-MM-DD HH:MM:SS" (datetime('now')) by all three tables.
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

function useLogs(level: LevelFilter, source: string, kind: string) {
  const params = new URLSearchParams();
  if (LEVEL_PARAM[level]) params.set("level", LEVEL_PARAM[level]);
  if (source) params.set("source", source);
  if (kind) params.set("kind", kind);
  params.set("limit", "300");

  return useQuery<LogsResponse>({
    queryKey: ["logs", level, source, kind],
    queryFn: async () => {
      const res = await fetch(`/api/logs?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? "Failed to fetch logs");
      }
      return res.json();
    },
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });
}

function useClearLogs() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/logs?stream=all", { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? "Failed to clear logs");
      }
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["logs"] }),
  });
}

/** Pretty-print the meta blob on demand — stacks live in here. */
function MetaCell({ meta }: { meta: string | null }) {
  const [open, setOpen] = useState(false);
  if (!meta || meta === "null") return null;

  let pretty = meta;
  try {
    pretty = JSON.stringify(JSON.parse(meta), null, 2);
  } catch {
    /* not JSON — show it raw */
  }

  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        className="ml-2 text-[10px] text-text-muted/60 hover:text-accent-cyan transition-colors"
      >
        {open ? "hide" : "detail"}
      </button>
      {open && (
        <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-border bg-bg-base p-2 font-mono text-[10px] leading-relaxed text-text-muted">
          {pretty}
        </pre>
      )}
    </>
  );
}

export function LogsClient() {
  // /automations/logs redirects here with ?source=automation, so an old link
  // still lands on the rows it used to show rather than the unfiltered stream.
  const initialSource = useSearchParams().get("source") ?? "";
  const [level, setLevel] = useState<LevelFilter>(initialSource ? "all" : "warn_error");
  const [source, setSource] = useState(initialSource);
  const [kind, setKind] = useState("");
  const { data, isLoading, isFetching, error, refetch } = useLogs(level, source, kind);
  const clear = useClearLogs();

  const events = data?.events ?? [];
  const counts = data?.counts ?? { info: 0, warn: 0, error: 0 };
  const sources = data?.sources ?? [];
  const kinds = data?.kinds ?? [];
  const issues = counts.warn + counts.error;
  const totalLogged = counts.info + counts.warn + counts.error;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header bar */}
      <div className="h-12 px-6 flex items-center gap-3 border-b border-border flex-shrink-0">
        <span className="text-xs font-semibold text-text-muted uppercase tracking-widest">
          System Logs
        </span>
        <span
          className={clsx(
            "text-[10px] font-mono px-1.5 py-0.5 rounded border",
            issues > 0
              ? "border-accent-red/30 bg-accent-red/10 text-accent-red"
              : "border-border bg-bg-base text-text-muted"
          )}
        >
          {issues > 0 ? `${issues} ${issues === 1 ? "issue" : "issues"}` : "nominal"}
        </span>
        <div className="flex-1" />
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="text-[11px] text-accent-cyan hover:opacity-80 disabled:opacity-40 transition-opacity"
        >
          {isFetching ? "Refreshing…" : "Refresh"}
        </button>
        <span className="text-border">·</span>
        <button
          onClick={() => {
            if (!window.confirm("Delete every log entry from all workers? This can't be undone.")) {
              return;
            }
            setKind("");
            setSource("");
            clear.mutate();
          }}
          disabled={clear.isPending || totalLogged === 0}
          className="text-[11px] text-text-muted hover:text-accent-red disabled:opacity-40 disabled:hover:text-text-muted transition-colors"
        >
          {clear.isPending ? "Clearing…" : "Clear logs"}
        </button>
      </div>
      {clear.error && (
        <p className="px-6 py-2 text-[11px] text-accent-red border-b border-border flex-shrink-0">
          {(clear.error as Error).message}
        </p>
      )}

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
          value={source}
          onChange={(e) => setSource(e.target.value)}
          className="text-xs bg-bg-base border border-border rounded-xl px-3 py-2 text-text-primary focus:outline-none focus:border-accent-cyan/50 transition-colors appearance-none"
        >
          <option value="">All sources</option>
          {sources.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
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
        {error && <p className="text-xs text-accent-red p-6">{(error as Error).message}</p>}
        {isLoading ? (
          <div className="p-6 space-y-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-8 rounded-lg bg-border/40 animate-pulse" />
            ))}
          </div>
        ) : events.length === 0 ? (
          <p className="text-xs text-text-muted p-6">
            {level === "warn_error"
              ? "No warnings or errors logged. Everything is running clean."
              : "Nothing logged yet."}
          </p>
        ) : (
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0 bg-bg-base/95 backdrop-blur border-b border-border">
              <tr className="text-[10px] uppercase tracking-wider text-text-muted/70">
                <th className="text-left font-medium px-4 py-2 whitespace-nowrap">Time</th>
                <th className="text-left font-medium px-2 py-2">Level</th>
                <th className="text-left font-medium px-2 py-2">Source</th>
                <th className="text-left font-medium px-2 py-2">Kind</th>
                <th className="text-left font-medium px-2 py-2">Ref</th>
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
                        "text-[10px] font-mono px-1.5 py-0.5 rounded border uppercase",
                        LEVEL_STYLES[e.level]
                      )}
                    >
                      {e.level}
                    </span>
                  </td>
                  <td className="px-2 py-2 whitespace-nowrap font-mono text-[10px] text-text-muted">
                    {e.source}
                  </td>
                  <td className="px-2 py-2 whitespace-nowrap font-mono text-[10px] text-text-primary">
                    {e.kind}
                  </td>
                  <td className="px-2 py-2 whitespace-nowrap font-mono text-[10px] text-text-muted/60">
                    {e.ref ?? "—"}
                  </td>
                  <td className="px-2 py-2 text-[11px] text-text-primary break-words">
                    {e.message ?? "—"}
                    <MetaCell meta={e.meta} />
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
