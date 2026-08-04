/**
 * Scheduler settings, backed by the `app_settings` key/value table.
 *
 * The display timezone lives here rather than in `.env` (where the transcription
 * toggle and API credentials live) for one reason: changing it silently changes
 * what every scheduled slot *means*, so it has to take effect immediately rather
 * than at the next restart of a production server we're told not to restart.
 *
 * Server-side only.
 */

import { getDb } from "@/lib/db";
import { isValidTimeZone, systemTimeZone } from "./tz";

const TZ_KEY = "calendar.timezone";

export function getSetting(key: string): string | null {
  const row = getDb()
    .prepare("SELECT value FROM app_settings WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO app_settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value,
                                        updated_at = datetime('now')`
    )
    .run(key, value);
}

/**
 * The zone the calendar renders in and bare `scheduled_at` strings are read in.
 * Falls back to SCHEDULE_TIMEZONE, then the host's own zone.
 */
export function getTimeZone(): string {
  const stored = getSetting(TZ_KEY);
  if (stored && isValidTimeZone(stored)) return stored;

  const fromEnv = process.env.SCHEDULE_TIMEZONE;
  if (fromEnv && isValidTimeZone(fromEnv)) return fromEnv;

  return systemTimeZone();
}

export function setTimeZone(tz: string): void {
  if (!isValidTimeZone(tz)) throw new Error(`Unknown timezone: ${tz}`);
  setSetting(TZ_KEY, tz);
}
