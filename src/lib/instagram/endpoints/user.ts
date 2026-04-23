import { instagramFetch } from "../client";
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
  const accountId = process.env.INSTAGRAM_ACCOUNT_ID;
  if (!accountId) {
    throw new Error("INSTAGRAM_ACCOUNT_ID is not set. Add it to .env.local.");
  }

  return instagramFetch<InstagramProfile>(`/${accountId}`, {
    params: { fields: fields.join(",") },
  });
}
