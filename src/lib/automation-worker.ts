import { getDb, rowToFlow, resolveTemplate, type AutomationFlowRow, type CommentToDmConfig } from "@/lib/db";

export const INTERVAL_MS = 60_000;
import { callReplyFunction } from "@/lib/comment-reply-functions";
import { listMedia } from "@/lib/instagram/endpoints/media";
import { listComments, replyToComment, sendPrivateReply } from "@/lib/instagram/endpoints/comments";
import type { InstagramComment, PaginatedResponse } from "@/lib/instagram/types";
import { instagramFetch } from "@/lib/instagram/client";

async function listAllComments(postId: string): Promise<InstagramComment[]> {
  const all: InstagramComment[] = [];
  let result: PaginatedResponse<InstagramComment> = await listComments(postId);
  all.push(...result.data);
  while (result.paging?.next) {
    result = await instagramFetch<PaginatedResponse<InstagramComment>>(result.paging.next);
    all.push(...result.data);
  }
  return all;
}

export async function processFlows(postId: string, comments: InstagramComment[]) {
  const db = getDb();
  const flows = (
    db
      .prepare("SELECT * FROM automation_flows WHERE is_active = 1")
      .all() as AutomationFlowRow[]
  )
    .map(rowToFlow)
    // A flow applies to this post if it targets no specific posts (any post)
    // or if this post is one of its targeted posts.
    .filter((flow) => flow.media_ids.length === 0 || flow.media_ids.includes(postId));

  if (flows.length === 0) return;

  const accountId = process.env.INSTAGRAM_ACCOUNT_ID;
  if (!accountId) throw new Error("INSTAGRAM_ACCOUNT_ID is not set. Add it to .env.local.");

  for (const flow of flows) {
    if (!flow.activated_at) {
      // Use flow creation time so comments made after the flow was created are processed,
      // not just comments after the first worker cycle (which could be minutes later).
      const activatedAt = flow.created_at;
      db.prepare("UPDATE automation_flows SET activated_at = ? WHERE id = ?").run(activatedAt, flow.id);
      flow.activated_at = activatedAt;
    }

    for (const comment of comments) {
      if (!comment.text) continue;
      if (comment.from?.id === accountId) continue;

      const alreadyReplied = comment.replies?.data.some((r) => r.from?.id === accountId);
      if (alreadyReplied) continue;

      if (new Date(comment.timestamp) < new Date(flow.activated_at)) continue;

      const commentText = comment.text.toLowerCase();
      const matchesKeyword = flow.trigger_keywords.some((kw) => commentText.includes(kw.toLowerCase()));
      if (!matchesKeyword) continue;

      // Claim atomically before sending — prevents double-fire when two cycles overlap
      const claim = db
        .prepare("INSERT OR IGNORE INTO fired_automations (automation_id, comment_id) VALUES (?, ?)")
        .run(flow.id, comment.id);
      if (claim.changes === 0) continue;

      const placeholders = { username: comment.username ?? comment.from?.username ?? "" };
      console.log(`[automation] flow "${flow.name}" matched comment ${comment.id} by @${placeholders.username}: "${comment.text}"`);

      // Resolve comment reply: function reference takes priority over static list
      let replyText: string | null = null;
      if (flow.config.comment_reply_fn) {
        replyText = callReplyFunction(flow.config.comment_reply_fn, {
          username: placeholders.username,
          comment: comment.text ?? "",
        });
        if (!replyText) console.warn(`[automation] comment_reply_fn "${flow.config.comment_reply_fn}" not found`);
      } else if (flow.config.comment_replies && flow.config.comment_replies.length > 0) {
        const replies = flow.config.comment_replies;
        replyText = replies[Math.floor(Math.random() * replies.length)];
      }

      if (replyText) {
        console.log(`[automation] posting comment reply: "${replyText}"`);
        try {
          const result = await replyToComment(comment.id, resolveTemplate(replyText, placeholders));
          console.log(`[automation] comment reply posted OK, id=${result.id}`);
        } catch (err) {
          console.error(`[automation] comment reply FAILED:`, err);
        }
      } else {
        console.log(`[automation] no comment reply configured — skipping public reply`);
      }

      if (flow.template_type === "comment_to_dm") {
        const dmCfg = flow.config as CommentToDmConfig;
        if (dmCfg.initial_message?.trim()) {
          console.log(`[automation] sending DM to @${placeholders.username}`);
          try {
            await sendPrivateReply(comment.id, resolveTemplate(dmCfg.initial_message, placeholders));
            console.log(`[automation] DM sent OK`);
          } catch (err) {
            console.error(`[automation] DM FAILED:`, err);
          }
        }
      }
    }
  }
}

export async function runAutomationCycle() {
  console.log(`[automation] cycle running at ${new Date().toISOString()}`);
  const db = getDb();

  // Collect post IDs to check: explicitly targeted posts + recent posts for any-post flows
  const postIds = new Set<string>();

  const activeFlows = (
    db.prepare("SELECT * FROM automation_flows WHERE is_active = 1").all() as AutomationFlowRow[]
  ).map(rowToFlow);

  let hasAnyPostFlow = false;
  for (const flow of activeFlows) {
    if (flow.media_ids.length === 0) {
      hasAnyPostFlow = true;
    } else {
      for (const id of flow.media_ids) postIds.add(id);
    }
  }

  if (hasAnyPostFlow) {
    try {
      const media = await listMedia(50);
      for (const m of media.data) postIds.add(m.id);
    } catch (err) {
      console.error("[automation] failed to fetch media list:", err);
    }
  }

  for (const postId of Array.from(postIds)) {
    try {
      const comments = await listAllComments(postId);
      await processFlows(postId, comments);
    } catch (err) {
      console.error(`[automation] failed to process post ${postId}:`, err);
    }
  }
}
