#!/usr/bin/env node
/**
 * Production-gated scheduler/automation integrity migration.
 *
 * This command never chooses a database path for the operator. Run preflight
 * first, review its JSON and a verified backup, then re-run with --apply during
 * a maintenance window after publishing/finalizing jobs reach zero.
 */
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const MIGRATION_ID = "2026-08-scheduler-automation-integrity-v1";

function usage(exitCode = 0) {
  console.log(`Usage:
  node scripts/migrate-scheduler-integrity.mjs --db /absolute/path/to/automations.db --preflight
  node scripts/migrate-scheduler-integrity.mjs --db /absolute/path/to/automations.db --apply

The command never defaults to the application's production database. --apply
is intentionally non-interactive; run and review --preflight first.`);
  process.exit(exitCode);
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) usage();
const dbIndex = args.indexOf("--db");
const dbPath = dbIndex >= 0 ? args[dbIndex + 1] : undefined;
const apply = args.includes("--apply");
const preflight = args.includes("--preflight");
if (!dbPath || !path.isAbsolute(dbPath) || apply === preflight || args.length !== 3) {
  usage(1);
}
if (!fs.existsSync(dbPath)) {
  console.error(`Refusing to create a database: ${dbPath} does not exist.`);
  process.exit(1);
}

const db = new Database(dbPath, { readonly: !apply, fileMustExist: true });
try {
  const tableExists = (name) =>
    Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
  const columns = (name) =>
    tableExists(name)
      ? db.prepare(`PRAGMA table_info(${name})`).all().map((column) => column.name)
      : [];
  const indexNames = (name) =>
    tableExists(name)
      ? db.prepare(`PRAGMA index_list(${name})`).all().map((index) => index.name)
      : [];

  const flowColumns = columns("automation_flows");
  const scheduleColumns = columns("scheduled_posts");
  if (!flowColumns.includes("automation_key")) {
    throw new Error("automation_flows.automation_key is missing; deploy the additive schema version before this migration.");
  }
  if (!tableExists("scheduled_posts")) {
    throw new Error("scheduled_posts is missing; deploy the scheduling schema version before this migration.");
  }

  const duplicateGroups = db
    .prepare(
      `SELECT automation_key, COUNT(*) AS count
         FROM automation_flows
        WHERE automation_key IS NOT NULL
        GROUP BY automation_key
       HAVING COUNT(*) > 1
        ORDER BY automation_key ASC`
    )
    .all();
  const duplicateDetails = duplicateGroups.map(({ automation_key, count }) => ({
    automation_key,
    count,
    rows: db
      .prepare(
        `SELECT id, created_at, is_active, media_id
           FROM automation_flows
          WHERE automation_key = ?
          ORDER BY created_at ASC, id ASC`
      )
      .all(automation_key),
  }));
  const activeJobs = db
    .prepare(
      `SELECT id, status, lease_until, container_id
         FROM scheduled_posts
        WHERE status IN ('publishing', 'finalizing')
        ORDER BY scheduled_at ASC`
    )
    .all();
  const existingMigration = tableExists("scheduler_integrity_migrations")
    ? db
        .prepare("SELECT id, applied_at, details FROM scheduler_integrity_migrations WHERE id = ?")
        .get(MIGRATION_ID)
    : undefined;
  const summary = {
    migration: MIGRATION_ID,
    db: dbPath,
    sqlite_version: db.prepare("SELECT sqlite_version() AS version").get().version,
    has_returning_support: Number(db.prepare("SELECT sqlite_version() AS version").get().version.split(".")[0]) >= 3,
    schema: {
      automation_key: flowColumns.includes("automation_key"),
      lease_token: scheduleColumns.includes("lease_token"),
      old_lookup_index: indexNames("automation_flows").includes("idx_flows_automation_key"),
      unique_key_index: indexNames("automation_flows").includes("ux_flows_automation_key_nonnull"),
      already_migrated: Boolean(existingMigration),
    },
    active_jobs: activeJobs,
    duplicate_keys: duplicateDetails,
    proposed: {
      nullify_duplicate_rows: duplicateDetails.reduce((total, group) => total + group.rows.length - 1, 0),
      preserve_rule: "oldest (created_at, id) row retains automation_key; later rows retain all fields and receive NULL automation_key",
    },
  };

  if (preflight) {
    console.log(JSON.stringify(summary, null, 2));
    process.exit(0);
  }

  if (existingMigration) {
    throw new Error(`${MIGRATION_ID} is already recorded as applied; refusing to reapply.`);
  }
  if (activeJobs.length) {
    throw new Error("Refusing to migrate while publishing/finalizing jobs exist. Pause workers and wait for zero active jobs.");
  }

  const migrate = db.transaction(() => {
    // Recheck only after BEGIN IMMEDIATE owns the writer lock. The earlier
    // precheck is informational; without this one a worker could claim work in
    // the gap and publish while the key constraint is being cut over.
    const lockedActiveJobs = db
      .prepare("SELECT id FROM scheduled_posts WHERE status IN ('publishing', 'finalizing') LIMIT 1")
      .get();
    if (lockedActiveJobs) {
      throw new Error("Refusing to migrate while publishing/finalizing jobs exist. Pause workers and wait for zero active jobs.");
    }

    const currentScheduleColumns = columns("scheduled_posts");
    if (!currentScheduleColumns.includes("lease_token")) {
      db.exec("ALTER TABLE scheduled_posts ADD COLUMN lease_token TEXT");
    }

    db.exec(`CREATE TABLE IF NOT EXISTS scheduler_integrity_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now')),
      details TEXT NOT NULL
    )`);
    db.exec(`CREATE TABLE IF NOT EXISTS automation_key_dedupe_audit (
      migration_id TEXT NOT NULL,
      flow_id TEXT NOT NULL,
      retained_flow_id TEXT NOT NULL,
      old_automation_key TEXT NOT NULL,
      recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (migration_id, flow_id)
    )`);

    const groups = db
      .prepare(
        `SELECT automation_key
           FROM automation_flows
          WHERE automation_key IS NOT NULL
          GROUP BY automation_key
         HAVING COUNT(*) > 1`
      )
      .all();
    const listRows = db.prepare(
      `SELECT id FROM automation_flows
        WHERE automation_key = ?
        ORDER BY created_at ASC, id ASC`
    );
    const clearKey = db.prepare("UPDATE automation_flows SET automation_key = NULL WHERE id = ?");
    const audit = db.prepare(
      `INSERT INTO automation_key_dedupe_audit
         (migration_id, flow_id, retained_flow_id, old_automation_key)
       VALUES (?, ?, ?, ?)`
    );
    for (const group of groups) {
      const rows = listRows.all(group.automation_key);
      const retained = rows[0];
      for (const row of rows.slice(1)) {
        clearKey.run(row.id);
        audit.run(MIGRATION_ID, row.id, retained.id, group.automation_key);
      }
    }

    db.exec("DROP INDEX IF EXISTS idx_flows_automation_key");
    db.exec(`CREATE UNIQUE INDEX ux_flows_automation_key_nonnull
      ON automation_flows(automation_key)
      WHERE automation_key IS NOT NULL`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_sched_finalizing_claim
      ON scheduled_posts(status, next_attempt_at, lease_until)`);

    const remaining = db
      .prepare(
        `SELECT automation_key FROM automation_flows
          WHERE automation_key IS NOT NULL
          GROUP BY automation_key HAVING COUNT(*) > 1 LIMIT 1`
      )
      .get();
    if (remaining) throw new Error(`duplicate automation_key remains: ${remaining.automation_key}`);
    const uniqueIndex = indexNames("automation_flows").includes("ux_flows_automation_key_nonnull");
    if (!uniqueIndex) throw new Error("unique automation_key index was not created");

    db.prepare("INSERT INTO scheduler_integrity_migrations (id, details) VALUES (?, ?)").run(
      MIGRATION_ID,
      JSON.stringify({ duplicate_rows_nullified: duplicateDetails.reduce((total, group) => total + group.rows.length - 1, 0) })
    );
  });
  migrate.immediate();
  console.log(JSON.stringify({ ...summary, applied: true }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  db.close();
}
