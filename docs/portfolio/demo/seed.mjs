/**
 * Write the fabricated account in dataset.mjs into a demo database.
 *
 * Run this only against the demo data directory the harness creates. It refuses
 * to open the repo's own `data/`, which is the live install's state.
 *
 * The tables must already exist: the app creates them on first use, so run.sh
 * boots the demo instance and touches an API route before calling this.
 *
 *   node docs/portfolio/demo/seed.mjs <demo-data-dir>
 */

import Database from "better-sqlite3";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NOW, MEDIA, SCHEDULED, FLOWS } from "./dataset.mjs";

const REPO = resolve(fileURLToPath(import.meta.url), "../../../..");
const dir = resolve(process.argv[2] ?? "");

if (!dir || dir === join(REPO, "data")) {
  console.error("refusing to seed the live data directory — pass the demo one");
  process.exit(1);
}
if (!existsSync(join(dir, "automations.db"))) {
  console.error(`no automations.db in ${dir} — boot the demo instance first`);
  process.exit(1);
}

const db = new Database(join(dir, "automations.db"));
db.pragma("journal_mode = WAL");

// ─── Staged media ────────────────────────────────────────────────────────────
// The calendar flags a job whose file has gone missing, so the demo needs real
// bytes on disk. One-frame MP4s would need ffmpeg; a placeholder file of the
// right name is enough, because nothing in a screenshot run ever uploads it.
const staged = join(dir, "staged");
mkdirSync(staged, { recursive: true });

const insertMedia = db.prepare(
  `INSERT OR REPLACE INTO scheduled_media (id, path, owned, size_bytes, content_type)
   VALUES (?, ?, 1, ?, 'video/mp4')`
);
const insertJob = db.prepare(
  `INSERT OR REPLACE INTO scheduled_posts
     (id, platform, status, scheduled_at, payload, media, automation, attempts,
      max_attempts, grace_minutes, result, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, 0, 3, 60, ?, ?, ?)`
);

db.exec("DELETE FROM scheduled_posts; DELETE FROM scheduled_media;");

const seedTx = db.transaction(() => {
  for (const job of SCHEDULED) {
    const stagedId = `stg_${job.id}`;
    const path = join(staged, job.file);
    if (!existsSync(path)) writeFileSync(path, "");
    insertMedia.run(stagedId, path, job.size_bytes);

    const payload =
      job.platform === "yt"
        ? { title: job.title, description: job.caption, isShort: true, tags: ["engineering", "explainer"] }
        : { media_type: "REELS", caption: job.caption, share_to_feed: true };

    const created = new Date(job.scheduled_at - 3 * 86_400_000).toISOString();
    insertJob.run(
      job.id,
      job.platform,
      job.status,
      job.scheduled_at,
      JSON.stringify(payload),
      JSON.stringify([{ role: "video", staged_id: stagedId }]),
      job.automation
        ? JSON.stringify({ trigger_keywords: ["LINK"], config: { comment_replies: ["Sent!"], initial_message: "Here it is 🔗" } })
        : null,
      job.status === "published"
        ? JSON.stringify({ media_id: MEDIA[0].id, permalink: MEDIA[0].permalink })
        : null,
      created,
      created
    );
  }

  // ─── Automation flows ──────────────────────────────────────────────────────
  db.exec("DELETE FROM automation_flows; DELETE FROM automation_events;");
  const insertFlow = db.prepare(
    `INSERT INTO automation_flows
       (id, name, template_type, trigger_keyword, config, is_active, media_id, activated_at, created_at)
     VALUES (?, ?, 'comment_to_dm', ?, ?, ?, ?, ?, ?)`
  );
  const insertEvent = db.prepare(
    `INSERT INTO automation_events (flow_id, recipient_id, level, kind, message, created_at)
     VALUES (?, ?, 'info', ?, ?, ?)`
  );

  FLOWS.forEach((flow, i) => {
    const id = `flow_${String(i).padStart(2, "0")}`;
    const media = MEDIA[flow.media];
    const created = new Date(NOW.getTime() - (60 - i * 6) * 86_400_000).toISOString();
    insertFlow.run(
      id,
      flow.name,
      JSON.stringify([flow.keyword]),
      JSON.stringify({
        comment_replies: ["Sent it to your DMs 📩", "Just sent — check your inbox"],
        initial_message: `Here's the ${flow.name.toLowerCase()} 👇\n\nhttps://howitsbuilt.example/${flow.keyword.toLowerCase()}`,
        media_ids: [media.id],
      }),
      flow.active,
      media.id,
      created,
      created
    );

    // The flow cards count opener_sent events inside the 30-day retention
    // window, so date them there or the counters read zero.
    const events = db.transaction(() => {
      for (let n = 0; n < flow.sent; n++) {
        const at = new Date(NOW.getTime() - (n % 29) * 86_400_000 - (n % 17) * 3_600_000);
        insertEvent.run(id, `igsid_${i}_${n}`, "opener_sent", "opener sent", at.toISOString());
      }
    });
    events();
  });
});

seedTx();

const jobs = db.prepare("SELECT status, COUNT(*) c FROM scheduled_posts GROUP BY status").all();
const flows = db.prepare("SELECT COUNT(*) c FROM automation_flows").get();
const events = db.prepare("SELECT COUNT(*) c FROM automation_events").get();
console.log(
  `seeded ${dir}\n  jobs: ${jobs.map((r) => `${r.c} ${r.status}`).join(", ")}` +
  `\n  flows: ${flows.c}\n  events: ${events.c}`
);
db.close();
