/**
 * Read-only analytics.
 *
 * One tool, not several: the useful question is almost always "what actually
 * performed, ranked by X", and the account totals are cheap enough to fold into
 * the same answer rather than spend a second tool slot on. Everything is served
 * from the cockpit's local cache, so this costs no Graph API quota unless the
 * cache has gone stale — and this server never forces a refresh.
 */

import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { cockpit } from "../cockpit.js";
import type { PostListItem, PostsSummary } from "../types.js";

/** The metrics worth ranking by, mapped to how each is read off a post. */
const METRICS = {
  views: (p: PostListItem) => p.insights?.views ?? 0,
  reach: (p: PostListItem) => p.insights?.reach ?? 0,
  likes: (p: PostListItem) => p.insights?.likes ?? p.likeCount ?? 0,
  comments: (p: PostListItem) => p.insights?.comments ?? p.commentsCount ?? 0,
  shares: (p: PostListItem) => p.insights?.shares ?? 0,
  saved: (p: PostListItem) => p.insights?.saved ?? 0,
  total_interactions: (p: PostListItem) => p.insights?.total_interactions ?? 0,
  recent: (p: PostListItem) => Date.parse(p.timestamp) || 0,
} as const;

type Metric = keyof typeof METRICS;

function hookOf(caption: string | null): string {
  const line = caption?.split("\n")[0]?.trim() ?? "";
  return line.length > 80 ? `${line.slice(0, 79)}…` : line || "(no caption)";
}

export function registerAnalyticsTools(server: McpServer): void {
  server.registerTool(
    "list_top_posts",
    {
      title: "List top posts",
      description:
        "Published Instagram posts ranked by a performance metric, with account totals. Use it to ground decisions " +
        "about what to post or when — for example finding which hooks earned the most views before scheduling more " +
        "like them. Served from the cockpit's local cache, so it is cheap and works offline. Read-only: it never " +
        "publishes, edits, or refreshes anything.",
      inputSchema: z.object({
        metric: z
          .enum(["views", "reach", "likes", "comments", "shares", "saved", "total_interactions", "recent"])
          .optional()
          .describe("Ranking metric. 'recent' sorts by publish date instead. Defaults to views."),
        limit: z.number().optional().describe("How many posts to return. Defaults to 10."),
        media_type: z
          .string()
          .optional()
          .describe("Restrict to one media type, e.g. 'REEL', 'VIDEO', 'IMAGE', 'CAROUSEL_ALBUM'."),
      }),
      outputSchema: z.object({
        metric: z.string(),
        account_totals: z.object({
          posts: z.number(),
          views: z.number(),
          reach: z.number(),
          likes: z.number(),
          comments: z.number(),
          shares: z.number(),
          saved: z.number(),
        }),
        posts: z.array(
          z.object({
            id: z.string(),
            hook: z.string().describe("First line of the caption."),
            media_type: z.string(),
            published_at: z.string(),
            permalink: z.string().optional(),
            views: z.number(),
            reach: z.number(),
            likes: z.number(),
            comments: z.number(),
            shares: z.number(),
            saved: z.number(),
          })
        ),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        // Reads the cockpit's cache, which refreshes itself from the Graph API.
        openWorldHint: true,
      },
    },
    async ({ metric = "views", limit = 10, media_type }) => {
      const query: Record<string, string | undefined> = { all: "true" };
      if (media_type) query.mediaType = media_type.toUpperCase();

      const [{ data }, summary] = await Promise.all([
        cockpit<{ data: PostListItem[] }>("/api/posts", { query }),
        cockpit<PostsSummary>("/api/posts/summary", {
          query: media_type ? { mediaType: media_type.toUpperCase() } : {},
        }),
      ]);

      const rank = METRICS[metric as Metric];
      const top = [...data].sort((a, b) => rank(b) - rank(a)).slice(0, limit);

      const posts = top.map((p) => ({
        id: p.id,
        hook: hookOf(p.caption),
        media_type: p.mediaType,
        published_at: p.timestamp,
        permalink: p.permalink,
        views: p.insights?.views ?? 0,
        reach: p.insights?.reach ?? 0,
        likes: p.insights?.likes ?? p.likeCount ?? 0,
        comments: p.insights?.comments ?? p.commentsCount ?? 0,
        shares: p.insights?.shares ?? 0,
        saved: p.insights?.saved ?? 0,
      }));

      const account_totals = {
        posts: summary.total,
        views: summary.totals.views,
        reach: summary.totals.reach,
        likes: summary.totals.likes,
        comments: summary.totals.comments,
        shares: summary.totals.shares,
        saved: summary.totals.saved,
      };

      const num = (n: number) => n.toLocaleString("en-US");
      const text = [
        `${num(account_totals.posts)} published post(s) · ${num(account_totals.views)} views · ` +
          `${num(account_totals.likes)} likes · ${num(account_totals.comments)} comments`,
        "",
        `Top ${posts.length} by ${metric}:`,
        ...posts.map(
          (p, i) =>
            `  ${i + 1}. ${p.hook}\n` +
            `     ${num(p.views)} views · ${num(p.reach)} reach · ${num(p.likes)} likes · ` +
            `${num(p.comments)} comments · ${num(p.shares)} shares · ${num(p.saved)} saved` +
            `\n     ${p.media_type} · ${p.published_at.slice(0, 10)}${p.permalink ? ` · ${p.permalink}` : ""}`
        ),
      ].join("\n");

      return {
        content: [{ type: "text" as const, text }],
        structuredContent: { metric, account_totals, posts },
      };
    }
  );
}
