/**
 * A local, read-only stand-in for graph.instagram.com.
 *
 * It serves the single fabricated campaign in dataset.mjs, including local visual
 * fixtures. `run.sh` rewrites the app's Graph base URLs to this server inside an
 * isolated worktree, so a capture cannot reach a real account.
 *
 *   node docs/portfolio/demo/mock-graph.mjs [port]
 */

import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ACCOUNT_ID, PROFILE, MEDIA, USER_INSIGHTS } from "./dataset.mjs";

const PORT = Number(process.argv[2] ?? 3199);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const ASSET_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "assets/campaign");
const byId = new Map(MEDIA.map((media) => [media.id, media]));
const coverKeys = new Set(MEDIA.map((media) => media.cover));

function send(res, status, body, type = "application/json", headers = {}) {
  res.writeHead(status, {
    "content-type": type,
    // The rate-limit meter reads this. It is intentionally a quiet, healthy demo account.
    "x-app-usage": JSON.stringify({ call_count: 11, total_cputime: 3, total_time: 4 }),
    "access-control-allow-origin": "*",
    ...headers,
  });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

/** Graph returns user/media insights as one entry per requested metric. */
function insightsResponse(entries) {
  return {
    data: entries.map(([name, values]) => ({
      name,
      period: "day",
      title: name,
      description: name,
      id: `${ACCOUNT_ID}/insights/${name}`,
      values,
    })),
  };
}

function mediaPayload(media) {
  const cover = encodeURIComponent(media.cover);
  return {
    id: media.id,
    caption: media.caption,
    media_type: media.media_type,
    media_product_type: media.media_product_type,
    permalink: media.permalink,
    shortcode: media.shortcode,
    timestamp: media.timestamp,
    like_count: media.like_count,
    comments_count: media.comments_count,
    thumbnail_url: `${ORIGIN}/thumb/${cover}.svg`,
    media_url: `${ORIGIN}/thumb/${cover}.svg`,
  };
}

function selectedUserValues(values, search) {
  const since = Number(search.get("since"));
  const until = Number(search.get("until"));
  if (!Number.isFinite(since) || !Number.isFinite(until)) return values;
  const lower = since * 1000;
  const upper = until * 1000;
  return values.filter((entry) => {
    const at = new Date(entry.end_time).getTime();
    return at >= lower && at <= upper;
  });
}

function serveCover(res, key) {
  // Fixed manifest keys and a simple filename rule make traversal impossible.
  if (!coverKeys.has(key) || !/^[a-z0-9-]+$/.test(key)) {
    return send(res, 404, "cover not found", "text/plain; charset=utf-8");
  }
  const path = resolve(ASSET_ROOT, `${key}.svg`);
  if (!path.startsWith(`${ASSET_ROOT}/`) || !existsSync(path)) {
    return send(res, 404, "cover not found", "text/plain; charset=utf-8");
  }
  return send(res, 200, readFileSync(path), "image/svg+xml", {
    "cache-control": "public, max-age=3600, immutable",
  });
}

createServer((req, res) => {
  if (req.method !== "GET") {
    return send(res, 405, { error: "demo mock is read-only" }, "application/json", { allow: "GET" });
  }

  const url = new URL(req.url, ORIGIN);
  const path = url.pathname.replace(/^\/v\d+\.\d+/, "");
  const cover = path.match(/^\/thumb\/([a-z0-9-]+)\.svg$/);
  if (cover) return serveCover(res, cover[1]);

  if (path === `/${ACCOUNT_ID}`) return send(res, 200, PROFILE);

  if (path === `/${ACCOUNT_ID}/insights`) {
    const wanted = (url.searchParams.get("metric") ?? "").split(",").filter(Boolean);
    return send(
      res,
      200,
      insightsResponse(
        wanted
          .filter((metric) => USER_INSIGHTS[metric])
          .map((metric) => [metric, selectedUserValues(USER_INSIGHTS[metric], url.searchParams)])
      )
    );
  }

  if (path === `/${ACCOUNT_ID}/media`) return send(res, 200, { data: MEDIA.map(mediaPayload) });

  const media = path.match(/^\/(\d+)\/(insights|comments)$/);
  if (media) {
    const item = byId.get(media[1]);
    if (!item) return send(res, 404, { data: [] });
    if (media[2] === "comments") return send(res, 200, { data: [] });
    const wanted = (url.searchParams.get("metric") ?? "").split(",").filter(Boolean);
    return send(
      res,
      200,
      insightsResponse(
        wanted
          .filter((metric) => item.insights[metric] !== undefined)
          .map((metric) => [metric, [{ value: item.insights[metric] }]])
      )
    );
  }

  // A missing read edge should look empty, not produce an error state in a shot.
  return send(res, 200, { data: [] });
}).listen(PORT, "127.0.0.1", () => {
  console.log(`mock graph on ${ORIGIN} — ${MEDIA.length} media, ${coverKeys.size} local covers`);
});
