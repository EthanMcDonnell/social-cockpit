/**
 * Slug selection, end to end against real SQLite stores.
 *
 * The selector is the part of slug scheduling with no user in the loop: it runs
 * at 3am and whatever it returns is what goes out. So this exercises the actual
 * modules rather than a description of their rules.
 */

import assert from "node:assert/strict";
import { writeFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { loadLib } from "./helpers/lib-under-test.mjs";

const { load, mediaRoot, cleanup } = loadLib(["src/lib/slugs/**/*.ts"]);
const store = load("lib/slugs/store.js");
const sched = load("lib/schedule/store.js");
const select = load("lib/slugs/select.js");
const settings = load("lib/slugs/settings.js");
const cache = load("lib/cache/store.js");
const { getDb } = load("lib/db/index.js");

function clip(name) {
  const file = path.join(mediaRoot, name);
  writeFileSync(file, "not really a video");
  return file;
}

const SLUG = "gym-tips";
let a;
let b;
let c;

test("a pool is built by enrolment, and enrolment is idempotent", async () => {
  a = await store.enrolVideo({ slug: "Gym Tips!", path: clip("a.mp4"), label: "A" });
  assert.equal(a.slug, SLUG, "the slug is normalised on the way in");

  const again = await store.enrolVideo({ slug: SLUG, path: a.path });
  assert.equal(again.id, a.id, "re-enrolling a path must not clone the candidate");

  b = await store.enrolVideo({ slug: SLUG, path: clip("b.mp4"), label: "B" });
  c = await store.enrolVideo({ slug: SLUG, path: clip("c.mp4"), label: "C" });
  assert.equal(store.listVideos(SLUG).length, 3);
});

test("a pool with no metrics still picks, in add order", async () => {
  const pick = await select.selectVideo({ slug: SLUG, platform: "ig", method: "most_views" });
  assert.ok(!("error" in pick), "a brand-new slug must still fire on its first slot");
  assert.equal(pick.video.id, a.id);
  assert.match(pick.reason, /no candidate had metrics/);
});

test("metric methods rank on the posts a candidate already has", async () => {
  store.recordPost(a.id, "ig", "ig-a");
  store.recordPost(b.id, "ig", "ig-b");
  cache.upsertMediaInsights("ig-a", { views: 500, total_interactions: 50 });
  cache.upsertMediaInsights("ig-b", { views: 9000, total_interactions: 180 });

  const most = await select.selectVideo({ slug: SLUG, platform: "yt", method: "most_views" });
  assert.equal(most.video.id, b.id, "9k beats 500");

  const engaged = await select.selectVideo({ slug: SLUG, platform: "yt", method: "most_engagement" });
  assert.equal(engaged.video.id, a.id, "10% beats 2%, regardless of raw views");

  const least = await select.selectVideo({ slug: SLUG, platform: "yt", method: "least_views" });
  assert.equal(least.video.id, a.id);
});

test("a candidate already posted to a platform is out of that platform's pool", async () => {
  const pick = await select.selectVideo({ slug: SLUG, platform: "ig", method: "most_views" });
  assert.equal(pick.video.id, c.id, "A and B already ran on Instagram");
  assert.equal(pick.considered, 1);
});

test("the pool drains per platform, and reports exhaustion", async () => {
  store.recordPost(c.id, "ig", "ig-c");

  const blocked = await select.selectVideo({ slug: SLUG, platform: "ig", method: "most_views" });
  assert.ok(blocked.error && blocked.exhausted, "an exhausted pool must say so");

  const yt = await select.selectVideo({ slug: SLUG, platform: "yt", method: "most_views" });
  assert.equal(yt.video.id, b.id, "draining Instagram must not drain YouTube");
});

test("a candidate whose file has vanished is skipped, not fatal", async () => {
  unlinkSync(b.path);
  const pick = await select.selectVideo({ slug: SLUG, platform: "yt", method: "most_views" });
  assert.equal(pick.video.id, a.id);
});

test("add-order methods are deterministic within the same second", async () => {
  const oldest = await select.selectVideo({ slug: SLUG, platform: "yt", method: "oldest_unposted" });
  const newest = await select.selectVideo({ slug: SLUG, platform: "yt", method: "newest" });
  assert.equal(oldest.video.id, a.id);
  assert.equal(newest.video.id, c.id);
});

test("the method resolves job → slug → default", async () => {
  assert.equal(settings.resolveSelectionMethod(SLUG), "most_views");

  store.updateSlug(SLUG, { selection_method: "newest" });
  assert.equal(settings.resolveSelectionMethod(SLUG), "newest", "a slug override beats the default");
  assert.equal(settings.resolveSelectionMethod(SLUG, "random"), "random", "the job beats the slug");
});

test("a pool holds videos, and says so when handed something else", async () => {
  const photo = path.join(mediaRoot, "thumb.jpg");
  writeFileSync(photo, "not a video");
  await assert.rejects(
    () => store.enrolVideo({ slug: SLUG, path: photo }),
    /holds videos/,
    "a photo in a video pool would fail at publish time instead"
  );

  const junk = path.join(mediaRoot, "notes.txt");
  writeFileSync(junk, "hello");
  await assert.rejects(() => store.enrolVideo({ slug: SLUG, path: junk }), /holds videos/);
});

test("a candidate another slot is mid-publish on is not picked again", async () => {
  const pool = "reserve-test";
  const first = await store.enrolVideo({ slug: pool, path: clip("r1.mp4"), label: "R1" });
  const second = await store.enrolVideo({ slug: pool, path: clip("r2.mp4"), label: "R2" });

  const before = await select.selectVideo({ slug: pool, platform: "ig", method: "oldest_unposted" });
  assert.equal(before.video.id, first.id);

  // A job that has picked R1 but has not published it yet: the ledger row that
  // would take it out of the pool does not exist, and cannot until the post is
  // live. Without a reservation both slots would post the same video.
  const job = sched.createJob({
    platform: "ig",
    scheduledAt: Date.now() + 60_000,
    payload: {},
    media: [],
    contentSlug: pool,
  });
  sched.updateJob(job.id, { status: "publishing", result: { slug_video_id: first.id } });

  const during = await select.selectVideo({ slug: pool, platform: "ig", method: "oldest_unposted" });
  assert.equal(during.video.id, second.id, "R1 is spoken for");
  assert.equal(during.considered, 1);
  assert.equal(
    store.eligibleVideos(pool, "ig").length,
    1,
    "the count the UI shows must agree with what the selector would do"
  );

  // A job that picked and then *failed* never posted, so its candidate comes back.
  sched.updateJob(job.id, { status: "failed" });
  const after = await select.selectVideo({ slug: pool, platform: "ig", method: "oldest_unposted" });
  assert.equal(after.video.id, first.id, "a failed pick must not retire a candidate");
});

test("a ledger write against a removed candidate is refused, not stranded", async () => {
  const pool = "gone-test";
  const video = await store.enrolVideo({ slug: pool, path: clip("g1.mp4") });
  assert.equal(store.recordPost(video.id, "ig", "ig-g1"), true);

  store.removeVideo(video.id);
  assert.equal(
    store.recordPost(video.id, "ig", "ig-g2"),
    false,
    "the caller needs to know, so it can re-enrol rather than write into nothing"
  );
});

test("an empty pool is reported differently from an exhausted one", async () => {
  store.ensureSlug("brand-new");
  const none = await select.selectVideo({ slug: "brand-new", platform: "ig", method: "most_views" });
  assert.ok(none.error && !none.exhausted);
});

test("a slug that only names an automation flow is listed as an empty pool", async () => {
  // The state every existing install starts in: keys have been in use on the
  // automation side for months, and content_slugs is brand new and empty.
  getDb()
    .prepare(
      `INSERT INTO automation_flows (id, name, template_type, trigger_keyword, config, is_active, automation_key)
       VALUES ('flow-1', 'Watermark funnel', 'comment_to_dm', '["LINK"]', '{}', 1, 'legacy-key')`
    )
    .run();

  const listed = store.listSlugs().find((entry) => entry.slug === "legacy-key");
  assert.ok(listed, "listing only content_slugs would hide a slug already in use");
  assert.equal(listed.video_count, 0);
  assert.equal(listed.automation.name, "Watermark funnel");

  assert.ok(store.getSlugOrLinked("legacy-key"), "and its pool page has to open");
  assert.equal(store.getSlug("legacy-key"), null, "without inventing a row nobody asked for");

  // Filling it is what makes it a pool of its own.
  await store.enrolVideo({ slug: "legacy-key", path: clip("legacy.mp4") });
  assert.ok(store.getSlug("legacy-key"), "enrolment creates the record");
  assert.equal(
    store.listSlugs().filter((entry) => entry.slug === "legacy-key").length,
    1,
    "and it must not then appear twice, once from each facet"
  );
});

test.after(cleanup);
