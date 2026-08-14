/**
 * Slot planning, scoped to one video.
 *
 * The spacing rule this enforces is a *same-video* rule, not a cadence rule.
 * Every hook of one video is the same body over the same voiceover with a
 * different opening line, so posting two of them close together gets the later
 * one clustered as a near-duplicate and throttled. Two posts on one day are
 * fine when they are different videos.
 *
 * So this keeps hooks of `video` apart, and reports — without blocking on —
 * everything else nearby. How busy a day should be is a judgement call for
 * whoever is reading `get_calendar`, not a policy to bake in here.
 */

import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { cockpit } from "../cockpit.js";
import { formatWhen, settingsBanner } from "../format.js";
import { fetchCommitments, type Commitment } from "../commitments.js";
import { addDays, parseTimeOfDay, utcToWall, wallToUtc } from "../tz.js";
import type { ScheduleSettings } from "../types.js";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

export function registerSlotTools(server: McpServer): void {
  server.registerTool(
    "suggest_slots",
    {
      title: "Suggest slots for one video",
      description:
        "Free times for the hooks of a single video, spaced so no two hooks of that video land within " +
        "min_days of each other — the spacing that stops near-duplicate reels being throttled. Posts of OTHER " +
        "videos do not block a slot (two different videos can share a day); they are only reported, and a " +
        "candidate within an hour of any existing post is skipped so nothing stacks. Call get_calendar first if " +
        "you need to judge how busy the days already are. Read-only: it suggests times, it books nothing.",
      inputSchema: z.object({
        video: z
          .string()
          .describe(
            "The video these slots are for, e.g. the slug. Matched against the `video` tag on existing jobs " +
              "to find this video's other hooks."
          ),
        count: z.number().optional().describe("How many slots to find. Defaults to 1."),
        min_days: z
          .number()
          .optional()
          .describe("Minimum days between two hooks of this video. Defaults to 2."),
        time_of_day: z
          .string()
          .optional()
          .describe("Preferred wall-clock time in the cockpit's zone, 'HH:MM'. Defaults to 09:30."),
        earliest: z
          .string()
          .optional()
          .describe("Don't suggest anything before this (ISO-8601 or epoch ms). Defaults to now."),
      }),
      outputSchema: z.object({
        timezone: z.string(),
        video: z.string(),
        min_days: z.number(),
        slots: z.array(
          z.object({
            scheduled_at: z
              .string()
              .describe("Pass this straight to schedule_post — local wall time in the cockpit's zone."),
            local: z.string(),
            epoch_ms: z.number(),
          })
        ),
        same_video_posts: z
          .array(z.object({ at: z.string(), caption: z.string(), status: z.string() }))
          .describe("Existing hooks of this video that the slots were spaced from."),
        other_posts_nearby: z
          .array(z.object({ at: z.string(), caption: z.string(), video: z.string().optional() }))
          .describe("Other posts around the suggested slots. Informational — these did not block anything."),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ video, count = 1, min_days = 2, time_of_day = "09:30", earliest }) => {
      const config = await cockpit<ScheduleSettings>("/api/schedule/settings");
      const tz = config.timezone;

      const tod = parseTimeOfDay(time_of_day);
      if (!tod) throw new Error(`time_of_day must look like "09:30", got "${time_of_day}".`);

      const now = Date.now();
      const floor = earliest ? parseInstant(earliest) : now;
      if (floor === null) {
        throw new Error(`Could not read earliest ("${earliest}"). Use ISO-8601 or epoch ms.`);
      }

      const start = Math.max(floor, now);
      const gapMs = min_days * DAY_MS;
      const from = start - gapMs - DAY_MS;
      const to = start + 400 * DAY_MS;

      const commitments = await fetchCommitments(from, to);
      const sameVideo = commitments.filter((c) => c.video === video);

      // Hard constraint: this video's own hooks. Soft: everything else, which
      // only rules out landing on top of another post.
      const blocking = sameVideo.map((c) => c.at);
      const everything = commitments.map((c) => c.at);

      const slots: { scheduled_at: string; local: string; epoch_ms: number }[] = [];
      const startWall = utcToWall(start, tz);
      let cursor = wallToUtc({ ...startWall, hour: tod.hour, minute: tod.minute }, tz);
      while (cursor < start) cursor = addDays(cursor, 1, tz);

      const horizon = 400;
      for (let day = 0; day < horizon && slots.length < count; day++) {
        const clearOfVideo = blocking.every((t) => Math.abs(cursor - t) >= gapMs);
        const notStacked = everything.every((t) => Math.abs(cursor - t) >= HOUR_MS);
        if (clearOfVideo && notStacked) {
          const w = utcToWall(cursor, tz);
          slots.push({
            scheduled_at: `${w.year}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}`,
            local: formatWhen(cursor, tz),
            epoch_ms: cursor,
          });
          blocking.push(cursor);
          everything.push(cursor);
        }
        cursor = addDays(cursor, 1, tz);
      }

      const window = slots.length
        ? { lo: slots[0]!.epoch_ms - DAY_MS, hi: slots.at(-1)!.epoch_ms + DAY_MS }
        : { lo: start, hi: start + 7 * DAY_MS };

      const others = commitments
        .filter((c) => c.video !== video && c.at >= window.lo && c.at <= window.hi)
        .slice(0, 20)
        .map((c: Commitment) => ({ at: formatWhen(c.at, tz), caption: c.label.slice(0, 60), video: c.video }));

      const same = sameVideo.map((c) => ({
        at: formatWhen(c.at, tz),
        caption: c.label.slice(0, 60),
        status: c.status ?? "published",
      }));

      const lines = [settingsBanner(config), ""];
      if (slots.length < count) {
        lines.push(
          `Only found ${slots.length} of ${count} requested slot(s) within ${horizon} days at ${time_of_day}. ` +
            `Try a smaller min_days or a different time_of_day.`,
          ""
        );
      }
      lines.push(`Slots for "${video}", each ≥${min_days}d from this video's other hooks:`);
      lines.push(...slots.map((s) => `  ${s.local}   →  scheduled_at: "${s.scheduled_at}"`));

      if (same.length) {
        lines.push("", `Existing hooks of "${video}" (these set the spacing):`);
        lines.push(...same.map((c) => `  [${c.status}] ${c.at} — ${c.caption}`));
      } else {
        lines.push("", `No other hooks of "${video}" are on the calendar yet.`);
      }

      if (others.length) {
        lines.push("", "Other posts around these slots (did not block anything):");
        lines.push(...others.map((c) => `  ${c.at} — ${c.caption}${c.video ? ` [${c.video}]` : ""}`));
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
        structuredContent: {
          timezone: tz,
          video,
          min_days,
          slots,
          same_video_posts: same,
          other_posts_nearby: others,
        },
      };
    }
  );
}

const pad = (n: number) => String(n).padStart(2, "0");

function parseInstant(raw: string): number | null {
  if (/^\d+$/.test(raw)) return Number(raw);
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}
