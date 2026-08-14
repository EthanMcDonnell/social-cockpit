/**
 * Rendering jobs for the model to read.
 *
 * Every tool returns both `structuredContent` (the machine contract) and a text
 * block (what the model actually reasons over). The text always states times in
 * the cockpit's configured zone with the offset spelled out — a scheduler that
 * is silently wrong about the timezone is worse than no scheduler, and the model
 * has no other way to know which zone `scheduled_at` was interpreted in.
 */

import type { ScheduledPostView, ScheduleSettings } from "./types.js";

/** "Sat 16 Aug 2026, 09:30 CDT" — unambiguous without being a wall of text. */
export function formatWhen(epochMs: number, timeZone: string): string {
  const date = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(epochMs);

  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZoneName: "short",
  }).format(epochMs);

  return `${date}, ${time}`;
}

/** A caption trimmed to one scannable line. */
function firstLine(text: string | undefined, max = 70): string {
  if (!text) return "(no caption)";
  const line = text.split("\n")[0]?.trim() ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line || "(no caption)";
}

/** One job as a single line, with whatever is actionable about it appended. */
export function formatJob(job: ScheduledPostView, timeZone: string): string {
  const bits = [
    `[${job.status}]`,
    formatWhen(job.scheduled_at, timeZone),
    `${job.platform === "yt" ? "YouTube" : "Instagram"} —`,
    firstLine(job.payload.caption ?? job.payload.title),
    `(${job.id})`,
  ];

  const notes: string[] = [];
  const files = job.media_files.map((m) => m.filename).join(", ");
  if (files) notes.push(files);
  if (job.media_missing) notes.push("⚠ source file missing on disk");
  if (job.automation?.key) notes.push(`automation: ${job.automation.key}`);
  if (job.attempts > 0 && job.status !== "published") {
    notes.push(`attempt ${job.attempts}/${job.max_attempts}`);
  }
  if (job.result?.error) notes.push(`error: ${job.result.error}`);
  if (job.result?.permalink) notes.push(job.result.permalink);
  if (job.result?.watch_url) notes.push(job.result.watch_url);
  if (job.result?.dry_run) notes.push("DRY RUN — nothing was actually posted");

  return notes.length ? `${bits.join(" ")}\n    ${notes.join(" · ")}` : bits.join(" ");
}

/**
 * The banner every tool result opens with. The worker being disabled or in dry
 * run is the difference between "scheduled" and "scheduled but will never fire",
 * so it is never left implicit.
 */
export function settingsBanner(settings: ScheduleSettings): string {
  const warnings: string[] = [];
  if (!settings.scheduler_enabled) {
    warnings.push("⚠ SCHEDULER_ENABLED=false — jobs are stored but the worker will never publish them.");
  }
  if (settings.dry_run) {
    warnings.push("⚠ SCHEDULE_DRY_RUN=true — jobs run the full pipeline but nothing is actually posted.");
  }
  const header = `Times shown in ${settings.timezone} (${settings.abbreviation}).`;
  return warnings.length ? `${header}\n${warnings.join("\n")}` : header;
}
