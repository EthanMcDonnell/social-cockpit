import { getDb, rowToFlow, resolveTemplate, type AutomationFlowRow, type CommentToDmConfig } from "@/lib/db";
import { callReplyFunction } from "@/lib/comment-reply-functions";
import { listMedia } from "@/lib/instagram/endpoints/media";
import { listComments, replyToComment, sendPrivateReply } from "@/lib/instagram/endpoints/comments";
import type { InstagramComment } from "@/lib/instagram/types";

export async function processFlows(postId: string, comments: InstagramComment[]) {
  const db = getDb();
  const flows = (
    db
      .prepare("SELECT * FROM automation_flows WHERE is_active = 1 AND (media_id IS NULL OR media_id = ?)")
      .all(postId) as AutomationFlowRow[]
  ).map(rowToFlow);

  if (flows.length === 0) return;

  const accountId = process.env.INSTAGRAM_ACCOUNT_ID;
  if (!accountId) throw new Error("INSTAGRAM_ACCOUNT_ID is not set. Add it to .env.local.");

  for (const flow of flows) {
    if (!flow.activated_at) {
      const now = new Date().toISOString();
      db.prepare("UPDATE automation_flows SET activated_at = ? WHERE id = ?").run(now, flow.id);
      flow.activated_at = now;
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

  const targetedRows = db
    .prepare("SELECT DISTINCT media_id FROM automation_flows WHERE is_active = 1 AND media_id IS NOT NULL")
    .all() as { media_id: string }[];
  for (const { media_id } of targetedRows) postIds.add(media_id);

  const hasAnyPostFlow = !!db
    .prepare("SELECT 1 FROM automation_flows WHERE is_active = 1 AND media_id IS NULL LIMIT 1")
    .get();

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
      const result = await listComments(postId);
      await processFlows(postId, result.data);
    } catch (err) {
      console.error(`[automation] failed to process post ${postId}:`, err);
    }
  }
}
