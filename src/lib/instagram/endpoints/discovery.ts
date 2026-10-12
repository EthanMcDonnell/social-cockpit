/**
 * Business Discovery: another public Business/Creator account's profile and its
 * recent posts, view counts included.
 *
 * It lives on graph.facebook.com and only answers a Facebook Login token, so it
 * signs with `config.facebook` rather than the Instagram Login token every other
 * call uses. Meta returns posts newest first with no sort of its own, so "top"
 * can only ever mean top among the most recent `scan` posts.
 */

import { instagramFetch } from "../client";
import { config } from "@/lib/config";

const GRAPH = "https://graph.facebook.com/v25.0";
const PAGE_SIZE = 50;
export const MAX_SCAN = 200;

// Instagram's own username rule. Checked rather than escaped because the name is
// spliced into the field expansion, where a stray brace would change the query.
const USERNAME = /^[A-Za-z0-9._]{1,30}$/;

const PROFILE_FIELDS = "username,name,biography,followers_count,media_count";
const MEDIA_FIELDS =
  "id,caption,media_type,media_product_type,timestamp,permalink,media_url," +
  "view_count,like_count,comments_count";

export interface DiscoveredPost {
  id: string;
  caption?: string;
  media_type: string;
  media_product_type?: string;
  timestamp: string;
  permalink?: string;
  /** Omitted by Meta when the post carries copyrighted material, e.g. licensed reel audio. Expires. */
  media_url?: string;
  view_count?: number;
  like_count?: number;
  comments_count?: number;
}

export interface DiscoveredAccount {
  username: string;
  name?: string;
  biography?: string;
  followers_count?: number;
  media_count?: number;
  /** Newest first. */
  posts: DiscoveredPost[];
}

interface DiscoveryResponse {
  business_discovery: Omit<DiscoveredAccount, "posts"> & {
    media?: { data: DiscoveredPost[]; paging?: { cursors?: { after?: string } } };
  };
}

export class DiscoveryNotConfiguredError extends Error {
  constructor() {
    super(
      "Business Discovery is not configured. Set FACEBOOK_ACCESS_TOKEN and " +
        "FACEBOOK_INSTAGRAM_ACCOUNT_ID (see docs/instagram-setup.md)."
    );
    this.name = "DiscoveryNotConfiguredError";
  }
}

/** Profile plus the `scan` most recent posts of a public Business/Creator account. */
export async function discoverAccount(username: string, scan = 50): Promise<DiscoveredAccount> {
  const { configured, accessToken, instagramAccountId } = config.facebook;
  if (!configured || !accessToken || !instagramAccountId) {
    throw new DiscoveryNotConfiguredError();
  }

  const handle = username.trim().replace(/^@/, "");
  if (!USERNAME.test(handle)) {
    throw new RangeError(`Not an Instagram username: ${JSON.stringify(username)}`);
  }
  const want = Math.min(Math.max(1, Math.floor(scan)), MAX_SCAN);

  const posts: DiscoveredPost[] = [];
  let profile: Omit<DiscoveredAccount, "posts"> = { username: handle };
  let after: string | undefined;

  while (posts.length < want) {
    const page = Math.min(PAGE_SIZE, want - posts.length);
    const media = `media${after ? `.after(${after})` : ""}.limit(${page}){${MEDIA_FIELDS}}`;

    const { business_discovery } = await instagramFetch<DiscoveryResponse>(
      `${GRAPH}/${instagramAccountId}`,
      {
        params: { fields: `business_discovery.username(${handle}){${PROFILE_FIELDS},${media}}` },
        accessToken,
      }
    );

    const { media: found, ...rest } = business_discovery;
    profile = rest;
    const data = found?.data ?? [];
    posts.push(...data);

    // No next/previous links on this edge, only cursors, so a short page is the
    // only reliable end-of-feed signal.
    after = found?.paging?.cursors?.after;
    if (!after || data.length < page) break;
  }

  return { ...profile, posts };
}
