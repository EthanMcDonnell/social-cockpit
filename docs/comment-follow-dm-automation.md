# Automation: Comment → Follow → DM (reply-to-confirm)

A **new automation template type** — `comment_to_follow_dm` — that DMs a reward
(link/code) only to people who **follow you**, using a *reply-to-confirm* flow:

> Comment the keyword → get a DM "follow me, then tap **I'm following ✅**" → they
> follow + tap the button → we check follow status → send the reward (or a
> "follow not detected" nudge).

It's a new template *inside the existing flows engine*, not a new subsystem and not
an edit to `comment_to_dm`. The engine's shared machinery (60s poll, keyword match,
`fired_automations` claim, public reply, media targeting) is reused; existing flows'
code paths are **untouched**.

Why reply-to-confirm (Method B) over an instant auto-check: follow status is only
readable *after the user messages us* (see below), so we can't check at comment time
regardless. The confirm tap doubles as that inbound message — it grants profile
consent **and** opens a fresh 24-hour messaging window, so the reward goes out as a
reply to the tap. Nobody comments twice, and every send is a reaction to an inbound
event (never a proactive push), which keeps us inside the messaging window by
construction.

## Verified against the API (docs + live probe)

- **Follow status is gated on consent.** `GET /<IGSID>?fields=…,is_user_follow_business`
  returns the field **only after** the user "sends a message… or clicks an icebreaker
  or persistent menu" — otherwise the API returns *"User consent is required to access
  user profile."* A **comment author's** id alone gives only `id/username/name`, no
  follow status. This is why the funnel must route through an inbound message. [1][4]
- **A quick-reply tap is an inbound message.** Tapping a button sends a message that
  simultaneously (a) grants the consent above and (b) opens the 24-hour window for the
  reward reply. [2] **Polling caveat:** `quick_reply.payload` is delivered only on the
  *webhook* event — when you **poll** the Conversations API, a tap arrives as an
  ordinary message whose **text is the button's title** (e.g. "I'm following ✅") with
  **no payload**. So a polling-only build must match confirms on **text** (button label
  or typed keyword), not on payload. Reserve payload-matching for a future webhook path.
- **`sendPrivateReply(comment_id, text)` returns `recipient_id`** — the messaging-scoped
  id we store and later check (verified live).
- **Conversations are pollable but capped.** `GET /<IG_ID>/conversations?platform=instagram`
  lists conversation ids + `updated_time`, filterable by `user_id`; per conversation
  only the **20 most recent messages** are retrievable. Fine at a 60s cadence. [3]

## State machine

```
                        ┌──────────────────────────────────────────────┐
   comment (keyword)    │                                              │
        │  shared engine: match → claim → optional public reply        │
        ▼                                                              │
  send opener DM ──▶ store PENDING(recipient_id, flow, awaiting)       │
        │            (skip if this user already has an awaiting row)   │
        ▼                                                              │
   ── waiting ──  user follows + taps "I'm following ✅" in DMs        │
        │                                                              │
        ▼   message poll matches the tap from a stored recipient_id    │
   check is_user_follow_business                                       │
        ├─ following      → send REWARD  → DELETE row  (final ✓ cull)  │
        ├─ not following  → send NUDGE   → nudge_count++               │
        │                    └─ nudges exhausted → final msg → DELETE  │
        └─ (never replies) → TTL expiry  → DELETE row  (timeout cull) ─┘
```

## Lifecycle & culling — the anti-overwhelm rules

A pending row exists **only while a user is mid-funnel**. It leaves the table the
moment it's resolved, so the table stays small and self-draining.

| Trigger | Action | Row |
|---|---|---|
| Opener sent | insert `awaiting`, `nudge_count=0` | **created** |
| DONE + following | send reward | **DELETE** (final response) |
| DONE + not following, `nudge_count < MAX` | send nudge, `nudge_count++` | kept `awaiting` |
| DONE + not following, `nudge_count == MAX` | send "offer expired, comment again" | **DELETE** |
| No DONE within `TTL_DAYS` | — | **DELETE** (timeout) |
| Flow deleted / deactivated | — | **DELETE** its rows |

Cull points, concretely:

1. **Final response delivered → immediate `DELETE`.** Reward sent, or nudges
   exhausted → the row is done and removed. This is "culling when the user got the
   final response."
2. **Timeout `DELETE` every cycle:** `DELETE FROM follow_check_pending WHERE
   created_at < now - TTL_DAYS`. `TTL_DAYS = 7` (matches Instagram's 7-day
   private-reply window — after that we couldn't message them anyway). One cheap
   query per cycle bounds the table regardless of volume.
3. **Nudge cap** (`MAX_NUDGES = 3`): after the cap we stop replying and cull, so a
   non-follower can't loop the nudge forever.
4. **Dedupe at entry:** before sending an opener, skip if this user already has an
   `awaiting` row for this flow → one funnel per user per flow, no opener spam.

Constants live at the top of the worker module, easy to tune:
`PENDING_TTL_DAYS = 7`, `MAX_NUDGES = 3`.

## Overwhelm safeguards (polling side)

- **Poll only when the table is non-empty** — zero message-API overhead when idle.
- **Incremental fetch via cursor** — only messages newer than the last check
  (reuses the existing `automation_post_cursors` pattern with a `messages` key).
- **O(new messages) matching** — load pending `recipient_id`s into a `Set`, scan
  only new inbound messages; no per-row API calls.
- **One follow-check per confirming tap** — `getFollowStatus` is called only when a
  stored id actually taps confirm, not on a timer.
- **Global send throttle + jitter (required).** Every DM routes through one throttled
  sender (see *Global send throttle*) enforcing a rolling per-window cap and random
  jitter, so a viral-post burst can't fire hundreds of near-identical DMs at machine
  speed and trip Instagram's messaging-abuse heuristics. This is distinct from the
  per-user `MAX_NUDGES` cap.
- **20-message conversation cap** — only the 20 newest messages per conversation are
  retrievable, so poll frequently enough (60s) that a confirm isn't buried; a user
  who floods >20 messages before we poll can have their tap missed → the TTL/nudge
  path and "tap again" recovery cover it.
- Optional `MAX_PENDING` ceiling if you ever want an absolute table cap.

## Global send throttle (the single send choke point)

Two distinct caps, easy to conflate:

- **`MAX_NUDGES` — per user.** Lives in the `nudge_count` column; bounds how many times
  *one* non-follower is re-nudged. Protects an individual from being pestered.
- **`MAX_SENDS_PER_WINDOW` — global.** Bounds how many DMs go out across *everyone* in a
  rolling 60s window. Protects the *account* from a viral-post burst tripping
  Instagram's messaging-abuse heuristics. The burst risk is dominated by *openers*,
  which the nudge cap doesn't touch, so this is a separate, required control.

Every outbound DM (opener, reward, nudge) routes through one throttled sender so the
global cap and jitter live in exactly one place — including openers fired by the
`/api/instagram/comments` route outside the 60s tick.

```ts
// src/lib/automation-sender.ts
const MAX_SENDS_PER_WINDOW = 12;
const WINDOW_SECONDS = 60;
const SEND_JITTER_MS: [number, number] = [1000, 4000];

// The event log doubles as the rate-limiter state — no separate counter needed.
function sendsInWindow(db: Database): number {
  return (db.prepare(
    `SELECT COUNT(*) AS c FROM automation_events
       WHERE kind IN ('opener_sent','reward_sent','nudge_sent')
         AND created_at > datetime('now', ?)`
  ).get(`-${WINDOW_SECONDS} seconds`) as { c: number }).c;
}

// Returns true if sent, false if deferred (budget exhausted this window).
export async function throttledSend(
  db: Database,
  kind: "opener_sent" | "reward_sent" | "nudge_sent",
  meta: { flow_id?: string; recipient_id?: string; comment_id?: string },
  doSend: () => Promise<void>,
): Promise<boolean> {
  if (sendsInWindow(db) >= MAX_SENDS_PER_WINDOW) {
    logEvent(db, { level: "warn", kind: "cap_hit",
      message: `deferred ${kind}: per-window send cap`, ...meta });
    return false;                               // caller must NOT claim / advance cursor
  }
  await sleep(rand(...SEND_JITTER_MS));
  try {
    await doSend();
    logEvent(db, { level: "info", kind, ...meta });
    return true;
  } catch (err) {
    logEvent(db, { level: "error", kind: "send_error", message: String(err), ...meta });
    throw err;
  }
}
```

**Overflow must roll forward, not vanish:**

- **Openers** — call `throttledSend` *before* claiming; if it returns `false`, skip the
  `fired_automations` claim (or roll it back) so the comment retries next cycle.
- **Confirm-poll sends** — process confirms oldest-first and stop advancing the message
  cursor at the first deferred send, so deferred confirms reprocess next cycle.

Every deferral is logged `cap_hit` (level `warn`), so a sustained backlog is visible on
the logs page rather than silently dropped.

## Data model

New template value + config type (existing configs untouched):

```ts
export type AutomationTemplateType =
  "comment_to_dm" | "comment_to_reply" | "comment_to_follow_dm";

export interface CommentToFollowDmConfig {
  comment_reply_fn?: string;          // reuse public-reply machinery
  comment_replies: string[];
  media_ids?: string[];

  opener_message: string;             // "Follow me, then tap below and I'll send it 🔗"
  confirm_button_label?: string;      // default "I'm following ✅" (≤ 20 chars)
  confirm_payload?: string;           // "FOLLOW_CONFIRM" — webhook-only; polling
                                      //   matches on button label / keyword instead
  confirm_keyword?: string;           // typed fallback, default "DONE"
  follower_message: string;           // reward — sent to followers
  not_following_message?: string;     // nudge — sent to non-followers
  dm_pack?: string;                   // named copy pack (e.g. "casual") — generates
                                      //   opener + nudge; overrides opener_message /
                                      //   not_following_message when set
  resource?: string;                  // {{resource}} value, default "resources"
  on_check_error?: "reward" | "follow_prompt" | "skip"; // default "follow_prompt"
}
```

`rowToFlow()` / API `resolvedType()` gain recognition of the new value; existing
values still map exactly as before. **No migration** for flows (column + JSON exist).

New table (its own file/migration in `getDb()`):

```sql
CREATE TABLE IF NOT EXISTS follow_check_pending (
  flow_id            TEXT NOT NULL,
  recipient_id       TEXT NOT NULL,                 -- messaging-scoped id
  commenter_username TEXT,                          -- for entry dedupe + templates
  comment_id         TEXT,                          -- provenance
  nudge_count        INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (flow_id, recipient_id)
);
CREATE INDEX IF NOT EXISTS idx_pending_created ON follow_check_pending(created_at);
```

## Message packs (auto-generated DM copy)

Like `comment_reply_fn` for public replies, a **DM message pack** supplies
randomized-variation copy for the funnel's DMs, selected per flow via `dm_pack`. A
pack bundles the **opener** and **nudge** in one voice so the funnel reads
consistently; the reward stays manual (it's your actual link/code). Copy uses a
`{{resource}}` token (default `"resources"`) so one pack serves any reward, and the
token is always used as a grammatical *object* so it reads correctly whether it's
"the guide" or "the resources". Emoji only ever at the end of a line, at most one.

New module `src/lib/follow-dm-functions.ts` (sibling to `comment-reply-functions.ts`):

```ts
interface FollowDmContext {
  username: string;
  comment: string;
  buttonLabel: string;   // confirm button label, for "tap below" phrasing
  resource: string;      // {{resource}} value, default "resources"
}
type DmFn = (ctx: FollowDmContext) => string;
interface DmPack { opener: DmFn; nudge: DmFn }
const pick = (o: string[]) => o[Math.floor(Math.random() * o.length)];

export const followDmPacks: Record<string, DmPack> = {
  casual: {
    opener: ({ resource }) => pick([
      `Thanks for commenting! Follow me and tap below and I'll send the ${resource} over`,
      `Appreciate the comment. Follow me, tap below, and I'll get the ${resource} to you 👇`,
      `Hey! Follow me then hit the button below and I'll send the ${resource} across`,
      `Cheers for the comment. Follow me, tap below, and I'll send the ${resource} your way`,
    ]),
    nudge: ({ resource }) => pick([
      `Just need you to follow so I can send the ${resource} through 👍`,
      `Can't send the ${resource} till you follow, do that then tap below again`,
      `You're not following yet, sort that and tap below for the ${resource}`,
      `Gotta be following before I can send the ${resource}. Follow me then tap below`,
      `Follow me and I'll send the ${resource} straight through`,
      `Follow me and I'll get the ${resource} to you, then tap below`,
      `Need you following before I can send the ${resource}. Follow me and tap below 🙏`,
      `Almost there, follow me so I can send the ${resource} then tap below again`,
    ]),
  },
};

export function callDmPack(
  name: string, slot: "opener" | "nudge", ctx: FollowDmContext
): string | null {
  const pack = followDmPacks[name];
  return pack ? pack[slot](ctx) : null;
}

export function listDmPacks() {
  const s = { username: "", comment: "", buttonLabel: "I'm following ✅", resource: "resources" };
  return Object.entries(followDmPacks).map(([name, p]) => ({
    name, opener: p.opener(s), nudge: p.nudge(s),
  }));
}
```

Resolution (pack takes priority over static text), used at both send sites:

```ts
function resolveDmCopy(
  cfg: CommentToFollowDmConfig, slot: "opener" | "nudge", ph: { username: string }
): string {
  const ctx: FollowDmContext = {
    username: ph.username, comment: "",
    buttonLabel: cfg.confirm_button_label ?? "I'm following ✅",
    resource: cfg.resource ?? "resources",
  };
  if (cfg.dm_pack) {
    const generated = callDmPack(cfg.dm_pack, slot, ctx);
    if (generated) return generated;
  }
  const fallback = slot === "opener" ? cfg.opener_message : cfg.not_following_message;
  return resolveTemplate(fallback ?? "", { username: ctx.username, resource: ctx.resource });
}
```

Packs are listed to the editor via `GET /api/follow-dm-functions` (mirrors
`/api/automation-reply-functions`), returning `{ name, opener, nudge }` previews.

## New library functions

```ts
// endpoints/users.ts — User Profile API. Works ONLY after the user has messaged us
// (consent); otherwise the API errors "User consent is required". [4]
export async function getFollowStatus(igsid: string): Promise<{
  is_user_follow_business: boolean; follower_count?: number; username?: string;
}> {
  return instagramFetch(`/${igsid}`, {
    params: { fields: "username,follower_count,is_user_follow_business" },
  });
}

// endpoints/comments.ts — the opener: private reply to a comment, carrying the
// confirm quick-reply button. Returns recipient_id. NOTE: quick_replies on a
// comment-scoped recipient is the one behaviour still to probe (see Open items);
// fall back to a text-only opener + typed keyword if the platform rejects it.
export async function sendOpener(
  commentId: string, text: string, button: { label: string; payload: string }
) {
  const accountId = requireAccountId();
  return instagramFetch<{ recipient_id: string; message_id: string }>(
    `/${accountId}/messages`,
    { method: "POST", body: {
      recipient: { comment_id: commentId },
      message: { text, quick_replies: [
        { content_type: "text", title: button.label, payload: button.payload },
      ] },
    } }
  );
}

// endpoints/comments.ts — plain DM to a known IGSID (reward/nudge), sent as a reply
// within the 24h window the confirm tap opened. [1]
export async function sendDirectMessage(recipientId: string, text: string) {
  const accountId = requireAccountId();
  return instagramFetch<{ recipient_id: string; message_id: string }>(
    `/${accountId}/messages`,
    { method: "POST", body: { recipient: { id: recipientId }, message: { text } } }
  );
}

// endpoints/messages.ts — incremental inbound messages since a cursor, via the
// Conversations API. [3]
//   GET /<IG_ID>/conversations?platform=instagram
//       &fields=updated_time,participants,messages{id,created_time,from,message}
// Walk conversations newest-first by updated_time, stop once updated_time <= cursor.
// Only the 20 newest messages per conversation are available. Each item carries the
// sender IGSID (from.id) and text (message). NOTE: a quick-reply tap arrives here as
// text = the button's title — payload is webhook-only, so it is not returned.
export async function listInboundMessagesSince(sinceIso?: string): Promise<
  { from_id: string; text: string; created_time: string }[]
>;
```

## Worker changes

**1. New comment branch** (existing branches untouched):

```ts
if (flow.template_type === "comment_to_follow_dm") {
  const cfg = flow.config as CommentToFollowDmConfig;
  const already = db.prepare(
    "SELECT 1 FROM follow_check_pending WHERE flow_id = ? AND commenter_username = ?"
  ).get(flow.id, placeholders.username);

  if (!already && cfg.opener_message?.trim()) {
    try {
      const pr = await sendOpener(comment.id, resolveDmCopy(cfg, "opener", placeholders), {
        label: cfg.confirm_button_label ?? "I'm following ✅",
        payload: cfg.confirm_payload ?? "FOLLOW_CONFIRM",
      });
      logEvent(db, { level: "info", kind: "opener_sent", flow_id: flow.id, recipient_id: pr.recipient_id, comment_id: comment.id });
      if (pr.recipient_id) {
        db.prepare(
          `INSERT OR IGNORE INTO follow_check_pending
             (flow_id, recipient_id, commenter_username, comment_id)
           VALUES (?, ?, ?, ?)`
        ).run(flow.id, pr.recipient_id, placeholders.username, comment.id);
      }
    } catch (err) {
      console.error(`[automation] follow-DM opener FAILED:`, err);
      logEvent(db, { level: "error", kind: "send_error", flow_id: flow.id, comment_id: comment.id, message: String(err) });
    }
  }
}
```

**2. New confirm poll** (runs once per cycle, after `processFlows`):

```ts
// Normalise for text matching: drop case, emoji and punctuation.
const norm = (s: string) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

export async function runFollowConfirmPoll() {
  const db = getDb();

  // (a) timeout cull — bounds the table every cycle
  db.prepare("DELETE FROM follow_check_pending WHERE created_at < datetime('now', ?)")
    .run(`-${PENDING_TTL_DAYS} days`);

  // (b) skip all message I/O when idle
  const pending = db.prepare("SELECT * FROM follow_check_pending").all() as PendingRow[];
  if (pending.length === 0) return;
  const byId = new Map(pending.map((p) => [p.recipient_id, p]));

  // (c) incremental inbound messages
  const since = getCursor(db, "follow_confirm_messages");
  const inbound = await listInboundMessagesSince(since);
  let newest = since;

  for (const msg of inbound) {
    if (!newest || msg.created_time > newest) newest = msg.created_time;
    const row = byId.get(msg.from_id);
    if (!row) continue;

    const flow = getActiveFlow(db, row.flow_id);
    if (!flow) { deletePending(db, row); continue; }          // flow gone → cull
    const cfg = flow.config as CommentToFollowDmConfig;
    // Polling gives text only (no payload) — match the button's title OR the typed
    // keyword. norm() strips emoji/punctuation/case so "I'm following ✅" == "im following".
    const label = norm(cfg.confirm_button_label ?? "I'm following ✅");
    const word = norm(cfg.confirm_keyword ?? "DONE");
    const text = norm(msg.text);
    const isConfirm = (label && text.includes(label)) || (word && text.includes(word));
    if (!isConfirm) continue;
    logEvent(db, { level: "info", kind: "confirm_tap", flow_id: row.flow_id, recipient_id: msg.from_id });

    let following: boolean;
    try {
      following = (await getFollowStatus(msg.from_id)).is_user_follow_business;
    } catch (err) {
      // Consent-missing here usually means follow lag or a non-messaging tap —
      // record it, then apply the configured policy (fail-closed by default).
      logEvent(db, { level: "warn", kind: "follow_check_error", flow_id: row.flow_id, recipient_id: msg.from_id, message: String(err) });
      if (cfg.on_check_error === "skip") continue;
      following = cfg.on_check_error === "reward";             // else fail-closed
    }

    const ph = { username: row.commenter_username ?? "" };
    if (following) {
      if (cfg.follower_message?.trim())
        await sendDirectMessage(msg.from_id, resolveTemplate(cfg.follower_message, ph));
      deletePending(db, row);                                  // final ✓ → cull
    } else if (row.nudge_count + 1 >= MAX_NUDGES) {
      await sendDirectMessage(msg.from_id, resolveTemplate(
        cfg.not_following_message ?? "Still not following, comment again to retry.", ph));
      deletePending(db, row);                                  // exhausted → cull
    } else {
      const nudge = resolveDmCopy(cfg, "nudge", ph);   // pack > not_following_message
      if (nudge.trim()) {
        await sendDirectMessage(msg.from_id, nudge);
        logEvent(db, { level: "info", kind: "nudge_sent", flow_id: row.flow_id, recipient_id: msg.from_id });
        bumpNudge(db, row);
      }
    }
  }

  setCursor(db, "follow_confirm_messages", newest);
}
```

Wired next to the existing cycle in `automation-register.ts` (same `tick`), so it
shares the 60s cadence.

> The raw `sendOpener` / `sendDirectMessage` calls in the snippets above are shown
> inline for readability; in the implementation each is wrapped by `throttledSend(...)`
> (see *Global send throttle*), which owns the cap, the jitter, and the
> `opener_sent`/`reward_sent`/`nudge_sent` + `cap_hit` logging — so the explicit
> `logEvent(… opener_sent …)` shown here moves inside it, and a `false` return means
> the caller must skip the claim / hold the cursor.

## Observability: events, failures & notifications

Every meaningful step and every failure is logged to a new table so problems are
inspectable after the fact instead of vanishing into stdout. This also absorbs the
follow-signal-lag case (a user who follows then taps before Instagram propagates the
follow): we don't special-case it — we record it and let the normal nudge + "tap
again" recovery handle it, with a stored warning so it's visible if it turns out to
be common.

New table (own migration in `getDb()`):

```sql
CREATE TABLE IF NOT EXISTS automation_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  flow_id      TEXT,
  recipient_id TEXT,
  comment_id   TEXT,
  level        TEXT NOT NULL CHECK(level IN ('info','warn','error')),
  kind         TEXT NOT NULL,   -- opener_sent | confirm_tap | reward_sent |
                                -- nudge_sent | follow_check_error | send_error |
                                -- consent_missing | lag_suspected | cap_hit
  message      TEXT,            -- human-readable detail
  meta         TEXT,            -- JSON blob (api error code, payload, etc.)
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events_created ON automation_events(created_at);
CREATE INDEX IF NOT EXISTS idx_events_level   ON automation_events(level);
```

- **Logging helper** `logEvent(db, { level, kind, flow_id?, recipient_id?, … })` —
  a cheap synchronous SQLite insert dropped at each branch (opener sent, tap matched,
  reward/nudge sent, and every `catch`). Never throws — logging failures are swallowed
  so they can't break the funnel.
- **Warnings worth recording:** `follow_check_error` (profile read threw),
  `consent_missing` (profile read errored with the consent message — likely lag, or a
  user who never actually messaged), `send_error` (DM POST failed; Graph error code in
  `meta`), `cap_hit` (per-cycle cap deferred sends).
- **Logs page (`/automations/logs`).** A dedicated DB-backed page listing
  `automation_events` newest-first: timestamp, level badge (info/warn/error), kind,
  flow, recipient, and message, with filters by `level` and `kind` and light
  auto-refresh. Fed by `GET /api/automation-events?level=&kind=&limit=` (read-only,
  mirrors the usage-meter pattern — the page never writes). `warn`/`error` rows are
  colour-highlighted, and the automations nav carries an unread `warn`+`error` count
  badge so failures — send errors, `cap_hit` backlogs, `follow_check_error`,
  `consent_missing` — surface without digging through stdout. No external alerting
  needed for a local cockpit.
- **Retention:** `DELETE FROM automation_events WHERE created_at < datetime('now','-30 days')`
  on the same cull cadence, so the table self-bounds like `follow_check_pending`.

## UI (`AutomationsClient.tsx`)

New template card **"Comment → Follow → DM"** with its own editor: keyword(s),
target posts, **Confirm button label** (default "I'm following ✅"), **Message pack**
(dropdown; e.g. `casual` — generates opener + nudge, previewed like comment reply
functions) with a manual override (**Opener** / **Not-following message**),
**Resource name** (`{{resource}}`, default "resources"), **Follower message**
(reward — manual), **on-error** select. The pack list comes from
`/api/follow-dm-functions`. Existing editors unchanged.

## Backward-compatibility guarantee

1. **Existing branches untouched** — new logic is a separate `template_type`
   branch + a separate poll function; current flows never enter either.
2. **Additive only** — new config type, one union value, one new table, two new
   endpoints. No existing type/row/route rewritten; no flow migration.
3. **Existing flows make zero new API calls** — no new rate-limit/failure surface.
4. **Diff-readable** safety + a **synthetic unit test** (in-memory `:memory:` DB,
   mocked send/lookup, fabricated flows): assert a `comment_to_dm` flow is
   unchanged and never touches the new table/functions, and that the follow flow
   routes reward/nudge/cull correctly. No prod data, no live API, no server.

## Edge cases & policy

- **Unknown follow status** → default fail-closed (nudge, not reward); configurable
  via `on_check_error`. Logged as `follow_check_error`.
- **Consent-missing / follow lag** → user taps confirm but the profile read errors or
  `is_user_follow_business` is still false because the follow hasn't propagated. Not
  special-cased: treated as "not following" → nudge + "tap again", and recorded as
  `consent_missing` / `lag_suspected` so we can see if it's frequent. [4]
- **Confirm from someone with no pending row** (organic message/tap) → ignored (not in
  the `Set`).
- **Repeat confirms** → nudge cap prevents spam; after reward the row's gone so a stray
  tap is ignored.
- **Same user comments again while awaiting** → entry dedupe skips a second opener.
- **Permissions**: `instagram_manage_messages` + `instagram_manage_comments`.
- **Limits**: one private reply per comment (7-day window — matches TTL); 24h window
  for the reward (opened by the confirm tap); per-cycle send cap + jitter honoured.

## Open items (probe before build)

1. **Quick replies on a comment-scoped recipient.** Docs show `quick_replies` sent to
   `recipient.id` (an IGSID); our opener uses `recipient.comment_id`. ManyChat does
   buttons on the first DM so it's very likely fine, but it's unverified — probe with
   one live private reply carrying `quick_replies`. **Fallback:** text opener + typed
   `confirm_keyword` (already modelled) if the platform rejects it.
2. **Webhooks are explicitly out of scope for now** — polling only. The confirm handler
   is written as a plain function so a `messages` webhook (via Cloudflare Tunnel) can
   call the same logic later without touching the state machine.

## Phasing

- **Phase 1** — the template + pending table + confirm poll + culling, the global
  send throttle, the `automation_events` log, and the `/automations/logs` page. Error
  visibility ships *with* the automation, not after it.
- **Phase 2** — analytics counters on the flow card (invited / rewarded /
  follow-prompted / expired).
- **Phase 3** — per-flow tunables (TTL, max nudges, cooldown) surfaced in the UI.
- **Phase 4** — request batching for the read fan-out (see below). Engine-wide
  efficiency pass, not follow-DM-specific, so it comes last.

## Phase 4 — Request batching (efficiency, with caveats)

The Graph API `POST /` `batch` param bundles up to 50 sub-requests into one HTTP
call, with optional dependency chaining (`{result=name:$.path}`) to feed one
sub-request's response into the next.

**The key correction — what batching does and doesn't do:**

| Dimension | Effect of batching |
|---|---|
| HTTP round-trips / TLS / latency | ✅ Reduced — one request instead of N |
| Rate-limit / quota consumption | ❌ **Unchanged** — Meta counts each sub-request individually against call limits |
| Client-side concurrency handling | ✅ Simpler — a single call to await |
| Messaging spam/velocity signals | ⚠️ Can *worsen* — batched sends fire in one burst |

Batching is a **latency/overhead** optimisation, **not** a rate-limit one. It does
not reduce quota "strain"; it reduces connections and per-cycle wall-clock time.

**Where it genuinely helps (read-heavy fan-out):**

- `runAutomationCycle` lists comments post-by-post today — batch the per-post
  `GET /{media}/comments` into groups of ≤50 → one round-trip per group.
- The confirm poll: when K users reply/tap DONE in a cycle, batch the K
  `getFollowStatus` reads into one call, then branch client-side.

**Where NOT to batch (and why):**

- **The reward/nudge DM sends.** Quota is unchanged, and bundling them fires them
  simultaneously — the opposite of the paced/jittered delivery that keeps sends
  under Meta's spam thresholds (see *Overwhelm safeguards*). Sends stay individual
  and throttled.
- **Conditional branching can't live in a batch.** Dependency chaining only
  forwards *values* (ids, fields) into later sub-requests; it cannot express "send
  the reward only if `is_user_follow_business === true`." The follow decision stays
  in client code, so there is no check+send batch to fuse anyway.

**Net rule:** batch the reads (comment fan-out, follow-status checks) for fewer
round-trips; keep the writes (DMs) individual and paced.

## Documentation

Hub: [Instagram Platform API reference](https://developers.facebook.com/documentation/instagram-platform/reference)

- **[1] Send Messages** (Instagram API with Instagram Login) — `POST /<IG_ID>/messages`,
  24-hour messaging window, human-agent tag —
  https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api/
- **[2] Quick Replies** — `message.quick_replies[]`, max 13, title ≤ 20 chars, tap
  returns `quick_reply.payload` —
  https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api/quick-replies/
- **[3] Conversations API** — `GET /<IG_ID>/conversations?platform=instagram`, 20-message
  cap per conversation —
  https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/conversations-api/
- **[4] User Profile API** — `is_user_follow_business` + the consent requirement —
  https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api/user-profile
