/**
 * A slug job through the scheduler worker, in dry run.
 *
 * The unit this covers is the hand-off: a job booked with no media at all has
 * to become an ordinary job — file chosen, payload filled, row rewritten —
 * before the unchanged publish path ever sees it. Dry run exercises every state
 * transition without an R2 upload or a platform call.
 */

import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { loadLib, stampIntegrityMigration } from "./helpers/lib-under-test.mjs";

process.env.SCHEDULE_DRY_RUN = "true";
process.env.SCHEDULER_ENABLED = "true";

const { load, mediaRoot, cleanup } = loadLib([
  "src/lib/slugs/**/*.ts",
  "src/lib/schedule/**/*.ts",
]);
const { getDb } = load("lib/db/index.js");
const store = load("lib/slugs/store.js");
const cache = load("lib/cache/store.js");
const sched = load("lib/schedule/store.js");
const worker = load("lib/schedule/worker.js");

stampIntegrityMigration(getDb());

function clip(name) {
  const file = path.join(mediaRoot, name);
  writeFileSync(file, "not really a video");
  return file;
}

const due = () => Date.now() - 1000;
let a;
let b;

test("the fixture's worker is actually enabled", () => {
  assert.equal(worker.schedulerEnabled(), true);
});

test("a job booked against a pool resolves its video at fire time", async () => {
  a = await store.enrolVideo({
    slug: "pool",
    path: clip("a.mp4"),
    label: "A",
    payload: { ig: { caption: "from the pool" } },
  });
  b = await store.enrolVideo({ slug: "pool", path: clip("b.mp4"), label: "B" });

  // B has run on Instagram and has the numbers to prove it — so it is the
  // most-viewed candidate, and simultaneously ineligible for Instagram.
  store.recordPost(b.id, "ig", "ig-b");
  cache.upsertMediaInsights("ig-b", { views: 5000, total_interactions: 100 });

  const job = sched.createJob({
    platform: "yt",
    scheduledAt: due(),
    payload: {},
    media: [],
    slug: "pool",
    selectionMethod: "most_views",
  });
  assert.equal(job.media.length, 0, "a slug job is booked with no media");

  await worker.runScheduleCycle();

  const done = sched.getJob(job.id);
  assert.equal(done.status, "published", done.result?.error);
  assert.equal(done.result.slug_video_id, b.id, "most_views picks the 5k video");
  assert.equal(done.media.length, 1, "the chosen file is written back onto the job");
  assert.equal(done.payload.title, "B", "a YouTube job always ends up with a title");

  const kinds = sched.listScheduleEvents({ jobId: job.id }).map((e) => e.kind);
  assert.ok(kinds.includes("slug_resolved"), `expected slug_resolved in ${kinds.join(", ")}`);
});

test("a dry run picks but records nothing", () => {
  assert.equal(
    store.getVideo(b.id).posts.length,
    1,
    "recording a stub media id would retire a candidate that never posted"
  );
});

test("the same pool on another platform has its own eligibility", async () => {
  const job = sched.createJob({
    platform: "ig",
    scheduledAt: due(),
    payload: {},
    media: [],
    slug: "pool",
  });
  await worker.runScheduleCycle();

  const done = sched.getJob(job.id);
  assert.equal(done.status, "published", done.result?.error);
  assert.equal(done.result.slug_video_id, a.id, "B has already run on Instagram");
  assert.equal(done.payload.media_type, "REELS", "a pool holds videos");
  assert.equal(done.payload.caption, "from the pool", "the candidate's stored caption fills in");
});

test("an exhausted pool fails the job terminally", async () => {
  store.recordPost(a.id, "ig", "ig-a");

  const job = sched.createJob({
    platform: "ig",
    scheduledAt: due(),
    payload: {},
    media: [],
    slug: "pool",
  });
  await worker.runScheduleCycle();

  const done = sched.getJob(job.id);
  assert.equal(done.status, "failed");
  assert.equal(done.result.error_kind, "no_candidate");
  assert.equal(done.attempts, 1, "waiting will not conjure a video — this is not retryable");
  assert.match(done.result.error, /already been posted to Instagram/);
});

test.after(cleanup);
