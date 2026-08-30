# Social Cockpit portfolio media — review pack

This folder is the review gate for potential portfolio media. Nothing here has
been copied to the personal site.

Every screenshot uses **Lumen Field / Demo**, a fully fabricated creative-studio
account. The account, campaign, performance figures, captions, scheduled queue,
automations, and local visual covers are invented so the product can be shown as
used without redacting a real account or implying that a person endorses it. The
demo instance cannot reach Meta—see [`demo/README.md`](demo/README.md).

The icon exports reproduce the product's own radar scope; they do not introduce
a replacement brand identity.

## Candidates

| Asset | Role | Source / provenance | Privacy treatment | Status | Draft alt text |
| --- | --- | --- | --- | --- | --- |
| [`screenshots/01-dashboard.png`](screenshots/01-dashboard.png) | Hero analytics still | Demo instance at `/dashboard` | Fabricated account; nothing to redact | `candidate` | "Social Cockpit's instrument-panel dashboard for a fictional creative studio: follower growth, reel views, an hourly views-and-engagement best-time instrument, and posting cadence." |
| [`screenshots/02-calendar.png`](screenshots/02-calendar.png) | Scheduler still | Demo instance at `/calendar`, current week view | Fabricated account; nothing to redact | `candidate` | "A current week in Social Cockpit's scheduler, with a populated fictional Instagram Reels and YouTube Shorts publishing history." |
| [`screenshots/03-automations.png`](screenshots/03-automations.png) | Automation-builder still | Demo instance at `/automations`, campaign flow opened | Fabricated account; nothing to redact | `candidate` | "Social Cockpit's comment-to-DM builder, showing a fictional campaign resource, selected campaign posts, public replies, and the direct message sent." |
| [`screenshots/04-posts.png`](screenshots/04-posts.png) | Post-analytics still | Demo instance at `/posts`, campaign media grid | Fabricated account; nothing to redact | `candidate` | "A grid of original campaign covers in Social Cockpit's post explorer, with engagement and performance indicators." |
| [`identity/social-cockpit-radar.svg`](identity/social-cockpit-radar.svg) | Icon logo | Export of [`RadarScope.tsx`](../../src/components/dashboard/cockpit/RadarScope.tsx), posed mid-rotation | No account data | `candidate` | "Social Cockpit radar icon with an amber scan sweep and contact blip." |
| [`identity/social-cockpit-radar-512.png`](identity/social-cockpit-radar-512.png) | Raster icon logo | 512px export of the SVG above | No account data | `candidate` | "Square Social Cockpit radar icon on charcoal." |
| [`identity/social-cockpit-lockup.svg`](identity/social-cockpit-lockup.svg) | Identity lockup | The radar beside the header's `SOCIAL·COCKPIT` treatment, glyphs converted to outlines | No account data | `candidate` | "Social Cockpit radar mark beside the Social Cockpit wordmark." |

The older [`../screenshots/dashboard.png`](../screenshots/dashboard.png) is a
historical product reference, not a portfolio-capture baseline. It depicts the
retired weekday/hour heatmap; the current product and `01-dashboard.png` use the
hour-by-hour views and engagement instrument.

## Identity notes

The radar mark is a still of an animation that never stops. Parked at twelve
o'clock it read as a stopped clock hand, so it is now posed 38° into its
rotation, with the leading edge just past the contact blip—the moment a radar
picture is actually about. Nothing about the component changed; this is a
different frame of the same sweep.

The lockup's wordmark is Barlow Semi Condensed Bold at 0.3em with `COCKPIT` in
amber, matching `.ck-sig` in `globals.css`. It is stored as outlines rather than
`<text>` so it does not depend on a renderer owning the right font. Regenerate
with:

```sh
pip install fonttools brotli
python3 docs/portfolio/make_lockup.py
```

## Regenerating the screenshots

```sh
docs/portfolio/demo/run.sh
```

The command prints a new scratch candidate directory and capture manifest; it
does not overwrite this folder. Review all four images at full size, then promote
the complete candidate set together. Read [`demo/README.md`](demo/README.md)
before running it.

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
