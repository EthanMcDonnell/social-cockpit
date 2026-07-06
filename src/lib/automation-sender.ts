import type { Database } from "better-sqlite3";

/**
 * The single send choke point for the comment_to_follow_dm funnel.
 *
 * Two distinct caps, easy to conflate:
 *  - MAX_NUDGES (per user) lives in follow_check_pending.nudge_count.
 *  - MAX_SENDS_PER_WINDOW (global) bounds how many DMs go out across everyone in
 *    a rolling window, so a viral-post burst of openers can't fire hundreds of
 *    near-identical DMs at machine speed and trip Instagram's abuse heuristics.
 *
 * Every outbound DM (opener, reward, nudge) routes through throttledSend so the
 * global cap, the jitter, and the opener_sent/reward_sent/nudge_sent + cap_hit
 * logging all live in exactly one place.
 */

const MAX_SENDS_PER_WINDOW = 12;
const WINDOW_SECONDS = 60;
const SEND_JITTER_MS: [number, number] = [1000, 4000];

export type EventLevel = "info" | "warn" | "error";

export interface EventFields {
  level?: EventLevel;
  kind: string;
  flow_id?: string;
  recipient_id?: string;
  comment_id?: string;
  message?: string;
  meta?: unknown;
}

/**
 * Cheap synchronous insert dropped at each branch. Never throws — a logging
 * failure must not break the funnel.
 */
export function logEvent(db: Database, e: EventFields): void {
  try {
    db.prepare(
      `INSERT INTO automation_events
         (flow_id, recipient_id, comment_id, level, kind, message, meta)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      e.flow_id ?? null,
      e.recipient_id ?? null,
      e.comment_id ?? null,
      e.level ?? "info",
      e.kind,
      e.message ?? null,
      e.meta === undefined ? null : JSON.stringify(e.meta)
    );
  } catch {
    /* swallow — observability must never break the funnel */
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rand = (min: number, max: number) => min + Math.random() * (max - min);

// The event log doubles as the rate-limiter state — no separate counter needed.
function sendsInWindow(db: Database): number {
  return (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM automation_events
           WHERE kind IN ('opener_sent','reward_sent','nudge_sent')
             AND created_at > datetime('now', ?)`
      )
      .get(`-${WINDOW_SECONDS} seconds`) as { c: number }
  ).c;
}

/**
 * Cheap pre-check so a caller can withhold *both* a public reply and an opener
 * when the window budget is already spent, rather than posting a public reply it
 * can't follow up on. throttledSend still re-checks at send time.
 */
export function hasSendBudget(db: Database): boolean {
  return sendsInWindow(db) < MAX_SENDS_PER_WINDOW;
}

/**
 * Returns true if sent, false if deferred (budget exhausted this window). A
 * false return means the caller must NOT claim / advance its cursor, so the
 * work rolls forward to the next cycle rather than vanishing.
 */
export async function throttledSend(
  db: Database,
  kind: "opener_sent" | "reward_sent" | "nudge_sent",
  meta: { flow_id?: string; recipient_id?: string; comment_id?: string },
  doSend: () => Promise<void>
): Promise<boolean> {
  if (sendsInWindow(db) >= MAX_SENDS_PER_WINDOW) {
    logEvent(db, {
      level: "warn",
      kind: "cap_hit",
      message: `deferred ${kind}: per-window send cap`,
      ...meta,
    });
    return false;
  }
  await sleep(rand(...SEND_JITTER_MS));
  try {
    await doSend();
    logEvent(db, { level: "info", kind, ...meta });
    return true;
  } catch (err) {
    logEvent(db, {
      level: "error",
      kind: "send_error",
      message: String(err),
      ...meta,
    });
    throw err;
  }
}
