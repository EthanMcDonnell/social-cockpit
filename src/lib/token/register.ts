import { getTokenStatus, refreshAccessToken } from "@/lib/token/manager";
import { config } from "@/lib/config";

// Proactively refresh the Instagram long-lived token before it expires.
// Instagram's ig_refresh_token only works on a still-valid token (>24h old) and
// extends it ~60 days, so we refresh once it drops within REFRESH_THRESHOLD_DAYS
// of expiry rather than waiting for it to lapse. Mirrors the cache/automation
// worker registration pattern.
const INTERVAL_MS = config.token.refreshIntervalMs;
const REFRESH_THRESHOLD_DAYS = config.token.refreshThresholdDays;

const tick = async () => {
  try {
    const { status, daysRemaining } = getTokenStatus();

    if (status === "expired") {
      console.error(
        "[token] Access token has expired and cannot be auto-refreshed. " +
          "Exchange a new short-lived token in Settings."
      );
      return;
    }

    if (status === "unknown") {
      console.warn(
        "[token] Token expiry unknown (TOKEN_EXPIRES_AT not set) — skipping auto-refresh."
      );
      return;
    }

    if (daysRemaining != null && daysRemaining > REFRESH_THRESHOLD_DAYS) {
      // Plenty of life left; nothing to do.
      return;
    }

    console.log(
      `[token] ${daysRemaining}d remaining — refreshing access token…`
    );
    const result = await refreshAccessToken();
    if (result.success) {
      console.log(`[token] Refreshed. New expiry: ${result.expiresAt}`);
    } else {
      console.error(`[token] Refresh failed: ${result.error}`);
    }
  } catch (err) {
    console.error("[token] refresh cycle error:", err);
  }
};

tick();
setInterval(tick, INTERVAL_MS);
