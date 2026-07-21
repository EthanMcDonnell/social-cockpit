import {
  getDb,
  rowToFlow,
  resolveTemplate,
  getCursor,
  setCursor,
  pruneMediaFromFlows,
  type AutomationFlow,
  type AutomationFlowRow,
  type CommentToDmConfig,
  type CommentToFollowDmConfig,
} from "@/lib/db";

export const INTERVAL_MS = 60_000;
import { callReplyFunction } from "@/lib/comment-reply-functions";
import { callDmPack, type FollowDmContext } from "@/lib/follow-dm-functions";
import { listMedia } from "@/lib/instagram/endpoints/media";
import {
  listComments,
  replyToComment,
  sendPrivateReply,
  sendDirectMessage,
} from "@/lib/instagram/endpoints/comments";
import { getFollowStatus } from "@/lib/instagram/endpoints/user";
import { listInboundMessagesSince, type InboundMessage } from "@/lib/instagram/endpoints/messages";
import { InstagramError, type InstagramComment, type PaginatedResponse } from "@/lib/instagram/types";
import { instagramFetch } from "@/lib/instagram/client";
import { throttledSend, hasSendBudget, logEvent } from "@/lib/automation-sender";

// ─── comment_to_follow_dm tunables (top of module, easy to tune) ─────────────
const PENDING_TTL_DAYS = 7;   // matches Instagram's 7-day private-reply window
const MAX_NUDGES = 2;         // nudge messages per non-follower; the next reply
                             //   after this many is culled silently (no message)
const EVENTS_RETENTION_DAYS = 30;
const CONFIRM_CURSOR_KEY = "follow_confirm_messages";

// Keyword-match guard: only treat a comment as a trigger if it's short enough
// that the keyword is plausibly the intent, not an incidental word in a longer
// sentence. Comments with more than this many words are skipped, cutting down
// misfires when someone happens to mention the keyword in normal conversation.
const MAX_KEYWORD_COMMENT_WORDS = 10;

// Resolve funnel DM copy: a named pack takes priority over static config text.
function resolveDmCopy(
  cfg: CommentToFollowDmConfig,
  slot: "opener" | "nudge",
  ph: { username: string }
): string {
  const keyword = cfg.confirm_keyword?.trim() || "DONE";
  const resource = cfg.resource ?? "resources";
  const name = ph.username ? ` @${ph.username}` : "";
  const ctx: FollowDmContext = { username: ph.username, name, comment: "", keyword, resource };
  if (cfg.dm_pack) {
    const generated = callDmPack(cfg.dm_pack, slot, ctx);
    if (generated) return generated;
  }
  const fallback = slot === "opener" ? cfg.opener_message : cfg.not_following_message;
  return resolveTemplate(fallback ?? "", { username: ctx.username, resource, keyword });
}

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
      // Skip long comments: the keyword is more likely incidental than intentional.
      const wordCount = commentText.trim().split(/\s+/).filter(Boolean).length;
      if (wordCount > MAX_KEYWORD_COMMENT_WORDS) continue;
      const matchesKeyword = flow.trigger_keywords.some((kw) => commentText.includes(kw.toLowerCase()));
      if (!matchesKeyword) continue;

      // ── comment_to_follow_dm pre-claim gate ──
      // The opener funnel withholds BOTH the public reply and the opener when it
      // can't send, so its gates run before the shared claim/public-reply below.
      if (flow.template_type === "comment_to_follow_dm") {
        const username = comment.username ?? comment.from?.username ?? "";
        // Entry dedupe: one funnel per user per flow → no opener spam.
        const already = db
          .prepare("SELECT 1 FROM follow_check_pending WHERE flow_id = ? AND commenter_username = ?")
          .get(flow.id, username);
        if (already) {
          // Claim so we stop re-evaluating this comment every cycle, then skip.
          db.prepare("INSERT OR IGNORE INTO fired_automations (automation_id, comment_id) VALUES (?, ?)")
            .run(flow.id, comment.id);
          continue;
        }
        // Global send budget: if the window is spent, leave the comment
        // unclaimed so it (and its public reply) retry next cycle — nothing is
        // posted now. throttledSend re-checks and jitters at actual send time.
        if (!hasSendBudget(db)) {
          logEvent(db, {
            level: "warn",
            kind: "cap_hit",
            flow_id: flow.id,
            comment_id: comment.id,
            message: "deferred opener: per-window send cap (pre-claim)",
          });
          continue;
        }
      }

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
      } else if (flow.template_type === "comment_to_follow_dm") {
        const cfg = flow.config as CommentToFollowDmConfig;
        const openerText = resolveDmCopy(cfg, "opener", placeholders);
        if (openerText.trim()) {
          console.log(`[automation] sending follow-DM opener to @${placeholders.username}`);
          let recipientId: string | null = null;
          try {
            // All sends route through the throttle: it owns the window cap, the
            // jitter, and the opener_sent / cap_hit logging.
            const sent = await throttledSend(
              db,
              "opener_sent",
              { flow_id: flow.id, comment_id: comment.id },
              async () => {
                // Plain text private reply — one clean bubble. The confirm is the
                // user replying the keyword (a pollable inbound message), so no
                // button is needed.
                const pr = await sendPrivateReply(comment.id, openerText);
                recipientId = pr.recipient_id;
              }
            );
            if (!sent) {
              // Deferred by the window cap (rare — the pre-claim check passed).
              // Roll back the claim so the comment retries next cycle.
              db.prepare("DELETE FROM fired_automations WHERE automation_id = ? AND comment_id = ?")
                .run(flow.id, comment.id);
            } else if (recipientId) {
              db.prepare(
                `INSERT OR IGNORE INTO follow_check_pending
                   (flow_id, recipient_id, commenter_username, comment_id)
                 VALUES (?, ?, ?, ?)`
              ).run(flow.id, recipientId, placeholders.username, comment.id);
            }
          } catch (err) {
            // send_error already logged by throttledSend. Leave the claim in
            // place (like comment_to_dm) so a poison comment can't loop forever.
            console.error(`[automation] follow-DM opener FAILED:`, err);
          }
        }
      }
    }
  }
}

// ─── comment_to_follow_dm confirm poll ───────────────────────────────────────
// Runs once per cycle (after processFlows). Matches confirm taps from stored
// recipient_ids, checks follow status, and sends reward / nudge / final message,
// culling pending rows the moment each funnel resolves.

interface PendingRow {
  flow_id: string;
  recipient_id: string;
  commenter_username: string | null;
  comment_id: string | null;
  nudge_count: number;
  created_at: string;
}

function getActiveFlow(db: ReturnType<typeof getDb>, id: string): AutomationFlow | null {
  const row = db
    .prepare("SELECT * FROM automation_flows WHERE id = ? AND is_active = 1")
    .get(id) as AutomationFlowRow | undefined;
  return row ? rowToFlow(row) : null;
}

function deletePending(db: ReturnType<typeof getDb>, row: PendingRow): void {
  db.prepare("DELETE FROM follow_check_pending WHERE flow_id = ? AND recipient_id = ?")
    .run(row.flow_id, row.recipient_id);
}

function bumpNudge(db: ReturnType<typeof getDb>, row: PendingRow): void {
  db.prepare(
    "UPDATE follow_check_pending SET nudge_count = nudge_count + 1 WHERE flow_id = ? AND recipient_id = ?"
  ).run(row.flow_id, row.recipient_id);
}

// One DM through the throttle. Returns true if the row may advance (sent OK, or
// a hard send error already logged — advancing avoids wedging the cursor on a
// poison message); false only when the window cap deferred the send.
async function sendFunnelDm(
  db: ReturnType<typeof getDb>,
  kind: "reward_sent" | "nudge_sent",
  row: PendingRow,
  recipientId: string,
  text: string
): Promise<boolean> {
  // Defensive: never call the API with empty text (Instagram errors "Empty
  // text"). Treat a blank message as handled so the row still advances/culls.
  if (!text.trim()) {
    logEvent(db, {
      level: "warn",
      kind: "empty_message_skipped",
      flow_id: row.flow_id,
      recipient_id: recipientId,
      message: `skipped empty ${kind}`,
    });
    return true;
  }
  try {
    return await throttledSend(
      db,
      kind,
      { flow_id: row.flow_id, recipient_id: recipientId },
      async () => {
        await sendDirectMessage(recipientId, text);
      }
    );
  } catch {
    return true; // send_error already logged by throttledSend
  }
}

// Normalise for text matching: drop case, emoji and punctuation.
const norm = (s: string) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

export async function runFollowConfirmPoll() {
  const db = getDb();

  // (a) timeout cull — bounds the pending table every cycle. Log each expiry
  // first (per flow) so it's countable in the analytics counters.
  const expiring = db
    .prepare("SELECT flow_id, recipient_id FROM follow_check_pending WHERE created_at < datetime('now', ?)")
    .all(`-${PENDING_TTL_DAYS} days`) as { flow_id: string; recipient_id: string }[];
  for (const e of expiring) {
    logEvent(db, { level: "info", kind: "expired", flow_id: e.flow_id, recipient_id: e.recipient_id });
  }
  db.prepare("DELETE FROM follow_check_pending WHERE created_at < datetime('now', ?)")
    .run(`-${PENDING_TTL_DAYS} days`);
  // Flow deleted / deactivated → cull its rows.
  db.prepare(
    "DELETE FROM follow_check_pending WHERE flow_id NOT IN (SELECT id FROM automation_flows WHERE is_active = 1)"
  ).run();
  // Event-log retention — self-bounds like the pending table.
  db.prepare("DELETE FROM automation_events WHERE created_at < datetime('now', ?)")
    .run(`-${EVENTS_RETENTION_DAYS} days`);

  // (b) skip all message I/O when idle
  const pending = db.prepare("SELECT * FROM follow_check_pending").all() as PendingRow[];
  if (pending.length === 0) return;
  const byId = new Map(pending.map((p) => [p.recipient_id, p]));

  // (c) incremental inbound messages, oldest-first
  const since = getCursor(db, CONFIRM_CURSOR_KEY);
  let inbound: InboundMessage[];
  try {
    inbound = await listInboundMessagesSince(since);
  } catch (err) {
    logEvent(db, { level: "error", kind: "send_error", message: `conversations poll failed: ${String(err)}` });
    return;
  }

  let cursor = since;
  for (const msg of inbound) {
    const row = byId.get(msg.from_id);
    // Not one of ours (organic message) → ignore, but let the cursor advance.
    if (!row) { cursor = msg.created_time; continue; }

    const flow = getActiveFlow(db, row.flow_id);
    if (!flow) { deletePending(db, row); cursor = msg.created_time; continue; }
    const cfg = flow.config as CommentToFollowDmConfig;

    // The confirm is the user replying the keyword. Match it as a standalone
    // word (case/emoji/punctuation-insensitive), NOT a substring — so "Done!"
    // and 'reply "DONE"' confirm, but "I'm done waiting" or "abandoned" don't.
    const word = norm(cfg.confirm_keyword ?? "DONE");
    const tokens = (msg.text ?? "").split(/[^a-zA-Z0-9]+/).map((t) => norm(t)).filter(Boolean);
    const isConfirm = word !== "" && tokens.includes(word);
    if (!isConfirm) { cursor = msg.created_time; continue; }

    logEvent(db, { level: "info", kind: "confirm_tap", flow_id: row.flow_id, recipient_id: msg.from_id });

    let following: boolean;
    try {
      following = (await getFollowStatus(msg.from_id)).is_user_follow_business;
    } catch (err) {
      // Consent-missing here usually means follow lag or a non-messaging tap —
      // record it, then apply the configured policy (fail-closed by default).
      const errStr = String(err);
      logEvent(db, {
        level: "warn",
        kind: /consent/i.test(errStr) ? "consent_missing" : "follow_check_error",
        flow_id: row.flow_id,
        recipient_id: msg.from_id,
        message: errStr,
      });
      if (cfg.on_check_error === "skip") { cursor = msg.created_time; continue; }
      following = cfg.on_check_error === "reward"; // else fail-closed (follow_prompt)
    }

    const ph = {
      username: row.commenter_username ?? "",
      keyword: cfg.confirm_keyword?.trim() || "DONE",
      resource: cfg.resource ?? "resources",
    };

    if (following) {
      const reward = cfg.follower_message?.trim() ? resolveTemplate(cfg.follower_message, ph) : "";
      if (reward) {
        const ok = await sendFunnelDm(db, "reward_sent", row, msg.from_id, reward);
        if (!ok) break; // deferred — hold cursor + row, retry next cycle
      }
      deletePending(db, row); // final ✓ → cull
    } else {
      // Every nudge — including the last — is the same pack copy. The only
      // difference is that after MAX_NUDGES we cull instead of bumping. (An
      // empty message is skipped safely inside sendFunnelDm.)
      const nudge = resolveDmCopy(cfg, "nudge", ph); // pack > not_following_message
      const ok = await sendFunnelDm(db, "nudge_sent", row, msg.from_id, nudge);
      if (!ok) break;
      if (row.nudge_count + 1 >= MAX_NUDGES) {
        deletePending(db, row); // nudges exhausted → cull
      } else {
        bumpNudge(db, row);
      }
    }

    cursor = msg.created_time;
  }

  setCursor(db, CONFIRM_CURSOR_KEY, cursor);
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
      // Terminal "media gone" (deleted post / lost access): retrying can never
      // succeed, so prune the ID from every flow instead of erroring each cycle.
      if (err instanceof InstagramError && err.code === 100 && err.subcode === 33) {
        const changed = pruneMediaFromFlows(db, postId);
        const deactivated = changed.filter((f) => f.deactivated);
        const tail = deactivated.length
          ? `; deactivated ${deactivated.length} flow(s) left with no targets: ${deactivated
              .map((f) => f.name)
              .join(", ")}`
          : "";
        // A flow left with no targets stops running entirely — surface that as an
        // error on the logs screen; a routine target-trim is a benign self-heal.
        const msg = `[automation] pruned deleted/inaccessible post ${postId} from ${changed.length} flow(s)${tail}`;
        if (deactivated.length) console.error(msg);
        else console.warn(msg);
        logEvent(db, {
          level: deactivated.length ? "error" : "warn",
          kind: "media_pruned",
          message: `Post ${postId} unavailable (code 100/33); pruned from ${changed.length} flow(s)${tail}`,
          meta: { postId, changed },
        });
      } else {
        console.error(`[automation] failed to process post ${postId}:`, err);
      }
    }
  }
}
