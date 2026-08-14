import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

const script = path.resolve("scripts/migrate-scheduler-integrity.mjs");

function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), "social-cockpit-integrity-"));
  const dbPath = path.join(directory, "fixture.db");
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE automation_flows (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      template_type TEXT NOT NULL,
      trigger_keyword TEXT NOT NULL,
      config TEXT NOT NULL,
      is_active INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      media_id TEXT,
      activated_at TEXT,
      automation_key TEXT
    );
    CREATE INDEX idx_flows_automation_key ON automation_flows(automation_key);
    CREATE TABLE scheduled_posts (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      scheduled_at INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      next_attempt_at INTEGER,
      lease_until INTEGER,
      container_id TEXT
    );
  `);
  const insert = db.prepare(`INSERT INTO automation_flows
    (id, name, template_type, trigger_keyword, config, is_active, created_at, media_id, activated_at, automation_key)
    VALUES (?, ?, 'comment_to_dm', ?, ?, ?, ?, ?, ?, ?)`);
  insert.run("old", "Old owner", '["OLD"]', '{"media_ids":["m-old"],"message":"old"}', 1, "2026-01-01 00:00:00", "m-old", "2026-01-01T00:00:00Z", "shared");
  insert.run("new", "Independent legacy flow", '["NEW"]', '{"media_ids":["m-new"],"message":"new"}', 0, "2026-01-02 00:00:00", "m-new", null, "shared");
  insert.run("null", "Keyless", '["ANY"]', '{"media_ids":["m-null"]}', 1, "2026-01-03 00:00:00", "m-null", null, null);
  db.close();
  return { directory, dbPath };
}

function migrate(dbPath, mode) {
  return execFileSync(process.execPath, [script, "--db", dbPath, mode], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

test("preflight reports and apply safely detaches historical duplicate keys", () => {
  const { directory, dbPath } = fixture();
  try {
    const preflight = JSON.parse(migrate(dbPath, "--preflight"));
    assert.equal(preflight.duplicate_keys.length, 1);
    assert.equal(preflight.duplicate_keys[0].automation_key, "shared");
    assert.deepEqual(preflight.duplicate_keys[0].rows.map((row) => row.id), ["old", "new"]);

    migrate(dbPath, "--apply");
    const db = new Database(dbPath);
    const rows = db.prepare("SELECT * FROM automation_flows ORDER BY id").all();
    const old = rows.find((row) => row.id === "old");
    const newer = rows.find((row) => row.id === "new");
    assert.equal(old.automation_key, "shared");
    assert.equal(newer.automation_key, null);
    assert.equal(newer.name, "Independent legacy flow");
    assert.equal(newer.trigger_keyword, '["NEW"]');
    assert.equal(newer.config, '{"media_ids":["m-new"],"message":"new"}');
    assert.equal(newer.is_active, 0);
    assert.equal(newer.media_id, "m-new");
    assert.equal(newer.activated_at, null);
    assert.ok(db.prepare("PRAGMA table_info(scheduled_posts)").all().some((column) => column.name === "lease_token"));
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM automation_key_dedupe_audit").get().count, 1);
    assert.throws(
      () => db.prepare("INSERT INTO automation_flows (id, name, template_type, trigger_keyword, config, is_active, created_at, automation_key) VALUES ('third', 'Third', 'comment_to_dm', '[]', '{}', 0, '2026-01-04', 'shared')").run(),
      /UNIQUE constraint failed/
    );
    db.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("apply refuses a database with active worker leases", () => {
  const { directory, dbPath } = fixture();
  try {
    const db = new Database(dbPath);
    db.prepare("INSERT INTO scheduled_posts (id, status, scheduled_at, lease_until) VALUES ('busy', 'finalizing', 1, 2)").run();
    db.close();
    assert.throws(
      () => migrate(dbPath, "--apply"),
      /Refusing to migrate while publishing\/finalizing jobs exist/
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
