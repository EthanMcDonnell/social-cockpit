/**
 * Attach a freshly-published post to an automation flow.
 *
 * A caller-supplied `key` is the stable owner handle: every successful attach
 * with that key belongs to one flow and contributes its media_id to that
 * flow's target list. No key deliberately means a fresh flow.
 *
 * Planning is a pre-publish validation step. Its create/append result is never
 * used as a write snapshot: the real resolution happens again under an
 * immediate SQLite transaction after the platform returns the media_id.
 */

import type Database from "better-sqlite3";
import { randomUUID } from "crypto";
import {
  rowToFlow,
  type AutomationFlowRow,
  type AutomationConfig,
  type AutomationTemplateType,
} from "@/lib/db";

/** Automation block accepted inside a publish or schedule request. */
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
  /** Internal schedule marker: this was validated as append-only at booking time. */
  existing_key_required?: boolean;
}

export interface NormalizedAutomationSpec {
  key?: string;
  name?: string;
  keywords: string[];
  templateType: AutomationTemplateType;
  config: AutomationConfig;
  activate: boolean;
}

/**
 * `mode` describes what was valid at preflight time, not a future DB write.
 * An append-only request must not silently recreate a deleted flow with its
 * ignored append fields; a create request may safely append if another caller
 * creates the keyed flow while its post is publishing.
 */
export type AutomationPlan = {
  mode: "create" | "append";
  spec: NormalizedAutomationSpec;
};

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

export function normalizeAutomationSpec(spec: AutomationSpec): NormalizedAutomationSpec {
  return {
    key: spec.key?.trim() || undefined,
    name: spec.name?.trim() || undefined,
    keywords: normalizeKeywords(spec.trigger_keywords),
    templateType: resolveTemplateType(spec.template_type),
    config: (spec.config ?? {}) as AutomationConfig,
    activate: spec.activate !== false,
  };
}

/**
 * Validate an automation before publishing. The lookup only decides whether a
 * key-only spec is valid now; attachment always re-resolves the owner later.
 */
export function planAutomation(
  db: Database.Database,
  spec: AutomationSpec
): { plan: AutomationPlan } | { error: string } {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
    return { error: "automation must be an object" };
  }
  if (
    (spec.key !== undefined && typeof spec.key !== "string") ||
    (spec.name !== undefined && typeof spec.name !== "string") ||
    (spec.activate !== undefined && typeof spec.activate !== "boolean") ||
    (spec.existing_key_required !== undefined && typeof spec.existing_key_required !== "boolean") ||
    (spec.trigger_keywords !== undefined &&
      (!Array.isArray(spec.trigger_keywords) || spec.trigger_keywords.some((keyword) => typeof keyword !== "string"))) ||
    (spec.config !== undefined && (typeof spec.config !== "object" || spec.config === null || Array.isArray(spec.config)))
  ) {
    return { error: "automation has an invalid field type" };
  }
  const normalized = normalizeAutomationSpec(spec);

  if (normalized.key) {
    const row = db
      .prepare("SELECT 1 FROM automation_flows WHERE automation_key = ? LIMIT 1")
      .get(normalized.key) as { 1: number } | undefined;
    if (row) return { plan: { mode: "append", spec: normalized } };
  }
  if (spec.existing_key_required) {
    return { error: `automation flow for key "${normalized.key ?? ""}" no longer exists` };
  }

  if (!normalized.name && !normalized.key) {
    return { error: "automation requires a name or key" };
  }
  if (normalized.keywords.length === 0) {
    return { error: "automation requires at least one trigger_keyword to create a flow" };
  }

  return { plan: { mode: "create", spec: normalized } };
}

function appendToFlow(
  db: Database.Database,
  row: AutomationFlowRow,
  mediaId: string
): AttachResult {
  const flow = rowToFlow(row);
  if (flow.media_ids.includes(mediaId)) {
    return {
      action: "noop",
      flow_id: flow.id,
      automation_key: flow.automation_key,
      media_ids: flow.media_ids,
    };
  }

  const media_ids = [...flow.media_ids, mediaId];
  db.prepare("UPDATE automation_flows SET config = ?, media_id = ? WHERE id = ?").run(
    JSON.stringify({ ...flow.config, media_ids }),
    media_ids[0] ?? null,
    flow.id
  );
  return {
    action: "appended",
    flow_id: flow.id,
    automation_key: flow.automation_key,
    media_ids,
  };
}

function createFlow(
  db: Database.Database,
  spec: NormalizedAutomationSpec,
  mediaId: string
): AttachResult {
  const media_ids = [mediaId];
  const id = randomUUID();
  const isActive = spec.activate ? 1 : 0;
  const activatedAt = spec.activate ? new Date().toISOString() : null;
  const name = spec.name ?? spec.key!;

  db.prepare(
    `INSERT INTO automation_flows
       (id, name, template_type, trigger_keyword, config, media_id, is_active, activated_at, automation_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    name,
    spec.templateType,
    JSON.stringify(spec.keywords),
    JSON.stringify({ ...spec.config, media_ids }),
    mediaId,
    isActive,
    activatedAt,
    spec.key ?? null
  );

  return { action: "created", flow_id: id, automation_key: spec.key, media_ids };
}

/**
 * Attach under an immediate write transaction. The current row is read only
 * after the transaction owns the SQLite writer lock, so keyed creates converge
 * and JSON target-list updates cannot lose a concurrent media_id.
 */
export function applyAutomationPlan(
  db: Database.Database,
  mediaId: string,
  plan: AutomationPlan
): AttachResult {
  const mutate = db.transaction(() => {
    const { spec } = plan;
    if (!spec.key) return createFlow(db, spec, mediaId);

    const row = db
      .prepare("SELECT * FROM automation_flows WHERE automation_key = ? LIMIT 1")
      .get(spec.key) as AutomationFlowRow | undefined;
    if (row) return appendToFlow(db, row, mediaId);

    if (plan.mode === "append") {
      throw new Error(`automation flow for key "${spec.key}" no longer exists`);
    }
    return createFlow(db, spec, mediaId);
  });

  try {
    return mutate.immediate();
  } catch (err) {
    // The unique index is the final cross-process backstop. If an older process
    // inserted the key without using this transaction, re-read under our own
    // writer lock and append rather than leaving an already-live post unattached.
    if (!(err instanceof Error) || !/UNIQUE constraint failed/.test(err.message) || !plan.spec.key) {
      throw err;
    }
    const appendAfterConflict = db.transaction(() => {
      const row = db
        .prepare("SELECT * FROM automation_flows WHERE automation_key = ? LIMIT 1")
        .get(plan.spec.key!) as AutomationFlowRow | undefined;
      if (!row) throw err;
      return appendToFlow(db, row, mediaId);
    });
    return appendAfterConflict.immediate();
  }
}
