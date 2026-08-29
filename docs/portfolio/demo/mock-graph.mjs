/**
 * A stand-in for graph.instagram.com, serving the fabricated account in
 * dataset.mjs.
 *
 * This is the reason the demo instance is safe to run: `BASE_URL` in
 * src/lib/instagram/{client,usage}.ts is repointed here, so no request the app
 * makes can reach Meta even if a worker wakes up and tries to publish. It also
 * serves the Reel thumbnails, so the pages that show media have something real
 * to load.
 *
 *   node docs/portfolio/demo/mock-graph.mjs [port]
 */

import { createServer } from "node:http";
import { ACCOUNT_ID, PROFILE, MEDIA, USER_INSIGHTS } from "./dataset.mjs";

const PORT = Number(process.argv[2] ?? 3199);
const ORIGIN = `http://127.0.0.1:${PORT}`;

const byId = new Map(MEDIA.map((m) => [m.id, m]));

/** Graph returns insights as one entry per metric; media metrics are lifetime. */
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

function mediaPayload(m) {
  return {
    id: m.id,
    caption: m.caption,
    media_type: m.media_type,
    media_product_type: m.media_product_type,
    permalink: m.permalink,
    shortcode: m.shortcode,
    timestamp: m.timestamp,
    like_count: m.like_count,
    comments_count: m.comments_count,
    thumbnail_url: `${ORIGIN}/thumb/${m.id}.svg`,
    media_url: `${ORIGIN}/thumb/${m.id}.svg`,
  };
}

/**
 * A title card in the account's own style, standing in for the Reel's cover.
 * Drawn rather than photographed: a demo dataset should not carry a real
 * person's face around with it.
 */
function thumbnail(m) {
  const words = m.title.split(" ");
  const lines = [];
  let line = "";
  for (const word of words) {
    if ((line + " " + word).trim().length > 15) {
      lines.push(line.trim());
      line = word;
    } else {
      line += ` ${word}`;
    }
  }
  lines.push(line.trim());
  const start = 300 - ((lines.length - 1) * 72) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 640">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0.4" y2="1">
    <stop offset="0" stop-color="#1E1C18"/><stop offset="1" stop-color="#0B0A09"/>
  </linearGradient></defs>
  <rect width="360" height="640" fill="url(#g)"/>
  <g fill="#F3C84E" font-family="Georgia, 'Times New Roman', serif" font-size="58" text-anchor="middle">
${lines.map((l, i) => `    <text x="180" y="${start + i * 72}">${l.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text>`).join("\n")}
  </g>
  <text x="180" y="600" fill="#7A756C" font-family="Georgia, serif" font-size="26" font-style="italic" text-anchor="middle">How It's Built</text>
</svg>`;
}

createServer((req, res) => {
  const url = new URL(req.url, ORIGIN);
  const path = url.pathname.replace(/^\/v\d+\.\d+/, "");

  const send = (body, type = "application/json") => {
    res.writeHead(200, {
      "content-type": type,
      // The header the rate-limit meter reads. A quiet, healthy account.
      "x-app-usage": JSON.stringify({ call_count: 11, total_cputime: 3, total_time: 4 }),
      "access-control-allow-origin": "*",
    });
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  };

  const thumb = path.match(/^\/thumb\/(\d+)\.svg$/);
  if (thumb) {
    const m = byId.get(thumb[1]);
    return m ? send(thumbnail(m), "image/svg+xml") : send("", "image/svg+xml");
  }

  if (path === `/${ACCOUNT_ID}`) return send(PROFILE);

  if (path === `/${ACCOUNT_ID}/insights`) {
    const wanted = (url.searchParams.get("metric") ?? "").split(",").filter(Boolean);
    return send(
      insightsResponse(
        wanted.filter((m) => USER_INSIGHTS[m]).map((m) => [m, USER_INSIGHTS[m]])
      )
    );
  }

  if (path === `/${ACCOUNT_ID}/media`) {
    return send({ data: MEDIA.map(mediaPayload) });
  }

  const media = path.match(/^\/(\d+)\/(insights|comments)$/);
  if (media) {
    const m = byId.get(media[1]);
    if (!m) return send({ data: [] });
    if (media[2] === "comments") return send({ data: [] });
    const wanted = (url.searchParams.get("metric") ?? "").split(",").filter(Boolean);
    return send(
      insightsResponse(
        wanted
          .filter((k) => m.insights[k] !== undefined)
          .map((k) => [k, [{ value: m.insights[k] }]])
      )
    );
  }

  // Anything unmodelled answers like an empty edge rather than an error, so one
  // missing endpoint cannot put an error state into a screenshot.
  send({ data: [] });
}).listen(PORT, "127.0.0.1", () => {
  console.log(`mock graph on ${ORIGIN} — ${MEDIA.length} media, account ${ACCOUNT_ID}`);
});
