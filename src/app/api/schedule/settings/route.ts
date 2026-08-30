import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import {
  getTimeZone,
  setTimeZone,
  getSuggestedTimes,
  setSuggestedTimes,
  getMaxPostsPerDay,
  setMaxPostsPerDay,
  isSchedulerPaused,
  setSchedulerPaused,
  isDryRunStored,
  setDryRunStored,
} from "@/lib/schedule/settings";
import { isValidTimeZone, zoneAbbreviation } from "@/lib/schedule/tz";
import {
  getDefaultSelectionMethod,
  setDefaultSelectionMethod,
} from "@/lib/slugs/settings";
import { isSelectionMethod, SELECTION_METHODS } from "@/lib/slugs/types";
import {
  getRepostSettings,
  setAutobookEnabled,
  setBlockBelowViews,
  setEvaluateAfterHours,
  setHorizonDays,
  setMaxPerWeek,
  setMinGapDays,
  setMinViews,
  setTimesByWeekday,
} from "@/lib/repost/settings";
import { REPOST_GRADUATION_STRATEGY } from "@/lib/repost/publish";
import { requireScheduleAuth } from "@/lib/schedule/auth";
import { schedulerEnabled } from "@/lib/schedule/worker";

export const dynamic = "force-dynamic";

function payload() {
  const timezone = getTimeZone();
  return {
    timezone,
    abbreviation: zoneAbbreviation(Date.now(), timezone),
    // Effective state — what the worker will actually do right now.
    scheduler_enabled: schedulerEnabled(),
    dry_run: config.schedule.dryRun || isDryRunStored(),
    // The two inputs, reported separately so the UI can explain itself. When
    // .env has disabled the scheduler outright, a pause toggle is meaningless
    // and the panel says so rather than offering a control that does nothing.
    scheduler_env_enabled: config.schedule.enabled,
    dry_run_env: config.schedule.dryRun,
    paused: isSchedulerPaused(),
    dry_run_stored: isDryRunStored(),
    // Posting policy — stored, and editable without restarting the server.
    suggested_times: getSuggestedTimes(),
    max_posts_per_day: getMaxPostsPerDay(),
    // How a slug job picks its video when neither the job nor the slug says.
    // Read at fire time, so changing it also changes what every unspecified job
    // already on the calendar will do.
    default_selection: getDefaultSelectionMethod(),
    // Repost policy. Reported as its own object rather than flattened in, so a
    // client can tell "this install has no repost settings" from "they are all
    // at their defaults" — and so the graduation strategy can sit beside them
    // as a read-only fact rather than looking like one more thing to tune.
    repost: {
      ...getRepostSettings(),
      /** Reported so a client can show it. There is no setter — see lib/repost/publish.ts. */
      graduation_strategy: REPOST_GRADUATION_STRATEGY,
    },
  };
}

/** GET /api/schedule/settings — display zone, worker mode, and posting policy. */
export async function GET(request: NextRequest) {
  const denied = requireScheduleAuth(request);
  if (denied) return denied;
  return NextResponse.json(payload());
}

/**
 * PUT /api/schedule/settings — update any subset of the stored settings.
 *
 *   { "timezone": "America/Chicago",
 *     "suggested_times": ["09:30", "18:00"],
 *     "max_posts_per_day": 2 }
 *
 * Only keys that are present are touched, so a client can change one setting
 * without having to echo back the rest and risk clobbering a concurrent edit.
 */
export async function PUT(request: NextRequest) {
  const denied = requireScheduleAuth(request);
  if (denied) return denied;

  const body = await request.json().catch(() => ({}));
  const invalid = (message: string) =>
    NextResponse.json({ error: "invalid_param", message }, { status: 400 });

  if (body?.min_same_video_days !== undefined) {
    return invalid("min_same_video_days was removed; use max_posts_per_day and suggested_times instead.");
  }

  if (body?.timezone !== undefined) {
    if (typeof body.timezone !== "string" || !isValidTimeZone(body.timezone)) {
      return invalid("timezone must be a valid IANA zone, e.g. America/Chicago.");
    }
    setTimeZone(body.timezone);
  }

  if (body?.suggested_times !== undefined) {
    if (!Array.isArray(body.suggested_times)) {
      return invalid('suggested_times must be an array of "HH:MM" strings.');
    }
    try {
      setSuggestedTimes(body.suggested_times);
    } catch (err) {
      return invalid(err instanceof Error ? err.message : "Bad suggested_times.");
    }
  }

  if (body?.default_selection !== undefined) {
    if (!isSelectionMethod(body.default_selection)) {
      return invalid(`default_selection must be one of: ${SELECTION_METHODS.join(", ")}.`);
    }
    setDefaultSelectionMethod(body.default_selection);
  }

  if (body?.max_posts_per_day !== undefined) {
    try {
      setMaxPostsPerDay(Number(body.max_posts_per_day));
    } catch (err) {
      return invalid(err instanceof Error ? err.message : "Bad max_posts_per_day.");
    }
  }

  // ── Repost policy ──────────────────────────────────────────────────────────
  // Accepted nested (`{ repost: { min_views: 25000 } }`) so one PUT can carry
  // both policies without the key names colliding.
  const repost = body?.repost;
  if (repost !== undefined) {
    if (typeof repost !== "object" || repost === null || Array.isArray(repost)) {
      return invalid("repost must be an object.");
    }
    if (repost.graduation_strategy !== undefined) {
      return invalid(
        "graduation_strategy is not configurable — reposts always publish as trial reels promoted manually."
      );
    }

    const numbers: [string, unknown, (value: number) => void][] = [
      ["min_views", repost.min_views, setMinViews],
      ["block_below_views", repost.block_below_views, setBlockBelowViews],
      ["min_gap_days", repost.min_gap_days, setMinGapDays],
      ["evaluate_after_hours", repost.evaluate_after_hours, setEvaluateAfterHours],
      ["max_per_week", repost.max_per_week, setMaxPerWeek],
      ["horizon_days", repost.horizon_days, setHorizonDays],
    ];
    for (const [name, value, apply] of numbers) {
      if (value === undefined) continue;
      try {
        apply(Number(value));
      } catch (err) {
        return invalid(err instanceof Error ? err.message : `Bad repost.${name}.`);
      }
    }

    if (repost.times_by_weekday !== undefined) {
      try {
        setTimesByWeekday(repost.times_by_weekday);
      } catch (err) {
        return invalid(err instanceof Error ? err.message : "Bad repost.times_by_weekday.");
      }
    }

    if (repost.autobook !== undefined) {
      if (typeof repost.autobook !== "boolean") return invalid("repost.autobook must be a boolean.");
      setAutobookEnabled(repost.autobook);
    }
  }

  // Both take booleans only. Coercing here would mean `paused: "false"` reads as
  // true and quietly stops publishing — the failure is safe, but silently
  // ignoring what the caller asked for is not.
  if (body?.paused !== undefined) {
    if (typeof body.paused !== "boolean") return invalid("paused must be a boolean.");
    setSchedulerPaused(body.paused);
  }

  if (body?.dry_run !== undefined) {
    if (typeof body.dry_run !== "boolean") return invalid("dry_run must be a boolean.");
    setDryRunStored(body.dry_run);
  }

  return NextResponse.json(payload());
}
