/**
 * Token manager for Instagram long-lived access tokens.
 * The rotated token and its expiry are persisted through `lib/credentials.ts`,
 * which keeps them in `app_settings`. This file used to rewrite `.env` in place
 * on every refresh; see that module for why it no longer does.
 *
 * Server-side only.
 */

import type { TokenState, RefreshResult, ExchangeResult } from "./types";
import { config } from "@/lib/config";
import {
  getInstagramAccessToken,
  getInstagramTokenExpiry,
  setInstagramToken,
} from "@/lib/credentials";

const BASE_URL = "https://graph.instagram.com";
const WARNING_THRESHOLD_DAYS = 7;

// ─── Status ───────────────────────────────────────────────────────────────────

export function getTokenStatus(): TokenState {
  const expiresAtStr = getInstagramTokenExpiry();

  if (!expiresAtStr) {
    return { status: "unknown", daysRemaining: null, expiresAt: null };
  }

  const expiresAt = new Date(expiresAtStr);
  if (isNaN(expiresAt.getTime())) {
    return { status: "unknown", daysRemaining: null, expiresAt: expiresAtStr };
  }

  const now = new Date();
  const msRemaining = expiresAt.getTime() - now.getTime();
  const daysRemaining = Math.floor(msRemaining / (1000 * 60 * 60 * 24));

  if (daysRemaining < 0) {
    return { status: "expired", daysRemaining, expiresAt: expiresAtStr };
  }

  if (daysRemaining <= WARNING_THRESHOLD_DAYS) {
    return { status: "warning", daysRemaining, expiresAt: expiresAtStr };
  }

  return { status: "healthy", daysRemaining, expiresAt: expiresAtStr };
}

// ─── Refresh ──────────────────────────────────────────────────────────────────

/**
 * Refresh a long-lived Instagram access token.
 * The new token and expiry are persisted to app_settings.
 */
export async function refreshAccessToken(): Promise<RefreshResult> {
  const currentToken = getInstagramAccessToken();
  if (!currentToken) {
    return { success: false, error: "INSTAGRAM_ACCESS_TOKEN is not set" };
  }

  const url = new URL(`${BASE_URL}/refresh_access_token`);
  url.searchParams.set("grant_type", "ig_refresh_token");
  url.searchParams.set("access_token", currentToken);

  let response: Response;
  try {
    response = await fetch(url.toString(), { cache: "no-store" });
  } catch (err) {
    return {
      success: false,
      error: `Network error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    return {
      success: false,
      error: `Refresh failed: ${response.status} ${response.statusText} — ${text}`,
    };
  }

  const data = (await response.json()) as {
    access_token: string;
    expires_in?: number;
  };

  const newToken = data.access_token;
  const expiresInSeconds = data.expires_in ?? 5_184_000; // ~60 days default
  const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);
  const expiresAtStr = expiresAt.toISOString().split("T")[0]; // YYYY-MM-DD

  setInstagramToken(newToken, expiresAtStr);

  return { success: true, expiresAt: expiresAtStr };
}

// ─── Exchange short-lived → long-lived ────────────────────────────────────────

/**
 * Exchange a short-lived Instagram token for a long-lived one (~60 days).
 * Requires INSTAGRAM_APP_SECRET to be set.
 */
export async function exchangeShortLivedToken(
  shortLivedToken: string
): Promise<ExchangeResult> {
  const appSecret = config.instagram.appSecret;
  if (!appSecret) {
    return { success: false, error: "INSTAGRAM_APP_SECRET is not set" };
  }

  const url = new URL(`${BASE_URL}/access_token`);
  url.searchParams.set("grant_type", "ig_exchange_token");
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("access_token", shortLivedToken);

  let response: Response;
  try {
    response = await fetch(url.toString(), { cache: "no-store" });
  } catch (err) {
    return {
      success: false,
      error: `Network error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    return {
      success: false,
      error: `Exchange failed: ${response.status} ${response.statusText} — ${text}`,
    };
  }

  const data = (await response.json()) as {
    access_token: string;
    expires_in?: number;
  };

  const newToken = data.access_token;
  const expiresInSeconds = data.expires_in ?? 5_184_000;
  const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);
  const expiresAtStr = expiresAt.toISOString().split("T")[0];

  setInstagramToken(newToken, expiresAtStr);

  return { success: true, accessToken: newToken, expiresAt: expiresAtStr };
}

