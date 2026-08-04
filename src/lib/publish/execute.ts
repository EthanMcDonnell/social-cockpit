/**
 * Publish + attach-automation, in one place.
 *
 * Both publish routes and the scheduler worker need the identical tail: publish
 * the container, and — only if a real `media_id` came back — wire the new post
 * into its automation flow. That logic was duplicated verbatim across the two
 * routes; it now lives here so a third caller (the worker) can't drift from it.
 *
 * Deliberately free of NextResponse so the worker can call it without pretending
 * to be an HTTP handler. Routes map the result to a response themselves.
 */

import type { PublishInput, PublishResult } from "@/lib/instagram/endpoints/publish";
import { publishFromR2, type R2Sources } from "@/lib/instagram/publish-flow";
import { getDb } from "@/lib/db";
import {
  applyAutomationPlan,
  type AutomationPlan,
  type AttachResult,
} from "@/lib/automation/attach";

/**
 * Publish timeout used when an automation is attached and the caller didn't pick
 * one. A reel can outlast the 120s default and return a 202 with no media_id,
 * which would skip the attach — so we wait longer to resolve synchronously.
 */
export const AUTOMATION_TIMEOUT_MS = 300_000;

/** Either the attach succeeded, or it didn't and we say why. Never throws. */
export type AutomationOutcome = AttachResult | { skipped: true; reason: string };

export interface ExecutePublishArgs {
  input: PublishInput;
  r2?: R2Sources;
  finalize?: boolean;
  timeoutMs?: number;
  intervalMs?: number;
  /** Pre-resolved plan from planAutomation(). Present ⇒ attach after publish. */
  plan?: AutomationPlan;
}

export interface ExecutePublishResult {
  result: PublishResult;
  /** 200 published/FINISHED, 202 still processing. */
  status: number;
  /** Only present when a plan was supplied. */
  automation?: AutomationOutcome;
}

/**
 * Attach a published post to its flow. The post is already live by the time this
 * runs, so a DB failure is *reported*, never thrown — losing the automation is
 * bad, but failing the whole publish after the post went out is worse, and the
 * caller can retry the attach separately.
 */
export function attachAutomation(
  result: PublishResult,
  plan: AutomationPlan
): AutomationOutcome {
  if (!result.published || !result.media_id) {
    return {
      skipped: true,
      reason: "post not yet published (no media_id) — automation not attached",
    };
  }
  try {
    return applyAutomationPlan(getDb(), result.media_id, plan);
  } catch (e) {
    return { skipped: true, reason: e instanceof Error ? e.message : "attach failed" };
  }
}

/**
 * Resolve R2 sources, publish, and attach the automation when one is planned.
 * Publish errors propagate — the caller decides whether that's an HTTP response
 * or a scheduler retry.
 */
export async function executePublish({
  input,
  r2,
  finalize,
  timeoutMs,
  intervalMs,
  plan,
}: ExecutePublishArgs): Promise<ExecutePublishResult> {
  const effectiveTimeoutMs = timeoutMs ?? (plan ? AUTOMATION_TIMEOUT_MS : undefined);

  const { result, status } = await publishFromR2(input, r2, {
    finalize,
    timeoutMs: effectiveTimeoutMs,
    intervalMs,
  });

  if (!plan) return { result, status };

  return { result, status, automation: attachAutomation(result, plan) };
}
