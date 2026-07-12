#!/usr/bin/env node
/*
 * check-youtube.mjs — READ-ONLY capability probe.
 *
 * Standalone: does NOT import or run the app, does NOT start the server, makes
 * ONLY GET requests, and only READS .env.local / .env (never writes anything).
 *
 * Question it answers: given YOUTUBE_API_KEY + YOUTUBE_CHANNEL_ID, does the
 * YouTube Data API v3 return the channel's public statistics? Confirms the key,
 * channel id, and that the API is enabled — before any app code runs.
 *
 * Usage (run from the repo root):
 *   node check-youtube.mjs                 # channel stats
 *   node check-youtube.mjs --videos        # channel stats + recent videos
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const BASE = "https://www.googleapis.com/youtube/v3";

function loadEnv() {
  const env = { ...process.env };
  for (const f of [".env.local", ".env"]) {
    const p = resolve(process.cwd(), f);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (!m) continue;
      const [, key, rawVal] = m;
      if (env[key] !== undefined) continue; // exported vars win
      let val = rawVal;
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      env[key] = val;
    }
  }
  return env;
}

async function get(path, params, key) {
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  url.searchParams.set("key", key);
  const res = await fetch(url, { cache: "no-store" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const reason = body?.error?.errors?.[0]?.reason;
    throw new Error(`${res.status} ${res.statusText} — ${body?.error?.message ?? ""}${reason ? ` (${reason})` : ""}`);
  }
  return body;
}

function parseIsoDuration(iso) {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso ?? "");
  if (!m) return 0;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

async function main() {
  const env = loadEnv();
  const key = env.YOUTUBE_API_KEY;
  const channelId = env.YOUTUBE_CHANNEL_ID;
  if (!key) throw new Error("YOUTUBE_API_KEY is not set in .env");
  if (!channelId) throw new Error("YOUTUBE_CHANNEL_ID is not set in .env");

  const ch = await get(
    "/channels",
    { part: "snippet,statistics,contentDetails", id: channelId },
    key
  );
  const item = ch.items?.[0];
  if (!item) throw new Error(`No channel found for id "${channelId}"`);

  const s = item.statistics ?? {};
  console.log(`\nChannel:     ${item.snippet?.title ?? "(untitled)"}`);
  console.log(`Subscribers: ${Number(s.subscriberCount ?? 0).toLocaleString()}`);
  console.log(`Total views: ${Number(s.viewCount ?? 0).toLocaleString()}`);
  console.log(`Videos:      ${Number(s.videoCount ?? 0).toLocaleString()}`);

  if (!process.argv.includes("--videos")) {
    console.log("\nOK — API key + channel id are valid. (pass --videos for recent uploads)\n");
    return;
  }

  const uploads = item.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) throw new Error("No uploads playlist on channel");

  const pl = await get("/playlistItems", { part: "contentDetails", playlistId: uploads, maxResults: 10 }, key);
  const ids = (pl.items ?? []).map((i) => i.contentDetails?.videoId).filter(Boolean);
  if (ids.length === 0) {
    console.log("\nNo videos found.\n");
    return;
  }
  const vids = await get("/videos", { part: "snippet,statistics,contentDetails", id: ids.join(",") }, key);
  console.log("\nRecent videos:");
  for (const v of vids.items ?? []) {
    const dur = parseIsoDuration(v.contentDetails?.duration);
    const isShort = dur > 0 && dur <= 180 ? " [short?]" : "";
    console.log(
      `  ${Number(v.statistics?.viewCount ?? 0).toLocaleString().padStart(9)} views  ` +
        `${(v.snippet?.title ?? "").slice(0, 60)}${isShort}`
    );
  }
  console.log("");
}

main().catch((err) => {
  console.error(`\nFAILED: ${err.message}\n`);
  process.exit(1);
});
