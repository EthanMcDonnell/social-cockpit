/**
 * Promoting a slug's best trial reel to the main feed.
 *
 * A slug is one video's hooks. Every hook runs as a trial reel; one of them —
 * the one that earned it — then goes to followers. This covers the three places
 * that has to hold: the ledger knows trial from feed, the selector picks among
 * trials, and booking refuses a second feed post for the same slug.
 */

import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { loadLib, stampIntegrityMigration } from "./helpers/lib-under-test.mjs";

process.env.SCHEDULE_DRY_RUN = "true";
process.env.SCHEDULER_ENABLED = "true";

const { load, reload, mediaRoot, cleanup } = loadLib([
  "src/lib/slugs/**/*.ts",
  "src/lib/schedule/**/*.ts",
]);
const { getDb } = load("lib/db/index.js");
const store = load("lib/slugs/store.js");
const select = load("lib/slugs/select.js");
const cache = load("lib/cache/store.js");
const sched = load("lib/schedule/store.js");
const input = load("lib/schedule/input.js");
const worker = load("lib/schedule/worker.js");

stampIntegrityMigration(getDb());

function clip(name) {
  const file = path.join(mediaRoot, name);
  writeFileSync(file, "not really a video");
  return file;
}

const due = () => Date.now() - 1000;
const later = () => new Date(Date.now() + 86_400_000).toISOString();
const SLUG = "hooks";
let a;
let b;
let c;

test("the ledger records whether an Instagram post was a trial", async () => {
  a = await store.enrolVideo({ slug: SLUG, path: clip("a.mp4"), label: "A", payload: { ig: { caption: "hook a" } } });
  b = await store.enrolVideo({ slug: SLUG, path: clip("b.mp4"), label: "B" });
  c = await store.enrolVideo({ slug: SLUG, path: clip("c.mp4"), label: "C" });

  store.recordPost(a.id, "ig", "ig-a", undefined, true);
  store.recordPost(b.id, "ig", "ig-b", undefined, true);
  store.recordPost(b.id, "yt", "yt-b", undefined, true);

  assert.equal(store.getVideo(a.id).posts[0].trial, true);
  assert.equal(store.getVideo(b.id).posts.find((p) => p.platform === "yt").trial, undefined,
    "trial is an Instagram idea; a YouTube row never carries it");
  assert.equal(store.postedToFeed(store.getVideo(a.id)), false);
});

test("a promotion picks the best trial reel, never an untried hook", async () => {
  cache.upsertMediaInsights("ig-a", { views: 900, total_interactions: 10 });
  cache.upsertMediaInsights("ig-b", { views: 15000, total_interactions: 200 });

  const pick = await select.selectVideo({ slug: SLUG, platform: "ig", method: "most_views", promote: true });
  assert.ok(!("error" in pick), pick.error);
  assert.equal(pick.video.id, b.id, "15k beats 900");
  assert.equal(pick.considered, 2, "C has not run as a trial, so it is not a candidate");

  const ordinary = await select.selectVideo({ slug: SLUG, platform: "ig", method: "most_views" });
  assert.equal(ordinary.video.id, c.id, "an ordinary slot still drains the untried hooks");
});

test("a slug with nothing trialled has nothing to promote", async () => {
  await store.enrolVideo({ slug: "fresh", path: clip("fresh.mp4") });
  const pick = await select.selectVideo({ slug: "fresh", platform: "ig", method: "most_views", promote: true });
  assert.match(pick.error, /nothing to promote/);
});

test("booking a promotion: Instagram, slug-only, never a trial", async () => {
  const yt = await input.parseScheduleBody({ scheduled_at: later(), platform: "yt", slug: SLUG, is_promote: true });
  assert.equal(yt.code, "invalid_param");

  const noSlug = await input.parseScheduleBody({ scheduled_at: later(), is_promote: true });
  assert.equal(noSlug.code, "missing_param");

  const withFile = await input.parseScheduleBody({
    scheduled_at: later(), slug: SLUG, is_promote: true, video_path: a.path,
  });
  assert.equal(withFile.code, "invalid_param");

  const ok = await input.parseScheduleBody({
    scheduled_at: later(), slug: SLUG, is_promote: true,
    trial_params: { graduation_strategy: "MANUAL" },
  });
  assert.ok(!("error" in ok), ok.error);
  assert.equal(ok.job.isPromote, true);
  assert.equal(ok.job.payload.trial_params, undefined, "a promotion is the feed post, not another trial");
});

test("a second feed slot for the same slug is refused at booking", async () => {
  const first = await input.parseScheduleBody({ scheduled_at: later(), slug: SLUG, is_promote: true });
  sched.createJob(first.job);

  const second = await input.parseScheduleBody({ scheduled_at: later(), slug: SLUG, is_promote: true });
  assert.equal(second.code, "feed_taken");
  assert.equal(second.status, 409);

  const plainFeed = await input.parseScheduleBody({ scheduled_at: later(), slug: SLUG, video_path: c.path });
  assert.equal(plainFeed.code, "feed_taken", "a file booked to the feed counts too");

  const trial = await input.parseScheduleBody({
    scheduled_at: later(), slug: SLUG, video_path: c.path,
    trial_params: { graduation_strategy: "MANUAL" },
  });
  assert.ok(!("error" in trial), "more trial reels are always fine");

  const otherSlug = await input.parseScheduleBody({ scheduled_at: later(), slug: "other", is_promote: true });
  assert.ok(!("error" in otherSlug), "the rule is per slug");
});

test("the worker publishes the promoted hook without trial_params", async () => {
  // Clear the pending promotion booked above so this one is the slug's only feed job.
  getDb().prepare("DELETE FROM scheduled_posts WHERE slug = ?").run(SLUG);

  const job = sched.createJob({
    platform: "ig",
    scheduledAt: due(),
    payload: { trial_params: { graduation_strategy: "MANUAL" } },
    media: [],
    slug: SLUG,
    isPromote: true,
    selectionMethod: "most_views",
  });
  await worker.runScheduleCycle();

  const done = sched.getJob(job.id);
  assert.equal(done.status, "published", done.result?.error);
  assert.equal(done.is_promote, true);
  assert.equal(done.result.slug_video_id, b.id);
  assert.equal(done.payload.trial_params, undefined, "followers see it: no trial_params");
});

test("once a slug has its feed post, promotion and feed booking both stop", async () => {
  store.recordPost(b.id, "ig", "ig-b-feed", undefined, false);

  const pick = await select.selectVideo({ slug: SLUG, platform: "ig", method: "most_views", promote: true });
  assert.match(pick.error, /already has its feed post/);
  assert.equal(pick.exhausted, true);

  getDb().prepare("DELETE FROM scheduled_posts WHERE slug = ?").run(SLUG);
  const again = await input.parseScheduleBody({ scheduled_at: later(), slug: SLUG, is_promote: true });
  assert.equal(again.code, "feed_taken", "the ledger alone is enough to refuse it");
});

test("on startup, posts recorded before tracking are backfilled from their jobs", () => {
  const db = getDb();
  const trialJob = sched.createJob({
    platform: "ig", scheduledAt: due(), media: [], slug: "legacy",
    payload: { trial_params: { graduation_strategy: "MANUAL" } },
  });
  const feedJob = sched.createJob({ platform: "ig", scheduledAt: due(), media: [], slug: "legacy", payload: {} });
  db.prepare("INSERT INTO slug_videos (id, slug, path) VALUES ('lv', 'legacy', '/x.mp4')").run();
  db.prepare("INSERT INTO slug_video_posts (video_id, platform, external_id, job_id) VALUES ('lv', 'ig', 't', ?)").run(trialJob.id);
  db.prepare("INSERT INTO slug_video_posts (video_id, platform, external_id, job_id) VALUES ('lv', 'ig', 'f', ?)").run(feedJob.id);
  db.prepare("INSERT INTO slug_video_posts (video_id, platform, external_id) VALUES ('lv', 'ig', 'u')").run();

  // Reopening the database replays the schema list — what a restart does.
  const reopened = reload("lib/db/index.js").getDb();

  const trials = Object.fromEntries(
    reopened.prepare("SELECT external_id, trial FROM slug_video_posts WHERE video_id = 'lv'").all()
      .map((r) => [r.external_id, r.trial])
  );
  assert.deepEqual(trials, { t: 1, f: 0, u: null }, "no job to read means unknown, not a guess");
});

test.after(cleanup);
