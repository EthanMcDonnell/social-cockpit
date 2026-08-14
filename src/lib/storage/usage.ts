/**
 * R2 storage usage gate — enforces R2_CAP_BYTES in the write path since R2 has no
 * native write-blocking cap. See docs/r2-integration.md.
 *
 * reserve() is called before a presigned PUT is issued; release() after the object
 * is deleted. Because the presigned PUT pins an exact Content-Length, the reserved
 * size is always the actual uploaded size — there's no separate reconcile step here.
 *
 * The publish paths (success, 202→finalize, failure) all release() explicitly. An
 * upload abandoned before any publish call (e.g. the tab is closed right after the
 * PUT) never does — so its row would count against the cap forever. Those orphaned
 * objects are themselves reclaimed by the bucket's publish/ lifecycle rule, so any
 * reservation older than that window has no object behind it and is safe to drop.
 * reserve() sweeps them first (see sweepStaleReservations), keeping the cap
 * self-maintaining without a background job. Only the r2_reservations table is
 * touched. (A full bucket-listing reconciliation is still a possible Phase 3.)
 */

import { getDb } from "@/lib/db";
import { config } from "@/lib/config";

// Upper bound on how long a reservation can legitimately be in flight before its
// object has certainly left the bucket. Keep this >= the R2 publish/ lifecycle
// expiry (Terraform `object_ttl_days`, default 1 day); raise it if you raise that.
const RESERVATION_TTL_HOURS = 24;

function capBytes(): number {
  return config.r2.capBytes;
}

/**
 * Drop reservations old enough that their object has certainly been reclaimed by
 * the bucket lifecycle rule — i.e. abandoned uploads that never reached release().
 * Safe because created_at is DB-generated UTC and we only delete rows past the TTL.
 */
function sweepStaleReservations(): void {
  getDb()
    .prepare("DELETE FROM r2_reservations WHERE created_at < datetime('now', ?)")
    .run(`-${RESERVATION_TTL_HOURS} hours`);
}

function reservedBytes(): number {
  const db = getDb();
  const row = db.prepare("SELECT COALESCE(SUM(size_bytes), 0) AS total FROM r2_reservations").get() as
    | { total: number }
    | undefined;
  return row?.total ?? 0;
}

/**
 * Reserve `sizeBytes` for `key` if there's headroom under the cap. Returns false
 * (reserve nothing, issue no URL) when it would exceed the cap.
 */
export function reserve(key: string, sizeBytes: number): boolean {
  const db = getDb();
  sweepStaleReservations();
  if (reservedBytes() + sizeBytes > capBytes()) return false;
  db.prepare("INSERT INTO r2_reservations (key, size_bytes) VALUES (?, ?)").run(key, sizeBytes);
  return true;
}

/** Drop the reservation for `key` — call after the R2 object is deleted. */
export function release(key: string): void {
  getDb().prepare("DELETE FROM r2_reservations WHERE key = ?").run(key);
}
