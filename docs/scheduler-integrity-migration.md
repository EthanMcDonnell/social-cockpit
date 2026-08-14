# Scheduler integrity migration runbook

This migration makes `automation_key` a single-owner key and adds fenced worker leases for scheduled posts. It is deliberately **not** performed by application startup, a page request, or a deploy build.

## What it changes

The explicit migration adds `scheduled_posts.lease_token`, creates a partial unique index for non-null `automation_flows.automation_key`, and records its work in audit tables.

If historical rows share a non-null automation key, it preserves the row that the application already treated as canonical: the oldest by `created_at`, then `id`. Every later duplicate row has **only** its `automation_key` set to `NULL`.

It never deletes, merges, renames, deactivates, or changes a flow's trigger keywords, template, configuration, `media_id`, or `config.media_ids`. A historical duplicate therefore continues to operate on precisely its prior targets; it simply stops being a destination for new key-based attachments.

## Required maintenance procedure

1. Take and verify a restorable SQLite backup, including the current database and WAL state.
2. Put the entire application in a maintenance window: stop/pause scheduler workers **and** prevent direct publish/automation requests from reaching every old process. Wait for in-flight requests to drain and for no job to be `publishing` or `finalizing`. The migration's lock can serialize SQLite writes, but it cannot prevent an already-running legacy request from publishing externally with a stale flow plan.
3. Run the read-only preflight against the exact database path:

   ```bash
   node scripts/migrate-scheduler-integrity.mjs \
     --db /absolute/path/to/automations.db --preflight
   ```

4. Review the JSON output, especially `active_jobs`, `duplicate_keys`, and the proposed retained/nullified flow IDs. Stop if any disposition is unexpected.
5. During the same maintenance window, run the explicit apply command:

   ```bash
   node scripts/migrate-scheduler-integrity.mjs \
     --db /absolute/path/to/automations.db --apply
   ```

6. Run preflight again and confirm there are no duplicate non-null keys, the unique index is present, and `lease_token` is present.
7. Deploy/restart using the normal operator-owned production process. The scheduler intentionally remains disabled by the new code until `lease_token` exists.
8. Monitor scheduler and automation-attachment events after rollout. Retain the verified backup and `automation_key_dedupe_audit` records.

## Rollback

The schema addition is compatible with an application-code rollback. Prefer rolling back application code while retaining the additive schema.

Restoring a cleared historical key is a data operation: pause writers, drop the unique index, then replay `automation_key_dedupe_audit` or restore the verified backup. Do not replace the entire live database after new writes have occurred without an operator-approved recovery plan.

## Delivery semantics

Fenced leases stop stale workers from updating a newer job owner and serialize finalizer claims. They cannot make an external platform exactly-once: a process crash after Instagram or YouTube accepts a request but before the response is durably recorded can still require recovery. The scheduler's guarantee is therefore explicitly at-least-once across that external boundary.
