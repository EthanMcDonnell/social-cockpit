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
const media = load("lib/schedule/media.js");
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

/**
 * The three tests below are one bug, seen from both ends: terminal cleanup used
 * to delete a failed job's staged rows while leaving the job pointing at them,
 * so every retry died on the missing reference rather than on whatever actually
 * failed — and a slug job, whose re-pick only ran when it had no media at all,
 * could never get out.
 */

test("terminal cleanup keeps a reference it does not own", async () => {
  const staged = await media.registerLocalPath(clip("referenced.mp4"));
  const job = sched.createJob({
    platform: "yt",
    scheduledAt: due(),
    status: "failed",
    payload: { title: "R" },
    media: [{ role: "video", staged_id: staged.id }],
  });
  sched.updateJob(job.id, { result: { error: "token revoked", error_kind: "auth" } });

  await worker.runScheduleCycle();

  const after = sched.getJob(job.id);
  assert.equal(after.result.cleanup_done, true, "cleanup ran");
  assert.ok(media.getStagedMedia(staged.id), "the user's own file is not ours to deregister");
  assert.equal(after.media.length, 1, "so the job keeps pointing at it, and can be re-run");
});

test("terminal cleanup drops an owned copy, and the reference with it", async () => {
  const owned = await media.stageUpload(new Blob(["not really a video"]).stream(), {
    filename: "owned.mp4",
  });
  const job = sched.createJob({
    platform: "yt",
    scheduledAt: due(),
    status: "failed",
    payload: { title: "O" },
    media: [{ role: "video", staged_id: owned.id }],
  });
  sched.updateJob(job.id, { result: { error: "boom", error_kind: "invalid_param" } });

  await worker.runScheduleCycle();

  const after = sched.getJob(job.id);
  assert.equal(media.getStagedMedia(owned.id), null, "an owned copy costs disk and goes");
  assert.equal(after.media.length, 0, "and the job is never left holding the dead reference");
});

test("a slug job whose media has vanished re-picks instead of failing on it", async () => {
  const video = await store.enrolVideo({ slug: "revive", path: clip("revive.mp4"), label: "V" });
  const stale = await media.registerLocalPath(clip("stale.mp4"));
  const job = sched.createJob({
    platform: "yt",
    scheduledAt: due(),
    payload: {},
    media: [{ role: "video", staged_id: stale.id }],
    slug: "revive",
  });
  // Exactly the state the old cleanup left behind: a reference to nothing.
  await media.releaseStaged([stale.id]);

  await worker.runScheduleCycle();

  const done = sched.getJob(job.id);
  assert.equal(done.status, "published", done.result?.error);
  assert.equal(done.result.slug_video_id, video.id, "the pool decided it again, at fire time");
});

test.after(cleanup);
