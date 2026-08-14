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
import { utcToWall, wallToUtc } from "../tz.js";
import type { ScheduleSettings } from "../types.js";

const DAY_MS = 86_400_000;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export function registerCalendarTools(server: McpServer): void {
  server.registerTool(
    "get_calendar",
    {
      title: "Get the posting calendar",
      description:
        "What the calendar actually looks like, day by day: everything already published and everything " +
        "already scheduled, in the cockpit's timezone. Read this before scheduling anything, so the choice of " +
        "slot accounts for what is really there — including posts made outside the scheduler. Each entry names " +
        "the video it belongs to when the job was tagged, which is how you tell two hooks of the same video apart " +
        "from two unrelated posts.",
      inputSchema: z.object({
        days: z
          .number()
          .optional()
          .describe("How many days forward from `from`. Defaults to 7."),
        from: z
          .string()
          .optional()
          .describe("Start of the window, ISO-8601 or epoch ms. Defaults to the start of today."),
        include_past_days: z
          .number()
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
      const anchorWall = utcToWall(anchor, tz);
      const startOfDay = wallToUtc({ ...anchorWall, hour: 0, minute: 0 }, tz);

      const windowStart = startOfDay - include_past_days * DAY_MS;
      const windowEnd = startOfDay + days * DAY_MS;

      const commitments = await fetchCommitments(windowStart, windowEnd);

      // Bucket by calendar date in the target zone.
      const buckets = new Map<string, typeof commitments>();
      for (const c of commitments) {
        const w = utcToWall(c.at, tz);
        const key = `${w.year}-${pad(w.month)}-${pad(w.day)}`;
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

      for (let offset = -include_past_days; offset < days; offset++) {
        const dayStart = startOfDay + offset * DAY_MS;
        const w = utcToWall(dayStart, tz);
        const key = `${w.year}-${pad(w.month)}-${pad(w.day)}`;
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
          weekday: WEEKDAYS[new Date(dayStart).getUTCDay()] ?? "",
          is_past: dayStart + DAY_MS <= now,
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

const pad = (n: number) => String(n).padStart(2, "0");

function parseInstant(raw: string): number | null {
  if (/^\d+$/.test(raw)) return Number(raw);
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}
