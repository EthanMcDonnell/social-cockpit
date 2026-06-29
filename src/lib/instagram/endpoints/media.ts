import { instagramFetch } from "../client";
import type { InstagramMedia, MediaListResponse } from "../types";

const DEFAULT_FIELDS = [
  "id",
  "caption",
  "media_type",
  "media_url",
  "thumbnail_url",
  "permalink",
  "timestamp",
  "like_count",
  "comments_count",
  "shortcode",
  "media_product_type",
];

export async function listMedia(
  limit: number = 25,
  fields: string[] = DEFAULT_FIELDS
): Promise<MediaListResponse> {
  const accountId = process.env.INSTAGRAM_ACCOUNT_ID;
  if (!accountId) {
    throw new Error("INSTAGRAM_ACCOUNT_ID is not set. Add it to .env.local.");
  }

  return instagramFetch<MediaListResponse>(`/${accountId}/media`, {
    params: { fields: fields.join(","), limit },
  });
}

/**
 * Fetch a single cursor-paginated page of media. Pass `after` (the cursor from
 * a previous response's `paging.cursors.after`) to get the next page. Returns
 * the raw response including `paging` so callers can surface the next cursor.
 */
export async function listMediaPage(
  limit: number = 25,
  after?: string,
  fields: string[] = DEFAULT_FIELDS
): Promise<MediaListResponse> {
  const accountId = process.env.INSTAGRAM_ACCOUNT_ID;
  if (!accountId) {
    throw new Error("INSTAGRAM_ACCOUNT_ID is not set. Add it to .env.local.");
  }

  return instagramFetch<MediaListResponse>(`/${accountId}/media`, {
    params: { fields: fields.join(","), limit, after },
  });
}

export async function getAllMedia(
  fields: string[] = DEFAULT_FIELDS
): Promise<InstagramMedia[]> {
  const accountId = process.env.INSTAGRAM_ACCOUNT_ID;
  if (!accountId) {
    throw new Error("INSTAGRAM_ACCOUNT_ID is not set. Add it to .env.local.");
  }

  const results: InstagramMedia[] = [];
  let url: string = `/${accountId}/media`;
  let params: Record<string, string | number> | undefined = {
    fields: fields.join(","),
    limit: 100,
  };

  while (true) {
    const data = await instagramFetch<MediaListResponse>(url, {
      params,
    });

    results.push(...(data.data ?? []));

    const nextUrl = data.paging?.next;
    if (!nextUrl) break;

    // next URL is absolute — pass it directly, clear params
    url = nextUrl;
    params = undefined;
  }

  return results;
}

export async function getMedia(
  mediaId: string,
  fields: string[] = DEFAULT_FIELDS
): Promise<InstagramMedia> {
  return instagramFetch<InstagramMedia>(`/${mediaId}`, {
    params: { fields: fields.join(",") },
  });
}
