/**
 * Slot planning.
 *
 * The calendar itself is the authority on when something can go out — not any
 * local file. This asks the cockpit what is already published and what is
 * already booked, then walks forward to find times that clear both by a minimum
 * gap.
 *
 * The gap exists because near-identical reels posted close together get
 * clustered as duplicates and throttled, so a slot has to clear its neighbours
 * on *both* sides: booking into a hole that is two days after the last post but
 * one hour before the next scheduled one is exactly the mistake this prevents.
 */

import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { cockpit } from "../cockpit.js";
import { formatWhen, settingsBanner } from "../format.js";
import { addDays, parseTimeOfDay, utcToWall, wallToUtc } from "../tz.js";
import type { ScheduleSettings, ScheduledPostView } from "../types.js";

const DAY_MS = 86_400_000;

/** Something already committed to the calendar, published or booked. */
interface Commitment {
  at: number;
  kind: "published" | "scheduled";
  label: string;
}

interface HistoryEntry {
  published_at: number;
  title: string;
}

/** Statuses that still occupy a slot. A cancelled or failed job does not. */
const LIVE_STATUSES = ["pending", "paused", "publishing", "finalizing"] as const;

export function registerSlotTools(server: McpServer): void {
  server.registerTool(
    "suggest_slots",
    {
      title: "Suggest posting slots",
      description:
        "Find the next free posting slots on the real calendar. Reads what is already published and what is " +
        "already scheduled, then returns times that clear every neighbour on both sides by at least gap_days. " +
        "Use this to decide when to schedule something — never compute slots by hand, because only the cockpit " +
        "knows what is actually booked. Read-only: it suggests times, it does not book anything.",
      inputSchema: z.object({
        count: z.number().optional().describe("How many slots to find. Defaults to 1."),
        gap_days: z
          .number()
          .optional()
          .describe(
            "Minimum days a slot must clear every published and scheduled post by, on both sides. Defaults to 2, " +
              "which is the spacing that keeps near-duplicate reels from being throttled."
          ),
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
        gap_days: z.number(),
        slots: z.array(
          z.object({
            scheduled_at: z
              .string()
              .describe("Pass this straight to schedule_post — local wall time in the cockpit's zone."),
            local: z.string().describe("The same slot, spelled out for a human."),
            epoch_ms: z.number(),
          })
        ),
        committed: z
          .array(
            z.object({
              at: z.string(),
              kind: z.string().describe("'published' or 'scheduled'."),
              label: z.string(),
            })
          )
          .describe("What the suggestions were fitted around, nearest first."),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ count = 1, gap_days = 2, time_of_day = "09:30", earliest }) => {
      const config = await cockpit<ScheduleSettings>("/api/schedule/settings");
      const tz = config.timezone;

      const tod = parseTimeOfDay(time_of_day);
      if (!tod) {
        throw new Error(`time_of_day must look like "09:30", got "${time_of_day}".`);
      }

      const now = Date.now();
      const floor = earliest ? parseInstant(earliest) : now;
      if (floor === null) {
        throw new Error(`Could not read earliest ("${earliest}"). Use ISO-8601 or epoch ms.`);
      }

      // Look back far enough to catch a recent post that still blocks a slot,
      // and forward far enough to see the whole booked queue.
      const gapMs = gap_days * DAY_MS;
      const from = Math.min(now, floor) - gapMs - DAY_MS;
      const to = Math.max(now, floor) + 400 * DAY_MS;

      const [history, scheduled] = await Promise.all([
        cockpit<{ posts: HistoryEntry[] }>("/api/schedule/history", { query: { from, to } }),
        cockpit<{ jobs: ScheduledPostView[] }>("/api/schedule", {
          query: { from, to, status: LIVE_STATUSES.join(","), limit: 1000 },
        }),
      ]);

      const committed: Commitment[] = [
        ...history.posts.map((p) => ({
          at: p.published_at,
          kind: "published" as const,
          label: p.title,
        })),
        ...scheduled.jobs.map((j) => ({
          at: j.scheduled_at,
          kind: "scheduled" as const,
          label: (j.payload.caption ?? j.payload.title ?? "(no caption)").split("\n")[0] ?? "",
        })),
      ].sort((a, b) => a.at - b.at);

      // Walk day by day from the floor, taking the first candidate that clears
      // everything already taken. Each accepted slot joins the set, so the
      // suggestions are spaced from each other too.
      const taken = committed.map((c) => c.at);
      const slots: { scheduled_at: string; local: string; epoch_ms: number }[] = [];

      const startWall = utcToWall(Math.max(floor, now), tz);
      let cursor = wallToUtc({ ...startWall, hour: tod.hour, minute: tod.minute }, tz);
      // Never suggest a time that has already passed today.
      while (cursor < Math.max(floor, now)) cursor = addDays(cursor, 1, tz);

      // Bounded so a pathologically dense calendar can't spin forever.
      const horizon = 400;
      for (let day = 0; day < horizon && slots.length < count; day++) {
        const clear = taken.every((t) => Math.abs(cursor - t) >= gapMs);
        if (clear) {
          const w = utcToWall(cursor, tz);
          slots.push({
            scheduled_at:
              `${w.year}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}`,
            local: formatWhen(cursor, tz),
            epoch_ms: cursor,
          });
          taken.push(cursor);
        }
        cursor = addDays(cursor, 1, tz);
      }

      const nearby = committed
        .filter((c) => c.at >= from && c.at <= (slots.at(-1)?.epoch_ms ?? to) + gapMs)
        .slice(-12)
        .map((c) => ({ at: formatWhen(c.at, tz), kind: c.kind, label: c.label.slice(0, 60) }));

      const lines = [settingsBanner(config), ""];
      if (slots.length < count) {
        lines.push(
          `Only found ${slots.length} of ${count} requested slot(s) within ${horizon} days at ${time_of_day}. ` +
            `Try a smaller gap_days or a different time_of_day.`,
          ""
        );
      }
      lines.push(`Next free slot(s), clearing everything by ${gap_days} day(s):`);
      lines.push(...slots.map((s) => `  ${s.local}   →  scheduled_at: "${s.scheduled_at}"`));
      if (nearby.length) {
        lines.push("", "Fitted around:");
        lines.push(...nearby.map((c) => `  [${c.kind}] ${c.at} — ${c.label}`));
      } else {
        lines.push("", "Nothing published or scheduled nearby — the calendar is clear.");
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
        structuredContent: { timezone: tz, gap_days, slots, committed: nearby },
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
