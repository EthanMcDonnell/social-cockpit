"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { PlatformGlyph } from "@/components/dashboard/cockpit/PlatformGlyph";
import { useYoutubeStatus } from "@/hooks/useYoutubeStatus";

/** Human-readable copy for the ?reason= codes the callback bounces back with. */
const REASON_LABEL: Record<string, string> = {
  state_mismatch: "Security check failed (state mismatch). Try connecting again.",
  missing_code: "Google did not return an authorization code. Try again.",
  access_denied: "Consent was declined.",
  exchange_failed: "Could not exchange the authorization code.",
};

export function YouTubeConnectPanel() {
  const { data, isLoading, isError } = useYoutubeStatus();
  const params = useSearchParams();
  const queryClient = useQueryClient();

  // The OAuth callback redirects back to /settings?yt=connected|error. Refetch
  // status once on arrival so the panel reflects the just-completed connection.
  const outcome = params.get("yt");
  useEffect(() => {
    if (outcome) queryClient.invalidateQueries({ queryKey: ["youtube", "oauth", "status"] });
  }, [outcome, queryClient]);

  const configured = data?.configured ?? false;
  const connected = data?.connected ?? false;
  const healthy = data?.healthy ?? false;

  const badge = !configured
    ? { label: "Not Configured", variant: "default" as const }
    : !connected
      ? { label: "Not Connected", variant: "amber" as const }
      : healthy
        ? { label: "Connected", variant: "green" as const }
        : { label: "Reconnect Needed", variant: "red" as const };

  const reason = params.get("reason");
  const callbackError =
    outcome === "error" ? (reason && REASON_LABEL[reason]) || reason || "Connection failed" : null;

  return (
    <Card padding="none">
      <div className="px-5 py-4 border-b border-[var(--border)] flex items-center gap-2">
        <PlatformGlyph platform="yt" size={14} />
        <p className="text-xs uppercase tracking-widest text-[var(--text-muted)] font-medium">
          YouTube Channel
        </p>
      </div>

      <div className="p-5 space-y-5">
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-3 w-44" />
          </div>
        ) : isError ? (
          <p className="text-sm text-[var(--accent-red)]">Could not read YouTube status.</p>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <Badge variant={badge.variant}>{badge.label}</Badge>
              {data?.channelTitle && (
                <span className="font-mono text-sm text-[var(--text-primary)]">
                  {data.channelTitle}
                </span>
              )}
            </div>

            {outcome === "connected" && (
              <p className="text-xs text-[var(--accent-green)]">Channel connected successfully.</p>
            )}
            {callbackError && <p className="text-xs text-[var(--accent-red)]">{callbackError}</p>}
            {connected && !healthy && data?.error && (
              <p className="text-xs text-[var(--accent-red)]">{data.error}</p>
            )}

            {!configured ? (
              <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                Set{" "}
                <code className="font-mono text-[var(--amber)]">YOUTUBE_OAUTH_CLIENT_ID</code> and{" "}
                <code className="font-mono text-[var(--amber)]">YOUTUBE_OAUTH_CLIENT_SECRET</code>{" "}
                in <code className="font-mono text-[var(--amber)]">.env</code>, then connect. Uploads
                and comment replies act on behalf of the channel owner and need OAuth (the read-only
                API key can&apos;t write).
              </p>
            ) : (
              <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                {connected
                  ? "Re-running consent replaces the stored refresh token."
                  : "Grant upload + comment permissions for this channel."}{" "}
                Until Google&apos;s compliance audit passes, API-uploaded videos land as{" "}
                <span className="text-[var(--text-primary)]">private drafts</span>.
              </p>
            )}

            <a
              href="/api/youtube/oauth/start"
              aria-disabled={!configured}
              className={`inline-block px-4 py-2 rounded-xl text-xs font-medium transition-opacity ${
                configured
                  ? "bg-[var(--accent-cyan)] text-[var(--bg-base)] hover:opacity-90"
                  : "bg-[var(--border)] text-[var(--text-muted)] pointer-events-none opacity-50"
              }`}
            >
              {connected ? "Reconnect YouTube" : "Connect YouTube"}
            </a>
          </>
        )}
      </div>
    </Card>
  );
}
