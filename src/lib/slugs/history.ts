/**
 * What has already been published under a slug.
 *
 * A pool holds local files that can be posted. A slug on an established account
 * also has *history* — posts already live, with real view counts — and until
 * something says which local file produced which post, none of that performance
 * is usable: selection would rank a clip that did 24k as unscored.
 *
 * This is the list that closes that gap. It answers "what has gone out under
 * this slug, and which of those posts does a pool candidate claim", so the file
 * behind a post can be pointed at it once and be ranked on it forever after.
 *
 * Two sources, deduplicated by external id:
 *   - the automation flow's target list, which is where every keyed post landed
 *     before this feature existed;
 *   - the ledger itself, for posts this app recorded.
 *
 * Server-side only.
 */

import { getDb, rowToFlow, type AutomationFlowRow } from "@/lib/db";
import { getCachedInsightsMany, getCachedMedia } from "@/lib/cache/store";
import type { SchedulePlatform } from "@/lib/schedule/types";
import type { SlugPost } from "./types";

export type { SlugPost };

/**
 * Media ids wired to the automation flows that share this slug.
 *
 * Every flow, not the first one found: a topic can carry several, and taking
 * one of them would drop the others' posts out of the history the pool page
 * ranks on.
 *
 * Resolved through rowToFlow rather than by reading config.media_ids directly,
 * because that is only one of the two places a target is stored — a flow made
 * before the multi-video field keeps its post in the media_id column, and
 * parsing the config alone reports it as targeting nothing.
 */
function automationMediaIds(slug: string): string[] {
  const rows = getDb()
    .prepare("SELECT * FROM automation_flows WHERE automation_key = ? ORDER BY created_at, id")
    .all(slug) as AutomationFlowRow[];

  const ids = new Set<string>();
  for (const row of rows) {
    for (const id of rowToFlow(row).media_ids) ids.add(id);
  }
  return Array.from(ids);
}

export function slugPostHistory(slug: string): SlugPost[] {
  const linked = getDb()
    .prepare(
      `SELECT p.platform, p.external_id, p.video_id, v.label, v.path
         FROM slug_video_posts p
         JOIN slug_videos v ON v.id = p.video_id
        WHERE v.slug = ?`
    )
    .all(slug) as {
      platform: string;
      external_id: string;
      video_id: string;
      label: string | null;
      path: string;
    }[];

  const posts = new Map<string, SlugPost>();
  for (const row of linked) {
    posts.set(row.external_id, {
      platform: row.platform as SchedulePlatform,
      external_id: row.external_id,
      linked_video_id: row.video_id,
      linked_label: row.label ?? row.path.split("/").pop(),
    });
  }
  for (const mediaId of automationMediaIds(slug)) {
    if (!posts.has(mediaId)) posts.set(mediaId, { platform: "ig", external_id: mediaId });
  }
  if (!posts.size) return [];

  // Enrich from the local media cache. Instagram only — a YouTube post's stats
  // are not cached anywhere, and a network call to decorate a list would make
  // opening a pool page depend on the API being up.
  const instagram = Array.from(posts.values()).filter((post) => post.platform === "ig");
  const insights = getCachedInsightsMany(instagram.map((post) => post.external_id));

  for (const post of instagram) {
    const media = getCachedMedia(post.external_id);
    if (media) {
      post.title = media.caption?.split("\n")[0]?.trim() || undefined;
      post.thumbnail_url = media.thumbnail_url ?? media.media_url;
      post.permalink = media.permalink;
      post.posted_at = media.timestamp || undefined;
    }
    const stats = insights.get(post.external_id);
    if (stats) post.views = stats.views ?? stats.reach;
  }

  return Array.from(posts.values()).sort((a, b) =>
    (b.posted_at ?? "").localeCompare(a.posted_at ?? "")
  );
}
