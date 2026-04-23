/**
 * Instagram Graph API v25.0 fetch wrapper.
 * Server-side only — never import this in client components.
 */

import {
  InstagramError,
  RateLimitError,
  type InstagramApiError,
} from "./types";
import { parseRateLimit } from "./rate-limit";

const BASE_URL = "https://graph.instagram.com/v25.0";
const DEFAULT_TIMEOUT_MS = 30_000;

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

export async function instagramFetch<T>(
  path: string,
  options: FetchOptions = {}
): Promise<T> {
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

  const data = await response.json();

  if (!response.ok) {
    const errData = data as InstagramApiError;
    if (errData?.error) {
      throw new InstagramError(errData.error);
    }
    throw new Error(`Instagram API error: ${response.status} ${response.statusText}`);
  }

  return data as T;
}
