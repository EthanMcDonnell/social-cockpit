/**
 * Screenshot the demo instance through the Chrome DevTools Protocol.
 *
 * Headless Chrome, one full-page capture per route, into docs/portfolio/screenshots/.
 * Waits for the page's own network to settle rather than a fixed sleep, so a
 * slow first compile does not produce a screenshot of a skeleton.
 *
 *   node docs/portfolio/demo/shoot.mjs <base-url>
 */

import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.argv[2] ?? "http://127.0.0.1:3100";
const OUT = resolve(fileURLToPath(import.meta.url), "../../screenshots");
const PROFILE = "/tmp/sc-demo-chrome-profile";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9333;

/**
 * `ready` is the page's own evidence that it has finished, not a guess at how
 * long it takes. A dev server compiles each route on first hit, so a fixed sleep
 * either screenshots a skeleton or wastes a minute per page.
 */
const SHOTS = [
  {
    file: "01-dashboard.png",
    path: "/dashboard",
    ready: "document.querySelectorAll('svg.recharts-surface').length >= 4",
  },
  {
    file: "02-calendar.png",
    path: "/calendar",
    ready: "document.querySelectorAll('.cal-card').length >= 6",
  },
  {
    file: "03-automations.png",
    path: "/automations",
    ready: "document.body.innerText.includes('Active')",
    // Open the first flow: the page's whole right half is the editor, and an
    // empty "select a flow" pane is half a screenshot.
    click: `(() => {
      const card = Array.from(document.querySelectorAll('button'))
        .find(b => b.innerText.includes('Systems cheatsheet'));
      if (!card) return false;
      card.click();
      return true;
    })()`,
    after: "document.body.innerText.toLowerCase().includes('keyword in comment')",
  },
  {
    file: "04-posts.png",
    path: "/posts",
    ready: "document.querySelectorAll('img').length >= 6",
  },
];

/** No skeleton anywhere is the second half of "done" on every page. */
const NO_SKELETON = "document.querySelectorAll('.animate-pulse').length === 0";

/**
 * React Query's devtools mount a floating island button in development. It is a
 * dev tool, not part of the product, so it has no business in a portfolio shot.
 */
const HIDE_DEV_CHROME = `
  (() => {
    let el = document.getElementById('shoot-hide');
    if (!el) {
      el = document.createElement('style');
      el.id = 'shoot-hide';
      el.textContent = '.tsqd-parent-container, nextjs-portal { display: none !important; }';
      document.head.appendChild(el);
    }
    return true;
  })()
`;

// Tall enough that the dashboard's four instruments fit in one frame - the
// pages are designed for a laptop, and a screenshot that clips the last panel
// reads as a bug rather than as a scroll.
const VIEWPORT = { width: 1600, height: 1260, scale: 2 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cdpTargets() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) return (await res.json()).webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error("chrome devtools never came up");
}

/** Minimal CDP client: send(method, params) resolving on the matching id. */
function connect(url) {
  const ws = new WebSocket(url);
  const pending = new Map();
  const listeners = [];
  let id = 0;
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve: ok, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : ok(msg.result);
    } else {
      for (const fn of listeners) fn(msg);
    }
  });
  const ready = new Promise((ok) => ws.addEventListener("open", ok));
  return {
    ready,
    on: (fn) => listeners.push(fn),
    send: (method, params = {}, sessionId) =>
      new Promise((ok, reject) => {
        const n = ++id;
        pending.set(n, { resolve: ok, reject });
        ws.send(JSON.stringify({ id: n, method, params, sessionId }));
      }),
    close: () => ws.close(),
  };
}

const chrome = spawn(CHROME, [
  "--headless=new",
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${PROFILE}`,
  `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
  "--hide-scrollbars",
  "--force-device-scale-factor=" + VIEWPORT.scale,
  "--no-first-run",
  "--disable-extensions",
  "about:blank",
], { stdio: "ignore" });

process.on("exit", () => {
  chrome.kill();
  try { rmSync(PROFILE, { recursive: true, force: true }); } catch {}
});

const wsUrl = await cdpTargets();
const client = connect(wsUrl);
await client.ready;

const { targetId } = await client.send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await client.send("Target.attachToTarget", { targetId, flatten: true });

await client.send("Page.enable", {}, sessionId);
// No Emulation.setDeviceMetricsOverride: --window-size and
// --force-device-scale-factor already give the right viewport, and the override
// intermittently left the page with a degenerate layout box - which recharts'
// ResponsiveContainer answers by rendering no chart at all, so the wait for
// content could never succeed.

mkdirSync(OUT, { recursive: true });

async function evaluate(expression) {
  const { result } = await client.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
  }, sessionId);
  return result.value;
}

async function waitFor(expression, label, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(expression).catch(() => false)) return;
    await sleep(400);
  }
  // Say what the page actually looked like. A bare timeout tells you nothing
  // about whether the app was slow, empty, or erroring.
  const state = await evaluate(`JSON.stringify({
    url: location.pathname,
    charts: document.querySelectorAll('svg.recharts-surface').length,
    skeletons: document.querySelectorAll('.animate-pulse').length,
    text: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 300),
  })`).catch(() => "<page unreachable>");
  throw new Error(`timed out waiting for ${label}\n  page: ${state}`);
}

async function navigate(shot, pass, attempts = 3) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    await client.send("Page.navigate", { url: BASE + shot.path }, sessionId);
    try {
      await waitFor(shot.ready, `${shot.path} content (pass ${pass})`, 60_000);
      await waitFor(NO_SKELETON, `${shot.path} skeletons (pass ${pass})`, 60_000);
      return;
    } catch (err) {
      if (attempt === attempts) throw err;
      console.log(`  retrying ${shot.path} (attempt ${attempt} did not render)`);
      await client.send("Page.navigate", { url: "about:blank" }, sessionId);
      await sleep(1000);
    }
  }
}

for (const shot of SHOTS) {
  // Two passes: the first compiles the route and its API handlers, the second
  // renders against a warm server so nothing is mid-fetch when the shutter goes.
  //
  // Each pass gets more than one navigation. Occasionally a navigation lands on
  // a document that never renders - the body stays empty while the server log
  // shows a clean 200 - and reloading clears it. Retrying is cheaper than
  // pinning down which layer swallowed the first paint.
  for (const pass of [1, 2]) {
    await navigate(shot, pass);
  }
  if (shot.click) {
    if (!(await evaluate(shot.click))) {
      throw new Error(`${shot.path}: nothing matched the click target`);
    }
    if (shot.after) await waitFor(shot.after, `${shot.path} detail pane`);
    await waitFor(NO_SKELETON, `${shot.path} detail skeletons`);
  }

  await evaluate(HIDE_DEV_CHROME);

  // React Query refetches on focus; give any second render a beat to land.
  await client.send("Runtime.evaluate", {
    expression: "new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))",
    awaitPromise: true,
  }, sessionId);
  await sleep(600);
  // A dev-server compile error renders as a full-page overlay. Capturing that
  // and filing it as a portfolio screenshot is the one failure worth being loud
  // about, so check before the shutter rather than after.
  const { result } = await client.send("Runtime.evaluate", {
    expression: "document.querySelector('nextjs-portal') ? 'overlay' : document.title",
    returnByValue: true,
  }, sessionId);
  if (result.value === "overlay") {
    throw new Error(`${shot.path} rendered a Next.js error overlay - fix the app, not the screenshot`);
  }

  const { data } = await client.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  }, sessionId);
  writeFileSync(join(OUT, shot.file), Buffer.from(data, "base64"));
  console.log(`shot ${shot.file}  ←  ${shot.path}`);
}

client.close();
chrome.kill();
// Chrome is still flushing its profile as it dies; removing it out from under
// it throws ENOTEMPTY and fails a run whose screenshots are already on disk.
await sleep(500);
try {
  rmSync(PROFILE, { recursive: true, force: true });
} catch {
  // A leftover profile directory costs nothing - the next run reuses the path.
}
