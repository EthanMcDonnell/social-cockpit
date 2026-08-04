/**
 * Attach a freshly-published post to an automation flow, as part of a single
 * publish+automate API call (see docs/publish-with-automation.md).
 *
 * The tricky part the caller wants solved: don't create a duplicate flow when a
 * *variation* of the same video is posted again. A caller-supplied `key` slug is
 * the dedup handle — the same key across publish calls resolves to the same flow,
 * and each new post's media_id is appended to that flow's target list. No key =
 * always a fresh flow.
 *
 * Split into two phases on purpose:
 *   1. planAutomation()      — validates the spec and resolves create-vs-append
 *                              via a cheap read-only key lookup. Runs BEFORE the
 *                              publish so a bad spec 400s instead of leaving a
 *                              live-but-un-automated post behind.
 *   2. applyAutomationPlan() — the actual DB write, run only once we hold the
 *                              real published media_id.
 */

import type Database from "better-sqlite3";
import { randomUUID } from "crypto";
import {
  rowToFlow,
  type AutomationFlow,
  type AutomationFlowRow,
  type AutomationConfig,
  type AutomationTemplateType,
} from "@/lib/db";

/** Automation block accepted inside the publish request body. */
export interface AutomationSpec {
  /** Dedup slug. Reused across posts → they share one flow. Absent → new flow. */
  key?: string;
  /** Flow display name. Required when creating; defaults to `key` if omitted. */
  name?: string;
  /** Comment keywords that fire the automation. Required when creating a flow. */
  trigger_keywords?: string[];
  template_type?: AutomationTemplateType;
  /** Flow config (comment_replies / initial_message / etc.). media_ids injected. */
  config?: AutomationConfig;
  /** Activate the flow immediately. Default true (an API publish wants it live). */
  activate?: boolean;
}

interface NormalizedSpec {
  key?: string;
  name?: string;
  keywords: string[];
  templateType: AutomationTemplateType;
  config: AutomationConfig;
  activate: boolean;
}

export type AutomationPlan =
  | { mode: "create"; spec: NormalizedSpec }
  | { mode: "append"; flow: AutomationFlow; spec: NormalizedSpec };

export interface AttachResult {
  /** created = new flow; appended = added to existing flow; noop = already there. */
  action: "created" | "appended" | "noop";
  flow_id: string;
  automation_key?: string;
  /** The flow's full target list after the attach. */
  media_ids: string[];
}

function resolveTemplateType(t?: string): AutomationTemplateType {
  return t === "comment_to_reply"
    ? "comment_to_reply"
    : t === "comment_to_follow_dm"
      ? "comment_to_follow_dm"
      : "comment_to_dm";
}

function normalizeKeywords(raw?: string[]): string[] {
  return (Array.isArray(raw) ? raw : [])
    .map((k) => k.trim().toUpperCase())
    .filter(Boolean);
}

/**
 * Validate the automation spec and decide whether this publish will create a new
 * flow or append to an existing one (matched by `key`). Returns the plan, or an
 * error string suitable for a 400. Read-only — safe to call before publishing.
 */
export function planAutomation(
  db: Database.Database,
  spec: AutomationSpec
): { plan: AutomationPlan } | { error: string } {
  const key = spec.key?.trim() || undefined;
  const name = spec.name?.trim() || undefined;
  const keywords = normalizeKeywords(spec.trigger_keywords);
  const templateType = resolveTemplateType(spec.template_type);
  const config = (spec.config ?? {}) as AutomationConfig;
  const activate = spec.activate !== false; // default true

  const normalized: NormalizedSpec = { key, name, keywords, templateType, config, activate };

  // Append path: an existing flow already owns this key — reuse it as-is and just
  // add the new post. Keywords/name/config on the spec are ignored here so the
  // established flow's settings aren't silently rewritten by a later post.
  if (key) {
    const row = db
      .prepare(
        "SELECT * FROM automation_flows WHERE automation_key = ? ORDER BY created_at ASC LIMIT 1"
      )
      .get(key) as AutomationFlowRow | undefined;
    if (row) {
      return { plan: { mode: "append", flow: rowToFlow(row), spec: normalized } };
    }
  }

  // Create path: need something to name it and at least one trigger keyword.
  if (!name && !key) {
    return { error: "automation requires a name or key" };
  }
  if (keywords.length === 0) {
    return { error: "automation requires at least one trigger_keyword to create a flow" };
  }

  return { plan: { mode: "create", spec: normalized } };
}

/**
 * Execute a plan against the just-published media_id. Creating writes a new flow;
 * appending adds the media_id (deduped) to the matched flow's target list. Never
 * rewrites an existing flow's keywords/config beyond its media_ids.
 */
export function applyAutomationPlan(
  db: Database.Database,
  mediaId: string,
  plan: AutomationPlan
): AttachResult {
  if (plan.mode === "append") {
    const { flow } = plan;
    if (flow.media_ids.includes(mediaId)) {
      return {
        action: "noop",
        flow_id: flow.id,
        automation_key: flow.automation_key,
        media_ids: flow.media_ids,
      };
    }
    const media_ids = [...flow.media_ids, mediaId];
    const config = JSON.stringify({ ...flow.config, media_ids });
    db.prepare(
      "UPDATE automation_flows SET config = ?, media_id = ? WHERE id = ?"
    ).run(config, media_ids[0] ?? null, flow.id);
    return {
      action: "appended",
      flow_id: flow.id,
      automation_key: flow.automation_key,
      media_ids,
    };
  }

  const { spec } = plan;
  const media_ids = [mediaId];
  const config = JSON.stringify({ ...spec.config, media_ids });
  const id = randomUUID();
  const isActive = spec.activate ? 1 : 0;
  const activatedAt = spec.activate ? new Date().toISOString() : null;
  const name = spec.name ?? spec.key!; // planAutomation guarantees one is present

  db.prepare(
    `INSERT INTO automation_flows
       (id, name, template_type, trigger_keyword, config, media_id, is_active, activated_at, automation_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    name,
    spec.templateType,
    JSON.stringify(spec.keywords),
    config,
    mediaId,
    isActive,
    activatedAt,
    spec.key ?? null
  );

  return { action: "created", flow_id: id, automation_key: spec.key, media_ids };
}
