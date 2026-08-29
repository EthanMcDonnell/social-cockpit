# Demo harness

Brings up a throwaway copy of Social Cockpit, fills it with a fabricated
account, and screenshots it.

```
docs/portfolio/demo/run.sh          # into $TMPDIR/sc-demo
KEEP=1 docs/portfolio/demo/run.sh   # ...and leave it running to poke at
```

## Why it exists

The first pass at portfolio screenshots was the live install with black boxes
painted over every private region: captions, flow names, thumbnails, the
scheduled queue. What that produces is not a redacted screenshot of a working
app, it is a screenshot of a broken one - and a calendar with three blank cards
in it says nothing about a scheduler. A fabricated account with nothing to hide
shows the same software actually being used.

## What it does not touch

The live install is serving production on port 3000 out of `.next` and `data/`.
Nothing here goes near either:

| Concern | How it is prevented |
| --- | --- |
| The production build | The app runs from a detached `git worktree`, and `next dev` writes to `.next-dev` regardless |
| The production database | Every `*_DB_PATH` points into a scratch directory; `seed.mjs` refuses to open the repo's own `data/` |
| The production port | 3100, and the run aborts if anything already holds it |
| Reaching Instagram | `BASE_URL` in `src/lib/instagram/{client,usage}.ts` is rewritten *in the worktree* to point at `mock-graph.mjs`. There is no real access token in the environment either |

The scheduler worker is deliberately left **on**: the calendar carries a standing
banner while it is off, and a screenshot of a disabled scheduler is worse than
none. It is safe because every seeded job in the past is already `published`, so
nothing is ever due, and the mock stands between it and Meta regardless.

## The pieces

| File | Job |
| --- | --- |
| `dataset.mjs` | The fabricated account: profile, 42 Reels and their insights, 60 days of follower deltas, a fortnight of scheduled posts, seven automation flows |
| `mock-graph.mjs` | Serves that as the Graph API, and draws each Reel's cover as a title card |
| `seed.mjs` | Writes the scheduled queue and the flows into the demo database |
| `shoot.mjs` | Drives headless Chrome over CDP and captures the four pages |
| `run.sh` | Worktree, mock, app, migration, seed, warm, shoot |

The dataset is anchored to **today**, not to a fixed date: the dashboard trims
its window to the last 48 hours of real time and the calendar opens on the real
current week, so a frozen dataset screenshots as a half-empty chart and a
calendar of last month.

## Known rough edge

`.gitignore` line 41 is `data/` with no leading slash, so it also matches
`src/lib/data/` — two real source modules the repo does not track, and without
which a fresh checkout does not compile. `run.sh` copies them into the worktree
and prints a note. The actual fix is to anchor the pattern as `/data/` and commit
`src/lib/data/calculations.ts` and `src/lib/data/transforms.ts`.
