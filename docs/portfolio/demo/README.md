# Portfolio demo harness

Brings up an isolated Social Cockpit, fills it with a fully fabricated creative
studio account, and writes four screenshot candidates to a fresh scratch
directory.

```sh
docs/portfolio/demo/run.sh                    # prints a fresh scratch location
KEEP=1 docs/portfolio/demo/run.sh              # leave that isolated demo open
```

## Why it exists

The first portfolio screenshots were taken from the live install with private
regions painted over. A fabricated account with nothing to hide demonstrates the
software actually being used: a current analytics dashboard, an upcoming work
week, campaign-specific automations, and a varied media grid.

**Lumen Field / Demo is fictional.** Its profile, metrics, captions, destinations,
flows, and locally served visual covers exist only for this review pack. The
covers are original editorial illustrations; their provenance is in
[`assets/ATTRIBUTION.md`](assets/ATTRIBUTION.md).

## What it does not touch

The production app serves port 3000 from `.next` and `data/`. This harness never
opens, targets, or writes them:

| Concern | How it is prevented |
| --- | --- |
| Production build | Every run creates a new detached worktree; only that worktree runs `next dev`, which writes `.next-dev` there |
| Production database | Every `*_DB_PATH` points into the run's unique scratch directory; `seed.mjs` refuses the repository `data/` directory |
| Production port | The demo uses 3100 and fails if it, the mock port 3199, or the Chrome DevTools port 9333 is occupied. It never probes port 3000 |
| Real social APIs | The worktree-only Graph base URLs are rewritten to `mock-graph.mjs`; the process starts under `env -i` with a fake token |
| Active checkout | The source tree is neither built nor changed. A binary-safe, four-file allowlist can overlay the current Calendar, Compose, Slugs, and global-style UI changes into the detached worktree only |

The scheduler stays **on** so Calendar does not carry a disabled-worker banner.
The dataset seeds historical work as published, puts all open work in the next
full planning weeks, and puts the local read-only Graph mock in front of every
social request. No capture can cause a pending demo job to become due.

## The pieces

| File | Job |
| --- | --- |
| `dataset.mjs` | Fictional profile, 42 campaign Reels and their insights, 60 daily source values, a historical/future queue, and seven flows |
| `assets/campaign/` | Original locally served campaign covers; no remote CDN dependency |
| `make_campaign_assets.mjs` | Rebuilds the original SVG campaign-cover set |
| `mock-graph.mjs` | Serves the dataset and fixed cover manifest as the local, read-only Graph API |
| `seed.mjs` | Writes the schedule and flows into the scratch database |
| `shoot.mjs` | Drives headless Chrome over CDP and writes scratch candidate images |
| `run.sh` | Worktree, allowlisted UI overlay, mock, app, migration, seed, warm-up, capture, and provenance manifest |

The fixture is anchored to capture time rather than a historical date. The
calendar opens on a real current week and the dashboard respects the product's
selected 7/30/90-day window (with the normal two-day insight delay); a frozen
dataset would otherwise look empty or stale.

## Capture review workflow

`run.sh` writes candidate PNGs and `capture-manifest.txt` beneath a unique scratch
path. It does **not** overwrite `../screenshots/`. Before promotion, inspect all
four at native size and check:

1. no skeletons, error overlays, devtools, missing cover images, or stale title
   cards;
2. only loopback app/mock/CDP endpoints appeared in the logs;
3. Dashboard uses the current hourly views-and-engagement Best Time instrument,
   not the historical weekday heatmap;
4. Calendar shows a populated current week, Automations opens a campaign-relevant
   flow, and Posts uses the existing grid control with varied local cover art;
5. the base revision, overlay checksum, and dimensions in the manifest match the
   reviewed run.

Only then replace all four review candidates together.
