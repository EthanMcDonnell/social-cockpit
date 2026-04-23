"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { CommentListResponse } from "@/lib/instagram/types";

async function fetchComments(postId: string): Promise<CommentListResponse> {
  const res = await fetch(`/api/instagram/comments?post_id=${postId}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? "Failed to fetch comments");
  }
  return res.json();
}

export function useComments(postId: string | null) {
  return useQuery({
    queryKey: ["instagram", "comments", postId],
    queryFn: () => fetchComments(postId!),
    enabled: !!postId,
    staleTime: 0,
    refetchInterval: 60_000,
  });
}

export function useReplyToComment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ commentId, message, postId }: { commentId: string; message: string; postId: string }) => {
      const res = await fetch(`/api/instagram/comments/${commentId}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? "Failed to send reply");
      }
      return { postId };
    },
    onSuccess: ({ postId }) => {
      queryClient.invalidateQueries({ queryKey: ["instagram", "comments", postId] });
    },
  });
}

export function useSendDm() {
  return useMutation({
    mutationFn: async ({ commentId, text }: { commentId: string; text: string }) => {
      const res = await fetch(`/api/instagram/comments/${commentId}/dm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? "Failed to send DM");
      }
      return res.json();
    },
  });
}
