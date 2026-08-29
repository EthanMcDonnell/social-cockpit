# Social Cockpit portfolio media — review pack

This folder is the review gate for potential portfolio media. Nothing here has been copied to the personal site.

The icon exports reproduce the product’s existing radar scope; they do not introduce a replacement brand identity. Screens and recordings were captured from the already-running local application in a **read-only** browser session: no posts, schedules, settings, uploads, messages, automations, or credentials were changed.

## Candidates

| Asset | Role | Source / provenance | Privacy treatment | Status | Draft alt text |
| --- | --- | --- | --- | --- | --- |
| [`../../screenshots/dashboard.png`](../../screenshots/dashboard.png) | Hero dashboard still | Existing tracked README screenshot | Existing project documentation asset; re-review before public use | `candidate` | “Social Cockpit’s dark instrument-panel dashboard with follower, video-view, posting-time, and posting-frequency panels.” |
| [`identity/social-cockpit-radar.svg`](identity/social-cockpit-radar.svg) | Proper icon logo | Faithful documentation export of [`RadarScope.tsx`](../../src/components/dashboard/cockpit/RadarScope.tsx) | No account data | `candidate` | “Social Cockpit radar icon with an amber scan sweep and contact blip.” |
| [`identity/social-cockpit-radar-512.png`](identity/social-cockpit-radar-512.png) | Raster icon logo | 512px export of the SVG above | No account data | `candidate` | “Square Social Cockpit radar icon on charcoal.” |
| [`identity/social-cockpit-lockup.svg`](identity/social-cockpit-lockup.svg) | Identity lockup | Faithful export of the real header’s radar and `SOCIAL·COCKPIT` treatment | No account data | `candidate` | “Social Cockpit radar mark beside the Social Cockpit wordmark.” |
| [`screenshots/02-calendar.png`](screenshots/02-calendar.png) | Scheduler capability still | Read-only navigation from `/dashboard` to `/calendar` | All scheduled-post title/content regions are masked with opaque charcoal boxes | `candidate` | “Social Cockpit’s week scheduler with private scheduled-post details redacted.” |
| [`screenshots/03-automations.png`](screenshots/03-automations.png) | Automation capability still | Read-only visit to `/automations` | Flow thumbnails and user-authored source text are masked; generic capability labels and controls remain | `candidate` | “Social Cockpit’s Comment to DM automation flow list with private flow details redacted.” |
| [`recordings/01-dashboard-calendar.mp4`](recordings/01-dashboard-calendar.mp4) | Product interaction proof | A real browser session, captured through Chrome DevTools Protocol: dashboard → header calendar link → calendar | Calendar event cards are masked after navigation; no user actions that mutate data occurred | `candidate` | “A short read-only navigation from the analytics dashboard to the scheduling calendar.” |
| [`posters/01-dashboard-calendar.jpg`](posters/01-dashboard-calendar.jpg) | Recording poster | Still sampled from the redacted recording | Same three event-card redactions as the recording | `candidate` | “Redacted Social Cockpit weekly calendar used as the dashboard-to-calendar recording poster.” |

## Capture notes

- Capture date: 2026-08-29.
- Browser viewport: 1600 × 1100.
- The recording is a 6.25-second H.264 MP4 assembled from genuine periodic captures of the same browser tab during real, read-only navigation. It is not a simulated dashboard or a replayed terminal transcript.
- Redaction is intentionally additive: it only covers existing private text/image areas and does not replace values with made-up application data.
- Review each candidate at full size before changing its status to `approved for personal site`.

## Out of scope in this repository

Do not move these assets into the portfolio yet. A later, explicit approval should copy only approved web-sized derivatives; it should not remove these source documentation assets.
