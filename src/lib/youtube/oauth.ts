/**
 * YouTube OAuth 2.0 (installed-app / single-channel-owner flow).
 * Server-side only — never import this in client components.
 *
 * The read path (dashboard metrics, video list) authenticates with an API key
 * (see ./client.ts). Writes — uploading a video, replying to a comment — are
 * performed *on behalf of the channel owner* and require OAuth. This module owns
 * that: it turns a one-time consent code into a long-lived refresh token stored
 * in `.env`, then mints short-lived access tokens on demand and caches them in
 * process. It is the YouTube analog of ../token/manager.ts.
 *
 * The refresh token is persisted through lib/credentials.ts, not written back
 * into .env — see that module for why.
 *
 * Docs: https://developers.google.com/identity/protocols/oauth2/web-server
 */

import { config } from "@/lib/config";
import { getYoutubeRefreshToken, setYoutubeRefreshToken } from "@/lib/credentials";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

/**
 * `youtube.upload` covers videos.insert; `youtube.force-ssl` covers comment
 * insert/moderation (phase 3). Requesting both now means the phase-3 comment
 * work needs no re-consent.
 */
export const YOUTUBE_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.force-ssl",
];

// Refresh access tokens ~1 min before Google's stated expiry so an in-flight
// upload never starts with a token about to lapse.
const EXPIRY_SKEW_MS = 60_000;

interface CachedToken {
  accessToken: string;
  expiresAt: number; // epoch ms
}

let _cache: CachedToken | null = null;

function clientId(): string {
  const id = config.youtube.oauth.clientId;
  if (!id) throw new Error("YOUTUBE_OAUTH_CLIENT_ID is not set. Add it to .env.");
  return id;
}

function clientSecret(): string {
  const secret = config.youtube.oauth.clientSecret;
  if (!secret) throw new Error("YOUTUBE_OAUTH_CLIENT_SECRET is not set. Add it to .env.");
  return secret;
}

/** True once a refresh token is on hand — i.e. the channel has been connected. */
export function isConnected(): boolean {
  return !!getYoutubeRefreshToken();
}

/**
 * The consent-screen URL to send the channel owner to. `state` is echoed back to
 * the callback for CSRF matching; `redirectUri` must be one of the authorized
 * redirect URIs registered on the OAuth client.
 */
export function buildAuthUrl(redirectUri: string, state: string): string {
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set("client_id", clientId());
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", YOUTUBE_SCOPES.join(" "));
  // offline + consent forces Google to return a refresh_token even on re-auth.
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", state);
  return url.toString();
}

/**
 * The channel's consent is gone or was never given — a revoked refresh token, a
 * password change, a client whose secret rotated. Typed rather than thrown as a
 * plain Error so callers can tell it apart from a transient token-endpoint
 * blip: no amount of retrying fixes it, and the only cure is reconnecting.
 */
export class YoutubeAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "YoutubeAuthError";
  }
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

/**
 * The token endpoint answered, and refused. Carries its status so the caller can
 * tell "this credential is dead" from "Google is having a moment".
 */
class TokenEndpointError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "TokenEndpointError";
  }
}

async function postToken(params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || data.error) {
    throw new TokenEndpointError(
      data.error_description || data.error || `Token endpoint returned ${res.status}`,
      res.status
    );
  }
  return data;
}

export interface ExchangeResult {
  success: boolean;
  error?: string;
}

/**
 * Exchange a one-time authorization code for a refresh token and persist it to
 * `.env`. The access token that comes back is cached so the next upload doesn't
 * have to immediately refresh.
 */
export async function exchangeCode(code: string, redirectUri: string): Promise<ExchangeResult> {
  let data: TokenResponse;
  try {
    data = await postToken({
      code,
      client_id: clientId(),
      client_secret: clientSecret(),
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    });
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }

  if (!data.refresh_token) {
    // Google only returns a refresh_token when access_type=offline AND this is a
    // fresh consent (prompt=consent). buildAuthUrl sets both, so an absence here
    // means the user previously consented without our forcing re-consent.
    return {
      success: false,
      error:
        "No refresh token returned. Revoke this app's access at " +
        "myaccount.google.com/permissions and connect again.",
    };
  }

  setYoutubeRefreshToken(data.refresh_token);

  if (data.access_token) {
    _cache = {
      accessToken: data.access_token,
      expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 - EXPIRY_SKEW_MS,
    };
  }
  return { success: true };
}

/**
 * A valid access token for the channel owner, minted from the stored refresh
 * token and cached in-process until shortly before it expires. Throws if the
 * channel has never been connected.
 */
export async function getAccessToken(): Promise<string> {
  if (_cache && _cache.expiresAt > Date.now()) return _cache.accessToken;

  const refreshToken = getYoutubeRefreshToken();
  if (!refreshToken) {
    throw new YoutubeAuthError(
      "YouTube is not connected. Connect the channel in Settings before uploading."
    );
  }

  // Google reports a dead refresh token as a plain 400 ("Token has been expired
  // or revoked."). Re-throwing it as an auth failure is what stops a scheduled
  // upload recording it as an unexplained internal fault. A 5xx, a rate limit,
  // or a transport error is left alone: those are worth retrying, and the
  // scheduler can only know that if they keep their own shape.
  let data: TokenResponse;
  try {
    data = await postToken({
      client_id: clientId(),
      client_secret: clientSecret(),
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    });
  } catch (err) {
    if (err instanceof TokenEndpointError && err.status < 500 && err.status !== 429) {
      throw new YoutubeAuthError(`${err.message} — reconnect the channel in Settings.`);
    }
    throw err;
  }
  if (!data.access_token) {
    throw new YoutubeAuthError("Refresh did not return an access token — reconnect the channel.");
  }

  _cache = {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 - EXPIRY_SKEW_MS,
  };
  return _cache.accessToken;
}

/** Drop the cached access token (e.g. after a 401) so the next call re-mints. */
export function clearTokenCache(): void {
  _cache = null;
}
