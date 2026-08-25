/**
 * Content pools — read-only.
 *
 * `schedule_posts` can already book a slot against a slug and let the worker
 * pick the video at fire time. What it cannot do is answer the question that
 * always comes just before that booking: *which* video would go out, and is
 * there one left at all. This tool asks the cockpit, which runs the real
 * selector rather than a description of it, so the answer here and the 9:30
 * decision cannot disagree.
 *
 * One tool, not two. Without a slug it lists the pools; with one it opens that
 * pool. The listing is the only useful way to find a slug you half-remember,
 * and it is small enough that splitting it off would cost a tool slot to say
 * almost nothing.
 */

import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { cockpit } from "../cockpit.js";
import type { SlugDetailResponse, SlugListResponse, SlugVideoView } from "../types.js";

const VIDEO = z.object({
  id: z.string(),
  filename: z.string(),
  label: z.string().optional(),
  views: z.number().optional().describe("Summed across every platform it has been posted to."),
  engagement: z.number().optional().describe("Interactions per view, 0–1."),
  scored: z.boolean().describe("False when nothing has been posted yet, or no metrics were found."),
  missing: z.boolean().describe("The file has moved or been deleted since it was enrolled."),
  posted_to: z.array(z.string()).describe("Platforms it has already run on, so it is out of their pools."),
});

function toVideo(v: SlugVideoView) {
  return {
    id: v.id,
    filename: v.filename,
    label: v.label,
    views: v.views,
    engagement: v.engagement,
    scored: v.scored,
    missing: v.missing,
    posted_to: [...new Set(v.posts.map((p) => p.platform))],
  };
}

const num = (n: number) => n.toLocaleString("en-US");

function describe(v: ReturnType<typeof toVideo>): string {
  const parts = [v.label ?? v.filename];
  if (v.scored) {
    parts.push(`${num(v.views ?? 0)} views`);
    if (v.engagement !== undefined) parts.push(`${(v.engagement * 100).toFixed(1)}% engagement`);
  } else {
    parts.push("unscored");
  }
  if (v.posted_to.length) parts.push(`posted to ${v.posted_to.join(", ")}`);
  if (v.missing) parts.push("FILE MISSING");
  return parts.join(" · ");
}

export function registerSlugTools(server: McpServer): void {
  server.registerTool(
    "get_slug_pool",
    {
      title: "Get slug pool",
      description:
        "Inspect a content pool: which videos it holds, how each has performed, how many are still eligible for " +
        "each platform, and — the point of it — which one would actually go out if a slot booked against this slug " +
        "fired right now. Call it before booking a slug-only post with schedule_posts, and to confirm a cross-post " +
        "has something to draw from. Omit `slug` to list every pool. Read-only.",
      inputSchema: z.object({
        slug: z
          .string()
          .optional()
          .describe("The pool to open. Omit to list every pool with its candidate counts."),
        platform: z
          .enum(["ig", "yt"])
          .optional()
          .describe(
            "Which platform the pick is for. A video already posted to that platform is never picked for it " +
              "again, so the answer differs per platform. Defaults to 'ig'."
          ),
      }),
      outputSchema: z.object({
        default_selection: z.string().optional().describe("The cockpit-wide default, when listing."),
        slugs: z
          .array(
            z.object({
              slug: z.string(),
              video_count: z.number(),
              eligible_ig: z.number(),
              eligible_yt: z.number(),
              selection_method: z.string().optional().describe("This pool's override, if it has one."),
              automation: z.string().optional().describe("The comment flow sharing this slug's name."),
            })
          )
          .optional(),
        slug: z.string().optional(),
        effective_method: z
          .string()
          .optional()
          .describe("What will actually run, after job → slug → cockpit default."),
        eligible: z.number().optional().describe("Candidates still eligible for the chosen platform."),
        next_up: z
          .object({ video: VIDEO, reason: z.string(), considered: z.number() })
          .optional()
          .describe("The pick the worker would make now. Absent when the pool can produce nothing."),
        blocked: z
          .object({ error: z.string(), exhausted: z.boolean() })
          .optional()
          .describe("Why there is no pick. `exhausted` means every video has already run on this platform."),
        videos: z.array(VIDEO).optional(),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ slug, platform = "ig" }) => {
      if (!slug) {
        const { default_selection, slugs } = await cockpit<SlugListResponse>("/api/slugs");
        const rows = slugs.map((s) => ({
          slug: s.slug,
          video_count: s.video_count,
          eligible_ig: s.eligible.ig,
          eligible_yt: s.eligible.yt,
          selection_method: s.selection_method,
          automation: s.automation?.name,
        }));
        const text = rows.length
          ? [
              `${rows.length} pool(s) · default selection: ${default_selection}`,
              ...rows.map(
                (r) =>
                  `  ${r.slug} — ${r.video_count} video(s) · ${r.eligible_ig} left for ig, ` +
                  `${r.eligible_yt} for yt` +
                  (r.selection_method ? ` · picks by ${r.selection_method}` : "") +
                  (r.automation ? ` · automation "${r.automation}"` : "")
              ),
            ].join("\n")
          : "No content pools yet.";
        return {
          content: [{ type: "text" as const, text }],
          structuredContent: { default_selection, slugs: rows },
        };
      }

      const detail = await cockpit<SlugDetailResponse>(`/api/slugs/${encodeURIComponent(slug)}`, {
        query: { platform },
      });

      const videos = detail.slug.videos.map(toVideo);
      const eligible = detail.slug.eligible[platform];
      const next = detail.next_up
        ? { video: toVideo(detail.next_up.video), reason: detail.next_up.reason, considered: detail.next_up.considered }
        : undefined;

      const text = [
        `${detail.slug.slug} — ${videos.length} video(s), ${eligible} eligible for ${platform} · ` +
          `picks by ${detail.effective_method}`,
        next
          ? `Next up on ${platform}: ${describe(next.video)}\n  ${next.reason} (from ${next.considered} eligible)`
          : `Next up on ${platform}: nothing — ${detail.blocked?.error ?? "no candidate"}`,
        "",
        "Pool:",
        ...videos.map((v) => `  ${describe(v)}`),
      ].join("\n");

      return {
        content: [{ type: "text" as const, text }],
        structuredContent: {
          slug: detail.slug.slug,
          effective_method: detail.effective_method,
          eligible,
          next_up: next,
          blocked: detail.blocked ?? undefined,
          videos,
        },
      };
    }
  );
}
