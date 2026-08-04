import { NextRequest, NextResponse } from "next/server";
import { getAllCachedMedia } from "@/lib/cache/store";
import { requireScheduleAuth } from "@/lib/schedule/auth";

export const dynamic = "force-dynamic";

export interface PublishedEntry {
  id: string;
  platform: "ig";
  /** Epoch ms. */
  published_at: number;
  title: string;
  media_type: string;
  permalink?: string;
}

/**
 * GET /api/schedule/history?from=&to= — posts that already went out, in the
 * calendar's window.
 *
 * The calendar is more useful as a full timeline than as a list of pending work:
 * seeing last week's cadence next to next week's plan is the point. This reads
 * the local media cache, so it costs no Graph API calls and works offline.
 */
export async function GET(request: NextRequest) {
  const denied = requireScheduleAuth(request);
  if (denied) return denied;

  const q = request.nextUrl.searchParams;
  const num = (raw: string | null): number | undefined => {
    if (!raw) return undefined;
    const n = /^\d+$/.test(raw) ? Number(raw) : Date.parse(raw);
    return Number.isFinite(n) ? n : undefined;
  };

  const from = num(q.get("from")) ?? 0;
  const to = num(q.get("to")) ?? Date.now();

  const posts: PublishedEntry[] = [];
  for (const media of getAllCachedMedia()) {
    const at = Date.parse(media.timestamp);
    if (!Number.isFinite(at) || at < from || at >= to) continue;
    posts.push({
      id: media.id,
      platform: "ig",
      published_at: at,
      title: media.caption?.split("\n")[0]?.trim() || "(no caption)",
      media_type: media.media_type,
      permalink: media.permalink,
    });
  }

  posts.sort((a, b) => a.published_at - b.published_at);
  return NextResponse.json({ posts });
}
