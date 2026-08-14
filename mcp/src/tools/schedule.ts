/**
 * Scheduling tools — the reason this server exists.
 *
 * Each tool is a thin, validated wrapper over one `/api/schedule` route. The
 * cockpit already fails fast at schedule time (the time parses, the file exists,
 * the payload satisfies Instagram's rules, the automation spec is well-formed),
 * so these tools deliberately do not re-implement that validation. They shape
 * the arguments, forward them, and render the answer.
 */

import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { cockpit, CockpitError, runTimeout } from "../cockpit.js";
import { formatJob, formatWhen, settingsBanner } from "../format.js";
import type { ScheduleEvent, ScheduleSettings, ScheduledPostView } from "../types.js";

// ── shared shapes ────────────────────────────────────────────────────────────

const SCHEDULED_AT = z
  .string()
  .describe(
    "When to publish, ISO-8601. A bare local time ('2026-08-16T09:30') is read in the cockpit's configured timezone; " +
      "add an offset ('2026-08-16T09:30:00-05:00') to pin it. Must be in the future."
  );

const AUTOMATION = z
  .object({
    key: z
      .string()
      .describe(
        "Stable identifier for the comment-automation flow. Posts sharing a key join ONE flow — the first to " +
          "publish creates it and later ones append, so use the same key for every hook of a video."
      ),
    name: z.string().optional().describe("Display name, used only when the flow is created."),
    trigger_keywords: z
      .array(z.string())
      .optional()
      .describe("Comment keywords that fire the automation, e.g. ['LINK', 'GUIDE']."),
    template_type: z
      .enum(["comment_to_dm", "comment_to_reply", "comment_to_follow_dm"])
      .optional()
      .describe("Automation template. Defaults to comment_to_dm."),
    config: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Template config, e.g. { initial_message: '…', comment_replies: ['Sent 📩'] }."),
  })
  .describe("Optional comment automation attached at publish time, on the real media id.");

const POST_SPEC = {
  scheduled_at: SCHEDULED_AT,
  video: z
    .string()
    .optional()
    .describe(
      "Which video this post is a hook of, e.g. the slug. Always set it when scheduling hook variants: it is how " +
        "suggest_slots and get_calendar tell two hooks of one video apart from two unrelated posts, and so how " +
        "the near-duplicate spacing is enforced. Stored on the job and never sent to the platform."
    ),
  video_path: z
    .string()
    .optional()
    .describe(
      "Absolute path to the video on the machine running social-cockpit. The file is referenced in place and " +
        "stays on local disk until the slot arrives — nothing is uploaded at schedule time."
    ),
  image_path: z.string().optional().describe("Absolute path to an image, for a non-video post."),
  cover_path: z.string().optional().describe("Absolute path to a reel cover image."),
  caption: z.string().optional().describe("Post caption (Instagram)."),
  platform: z
    .enum(["ig", "yt"])
    .optional()
    .describe("Target platform. Defaults to 'ig' (Instagram)."),
  title: z.string().optional().describe("Video title. Required for YouTube, ignored for Instagram."),
  trial_reel: z
    .boolean()
    .optional()
    .describe(
      "Instagram only. Publish as a trial reel (shown to non-followers first, manual graduation). Defaults to true " +
        "for video posts, which is how this account posts hooks."
    ),
  share_to_feed: z.boolean().optional().describe("Instagram reels: also show in the main feed."),
  grace_minutes: z
    .number()
    .optional()
    .describe(
      "How late the job may still publish if the server was down at its slot. Past this it is retired as 'missed' " +
        "rather than posted at the wrong time. Defaults to the cockpit's setting (60)."
    ),
  automation: AUTOMATION.optional(),
} as const;

const JOB_SUMMARY = z.object({
  id: z.string(),
  status: z.string(),
  platform: z.string(),
  scheduled_at: z.number().describe("Epoch ms, UTC."),
  scheduled_at_local: z.string().describe("The same instant in the cockpit's timezone."),
  caption: z.string().optional(),
  video: z.string().optional().describe("The video this post is a hook of, if tagged."),
  files: z.array(z.string()),
  media_missing: z.boolean(),
});

type PostSpec = z.infer<z.ZodObject<typeof POST_SPEC>>;

/** Translate the tool's ergonomic shape into the cockpit's request body. */
function toRequestBody(spec: PostSpec): Record<string, unknown> {
  const { trial_reel, ...rest } = spec;
  const body: Record<string, unknown> = { ...rest };

  // The cockpit infers media_type: REELS from a lone video source, so the only
  // thing worth translating is the trial-reel shorthand.
  const wantsTrial = trial_reel ?? (spec.platform !== "yt" && !!spec.video_path);
  if (wantsTrial && spec.platform !== "yt") {
    body.trial_params = { graduation_strategy: "MANUAL" };
  }

  for (const key of Object.keys(body)) {
    if (body[key] === undefined) delete body[key];
  }
  return body;
}

function summarize(job: ScheduledPostView, timeZone: string) {
  return {
    id: job.id,
    status: job.status,
    platform: job.platform,
    scheduled_at: job.scheduled_at,
    scheduled_at_local: formatWhen(job.scheduled_at, timeZone),
    caption: job.payload.caption ?? job.payload.title,
    video: typeof job.payload.video === "string" ? job.payload.video : undefined,
    files: job.media_files.map((m) => m.filename),
    media_missing: job.media_missing,
  };
}

const settings = () => cockpit<ScheduleSettings>("/api/schedule/settings");

/** Tool results carry the human text and the machine payload in lockstep. */
function ok(text: string, structured: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text }],
    structuredContent: structured,
  };
}

// ── registration ─────────────────────────────────────────────────────────────

export function registerScheduleTools(server: McpServer): void {
  server.registerTool(
    "schedule_posts",
    {
      title: "Schedule posts",
      description:
        "Schedule posts to publish at future times via social-cockpit — one entry for a single post, or every hook " +
        "variant of a video in one call, which is the normal case. Each entry is independent and carries its own " +
        "time. Media files are referenced in place on the cockpit machine's disk and are not uploaded until the slot " +
        "arrives. Validation is immediate: a bad path, an unparseable time, or a malformed automation spec fails now " +
        "rather than at publish time. Entries are created in order and a failure does not roll back earlier " +
        "successes: the result lists what was scheduled and what was rejected, so retry only the rejected ones.",
      inputSchema: z.object({
        posts: z
          .array(z.object(POST_SPEC))
          .min(1)
          .describe("The posts to schedule, each with its own scheduled_at."),
      }),
      outputSchema: z.object({
        scheduled: z.array(JOB_SUMMARY),
        failed: z.array(
          z.object({
            index: z.number().describe("Position in the input array."),
            scheduled_at: z.string(),
            error: z.string(),
          })
        ),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ posts }) => {
      const config = await settings();
      const scheduled: ReturnType<typeof summarize>[] = [];
      const failed: { index: number; scheduled_at: string; error: string }[] = [];

      for (const [index, spec] of posts.entries()) {
        try {
          const { job } = await cockpit<{ job: ScheduledPostView }>("/api/schedule", {
            method: "POST",
            body: toRequestBody(spec),
          });
          scheduled.push(summarize(job, config.timezone));
        } catch (err) {
          if (!(err instanceof CockpitError)) throw err;
          // A one-entry batch has no partial success to report, and an error
          // buried in `failed` is easy to read past. Surface it as a tool
          // error instead, which a caller cannot overlook.
          if (posts.length === 1) throw err;
          failed.push({ index, scheduled_at: spec.scheduled_at, error: err.message });
        }
      }

      const lines = [
        settingsBanner(config),
        "",
        `Scheduled ${scheduled.length} of ${posts.length} post(s).`,
        ...scheduled.map((j) => `  ✓ ${j.scheduled_at_local} — ${j.caption ?? "(no caption)"} (${j.id})`),
      ];
      if (failed.length) {
        lines.push("", `Rejected ${failed.length}:`);
        lines.push(...failed.map((f) => `  ✗ [${f.index}] ${f.scheduled_at} — ${f.error}`));
      }

      return ok(lines.join("\n"), { scheduled, failed });
    }
  );

  server.registerTool(
    "list_scheduled_posts",
    {
      title: "List scheduled posts",
      description:
        "List scheduled posts, newest slot last. Filter by time window and status to answer questions like " +
        "'what goes out this week' or 'what failed'. Statuses: pending, publishing, finalizing, published, failed, " +
        "missed, cancelled, paused.",
      inputSchema: z.object({
        from: z
          .string()
          .optional()
          .describe("Window start, ISO-8601 or epoch ms. Omit for no lower bound."),
        to: z.string().optional().describe("Window end, ISO-8601 or epoch ms. Omit for no upper bound."),
        status: z
          .array(
            z.enum([
              "pending",
              "publishing",
              "finalizing",
              "published",
              "failed",
              "missed",
              "cancelled",
              "paused",
            ])
          )
          .optional()
          .describe("Only these statuses. Omit for all."),
        platform: z.enum(["ig", "yt"]).optional().describe("Only this platform. Omit for both."),
        limit: z.number().optional().describe("Max jobs to return. Defaults to 100, capped at 1000."),
      }),
      outputSchema: z.object({
        timezone: z.string(),
        count: z.number(),
        jobs: z.array(JOB_SUMMARY),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ from, to, status, platform, limit }) => {
      const config = await settings();
      const { jobs } = await cockpit<{ jobs: ScheduledPostView[] }>("/api/schedule", {
        query: {
          from,
          to,
          platform,
          limit: limit ?? 100,
          status: status?.join(","),
        },
      });

      const text = jobs.length
        ? `${settingsBanner(config)}\n\n${jobs.length} scheduled post(s):\n${jobs
            .map((j) => `  ${formatJob(j, config.timezone)}`)
            .join("\n")}`
        : `${settingsBanner(config)}\n\nNo scheduled posts match that filter.`;

      return ok(text, {
        timezone: config.timezone,
        count: jobs.length,
        jobs: jobs.map((j) => summarize(j, config.timezone)),
      });
    }
  );

  server.registerTool(
    "get_scheduled_post",
    {
      title: "Get a scheduled post",
      description:
        "Full detail on one scheduled post, including its event history — use this to find out why a job failed " +
        "or what the worker did with it.",
      inputSchema: z.object({ id: z.string().describe("The job id.") }),
      outputSchema: z.object({
        job: JOB_SUMMARY,
        events: z.array(
          z.object({ level: z.string(), kind: z.string(), message: z.string().optional(), created_at: z.string() })
        ),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ id }) => {
      const config = await settings();
      const { job, events } = await cockpit<{ job: ScheduledPostView; events: ScheduleEvent[] }>(
        `/api/schedule/${encodeURIComponent(id)}`
      );

      const history = events.length
        ? events.map((e) => `  ${e.created_at} [${e.level}] ${e.kind}: ${e.message ?? ""}`).join("\n")
        : "  (no events yet)";

      return ok(
        `${settingsBanner(config)}\n\n${formatJob(job, config.timezone)}\n\nHistory:\n${history}`,
        {
          job: summarize(job, config.timezone),
          events: events.map((e) => ({
            level: e.level,
            kind: e.kind,
            message: e.message,
            created_at: e.created_at,
          })),
        }
      );
    }
  );

  server.registerTool(
    "update_scheduled_post",
    {
      title: "Update a scheduled post",
      description:
        "Move a scheduled post to a new time, pause or resume it, or edit its caption and grace window. " +
        "Giving a new time to a job that already failed or was missed also revives it: attempts reset and it " +
        "returns to pending. A job that is currently publishing cannot be changed.",
      inputSchema: z.object({
        id: z.string().describe("The job id."),
        scheduled_at: SCHEDULED_AT.optional(),
        status: z
          .enum(["paused", "pending"])
          .optional()
          .describe("'paused' holds the job indefinitely; 'pending' resumes it."),
        caption: z.string().optional().describe("Replace the caption."),
        grace_minutes: z.number().optional().describe("Replace the grace window."),
      }),
      outputSchema: z.object({ job: JOB_SUMMARY }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ id, scheduled_at, status, caption, grace_minutes }) => {
      const config = await settings();
      const body: Record<string, unknown> = {};
      if (scheduled_at !== undefined) body.scheduled_at = scheduled_at;
      if (status !== undefined) body.status = status;
      if (grace_minutes !== undefined) body.grace_minutes = grace_minutes;
      if (caption !== undefined) body.payload = { caption };

      if (Object.keys(body).length === 0) {
        throw new CockpitError("invalid_param", "Nothing to update — pass at least one field to change.", 400);
      }

      const { job } = await cockpit<{ job: ScheduledPostView }>(`/api/schedule/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body,
      });

      return ok(`${settingsBanner(config)}\n\nUpdated:\n${formatJob(job, config.timezone)}`, {
        job: summarize(job, config.timezone),
      });
    }
  );

  server.registerTool(
    "cancel_scheduled_post",
    {
      title: "Cancel a scheduled post",
      description:
        "Cancel a scheduled post and delete any media the cockpit staged for it. Files referenced in place on disk " +
        "are never touched. This cannot be undone — the job is removed, not archived. A job that is currently " +
        "publishing cannot be cancelled.",
      inputSchema: z.object({ id: z.string().describe("The job id.") }),
      outputSchema: z.object({ id: z.string(), cancelled: z.boolean() }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ id }) => {
      await cockpit<{ ok: boolean }>(`/api/schedule/${encodeURIComponent(id)}`, { method: "DELETE" });
      return ok(`Cancelled scheduled post ${id}.`, { id, cancelled: true });
    }
  );

  server.registerTool(
    "run_scheduled_post_now",
    {
      title: "Publish a scheduled post now",
      description:
        "Publish a scheduled post immediately, ignoring its slot — for retrying a failed job or rescuing a missed " +
        "one. This posts to the live account right away and cannot be undone. The call blocks while the platform " +
        "processes the upload, which can take several minutes for a reel.",
      inputSchema: z.object({ id: z.string().describe("The job id.") }),
      outputSchema: z.object({ job: JOB_SUMMARY, permalink: z.string().optional() }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ id }) => {
      const config = await settings();
      const { job } = await cockpit<{ job: ScheduledPostView }>(
        `/api/schedule/${encodeURIComponent(id)}/run`,
        { method: "POST", timeoutMs: runTimeout }
      );

      return ok(`${settingsBanner(config)}\n\n${formatJob(job, config.timezone)}`, {
        job: summarize(job, config.timezone),
        permalink: job.result?.permalink ?? job.result?.watch_url,
      });
    }
  );
}
