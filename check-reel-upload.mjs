#!/usr/bin/env node
/*
 * check-reel-upload.mjs — diagnose the reel file-upload failure.
 *
 * Makes ONE call: create a REELS container with upload_type=resumable and NO
 * video_url — identical to what the compose page's file-drop path does. It does
 * NOT upload bytes and does NOT publish, so nothing appears on the account (an
 * unfilled container just expires). Reads .env only.
 *
 * Tells us whether graph.instagram.com supports resumable upload:
 *   - returns `uri` → resumable IS supported (bug is in our binary-upload step)
 *   - errors about video_url / missing param → NOT supported on this host/token
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const BASE = "https://graph.instagram.com/v25.0";

function loadEnv() {
  const env = { ...process.env };
  for (const f of [".env.local", ".env"]) {
    const p = resolve(process.cwd(), f);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (!m) continue;
      const [, k, raw] = m;
      if (env[k] !== undefined) continue;
      let v = raw;
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      env[k] = v;
    }
  }
  return env;
}

const env = loadEnv();
const token = env.INSTAGRAM_ACCESS_TOKEN;
const accountId = env.INSTAGRAM_ACCOUNT_ID;
if (!token || !accountId) {
  console.error("✗ INSTAGRAM_ACCESS_TOKEN / INSTAGRAM_ACCOUNT_ID not found in .env");
  process.exit(1);
}

async function createContainer(params, label) {
  const url = new URL(`${BASE}/${accountId}/media`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  console.log(`\n── ${label} ──`);
  console.log(`  params: ${JSON.stringify(params)}`);
  console.log(`  HTTP ${res.status}`);
  console.log(`  response: ${JSON.stringify(json)}`);
  return { ok: res.ok, json };
}

console.log("── Reel resumable-upload diagnostic (no publish) ──────────");

const a = await createContainer(
  { media_type: "REELS", upload_type: "resumable" },
  "A. REELS + upload_type=resumable (the file-drop path)"
);

console.log("\n── VERDICT ─────────────────────────────────────────────");
if (a.ok && a.json?.uri) {
  console.log("✓ Resumable IS supported here — response returned a `uri`.");
  console.log("  So the file-drop failure is in the byte-upload step, not creation.");
} else if (a.ok && a.json?.id) {
  console.log("~ Container created but NO `uri` returned — resumable half-supported.");
  console.log("  We'd have no upload target; treat as unsupported.");
} else {
  const e = a.json?.error;
  console.log("✗ Resumable create was REJECTED.");
  if (e) console.log(`  ${e.message} (code ${e.code}${e.error_subcode ? `/${e.error_subcode}` : ""})`);
  console.log("  → graph.instagram.com wants a video_url; the local-file resumable flow");
  console.log("    isn't available on this host/token. This is the compose error.");
}
