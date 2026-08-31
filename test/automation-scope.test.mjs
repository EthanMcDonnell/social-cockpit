/**
 * Automation scope, and the promise that nothing already running changes.
 *
 * Which posts a flow fires on used to be inferred: an empty `media_ids` meant
 * "every post on the account". That made the widest possible setting the one a
 * flow got by saying nothing, so a flow created and left alone DMed everyone who
 * commented anywhere. `scope` makes it a choice.
 *
 * The risk in that change is not the new behaviour, it is the old flows. Every
 * flow live on this account predates the field, and several carry their target
 * only in the legacy `media_id` column — they read as untargeted if you look at
 * the config alone. They have to keep firing on exactly the posts they fired on
 * yesterday. So the property under test is an equivalence:
 *
 *     scope === "account" || media_ids.includes(id)
 *
 * must return what this returned, for every row shape that predates the field:
 *
 *     media_ids.length === 0 || media_ids.includes(id)
 *
 * The second expression is the code that was deleted from the worker. It is
 * written out longhand here so the test compares the new rule against the real
 * old one rather than against a description of it.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { loadLib } from "./helpers/lib-under-test.mjs";

const { load, cleanup } = loadLib(["src/lib/db/**/*.ts"]);
const db = load("lib/db/index.js");

/** The predicate the worker used before scope existed. */
const firedBefore = (flow, postId) =>
  flow.media_ids.length === 0 || flow.media_ids.includes(postId);

/** The predicate the worker uses now. */
const firesNow = (flow, postId) =>
  flow.scope === "account" || flow.media_ids.includes(postId);

/** A stored row, the way SQLite hands it back. */
function row({ config = {}, media_id = null }) {
  return {
    id: "f1",
    name: "flow",
    template_type: "comment_to_dm",
    trigger_keyword: JSON.stringify(["CLAUDE"]),
    config: JSON.stringify(config),
    is_active: 1,
    created_at: "2026-04-23T00:00:00.000Z",
    media_id,
  };
}

// Every shape a pre-scope row is actually stored in. "config with no media_ids
// key" plus a media_id column is the one all fourteen live flows use; the rest
// are shapes rowToFlow already had to handle when it resolved media_ids.
const LEGACY_ROWS = [
  ["no config at all", row({})],
  ["config with no media_ids key", row({ config: { initial_message: "hi" } })],
  ["explicitly empty media_ids", row({ config: { media_ids: [] } })],
  ["empty media_ids, legacy column set", row({ config: { media_ids: [] }, media_id: "m1" })],
  ["one target", row({ config: { media_ids: ["m1"] } })],
  ["several targets", row({ config: { media_ids: ["m1", "m2", "m3"] } })],
  ["legacy media_id column only", row({ media_id: "m1" })],
  ["media_ids with a falsy entry", row({ config: { media_ids: ["m1", ""] } })],
  ["media_ids not an array", row({ config: { media_ids: "m1" }, media_id: "m1" })],
];

const POST_IDS = ["m1", "m2", "m3", "m9", "brand-new-post"];

test("pre-scope rows fire on exactly the posts they fired on before", () => {
  for (const [label, stored] of LEGACY_ROWS) {
    const flow = db.rowToFlow(stored);
    for (const postId of POST_IDS) {
      assert.equal(
        firesNow(flow, postId),
        firedBefore(flow, postId),
        `${label}: firing decision changed for ${postId}`
      );
    }
  }
});

test("pre-scope rows resolve to a scope, never undefined", () => {
  for (const [label, stored] of LEGACY_ROWS) {
    const { scope } = db.rowToFlow(stored);
    assert.ok(scope === "account" || scope === "posts", `${label}: got ${scope}`);
  }
});

test("a flow carrying only the legacy media_id column stays targeted", () => {
  // The shape of every "Comment to DM" flow live on this account: no media_ids
  // key in config at all, one id in the media_id column. It reads as untargeted
  // if you only look at the config, which is exactly the mistake to avoid — the
  // fallback in rowToFlow is what makes these posts-scoped, and flipping them to
  // account scope would widen four live flows to the whole account.
  const flow = db.rowToFlow(row({ config: { initial_message: "hi" }, media_id: "m1" }));
  assert.equal(flow.scope, "posts");
  assert.deepEqual(flow.media_ids, ["m1"]);
  assert.ok(firesNow(flow, "m1"));
  assert.equal(firesNow(flow, "some-other-post"), false);
});

test("a flow with an empty media_ids array is the account-wide one", () => {
  // This is what the create route writes when nothing is selected, so it is the
  // state a brand-new flow lands in — and under the old rule it fired on every
  // post on the account. Kept resolving to "account" so no existing row moves;
  // the UI is what stops new flows being created this way.
  const flow = db.rowToFlow(row({ config: { media_ids: [] } }));
  assert.equal(flow.scope, "account");
  assert.ok(firesNow(flow, "any-post-at-all"));
});

test("a stored scope wins over what the targets would imply", () => {
  const posts = db.rowToFlow(row({ config: { media_ids: [], scope: "posts" } }));
  assert.equal(posts.scope, "posts");
  // The new safe state: nothing chosen, so nothing fires. Under the old rule
  // this same row fired on every post.
  assert.equal(firesNow(posts, "some-post"), false);
  assert.equal(firedBefore(posts, "some-post"), true);

  const account = db.rowToFlow(row({ config: { media_ids: ["m1"], scope: "account" } }));
  assert.equal(account.scope, "account");
  assert.ok(firesNow(account, "a-post-it-does-not-target"));
});

test("a junk scope value falls back to inference rather than trusting it", () => {
  for (const junk of ["", "everything", 1, null, {}]) {
    const empty = db.rowToFlow(row({ config: { media_ids: [], scope: junk } }));
    assert.equal(empty.scope, "account", `empty targets + ${JSON.stringify(junk)}`);
    const targeted = db.rowToFlow(row({ config: { media_ids: ["m1"], scope: junk } }));
    assert.equal(targeted.scope, "posts", `targets + ${JSON.stringify(junk)}`);
  }
});

test.after(cleanup);
