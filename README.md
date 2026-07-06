This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

## Video transcription (optional)

A background worker (`src/lib/transcription/`) automatically transcribes your
Instagram videos/reels using [`faster-whisper`](https://github.com/SYSTRAN/faster-whisper).
It boots with the server, re-scans for new videos every 30 minutes, and runs one
transcription at a time. Results are cached in `data/transcripts.db` and shown in
the post detail panel.

Transcription runs in Python (`scripts/transcribe.py`), so it needs a Python
interpreter with `faster-whisper` installed. Set up a local virtualenv:

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

Then point the app at it:

```bash
# .env.local
TRANSCRIPTION_PYTHON=/absolute/path/to/social-cockpit/.venv/bin/python
# Optional: whisper model (default "small"); larger = more accurate, slower
# TRANSCRIPTION_MODEL=medium
```

Restart `npm run dev` after editing `.env.local`, then turn the feature on from
the **Settings** page. Both are required: the toggle enables transcription
app-wide, and `TRANSCRIPTION_PYTHON` tells the worker how to run it. If either is
missing, transcription simply doesn't run — the rest of the app is unaffected.

## Meta API cache

Reference for the underlying endpoints:
[Instagram Platform API reference](https://developers.facebook.com/documentation/instagram-platform/reference).

Instagram media and per-post insights are cached locally in `data/cache.db`
(`src/lib/cache/`) rather than fetched live on every request. A background worker
boots with the server and re-syncs every ~30 minutes; reads are served
**read-through** (stale-while-revalidate) — a cold cache is populated before
responding, a stale one is served immediately and refreshed in the background.

This removes the per-post insights fan-out (the main rate-limit risk) and makes
ranking/aggregation cheap local SQL. It powers:
- `GET /api/posts` (cursor-paginated, transcript + insights embedded) and the
  posts page,
- `GET /api/posts/summary` (cached aggregates),
- `GET /api/scripts/top?metric=<m>` (top posts that have a transcript, ranked by
  a cached metric).

Optional env (sane defaults):

```bash
# .env.local
# CACHE_DB_PATH=./data/cache.db          # cache location
# CACHE_SYNC_INTERVAL_MS=1800000         # background re-sync cadence (30 min)
# CACHE_TTL_MS=1800000                   # freshness window before read-through refresh
```

No setup is required — the cache populates itself on first use. It falls back to
a live Instagram fetch on a cold/empty cache, so reads behave like before in the
worst case.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
