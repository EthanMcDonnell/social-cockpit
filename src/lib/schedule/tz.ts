/**
 * Timezone arithmetic for the calendar, built on Intl — no dependency.
 *
 * Everything the scheduler stores is an absolute instant (epoch ms, UTC). The
 * calendar, however, is entirely about *wall clock* time in one chosen zone:
 * "Thursday 9am" must mean 9am where the user is, whatever the server thinks it
 * is, and must keep meaning that across a DST boundary.
 *
 * So there are exactly two conversions, and they're the only place zone logic
 * lives:
 *   wallToUtc()  — "2026-08-12 09:30 in America/Chicago" → epoch ms
 *   utcToWall()  — epoch ms → those wall-clock components
 *
 * Pure and isomorphic: the API route parses with it and the browser renders with
 * it, so a slot can't mean two different things at the two ends.
 */

export interface WallClock {
  year: number;
  /** 1–12, not the JS 0–11. */
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const PARTS_FORMAT: Intl.DateTimeFormatOptions = {
  hour12: false,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { ...PARTS_FORMAT, timeZone });
    formatterCache.set(timeZone, f);
  }
  return f;
}

/** Whether a string is an IANA zone this runtime actually knows. */
export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The wall-clock reading in `timeZone` at an absolute instant. */
export function utcToWall(utcMs: number, timeZone: string): WallClock {
  const parts = partsFormatter(timeZone).formatToParts(new Date(utcMs));
  const map: Record<string, string> = {};
  for (const p of parts) if (p.type !== "literal") map[p.type] = p.value;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    // Intl can render midnight as "24" under hour12:false in some runtimes.
    hour: Number(map.hour) % 24,
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

/** `timeZone`'s UTC offset, in ms, at an absolute instant. */
export function offsetAt(utcMs: number, timeZone: string): number {
  const w = utcToWall(utcMs, timeZone);
  const asIfUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  // Trim to whole seconds so sub-second noise doesn't leak into the offset.
  return asIfUtc - Math.floor(utcMs / 1000) * 1000;
}

/**
 * The instant at which `timeZone`'s clock reads these wall-clock components.
 *
 * Two passes, because the offset we need is the one *at the answer*, not at the
 * guess: near a DST transition the first estimate can be an hour out, and the
 * second pass lands it. On the two genuinely ambiguous readings — the hour that
 * repeats when clocks go back, and the hour that doesn't exist when they go
 * forward — this resolves consistently rather than throwing, which is the right
 * trade for a scheduler (a post going out at one of two adjacent instants is
 * fine; refusing to schedule it is not).
 */
export function wallToUtc(wall: WallClock, timeZone: string): number {
  const naive = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second
  );
  let guess = naive - offsetAt(naive, timeZone);
  guess = naive - offsetAt(guess, timeZone);
  return guess;
}

/** Midnight (00:00:00 local) on the day containing `utcMs`, as epoch ms. */
export function startOfDay(utcMs: number, timeZone: string): number {
  const w = utcToWall(utcMs, timeZone);
  return wallToUtc({ ...w, hour: 0, minute: 0, second: 0 }, timeZone);
}

/**
 * Add whole days in *wall-clock* terms, not by adding 86 400 000 ms. Across a
 * DST boundary a local day is 23 or 25 hours long, and a week grid that drifts
 * by an hour on the last day is the classic calendar bug.
 */
export function addDays(utcMs: number, days: number, timeZone: string): number {
  const w = utcToWall(utcMs, timeZone);
  return wallToUtc({ ...w, day: w.day + days }, timeZone);
}

export function addMinutes(utcMs: number, minutes: number): number {
  return utcMs + minutes * 60_000;
}

/** 0 = Sunday … 6 = Saturday, in `timeZone`. */
export function dayOfWeek(utcMs: number, timeZone: string): number {
  const w = utcToWall(utcMs, timeZone);
  return new Date(Date.UTC(w.year, w.month - 1, w.day)).getUTCDay();
}

/** Local midnight on the Monday of the week containing `utcMs`. */
export function startOfWeek(utcMs: number, timeZone: string, weekStartsOn = 1): number {
  const dow = dayOfWeek(utcMs, timeZone);
  const delta = (dow - weekStartsOn + 7) % 7;
  return startOfDay(addDays(utcMs, -delta, timeZone), timeZone);
}

/** Local midnight on the 1st of the month containing `utcMs`. */
export function startOfMonth(utcMs: number, timeZone: string): number {
  const w = utcToWall(utcMs, timeZone);
  return wallToUtc({ ...w, day: 1, hour: 0, minute: 0, second: 0 }, timeZone);
}

export function addMonths(utcMs: number, months: number, timeZone: string): number {
  const w = utcToWall(utcMs, timeZone);
  return wallToUtc({ ...w, month: w.month + months, day: 1, hour: 0, minute: 0, second: 0 }, timeZone);
}

export function sameLocalDay(a: number, b: number, timeZone: string): boolean {
  const wa = utcToWall(a, timeZone);
  const wb = utcToWall(b, timeZone);
  return wa.year === wb.year && wa.month === wb.month && wa.day === wb.day;
}

/** Snap an instant to the nearest `stepMinutes` boundary of the local hour. */
export function snapToStep(utcMs: number, stepMinutes: number, timeZone: string): number {
  const w = utcToWall(utcMs, timeZone);
  const snapped = Math.round(w.minute / stepMinutes) * stepMinutes;
  return wallToUtc(
    { ...w, minute: snapped % 60, hour: w.hour + Math.floor(snapped / 60), second: 0 },
    timeZone
  );
}

// ─── Parsing / formatting ────────────────────────────────────────────────────

const ISO_WITH_ZONE = /(?:Z|[+-]\d{2}:?\d{2})$/i;
const NAIVE_DATETIME =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/;

/**
 * Parse a caller-supplied schedule time to epoch ms.
 *
 * - a number, or a numeric string → epoch ms, used as-is
 * - an ISO string carrying Z or ±HH:MM → absolute, zone ignored
 * - a bare "2026-08-12T09:30" → interpreted in `timeZone`, which is what
 *   someone typing a time into a calendar means
 *
 * Returns null when it isn't a time at all.
 */
export function parseScheduledAt(input: unknown, timeZone: string): number | null {
  if (typeof input === "number") return Number.isFinite(input) ? input : null;
  if (typeof input !== "string") return null;

  const trimmed = input.trim();
  if (!trimmed) return null;

  if (/^\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }

  if (ISO_WITH_ZONE.test(trimmed)) {
    const ms = Date.parse(trimmed);
    return Number.isNaN(ms) ? null : ms;
  }

  const m = NAIVE_DATETIME.exec(trimmed);
  if (!m) {
    const ms = Date.parse(trimmed);
    return Number.isNaN(ms) ? null : ms;
  }

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4] ?? 0);
  const minute = Number(m[5] ?? 0);
  const second = Number(m[6] ?? 0);
  // Validate civil components before Date.UTC can normalize 2026-02-31 into
  // March. Valid DST gaps/overlaps are still deliberately resolved by wallToUtc.
  if (
    month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate() ||
    hour > 23 || minute > 59 || second > 59
  ) {
    return null;
  }

  return wallToUtc({ year, month, day, hour, minute, second }, timeZone);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-08-12T09:30" — the value an <input type="datetime-local"> wants. */
export function toLocalInputValue(utcMs: number, timeZone: string): string {
  const w = utcToWall(utcMs, timeZone);
  return `${w.year}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}`;
}

/** "09:30" in the given zone. */
export function formatTime(utcMs: number, timeZone: string): string {
  const w = utcToWall(utcMs, timeZone);
  return `${pad(w.hour)}:${pad(w.minute)}`;
}

export function formatDateTime(utcMs: number, timeZone: string): string {
  const w = utcToWall(utcMs, timeZone);
  return `${w.year}-${pad(w.month)}-${pad(w.day)} ${pad(w.hour)}:${pad(w.minute)}`;
}

/** The zone's short name at an instant, e.g. "CDT" — for the calendar header. */
export function zoneAbbreviation(utcMs: number, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "short",
    }).formatToParts(new Date(utcMs));
    return parts.find((p) => p.type === "timeZoneName")?.value ?? timeZone;
  } catch {
    return timeZone;
  }
}

/** The browser's own zone — the sane default before anyone picks one. */
export function systemTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
