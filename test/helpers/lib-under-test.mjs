/**
 * Load app modules into a test process, against throwaway databases.
 *
 * The scheduler and the slug pools are server-side TypeScript behind the "@/"
 * alias, so exercising them for real means compiling first and then giving
 * `require` the same mapping the bundler applies. The alternative — asserting
 * against a reimplementation of the rules — is exactly the kind of test that
 * passes while the thing it describes is broken.
 */

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Module from "node:module";

const ROOT = path.resolve(".");

/**
 * Compile the given source globs, point every database at a fresh directory,
 * and return a loader for the compiled modules.
 *
 * `mediaRoot` doubles as LOCAL_MEDIA_ROOT, so path confinement is exercised
 * rather than switched off.
 */
export function loadLib(include) {
  const work = mkdtempSync(path.join(tmpdir(), "social-cockpit-lib-"));
  const build = path.join(work, "build");

  writeFileSync(
    path.join(work, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "commonjs",
        moduleResolution: "node",
        outDir: build,
        rootDir: ROOT,
        esModuleInterop: true,
        skipLibCheck: true,
        strict: true,
        baseUrl: ROOT,
        paths: { "@/*": ["src/*"] },
      },
      include: include.map((glob) => path.join(ROOT, glob)),
    })
  );
  execFileSync("npx", ["tsc", "-p", path.join(work, "tsconfig.json")], { stdio: "inherit" });

  const lib = path.join(build, "src");
  const resolve = Module._resolveFilename;
  Module._resolveFilename = function (request, parent, ...rest) {
    if (request.startsWith("@/")) {
      return resolve.call(this, path.join(lib, request.slice(2)), parent, ...rest);
    }
    try {
      return resolve.call(this, request, parent, ...rest);
    } catch {
      // The compiled output sits outside the repo, so bare dependencies need
      // pointing back at the repo's own node_modules.
      return resolve.call(this, request, { ...parent, paths: [path.join(ROOT, "node_modules")] }, ...rest);
    }
  };

  const data = path.join(work, "data");
  process.env.DB_PATH = path.join(data, "automations.db");
  process.env.CACHE_DB_PATH = path.join(data, "cache.db");
  process.env.EVENTS_DB_PATH = path.join(data, "events.db");
  process.env.TRANSCRIPTS_DB_PATH = path.join(data, "transcripts.db");
  process.env.SCHEDULE_MEDIA_DIR = path.join(data, "staged");
  process.env.INSTAGRAM_ACCOUNT_ID = "test-account";
  process.env.INSTAGRAM_ACCESS_TOKEN = "test-token";
  process.env.LOCAL_MEDIA_ROOT = work;

  const require_ = createRequire(import.meta.url);
  return {
    /** e.g. load("lib/slugs/store.js") */
    load: (relative) => require_(path.join(lib, relative)),
    /** Where fixture media should be written, inside LOCAL_MEDIA_ROOT. */
    mediaRoot: work,
    cleanup: () => rmSync(work, { recursive: true, force: true }),
  };
}

/**
 * The scheduler worker refuses to run against a database that has not passed
 * the reviewed integrity migration. A fixture has to stamp that ledger itself —
 * the app deliberately never creates it at startup.
 */
export function stampIntegrityMigration(db) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS scheduler_integrity_migrations (id TEXT PRIMARY KEY, applied_at TEXT)"
  );
  db.prepare(
    "INSERT OR IGNORE INTO scheduler_integrity_migrations (id, applied_at) VALUES (?, datetime('now'))"
  ).run("2026-08-scheduler-automation-integrity-v1");
}
