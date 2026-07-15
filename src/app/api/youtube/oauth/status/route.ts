import { NextResponse } from "next/server";
import { isConnected, getAccessToken } from "@/lib/youtube/oauth";
import { getChannelStats } from "@/lib/youtube/endpoints/channel";

export const dynamic = "force-dynamic";

export interface YoutubeConnectionStatus {
  /** OAuth client credentials present in .env — required before connecting. */
  configured: boolean;
  /** A refresh token is stored — the channel owner has completed consent. */
  connected: boolean;
  /** The stored refresh token still mints an access token. */
  healthy: boolean;
  /** Channel display name (read via the API key, independent of OAuth). */
  channelTitle?: string;
  error?: string;
}

/**
 * GET /api/youtube/oauth/status — drives the Settings "Connect YouTube" panel.
 * Reports config/connection/health separately so the panel can tell "set your
 * env vars" apart from "click connect" apart from "reconnect, token is stale".
 */
export async function GET() {
  const configured = !!(
    process.env.YOUTUBE_OAUTH_CLIENT_ID && process.env.YOUTUBE_OAUTH_CLIENT_SECRET
  );
  const connected = isConnected();

  const status: YoutubeConnectionStatus = { configured, connected, healthy: false };

  // Channel title is a read-path (API key) call and works even pre-OAuth.
  try {
    status.channelTitle = (await getChannelStats()).title;
  } catch {
    /* API key missing/invalid — leave title undefined, not fatal for OAuth status */
  }

  if (connected) {
    try {
      await getAccessToken();
      status.healthy = true;
    } catch (err) {
      status.error = err instanceof Error ? err.message : "Token refresh failed";
    }
  }

  return NextResponse.json(status);
}
