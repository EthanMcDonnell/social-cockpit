# Reposting

Run your best videos again, as trial reels, on a schedule — without ever
recycling something that was only true the week you made it.

Reposting sits on top of [slug pools](slug-scheduling.md) and the
[scheduler](scheduling.md). It adds three things: an archive so old videos stay
publishable, an opt-in so only evergreen content is ever considered, and a
feedback loop so a repost that flops is not tried again.

---

## The short version

1. **Enable reposting on a slug.** Off by default. Do this only for evergreen
   content — never for updates, news, or anything dated.
2. **Make one slug a repost pool.** Slots booked against it draw from the
   archive rather than a list of files.
3. **Set a cadence** in Settings → Publishing → Reposting, or book slots by hand.

Everything the app publishes from that point is archived automatically. A video
becomes repostable once it has cleared **20,000 views** (configurable), and is
retired if a repost of it lands under **1,000** (configurable).

---

## The archive

Ordinary pools never copy your files — `slug_videos.path` points at your own
library, in place. That is right for cross-posting a library over a few weeks,
and wrong for reposting, which asks to publish something from eight months ago,
by which time the original has plausibly been renamed, moved to an external
drive, or deleted.

So every video this app publishes is copied into `data/archive/` (set
`ARCHIVE_DIR` to move it, `ARCHIVE_CAP_BYTES` to bound it). Archived copies are
identified by the SHA-256 of their content, not their path, so publishing the
same clip twice from two directories is one archived video with one repost
history — it cannot get two turns in the rotation by being copied around.

Two useful side effects:

- **A pool candidate now outlives its original.** Moving the source file no
  longer silently drops it out of every pool.
- **Videos dropped onto the calendar can join a pool.** Before the archive, a
  browser upload lived in `data/staged` and was deleted the moment its job
  finished, so it could not back a pool candidate. It is now enrolled against
  its archived copy instead.

> **Going forward only.** Nothing is downloaded from Instagram, and your
> existing library is not backfilled. The archive fills as you publish.

---

## Two states that are not the same thing

The single most important distinction in this feature. A video can be out of the
rotation for two completely different reasons, and they are stored separately so
they can never be reported as one ambiguous "disabled".

| | Where it lives | Who sets it | Scope | What it means |
| --- | --- | --- | --- | --- |
| **Not enabled** *(default)* | `slugs.repost_eligible` | you | the whole slug | You have not opted this content in. Says nothing about quality. |
| **Enabled** | `slugs.repost_eligible` | you | the whole slug | This content is evergreen and may run again. |
| **Retired** | `repost_blocks` | the app, from measured views | one video | A repost of it underperformed. |

Turning a slug off never writes a block. A block never changes a slug's flag.
And a block always carries **the view count and date that caused it**, which is
what makes it unmistakable in the UI — an un-enabled slug by definition has no
such number to show.

### Keeping time-dependent content out

This is what the opt-in is for. A slug like `#weekly-update` is simply never
enabled, so nothing published under it can ever be reposted. There is no keyword
matching and no heuristic to get wrong: if you did not turn it on, it does not
run.

Set it on the **Slugs** page, or over MCP when scheduling:

```jsonc
{ "slug": "gym-tips", "repost_eligible": true, "scheduled_at": "..." }
```

---

## What gets picked

Every candidate must clear all of these:

- published at least once on this platform
- its origin slug has reposting **enabled**
- its original view count is at least `min_views` (default 20,000)
- it is not retired
- its archived file is still on disk

Qualifying videos then split into two tiers, and **tier 1 is completely drained
before tier 2 is looked at**:

| Tier | Contents | Ranked by | Extra conditions |
| --- | --- | --- | --- |
| **1** | never reposted | most views | — |
| **2** | reposted before | longest since last outing | rested `min_gap_days` (default 30) **and** its last repost cleared `block_below_views` |

Without that ordering, one 400k video would take every slot forever while a
shelf of 40k videos that have never had a second run sat behind it.

The second tier-2 condition re-checks the previous repost's own figure rather
than relying on the absence of a block. An event recorded before you raised the
threshold never produced one, and would otherwise walk back into the rotation
the moment its rest period elapsed.

---

## Trial reels, promoted by hand

Every repost publishes as a **trial reel** with
`graduation_strategy: "MANUAL"`. This is fixed. There is no setting, and the
settings API rejects an attempt to change it.

Two reasons. A trial reel shows to non-followers first, which is exactly what
you want for something your followers have already seen. And automatic
graduation would push recycled material back into your main feed on Instagram's
judgement rather than yours — you promote it, or it stays where it is.

YouTube has no equivalent, so booking a repost pool for `yt` is rejected when
you book it, not at 3am when it fires.

---

## The feedback loop

When a repost publishes, a row goes into `repost_events` with a deadline
`evaluate_after_hours` (default 48) in the future. On the scheduler's existing
housekeeping pass, due rows are judged:

- **under `block_below_views`** (default 1,000) → the video is retired, with the
  figure and date recorded. It never reposts again unless you unblock it.
- **at or above it** → recorded as fine; the video becomes tier-2 eligible once
  it has rested.
- **no insights yet** → deferred, never judged. Reading "0 views" off a cache
  miss would retire a perfectly good video.

Views come from `cache.db`, which the cache worker already syncs for the
dashboard, so **evaluation makes no API calls of its own** and cannot be the
thing that exhausts a rate limit.

Everything lands in the scheduler's event log, visible on the **Logs** page:
`repost_resolved`, `repost_recorded`, `repost_evaluated`, `repost_blocked`,
`repost_autobooked`, `repost_unblocked`.

### Unblocking

From the Slugs page, on the retired video's row. It returns to **tier 2**, not
tier 1 — it has been reposted before, so it still waits out the rest period.
Unblocking says "don't count that result against it", not "pretend it never
ran".

---

## Cadence and auto-booking

Repost times are stored per weekday, and default to slightly different times
each day:

```
Sun 13:15   Mon 12:10   Tue 13:35   Wed 12:50
Thu 14:05   Fri 12:25   Sat 11:40
```

The staggering is deliberate: a feed that posts at exactly 12:30 every single
day reads as automation to anyone paying attention, and a repost should not
announce itself as one. Switch a day off to skip it entirely.

With auto-booking on (the default), the scheduler keeps the next
`horizon_days` (default 14) topped up, subject to `max_per_week` (default 3)
*and* the account-wide `max_posts_per_day`. It books through the same
`createJobWithinScheduledCap` path the API uses, so it can never overbook a day.

Auto-booked slots are ordinary calendar jobs — move them, pause them, delete
them. **Deleting one keeps it deleted**: every booked instant is recorded in
`repost_autobook`, and that row outlives the job precisely so the next pass does
not helpfully put it back.

Auto-booking does nothing at all until a slug is set to `repost` mode, which is
why it can default to on safely.

---

## Settings

Settings → Publishing → Reposting, or `PUT /api/schedule/settings` with a
`repost` object.

| Key | Default | What it does |
| --- | --- | --- |
| `min_views` | 20000 | Views an original needs before it is worth running again |
| `block_below_views` | 1000 | A repost under this retires its video |
| `min_gap_days` | 30 | Rest period before a second outing |
| `evaluate_after_hours` | 48 | How long before a repost's views are judged |
| `times_by_weekday` | staggered | Seven arrays, Sunday first; empty means skip |
| `max_per_week` | 3 | Ceiling on auto-booked reposts |
| `autobook` | on | Whether the app books slots itself |
| `horizon_days` | 14 | How far ahead it books |

All stored in `app_settings`, so changes take effect without restarting.

---

## API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/reposts?platform=ig` | The pool — every archived video with its verdict, plus the ranked order |
| `DELETE /api/reposts/blocks/:archiveId` | Lift a block |
| `PATCH /api/slugs/:slug` | `{ "repost_eligible": true }`, `{ "mode": "repost" }` |
| `GET/PUT /api/schedule/settings` | Read and write the `repost` policy |

`GET /api/reposts` deliberately returns ineligible videos too, each with a
reason. "Nothing is eligible" is the state that most needs explaining, and the
explanation is per-video.

---

## Schema

All additive — new tables and new nullable columns, applied through the ordinary
startup migration list in `src/lib/db/index.ts`.

```
archived_videos   the preserved copies, keyed by content hash
repost_events     one row per repost, with its evaluation deadline
repost_blocks     videos retired on measured performance
repost_autobook   instants auto-booking has claimed
slugs.repost_eligible   the opt-in (defaults to 0)
slugs.mode              'pool' (default) or 'repost'
slug_videos.archive_id  links a candidate to its preserved copy
```

`repost_eligible` defaulting to `0` means existing slugs stay out of reposting
until you explicitly enable them.
