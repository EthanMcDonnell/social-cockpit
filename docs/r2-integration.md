# Cloudflare R2 integration — publishing local media to Instagram

A **media-hosting layer** on Cloudflare R2 so the Compose Studio can publish
**local files** (drag a reel or photo) to Instagram, not just pasted URLs.

> Drag a file → the browser uploads it straight to a **private** R2 bucket → the
> server hands Instagram a short-lived signed URL → Instagram fetches + publishes
> → the object is deleted.

## Why this is required (not just a convenience)

This app talks to the **Instagram API with Instagram Login** (`graph.instagram.com`,
see `src/lib/instagram/client.ts`). That API has **no local/resumable upload** —
Meta's servers cURL a **publicly reachable HTTPS URL** for *every* media type. The
`upload_type=resumable` / `rupload.facebook.com` flow is **Facebook-Login-for-Business
only**, so the existing resumable path can't work on our auth model.

- Docs: [Publish Content — Meta](https://developers.facebook.com/docs/instagram-platform/content-publishing/)
- Docs: [Resumable Uploads — Meta (Facebook-Login only)](https://developers.facebook.com/docs/instagram-platform/content-publishing/resumable-uploads/)

**Consequence:** R2 becomes the *required* hosting layer for all local media —
Reels, video Stories, images, carousels, and reel covers. The current resumable
code is dead for this API and gets retired (see below).

## Flow — private bucket, two capability URLs

```
Browser → GET presigned PUT from Next   (TTL ~5m; locked to key + content-type + max-size)
Browser → PUT file DIRECTLY to R2        (Next never sees the bytes)
Browser → POST { key, payload } to Next
Next    → presigned GET (TTL ~2h) → inject as video_url / image_url / cover_url
Next    → publishMedia(...)               [existing flow in publish.ts, untouched]
Next    → deleteObject(key)               [finally; lifecycle rule as backstop]
Instagram cURLs the signed GET URL → publishes
```

"Next" = this Next.js server (the `src/app/api/**` routes on the laptop). It's the
only place the R2 secret and Instagram token live; the heavy media bytes never pass
through it. The **browser** uploads directly to R2; Instagram fetches directly from R2.

## Security posture

Running locally, single user — so we keep the bucket **fully private** and never
enable public access. Everything is a single-object, read-only, self-expiring URL.

- **Private bucket** — no public / `r2.dev` access enabled.
- **Least-privilege token** — R2 API token scoped to *Object Read & Write on this one
  bucket*. If it leaks, blast radius is one bucket.
- **Unguessable keys** — `publish/<uuidv4>.<ext>`. With a private bucket + no listing,
  objects can't be enumerated or guessed.
- **Tight presigned PUT** — bound to the exact key, `Content-Type`, and a max
  `Content-Length`, ~5-min TTL. A leaked upload URL can't be reused to dump junk.
- **Presigned GET** — ~2-hour TTL (enough for Meta to fetch a large video), then it
  expires on its own, so a failed delete is never a permanent leak.
- **CORS** on the bucket limited to `http://localhost:3000` (not `*`).
- **Secrets hygiene** — keys only in `.env` (already gitignored); never logged, never
  sent to the client. Only presigned URLs cross the wire.

## Storage cap — never exceed the 10 GB free tier

**Cloudflare has no native write-blocking cap.** *"You can't limit spending in R2."*
Budget Alerts (added early 2026) are **informational only** — they email at a
threshold but do **not** pause/block. Over 10 GB, R2 doesn't refuse writes; it bills
**$0.015/GB-month** overage (egress stays free).

- [R2 Pricing](https://developers.cloudflare.com/r2/pricing/)
- [Cloudflare Community — "Limit r2 storage spending"](https://community.cloudflare.com/t/limit-r2-storage-spending/691948)

So the hard cap is enforced **by us, in the write path** — which works because this
app is the *only* thing that ever writes to the bucket. Chosen approach:
**local gate + backstops.**

**1. Local gate (authoritative).** The Next server issuing the presigned PUT is a
perfect chokepoint. Usage is tracked in SQLite (`better-sqlite3`, as elsewhere):

- Conservative red-line: **8 GiB** (`R2_CAP_BYTES`), headroom under 10.
- The presigned PUT is bound to a **max `Content-Length`**, so worst-case size is
  known *before* the URL is issued.
- Reserve-on-sign → reconcile-to-actual → release-on-delete:
  `reserved = SUM(live objects)`; if `reserved + maxSize > CAP` → **refuse (429),
  issue no URL**. Otherwise write a `reserved` row, issue the URL, correct to the real
  size after upload, and drop the row on delete.
- Because the flow is upload → publish → **delete**, steady-state storage is ~0; the
  gate mainly guards against orphans from a crash.

**2. Cloud-side backstops (work even if the laptop is off).**

- **Lifecycle rule** — auto-delete `publish/` objects after 1 day. Caps accumulation
  independent of the app.
- **Cron Worker** — a small scheduled Cloudflare Worker (every ~5 min) sums bucket usage
  via its **R2 binding** (`env.MEDIA.list()`, no S3 creds) and purges the oldest objects
  if over the red-line. Skips objects < 1h old so it never nukes an in-flight upload.
  Runs on Cloudflare's cron whether or not the laptop is on.
- **Budget Alert** — ~$0.01 tripwire email as the earliest warning something slipped past.

**3. Reconciliation.** On app startup (and periodically), list the bucket (cheap Class B
ops) and correct the SQLite counter against reality, catching drift from any failed delete.

> A *real-time* cloud block would require routing all uploads through a Worker holding
> the sole write credential — but Workers have a ~100 MB request-body limit, so 1 GB
> reels would need client-side multipart splitting. Too much for a single-user local
> tool; layers 1+2 give an effective hard cap without it.

## Code surface

**New**
- `src/lib/storage/r2.ts` — presign PUT, presign GET, delete (S3 client pointed at the
  R2 endpoint).
- `src/lib/storage/usage.ts` — SQLite accounting gate (reserve / reconcile / release).
- `src/app/api/publish/r2-sign/route.ts` — issues a presigned PUT after the gate check.
- `worker/` — the cron usage Worker (deployed via `wrangler`, outside the Next app).

**Extend**
- `src/app/api/publish/route.ts` — accept an R2 `key`; presign a GET and inject it as
  `video_url` / `image_url` / `cover_url` (or carousel child) before `publishMedia`.
- `src/lib/compose/usePublish.ts` + `src/components/compose/SourcePanel.tsx` +
  `src/lib/compose/draft.ts` — add the sign → PUT → publish branch for local files
  (parallel to today's pasted-URL path).

**Remove (dead on Instagram Login)**
- `src/app/api/publish/upload/route.ts`
- `publishLocalMedia`, `uploadResumableBinary` in `src/lib/instagram/endpoints/publish.ts`

**Dependency**
- `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` (R2 is S3-compatible).

## Env vars (`.env` + `.env.example`)

```
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=social-cockpit-media
R2_CAP_BYTES=8589934592     # 8 GiB red-line
```

There is deliberately **no** `R2_PUBLIC_BASE_URL` — the bucket is private; the server
generates a presigned GET at publish time instead of a public URL.

## Infrastructure as code (Terraform)

The durable Cloudflare config is managed with **Terraform** (cloudflare provider v5),
so the whole setup is one `terraform apply` and reproducible. Split by tool:

- **Terraform** → account infra (bucket, CORS, lifecycle, scoped token).
- **Wrangler** → the Phase-3 cron Worker (bundles code + cron trigger far better than
  Terraform's `cloudflare_workers_script`).

### Resources

| Resource | Purpose |
| --- | --- |
| `cloudflare_r2_bucket` | The private bucket (`social-cockpit-media`). |
| `cloudflare_r2_bucket_cors` | `PUT` allowed from `http://localhost:3000` only. |
| `cloudflare_r2_bucket_lifecycle` | Expire `publish/` objects after 1 day. |
| `cloudflare_api_token` | Scoped R2 token — Object R/W on this bucket only. |

The S3 credentials are **derived** from the token, not separate resources:
`access_key_id` = the token id; `secret_access_key` = **SHA-256 of the token value**
(Terraform computes both and exposes them as `sensitive` outputs). See
[R2 auth docs](https://developers.cloudflare.com/r2/api/tokens/).

### Layout

```
infra/
  main.tf          # provider, r2 bucket, cors, lifecycle, api token
  variables.tf     # account_id, cap, allowed_origin
  outputs.tf       # access_key_id, secret_access_key (sensitive), endpoint
  terraform.tfvars # gitignored — account id
  .gitignore       # *.tfstate*, .terraform/, terraform.tfvars
```

`terraform apply` outputs feed straight into `.env` (`R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID`, `R2_BUCKET`).

### Caveats

- **Token secret lands in Terraform state.** State holds the R2 secret access key —
  keep state **local and gitignored**, mark outputs `sensitive`. Known sharp edge
  ([provider issue #2713](https://github.com/cloudflare/terraform-provider-cloudflare/issues/2713)).
- **Budget Alerts have no Terraform resource** — the ~$0.01 tripwire stays a one-time
  dashboard click (see step 2 below).

### Not covered by Terraform (manual, one-time)

1. **Budget Alert** (~$0.01) — dashboard → Billing → Budget Alerts, for the earliest
   overage tripwire.
2. Confirm the bucket has **no public access / `r2.dev`** enabled (it's private by
   default; just don't turn it on).

## Phasing

0. **Phase 0** — provision Cloudflare via Terraform (bucket, CORS, lifecycle, scoped
   token); set the budget alert manually; populate `.env` from the outputs.
1. **Phase 1** — `r2.ts` + usage gate + `r2-sign` route + wire the Reel tab to publish
   one local video end-to-end (proves the whole loop).
2. **Phase 2** — images, carousels, reel covers; remove the dead resumable code.
3. **Phase 3** — cron usage Worker (Wrangler) + startup reconciliation. (Lifecycle rule
   and budget alert already in place from Phase 0.)

---

**Note:** `CLAUDE.md` flags this repo as serving live traffic — building this will edit
source only; no build/restart/deploy happens until handed off.
