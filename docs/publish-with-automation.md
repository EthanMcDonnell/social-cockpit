# Publish + automate in one call

`POST /api/publish` can wire the post it publishes into a comment automation in
the same request. Add an `automation` block to the normal publish body. Every
automation setting travels in the API call — no follow-up request needed.

## How it works

1. The post is published exactly as before (container → poll → publish).
2. **Only once the post is actually published** (the response carries a
   `media_id`), the automation is attached. On a `202` (still processing) or a
   failure there is no `media_id` yet, so the automation is reported `skipped`
   and nothing is created.
   - Video reels can take longer than the 120s publish default to process, which
     would return a `202` and skip the automation. So **when an `automation`
     block is present and you don't pass `timeoutMs`, the publish waits up to
     5 minutes** for processing to finish, so it resolves synchronously and the
     post reliably lands in the flow. Pass an explicit `timeoutMs` to override.
3. The automation spec is validated **before** publishing, so a bad spec returns
   `400` without leaving a live, un-automated post behind.

## The `key` slug — avoiding duplicate flows

The interesting case: you post several *variations* of the same video over time
and want them all firing the **same** automation, not one flow per post.

Pass a stable `automation.key` slug. The first publish with a given key **creates**
the flow; every later publish with the **same key appends** its new `media_id` to
that existing flow's target list (deduped — re-posting the same media is a no-op).

The post-publish lookup/create/append runs inside one SQLite write transaction and
the database enforces one non-null key owner. Concurrent successful publishes with
the same key therefore converge on that owner without dropping either media ID.

- **With a key** → dedup by key. Reuse it across posts to grow one flow.
- **Without a key** → always a brand-new flow.

When appending, the existing flow's keywords / replies / config are left
untouched — a later post only adds itself to the target list, it never rewrites
the established flow. So on append calls you can send just `{ "key": "..." }`.

## `automation` fields

| Field | Required | Notes |
|-------|----------|-------|
| `key` | no | Dedup slug. Same key across posts → one shared flow. |
| `name` | on create | Flow display name. Defaults to `key` if omitted. |
| `trigger_keywords` | on create | Comment keywords (uppercased, trimmed). |
| `template_type` | no | `comment_to_dm` (default), `comment_to_reply`, `comment_to_follow_dm`. |
| `config` | on create | The flow config (`comment_replies`, `initial_message`, …). `media_ids` is injected automatically — don't set it. |
| `activate` | no | Default `true` — the flow goes live immediately. Set `false` to stage it. |

"Required on create" fields are only needed when the call ends up creating a new
flow. If the `key` matches an existing flow (append), they're ignored.

## Response

The normal publish result plus an `automation` field:

```jsonc
{
  "container_id": "1789…",
  "status_code": "PUBLISHED",
  "published": true,
  "media_id": "1798…",
  "permalink": "https://www.instagram.com/reel/…",
  "automation": {
    "action": "created",        // created | appended | noop
    "flow_id": "6f0c…",
    "automation_key": "summer-giveaway",
    "media_ids": ["1798…"]      // flow's full target list after the attach
  }
}
```

If the post didn't publish synchronously:

```jsonc
{
  "container_id": "1789…",
  "status_code": "IN_PROGRESS",
  "published": false,
  "automation": {
    "skipped": true,
    "reason": "post not yet published (no media_id) — automation not attached"
  }
}
```

## Examples

**Publish a reel and create a fresh comment→DM automation:**

```bash
curl -X POST localhost:3000/api/publish -H 'Content-Type: application/json' -d '{
  "media_type": "REELS",
  "video_url": "https://…/summer-v1.mp4",
  "caption": "Comment LINK for the guide 👇",
  "automation": {
    "key": "summer-giveaway",
    "name": "Summer giveaway",
    "trigger_keywords": ["LINK", "GUIDE"],
    "template_type": "comment_to_dm",
    "config": {
      "comment_replies": ["Sent! 📩", "Check your DMs 🔗"],
      "initial_message": "Here's the guide: https://example.com/guide"
    }
  }
}'
```

**Later — post a different cut of the same video onto the *same* automation:**

```bash
curl -X POST localhost:3000/api/publish -H 'Content-Type: application/json' -d '{
  "media_type": "REELS",
  "video_url": "https://…/summer-v2.mp4",
  "caption": "New cut — comment LINK 👇",
  "automation": { "key": "summer-giveaway" }
}'
```

The second call responds with `"action": "appended"` and the flow's `media_ids`
now lists both posts. No duplicate flow is created.
