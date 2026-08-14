# social-cockpit MCP server

Exposes the scheduling API (`docs/scheduling.md`) to MCP clients, plus one
read-only analytics tool for grounding scheduling decisions in what actually
performed.

Built on **`@modelcontextprotocol/server` v2** — the stable v2 line implementing
the [2026-07-28 spec](https://modelcontextprotocol.io/specification/2026-07-28).

## Why it talks HTTP, not SQLite

The server calls `/api/schedule*` over HTTP rather than opening
`data/automations.db`. The scheduler's worker owns that database and holds a WAL
lock; a second writer is exactly the failure mode `docs/scheduling.md` §8 warns
against. Going through the routes also means validation, timezone handling, and
event logging keep happening in one place — this package stays a thin client with
no business logic of its own to drift.

## Install and build

```bash
cd mcp
npm install
npm run build      # -> dist/index.js
```

Its `package.json` is deliberately separate from the app's. The app runs in
production; adding dependencies to the root would mean an `npm install` against
the tree the live server is running from. Nothing here touches that.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `COCKPIT_URL` | `http://localhost:3000` | Where the cockpit is listening. |
| `SCHEDULE_API_TOKEN` | unset | Sent as `Authorization: Bearer …`. Only needed if the cockpit sets it. |

The server holds no credentials of its own. Instagram tokens, R2 keys, and the
database all stay on the cockpit side.

## Wiring it into Claude Code

```bash
claude mcp add --scope project --transport stdio social-cockpit \
  -- node /Users/you/Development/social-cockpit/mcp/dist/index.js
```

Or commit a `.mcp.json` in the consuming project:

```json
{
  "mcpServers": {
    "social-cockpit": {
      "command": "node",
      "args": ["/Users/you/Development/social-cockpit/mcp/dist/index.js"]
    }
  }
}
```

Tools then appear as `mcp__social-cockpit__<tool>`.

## Tools

| Tool | What it does |
|---|---|
| `suggest_slots` | Next free slots on the real calendar, clear of every published and scheduled post by a minimum gap. Read-only. |
| `schedule_post` | Book one video/image for a future slot. |
| `schedule_posts` | Book a batch in one call. Entries are independent; a failure doesn't roll back earlier successes. |
| `list_scheduled_posts` | What's booked, filtered by window, status, platform. |
| `get_scheduled_post` | One job in full, with its event history — why it failed. |
| `update_scheduled_post` | Reschedule, pause, resume, edit caption or grace window. |
| `cancel_scheduled_post` | Cancel and clean up staged media. Destructive. |
| `run_scheduled_post_now` | Publish immediately, ignoring the clock. Destructive; blocks for minutes. |
| `list_top_posts` | Published posts ranked by views/reach/likes/etc., with account totals. Read-only. |

Resource `schedule://settings` carries the timezone and whether the worker is
enabled or in dry run.

### Design notes

- **The calendar decides when, not the caller.** `suggest_slots` reads published
  history *and* booked jobs, then returns times clear of both by a minimum gap —
  on **both sides**, since a hole two days after the last post can still sit an
  hour before the next booked one. Callers should ask for slots rather than
  compute them; only the cockpit knows what is actually there.
- **Media is referenced, never uploaded at schedule time.** `video_path` is an
  absolute path on the *cockpit machine's* disk. This preserves the scheduler's
  core rule: nothing reaches R2 until the publish moment.
- **Times are wall-clock in the cockpit's zone.** `"2026-08-16T09:30"` means 9:30
  where the cockpit thinks you are; add an offset to pin it. Every tool result
  restates the zone, because a scheduler that is silently wrong about the
  timezone is worse than no scheduler.
- **`trial_reel` defaults to true** for Instagram video posts, matching how this
  account publishes hooks. Pass `false` for a normal reel.
- **The worker's state is never hidden.** If `SCHEDULER_ENABLED=false` or
  `SCHEDULE_DRY_RUN=true`, every result says so — otherwise "scheduled" would
  read as a promise the instance won't keep.
- **Errors come back as tool errors, not protocol errors**, carrying the
  cockpit's own message ("File not found: …"). These are things the model can
  correct on a retry, so they belong in the result.

## Testing

The server is a client, so it can be driven directly over stdio:

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"c","version":"1"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  | node dist/index.js
```

To exercise the write path without touching production, point both the cockpit
and this server at a scratch instance:

```bash
# in the cockpit repo, per docs/scheduling.md §8
DB_PATH=/tmp/sched/test.db CACHE_DB_PATH=/tmp/sched/cache.db \
SCHEDULE_MEDIA_DIR=/tmp/sched/staged SCHEDULE_DRY_RUN=true \
npx next dev -p 3999

# then
COCKPIT_URL=http://localhost:3999 node dist/index.js
```
