# Scheduling

A Postiz-style scheduling layer: a multi-platform calendar with drag-and-drop, an
API you can `curl` from your laptop, and a background worker that publishes at
the appointed time. Reuses the existing publish + automation machinery rather
than forking it.

**Guiding constraint: media never touches Cloudflare R2 until publish time.**
Everything is staged on local disk; R2 is a transient carrier that exists only
for the seconds/minutes of the actual publish call.

> **Integrity migration required:** production scheduler workers require the
> explicitly reviewed `lease_token` migration. It never runs automatically at
> startup. See [Scheduler integrity migration](./scheduler-integrity-migration.md)
> for backup, preflight, apply, rollback, and deployment instructions.
>
> **Delivery guarantee:** SQLite lease fencing prevents stale workers from
> overwriting a newer owner and serializes finalizer claims. The external platform
> boundary remains at-least-once if a process crashes after an API acceptance but
> before durable state is written.

---

## 1. Where this plugs into what already exists

The publish path is already correct and reusable — the scheduler does not
reimplement any of it.

| Existing piece | Role in scheduling |
|---|---|
| `src/lib/instagram/publish-flow.ts` (`publishFromR2`, `validatePublish`, `applyReelDefaults`, `handlePublishError`) | Unchanged. The worker calls it exactly as the routes do. |
| `src/app/api/publish/local/route.ts` (`resolveLocalPath`, `uploadPath`) | **Extracted** to a lib module so the worker can upload a staged file at fire time. |
| `src/lib/automation/attach.ts` (`planAutomation` / `applyAutomationPlan`) | Unchanged. Its two-phase split (validate early, write after `media_id`) is *exactly* what a scheduler needs — see §6. |
| `src/lib/storage/usage.ts` (`reserve`/`release`) + `reclaim.ts` | Unchanged. R2 cap gating still applies, now inside the worker. |
| `src/lib/youtube/upload.ts` (`uploadVideoFromR2`) | Unchanged. Same fire-time flow for YouTube. |
| `src/lib/automation-register.ts` pattern | Copied for `src/lib/schedule/register.ts` — boot tick + `setInterval`, wired via `src/instrumentation.ts`. |
| `src/lib/db/index.ts` | New tables appended to the same additive `CREATE TABLE IF NOT EXISTS` list. No `ALTER` on existing tables. |

### Refactors required (behaviour-preserving)

1. **`src/lib/publish/local-source.ts`** — move `CONTENT_TYPES`, `contentTypeFor`,
   `resolveLocalPath`, `uploadPath`, `PathError`, `CapError` out of
   `api/publish/local/route.ts`. The route imports them; the worker imports them.
   `LOCAL_MEDIA_ROOT` confinement therefore applies to scheduled jobs for free.
2. **`src/lib/publish/execute.ts`** — `runPublishWithAutomation(input, r2, opts, plan?)`.
   The ~25 lines of "publish, then attach automation if we got a `media_id`" are
   currently duplicated verbatim in `api/publish/route.ts` and
   `api/publish/local/route.ts`. Both routes and the worker call the shared
   version. This kills existing duplication as a side effect.

Neither refactor changes any observable behaviour, so the live instance is
unaffected until it's restarted.

---

## 2. Media staging — the "R2 only at publish time" rule

Two ways a job acquires media, unified into one representation: **an absolute
path on the server's disk.**

```
                          schedule time                    fire time
laptop curl  ──► video_path: /Users/…/reel.mp4  ──►  (referenced in place)  ──┐
                                                                              ├─► upload to R2 ─► publish ─► reclaim
browser DnD  ──► POST /api/schedule/media ──► data/staged/<uuid>.mp4  ────────┘
```

- **API path (`video_path`, `image_path`, `cover_path`, `children_paths`)** — the
  job stores the path and *references the file in place*. Nothing is copied,
  nothing is uploaded. Validated at schedule time (exists, is a file, inside
  `LOCAL_MEDIA_ROOT`, size recorded) so a typo 400s immediately instead of at 3am.
- **Browser path** — a `File` object cannot survive a page reload, and we're not
  allowed to park it in R2. So the calendar uploads it to
  `POST /api/schedule/media`, which streams it to `data/staged/<uuid>.<ext>` and
  returns a `staged_id`. The app *owns* this copy and deletes it after
  publish/cancel.

The `owned` flag is the whole difference: owned files are cleaned up, referenced
files are never touched.

### Local disk cap

Mirrors the R2 cap design in `src/lib/storage/usage.ts`, for the same reason
(nothing else bounds it):

- `SCHEDULE_MEDIA_CAP_BYTES` (default 20 GB) gates `POST /api/schedule/media`.
- `SUM(size_bytes) WHERE owned = 1` is the authoritative reserved figure.
- Owned rows are deleted (file + row) on publish success, terminal failure, or
  job cancellation.
- A sweep drops owned files with no referencing job older than 7 days — the
  "uploaded then closed the tab" case.

### Pre-flight check

A referenced path can vanish between scheduling and firing. The worker
`stat()`s every source **before** touching R2 or Instagram; a missing file is a
terminal failure with a clear message, not a retry loop. The calendar also
re-validates paths on load and badges a job whose file has gone missing, so you
find out before the slot arrives.

---

## 3. Data model

Additive only — appended to the existing list in `src/lib/db/index.ts`, so an
existing `data/automations.db` picks them up on next boot with no migration.

```sql
CREATE TABLE IF NOT EXISTS scheduled_posts (
  id              TEXT PRIMARY KEY,
  platform        TEXT    NOT NULL CHECK(platform IN ('ig','yt')),
  status          TEXT    NOT NULL CHECK(status IN
                    ('pending','publishing','finalizing','published',
                     'failed','missed','cancelled','paused')),
  scheduled_at    INTEGER NOT NULL,          -- epoch ms, UTC
  payload         TEXT    NOT NULL,          -- JSON: PublishInput | YoutubePublishRequest (no media)
  media           TEXT    NOT NULL DEFAULT '[]', -- JSON: [{ role, staged_id }]
  automation      TEXT,                      -- JSON: AutomationSpec, applied at fire time
  attempts        INTEGER NOT NULL DEFAULT 0,
  max_attempts    INTEGER NOT NULL DEFAULT 3,
  next_attempt_at INTEGER,                   -- epoch ms; backoff gate
  lease_until     INTEGER,                   -- epoch ms; crash recovery
  grace_minutes   INTEGER NOT NULL DEFAULT 60,
  container_id    TEXT,                      -- set on a 202, drives 'finalizing'
  result          TEXT,                      -- JSON: media_id, permalink, automation attach, error
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sched_due ON scheduled_posts(status, scheduled_at);

CREATE TABLE IF NOT EXISTS scheduled_media (
  id           TEXT    PRIMARY KEY,
  path         TEXT    NOT NULL,             -- absolute path on the server's disk
  owned        INTEGER NOT NULL DEFAULT 0,   -- 1 = we copied it in, delete after use
  size_bytes   INTEGER NOT NULL,
  content_type TEXT    NOT NULL,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS schedule_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id     TEXT,
  level      TEXT NOT NULL CHECK(level IN ('info','warn','error')),
  kind       TEXT NOT NULL,
  message    TEXT,
  meta       TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sched_events_created ON schedule_events(created_at);
```

**`scheduled_at` is epoch milliseconds, not a `datetime('now')` string.** The
existing tables use SQLite text timestamps, which are fine for "when did this
happen" but ambiguous and awkward for "is this due yet" comparisons across
timezones. An integer makes the claim query trivially correct and indexable.

`schedule_events` mirrors the `automation_events` design (same shape, same
30-day retention cull on the worker cadence) so the Logs page can render both
with one component.

---

## 4. The worker

`src/lib/schedule/worker.ts` + `src/lib/schedule/register.ts`, registered from
`src/instrumentation.ts` alongside the existing four workers.

- **Cadence:** 30s (`SCHEDULE_INTERVAL_MS`). Finer than the 60s automation tick
  because a scheduled slot should land within ~half a minute of its time.
- **Kill switch:** `SCHEDULER_ENABLED` (default `true`). Any non-prod instance
  runs with it `false` — see §8.
- **Concurrency:** one job at a time. An IG reel publish can block for up to
  5 minutes; serial execution keeps Graph API pressure predictable and makes the
  claim logic trivial. A backlog drains one job per tick.

### Claiming (crash-safe)

```sql
UPDATE scheduled_posts
   SET status = 'publishing', lease_until = ?, attempts = attempts + 1
 WHERE id = (SELECT id FROM scheduled_posts
              WHERE status = 'pending'
                AND scheduled_at <= ?
                AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
              ORDER BY scheduled_at ASC LIMIT 1)
   AND status = 'pending';
```

The `AND status = 'pending'` re-check makes the claim atomic even if a slow
publish causes two ticks to overlap. A `lease_until` in the past on a
`publishing` row means the process died mid-publish — the next tick requeues it
to `pending` (subject to `max_attempts`).

> ⚠️ **At-least-once, not exactly-once.** A crash *after* Instagram accepted the
> publish but *before* the DB write is the one case that can double-post. The
> mitigation is `container_id`: it's written before the publish call, so a
> requeued job first checks the existing container's status and finalizes it
> rather than creating a second one.

### Fire-time sequence

1. `stat()` every source path. Missing → terminal `failed`.
2. Re-run `planAutomation()` if the job carries an automation spec (see §6).
3. `uploadLocalFile()` each source → R2 (reserving against `R2_CAP_BYTES`).
4. `executePublish()` — publish, then attach the automation on the real
   `media_id`.
5. Reclaim R2 keys (handled inside `publishFromR2`), delete owned staged files.
6. Write `result`, set status `published`.

There is deliberately **no pre-flight rate-limit check**. Asking the Graph API
how throttled it is costs a call of its own; `instagramFetch` already throws
`RateLimitError` when the app-usage header crosses 90%, so the worker classifies
that as retryable and backs off. Same outcome, one fewer request.

### Missed windows

If the server was off for three hours, waking up and blasting six posts at once
is the wrong behaviour. Each job has `grace_minutes` (default 60,
`SCHEDULE_GRACE_MINUTES`):

- Due and within grace → publish now.
- Due and past grace → status `missed`, no publish, event logged, badged in the
  calendar with a one-click "post now" / "reschedule".

### Retries

Exponential backoff (1m, 5m, 20m) via `next_attempt_at`, capped by
`max_attempts`. Classified by error type:

| Error | Treatment |
|---|---|
| `RateLimitError` (429), network, 5xx | Retry with backoff |
| 202 still processing | → `finalizing` (not a failure) |
| `ContainerFailedError` (422), `invalid_param` (400), missing file | Terminal `failed` |

### The 202 / `finalizing` state

`usePublish` in the browser already handles this: a slow reel returns 202, then
the client polls and calls `/api/publish/finalize`. The worker needs the same or
slow reels silently never publish. A 202 stores `container_id` and moves the job
to `finalizing`; subsequent ticks poll `getContainerStatus` and call
`publishContainer` on `FINISHED`. Automation attaches then, on the real
`media_id`. R2 sources are deliberately left in place across this window (the
container may still be fetching), matching `publishFromR2`'s existing rule, and
reclaimed at finalize.

---

## 5. API — schedule from your laptop

Deliberately shaped so that **anything you can `curl` to `/api/publish/local`
becomes a scheduled post by adding `scheduled_at`.**

```bash
curl -X POST localhost:3000/api/schedule -H 'Content-Type: application/json' -d '{
  "scheduled_at": "2026-08-12T09:30:00-05:00",
  "video_path": "/Users/ethanmcdonnell/clips/summer-v3.mp4",
  "caption": "Comment LINK for the guide 👇",
  "trial_params": { "graduation_strategy": "MANUAL" },
  "automation": {
    "key": "summer-giveaway",
    "name": "Summer giveaway",
    "trigger_keywords": ["LINK", "GUIDE"],
    "config": {
      "comment_replies": ["Sent! 📩"],
      "initial_message": "Here's the guide: https://example.com/guide"
    }
  }
}'
```

Response: `201` with the job row. **Nothing has been uploaded anywhere at this
point** — the file is still only on your disk.

| Route | Purpose |
|---|---|
| `POST /api/schedule` | Create. Accepts `scheduled_at` (ISO-8601, offset respected; bare = server TZ), `platform` (default `ig`), the `PublishInput` fields, `*_path` sources, `automation`, `grace_minutes`. |
| `GET /api/schedule?from=&to=&status=&platform=` | List for the calendar window. |
| `GET /api/schedule/:id` | One job with its event history. |
| `PATCH /api/schedule/:id` | Reschedule (`scheduled_at`), edit payload, `pause`/`resume`. Rejected once `publishing`. |
| `DELETE /api/schedule/:id` | Cancel; deletes owned staged media. |
| `POST /api/schedule/:id/run` | Fire now, ignoring the clock. |
| `POST /api/schedule/media` | Browser upload → staged file, returns `staged_id`. |

**Validation at schedule time** (fail fast, not at 3am): `validatePublish` on the
payload, `stat()` on every path, `planAutomation` on the automation spec,
`scheduled_at` must parse and be in the future.

### Auth

Same trust boundary as the existing `/api/publish/local` — none, because it
binds to localhost for a single user. If the instance is reachable off-localhost,
`POST /api/schedule` is a remote-publish surface with a filesystem-path
parameter. `LOCAL_MEDIA_ROOT` already confines the path; I'd add an optional
`SCHEDULE_API_TOKEN` bearer check (no-op when unset) so exposing the port doesn't
hand out your Instagram account. Flagging it, not gold-plating it.

---

## 6. Automation autosetup

The existing `automation` block works with zero changes to `attach.ts`, because
its two-phase split lines up with scheduling perfectly:

- **`planAutomation()` at schedule time** — read-only validation. A bad spec
  400s the `POST /api/schedule` call immediately. This plan is *discarded*, used
  only as a gate.
- **`planAutomation()` again at fire time** — the create-vs-append decision is
  re-resolved then, because between scheduling and firing another post may have
  created the flow that owns this `automation.key`. Resolving once at schedule
  time would create a duplicate flow. **This is the subtle bit and the reason we
  store the raw `AutomationSpec` rather than a resolved plan.**
- **`applyAutomationPlan()`** — after the publish, on the real `media_id`.

Consequence, and it's a nice one: schedule five variations of the same video
across a week with the same `automation.key`, and each one appends itself to the
one shared flow as it goes live. Exactly the behaviour
`docs/publish-with-automation.md` describes, now across time.

Calendar-side conveniences (thin UI over the same block):

- Pick an existing flow from `GET /api/automation-flows` → prefills its
  `automation_key`, so the scheduled post joins that flow.
- Or define a new flow inline (name, keywords, replies, DM body).
- Caption scanning: a caption containing `Comment LINK below` suggests `LINK` as
  a trigger keyword — a prefill you can reject, never an automatic write.
- The calendar card shows an automation glyph, so "which scheduled posts have a
  funnel attached" is visible at a glance.

---

## 7. Calendar UI

New route `/calendar`, added to `NAV` in `CockpitHeader.tsx`. Styled in
`globals.css` under a `.cal` scope, following the existing `.cockpit` / `.compose`
convention and reusing the same tokens. Platform colour fork follows the
established precedent (`.cs-transmit.yt`): Instagram amber, YouTube red.

**No new dependencies.** The repo hand-rolls its UI (only `recharts` +
`@tanstack/*`); a calendar/DnD library would be out of character and heavier than
what's needed.

### Views

- **Week** (default) — 7 columns × hour rows, current-time line, the Postiz
  workhorse.
- **Month** — day cells with stacked post chips and a "+3 more" overflow.
- **Day / list** — dense agenda for a busy day.

### Drag and drop

Two mechanisms, because they solve different problems:

1. **Moving a scheduled card → Pointer Events.** Custom pointer-based dragging,
   not HTML5 DnD, which has a poor drag image and no fine control. Slot snapping
   at 15 min, a translucent drag proxy, the target slot highlighting, and a live
   time readout following the cursor. `PATCH /api/schedule/:id` on drop, wrapped
   in a react-query optimistic update (`onMutate` → snapshot → rollback on
   error), so the card lands instantly and only snaps back if the server
   rejects it.
2. **Dropping a file from the desktop onto a calendar cell → native
   `dragover`/`drop`.** This is the flow worth optimising: drag `reel.mp4` onto
   Thursday 9am → the file uploads to staging with a progress ring on the
   nascent card → a compact composer opens pre-filled with that slot's time →
   confirm. `POST /api/schedule/media` then `POST /api/schedule`.

Both respect `prefers-reduced-motion`, and every drag interaction has a keyboard
equivalent (select a card, `[` / `]` to shift the slot, `Enter` to open the
editor) so the calendar isn't mouse-only.

### Card states

`pending` · `publishing` (pulsing) · `finalizing` · `published` (links to
permalink) · `failed` (retry button) · `missed` (post-now / reschedule) ·
`paused`. Plus a warning badge when a referenced source file has gone missing.

### Timezone

One setting, stored in the DB, defaulting to
`Intl.DateTimeFormat().resolvedOptions().timeZone`. All storage is UTC epoch ms;
all rendering converts through the setting. Shown in the calendar header, because
a scheduler that's silently wrong about the timezone is worse than no scheduler.

### Published-history overlay (phase 4)

The cache DB already holds published posts with timestamps
(`getCachedMediaPage`, `getAllCachedMedia`). Rendering them as read-only cards
behind the scheduled ones turns the calendar into a full timeline — past and
future in one view, which is a big part of why Postiz's calendar feels useful.
Cheap, since the data is already local.

---

## 8. Testing without touching the production database

Non-negotiable: `data/automations.db` is live and the running server is serving
real traffic. **No script, no `sqlite3`, no query, no dev-server run against
`data/*.db` at any point.**

Four layers:

1. **`DB_PATH` already exists.** `src/lib/db/index.ts:5` reads it. Every new
   table goes through the same `getDb()`, so a scratch database is a one-liner:
   `DB_PATH=/tmp/sched-test/test.db npm run dev -- -p 3001`. Fresh file, tables
   auto-created, prod untouched. Never run a second process against the prod
   path — two writers on one WAL file is exactly the risk to avoid.
2. **`SCHEDULE_DRY_RUN=true`.** The worker performs every step — claim, lease,
   stat, state transitions, automation planning, event logging — but skips the
   R2 upload entirely and substitutes a stub for the Instagram/YouTube call,
   returning a synthetic `media_id`. The state machine (retries, backoff, grace
   expiry, missed-window handling) is verifiable with zero API calls, zero real
   posts, and no R2 credentials at all.

   The automation is **planned but not written** in dry run. Attaching would
   create a real flow pointing at a synthetic `media_id`, which the automation
   worker then correctly prunes as a deleted post — deactivating the flow and
   leaving debris. Reporting the decision (`"would have created flow X with
   keywords LINK, GUIDE"`) proves the create-vs-append logic ran without leaving
   anything behind. *This was found by running it, not by reasoning about it.*
3. **`SCHEDULER_ENABLED=false` everywhere except prod.** Belt and braces: even
   with a mispointed `DB_PATH`, a test instance cannot publish.
4. **Additive-only schema.** New `CREATE TABLE IF NOT EXISTS` statements, no
   `ALTER` on existing tables, no backfill, no data migration. The prod DB gains
   three empty tables on next boot and is otherwise byte-identical. Fully
   reversible by dropping them.

Deployment stays manual per `CLAUDE.md`: the code is handed off, and the running
instance isn't restarted until you say so.

---

## 9. Configuration

Two tiers, split by whether needing a restart is acceptable.

### 9a. Posting policy — stored, live-editable

Kept in the `app_settings` table (`src/lib/schedule/settings.ts`), served from
`GET/PUT /api/schedule/settings`. These live in the database for the same reason
the timezone does: they change what a slot *means*, so they have to take effect
immediately rather than at the next restart of a production server we're told
not to restart.

| Setting | Default | What it does |
|---|---|---|
| `calendar.timezone` | host zone | Zone the calendar renders in, and that bare `scheduled_at` strings are read in. |
| `calendar.suggested_times` | `["09:30"]` | Times of day slots are offered at, in preference order. **More than one entry is how a day holds more than one post.** A suggestion — a caller may still ask for any time. |
| `calendar.max_posts_per_day` | `2` | Hard ceiling on posts per calendar day. **Enforced, not advisory:** `POST /api/schedule` and a rescheduling `PATCH` return `409 day_full`. Counts posts published outside the scheduler too, so it is a true statement about the account rather than about this app's own bookings (`src/lib/schedule/capacity.ts`). |

```bash
curl -X PUT localhost:3000/api/schedule/settings -H 'Content-Type: application/json' \
  -d '{"suggested_times":["09:30","18:00"],"max_posts_per_day":2}'
```

### 9b. Operational switches — environment, restart to change

Every variable is optional; the defaults are what a single-user local install
wants. Needing a restart is a feature here — a kill switch you can flip with a
web request is a worse kill switch.

| Variable | Default | What it does |
|---|---|---|
| `SCHEDULER_ENABLED` | `true` | Master kill switch. Set `false` on every non-production instance. |
| `SCHEDULE_DRY_RUN` | `false` | Run the full pipeline with the platform calls stubbed. |
| `SCHEDULE_INTERVAL_MS` | `30000` | Worker cadence. |
| `SCHEDULE_GRACE_MINUTES` | `60` | Default grace window before a due job is retired as `missed`. |
| `SCHEDULE_TIMEZONE` | host zone | Fallback display zone before one is chosen in the UI. |
| `SCHEDULE_MEDIA_DIR` | `data/staged` | Where browser uploads are staged. |
| `SCHEDULE_MEDIA_CAP_BYTES` | 20 GB | Local-disk ceiling for *owned* staged media. |
| `SCHEDULE_API_TOKEN` | unset | When set, every `/api/schedule*` route requires `Authorization: Bearer …`. |
| `YOUTUBE_AUDIT_PASSED` | `false` | Allows handing a schedule to YouTube's native `status.publishAt`. |
| `LOCAL_MEDIA_ROOT` | unset | Existing var — also confines which paths a scheduled job may read. |
| `DB_PATH` | `data/automations.db` | Existing var — point it elsewhere to test against a scratch database. |

## 10. Phasing

Each phase is independently shippable and leaves the app working.

| Phase | Scope | Value at the end |
|---|---|---|
| **1 — Foundation** | Refactors (§1), schema, `POST/GET/PATCH/DELETE /api/schedule`, staging + disk cap. No worker. | Jobs can be created and inspected from the laptop; nothing fires yet. |
| **2 — Worker** | Worker, register, claim/lease, retries, grace, `finalizing`, dry-run, events. IG only. | **Scheduling actually works end-to-end via `curl`.** |
| **3 — Calendar** | `/calendar` route, week/month/day, card states, card-move DnD, desktop-file drop, timezone setting. | The Postiz-style UI. |
| **4 — Depth** | YouTube jobs, automation picker + caption keyword suggestions, published-history overlay, schedule events in the Logs page, recurring slots / queue presets. | Multi-platform, fully wired automations. |
| **5 — Optional** | Native YouTube `status.publishAt` once the compliance audit passes (`docs/youtube-shorts-integration.md`) — hand the schedule to YouTube instead of holding it. Gated behind `YOUTUBE_AUDIT_PASSED`. | Blocked on the audit, not on us. |

All five phases are implemented. Phase 5 is inert until `YOUTUBE_AUDIT_PASSED`
is set, which is Google's gate, not ours.

---

## 11. What was verified, and how

Run against a scratch database on port 3999, with `SCHEDULE_DRY_RUN=true`. The
production database and the running server were never touched.

```bash
DB_PATH=/tmp/sched/test.db CACHE_DB_PATH=/tmp/sched/cache.db \
SCHEDULE_MEDIA_DIR=/tmp/sched/staged SCHEDULE_DRY_RUN=true \
SCHEDULE_TIMEZONE=America/Chicago npx next dev -p 3999
```

Confirmed working:

- **Timezone** — `"2026-08-12T09:30"` in `America/Chicago` stored as
  `2026-08-12T14:30:00Z`. Exactly the CDT offset.
- **The R2 rule** — after scheduling from a `video_path`, the staging directory
  was empty. The file was referenced in place, never copied, never uploaded.
- **Ownership** — publishing a job dropped its `scheduled_media` row but left the
  user's own file on disk. Cancelling a job with a *browser-uploaded* file
  deleted that file.
- **Autonomous firing** — a job scheduled 5 s out was claimed and published by
  the worker's own tick, with no manual trigger.
- **Grace window** — a slot 3 h in the past with a 60 min grace was retired as
  `missed` rather than published. This is the failure mode that matters most.
- **Missing sources** — deleting a source file after scheduling showed
  `media_missing: true` on the job *before* its slot, then failed terminally
  (`error_kind: missing_file`, 1 attempt, not 3) rather than retrying.
- **Automation** — `planAutomation` correctly resolved create-vs-append; keyword
  dedup produced one flow across two posts, not two.
- **Reschedule** — moving a `missed` job revived it to `pending` with attempts
  reset and the stale error cleared. Pause/resume round-tripped.
- **Validation** — bad paths, unparseable times, missing sources, and incomplete
  automation specs all 400 at schedule time with specific messages.
- **Pages** — `/calendar`, `/compose`, `/dashboard` all render 200.

Not covered by this run, and worth knowing:

- **No real publish.** Dry run stubs the Graph API and YouTube calls, so the live
  publish path is the *existing, already-proven* `publishFromR2` — but the
  scheduler's specific use of it has not been exercised against real endpoints.
- **No browser interaction test.** Drag-and-drop, the file-drop flow, and the
  drawer were built and typecheck, and the pages render, but no automated
  browser drove them. Worth ten minutes of clicking before you trust the drag.

---

## 12. Decisions worth flagging

- **Local staging, not R2 staging.** Directly from the brief, and it's the right
  call — media in R2 for days would burn the storage cap and widen the window in
  which a presigned URL matters. Cost: the server must have the file at fire
  time, so the machine can't be asleep and a referenced path can't be moved.
  The pre-flight `stat()` and the missing-file badge make that failure loud
  instead of silent.
- **Serial worker.** Simple and predictable under Graph API rate limits. If a
  backlog ever needs draining faster, small bounded concurrency is a contained
  change to one function.
- **At-least-once delivery.** Honest framing of a crash mid-publish; the
  `container_id` check narrows it, but SQLite + an external API cannot make it
  exactly-once.
- **Epoch-ms timestamps** for `scheduled_at`, diverging from the existing text
  timestamps, because due-checks must be unambiguous.
- **No new dependencies**, consistent with how the rest of the app is built.
