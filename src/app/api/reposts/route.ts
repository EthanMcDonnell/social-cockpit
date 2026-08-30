import { NextRequest, NextResponse } from "next/server";
import { repostCandidates, rankCandidates } from "@/lib/repost/candidates";
import { getRepostSettings } from "@/lib/repost/settings";
import { REPOST_GRADUATION_STRATEGY } from "@/lib/repost/publish";
import { repostSlugs } from "@/lib/repost/autobook";
import { archiveUsage } from "@/lib/archive/store";
import { requireScheduleAuth } from "@/lib/schedule/auth";
import type { SchedulePlatform } from "@/lib/schedule/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/reposts — the repost pool, eligible and ineligible alike.
 *
 * Returns every archived video with its verdict rather than only the ones that
 * could run. "Nothing is eligible" is the state a user most needs explained,
 * and the explanation is per-video: one is waiting on its slug being opted in,
 * another was retired for underperforming, a third is simply resting. Filtering
 * to the eligible ones here would leave the page unable to say any of that.
 *
 * `order` is the ranked shortlist — tier 1 before tier 2 — so a caller can see
 * what would actually go out next without re-deriving the rules.
 */
export async function GET(request: NextRequest) {
  const denied = requireScheduleAuth(request);
  if (denied) return denied;

  const platformParam = request.nextUrl.searchParams.get("platform");
  const platform: SchedulePlatform = platformParam === "yt" ? "yt" : "ig";

  const candidates = await repostCandidates(platform);
  const ranked = rankCandidates(candidates);

  return NextResponse.json({
    platform,
    settings: { ...getRepostSettings(), graduation_strategy: REPOST_GRADUATION_STRATEGY },
    slugs: repostSlugs(),
    archive: archiveUsage(),
    candidates,
    order: ranked.map((candidate) => candidate.archive.id),
    counts: {
      total: candidates.length,
      eligible: ranked.length,
      tier1: candidates.filter((candidate) => candidate.tier === 1).length,
      tier2: candidates.filter((candidate) => candidate.tier === 2).length,
      // Kept as two separate figures on purpose: "waiting for you to enable a
      // slug" and "retired for underperforming" are different problems with
      // different fixes, and a combined "unavailable" count would hide that.
      awaiting_optin: candidates.filter((candidate) => candidate.why === "not_enabled").length,
      blocked: candidates.filter((candidate) => candidate.block).length,
    },
  });
}
