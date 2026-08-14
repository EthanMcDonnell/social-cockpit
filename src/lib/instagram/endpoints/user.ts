import { instagramFetch } from "../client";
import { config } from "@/lib/config";
import type { InstagramProfile } from "../types";

const DEFAULT_FIELDS = [
  "id",
  "username",
  "name",
  "biography",
  "followers_count",
  "media_count",
  "profile_picture_url",
  "website",
  "account_type",
];

export async function getProfile(
  fields: string[] = DEFAULT_FIELDS
): Promise<InstagramProfile> {
  const accountId = config.instagram.accountId;

  return instagramFetch<InstagramProfile>(`/${accountId}`, {
    params: { fields: fields.join(",") },
  });
}

/**
 * User Profile API — read whether a messaging-scoped user follows this account.
 * Works ONLY after the user has messaged us (a reply, a DM, an icebreaker,
 * etc.); otherwise the API errors "User consent is required to access user
 * profile." The `igsid` is the messaging-scoped id returned by sendPrivateReply
 * as `recipient_id` — NOT a comment author id.
 */
export async function getFollowStatus(igsid: string): Promise<{
  is_user_follow_business: boolean;
  follower_count?: number;
  username?: string;
}> {
  return instagramFetch<{
    is_user_follow_business: boolean;
    follower_count?: number;
    username?: string;
  }>(`/${igsid}`, {
    params: { fields: "username,follower_count,is_user_follow_business" },
  });
}
