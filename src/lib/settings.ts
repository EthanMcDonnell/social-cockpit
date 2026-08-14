/**
 * The app's key/value settings table, in `automations.db`.
 *
 * These are the settings you *tune*, as opposed to the ones in `.env` that wire
 * the app up. The split matters because changing one of these has to take effect
 * without restarting a production server, which is exactly what `.env` cannot
 * do. See the header of `lib/config.ts` for the full three-way rule.
 *
 * This module exists because there used to be two of these tables: one here and
 * an identical `app_settings` in `transcripts.db`, with the same shape, the same
 * upsert SQL written twice, and no way to know which one held a given key
 * without reading the code that wrote it. Everything now lands here.
 *
 * Server-side only.
 */

import { getDb } from "@/lib/db";

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

/** Stored booleans are "1"/"0"; anything else is treated as unset. */
export function getBoolSetting(key: string, fallback: boolean): boolean {
  const stored = getSetting(key);
  if (stored === "1") return true;
  if (stored === "0") return false;
  return fallback;
}

export function setBoolSetting(key: string, value: boolean): void {
  setSetting(key, value ? "1" : "0");
}
