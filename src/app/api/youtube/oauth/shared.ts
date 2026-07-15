import type { NextRequest } from "next/server";

/** Cookie holding the CSRF state between /start and /callback. */
export const OAUTH_STATE_COOKIE = "yt_oauth_state";

/**
 * The redirect URI Google will call back. Must match one of the client's
 * Authorized redirect URIs exactly. Derived from the incoming request's origin
 * so it works on whatever host the app is served from; override with
 * YOUTUBE_OAUTH_REDIRECT_URI if the public origin differs from what Next sees
 * (e.g. behind a proxy).
 */
export function oauthRedirectUri(request: NextRequest): string {
  const override = process.env.YOUTUBE_OAUTH_REDIRECT_URI;
  if (override) return override;
  return `${request.nextUrl.origin}/api/youtube/oauth/callback`;
}
