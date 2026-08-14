/**
 * Token manager for Instagram long-lived access tokens.
 * Server-side only. Reads and writes .env (NOT .env.local — the comments here
 * said otherwise for a long time while ENV_FILE below always resolved .env).
 */

import fs from "fs";
import path from "path";
import type { TokenState, RefreshResult, ExchangeResult } from "./types";
import { config, liveEnv } from "@/lib/config";

const BASE_URL = "https://graph.instagram.com";
const WARNING_THRESHOLD_DAYS = 7;
const ENV_FILE = path.resolve(process.cwd(), ".env");

// ─── Status ───────────────────────────────────────────────────────────────────

export function getTokenStatus(): TokenState {
  const expiresAtStr = liveEnv.instagramTokenExpiresAt;

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
 * Writes the new token and expiry back to .env.
 */
export async function refreshAccessToken(): Promise<RefreshResult> {
  const currentToken = liveEnv.instagramAccessToken;
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

  // Write back to .env
  writeEnvVar(ENV_FILE, "INSTAGRAM_ACCESS_TOKEN", newToken);
  writeEnvVar(ENV_FILE, "TOKEN_EXPIRES_AT", expiresAtStr);

  // Update process.env so subsequent calls in the same process see the new values
  process.env.INSTAGRAM_ACCESS_TOKEN = newToken;
  process.env.TOKEN_EXPIRES_AT = expiresAtStr;

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

  writeEnvVar(ENV_FILE, "INSTAGRAM_ACCESS_TOKEN", newToken);
  writeEnvVar(ENV_FILE, "TOKEN_EXPIRES_AT", expiresAtStr);

  process.env.INSTAGRAM_ACCESS_TOKEN = newToken;
  process.env.TOKEN_EXPIRES_AT = expiresAtStr;

  return { success: true, accessToken: newToken, expiresAt: expiresAtStr };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Update or append an environment variable in the .env file.
 * Uses regex replace — same pattern as the Python client.
 */
function writeEnvVar(filePath: string, key: string, value: string): void {
  try {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, `${key}=${value}\n`, "utf-8");
      return;
    }

    let text = fs.readFileSync(filePath, "utf-8");
    const pattern = new RegExp(`^${key}=.*$`, "m");

    if (pattern.test(text)) {
      text = text.replace(pattern, `${key}=${value}`);
    } else {
      text = text.replace(/\n?$/, `\n${key}=${value}\n`);
    }

    fs.writeFileSync(filePath, text, "utf-8");
  } catch (err) {
    throw new Error(
      `Failed to write ${key} to ${filePath}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
