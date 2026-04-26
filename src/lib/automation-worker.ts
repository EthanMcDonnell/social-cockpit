import { getDb, rowToFlow, resolveTemplate, type AutomationFlowRow, type CommentToDmConfig } from "@/lib/db";

export const INTERVAL_MS = 60_000;
import { callReplyFunction } from "@/lib/comment-reply-functions";
import { listMedia } from "@/lib/instagram/endpoints/media";
import { listComments, replyToComment, sendPrivateReply } from "@/lib/instagram/endpoints/comments";
import type { InstagramComment, PaginatedResponse } from "@/lib/instagram/types";
import { instagramFetch } from "@/lib/instagram/client";

// Fetch all comments newer than `since`, paginating forward until exhausted.
// Using `since` avoids scanning thousands of old comments on every cycle.
async function listRecentComments(postId: string, since: Date): Promise<InstagramComment[]> {
  const all: InstagramComment[] = [];
  let result: PaginatedResponse<InstagramComment> = await listComments(postId, undefined, since);
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
      .prepare("SELECT * FROM automation_flows WHERE is_active = 1 AND (media_id IS NULL OR media_id = ?)")
      .all(postId) as AutomationFlowRow[]
  ).map(rowToFlow);

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
      const cycleStart = new Date();

      // Determine how far back to look. On first check for a post, use the oldest
      // active flow's created_at so we don't miss comments made right after setup.
      // On subsequent checks, use the last successful check time — typically ~60s ago.
      const cursor = db
        .prepare("SELECT last_checked_at FROM automation_post_cursors WHERE media_id = ?")
        .get(postId) as { last_checked_at: string } | undefined;

      let since: Date;
      if (cursor) {
        // Subtract one full interval as a safety overlap — catches anything that landed
        // at the edge of the previous window. Deduplication via fired_automations prevents double-firing.
        since = new Date(new Date(cursor.last_checked_at).getTime() - INTERVAL_MS);
      } else {
        const oldest = db
          .prepare(
            "SELECT created_at FROM automation_flows WHERE is_active = 1 AND (media_id IS NULL OR media_id = ?) ORDER BY created_at ASC LIMIT 1"
          )
          .get(postId) as { created_at: string } | undefined;
        since = oldest ? new Date(oldest.created_at) : new Date(Date.now() - 60 * 60 * 1000);
      }

      const comments = await listRecentComments(postId, since);
      await processFlows(postId, comments);

      // Advance the cursor so the next cycle only fetches comments posted after this one started.
      db.prepare(
        "INSERT OR REPLACE INTO automation_post_cursors (media_id, last_checked_at) VALUES (?, ?)"
      ).run(postId, cycleStart.toISOString());
    } catch (err) {
      console.error(`[automation] failed to process post ${postId}:`, err);
    }
  }
}
