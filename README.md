<div align="center">

# Social Cockpit

**A self-hosted command center for your Instagram presence: analytics, publishing, inbox, and hands-off engagement automations, all running on your own machine.**

[![Next.js](https://img.shields.io/badge/Next.js-14-000000?logo=next.js&logoColor=white)](https://nextjs.org)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-3-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![Instagram Graph API](https://img.shields.io/badge/Instagram-Graph_API_v25.0-E4405F?logo=instagram&logoColor=white)](https://developers.facebook.com/docs/instagram-platform)
[![Self-hosted](https://img.shields.io/badge/deploy-self--hosted-4C1?logo=serverless&logoColor=white)](#-quick-start)

<br />

<img src="docs/screenshots/dashboard.png" alt="Social Cockpit dashboard: follower growth, video views, best time to post, and posts per day" width="100%" />

</div>

---

## What is this?

**Social Cockpit** is a locally-run web app that puts a professional-grade dashboard on top of the Instagram Graph API. It's built for creators and social managers who want to **own their tooling and their data**: you run it yourself, it talks directly to Meta with your own credentials, and everything is stored in local SQLite files on your machine. Nothing is sent to a third-party service.

> [!IMPORTANT]
> This is a **self-managed** application. You bring your own Meta developer app and Instagram access token, and you host the app yourself (locally or on your own server).

### Platform support

| Platform | Status |
| --- | --- |
| **Instagram** (Business / Creator accounts) | ✅ Supported |
| TikTok | 🔜 On the roadmap |
| YouTube | 🔜 On the roadmap |
| X / Threads / LinkedIn | 🗓️ Under consideration |

Today, Social Cockpit targets **Instagram only**. The architecture is provider-agnostic where it can be, so additional platforms are planned.

---

## ✨ Features

**The big three:**

- **🤖 Engagement Automations:** A **comment → follow → DM** funnel: when someone comments a trigger keyword, the app replies, checks whether they follow you, and sends a direct message (with nudges), all tracked with per-flow funnel counters. Built-in send throttling and an API usage meter keep you inside Meta's rate limits.
- **📝 Compose Studio:** Drag and drop a Reel, photo, carousel, or Story straight from your computer and publish it, with a caption editor, tagging, distribution options, and a live preview before you post. (Publishing local files uploads through [Cloudflare R2](docs/r2-setup.md); see [Requirements](#-requirements).)
- **📊 Dashboard & Posts Explorer:** Follower growth and video-views charts, at-a-glance account health, and a cursor-paginated post browser with per-post insights, side-by-side comparison, and top-post ranking by any metric.

**Also included:**

- **🗓️ Scheduling Calendar:** Plan posts across Instagram and YouTube on a drag-and-drop week/month/day calendar — drop a video straight from your desktop onto a time slot, or schedule from your laptop with `curl`. Media stays on your own disk until the moment it publishes; nothing sits in cloud storage in the meantime. Comment automations attach automatically when the post goes live. See [docs/scheduling.md](docs/scheduling.md).
- **🔌 MCP Server (optional):** Drive the scheduler from Claude Code or any MCP client — ask what's on the calendar, get free slots that respect your posting policy, and book a batch of hook variants in one call. It talks to this app over HTTP rather than its database, so nothing skips the API's validation or its event log. See [mcp/README.md](mcp/README.md).
- **💬 Inbox:** Read and reply to comments in threaded view.
- **🎙️ Video Transcription (optional):** A background worker transcribes your Reels/videos locally with [`faster-whisper`](https://github.com/SYSTRAN/faster-whisper) so you can search and rank by script content.
- **⚡ Smart local caching & token management:** Media and insights are cached in local SQLite with stale-while-revalidate reads; short-lived tokens exchange for long-lived ones in the UI with automatic background refresh before expiry.

---

## 🧰 Requirements

Before you start, you'll need:

1. **Node.js 18.17+** and **npm** (this is a Next.js 14 app).
2. **An Instagram Professional account**: a **Business** or **Creator** account (personal accounts are not supported by the API).
3. **A Meta Developer account and app**: see [Setting up Instagram](docs/instagram-setup.md).
4. **A Cloudflare account** (free tier is enough): required to publish anything from **Compose Studio**, which uploads local files rather than accepting pasted URLs. See [Setting up Cloudflare R2](docs/r2-setup.md). Skip this only if you'll never use Compose Studio and instead call `/api/publish` directly with your own hosted URLs.
5. *(Optional)* **Python 3.9+**: only if you want the local video-transcription feature.

---

## 🔧 Setting up Instagram

Social Cockpit uses the **[Instagram API with Instagram Login](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login)** (Graph API `v25.0`, `graph.instagram.com`). You create your own Meta app and generate your own access token; no App Review or Meta submission is needed to run this against your own account.

**→ Full walkthrough: [docs/instagram-setup.md](docs/instagram-setup.md)** covers creating the Meta app, connecting your Instagram account, picking permission scopes, and grabbing your credentials.

> [!WARNING]
> This project is **not affiliated with, endorsed by, or sponsored by Meta or Instagram**. You are responsible for complying with the [Meta Platform Terms](https://developers.facebook.com/terms/) and Instagram's policies when using your own app and tokens.

---

## 🚀 Quick start

```bash
# 1. Clone and install
git clone <your-fork-url> social-cockpit
cd social-cockpit
npm install

# 2. Configure your environment (see below)
cp .env.example .env
#   ...then edit .env with your credentials

# 3. Run
npm run dev
```

Open **[http://localhost:3000](http://localhost:3000)** in your browser. Head to **Settings** to exchange your short-lived token and confirm your connection.

For production:

```bash
npm run build
npm start   # serves on port 3000
```

---

## ⚙️ Configuration

Configuration lives in `.env` (git-ignored). Every variable is declared in
[`src/lib/config.ts`](src/lib/config.ts), which validates them at startup: a missing
required variable, or any value that can't be parsed, stops the server at boot with the
full list rather than failing later inside a request. `.env.example` documents all of
them.

Two things are deliberately *not* environment variables:

- **Posting cadence** — preferred times, posts per day, spacing between hooks of one
  video — lives in the database and is edited while the server runs, because changing it
  shouldn't require a restart. See [docs/scheduling.md](docs/scheduling.md).
- **Send caps** — the ceiling on automated DMs per minute — are constants in
  `src/lib/automation-sender.ts`. They bound the blast radius of a bug, so no line in a
  config file can raise them.

### Required: Instagram API access

```bash
# .env
INSTAGRAM_ACCESS_TOKEN=EAA...        # your long-lived Instagram token
INSTAGRAM_ACCOUNT_ID=17841400000000  # your Instagram (app-scoped) user ID
INSTAGRAM_APP_SECRET=abc123...       # Meta App Secret: enables auto token refresh
```

### Required for Compose Studio: Cloudflare R2

Compose Studio publishes by uploading local files, so these are needed to publish anything from the UI. See [docs/r2-setup.md](docs/r2-setup.md). Skip this block only if you're driving `/api/publish` directly with your own hosted URLs instead of using Compose Studio.

```bash
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=social-cockpit-media
# R2_CAP_BYTES=8589934592              # optional; 8 GiB default cap
```

### Optional

```bash
# ── Storage (local SQLite; sensible defaults) ─────────────────────────
# DB_PATH=./data/app.db
# CACHE_DB_PATH=./data/cache.db
# TRANSCRIPTS_DB_PATH=./data/transcripts.db

# ── Token refresh ─────────────────────────────────────────────────────
# TOKEN_EXPIRES_AT=                    # ISO timestamp of current token expiry
# TOKEN_REFRESH_INTERVAL_MS=           # how often to check for refresh
# TOKEN_REFRESH_THRESHOLD_DAYS=        # refresh when this close to expiry

# ── Meta API cache ────────────────────────────────────────────────────
# CACHE_SYNC_INTERVAL_MS=1800000       # background re-sync cadence (30 min)
# CACHE_TTL_MS=1800000                 # freshness window before read-through refresh

# ── Video transcription (see below) ───────────────────────────────────
# TRANSCRIPTION_PYTHON=/abs/path/to/.venv/bin/python
# TRANSCRIPTION_MODEL=small            # whisper model; larger = slower/more accurate

# ── Scheduling (see docs/scheduling.md) ───────────────────────────────
# SCHEDULER_ENABLED=true               # master switch; set false on any non-prod instance
# SCHEDULE_DRY_RUN=false               # run the full pipeline without publishing anything
# SCHEDULE_INTERVAL_MS=30000           # how often the worker looks for due posts
# SCHEDULE_GRACE_MINUTES=60            # after downtime, how late a post may still go out
# SCHEDULE_TIMEZONE=America/Chicago    # fallback until you pick one in the calendar
# SCHEDULE_MEDIA_DIR=./data/staged     # where drag-and-dropped files wait for their slot
# SCHEDULE_MEDIA_CAP_BYTES=            # local-disk ceiling for staged media (default 20 GB)
# SCHEDULE_API_TOKEN=                  # require a bearer token on /api/schedule*
# YOUTUBE_AUDIT_PASSED=false           # post-audit: let YouTube hold the schedule itself
```

> All application data (cache, transcripts, tokens, automation state) is stored locally in the git-ignored `data/` directory. Nothing leaves your machine except direct calls to the Instagram API.

---

## 🎙️ Video transcription (optional)

A background worker transcribes your Instagram videos/reels using [`faster-whisper`](https://github.com/SYSTRAN/faster-whisper). It boots with the server, re-scans for new videos every ~30 minutes, and runs one transcription at a time. Results are cached in `data/transcripts.db` and shown in the post detail panel.

Because transcription runs in Python, set up a local virtualenv:

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

Then point the app at it and (optionally) pick a model:

```bash
# .env
TRANSCRIPTION_PYTHON=/absolute/path/to/social-cockpit/.venv/bin/python
# TRANSCRIPTION_MODEL=medium   # default is "small"
```

Restart the server, then enable the feature from the **Settings** page. Both the toggle and `TRANSCRIPTION_PYTHON` are required; if either is missing, transcription simply stays off and the rest of the app is unaffected.

---

## ☁️ Cloudflare R2: publishing from Compose Studio

Compose Studio publishes by **uploading local files**: a reel, photo, carousel, or Story straight off your computer. There's no pasted-URL field in the UI, so R2 is required to publish anything from Compose Studio (not optional).

**Why local files need R2 at all:** this app uses the Instagram API *with Instagram Login* (`graph.instagram.com`), which has no local/resumable upload: Meta's servers `cURL` a **publicly reachable HTTPS URL** for every media type. A file sitting on your laptop isn't reachable by Instagram's servers, so it needs a brief public home. [Cloudflare R2](https://developers.cloudflare.com/r2/) is that home: uploaded privately, published via a short-lived signed URL, then deleted.

**→ Full setup guide: [docs/r2-setup.md](docs/r2-setup.md)** walks through step-by-step Terraform provisioning and configuration.
**→ Design & security rationale: [docs/r2-integration.md](docs/r2-integration.md)** covers why it's required, the private-bucket security posture, and how the storage cap is enforced.

> [!NOTE]
> R2 is only skippable if you never use Compose Studio and instead call `POST /api/publish` directly with your own already-hosted URLs.

---

## 🏗️ How it works

```
┌─────────────────┐     read-through cache      ┌──────────────────────┐
│  Next.js app    │◄──────(SQLite, SWR)─────────│  Instagram Graph API │
│  (App Router)   │                             │       v25.0          │
│                 │──────direct API calls──────►│  graph.instagram.com │
└────────┬────────┘                             └──────────────────────┘
         │
         ├─ Cache worker        → data/cache.db      (media + insights, 30-min re-sync)
         ├─ Token manager       → auto long-lived refresh before expiry
         ├─ Automation worker   → comment → follow → DM funnel (60s tick)
         └─ Transcription worker→ data/transcripts.db (faster-whisper, Python)
```

- **Framework:** Next.js 14 (App Router) + React 18 + TypeScript
- **Styling:** Tailwind CSS, `next-themes` (light/dark), Recharts for charts
- **Data layer:** TanStack Query on the client; `better-sqlite3` for local persistence
- **API layer:** typed Instagram Graph API client with built-in rate-limit parsing and throttling

---

## 📁 Project structure

```
src/
├── app/            # App Router pages: dashboard, posts, inbox, compose, automations, settings
├── components/     # UI + feature components (cockpit, posts, inbox, compose, automations, settings)
├── hooks/          # TanStack Query hooks
└── lib/
    ├── instagram/  # Graph API client, endpoints, rate limiting
    ├── cache/      # local media/insights cache + background sync
    ├── token/      # long-lived token manager & auto-refresh
    ├── transcription/  # faster-whisper worker (Python bridge)
    └── automation-*    # engagement automation engine
scripts/transcribe.py   # Python transcription entrypoint
mcp/                    # MCP server exposing the scheduler to Claude Code (own package)
```

---

## 🔒 Security & data ownership

- Your access token and app secret live only in your local `.env` and are used **only** for direct calls to Meta.
- All caches and databases are local SQLite files under `data/` (git-ignored).
- No analytics, telemetry, or third-party backends. **Your data stays on your machine.**

---

## 🤝 Contributing

Contributions are welcome! Whether it's a bug fix, a new platform integration, or docs improvements: open an issue to discuss, or send a PR. Please keep changes focused and match the existing code style.

---

## 📄 License

Released under the [MIT License](LICENSE) unless otherwise noted. You are responsible for your own use of the Instagram/Meta APIs under their respective terms.

---

<div align="center">
<sub>Not affiliated with Meta Platforms, Inc. Instagram is a trademark of Meta Platforms, Inc.</sub>
</div>
