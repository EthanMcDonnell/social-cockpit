/**
 * The calendar view.
 *
 * Deliberately descriptive rather than prescriptive: it reports what the next
 * week actually looks like and leaves the choice of where to slot something in
 * to the caller. Encoding a posting cadence in config would fix a policy in
 * place; showing the week lets the decision account for whatever is actually
 * there.
 */

import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { cockpit } from "../cockpit.js";
import { settingsBanner } from "../format.js";
import { fetchCommitments } from "../commitments.js";
import { addDays, dayKey, pad, parseInstant, startOfDay, utcToWall, wallDayOfWeek } from "../tz.js";
import type { ScheduleSettings } from "../types.js";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export function registerCalendarTools(server: McpServer): void {
  server.registerTool(
    "get_calendar",
    {
      title: "Get the posting calendar",
      description:
        "What the calendar actually looks like, day by day: everything already published and everything " +
        "already scheduled, in the cockpit's timezone. Read this before scheduling anything, so the choice of " +
        "slot accounts for what is really there — including posts made outside the scheduler. Tagged jobs include " +
        "their video identifier to help group related hook variants.",
      inputSchema: z.object({
        days: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("How many days forward from `from`. Defaults to 7."),
        from: z
          .string()
          .optional()
          .describe("Start of the window, ISO-8601 or epoch ms. Defaults to the start of today."),
        include_past_days: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe(
            "Also show this many days before `from`. Useful for seeing what just went out. Defaults to 2."
          ),
      }),
      outputSchema: z.object({
        timezone: z.string(),
        from: z.string(),
        to: z.string(),
        days: z.array(
          z.object({
            date: z.string().describe("YYYY-MM-DD in the cockpit's zone."),
            weekday: z.string(),
            is_past: z.boolean(),
            entries: z.array(
              z.object({
                time: z.string().describe("HH:MM in the cockpit's zone."),
                scheduled_at: z.number().describe("Epoch ms."),
                status: z.string(),
                source: z.string().describe("'job' = known to the scheduler, 'history' = published post."),
                video: z.string().optional().describe("The video this is a hook of, if tagged."),
                caption: z.string(),
                id: z.string().optional(),
              })
            ),
          })
        ),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ days = 7, from, include_past_days = 2 }) => {
      const config = await cockpit<ScheduleSettings>("/api/schedule/settings");
      const tz = config.timezone;

      const anchor = from ? parseInstant(from) : Date.now();
      if (anchor === null) {
        throw new Error(`Could not read from ("${from}"). Use ISO-8601 or epoch ms.`);
      }

      // Snap to midnight in the cockpit's zone so days line up with the calendar
      // the user sees, not with UTC.
      const anchorDay = startOfDay(anchor, tz);

      // Walk the window a wall-clock day at a time. A day is not 24 hours on a
      // DST boundary, so stepping by 86_400_000 would repeat one date and drop
      // the last — every boundary in `dayStarts` is resolved through the zone.
      const dayStarts: number[] = [];
      let cursor = addDays(anchorDay, -include_past_days, tz);
      for (let i = 0; i < include_past_days + days; i++) {
        dayStarts.push(cursor);
        cursor = addDays(cursor, 1, tz);
      }
      const windowStart = dayStarts[0] ?? anchorDay;
      const windowEnd = cursor; // Midnight after the last day, exclusive.

      const commitments = await fetchCommitments(windowStart, windowEnd);

      // Bucket by calendar date in the target zone.
      const buckets = new Map<string, typeof commitments>();
      for (const c of commitments) {
        const key = dayKey(c.at, tz);
        const list = buckets.get(key) ?? [];
        list.push(c);
        buckets.set(key, list);
      }

      const now = Date.now();
      const out: {
        date: string;
        weekday: string;
        is_past: boolean;
        entries: {
          time: string;
          scheduled_at: number;
          status: string;
          source: string;
          video?: string;
          caption: string;
          id?: string;
        }[];
      }[] = [];

      for (const [index, dayStart] of dayStarts.entries()) {
        const w = utcToWall(dayStart, tz);
        const key = dayKey(dayStart, tz);
        const dayEnd = dayStarts[index + 1] ?? windowEnd;
        const entries = (buckets.get(key) ?? []).map((c) => {
          const t = utcToWall(c.at, tz);
          return {
            time: `${pad(t.hour)}:${pad(t.minute)}`,
            scheduled_at: c.at,
            status: c.status ?? "published",
            source: c.source,
            video: c.video,
            caption: c.label.slice(0, 70),
            id: c.id,
          };
        });
        out.push({
          date: key,
          weekday: WEEKDAYS[wallDayOfWeek(w)] ?? "",
          is_past: dayEnd <= now,
          entries,
        });
      }

      const lines = [settingsBanner(config), ""];
      for (const day of out) {
        const marker = day.is_past ? " " : "›";
        if (!day.entries.length) {
          lines.push(`${marker} ${day.weekday} ${day.date}   —`);
          continue;
        }
        lines.push(`${marker} ${day.weekday} ${day.date}`);
        for (const e of day.entries) {
          const tag = e.video ? `  [${e.video}]` : "";
          lines.push(`      ${e.time}  ${e.status.padEnd(9)} ${e.caption}${tag}`);
        }
      }

      const total = out.reduce((n, d) => n + d.entries.length, 0);
      lines.push("", `${total} post(s) across ${out.length} day(s). "›" marks days not yet finished.`);

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
        structuredContent: {
          timezone: tz,
          from: new Date(windowStart).toISOString(),
          to: new Date(windowEnd).toISOString(),
          days: out,
        },
      };
    }
  );
}
