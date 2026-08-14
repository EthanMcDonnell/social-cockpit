/**
 * The credentials that rotate while the server runs.
 *
 * Three values change during normal operation: the Instagram access token and
 * its expiry (refreshed on a timer, ~60 days), and the YouTube refresh token
 * (written once when the channel is connected). Everything else in `.env` is
 * fixed for the life of a deployment.
 *
 * They used to be rewritten into `.env` itself. That is a well-documented
 * anti-pattern and it had three concrete problems here, not just a theoretical
 * one:
 *
 *   - The write was `fs.writeFileSync` over the whole file. A crash partway
 *     through truncated `.env` and took *every* credential with it, not just the
 *     one being rotated.
 *   - It raced with anything that regenerates `.env` — `infra/setup.sh` writes
 *     the R2 block, and a rotation landing mid-run could be lost or interleaved.
 *   - It forced every reader of these three to bypass the config snapshot,
 *     because the file behind it kept changing.
 *
 * They now live in `app_settings`, which is where mutable state belongs. `.env`
 * remains the *bootstrap*: paste a token in to get started, and the first
 * refresh moves it here for good.
 *
 * This module reads the database, so `config.ts` cannot own these accessors —
 * `db/index.ts` imports config, and the cycle would be real.
 *
 * Server-side only.
 */

import { readEnv } from "@/lib/config";
import { getSetting, setSetting } from "@/lib/settings";

const IG_TOKEN_KEY = "instagram.access_token";
const IG_EXPIRES_KEY = "instagram.token_expires_at";
const YT_REFRESH_KEY = "youtube.refresh_token";

/**
 * Stored value first, `.env` second.
 *
 * The fallback is what makes this need no migration: a fresh deployment finds
 * nothing in the database and reads the value that has always been in `.env`,
 * and the first rotation writes it here and the fallback goes quiet for good.
 */
function stored(key: string, envKey: string): string | undefined {
  return getSetting(key) ?? readEnv(envKey);
}

export function getInstagramAccessToken(): string | undefined {
  return stored(IG_TOKEN_KEY, "INSTAGRAM_ACCESS_TOKEN");
}

/** ISO date (YYYY-MM-DD). Drives the token-health display. */
export function getInstagramTokenExpiry(): string | undefined {
  return stored(IG_EXPIRES_KEY, "TOKEN_EXPIRES_AT");
}

/**
 * Persist a rotated Instagram token and its expiry together.
 *
 * One call, because they describe one fact. Writing them through separate
 * setters invites a path where the token is updated and the expiry is not,
 * leaving the health display confidently wrong about a credential that has
 * already changed.
 */
export function setInstagramToken(token: string, expiresAt: string): void {
  setSetting(IG_TOKEN_KEY, token);
  setSetting(IG_EXPIRES_KEY, expiresAt);
}

export function getYoutubeRefreshToken(): string | undefined {
  return stored(YT_REFRESH_KEY, "YOUTUBE_OAUTH_REFRESH_TOKEN");
}

export function setYoutubeRefreshToken(token: string): void {
  setSetting(YT_REFRESH_KEY, token);
}

/**
 * Boot check for credentials that may live in either place.
 *
 * `config.ts` validates `.env` and cannot see the database, so this is the other
 * half of the same fail-fast rule: called by `instrumentation.ts` right after
 * `assertConfigValid()`, once the DB is reachable. Without it, removing a
 * migrated token from `.env` would produce a server that starts happily and
 * fails on every Graph call instead.
 */
export function assertCredentialsPresent(): void {
  if (!getInstagramAccessToken()) {
    throw new Error(
      "No Instagram access token. Set INSTAGRAM_ACCESS_TOKEN in .env — after the " +
        "first refresh the live value is kept in the database and .env is only the " +
        "starting point."
    );
  }
}
