"use client";

import { useState } from "react";
import { clsx } from "clsx";
import { useComments, useReplyToComment } from "@/hooks/useComments";
import type { InstagramComment } from "@/lib/instagram/types";
import { Button } from "@/components/ui/Button";

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
    " " +
    d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

interface ReplyInputProps {
  commentId: string;
  postId: string;
  onClose: () => void;
}

function ReplyInput({ commentId, postId, onClose }: ReplyInputProps) {
  const [text, setText] = useState("");
  const reply = useReplyToComment();

  async function submit() {
    if (!text.trim()) return;
    try {
      await reply.mutateAsync({ commentId, message: text.trim(), postId });
      setText("");
      onClose();
    } catch {
      // error shown inline
    }
  }

  return (
    <div className="mt-2 ml-1 flex gap-2 items-start">
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Write a reply…"
        rows={2}
        className="flex-1 text-xs bg-[var(--bg-base)] border border-[var(--border)] rounded-xl px-3 py-2 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] resize-none focus:outline-none focus:border-[var(--accent-cyan)]"
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
          if (e.key === "Escape") onClose();
        }}
      />
      <div className="flex flex-col gap-1">
        <Button size="sm" variant="primary" onClick={submit} loading={reply.isPending} disabled={!text.trim()}>
          Send
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
      {reply.isError && (
        <p className="text-[10px] text-red-400 mt-1">{(reply.error as Error).message}</p>
      )}
    </div>
  );
}

interface CommentItemProps {
  comment: InstagramComment;
  postId: string;
  isNested?: boolean;
}

function CommentItem({ comment, postId, isNested }: CommentItemProps) {
  const [replying, setReplying] = useState(false);
  const username = comment.username ?? comment.from?.username;

  return (
    <div className={clsx("group", isNested && "ml-10 border-l-2 border-[var(--border)] pl-3")}>
      <div className="flex gap-3 py-3">
        <div className="w-8 h-8 rounded-full bg-[var(--border)] shrink-0 flex items-center justify-center">
          <span className="text-[10px] text-[var(--text-muted)] uppercase font-bold">
            {(username ?? comment.id).slice(0, 1).toUpperCase()}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-xs font-semibold text-[var(--text-primary)]">
              {username ? `@${username}` : comment.id.slice(-8)}
            </span>
            <span className="text-[10px] text-[var(--text-muted)]">{formatTime(comment.timestamp)}</span>
          </div>
          <p className="text-xs text-[var(--text-primary)] mt-0.5 leading-relaxed break-words">
            {comment.text}
          </p>
          {!isNested && (
            <button
              onClick={() => setReplying((v) => !v)}
              className="text-[10px] text-[var(--text-muted)] hover:text-[var(--accent-cyan)] mt-1 transition-colors"
            >
              Reply
            </button>
          )}
        </div>
      </div>

      {replying && <ReplyInput commentId={comment.id} postId={postId} onClose={() => setReplying(false)} />}

      {comment.replies?.data?.map((reply) => (
        <CommentItem key={reply.id} comment={reply} postId={postId} isNested />
      ))}
    </div>
  );
}

interface CommentThreadProps {
  postId: string;
}

export function CommentThread({ postId }: CommentThreadProps) {
  const { data, isLoading, isError, error } = useComments(postId);

  if (isLoading) {
    return (
      <div className="p-4 space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex gap-3 items-start p-3 rounded-xl bg-[var(--border)]/20">
            <div className="w-8 h-8 rounded-full bg-[var(--border)] animate-pulse shrink-0" />
            <div className="flex-1 space-y-1.5">
              <div className="h-2.5 bg-[var(--border)] rounded animate-pulse w-24" />
              <div className="h-2 bg-[var(--border)] rounded animate-pulse w-3/4" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-4 text-xs text-red-400">
        Failed to load comments: {(error as Error).message}
      </div>
    );
  }

  const allComments = data?.data ?? [];
  const replyIds = new Set(allComments.flatMap((c) => c.replies?.data?.map((r) => r.id) ?? []));
  const comments = allComments.filter((c) => !replyIds.has(c.id));

  if (comments.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-xs text-[var(--text-muted)]">
        No comments yet
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-2">
      {comments.map((comment) => (
        <div key={comment.id} className="rounded-xl bg-[var(--border)]/20 px-4 py-0.5">
          <CommentItem comment={comment} postId={postId} />
        </div>
      ))}
    </div>
  );
}

export function CommentThreadHeader({ postId }: { postId: string }) {
  const { data, dataUpdatedAt } = useComments(postId);
  const allComments = data?.data ?? [];
  const replyIds = new Set(allComments.flatMap((c) => c.replies?.data?.map((r) => r.id) ?? []));
  const count = allComments.filter((c) => !replyIds.has(c.id)).length;

  return (
    <>
      <span className="text-xs text-[var(--text-muted)]">
        {count} comment{count !== 1 ? "s" : ""}
      </span>
      {dataUpdatedAt > 0 && (
        <span className="text-[10px] text-[var(--text-muted)]">
          Updated {new Date(dataUpdatedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
        </span>
      )}
    </>
  );
}
