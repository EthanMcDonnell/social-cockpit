/**
 * The Slugs page, rendered.
 *
 * A page that only ever ran in a browser is a page nobody checks after the
 * shapes it reads change. This renders the real component against the real
 * response shapes, so a pool that stops explaining itself — no pick, no reason,
 * no way to start one — fails here rather than in front of someone.
 *
 * Server rendering means effects do not run, which is deliberate: anything the
 * page needs an effect to get right would show the wrong thing on first paint.
 */

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { loadLib } from "./helpers/lib-under-test.mjs";

const { load, cleanup } = loadLib(["src/app/slugs/SlugsClient.tsx"]);

// CJS resolution throughout: importing react-query as ESM here would load a
// different build than the compiled component requires, and two copies mean two
// React contexts and a "No QueryClient set" that says nothing about the page.
const require_ = createRequire(import.meta.url);
const React = require_("react");
const { renderToString } = require_("react-dom/server");
const { QueryClient, QueryClientProvider } = require_("@tanstack/react-query");
const { SlugsClient } = load("app/slugs/SlugsClient.js");

// Nothing should reach the network during a render. If something does, the
// thrown error is the finding.
global.fetch = async (url) => {
  throw new Error(`unexpected fetch during render: ${url}`);
};

function render(seed = () => {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  seed(client);
  const html = renderToString(
    React.createElement(
      QueryClientProvider,
      { client },
      React.createElement(SlugsClient, null)
    )
  );
  // React separates adjacent text nodes with empty comments; they are invisible
  // to a reader and would only make these assertions about the renderer.
  return html.replace(/<!--\s*-->/g, "");
}

const VIDEO = {
  id: "v1",
  seq: 1,
  slug: "gym-tips",
  path: "/Users/me/clips/gym-3.mp4",
  label: "Gym tips 3",
  payload: { ig: { caption: "Comment GYM 👇" } },
  created_at: "2026-08-01 09:00:00",
  posts: [{ platform: "ig", external_id: "ig-1", posted_at: "2026-08-02 09:00:00" }],
  filename: "gym-3.mp4",
  missing: false,
  views: 9000,
  engagement: 0.021,
  scored: true,
};

/** Added by hand: no label, no payload defaults, never posted. */
const BARE = {
  ...VIDEO,
  id: "v2",
  seq: 2,
  label: null,
  payload: {},
  posts: [],
  path: "/Users/me/clips/gym-4.mp4",
  filename: "gym-4.mp4",
  views: undefined,
  engagement: undefined,
  scored: false,
};

const SUMMARY = {
  slug: "gym-tips",
  name: "Gym tips",
  selection_method: null,
  created_at: "2026-08-01",
  updated_at: "2026-08-01",
  video_count: 2,
  eligible: { ig: 1, yt: 2 },
  automations: [{ flow_id: "f1", name: "Gym funnel", is_active: true }],
};

const listOnly = (client) =>
  client.setQueryData(["slugs"], {
    default_selection: "most_views",
    methods: [],
    slugs: [SUMMARY],
  });

const withDetail = (detail) => (client) => {
  listOnly(client);
  client.setQueryData(["slug", "gym-tips", "ig"], detail);
};

test("an account with no pools is still offered a way to start one", () => {
  const html = render((client) =>
    client.setQueryData(["slugs"], { default_selection: "most_views", methods: [], slugs: [] })
  );
  assert.match(html, /No pools yet/);
  assert.match(html, /New pool/, "the bootstrap case: creating the first pool cannot require an API call");
});

test("a pool shows the pick it would make, and why", () => {
  const html = render(
    withDetail({
      slug: { ...SUMMARY, videos: [VIDEO, BARE] },
      effective_method: "most_views",
      next_up: {
        video: VIDEO,
        method: "most_views",
        reason: "Gym tips 3 — 9.0k views (1 eligible)",
        considered: 1,
      },
      blocked: null,
    })
  );

  assert.match(html, /Next up/);
  assert.match(html, /9\.0k views/, "the reason, not just the winner");
  assert.match(html, /#gym-tips/);
  assert.match(html, /Gym funnel/, "the automation sharing this slug is linked, not hidden");
  assert.match(
    html,
    /href="\/automations\?flow=f1"/,
    "and the link opens that flow — landing on the list and hunting for the row again is a step the link can take"
  );
  assert.match(html, /2\.1%/, "engagement column");
  assert.match(html, /not yet posted/, "an unposted candidate says so rather than showing a blank");
  assert.match(html, /gym-4\.mp4/, "a candidate with no label falls back to its filename");
});

test("a pool that cannot post explains itself instead of showing an empty pane", () => {
  const html = render(
    withDetail({
      slug: { ...SUMMARY, videos: [VIDEO] },
      effective_method: "most_views",
      next_up: null,
      blocked: {
        error: 'Every video in "gym-tips" has already been posted to Instagram.',
        exhausted: true,
      },
    })
  );
  assert.match(html, /already been posted to Instagram/);
  assert.match(html, /Nothing/);
});

test("a candidate whose file has vanished is flagged on its row", () => {
  const html = render(
    withDetail({
      slug: { ...SUMMARY, videos: [{ ...VIDEO, missing: true }] },
      effective_method: "most_views",
      next_up: null,
      blocked: { error: "Every remaining video is missing from disk.", exhausted: false },
    })
  );
  assert.match(html, /file is missing/);
});

test("the pane resolves a pool without waiting for an effect", () => {
  // Holding the selection in state and syncing it in an effect would paint
  // "pick a slug" first and correct it a frame later.
  const html = render(
    withDetail({
      slug: { ...SUMMARY, videos: [VIDEO] },
      effective_method: "most_views",
      next_up: { video: VIDEO, method: "most_views", reason: "picked", considered: 1 },
      blocked: null,
    })
  );
  assert.doesNotMatch(html, /Pick a slug to see its pool/);
  assert.match(html, /Empty pool|Delete slug/, "the detail pane is present on first paint");
});

test.after(cleanup);
