import { instagramFetch } from "../client";
import type { CommentListResponse, InstagramComment } from "../types";

const DEFAULT_COMMENT_FIELDS = [
  "id",
  "text",
  "timestamp",
  "username",
  "like_count",
  "hidden",
  "replies{id,text,timestamp,username,like_count}",
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

export type { InstagramComment };
