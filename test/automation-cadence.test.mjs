/**
 * Quiet posts rest between comment checks.
 *
 * The property that matters most is the one that's easy to get backwards: a
 * post with recent activity — a new comment, a flow just attached, a fresh
 * publish — must poll every tick. Resting a busy post delays DMs; resting an
 * idle one is the whole point.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { loadLib } from "./helpers/lib-under-test.mjs";

const { load, cleanup } = loadLib(["src/lib/automation/cadence.ts"]);
const { lastActivityAt, pollIntervalFor, isDue } = load("lib/automation/cadence.js");

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const NOW = Date.parse("2026-10-04T12:00:00.000Z");

test.after(cleanup);

test("recent activity polls every tick", () => {
  assert.equal(pollIntervalFor(NOW - 5 * MIN, NOW), 0);
  assert.equal(pollIntervalFor(NOW - (3 * DAY - 1), NOW), 0);
});

test("quiet for 3 days rests 15 minutes, 14 days rests an hour", () => {
  assert.equal(pollIntervalFor(NOW - 3 * DAY, NOW), 15 * MIN);
  assert.equal(pollIntervalFor(NOW - 13 * DAY, NOW), 15 * MIN);
  assert.equal(pollIntervalFor(NOW - 14 * DAY, NOW), 60 * MIN);
  assert.equal(pollIntervalFor(NOW - 90 * DAY, NOW), 60 * MIN);
});

test("no known activity is treated as active, not quiet", () => {
  assert.equal(pollIntervalFor(null, NOW), 0);
});

test("activity is the newest of the inputs, so a new flow wakes an old post", () => {
  const oldComment = new Date(NOW - 40 * DAY).toISOString();
  const flowAttachedToday = new Date(NOW - 1 * DAY).toISOString();
  const activity = lastActivityAt([oldComment, undefined, null, "not a date", flowAttachedToday]);
  assert.equal(activity, NOW - 1 * DAY);
  assert.equal(pollIntervalFor(activity, NOW), 0);
});

test("Instagram's +0000 offsets parse", () => {
  assert.equal(lastActivityAt(["2026-10-04T12:00:00+0000"]), NOW);
});

test("nothing parseable gives null", () => {
  assert.equal(lastActivityAt([]), null);
  assert.equal(lastActivityAt([undefined, "", "garbage"]), null);
});

test("a resting post comes due on the tick its interval elapses", () => {
  assert.equal(isDue(undefined, 60 * MIN, NOW), true, "never polled since restart");
  assert.equal(isDue(NOW - 14 * MIN, 15 * MIN, NOW), false);
  assert.equal(isDue(NOW - 15 * MIN, 15 * MIN, NOW), true);
  assert.equal(isDue(NOW - 1 * MIN, 0, NOW), true, "active posts are always due");
});
