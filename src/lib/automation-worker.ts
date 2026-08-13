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
  AUTOMATION_COMMENT_FIELDS,
  listComments,
  replyToComment,
  sendPrivateReply,
  sendDirectMessage,
} from "@/lib/instagram/endpoints/comments";
import { getFollowStatus } from "@/lib/instagram/endpoints/user";
import { listInboundMessagesSince, type InboundMessage } from "@/lib/instagram/endpoints/messages";
import {
  InstagramError,
  InstagramTransportError,
  isMediaGoneError,
  type InstagramComment,
  type PaginatedResponse,
} from "@/lib/instagram/types";
import { instagramFetch } from "@/lib/instagram/client";
import { getTombstonedIds, tombstoneMedia } from "@/lib/cache/store";
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

/**
 * Whether firing this flow puts an outbound DM on the wire — i.e. whether it's
 * subject to the shared send budget. comment_to_reply posts a public reply only,
 * so gating it on the DM window would throttle it for no reason.
 */
function willSendDm(flow: AutomationFlow): boolean {
  if (flow.template_type === "comment_to_follow_dm") return true;
  if (flow.template_type === "comment_to_dm") {
    return Boolean((flow.config as CommentToDmConfig).initial_message?.trim());
  }
  return false;
}

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

// Hard cap on comment pages walked per post per cycle. Only ever reached on the
// first pass over a post with a long backlog (a stale cursor, or a flow activated
// months ago); the cursor advances each cycle, so it converges to one page.
const MAX_COMMENT_PAGES = 10;

/**
 * Comments on a post, newest-first, stopping once we've paged back past `floorIso`.
 *
 * Nothing older than the floor can fire — it either predates every applicable
 * flow's activation or was already handled in an earlier cycle — so walking
 * further is pure cost. It used to walk *every* page of *every* targeted post
 * every 60s; on a 3k-comment post that's ~120 sequential requests per cycle,
 * which blew the 30s per-request timeout (AbortError) and discarded the whole
 * post's comments, including the first page that had actually come back fine.
 *
 * Assumes the comments edge is ordered newest-first (it is): once a page's oldest
 * comment predates the floor, the boundary lies inside that page and everything
 * beyond is older still.
 */
async function listRecentComments(
  postId: string,
  floorIso: string
): Promise<InstagramComment[]> {
  const floorMs = Date.parse(floorIso);
  const all: InstagramComment[] = [];
  let result: PaginatedResponse<InstagramComment> = await listComments(
    postId,
    AUTOMATION_COMMENT_FIELDS
  );

  for (let page = 1; ; page += 1) {
    all.push(...result.data);
    const oldest = result.data[result.data.length - 1];
    const crossedFloor = !oldest || Date.parse(oldest.timestamp) < floorMs;
    if (crossedFloor || page >= MAX_COMMENT_PAGES || !result.paging?.next) break;
    result = await instagramFetch<PaginatedResponse<InstagramComment>>(result.paging.next);
  }

  return all;
}

/**
 * How far back to page for a post: the oldest activation among the flows that
 * could still act on it, or the last successful check, whichever is later.
 */
function commentFloorFor(
  db: ReturnType<typeof getDb>,
  postId: string,
  flows: AutomationFlow[]
): string {
  const candidates = flows
    .filter((f) => f.media_ids.length === 0 || f.media_ids.includes(postId))
    .map((f) => f.activated_at ?? f.created_at)
    .filter(Boolean);
  // Oldest activation wins among the applicable flows; a later cursor then trims
  // it further. No candidates shouldn't happen (targets come from flows), but an
  // epoch floor degrades to the old walk-everything behaviour rather than
  // silently skipping comments.
  const floor = candidates.length
    ? candidates.reduce((a, b) => (Date.parse(b) < Date.parse(a) ? b : a))
    : new Date(0).toISOString();
  const cursor = getCursor(db, postId);
  return cursor && Date.parse(cursor) > Date.parse(floor) ? cursor : floor;
}

/**
 * `deferredOldest` is the timestamp of the oldest comment this pass intentionally
 * left unhandled (send budget spent) and expects to re-see next cycle. The caller
 * must not advance its comment cursor past it, or the retry never happens.
 */
export interface ProcessFlowsResult {
  deferredOldest: string | null;
}

export async function processFlows(
  postId: string,
  comments: InstagramComment[]
): Promise<ProcessFlowsResult> {
  const db = getDb();
  let deferredOldest: string | null = null;
  const noteDeferred = (ts?: string) => {
    if (!ts) return;
    if (!deferredOldest || Date.parse(ts) < Date.parse(deferredOldest)) deferredOldest = ts;
  };
  const flows = (
    db
      .prepare("SELECT * FROM automation_flows WHERE is_active = 1")
      .all() as AutomationFlowRow[]
  )
    .map(rowToFlow)
    // A flow applies to this post if it targets no specific posts (any post)
    // or if this post is one of its targeted posts.
    .filter((flow) => flow.media_ids.length === 0 || flow.media_ids.includes(postId));

  if (flows.length === 0) return { deferredOldest: null };

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

      // ── comment_to_follow_dm entry dedupe (pre-claim) ──
      // One funnel per user per flow → no opener spam.
      if (flow.template_type === "comment_to_follow_dm") {
        const username = comment.username ?? comment.from?.username ?? "";
        const already = db
          .prepare("SELECT 1 FROM follow_check_pending WHERE flow_id = ? AND commenter_username = ?")
          .get(flow.id, username);
        if (already) {
          // Claim so we stop re-evaluating this comment every cycle, then skip.
          db.prepare("INSERT OR IGNORE INTO fired_automations (automation_id, comment_id) VALUES (?, ?)")
            .run(flow.id, comment.id);
          continue;
        }
      }

      // ── shared pre-claim send-budget gate ──
      // Any flow that will DM withholds BOTH its public reply and the DM when the
      // window is spent: leave the comment unclaimed so the whole thing retries
      // next cycle rather than posting a reply we can't follow up on. Runs before
      // the claim/public-reply below. throttledSend re-checks and jitters at
      // actual send time.
      if (willSendDm(flow) && !hasSendBudget(db)) {
        logEvent(db, {
          level: "warn",
          kind: "cap_hit",
          flow_id: flow.id,
          comment_id: comment.id,
          message: `deferred ${flow.template_type}: per-window send cap (pre-claim)`,
        });
        noteDeferred(comment.timestamp);
        continue;
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
          const text = resolveTemplate(dmCfg.initial_message, placeholders);
          console.log(`[automation] sending DM to @${placeholders.username}`);
          try {
            // Same choke point as the funnel: shared window cap, jitter, and
            // sent/cap_hit/send_error logging. Logged as opener_sent — it is this
            // flow's opener, and it must count against the same account-wide
            // budget the funnel draws from.
            const sent = await throttledSend(
              db,
              "opener_sent",
              { flow_id: flow.id, comment_id: comment.id },
              async () => {
                await sendPrivateReply(comment.id, text);
              }
            );
            if (!sent) {
              // Deferred by the window cap (rare — the pre-claim check passed).
              // Roll back the claim so the comment retries next cycle.
              db.prepare("DELETE FROM fired_automations WHERE automation_id = ? AND comment_id = ?")
                .run(flow.id, comment.id);
              noteDeferred(comment.timestamp);
            }
          } catch (err) {
            // send_error already logged by throttledSend. Leave the claim in
            // place so a poison comment can't loop forever.
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
              noteDeferred(comment.timestamp);
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

  return { deferredOldest };
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

  // One person can be pending in several flows at once (two funnels on the same
  // post, say), so index a *list* per recipient. Keying by recipient_id alone
  // silently kept only the last row, so their confirm resolved one funnel and the
  // others sat unresolved until the TTL swept them.
  const byId = new Map<string, PendingRow[]>();
  for (const p of pending) {
    const list = byId.get(p.recipient_id);
    if (list) list.push(p);
    else byId.set(p.recipient_id, [p]);
  }

  // Cull + forget. Dropping the row from the in-memory index too means a second
  // confirm from the same person in the same batch can't send against a funnel
  // that's already resolved.
  const resolvePending = (row: PendingRow) => {
    deletePending(db, row);
    const list = byId.get(row.recipient_id);
    const i = list?.indexOf(row) ?? -1;
    if (list && i !== -1) list.splice(i, 1);
  };

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
  let deferred = false;
  for (const msg of inbound) {
    const rows = byId.get(msg.from_id);
    // Not one of ours (organic message) → ignore, but let the cursor advance.
    if (!rows || rows.length === 0) { cursor = msg.created_time; continue; }

    // The confirm is the user replying the keyword. Match it as a standalone
    // word (case/emoji/punctuation-insensitive), NOT a substring — so "Done!"
    // and 'reply "DONE"' confirm, but "I'm done waiting" or "abandoned" don't.
    const tokens = (msg.text ?? "").split(/[^a-zA-Z0-9]+/).map((t) => norm(t)).filter(Boolean);

    // One follow check per message, shared by every funnel this person is in —
    // it's the same account either way. Resolved lazily so a message that
    // confirms nothing costs no API call, and kept raw because `on_check_error`
    // is per-flow policy.
    let follow: { ok: true; following: boolean } | { ok: false; error: string } | undefined;
    const checkFollow = async () => {
      if (!follow) {
        try {
          follow = { ok: true, following: (await getFollowStatus(msg.from_id)).is_user_follow_business };
        } catch (err) {
          follow = { ok: false, error: String(err) };
        }
      }
      return follow;
    };

    // Snapshot: resolvePending mutates the underlying list as funnels resolve.
    for (const row of [...rows]) {
      const flow = getActiveFlow(db, row.flow_id);
      if (!flow) { resolvePending(row); continue; }
      const cfg = flow.config as CommentToFollowDmConfig;

      // Each flow has its own confirm keyword — a message that confirms one
      // funnel may say nothing about another, so match per row.
      const word = norm(cfg.confirm_keyword ?? "DONE");
      if (word === "" || !tokens.includes(word)) continue;

      logEvent(db, { level: "info", kind: "confirm_tap", flow_id: row.flow_id, recipient_id: msg.from_id });

      const status = await checkFollow();
      let following: boolean;
      if (status.ok) {
        following = status.following;
      } else {
        // Consent-missing here usually means follow lag or a non-messaging tap —
        // record it, then apply the configured policy (fail-closed by default).
        logEvent(db, {
          level: "warn",
          kind: /consent/i.test(status.error) ? "consent_missing" : "follow_check_error",
          flow_id: row.flow_id,
          recipient_id: msg.from_id,
          message: status.error,
        });
        if (cfg.on_check_error === "skip") continue;
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
          if (!ok) { deferred = true; break; } // hold cursor + row, retry next cycle
        }
        resolvePending(row); // final ✓ → cull
      } else {
        // Every nudge — including the last — is the same pack copy. The only
        // difference is that after MAX_NUDGES we cull instead of bumping. (An
        // empty message is skipped safely inside sendFunnelDm.)
        const nudge = resolveDmCopy(cfg, "nudge", ph); // pack > not_following_message
        const ok = await sendFunnelDm(db, "nudge_sent", row, msg.from_id, nudge);
        if (!ok) { deferred = true; break; }
        if (row.nudge_count + 1 >= MAX_NUDGES) {
          resolvePending(row); // nudges exhausted → cull
        } else {
          bumpNudge(db, row);
          row.nudge_count += 1; // keep the snapshot honest within this batch
        }
      }
    }

    // A deferred send means this message isn't fully handled — hold the cursor on
    // it so the unresolved funnels are re-seen next cycle.
    if (deferred) break;
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

  // Never call the API for media the Graph has already told us is gone — its
  // list is eventually-consistent and keeps re-listing deleted posts for a
  // while, which would otherwise 100/33-fail here every cycle.
  const tombstoned = getTombstonedIds();
  const targets = Array.from(postIds).filter((id) => !tombstoned.has(id));

  for (const postId of targets) {
    try {
      const floor = commentFloorFor(db, postId, activeFlows);
      const comments = await listRecentComments(postId, floor);
      const { deferredOldest } = await processFlows(postId, comments);
      // Advance the cursor only over what this cycle actually handled: a comment
      // held back by the send budget has to be re-fetched next cycle, so the
      // cursor parks on it. Only moves on success — a throw below leaves it put.
      const newest = comments.reduce<string | undefined>(
        (max, c) => (!max || Date.parse(c.timestamp) > Date.parse(max) ? c.timestamp : max),
        undefined
      );
      setCursor(db, postId, deferredOldest ?? newest);
    } catch (err) {
      // Terminal "media gone" (deleted post / lost access): retrying can never
      // succeed, so tombstone it (skipped from here on) and prune it from every
      // flow instead of erroring each cycle.
      if (isMediaGoneError(err)) {
        tombstoneMedia(postId, "automation listAllComments 100/33");
        const changed = pruneMediaFromFlows(db, postId);
        const deactivated = changed.filter((f) => f.deactivated);
        const tail = deactivated.length
          ? `; deactivated ${deactivated.length} flow(s) left with no targets: ${deactivated
              .map((f) => f.name)
              .join(", ")}`
          : "";
        // A flow left with no targets stops running entirely — surface that as an
        // error on the logs screen; a routine target-trim is a benign self-heal.
        const msg = `[automation] tombstoned gone post ${postId}; pruned from ${changed.length} flow(s)${tail}`;
        if (deactivated.length) console.error(msg);
        else console.warn(msg);
        logEvent(db, {
          level: deactivated.length ? "error" : "warn",
          kind: "media_pruned",
          message: `Post ${postId} unavailable (code 100/33); tombstoned and pruned from ${changed.length} flow(s)${tail}`,
          meta: { postId, changed },
        });
      } else {
        // Anything else — a Graph error, or the edge handing back an HTML page
        // instead of JSON. The cursor stays put either way, so these comments
        // come back next cycle; log it so a *run* of them is visible on the logs
        // screen instead of only in the terminal. Retention prunes the rows.
        console.error(`[automation] failed to process post ${postId}:`, err);
        logEvent(db, {
          level: "error",
          kind: "post_error",
          message: `Post ${postId}: ${err instanceof Error ? err.message : String(err)}`,
          meta: {
            postId,
            status: err instanceof InstagramTransportError ? err.status : undefined,
            code: err instanceof InstagramError ? err.code : undefined,
          },
        });
      }
    }
  }
}
