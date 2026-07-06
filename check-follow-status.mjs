#!/usr/bin/env node
/*
 * check-follow-status.mjs — READ-ONLY capability probe.
 *
 * Standalone: does NOT import or run the app, does NOT start the server, makes
 * ONLY GET requests, and only READS .env.local / .env (never writes anything).
 *
 * Question it answers: given a real commenter's id, does the Instagram API return
 * `is_user_follow_business`? That decides whether a "must be following me first"
 * gate is even buildable for comment → DM automation.
 *
 * Usage (run from the repo root):
 *   node check-follow-status.mjs                # auto-pick a recent comment
 *   node check-follow-status.mjs --media <id>   # use a specific post
 *   node check-follow-status.mjs --comment <id> # use a specific comment
 *   node check-follow-status.mjs --user <igsid> # look up a specific user id
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

function parseArgs() {
  const a = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--media") out.media = a[++i];
    else if (a[i] === "--comment") out.comment = a[++i];
    else if (a[i] === "--user") out.user = a[++i];
    else if (a[i] === "--dm") out.dm = a[++i];
  }
  return out;
}

async function get(token, path, params = {}) {
  const url = new URL(path.startsWith("http") ? path : `${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, String(v));
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  return { ok: res.ok, status: res.status, json };
}

function fail(msg) {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}

// Find a DM conversation participant by name/username → returns their messaging id.
async function findDmParticipant(token, accountId, query) {
  if (!accountId) fail("INSTAGRAM_ACCOUNT_ID needed to search conversations; or pass --user <igsid>");
  console.log(`• Searching DM conversations for "${query}"…`);
  const needles = [query.toLowerCase(), query.toLowerCase().replace(/\s+/g, ""), ...query.toLowerCase().split(/\s+/)].filter(Boolean);

  let path = `/${accountId}/conversations`;
  let params = { fields: "participants{id,username,name},updated_time", limit: 50 };
  let triedPlain = false;
  const seen = new Map();
  let pages = 0;

  while (path && pages < 8) {
    const r = await get(token, path, params);
    if (!r.ok) {
      const err = r.json?.error;
      if (!triedPlain && /participant|field/i.test(err?.message || "")) {
        triedPlain = true;
        params = { fields: "participants,updated_time", limit: 50 };
        continue;
      }
      console.log(`  ✗ conversations failed (HTTP ${r.status}): ${err ? err.message : JSON.stringify(r.json)}`);
      console.log("  → token likely lacks instagram_manage_messages, or messaging isn't enabled on the app.");
      return null;
    }
    for (const conv of r.json.data || []) {
      const parts = conv.participants?.data || conv.participants || [];
      for (const p of parts) {
        if (!p || String(p.id) === String(accountId)) continue;
        seen.set(p.id, p);
        const hay = `${(p.username || "").toLowerCase()} ${(p.name || "").toLowerCase()}`;
        if (needles.some((n) => hay.includes(n))) {
          console.log(`  ✓ match: ${p.name || ""} @${p.username || "?"} (id ${p.id})`);
          return { id: p.id, label: p.username || p.name || "" };
        }
      }
    }
    path = r.json.paging?.next || null;
    params = undefined;
    pages++;
  }

  console.log(`  ✗ no participant matched "${query}". Participants seen in your DMs:`);
  for (const p of seen.values()) console.log(`    - ${p.name || ""} @${p.username || "?"} (id ${p.id})`);
  return null;
}

const env = loadEnv();
const token = env.INSTAGRAM_ACCESS_TOKEN;
const accountId = env.INSTAGRAM_ACCOUNT_ID;
const args = parseArgs();

if (!token) fail("INSTAGRAM_ACCESS_TOKEN not found in .env.local / .env");

console.log("── Follow-status probe (READ-ONLY) ─────────────────────────");
console.log("GET requests only. No app code imported. No files written.\n");

async function main() {
  let userId = args.user;
  let userLabel = "";

  if (!userId && args.dm) {
    const found = await findDmParticipant(token, accountId, args.dm);
    if (!found) return;
    userId = found.id;
    userLabel = found.label;
  }

  if (!userId) {
    let commentId = args.comment;

    if (!commentId) {
      let mediaId = args.media;
      if (!mediaId) {
        if (!accountId) fail("INSTAGRAM_ACCOUNT_ID not found; pass --media <id> or --comment <id>");
        console.log("• Finding a recent post with comments…");
        const media = await get(token, `/${accountId}/media`, { fields: "id,comments_count", limit: 25 });
        if (!media.ok) fail(`media list failed (${media.status}): ${JSON.stringify(media.json.error || media.json)}`);
        const withComments = (media.json.data || []).find((m) => Number(m.comments_count) > 0);
        if (!withComments) fail("No recent posts have comments. Pass --comment <id> or --user <igsid>.");
        mediaId = withComments.id;
        console.log(`  media: ${mediaId} (${withComments.comments_count} comments)`);
      }

      console.log("• Fetching a comment to get the commenter's id…");
      const comments = await get(token, `/${mediaId}/comments`, {
        fields: "id,text,username,from{id,username}",
        limit: 25,
      });
      if (!comments.ok) fail(`comments failed (${comments.status}): ${JSON.stringify(comments.json.error || comments.json)}`);
      const list = comments.json.data || [];
      if (!list.length) fail("That media has no readable comments.");

      const chosen = list.find((c) => c.from && c.from.id) || list[0];
      commentId = chosen.id;
      console.log(`  comment: ${commentId} by @${chosen.username || chosen.from?.username || "?"}`);

      if (chosen.from?.id) {
        userId = chosen.from.id;
        userLabel = chosen.from.username || chosen.username || "";
      } else {
        console.log("\n⚠ The comment did NOT include a `from.id` (Instagram often omits commenter ids).");
      }
    } else {
      console.log(`• Looking up comment ${commentId}…`);
      const c = await get(token, `/${commentId}`, { fields: "from{id,username},username,text" });
      if (!c.ok) fail(`comment lookup failed (${c.status}): ${JSON.stringify(c.json.error || c.json)}`);
      console.log("  comment:", JSON.stringify(c.json));
      if (c.json?.from?.id) {
        userId = c.json.from.id;
        userLabel = c.json.from.username || "";
      }
    }
  }

  if (!userId) {
    console.log("\n── VERDICT ─────────────────────────────────────────────");
    console.log("✗ Could not obtain a commenter user id from the API.");
    console.log("  Instagram isn't returning `from.id` on comments for this token/account,");
    console.log("  so a follow-gate keyed off a bare comment is NOT feasible this way.");
    console.log("  (Follow status may still be readable for people who DM you — a different flow.)");
    return;
  }

  console.log(`\n• Probing fields individually on user ${userId}${userLabel ? ` (@${userLabel})` : ""}…`);
  const candidates = [
    "id",
    "username",
    "name",
    "is_verified_user",
    "follower_count",
    "is_user_follow_business",
    "is_business_follow_user",
    "profile_pic",
  ];

  let followFieldWorks = false;
  let followValue;
  for (const field of candidates) {
    const r = await get(token, `/${userId}`, { fields: field });
    if (r.ok && Object.prototype.hasOwnProperty.call(r.json, field)) {
      console.log(`  ✓ ${field.padEnd(24)} = ${JSON.stringify(r.json[field])}`);
      if (field === "is_user_follow_business") {
        followFieldWorks = true;
        followValue = r.json[field];
      }
    } else {
      const err = r.json?.error;
      console.log(`  ✗ ${field.padEnd(24)} — ${err ? err.message : `HTTP ${r.status}`}`);
    }
  }

  console.log("\n── VERDICT ─────────────────────────────────────────────");
  if (followFieldWorks) {
    console.log(`✓ FEASIBLE — is_user_follow_business = ${followValue}`);
    console.log("  You can gate comment → DM on whether the commenter follows you.");
    console.log("  NOTE: confirm with a NON-owner commenter's id too (re-run with --user <igsid>).");
  } else {
    console.log("✗ is_user_follow_business is NOT queryable for this commenter / token.");
    console.log("  Likely: needs instagram_manage_messages, or the field only resolves once");
    console.log("  there's a conversation (i.e. after they DM you) — not from a bare comment.");
    console.log("  → The follow-gate may only be possible for people already in your DMs.");
  }
}

main().catch((e) => fail(e?.message || String(e)));
