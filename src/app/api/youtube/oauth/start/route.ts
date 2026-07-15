import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { buildAuthUrl } from "@/lib/youtube/oauth";
import { oauthRedirectUri, OAUTH_STATE_COOKIE } from "../shared";

export const dynamic = "force-dynamic";

/**
 * GET /api/youtube/oauth/start — begin the consent flow.
 *
 * Mints a CSRF state, stores it in an httpOnly cookie, and 302s the browser to
 * Google's consent screen. The channel owner approves, Google redirects back to
 * /api/youtube/oauth/callback with the authorization code.
 */
export async function GET(request: NextRequest) {
  let redirectUri: string;
  try {
    redirectUri = oauthRedirectUri(request);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: "config", message }, { status: 500 });
  }

  const state = randomUUID();
  let authUrl: string;
  try {
    authUrl = buildAuthUrl(redirectUri, state);
  } catch (err) {
    // Missing YOUTUBE_OAUTH_CLIENT_ID — surface it rather than bouncing to Google.
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: "config", message }, { status: 500 });
  }

  const res = NextResponse.redirect(authUrl);
  res.cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600, // 10 min to complete consent
  });
  return res;
}
