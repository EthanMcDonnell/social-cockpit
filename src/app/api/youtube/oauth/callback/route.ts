import { NextRequest, NextResponse } from "next/server";
import { exchangeCode } from "@/lib/youtube/oauth";
import { oauthRedirectUri, OAUTH_STATE_COOKIE } from "../shared";

export const dynamic = "force-dynamic";

/** Bounce back to Settings with a status the panel can render. */
function backToSettings(request: NextRequest, params: Record<string, string>) {
  const url = new URL("/settings", request.nextUrl.origin);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = NextResponse.redirect(url);
  res.cookies.delete(OAUTH_STATE_COOKIE);
  return res;
}

/**
 * GET /api/youtube/oauth/callback — Google redirects here after consent with
 * `?code=` (success) or `?error=` (denied). Validates the CSRF state, exchanges
 * the code for a refresh token (persisted to .env), then returns to Settings.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const consentError = params.get("error");
  if (consentError) {
    return backToSettings(request, { yt: "error", reason: consentError });
  }

  const code = params.get("code");
  const state = params.get("state");
  const expectedState = request.cookies.get(OAUTH_STATE_COOKIE)?.value;

  if (!code) {
    return backToSettings(request, { yt: "error", reason: "missing_code" });
  }
  if (!state || !expectedState || state !== expectedState) {
    return backToSettings(request, { yt: "error", reason: "state_mismatch" });
  }

  const result = await exchangeCode(code, oauthRedirectUri(request));
  if (!result.success) {
    return backToSettings(request, { yt: "error", reason: result.error ?? "exchange_failed" });
  }
  return backToSettings(request, { yt: "connected" });
}
