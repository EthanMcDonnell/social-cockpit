/**
 * YouTube Data API v3 fetch wrapper.
 * Server-side only — never import this in client components.
 *
 * Auth is an API key passed as the `key` query param (public read-only data).
 * This is the YouTube analog of ../instagram/client.ts.
 */

import {
  YoutubeError,
  YoutubeQuotaError,
  type YoutubeApiError,
} from "./types";

const BASE_URL = "https://www.googleapis.com/youtube/v3";
const DEFAULT_TIMEOUT_MS = 30_000;

export interface FetchOptions {
  method?: "GET";
  params?: Record<string, string | number | boolean | undefined>;
}

function getApiKey(): string {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) {
    throw new Error("YOUTUBE_API_KEY is not set. Add it to .env.");
  }
  return key;
}

function buildUrl(path: string, params?: FetchOptions["params"]): string {
  const url = new URL(`${BASE_URL}${path}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
  }
  url.searchParams.set("key", getApiKey());
  return url.toString();
}

export async function youtubeFetch<T>(
  path: string,
  options: FetchOptions = {}
): Promise<T> {
  const { method = "GET", params } = options;
  const url = buildUrl(path, params);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      // Never cache YouTube API responses — metrics change frequently.
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  const data = await response.json();

  if (!response.ok) {
    const errData = data as YoutubeApiError;
    const body = errData?.error;
    if (body) {
      const reason = body.errors?.[0]?.reason;
      if (response.status === 403 && reason === "quotaExceeded") {
        throw new YoutubeQuotaError(reason);
      }
      throw new YoutubeError(body);
    }
    throw new Error(`YouTube API error: ${response.status} ${response.statusText}`);
  }

  return data as T;
}
