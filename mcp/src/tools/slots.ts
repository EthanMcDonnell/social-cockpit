/**
 * Slot planning, against the cockpit's posting policy.
 *
 * Two rules, and they are deliberately different in kind:
 *
 * - **`max_posts_per_day`** — a hard ceiling on the account's daily volume. It
 *   comes from the cockpit and is not negotiable here: the booking route
 *   enforces it too, so ignoring it would only produce slots that get rejected.
 * - **`suggested_times`** — where slots are offered by preference. A suggestion,
 *   overridable per call. More than one entry is how a day holds more than one
 *   post.
 *
 * Both live in the cockpit's settings so there is one place to change them.
 */

import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { cockpit } from "../cockpit.js";
import { formatWhen, settingsBanner } from "../format.js";
import { fetchCommitments } from "../commitments.js";
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
/** Give up rather than search forever on a pathologically full calendar. */
const SEARCH_HORIZON_DAYS = 400;

export function registerSlotTools(server: McpServer): void {
  server.registerTool(
    "suggest_slots",
    {
      title: "Suggest posting slots",
      description:
        "Free times that honour the cockpit's posting policy: no day exceeds max_posts_per_day, and slots are " +
        "offered at the configured suggested_times. Call get_calendar first if you want to see the week before " +
        "choosing. Read-only: it suggests times, it books nothing.",
      inputSchema: z.object({
        count: z.number().int().min(1).optional().describe("How many slots to find. Defaults to 1."),
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
        policy: z.object({
          max_posts_per_day: z.number(),
          suggested_times: z.array(z.string()),
          source: z.string().describe("'cockpit' or 'defaults' when the cockpit supplied none."),
        }),
        slots: z.array(
          z.object({
            scheduled_at: z
              .string()
              .describe("Pass this straight to schedule_posts — local wall time in the cockpit's zone."),
            local: z.string(),
            epoch_ms: z.number(),
          })
        ),
        days_at_capacity: z
          .array(z.string())
          .describe("Days skipped because they already hold max_posts_per_day posts."),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ count = 1, times, earliest }) => {
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

      const now = Date.now();
      const floor = earliest ? parseInstant(earliest) : now;
      if (floor === null) {
        throw new Error(`Could not read earliest ("${earliest}"). Use ISO-8601 or epoch ms.`);
      }
      const start = Math.max(floor, now);

      // Commitments establish daily usage. Posting policy intentionally imposes
      // no global collision/cadence buffer beyond max_posts_per_day.
      const commitments = await fetchCommitments(
        startOfDay(start, tz),
        start + SEARCH_HORIZON_DAYS * DAY_MS
      );

      // Running state as slots are chosen, so they count toward daily capacity.

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

          const w = utcToWall(candidate, tz);
          slots.push({
            scheduled_at: `${w.year}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}`,
            local: formatWhen(candidate, tz),
            epoch_ms: candidate,
          });
          perDay.set(key, (perDay.get(key) ?? 0) + 1);
        }

        dayCursor = addDays(dayCursor, 1, tz);
      }

      // Report the times actually searched, in the order they were searched.
      const searchedTimes = parsedTimes.map((t) => `${pad(t.hour)}:${pad(t.minute)}`);

      const lines = [settingsBanner(config), ""];
      if (p.fromDefaults) {
        lines.push(
          "⚠ The cockpit returned no posting policy (it's running a build without it), so these are this " +
            "server's own defaults. Rebuild the cockpit to have its settings apply.",
          ""
        );
      }
      lines.push(`Policy: ≤${p.maxPostsPerDay}/day · times ${searchedTimes.join(", ")}`, "");

      if (slots.length < count) {
        lines.push(
          `Only found ${slots.length} of ${count} requested slot(s) within ${SEARCH_HORIZON_DAYS} days.`,
          ""
        );
      }
      lines.push("Slots:");
      lines.push(...slots.map((s) => `  ${s.local}   →  scheduled_at: "${s.scheduled_at}"`));

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
          policy: {
            max_posts_per_day: p.maxPostsPerDay,
            suggested_times: searchedTimes,
            source: p.fromDefaults ? "defaults" : "cockpit",
          },
          slots,
          days_at_capacity: [...fullDays].sort(),
        },
      };
    }
  );
}
