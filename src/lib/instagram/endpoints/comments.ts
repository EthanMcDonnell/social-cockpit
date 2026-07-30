import { instagramFetch } from "../client";
import type { CommentListResponse, InstagramComment } from "../types";

const DEFAULT_COMMENT_FIELDS = [
  "id",
  "text",
  "timestamp",
  "username",
  "like_count",
  "hidden",
  "from{id,username}",
  "replies{id,text,timestamp,username,like_count,from{id,username}}",
];

/**
 * Trimmed field set for the automation worker, which only needs the keyword text,
 * who wrote it, when, and whether *we* already replied (replies[].from.id). The
 * default set's nested reply expansion (text/timestamp/username/like_count per
 * reply) makes each page several times heavier for no gain — heavy enough to hit
 * the 30s request timeout on posts with thousands of comments.
 */
export const AUTOMATION_COMMENT_FIELDS = [
  "id",
  "text",
  "timestamp",
  "username",
  "from{id,username}",
  "replies{id,from{id}}",
];

export async function listComments(
  mediaId: string,
  fields: string[] = DEFAULT_COMMENT_FIELDS
): Promise<CommentListResponse> {
  return instagramFetch<CommentListResponse>(`/${mediaId}/comments`, {
    params: { fields: fields.join(",") },
  });
}

export async function postComment(
  mediaId: string,
  message: string
): Promise<{ id: string }> {
  return instagramFetch<{ id: string }>(`/${mediaId}/comments`, {
    method: "POST",
    params: { message },
  });
}

export async function replyToComment(
  commentId: string,
  message: string
): Promise<{ id: string }> {
  return instagramFetch<{ id: string }>(`/${commentId}/replies`, {
    method: "POST",
    params: { message },
  });
}

export async function deleteComment(
  commentId: string
): Promise<{ success: boolean }> {
  return instagramFetch<{ success: boolean }>(`/${commentId}`, {
    method: "DELETE",
  });
}

export async function hideComment(
  commentId: string,
  hide: boolean = true
): Promise<{ success: boolean }> {
  return instagramFetch<{ success: boolean }>(`/${commentId}`, {
    method: "POST",
    params: { hide: String(hide).toLowerCase() },
  });
}

export async function sendPrivateReply(
  commentId: string,
  text: string
): Promise<{ recipient_id: string; message_id: string }> {
  const accountId = process.env.INSTAGRAM_ACCOUNT_ID;
  if (!accountId) {
    throw new Error("INSTAGRAM_ACCOUNT_ID is not set. Add it to .env.local.");
  }

  return instagramFetch<{ recipient_id: string; message_id: string }>(
    `/${accountId}/messages`,
    {
      method: "POST",
      body: {
        recipient: { comment_id: commentId },
        message: { text },
      },
    }
  );
}

function requireAccountId(): string {
  const accountId = process.env.INSTAGRAM_ACCOUNT_ID;
  if (!accountId) {
    throw new Error("INSTAGRAM_ACCOUNT_ID is not set. Add it to .env.local.");
  }
  return accountId;
}

/**
 * Plain DM to a known messaging-scoped id (reward / nudge), sent as a reply
 * inside the 24h window the confirm reply opened.
 */
export async function sendDirectMessage(
  recipientId: string,
  text: string
): Promise<{ recipient_id: string; message_id: string }> {
  const accountId = requireAccountId();
  return instagramFetch<{ recipient_id: string; message_id: string }>(
    `/${accountId}/messages`,
    {
      method: "POST",
      body: { recipient: { id: recipientId }, message: { text } },
    }
  );
}

export type { InstagramComment };
