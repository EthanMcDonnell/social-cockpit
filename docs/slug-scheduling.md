# Slug scheduling

Book a calendar slot against a **slug** instead of a file, and let the video be
chosen when the slot arrives — the highest-viewed clip in the pool, the one
that has waited longest, whatever you pick.

The idea already existed here in one half. An `automation_key` is a slug: the
first post published under it creates the flow, every later post joins it. This
adds the other half — the same string also names a **pool of videos**, and the
scheduler can draw from it.

```
                          slug: "gym-tips"
                    ┌───────────┴───────────┐
        automation facet                content facet
   automation_flows.automation_key     content_slugs + slug_videos
   (comment funnel — Automations)      (video pool — Slugs)
```

Both facets are optional. A pool with no comment funnel is fine; so is a keyed
flow whose pool is empty.

Because they are one namespace, the Slugs page lists a slug that so far only
names an automation flow — as the empty pool it is, ready to fill. It is not
given a record until something is actually enrolled against it, so looking at a
keyed flow does not leave a pool behind.

---

## 1. How a pool fills up

Enrolment is incremental and never enforced. There is no "declare all your
videos up front" step, and no requirement that a video be posted somewhere
first.

| How | What happens |
|---|---|
| Publish or schedule anything with `slug` **and** a file | The file joins that slug's pool when it publishes, and where it landed is recorded. |
| Add a video on the **Slugs** page (or `POST /api/slugs/:slug/videos`) | The file joins the pool immediately, with no posting history yet. |
| Start a pool on the **Slugs** page (or `POST /api/slugs`) | An empty pool, ready to fill before anything is booked against it. |
| Publish or schedule with `slug` **and no file** | The slot is booked against the pool — this is the feature. |

Enrolment is idempotent on (slug, path): posting the same file under the same
slug three times gives one candidate with three posting records, not three
candidates. Nothing is ever copied or uploaded — a pool holds a reference to
your own library, exactly as a scheduled post does.

Two things a pool refuses:

- **Anything that isn't a video.** Every method treats a pool's members as
  interchangeable, so a photo among them would surface as a failed publish at
  3am. It fails the enrolment instead.
- **A browser upload.** A dropped file is a copy in `data/staged/` that the
  scheduler deletes once the job finishes, so enrolling it would point the pool
  at a path that stops existing. Schedule the file by path and it joins.

### Payload defaults

A slug job usually carries no caption of its own — the point is that it does not
know which video it will get. It falls back to the candidate's stored defaults,
so a video that arrives by *publishing* brings the caption or title it went out
with, and one added **by hand has none until you set it** on the Slugs page.
Without one it would post blank, which is why the pool row opens into an editor
for exactly those two fields.

### The ledger

Every enrolment writes to `slug_video_posts`: *this local file became this
`media_id` on this platform, at this time*. That link did not exist anywhere
before this feature, and everything here depends on it:

- **Ranking** — views and engagement live under the published post's id, so
  scoring a local file means knowing which post it became.
- **Eligibility** — a candidate already posted to a platform is out of that
  platform's pool.

## 2. How a video gets picked

At fire time, under the worker's lease, the pool is filtered and ranked.

**Eligibility.** A candidate is out if it has already been posted to the target
platform, if its file has gone missing from disk, or if another slot is
publishing it *right now*. The first rule is what makes a recurring slug booking
work through a library rather than posting its best performer forever; pools
drain per platform, so exhausting Instagram leaves YouTube untouched.

The third rule closes a window. The ledger row that retires a candidate is
written only once a post is live, and Instagram can spend minutes processing a
reel — so between one slot picking a video and that post existing, a second slot
on the same slug would rank the same candidate top and post it twice. Picks made
by jobs that are `publishing` or `finalizing` count as taken. A job that picked
and then *failed* never posted, so its candidate returns to the pool.

The same three filters back the counts shown on the Slugs page, the calendar
card, and the composer's slug picker — a card reading "3 left" over a slot that
then finds nothing would be worse than no count at all.

**Ranking.**

| Method | Picks |
|---|---|
| `most_views` | Most views across every platform it has been posted to. |
| `most_engagement` | Highest interactions-per-view, weighted by views so a 200-view fluke can't outrank a 50k clip. |
| `least_views` | Fewest views — give the underdog another run. |
| `oldest_unposted` | Longest wait since it was added. |
| `newest` | Most recently added. |
| `random` | Any eligible candidate. |

**Fallback.** A candidate with no metrics is never discarded for that. Scored
candidates rank among themselves first; unscored ones follow in add order. So a
brand-new slug, whose videos have never been posted anywhere, still fires on its
first slot instead of failing at 3am.

**Determinism.** Ties break on insertion order, taken from the table's rowid —
not `created_at`, which has one-second resolution and would leave a batch of
videos added together in arbitrary order.

**Where the numbers come from.** Instagram is free: `cache.db` already holds
insights for every post, with reach standing in where views were never reported.
YouTube is fetched by video id — never by recency, or a pool's older clips would
be invisible — one `videos.list` per 50 ids, memoised per video for ten minutes.
A failure degrades to "no YouTube metrics" rather than failing the publish, and
is not retried until the TTL is up. A slot is never missed because a stats call
timed out.

## 3. Which method runs

Three levels, most specific first:

```
job.selection_method  →  the slug's own override  →  Settings › Slug selection
```

Resolved when the slot fires, not when it is booked. Changing the default
therefore changes what every unspecified job already on the calendar will do.

## 4. What happens at fire time

```
claim job (lease held)
      │
      ├─ content_slug set, media empty?
      │        │
      │        ├─ resolve method, filter pool, rank, pick
      │        ├─ register the chosen file (referenced in place, never copied)
      │        ├─ merge payload: the job's own caption/title wins, the
      │        │   candidate's stored defaults fill the rest
      │        └─ write media + payload back onto the row  ─┐
      │                                                     │
      └─────────────── unchanged publish path ◄─────────────┘
```

After resolution the job is indistinguishable from one booked against a file,
so nothing downstream — upload, publish, automation attach, cleanup — needed to
learn about slugs.

Notes:

- **A retry re-picks.** The previous attempt's registered source is released
  first, so a failure caused by the chosen candidate isn't repeated.
- **A YouTube job always has a title.** Job title → candidate's stored title →
  the candidate's label or filename. YouTube refuses an untitled upload, so this
  can never resolve to empty.
- **An empty pool fails the job** with `error_kind: "no_candidate"`, and the
  reason names whether the pool was empty, exhausted for that platform, missing
  from disk, or entirely spoken for. It is not retryable: the fix is to add a
  video, not to wait.
- **The resolved payload is validated before anything is uploaded.** Every other
  route into a publish validates at booking; a slug job cannot, because there is
  no video to validate against until now. `publishFromR2` does not check, so
  this is the only chance.
- **The pool is only created once a booking is accepted**, so a request rejected
  for the typo in its own slug leaves no phantom pool behind.
- **A dry run resolves and picks, but records nothing.** Its media id is a stub,
  and recording it would retire a candidate that never posted.

## 5. API

```bash
# Book a slot against a pool — no file, no caption.
curl -X POST localhost:3000/api/schedule -H 'Content-Type: application/json' -d '{
  "scheduled_at": "2026-09-02T09:30",
  "platform": "yt",
  "slug": "gym-tips",
  "selection_method": "most_views"
}'

# Post a specific file and enrol it in the pool.
curl -X POST localhost:3000/api/schedule -H 'Content-Type: application/json' -d '{
  "scheduled_at": "2026-09-02T18:00",
  "video_path": "/Users/me/clips/gym-4.mp4",
  "caption": "Comment GYM for the plan 👇",
  "slug": "gym-tips"
}'

# The pool, scored, with the pick it would make right now.
curl localhost:3000/api/slugs/gym-tips?platform=yt

# Add a candidate without posting it.
curl -X POST localhost:3000/api/slugs/gym-tips/videos -H 'Content-Type: application/json' \
  -d '{"path":"/Users/me/clips/gym-5.mp4","label":"Gym tips 5"}'
```

`GET /api/slugs/:slug` runs the real selector rather than a description of it,
so the preview in the composer and on the Slugs page cannot drift from the
decision the worker makes.

An automation block that names no key of its own inherits the slug — the pool a
video belongs to and the flow it fires stay one string.

## 6. Schema

Additive only; no existing table is altered beyond two nullable columns.

```sql
content_slugs     (slug PK, name, selection_method, …)
slug_videos       (id PK, slug, path, label, payload, …)   -- UNIQUE(slug, path)
slug_video_posts  (video_id, platform, external_id, job_id, posted_at)
scheduled_posts   + content_slug, + selection_method
```

Deleting a pool leaves the automation flow sharing its name running — tearing
down a live comment funnel is not something a pool delete should do quietly.
