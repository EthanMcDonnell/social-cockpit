/**
 * Reposting, end to end against real SQLite stores.
 *
 * The rules here decide, unattended, that a video the user made months ago goes
 * back out to an audience — and that another one never will again. Both are
 * expensive to get wrong in a way nobody notices, so this exercises the actual
 * modules rather than a description of what they are supposed to do.
 *
 * The property under most of these tests is the one the whole design turns on:
 * **"I have not enabled this" and "this underperformed" are different states**,
 * stored in different places, and neither may ever be produced by the other.
 */

import assert from "node:assert/strict";
import { writeFileSync, existsSync, unlinkSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { loadLib } from "./helpers/lib-under-test.mjs";

const { load, mediaRoot, cleanup } = loadLib([
  "src/lib/slugs/**/*.ts",
  "src/lib/repost/**/*.ts",
  "src/lib/archive/**/*.ts",
  "src/lib/schedule/**/*.ts",
]);

const archive = load("lib/archive/store.js");
const store = load("lib/slugs/store.js");
const repost = load("lib/repost/store.js");
const candidates = load("lib/repost/candidates.js");
const settings = load("lib/repost/settings.js");
const evaluate = load("lib/repost/evaluate.js");
const select = load("lib/slugs/select.js");
const publish = load("lib/repost/publish.js");
const cache = load("lib/cache/store.js");

const DAY_MS = 24 * 60 * 60 * 1000;

function clip(name, contents = name) {
  const file = path.join(mediaRoot, name);
  writeFileSync(file, contents);
  return file;
}

/**
 * Publish a video for real, as the worker's post-publish path does: archive the
 * bytes, enrol the file, link the two, and record the post it became.
 */
async function published(slug, name, { views, contents } = {}) {
  const file = clip(name, contents);
  const archived = await archive.archiveVideo({ path: file, slug, label: name });
  const video = await store.enrolVideo({ slug, path: file, archiveId: archived.id });
  const mediaId = `ig-${name}`;
  store.recordPost(video.id, "ig", mediaId);
  if (views !== undefined) {
    cache.upsertMediaInsights(mediaId, { views, total_interactions: Math.round(views / 20) });
  }
  return { archived, video, mediaId, file };
}

/** Move a repost's evaluation deadline into the past so a pass will pick it up. */
function makeDue(eventId) {
  const { getDb } = load("lib/db/index.js");
  getDb().prepare("UPDATE repost_events SET evaluate_after = 0 WHERE id = ?").run(eventId);
}

test.after(() => cleanup());

// ─── The archive ─────────────────────────────────────────────────────────────

test("the archive keeps a copy, and identifies it by content rather than path", async () => {
  const first = await archive.archiveVideo({ path: clip("keep.mp4", "same bytes"), slug: "evergreen" });

  assert.ok(existsSync(first.path), "the copy has to actually exist on disk");
  assert.notEqual(first.path, path.join(mediaRoot, "keep.mp4"), "it must not just point at the original");

  // The same content published again from a different path is one archived
  // video — otherwise a clip copied around the user's disk would get two turns
  // in the rotation.
  const again = await archive.archiveVideo({ path: clip("moved.mp4", "same bytes"), slug: "evergreen" });
  assert.equal(again.id, first.id, "identical bytes must resolve to one archived video");
  assert.equal(archive.listArchived().filter((v) => v.sha256 === first.sha256).length, 1);
});

test("a candidate survives its original file being deleted", async () => {
  const file = clip("fragile.mp4", "fragile bytes");
  const archived = await archive.archiveVideo({ path: file, slug: "evergreen" });
  const video = await store.enrolVideo({ slug: "evergreen", path: file, archiveId: archived.id });

  assert.equal(store.isMissing(store.getVideo(video.id)), false);

  unlinkSync(file);
  assert.equal(
    store.isMissing(store.getVideo(video.id)),
    false,
    "with an archived copy, a moved original must not retire the candidate"
  );
  assert.equal(store.sourcePathOf(store.getVideo(video.id)), archived.path);
});

// ─── Opt-in ──────────────────────────────────────────────────────────────────

test("reposting is off until a slug is explicitly opted in", async () => {
  await published("evergreen", "strong.mp4", { views: 50_000 });

  let pool = await candidates.repostCandidates("ig");
  const before = pool.find((c) => c.label === "strong.mp4");
  assert.equal(before.eligible, false);
  assert.equal(before.why, "not_enabled", "the default must be opt-OUT, whatever the numbers say");
  assert.equal(before.block, undefined, "not being enabled must never look like a block");

  store.updateSlug("evergreen", { repost_eligible: true });

  pool = await candidates.repostCandidates("ig");
  const after = pool.find((c) => c.label === "strong.mp4");
  assert.equal(after.eligible, true);
  assert.equal(after.tier, 1, "never reposted means tier 1");
});

test("a time-dependent slug is excluded simply by never being enabled", async () => {
  await published("weekly-update", "update-42.mp4", { views: 80_000 });

  const pool = await candidates.repostCandidates("ig");
  const update = pool.find((c) => c.label === "update-42.mp4");
  assert.equal(update.eligible, false);
  assert.equal(update.why, "not_enabled");
  assert.equal(update.slug, "weekly-update");
});

// ─── Thresholds ──────────────────────────────────────────────────────────────

test("a video below the view threshold never qualifies", async () => {
  store.updateSlug("evergreen", { repost_eligible: true });
  await published("evergreen", "weak.mp4", { views: 900 });

  const pool = await candidates.repostCandidates("ig");
  const weak = pool.find((c) => c.label === "weak.mp4");
  assert.equal(weak.eligible, false);
  assert.equal(weak.why, "below_min_views");
  assert.equal(settings.getMinViews(), 20_000, "the documented default");
});

test("the threshold is configurable and takes effect immediately", async () => {
  settings.setMinViews(500);
  let pool = await candidates.repostCandidates("ig");
  assert.equal(pool.find((c) => c.label === "weak.mp4").eligible, true);

  settings.setMinViews(20_000);
  pool = await candidates.repostCandidates("ig");
  assert.equal(pool.find((c) => c.label === "weak.mp4").eligible, false);
});

// ─── Ordering ────────────────────────────────────────────────────────────────

test("tier 1 is fully drained before anything is repeated", async () => {
  store.updateSlug("evergreen", { repost_eligible: true });
  const huge = await published("evergreen", "huge.mp4", { views: 400_000 });
  await published("evergreen", "mid.mp4", { views: 30_000 });

  // Give the big one a repost, long enough ago that its rest period has passed.
  const event = repost.recordRepost({
    archiveId: huge.archived.id,
    slug: "reposts",
    platform: "ig",
    externalId: "ig-huge-repost",
    evaluateAfter: 0,
  });
  const { getDb } = load("lib/db/index.js");
  getDb()
    .prepare("UPDATE repost_events SET posted_at = ?, views = ?, outcome = 'ok' WHERE id = ?")
    .run(new Date(Date.now() - 400 * DAY_MS).toISOString(), 25_000, event.id);

  const ranked = candidates.rankCandidates(await candidates.repostCandidates("ig"));

  const huge_ = ranked.find((c) => c.label === "huge.mp4");
  const mid = ranked.find((c) => c.label === "mid.mp4");
  assert.equal(huge_.tier, 2, "already reposted, and rested");
  assert.equal(mid.tier, 1, "never reposted");
  assert.ok(
    ranked.indexOf(mid) < ranked.indexOf(huge_),
    "a 30k video that has never been reposted must outrank a rested 400k one"
  );
  assert.equal(ranked[0].tier, 1, "the pick is always tier 1 while tier 1 has anything in it");
});

test("a video that has been reposted too recently is resting, not blocked", async () => {
  const fresh = await published("evergreen", "fresh.mp4", { views: 90_000 });
  repost.recordRepost({
    archiveId: fresh.archived.id,
    slug: "reposts",
    platform: "ig",
    externalId: "ig-fresh-repost",
    evaluateAfter: Date.now() + DAY_MS,
  });

  const pool = await candidates.repostCandidates("ig");
  const resting = pool.find((c) => c.label === "fresh.mp4");
  assert.equal(resting.eligible, false);
  assert.equal(resting.why, "resting");
  assert.equal(resting.block, undefined, "resting must never be reported as a block");
});

// ─── The under-1k rule ───────────────────────────────────────────────────────

test("a repost under the threshold retires its video, with the reason attached", async () => {
  store.updateSlug("evergreen", { repost_eligible: true });
  const flop = await published("evergreen", "flop.mp4", { views: 120_000 });

  const event = repost.recordRepost({
    archiveId: flop.archived.id,
    slug: "reposts",
    platform: "ig",
    externalId: "ig-flop-repost",
    evaluateAfter: Date.now() + DAY_MS,
  });

  cache.upsertMediaInsights("ig-flop-repost", { views: 412, total_interactions: 9 });
  makeDue(event.id);

  const summary = await evaluate.evaluateReposts(Date.now());
  assert.equal(summary.blocked, 1);

  const block = repost.getBlock(flop.archived.id);
  assert.ok(block, "a flop must produce a block");
  assert.equal(block.views, 412, "the block records the figure that caused it");
  assert.match(block.reason, /412/, "and states it, so the block explains itself");

  const pool = await candidates.repostCandidates("ig");
  const blocked = pool.find((c) => c.label === "flop.mp4");
  assert.equal(blocked.eligible, false);
  assert.equal(blocked.why, "blocked");
  assert.equal(blocked.slug_enabled, true, "its slug is still opted in — the block is the video's");
});

test("a repost that clears the threshold is not blocked", async () => {
  const ok = await published("evergreen", "ok.mp4", { views: 200_000 });
  const event = repost.recordRepost({
    archiveId: ok.archived.id,
    slug: "reposts",
    platform: "ig",
    externalId: "ig-ok-repost",
    evaluateAfter: Date.now() + DAY_MS,
  });

  cache.upsertMediaInsights("ig-ok-repost", { views: 8_400, total_interactions: 300 });
  makeDue(event.id);
  await evaluate.evaluateReposts(Date.now());

  assert.equal(repost.getBlock(ok.archived.id), null);
  assert.equal(repost.getRepostEvent(event.id).outcome, "ok");
});

test("a repost with no insights yet is deferred, never judged as zero", async () => {
  const quiet = await published("evergreen", "quiet.mp4", { views: 150_000 });
  const event = repost.recordRepost({
    archiveId: quiet.archived.id,
    slug: "reposts",
    platform: "ig",
    externalId: "ig-never-synced",
    evaluateAfter: Date.now() + DAY_MS,
  });

  makeDue(event.id);
  const summary = await evaluate.evaluateReposts(Date.now());

  assert.equal(summary.deferred, 1);
  assert.equal(summary.blocked, 0, "a cache miss must never retire a video");
  assert.equal(repost.getBlock(quiet.archived.id), null);
  assert.equal(repost.getRepostEvent(event.id).outcome, "pending");
});

// ─── The two states stay apart ───────────────────────────────────────────────

test("turning a slug off never writes a block, and unblocking never touches the slug", async () => {
  const subject = await published("evergreen", "distinct.mp4", { views: 300_000 });

  store.updateSlug("evergreen", { repost_eligible: false });
  assert.equal(
    repost.getBlock(subject.archived.id),
    null,
    "opting out is a decision, and must not be recorded as a performance verdict"
  );

  store.updateSlug("evergreen", { repost_eligible: true });
  repost.blockVideo(subject.archived.id, "Repost reached 200 views", 200);

  const pool = await candidates.repostCandidates("ig");
  const blocked = pool.find((c) => c.label === "distinct.mp4");
  assert.equal(blocked.why, "blocked");
  assert.equal(blocked.slug_enabled, true, "the slug's own flag is untouched by a block");

  repost.unblockVideo(subject.archived.id);
  assert.equal(store.getSlug("evergreen").repost_eligible, true, "unblocking must not alter the opt-in");
  assert.equal(repost.getBlock(subject.archived.id), null);
});

// ─── Publishing ──────────────────────────────────────────────────────────────

test("a repost is always a trial reel promoted by hand", () => {
  assert.equal(publish.REPOST_GRADUATION_STRATEGY, "MANUAL");

  // Including when the payload it inherits says otherwise — the original may
  // itself have been published as an auto-graduating trial.
  const forced = publish.asTrialRepost({
    caption: "hello",
    trial_params: { graduation_strategy: "SS_PERFORMANCE" },
  });
  assert.deepEqual(forced.trial_params, { graduation_strategy: "MANUAL" });
  assert.equal(forced.caption, "hello", "the rest of the payload is left alone");
});

test("selecting from a repost-mode slug returns an archived video, marked as a repost", async () => {
  store.ensureSlug("reposts");
  store.updateSlug("reposts", { mode: "repost" });
  store.updateSlug("evergreen", { repost_eligible: true });

  const pick = await select.selectVideo({ slug: "reposts", platform: "ig", method: "most_views" });

  assert.ok(!("error" in pick), `a configured repost pool should produce a pick: ${pick.error ?? ""}`);
  assert.ok(pick.repost, "the selection must be flagged as a repost");
  assert.ok(pick.repost.archive_id);
  assert.equal(pick.video.missing, false);
  assert.ok(
    pick.video.path.includes("archive"),
    "a repost publishes the archived copy — the exact bytes that earned the numbers"
  );
});

test("an empty repost pool explains which rule emptied it", async () => {
  store.ensureSlug("nothing-enabled");
  store.updateSlug("nothing-enabled", { mode: "repost" });
  store.updateSlug("evergreen", { repost_eligible: false });

  const pick = await select.selectVideo({
    slug: "nothing-enabled",
    platform: "ig",
    method: "most_views",
  });

  assert.ok("error" in pick);
  assert.match(
    pick.error,
    /not enabled for reposting/i,
    "the actionable reason wins: the user can turn a slug on"
  );

  store.updateSlug("evergreen", { repost_eligible: true });
});

test("a repost pool reports the archive's counts, not its own empty video list", async () => {
  store.ensureSlug("reposts");
  store.updateSlug("reposts", { mode: "repost" });
  store.updateSlug("evergreen", { repost_eligible: true });

  // The bug this pins: a repost slug has no `slug_videos` rows, so anything
  // counting them reports "0 videos, 0 eligible" directly above a `next_up`
  // naming the video it is about to publish.
  assert.equal(store.listVideos("reposts").length, 0, "a repost pool holds no rows of its own");

  const view = await candidates.viewRepostPool("reposts", "ig");
  assert.ok(view.candidates.length > 0, "its members come from the archive");
  assert.ok(view.tier1 + view.tier2 > 0, "and at least one of them can actually run");

  const pick = await select.selectVideo({ slug: "reposts", platform: "ig", method: "most_views" });
  assert.ok(!("error" in pick), "so the counts and the pick have to agree");
});

test("the pool separates awaiting-opt-in from retired in its own counts", async () => {
  store.ensureSlug("never-enabled");
  await published("never-enabled", "unopted.mp4", { views: 70_000 });

  const view = await candidates.viewRepostPool("reposts", "ig");
  assert.ok(view.awaiting_optin > 0, "a slug that was never enabled is counted as such");
  assert.ok(
    view.candidates.some((c) => c.why === "not_enabled" && !c.block),
    "and carries no block, because nobody measured anything about it"
  );
});

// ─── Settings ────────────────────────────────────────────────────────────────

test("repost times default to a staggered week, and an empty day means no repost", () => {
  const times = settings.getTimesByWeekday();
  assert.equal(times.length, 7, "Sunday first");

  const distinct = new Set(times.flat());
  assert.ok(distinct.size > 1, "the defaults must not be the same clock reading every day");

  settings.setTimesByWeekday([[], ["12:00"], [], [], [], [], []]);
  const stored = settings.getTimesByWeekday();
  assert.deepEqual(stored[0], [], "an empty day is a real setting, not 'unset'");
  assert.deepEqual(stored[1], ["12:00"]);

  assert.throws(() => settings.setTimesByWeekday([["25:00"], [], [], [], [], [], []]), /HH:MM/);
  assert.throws(() => settings.setTimesByWeekday([["12:00"]]), /7 arrays/);
});

test("thresholds reject values that would break the rules they encode", () => {
  // Pinned: the rest period is the only thing stopping tier 2 re-running the
  // same video every slot once tier 1 empties, so a silent change to it changes
  // how often the account repeats itself.
  assert.equal(settings.getMinGapDays(), 30, "the documented default");

  assert.throws(() => settings.setMinGapDays(0), /at least 1/);
  assert.throws(() => settings.setEvaluateAfterHours(0), /at least 1/);
  assert.throws(() => settings.setMinViews(1.5), /whole number/);
});

// ─── Inherited automation ────────────────────────────────────────────────────

/** Give a slug an automation flow, the way a keyed publish would. */
function flowFor(slug) {
  const { getDb } = load("lib/db/index.js");
  getDb()
    .prepare(
      `INSERT INTO automation_flows
         (id, name, template_type, trigger_keyword, config, media_id, is_active, automation_key)
       VALUES (?, ?, 'comment_to_dm', '["LINK"]', '{"media_ids":[]}', NULL, 1, ?)`
    )
    .run(`flow-${slug}`, slug, slug);
}

test("a repost inherits the automation of the topic it is a repost of", async () => {
  const worker = load("lib/schedule/worker.js");
  const { archived } = await published("inherit-topic", "inherit-topic.mp4", { views: 50_000 });
  flowFor("inherit-topic");

  // The job is booked against the repost pool, not the topic — that is the
  // whole point. The flow must still be the topic's.
  const spec = worker.repostAutomationSpec({
    id: "job-1",
    slug: "reposts",
    result: { repost_archive_id: archived.id },
  });

  assert.equal(spec?.key, "inherit-topic", "the origin slug, not the pool slug");
  assert.equal(spec?.existing_key_required, true, "append-only — never creates a flow");
});

test("a repost of a topic with no automation flow attaches nothing", async () => {
  const worker = load("lib/schedule/worker.js");
  const { archived } = await published("no-flow-topic", "no-flow-topic.mp4", { views: 50_000 });

  // A topic nobody wired an automation to is an ordinary state, not an error:
  // inventing a flow here would DM people from one nobody wrote.
  assert.equal(
    worker.repostAutomationSpec({
      id: "job-2",
      slug: "reposts",
      result: { repost_archive_id: archived.id },
    }),
    undefined
  );
});

test("an ordinary slug job is unaffected by the repost automation rule", async () => {
  const worker = load("lib/schedule/worker.js");
  flowFor("ordinary-topic");

  // No repost_archive_id — this job is not a repost, so it must fall through to
  // whatever automation it was booked with (here, none).
  assert.equal(
    worker.repostAutomationSpec({ id: "job-3", slug: "ordinary-topic", result: {} }),
    undefined
  );
});
