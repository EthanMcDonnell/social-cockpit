/**
 * Typed HTTP client for the running social-cockpit instance.
 *
 * This server deliberately speaks HTTP rather than opening `data/automations.db`
 * directly. The scheduler's worker owns that database and holds a WAL lock; a
 * second writer is precisely the failure mode `docs/scheduling.md` §8 warns
 * against. Everything here goes through the same routes the calendar UI uses, so
 * validation, timezone handling, and event logging all happen in exactly one
 * place.
 */

const BASE = (process.env.COCKPIT_URL ?? "http://localhost:3000").replace(/\/+$/, "");

/** How long a single cockpit call may take. `run` publishes inline, so it's slow. */
const DEFAULT_TIMEOUT_MS = 30_000;
const RUN_TIMEOUT_MS = 300_000;

/**
 * A cockpit request that failed in a way the model can act on — a bad path, an
 * unparseable time, a job that's already publishing. Carries the API's own
 * message, which is written for a human and is the most useful thing to return.
 */
export class CockpitError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "CockpitError";
    this.code = code;
    this.status = status;
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  timeoutMs?: number;
}

export async function cockpit<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const url = new URL(BASE + path);
  for (const [key, value] of Object.entries(opts.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";

  // Mirrors lib/schedule/auth.ts — a no-op unless the cockpit sets the token.
  const token = process.env.SCHEDULE_API_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (err) {
    // Nothing listening is by far the most common setup mistake, and the raw
    // "fetch failed" gives no hint about what to do next.
    const reason = err instanceof Error && err.name === "TimeoutError" ? "timed out" : "could not be reached";
    throw new CockpitError(
      "unreachable",
      `social-cockpit at ${BASE} ${reason}. Is the dev server running (\`npm run dev\` in the social-cockpit repo)? Set COCKPIT_URL if it listens elsewhere.`,
      0
    );
  }

  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new CockpitError(
      "bad_response",
      `${BASE}${path} returned ${response.status} with a non-JSON body: ${text.slice(0, 200)}`,
      response.status
    );
  }

  if (!response.ok) {
    const body = parsed as { error?: string; message?: string };
    throw new CockpitError(
      body.error ?? "http_error",
      body.message ?? `${response.status} ${response.statusText}`,
      response.status
    );
  }

  return parsed as T;
}

/** POST /api/schedule/:id/run publishes inline, so it gets the long timeout. */
export const runTimeout = RUN_TIMEOUT_MS;
export const cockpitBase = BASE;
