/**
 * Business Discovery against a stubbed Graph API.
 *
 * The parts worth pinning are the ones Meta doesn't document loudly: the call
 * must go to graph.facebook.com on the Facebook token (the Instagram Login one
 * is refused), and paging is by cursor inside the field expansion, ending on a
 * short page because the edge returns no `next` link.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { loadLib } from "./helpers/lib-under-test.mjs";

process.env.FACEBOOK_ACCESS_TOKEN = "fb-token";
process.env.FACEBOOK_INSTAGRAM_ACCOUNT_ID = "1784";

const { load, cleanup } = loadLib(["src/lib/instagram/endpoints/discovery.ts"]);
const { discoverAccount } = load("lib/instagram/endpoints/discovery.js");

const post = (id) => ({ id, media_type: "VIDEO", timestamp: "2026-10-01T00:00:00+0000" });

function stubGraph(pages) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: new URL(url), auth: init.headers.Authorization });
    const body = pages[calls.length - 1];
    return new Response(JSON.stringify(body), { status: 200 });
  };
  return calls;
}

test.after(cleanup);

test("pages by cursor on the Facebook token until a short page", async () => {
  const calls = stubGraph([
    {
      business_discovery: {
        username: "kodekloud",
        followers_count: 10,
        media: { data: Array.from({ length: 50 }, (_, i) => post(`a${i}`)), paging: { cursors: { after: "CUR1" } } },
      },
    },
    {
      business_discovery: {
        username: "kodekloud",
        followers_count: 10,
        media: { data: [post("b0"), post("b1")], paging: { cursors: { after: "CUR2" } } },
      },
    },
  ]);

  const account = await discoverAccount("@kodekloud", 120);

  assert.equal(account.username, "kodekloud");
  assert.equal(account.posts.length, 52);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url.origin, "https://graph.facebook.com");
  assert.equal(calls[0].url.pathname, "/v25.0/1784");
  assert.equal(calls[0].auth, "Bearer fb-token");
  assert.match(calls[0].url.searchParams.get("fields"), /^business_discovery\.username\(kodekloud\)\{.*media\.limit\(50\)\{/);
  assert.match(calls[1].url.searchParams.get("fields"), /media\.after\(CUR1\)\.limit\(50\)\{/);
});

test("rejects a name that would change the field expansion", async () => {
  const calls = stubGraph([]);
  await assert.rejects(discoverAccount("kodekloud){id}", 10), RangeError);
  assert.equal(calls.length, 0);
});
