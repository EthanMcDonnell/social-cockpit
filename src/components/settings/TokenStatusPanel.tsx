"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { useTokenStatus } from "@/hooks/useTokenStatus";
import type { TokenStatus } from "@/lib/token/types";

const statusConfig: Record<
  TokenStatus,
  { label: string; variant: "green" | "amber" | "red" | "default"; barColor: string }
> = {
  healthy: { label: "Healthy", variant: "green", barColor: "var(--accent-green)" },
  warning: { label: "Expiring Soon", variant: "amber", barColor: "var(--accent-amber)" },
  expired: { label: "Expired", variant: "red", barColor: "var(--accent-red)" },
  unknown: { label: "Unknown", variant: "default", barColor: "var(--text-muted)" },
};

export function TokenStatusPanel() {
  const { data, isLoading, isError } = useTokenStatus();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [refreshSuccess, setRefreshSuccess] = useState(false);

  async function handleRefresh() {
    setRefreshing(true);
    setRefreshError(null);
    setRefreshSuccess(false);
    try {
      const res = await fetch("/api/token/refresh", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.error) {
        setRefreshError(body.error ?? "Refresh failed");
      } else {
        setRefreshSuccess(true);
        queryClient.invalidateQueries({ queryKey: ["token", "status"] });
      }
    } catch {
      setRefreshError("Network error — could not refresh token.");
    } finally {
      setRefreshing(false);
    }
  }

  const status = data?.status ?? "unknown";
  const config = statusConfig[status];
  const daysRemaining = data?.daysRemaining;
  const expiresAt = data?.expiresAt;

  // Bar: 60-day max window for visualization
  const barPct =
    daysRemaining != null
      ? Math.min(100, Math.max(0, (daysRemaining / 60) * 100))
      : 0;

  return (
    <Card padding="none">
      <div className="px-5 py-4 border-b border-[var(--border)]">
        <p className="text-xs uppercase tracking-widest text-[var(--text-muted)] font-medium">
          Access Token
        </p>
      </div>

      <div className="p-5 space-y-5">
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-2 w-full" />
            <Skeleton className="h-3 w-40" />
          </div>
        ) : isError ? (
          <p className="text-sm text-[var(--accent-red)]">
            Could not read token status. Set TOKEN_EXPIRES_AT in .env if no token has been refreshed yet.
          </p>
        ) : (
          <>
            {/* Status row */}
            <div className="flex items-center justify-between">
              <Badge variant={config.variant}>{config.label}</Badge>
              {daysRemaining != null && (
                <span className="font-mono text-sm text-[var(--text-primary)]">
                  {daysRemaining > 0 ? `${daysRemaining}d remaining` : "Expired"}
                </span>
              )}
            </div>

            {/* Health bar */}
            <div className="h-2 w-full rounded-full bg-[var(--border)]">
              <div
                className="h-2 rounded-full transition-all duration-500"
                style={{
                  width: `${barPct}%`,
                  backgroundColor: config.barColor,
                }}
              />
            </div>

            {/* Expiry date */}
            {expiresAt && (
              <p className="text-xs text-[var(--text-muted)]">
                Expires{" "}
                <span className="font-mono text-[var(--text-primary)]">{expiresAt}</span>
              </p>
            )}

            {/* Feedback */}
            {refreshSuccess && (
              <p className="text-xs text-[var(--accent-green)]">
                Token refreshed successfully.
              </p>
            )}
            {refreshError && (
              <p className="text-xs text-[var(--accent-red)]">{refreshError}</p>
            )}

            {/* Refresh button */}
            <button
              onClick={handleRefresh}
              disabled={refreshing || status === "expired"}
              className="px-4 py-2 rounded-xl text-xs font-medium bg-[var(--accent-cyan)] text-[var(--bg-base)] hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {refreshing ? "Refreshing…" : "Refresh Token"}
            </button>

            {status === "expired" && (
              <p className="text-xs text-[var(--text-muted)]">
                Token has expired. Use the form below to exchange a new short-lived token.
              </p>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
