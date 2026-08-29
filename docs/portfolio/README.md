# Social Cockpit portfolio media — review pack

This folder is the review gate for potential portfolio media. Nothing here has
been copied to the personal site.

Every screenshot is of a **fabricated account** — see [`demo/`](demo/). The
earlier pack was the live install with black boxes over every private region,
which reads as a broken app rather than a working one, and a calendar with three
blank cards in it argues for nothing. The demo account has nothing to hide, so
the screenshots show the software actually being used: a full week in the
scheduler, seven live automation flows, a populated analytics dashboard.

No account data, follower count, caption, or DM in this folder is real. The
demo instance cannot reach Meta — see the safety table in
[`demo/README.md`](demo/README.md).

The icon exports reproduce the product's own radar scope; they do not introduce
a replacement brand identity.

## Candidates

| Asset | Role | Source / provenance | Privacy treatment | Status | Draft alt text |
| --- | --- | --- | --- | --- | --- |
| [`screenshots/01-dashboard.png`](screenshots/01-dashboard.png) | Hero analytics still | Demo instance at `/dashboard` | Fabricated account; nothing to redact | `candidate` | "Social Cockpit's instrument-panel dashboard: a rising follower line, per-post video views, a best-time-to-post heatmap and posting frequency." |
| [`screenshots/02-calendar.png`](screenshots/02-calendar.png) | Scheduler still | Demo instance at `/calendar`, week view | Fabricated account; nothing to redact | `candidate` | "A week in Social Cockpit's scheduler, with Instagram Reels and YouTube Shorts published and queued across seven days." |
| [`screenshots/03-automations.png`](screenshots/03-automations.png) | Automation-builder still | Demo instance at `/automations`, first flow opened | Fabricated account; nothing to redact | `candidate` | "Social Cockpit's comment-to-DM builder: trigger keyword, the posts it applies to, the public replies and the DM that gets sent." |
| [`screenshots/04-posts.png`](screenshots/04-posts.png) | Post-analytics still | Demo instance at `/posts`, table view | Fabricated account; nothing to redact | `candidate` | "Social Cockpit's post table ranking 42 Reels by engagement, likes, comments, reach and views." |
| [`identity/social-cockpit-radar.svg`](identity/social-cockpit-radar.svg) | Icon logo | Export of [`RadarScope.tsx`](../../src/components/dashboard/cockpit/RadarScope.tsx), posed mid-rotation | No account data | `candidate` | "Social Cockpit radar icon with an amber scan sweep and contact blip." |
| [`identity/social-cockpit-radar-512.png`](identity/social-cockpit-radar-512.png) | Raster icon logo | 512px export of the SVG above | No account data | `candidate` | "Square Social Cockpit radar icon on charcoal." |
| [`identity/social-cockpit-lockup.svg`](identity/social-cockpit-lockup.svg) | Identity lockup | The radar beside the header's `SOCIAL·COCKPIT` treatment, glyphs converted to outlines | No account data | `candidate` | "Social Cockpit radar mark beside the Social Cockpit wordmark." |

## Identity notes

The radar mark is a still of an animation that never stops. Parked at twelve
o'clock it read as a stopped clock hand, so it is now posed 38° into its
rotation, with the leading edge just past the contact blip — the moment a radar
picture is actually about. Nothing about the component changed; this is a
different frame of the same sweep.

The lockup's wordmark is Barlow Semi Condensed Bold at 0.3em with `COCKPIT` in
amber, matching `.ck-sig` in `globals.css`. It is stored as outlines rather than
`<text>`: the previous version named fonts it could not guarantee and overran
its own viewBox in any renderer that did not have Arial Narrow. Regenerate with:

```
pip install fonttools brotli
python3 docs/portfolio/make_lockup.py
```

## Regenerating the screenshots

```
docs/portfolio/demo/run.sh
```

Read [`demo/README.md`](demo/README.md) before running it. In short: the app runs
from a detached worktree on port 3100 against scratch databases, with the
Instagram client repointed at a local mock, so the live install on 3000 is never
opened.

## Removed on review

- `recordings/01-dashboard-calendar.mp4` and `posters/01-dashboard-calendar.jpg`
  — a redacted dashboard-to-calendar navigation. Superseded by the stills above.
  A replacement recording would be worth having; the harness already drives the
  browser, so it is a screencast away.
- The previous `02-calendar.png` and `03-automations.png`, which were the live
  account with its content masked out.

## Approval gate

These contain no personal data, so the earlier hold on identifying a real person
no longer applies. Review each at full size, then copy web-sized derivatives to
the personal site.
