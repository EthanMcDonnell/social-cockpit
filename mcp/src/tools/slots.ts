/**
 * Slot planning, against the cockpit's posting policy.
 *
 * Three rules, and they are deliberately different in kind:
 *
 * - **`min_same_video_days`** — hooks of one video share a body and a voiceover,
 *   so two of them close together land as near-duplicates and the later one is
 *   throttled. This is a same-content rule; two *different* videos on one day
 *   are fine.
 * - **`max_posts_per_day`** — a hard ceiling on the account's daily volume. It
 *   comes from the cockpit and is not negotiable here: the booking route
 *   enforces it too, so ignoring it would only produce slots that get rejected.
 * - **`suggested_times`** — where slots are offered by preference. A suggestion,
 *   overridable per call. More than one entry is how a day holds more than one
 *   post.
 *
 * All three live in the cockpit's settings so there is one place to change them.
 */

import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { cockpit } from "../cockpit.js";
import { formatWhen, settingsBanner } from "../format.js";
import { fetchCommitments, type Commitment } from "../commitments.js";
import {
  addDays,
  dayKey,
  pad,
  parseInstant,
  parseTimeOfDay,
  startOfDay,
  utcToWall,
  wallToUtc,
} from "../tz.js";
import { policy, type ScheduleSettings } from "../types.js";

const DAY_MS = 86_400_000;
/** Nothing may stack this close to an existing post. Not a cadence rule. */
const MIN_SEPARATION_MS = 3_600_000;
/** Give up rather than search forever on a pathologically full calendar. */
const SEARCH_HORIZON_DAYS = 400;

export function registerSlotTools(server: McpServer): void {
  server.registerTool(
    "suggest_slots",
    {
      title: "Suggest slots for one video",
      description:
        "Free times for the hooks of a single video, honouring the cockpit's posting policy: hooks of this video " +
        "stay min_same_video_days apart, no day exceeds max_posts_per_day, and slots are offered at the " +
        "configured suggested_times. Posts of OTHER videos never block a slot — two different videos may share a " +
        "day, up to the cap. Call get_calendar first if you want to see the week before choosing. Read-only: it " +
        "suggests times, it books nothing.",
      inputSchema: z.object({
        video: z
          .string()
          .describe(
            "The video these slots are for, e.g. the slug. Matched against the `video` tag on existing jobs."
          ),
        count: z.number().int().min(1).optional().describe("How many slots to find. Defaults to 1."),
        min_days: z
          .number()
          .min(0)
          .optional()
          .describe(
            "Override the configured minimum days between two hooks of this video. Omit to use the cockpit's setting."
          ),
        times: z
          .array(z.string())
          .optional()
          .describe(
            'Override the configured suggested times, as "HH:MM" in the cockpit\'s zone, e.g. ["09:30","18:00"]. ' +
              "Omit to use the cockpit's setting."
          ),
        earliest: z
          .string()
          .optional()
          .describe("Don't suggest anything before this (ISO-8601 or epoch ms). Defaults to now."),
      }),
      outputSchema: z.object({
        timezone: z.string(),
        video: z.string(),
        policy: z.object({
          min_same_video_days: z.number(),
          max_posts_per_day: z.number(),
          suggested_times: z.array(z.string()),
          source: z.string().describe("'cockpit' or 'defaults' when the cockpit supplied none."),
        }),
        slots: z.array(
          z.object({
            scheduled_at: z
              .string()
              .describe("Pass this straight to schedule_post — local wall time in the cockpit's zone."),
            local: z.string(),
            epoch_ms: z.number(),
          })
        ),
        same_video_posts: z.array(
          z.object({ at: z.string(), caption: z.string(), status: z.string() })
        ),
        days_at_capacity: z
          .array(z.string())
          .describe("Days skipped because they already hold max_posts_per_day posts."),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ video, count = 1, min_days, times, earliest }) => {
      const config = await cockpit<ScheduleSettings>("/api/schedule/settings");
      const tz = config.timezone;
      const p = policy(config);

      const wantedTimes = times?.length ? times : p.suggestedTimes;
      // Sorted, so a day's slots come back in the order they'll actually happen
      // however the setting happens to be written.
      const parsedTimes = wantedTimes
        .map((t) => {
          const parsed = parseTimeOfDay(t);
          if (!parsed) throw new Error(`times entries must look like "09:30", got "${t}".`);
          return parsed;
        })
        .sort((a, b) => a.hour - b.hour || a.minute - b.minute);

      const minDays = min_days ?? p.minSameVideoDays;
      const gapMs = minDays * DAY_MS;

      const now = Date.now();
      const floor = earliest ? parseInstant(earliest) : now;
      if (floor === null) {
        throw new Error(`Could not read earliest ("${earliest}"). Use ISO-8601 or epoch ms.`);
      }
      const start = Math.max(floor, now);

      const commitments = await fetchCommitments(
        start - gapMs - DAY_MS,
        start + SEARCH_HORIZON_DAYS * DAY_MS
      );
      const sameVideo = commitments.filter((c) => c.video === video);

      // Running state as slots are chosen, so suggestions are spaced from each
      // other and count toward their day's capacity too.
      const sameVideoAt = sameVideo.map((c) => c.at);
      const everythingAt = commitments.map((c) => c.at);
      const perDay = new Map<string, number>();
      for (const c of commitments) {
        const key = dayKey(c.at, tz);
        perDay.set(key, (perDay.get(key) ?? 0) + 1);
      }

      const slots: { scheduled_at: string; local: string; epoch_ms: number }[] = [];
      const fullDays = new Set<string>();

      let dayCursor = startOfDay(start, tz);

      for (let day = 0; day < SEARCH_HORIZON_DAYS && slots.length < count; day++) {
        const key = dayKey(dayCursor, tz);
        const wall = utcToWall(dayCursor, tz);

        for (const tod of parsedTimes) {
          if (slots.length >= count) break;

          const candidate = wallToUtc({ ...wall, hour: tod.hour, minute: tod.minute }, tz);
          // Times already past aren't slots, and a day made of nothing but those
          // isn't "full" — checking this first keeps today out of `fullDays`.
          if (candidate < start) continue;

          if ((perDay.get(key) ?? 0) >= p.maxPostsPerDay) {
            fullDays.add(key);
            break; // No time of day helps once the day itself is full.
          }

          if (!sameVideoAt.every((t) => Math.abs(candidate - t) >= gapMs)) continue;
          if (!everythingAt.every((t) => Math.abs(candidate - t) >= MIN_SEPARATION_MS)) continue;

          const w = utcToWall(candidate, tz);
          slots.push({
            scheduled_at: `${w.year}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}`,
            local: formatWhen(candidate, tz),
            epoch_ms: candidate,
          });
          sameVideoAt.push(candidate);
          everythingAt.push(candidate);
          perDay.set(key, (perDay.get(key) ?? 0) + 1);
        }

        dayCursor = addDays(dayCursor, 1, tz);
      }

      // Report the times actually searched, in the order they were searched.
      const searchedTimes = parsedTimes.map((t) => `${pad(t.hour)}:${pad(t.minute)}`);

      const same = sameVideo.map((c: Commitment) => ({
        at: formatWhen(c.at, tz),
        caption: c.label.slice(0, 60),
        status: c.status ?? "published",
      }));

      const lines = [settingsBanner(config), ""];
      if (p.fromDefaults) {
        lines.push(
          "⚠ The cockpit returned no posting policy (it's running a build without it), so these are this " +
            "server's own defaults. Rebuild the cockpit to have its settings apply.",
          ""
        );
      }
      lines.push(
        `Policy: ≤${p.maxPostsPerDay}/day · hooks of one video ≥${minDays}d apart · ` +
          `times ${searchedTimes.join(", ")}`,
        ""
      );

      if (slots.length < count) {
        lines.push(
          `Only found ${slots.length} of ${count} requested slot(s) within ${SEARCH_HORIZON_DAYS} days.`,
          ""
        );
      }
      lines.push(`Slots for "${video}":`);
      lines.push(...slots.map((s) => `  ${s.local}   →  scheduled_at: "${s.scheduled_at}"`));

      if (same.length) {
        lines.push("", `Existing hooks of "${video}" (these set the spacing):`);
        lines.push(...same.map((c) => `  [${c.status}] ${c.at} — ${c.caption}`));
      } else {
        lines.push("", `No other hooks of "${video}" are on the calendar yet.`);
      }

      if (fullDays.size) {
        lines.push(
          "",
          `Skipped as already at the ${p.maxPostsPerDay}/day limit: ${[...fullDays].sort().join(", ")}`
        );
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
        structuredContent: {
          timezone: tz,
          video,
          policy: {
            min_same_video_days: minDays,
            max_posts_per_day: p.maxPostsPerDay,
            suggested_times: searchedTimes,
            source: p.fromDefaults ? "defaults" : "cockpit",
          },
          slots,
          same_video_posts: same,
          days_at_capacity: [...fullDays].sort(),
        },
      };
    }
  );
}
