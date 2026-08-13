/**
 * Instagram Graph API v25.0 fetch wrapper.
 * Server-side only — never import this in client components.
 */

import {
  InstagramError,
  InstagramTransportError,
  RateLimitError,
  type InstagramApiError,
} from "./types";
import { parseRateLimit } from "./rate-limit";

const BASE_URL = "https://graph.instagram.com/v25.0";
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_GET_ATTEMPTS = 2;
const RETRY_DELAY_MS = 750;
const SNIPPET_LEN = 200;

export interface FetchOptions {
  method?: "GET" | "POST" | "DELETE";
  params?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  /** Skip rate limit check for this request */
  skipRateLimitCheck?: boolean;
}

function buildUrl(path: string, params?: FetchOptions["params"]): string {
  // If path is already absolute (pagination next URLs), use it directly
  if (path.startsWith("http")) {
    const url = new URL(path);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  }

  const url = new URL(`${BASE_URL}${path}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
}

function getAccessToken(): string {
  const token = process.env.INSTAGRAM_ACCESS_TOKEN;
  if (!token) {
    throw new Error(
      "INSTAGRAM_ACCESS_TOKEN is not set. Add it to .env.local."
    );
  }
  return token;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One flattened line of a body, for error messages — HTML pages are enormous. */
function snippet(raw: string): string {
  const flat = raw.replace(/\s+/g, " ").trim();
  if (!flat) return "<empty body>";
  return flat.length > SNIPPET_LEN ? `${flat.slice(0, SNIPPET_LEN)}…` : flat;
}

export async function instagramFetch<T>(
  path: string,
  options: FetchOptions = {}
): Promise<T> {
  const method = options.method ?? "GET";

  // Only GETs are retried. A POST that failed in transport may still have landed
  // — retrying one could send the same DM twice, and the fired_automations dedupe
  // upstream can't catch that because it never sees the second attempt.
  const maxAttempts = method === "GET" ? MAX_GET_ATTEMPTS : 1;

  for (let attempt = 1; ; attempt++) {
    try {
      return await attemptFetch<T>(path, options);
    } catch (err) {
      if (
        attempt >= maxAttempts ||
        !(err instanceof InstagramTransportError) ||
        !err.retryable
      ) {
        throw err;
      }
      console.warn(
        `[instagram] ${method} ${path} — ${err.message}; retrying once in ${RETRY_DELAY_MS}ms`
      );
      await sleep(RETRY_DELAY_MS);
    }
  }
}

async function attemptFetch<T>(path: string, options: FetchOptions): Promise<T> {
  const { method = "GET", params, body, skipRateLimitCheck = false } = options;

  const token = getAccessToken();
  const url = buildUrl(path, params);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      // Never cache Instagram API responses — data changes frequently
      cache: "no-store",
    });
  } catch (err) {
    // No response at all: DNS/TCP/TLS fault, or our own timeout abort.
    throw new InstagramTransportError(
      controller.signal.aborted
        ? `request timed out after ${DEFAULT_TIMEOUT_MS}ms`
        : `request failed: ${err instanceof Error ? err.message : String(err)}`,
      { retryable: true, cause: err }
    );
  } finally {
    clearTimeout(timeoutId);
  }

  // Check rate limits before parsing body
  if (!skipRateLimitCheck) {
    const rateLimit = parseRateLimit(response.headers);
    if (rateLimit.isThrottled && rateLimit.usage) {
      throw new RateLimitError(rateLimit.usage);
    }
  }

  // Read the body as text first: a non-JSON body has to survive long enough to
  // be reported, and response.json() would discard it inside a bare SyntaxError.
  let raw: string;
  try {
    raw = await response.text();
  } catch (err) {
    throw new InstagramTransportError(
      `response body could not be read (${response.status} ${response.statusText})`,
      {
        status: response.status,
        statusText: response.statusText,
        retryable: true,
        cause: err,
      }
    );
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    // Meta's edge serves HTML for 5xx, gateway timeouts and block/challenge
    // pages. A 5xx is worth one retry; a 4xx page means something about the
    // request or the account, and retrying just repeats it.
    const preview = snippet(raw);
    throw new InstagramTransportError(
      `non-JSON response (${response.status} ${response.statusText}): ${preview}`,
      {
        status: response.status,
        statusText: response.statusText,
        bodySnippet: preview,
        retryable: response.status >= 500,
      }
    );
  }

  if (!response.ok) {
    const errData = data as InstagramApiError;
    if (errData?.error) {
      throw new InstagramError(errData.error);
    }
    throw new Error(`Instagram API error: ${response.status} ${response.statusText}`);
  }

  return data as T;
}
