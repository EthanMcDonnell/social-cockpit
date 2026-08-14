/**
 * Every environment variable this app reads, declared once.
 *
 * Before this module, 34 files called `process.env` directly and each carried
 * its own inline default. Two copies of the same default could disagree and
 * nothing would say so, and a missing variable surfaced as a confusing failure
 * deep inside a request rather than as a statement about configuration.
 *
 * Three rules govern what belongs here:
 *
 *   1. `.env` holds wiring and credentials, where needing a restart to change a
 *      value is a feature. This module.
 *   2. `app_settings` holds decisions about *how you post*, which are tuned
 *      while the server runs. See `lib/schedule/settings.ts`.
 *   3. Values that bound how much the system can *send* are hardcoded and are
 *      deliberately absent from both. See `lib/automation-sender.ts`.
 *
 * Rule 3 is the important one. `MAX_SENDS_PER_WINDOW` is the ceiling on DMs per
 * minute across every flow and recipient. As a constant it cannot be mistyped,
 * left unset, or parsed wrong. Moving it here would convert an invariant into
 * something a bad line in a file can break, which is the exact failure mode the
 * cap exists to prevent, so it stays where it is.
 *
 * Validation is fail-fast: a missing required variable or an unparseable value
 * throws at startup rather than degrading into a running server with a wrong
 * number in it. `instrumentation.ts` imports this first so that throw happens at
 * boot, not on the first request that happens to touch the bad value.
 *
 * Server-side only.
 */

import path from "path";

// ─── Errors ──────────────────────────────────────────────────────────────────

export class ConfigError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(
      `Invalid configuration (${problems.length} problem${problems.length === 1 ? "" : "s"}):\n` +
        problems.map((p) => `  - ${p}`).join("\n") +
        `\n\nFix these in .env and restart. See .env.example for the full list.`
    );
    this.name = "ConfigError";
    this.problems = problems;
  }
}

/** Problems found while reading; thrown together so one restart shows them all. */
const problems: string[] = [];

// ─── Readers ─────────────────────────────────────────────────────────────────

/**
 * Read one variable, with the trimming rules below applied.
 *
 * Exported for `lib/credentials.ts`, which needs `.env` as a *fallback* source
 * for the rotating secrets rather than as their home. Nothing else should reach
 * for this — use the `config` object.
 */
export function readEnv(key: string): string | undefined {
  return raw(key);
}

function raw(key: string): string | undefined {
  const value = process.env[key];
  // A variable present but empty is the same as absent. `.env` files are full of
  // `KEY=` lines left behind by half-finished setup, and treating those as a set
  // value produces empty credentials rather than a clear "not configured".
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** Required string. Absence is a boot failure. */
function required(key: string, why: string): string {
  const value = raw(key);
  if (value === undefined) {
    problems.push(`${key} is required but not set (${why})`);
    return "";
  }
  return value;
}

/** Optional string. Absence is a legitimate state, not an error. */
function optional(key: string): string | undefined {
  return raw(key);
}

/** Positive integer with a fallback. A present-but-unparseable value is fatal. */
function int(key: string, fallback: number): number {
  const value = raw(key);
  if (value === undefined) return fallback;

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    problems.push(`${key} must be a positive number, got ${JSON.stringify(value)}`);
    return fallback;
  }
  return parsed;
}

/**
 * Strict boolean: only "true" or "false", case-insensitive.
 *
 * This is a deliberate tightening. The old call sites tested `=== "true"` and
 * `!== "false"`, which silently absorbed anything else — `SCHEDULER_ENABLED=no`
 * read as *enabled*, the opposite of what whoever typed it meant. A value that
 * cannot be interpreted is now a boot failure rather than a coin flip.
 */
function bool(key: string, fallback: boolean): boolean {
  const value = raw(key);
  if (value === undefined) return fallback;

  const lowered = value.toLowerCase();
  if (lowered === "true") return true;
  if (lowered === "false") return false;

  problems.push(`${key} must be "true" or "false", got ${JSON.stringify(value)}`);
  return fallback;
}

/** Absolute path with a fallback under the project's data directory. */
function dataPath(key: string, ...fallback: string[]): string {
  return raw(key) ?? path.join(process.cwd(), ...fallback);
}

/**
 * A credential set that is all-or-nothing.
 *
 * An integration that is entirely unconfigured is a normal state — plenty of
 * installs never touch R2 or YouTube, and refusing to boot over an unused
 * feature would be the fail-fast rule doing more harm than good. A *partly*
 * configured one is always a mistake, and unlike the all-absent case it is a
 * mistake we can recognise without knowing anything about the deployment.
 */
function group<K extends string>(
  label: string,
  keys: Record<K, string>
): { configured: boolean; values: Record<K, string | undefined> } {
  const values = {} as Record<K, string | undefined>;
  const present: string[] = [];
  const missing: string[] = [];

  for (const [field, key] of Object.entries(keys) as [K, string][]) {
    const value = raw(key);
    values[field] = value;
    (value === undefined ? missing : present).push(key);
  }

  if (present.length > 0 && missing.length > 0) {
    problems.push(
      `${label} is partly configured: ${present.join(", ")} set but ${missing.join(", ")} missing. ` +
        `Set all of them, or none to disable ${label}.`
    );
  }

  return { configured: missing.length === 0, values };
}

// ─── Declarations ────────────────────────────────────────────────────────────

const instagramAccountId = required(
  "INSTAGRAM_ACCOUNT_ID",
  "the account every Instagram call is made against"
);

// INSTAGRAM_ACCESS_TOKEN is deliberately NOT required here, though it is every
// bit as necessary as the account id. It rotates, and the current value lives in
// `app_settings` once it has been refreshed once — so an install that has been
// running for a while may legitimately have no token in `.env` at all. This
// module cannot read the database to find out (`db` imports this file), so the
// check belongs where both sources are visible: `assertCredentialsPresent()` in
// `lib/credentials.ts`, which `instrumentation.ts` calls straight after this.

const r2 = group("R2 storage", {
  accountId: "R2_ACCOUNT_ID",
  accessKeyId: "R2_ACCESS_KEY_ID",
  secretAccessKey: "R2_SECRET_ACCESS_KEY",
  bucket: "R2_BUCKET",
});

// The refresh token is deliberately not part of this group: the client ID and
// secret are typed in by hand during setup, while the refresh token arrives
// later from the OAuth callback. "Client configured, not yet connected" is the
// normal state between those two steps, not a misconfiguration.
const youtubeOAuth = group("YouTube OAuth", {
  clientId: "YOUTUBE_OAUTH_CLIENT_ID",
  clientSecret: "YOUTUBE_OAUTH_CLIENT_SECRET",
});

export const config = {
  instagram: {
    accountId: instagramAccountId,
    /** Only needed to exchange a short-lived token for a long-lived one. */
    appSecret: optional("INSTAGRAM_APP_SECRET"),
  },

  r2: {
    configured: r2.configured,
    ...r2.values,
    /** Nothing else bounds R2 spend, so the write path enforces this. */
    capBytes: int("R2_CAP_BYTES", 8 * 1024 * 1024 * 1024),
  },

  youtube: {
    apiKey: optional("YOUTUBE_API_KEY"),
    channelId: optional("YOUTUBE_CHANNEL_ID"),
    uploadsPlaylistId: optional("YOUTUBE_UPLOADS_PLAYLIST_ID"),
    oauth: {
      configured: youtubeOAuth.configured,
      ...youtubeOAuth.values,
      redirectUri: optional("YOUTUBE_OAUTH_REDIRECT_URI"),
    },
    /**
     * Whether the channel has passed Google's API audit. Until it has, uploads
     * are forced unlisted.
     *
     * The default is `false` on purpose and must stay that way: a configuration
     * mistake should make a video less visible, never more. This is the one flag
     * here where the two failure directions are not equally bad.
     */
    auditPassed: bool("YOUTUBE_AUDIT_PASSED", false),
  },

  schedule: {
    /**
     * Master switch for the publishing worker. Defaults on, matching the old
     * `!== "false"` test — an install that has been publishing does not silently
     * stop because this refactor landed.
     */
    enabled: bool("SCHEDULER_ENABLED", true),
    /** Worker runs and logs but never calls a publish API. */
    dryRun: bool("SCHEDULE_DRY_RUN", false),
    /** Bearer token for the schedule API. Absent means the API is unauthenticated. */
    apiToken: optional("SCHEDULE_API_TOKEN"),
    /** Fallback display zone when `app_settings` has no stored timezone. */
    timezone: optional("SCHEDULE_TIMEZONE"),
    intervalMs: int("SCHEDULE_INTERVAL_MS", 30_000),
    /** How late a job may fire before it is abandoned rather than published. */
    graceMinutes: int("SCHEDULE_GRACE_MINUTES", 60),
    mediaDir: dataPath("SCHEDULE_MEDIA_DIR", "data", "staged"),
    mediaCapBytes: int("SCHEDULE_MEDIA_CAP_BYTES", 20 * 1024 * 1024 * 1024),
  },

  /** Confines which paths the local-publish endpoint may read. Unset allows any. */
  localMediaRoot: optional("LOCAL_MEDIA_ROOT"),

  cache: {
    ttlMs: int("CACHE_TTL_MS", 30 * 60 * 1000),
    syncIntervalMs: int("CACHE_SYNC_INTERVAL_MS", 30 * 60 * 1000),
  },

  token: {
    refreshIntervalMs: int("TOKEN_REFRESH_INTERVAL_MS", 12 * 60 * 60 * 1000),
    refreshThresholdDays: int("TOKEN_REFRESH_THRESHOLD_DAYS", 10),
  },

  transcription: {
    /** Path to a Python interpreter. Absent disables transcription entirely. */
    python: optional("TRANSCRIPTION_PYTHON"),
    model: optional("TRANSCRIPTION_MODEL") ?? "small",
  },

  db: {
    main: dataPath("DB_PATH", "data", "automations.db"),
    cache: dataPath("CACHE_DB_PATH", "data", "cache.db"),
    transcripts: dataPath("TRANSCRIPTS_DB_PATH", "data", "transcripts.db"),
  },
} as const;

// ─── Validation ──────────────────────────────────────────────────────────────

/**
 * Throws if anything above was missing or unparseable.
 *
 * Called by `instrumentation.ts` before the workers start, so a bad `.env` stops
 * the server at boot with the full list rather than one problem at a time.
 */
export function assertConfigValid(): void {
  if (problems.length > 0) throw new ConfigError(problems);
}

/** The problems found, for diagnostics that want to report without throwing. */
export function configProblems(): readonly string[] {
  return problems;
}
