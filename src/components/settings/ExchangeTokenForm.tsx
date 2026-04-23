"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/Card";

export function ExchangeTokenForm() {
  const queryClient = useQueryClient();
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token.trim()) return;

    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      const res = await fetch("/api/token/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shortLivedToken: token.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.error) {
        setError(body.error ?? "Exchange failed");
      } else {
        setSuccess(true);
        setToken("");
        queryClient.invalidateQueries({ queryKey: ["token", "status"] });
      }
    } catch {
      setError("Network error — could not exchange token.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card padding="none">
      <div className="px-5 py-4 border-b border-[var(--border)]">
        <p className="text-xs uppercase tracking-widest text-[var(--text-muted)] font-medium">
          Exchange Short-Lived Token
        </p>
      </div>

      <form onSubmit={handleSubmit} className="p-5 space-y-4">
        <p className="text-xs text-[var(--text-muted)] leading-relaxed">
          Paste a short-lived Instagram token (valid for 1 hour) to exchange it for a long-lived
          token (valid for 60 days). You can generate one via the{" "}
          <a
            href="https://developers.facebook.com/tools/explorer/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--accent-cyan)] hover:underline"
          >
            Graph API Explorer
          </a>
          .
        </p>

        <div className="space-y-1.5">
          <label
            htmlFor="short-lived-token"
            className="text-xs font-medium text-[var(--text-muted)]"
          >
            Short-Lived Token
          </label>
          <input
            id="short-lived-token"
            type="text"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="EAABwzL..."
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg-base)] px-3 py-2 text-xs font-mono text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-cyan)] transition-colors"
          />
        </div>

        {error && <p className="text-xs text-[var(--accent-red)]">{error}</p>}
        {success && (
          <p className="text-xs text-[var(--accent-green)]">
            Token exchanged and saved successfully.
          </p>
        )}

        <button
          type="submit"
          disabled={loading || !token.trim()}
          className="px-4 py-2 rounded-xl text-xs font-medium bg-[var(--accent-cyan)] text-[var(--bg-base)] hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {loading ? "Exchanging…" : "Exchange Token"}
        </button>
      </form>
    </Card>
  );
}
