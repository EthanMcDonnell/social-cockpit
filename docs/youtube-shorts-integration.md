# YouTube Shorts upload + comment automation — implementation plan

Bring YouTube up to parity with Instagram as a **first-class platform** across the
app: publish Shorts from Compose Studio, and run keyword→reply comment automations,
reusing the R2 hosting layer and the automation worker that already exist.

> **Status: PLAN ONLY.** Nothing here is built yet. Per `CLAUDE.md`, this repo serves
> live traffic — implementation will edit source only; no build/restart/deploy/DB
> migration happens until handed off. DB changes below are additive and deferred.

Mockups (static, non-functional, cockpit aesthetic):
- `docs/youtube-shorts-mockup.html` — platform-switch Compose Studio + Comment Engine.
- `docs/automations-multiplatform-mockup.html` — Automations page with a single-select
  `IG | YT` switch, per-platform template picker, and the capability registry.

---

## Design principle: YouTube is a platform, not an add-on

The dashboard already treats platform as a **top-level axis** — a segmented `IG / YT`
switch (`ck-pswitch`) driven by a shared `?platform=` URL param
(`src/hooks/usePlatform.ts`, `PlatformSwitch.tsx`, `PlatformGlyph.tsx`). Every
instrument re-reads that one piece of state.

Compose Studio and Automations adopt the **same spine**:

- A `PlatformSwitch` (IG / YT, with the existing brand glyphs) sits at the top of
  Compose. It drives the whole studio, not a fifth media-type button bolted onto the
  Instagram strip.
- The **media-type strip is platform-scoped**: IG shows `Reel / Photo / Carousel /
  Story`; YT shows `Short / Video`. Switching platform swaps the strip, the field set,
  the phone-preview chrome, the endpoint label, and the Publish button color.
- The publish plumbing stays shared where it can (R2 sign → PUT → reclaim) and forks
  only at the final API call (`graph.instagram.com` vs `googleapis.com`).

Net effect: adding YouTube costs one more value in the `Platform` union and one more
publish adapter — the layout, R2 layer, and automation loop are reused, not duplicated.

---

## The single most important constraint: the unverified-app private lock

An **unverified Google Cloud project** (any created after 2020-07-28 that has not passed
YouTube's compliance audit) has **every API-uploaded video forced to `private`** —
YouTube overrides `status.privacyStatus` regardless of what we send. Public/unlisted/
scheduled publishing via the API is unavailable until the project passes a **one-time
compliance audit** (submit a form; Google reviews the app's use of the API).

- Docs: [Quota and Compliance Audits](https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits)

This is the *same class of gate* as the Instagram publishing permissions. It splits the
work into two honest targets:

- **Pre-audit (build now):** upload a Short to the channel as a **private draft**; the
  user flips it public in YouTube Studio. Everything else — R2 flow, metadata, comment
  automation — works fully.
- **Post-audit:** the same Publish button emits real public / scheduled visibility. No
  other code changes.

Comment automation (`comments.insert`, `commentThreads.insert`) is **not** subject to
this lock — replies work immediately once OAuth is connected.

---

## Auth — the one genuinely new subsystem

Today's YouTube integration is **read-only via an API key** (`YOUTUBE_API_KEY` +
`YOUTUBE_CHANNEL_ID`, see `check-youtube.mjs`, `api/youtube/*`). An API key **cannot**
upload or reply — those are write operations that require **OAuth 2.0** on behalf of the
channel owner.

New auth surface, modeled on the existing Instagram token manager
(`src/lib/token/manager.ts`, which already exchanges/refreshes and writes back to `.env`):

- **Scopes:** `https://www.googleapis.com/auth/youtube.upload` (uploads) +
  `https://www.googleapis.com/auth/youtube.force-ssl` (comments/moderation).
- **Flow:** one-time consent → authorization code → refresh token. Store the refresh
  token in `.env`; mint short-lived access tokens on demand and cache in-process.
- **Settings UI:** a "Connect YouTube" panel beside the Instagram token panel, showing
  connected channel + token health (reuse `TokenStatusPanel` shape).

Read paths (dashboard metrics, video list) keep using the API key — no reason to change
them.

---

## Upload flow — reuse the R2 hosting layer

YouTube's `videos.insert` is a **resumable upload**: the server streams bytes to
`https://www.googleapis.com/upload/youtube/v3/videos`. We source those bytes from the
**same R2 object** the browser already uploaded, mirroring the Instagram path
(`docs/r2-integration.md`) so the heavy media never round-trips through the laptop twice.

```
Browser → POST /api/publish/r2-sign        (existing: reserve cap, presigned PUT)
Browser → PUT file DIRECTLY to R2          (existing)
Browser → POST /api/youtube/publish { key, metadata }
Next    → presign GET (existing r2.ts) → stream R2 object into videos.insert (resumable)
Next    → poll processing status → return video id + studio URL
Next    → reclaimKeys([key])               (existing: delete R2 object)
```

Only the *middle* step is new; `r2-sign`, the usage/cap gate, and `reclaimKeys` are
reused verbatim. The 8 GiB cap and lifecycle backstops already protect this path.

### What makes a video a "Short"

There is **no dedicated Shorts endpoint or API flag** — same `videos.insert`. A video is
classified as a Short by signals:

- **Vertical 9:16** (1080×1920) aspect ratio, and
- **≤ 3 minutes** duration (raised from 60s in late 2024), and
- **`#Shorts`** in `snippet.title` or `snippet.description` (the programmatic signal we
  set by default).

The Compose "Short" media-type sets these defaults and validates the source is vertical
and short before enabling Publish.

- Docs: [Videos: insert](https://developers.google.com/youtube/v3/docs/videos/insert)

### Quota

Default is **10,000 units/day**. `videos.insert` is the expensive call (~1600 units →
~6 uploads/day); reads and comment polls are 1 unit; a reply is 50 units. For a
single-channel tool this is a non-issue. Higher upload volume needs the audit anyway.

- Docs: [Quota Calculator](https://developers.google.com/youtube/v3/determine_quota_cost)

---

## Automation feasibility — what YouTube actually allows

| Capability | API surface | Auth / cost | Feasible |
| --- | --- | --- | --- |
| Reply to a comment | `comments.insert` | OAuth force-ssl · 50u | **Yes** |
| Post a top-level comment | `commentThreads.insert` | OAuth force-ssl · 50u | **Yes** |
| Read / poll comments | `commentThreads.list` | key or OAuth · 1u | **Yes (cheap)** |
| Hide / moderate a comment | `comments.setModerationStatus` | OAuth force-ssl · 50u | **Yes (own channel)** |
| Trigger on **new upload** | PubSubHubbub / WebSub | public callback · 0u | **Yes — real push** |
| Trigger on **new comment** | — | no webhook exists | **Poll only** |
| Pin a comment | — | not in public API | **No (manual in Studio)** |
| Creator-heart a comment | — | not in public API | **No** |
| DM a commenter | — | YouTube has no DM API | **No** |

**Conclusion:** reply-to-comment is fully automatable and drops straight onto the
existing pattern. YouTube has **no comment webhook**, so it is poll-based — which is
exactly what `runAutomationCycle()` already does for Instagram. The reply templates in
`src/lib/comment-reply-functions.ts` (`chill_replies`, `spirit_animal`, `fortune_cookie`,
…) are reusable **as-is**; only the send call changes (`comments.insert` instead of the
IG reply endpoint). New-upload detection can be **push** via WebSub, which then arms the
comment poll for that video id.

The IG-specific `comment_to_dm` / `comment_to_follow_dm` templates do **not** port —
YouTube has no DM. YouTube automations are `comment_to_reply` and (on publish)
`first_comment` only.

---

## Unified automations across platforms (IG / YT / future)

The automations page (`AutomationsClient.tsx`) is IG-only today: a master-detail layout
(left flow list, right template-picker → editor). YouTube must not bolt a second page on
— it adopts the **same platform-switch spine** as the dashboard, plus a small
**capability registry** so future platforms slot in without a rewrite.

**One switch, single-select — configs stay separate.** The header carries a single-select
`IG | YT` control (the `ck-pswitch` + brand glyphs), identical to the dashboard's
`?platform=`. There is deliberately **no "ALL" merged view and no second switch**: an ALL
list has no implied platform, which forces the "New" picker to ask for platform again —
two switches for one concept. Single-select removes that:

- The flow list shows **only the active platform's flows** — no grouping, no per-row
  glyphs, no comingled config.
- **"New" inherits the active platform**, so the template picker needs no platform
  sub-selector — you're on YT, hit New, you get YT templates.
- Configs are **separate per platform** by construction; shared code (worker dispatch,
  reply templates, UI components, registry) lives underneath and is invisible to the user.
- A cross-platform *overview* ("ALL") is a later, optional addition — it belongs in
  Logs / a dashboard tile, not the editor. The `platform` column makes it trivial to add
  if wanted; nothing here blocks it.

Backed by:

- **Every flow carries a `platform`** — the one additive column on `automation_flows`,
  default `ig` so existing rows stay valid.
- **Templates are declared per platform, not hardcoded.** A registry entry per platform:

  ```ts
  // src/lib/automations/registry.ts (new)
  interface PlatformAutomation {
    id: Platform;                 // "ig" | "yt" | …
    label: string;               // "Instagram"
    glyph: ReactNode;            // reuse PlatformGlyph
    brand: string;               // brand hue
    templates: AutomationTemplateType[]; // which templates this platform supports
    send(flow, ctx): Promise<void>;      // the platform's reply/post adapter
  }
  ```

  - `ig`: `comment_to_dm`, `comment_to_reply`, `comment_to_follow_dm`
  - `yt`: `comment_to_reply`, `first_comment` — the DM/follow templates **don't exist**
    for YouTube (no DM API), so the picker never offers them.
  - Adding TikTok later = one registry entry; the switch, list filter, template picker,
    and worker dispatch all pick it up automatically.

- **The worker dispatches by `platform`.** `runAutomationCycle()` groups active flows by
  platform, polls each platform's comment source, and calls that platform's `send`
  adapter. The reply **templates** (`comment-reply-functions.ts`) stay shared across all
  platforms — only the transport differs.

**`first_comment` template (YouTube).** On publish, post one top-level comment on the new
video (`commentThreads.insert`). Note the limitation surfaced in the UI: **posting is
automatable; pinning is not** in the public API — so it's marketed as "auto first
comment," and pinning stays a manual step in Studio if wanted.

## Code surface

**New**
- `src/lib/youtube/oauth.ts` — OAuth exchange/refresh, `.env` write-back (parallels
  `src/lib/token/manager.ts`).
- `src/lib/youtube/upload.ts` — resumable `videos.insert` sourced from an R2 signed GET;
  Shorts defaults + vertical/duration validation.
- `src/lib/youtube/comments.ts` — `list` / `insert` / `setModerationStatus`.
- `src/app/api/youtube/publish/route.ts` — YT publish endpoint (mirrors `api/publish`).
- `src/app/api/youtube/oauth/**` — consent-callback + status routes.
- `src/app/api/youtube/websub/route.ts` — PubSubHubbub verify (GET) + notification (POST)
  for the new-upload trigger.

**Extend**
- `src/hooks/usePlatform.ts` — already models `ig | yt`; promote it (or a sibling hook)
  for use in Compose + Automations.
- Compose: `MediaTypeStrip.tsx` → platform-scoped strip; `ComposeStudio.tsx` +
  `draft.ts` → platform in the draft, YT field set, `ReelPreview` → platform-aware
  preview chrome; add `PlatformSwitch` to the Compose header.
- `src/lib/automation-worker.ts` — group active flows by `platform` and dispatch each to
  its registry `send` adapter within the existing poll cycle; WebSub arms which YT video
  ids to poll.
- `src/lib/comment-reply-functions.ts` — unchanged; reused by both platforms.

**DB (additive, deferred — not applied until hand-off)**
- `automation_flows`: add a `platform` column (default `ig`) discriminating IG vs YT
  flows; keep existing rows valid.
- Optional `youtube_uploads` table to log published video ids ↔ R2 keys for reclaim
  auditing (parallels how publishes are tracked today).

**Env vars (`.env` + `.env.example`)**
```
YOUTUBE_OAUTH_CLIENT_ID=
YOUTUBE_OAUTH_CLIENT_SECRET=
YOUTUBE_OAUTH_REFRESH_TOKEN=      # written back after first consent
# existing read-only key/channel stay as-is:
YOUTUBE_API_KEY=
YOUTUBE_CHANNEL_ID=
```

---

## Phasing

0. **OAuth connect** — Settings panel; consent → refresh token in `.env`; show connected
   channel. Proves auth before anything else.
1. **Platform switch in Compose** — wire `PlatformSwitch` + platform-scoped media-type
   strip and preview chrome. Pure UI; no publish yet.
2. **Upload one Short → private draft** end-to-end via R2. Proves the loop (works
   pre-audit).
3. **Comment poll + keyword→reply**, reusing the reply templates and the automation
   worker; `platform` column on flows.
4. **WebSub** new-upload trigger + first-comment auto-post.
5. **Submit the compliance audit** → flip Publish to real public / scheduled visibility.

Phases 0–4 are fully functional with videos landing as private drafts; phase 5 is the
only thing gated on Google's review.

---

## Decisions (resolved)

1. **Ship pre-audit** — build now with Shorts landing as **private drafts**; flip the
   Publish button to public/scheduled after the audit (phase 5).
2. **User handles** the OAuth consent-screen setup + compliance-audit submission.
3. **First-comment auto-post: keep it** — post the top comment automatically; pinning
   stays a manual step in Studio (not in the public API).

Single-switch automations (no "ALL", no nested switch) confirmed — see the unified
automations section above.

---

**Sources:** [Quota & compliance audits](https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits) ·
[videos.insert](https://developers.google.com/youtube/v3/docs/videos/insert) ·
[Quota calculator](https://developers.google.com/youtube/v3/determine_quota_cost) ·
[R2 integration](./r2-integration.md)
