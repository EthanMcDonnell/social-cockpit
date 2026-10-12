/**
 * Read-only lookup of other accounts' posts, through Business Discovery.
 *
 * The counterpart to `list_top_posts` for someone else's account: what a creator
 * in the same niche actually got views on. Unlike that tool this is never
 * cached — every call is a live Graph request on the cockpit's Facebook token —
 * and it can only rank the most recent posts, because Meta returns them newest
 * first and offers no sort.
 */

import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { cockpit } from "../cockpit.js";
import type { DiscoveredAccount, DiscoveredPost } from "../types.js";

const engagement = (p: DiscoveredPost) =>
  p.view_count ? ((p.like_count ?? 0) + (p.comments_count ?? 0)) / p.view_count : 0;

const METRICS = {
  views: (p: DiscoveredPost) => p.view_count ?? 0,
  likes: (p: DiscoveredPost) => p.like_count ?? 0,
  comments: (p: DiscoveredPost) => p.comments_count ?? 0,
  engagement,
  recent: (p: DiscoveredPost) => Date.parse(p.timestamp) || 0,
} as const;

type Metric = keyof typeof METRICS;

function hookOf(caption: string | undefined): string {
  const line = caption?.split("\n")[0]?.trim() ?? "";
  return line.length > 80 ? `${line.slice(0, 79)}…` : line || "(no caption)";
}

export function registerDiscoveryTools(server: McpServer): void {
  server.registerTool(
    "list_account_posts",
    {
      title: "List another account's posts",
      description:
        "Another public Instagram Business or Creator account's recent posts, ranked by views, likes, comments, " +
        "engagement or recency, with each post's full caption. Use it to research what performs for creators in the " +
        "same niche — hooks, topics and formats worth borrowing for new video ideas. Only the most recent `scan` " +
        "posts are ranked (Meta returns them newest first). Personal accounts can't be looked up. `media_url` is the " +
        "video file when Meta allows it (it's withheld for licensed audio) and expires within days. Read-only; each " +
        "call is a live Graph API request.",
      inputSchema: z.object({
        username: z.string().describe("Instagram handle, with or without the @."),
        metric: z
          .enum(["views", "likes", "comments", "engagement", "recent"])
          .optional()
          .describe("Ranking metric. 'engagement' is (likes + comments) / views. Defaults to views."),
        limit: z.number().optional().describe("How many posts to return. Defaults to 10."),
        scan: z
          .number()
          .optional()
          .describe("How many recent posts to fetch before ranking, up to 200. Defaults to 50."),
        reels_only: z.boolean().optional().describe("Only rank reels. Defaults to true."),
      }),
      outputSchema: z.object({
        account: z.object({
          username: z.string(),
          name: z.string().optional(),
          followers: z.number(),
          media_count: z.number(),
          scanned: z.number(),
        }),
        metric: z.string(),
        posts: z.array(
          z.object({
            id: z.string(),
            hook: z.string().describe("First line of the caption."),
            caption: z.string(),
            published_at: z.string(),
            permalink: z.string().optional(),
            views: z.number(),
            likes: z.number(),
            comments: z.number(),
            engagement: z.number(),
            media_url: z.string().optional(),
          })
        ),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ username, metric = "views", limit = 10, scan = 50, reels_only = true }) => {
      const account = await cockpit<DiscoveredAccount>("/api/instagram/discovery", {
        query: { username, scan },
      });

      const pool = reels_only
        ? account.posts.filter((p) => p.media_product_type === "REELS")
        : account.posts;
      const rank = METRICS[metric as Metric];
      const posts = [...pool]
        .sort((a, b) => rank(b) - rank(a))
        .slice(0, limit)
        .map((p) => ({
          id: p.id,
          hook: hookOf(p.caption),
          caption: p.caption ?? "",
          published_at: p.timestamp,
          permalink: p.permalink,
          views: p.view_count ?? 0,
          likes: p.like_count ?? 0,
          comments: p.comments_count ?? 0,
          engagement: engagement(p),
          media_url: p.media_url,
        }));

      const summary = {
        username: account.username,
        name: account.name,
        followers: account.followers_count ?? 0,
        media_count: account.media_count ?? 0,
        scanned: account.posts.length,
      };

      const num = (n: number) => n.toLocaleString("en-US");
      const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
      const text = [
        `@${summary.username} · ${num(summary.followers)} followers · ${num(summary.media_count)} posts`,
        `Scanned the ${summary.scanned} most recent post(s)` +
          (reels_only ? `, ${pool.length} of them reels` : "") +
          ".",
        "",
        `Top ${posts.length} by ${metric}:`,
        ...posts.map(
          (p, i) =>
            `  ${i + 1}. ${p.hook}\n` +
            `     ${num(p.views)} views · ${num(p.likes)} likes · ${num(p.comments)} comments · ` +
            `${pct(p.engagement)} engagement\n` +
            `     ${p.published_at.slice(0, 10)}${p.permalink ? ` · ${p.permalink}` : ""}` +
            ` · video file ${p.media_url ? "available" : "withheld"}`
        ),
      ].join("\n");

      return {
        content: [{ type: "text" as const, text }],
        structuredContent: { account: summary, metric, posts },
      };
    }
  );
}
