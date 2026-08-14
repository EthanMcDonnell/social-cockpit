/**
 * Wall-clock ↔ instant conversion in an arbitrary IANA zone, built on Intl.
 *
 * Slot planning is entirely about wall-clock time: "09:30 on the 16th" must mean
 * 09:30 where the cockpit thinks you are, and must keep meaning that across a DST
 * boundary. Everything is compared and stored as epoch ms; these two functions
 * are the only place the zone is applied.
 *
 * Deliberately mirrors the approach in the app's own `src/lib/schedule/tz.ts`
 * rather than adding a date library.
 */

export interface Wall {
  year: number;
  /** 1–12. */
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const cache = new Map<string, Intl.DateTimeFormat>();

function parts(timeZone: string): Intl.DateTimeFormat {
  let f = cache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    cache.set(timeZone, f);
  }
  return f;
}

/** The wall-clock reading in `timeZone` at an absolute instant. */
export function utcToWall(utcMs: number, timeZone: string): Wall {
  const found: Record<string, string> = {};
  for (const p of parts(timeZone).formatToParts(utcMs)) {
    if (p.type !== "literal") found[p.type] = p.value;
  }
  return {
    year: Number(found.year),
    month: Number(found.month),
    day: Number(found.day),
    // Some locales render midnight as "24"; normalise it to 0.
    hour: Number(found.hour) % 24,
    minute: Number(found.minute),
  };
}

/** The zone's UTC offset in ms at an instant. */
function offsetAt(utcMs: number, timeZone: string): number {
  const w = utcToWall(utcMs, timeZone);
  const seconds = Number(
    parts(timeZone)
      .formatToParts(utcMs)
      .find((p) => p.type === "second")?.value ?? "0"
  );
  const asIfUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, seconds);
  return asIfUtc - utcMs;
}

/**
 * The instant at which `timeZone` reads the given wall clock.
 *
 * Two passes: the offset depends on the instant we're solving for, so the first
 * guess is corrected by the offset it lands in. That settles every case except a
 * wall time inside a DST spring-forward gap, which doesn't exist — there the
 * result lands just after the gap, which is the sane reading for a posting slot.
 */
export function wallToUtc(w: Wall, timeZone: string): number {
  const naive = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute);
  let ts = naive - offsetAt(naive, timeZone);
  ts = naive - offsetAt(ts, timeZone);
  return ts;
}

/**
 * Midnight in `timeZone` on the calendar day containing `instant`, as an instant.
 *
 * Mirrors the app's `startOfDay` in `src/lib/schedule/tz.ts` — the boundary a
 * calendar day is measured from is a wall-clock fact, so it has to be resolved
 * through the zone rather than by rounding the epoch.
 */
export function startOfDay(instant: number, timeZone: string): number {
  return wallToUtc({ ...utcToWall(instant, timeZone), hour: 0, minute: 0 }, timeZone);
}

/** "YYYY-MM-DD" for the calendar day `instant` falls on in `timeZone`. */
export function dayKey(instant: number, timeZone: string): string {
  const w = utcToWall(instant, timeZone);
  return `${w.year}-${pad(w.month)}-${pad(w.day)}`;
}

/**
 * Day of the week (0 = Sunday) for a wall-clock date.
 *
 * Takes the wall reading rather than the instant: the instant of local midnight
 * can sit on either side of the UTC date line, so asking `Date` for its UTC day
 * is off by one for every zone at a positive offset.
 */
export function wallDayOfWeek(w: Wall): number {
  return new Date(Date.UTC(w.year, w.month - 1, w.day)).getUTCDay();
}

/**
 * An ISO-8601 string or epoch-ms string as an instant, or null if it is neither.
 *
 * Everything downstream compares and stores epoch ms; this is the one door
 * caller-supplied times come through.
 */
export function parseInstant(raw: string): number | null {
  if (/^\d+$/.test(raw)) return Number(raw);
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Zero-padded to two digits, for the wall-clock strings built from a `Wall`. */
export const pad = (n: number): string => String(n).padStart(2, "0");

/** Parse "HH:MM" into hour/minute, or null if it isn't one. */
export function parseTimeOfDay(value: string): { hour: number; minute: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

/** `n` whole days later, at the same wall-clock time (DST-safe). */
export function addDays(instant: number, days: number, timeZone: string): number {
  const w = utcToWall(instant, timeZone);
  return wallToUtc({ ...w, day: w.day + days }, timeZone);
}
