import { NextRequest, NextResponse } from "next/server";
import { getBlock, unblockVideo } from "@/lib/repost/store";
import { getArchived } from "@/lib/archive/store";
import { logScheduleEvent } from "@/lib/schedule/store";
import { requireScheduleAuth } from "@/lib/schedule/auth";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/reposts/blocks/:archiveId — put a retired video back in the running.
 *
 * The only way a block is ever lifted. Blocks are written by the evaluator from
 * a measured view count, so removing one is an explicit human override of a
 * measurement — hence its own endpoint rather than a field on the slug, which
 * would blur it into the opt-in toggle.
 *
 * The video returns to tier 2, not tier 1: it has been reposted before, so it
 * still has to wait out `min_gap_days` before it can run again. Unblocking says
 * "do not count that result against it", not "pretend it never ran".
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const denied = requireScheduleAuth(request);
  if (denied) return denied;

  const block = getBlock(params.id);
  if (!block) {
    return NextResponse.json(
      { error: "not_found", message: "That video is not blocked." },
      { status: 404 }
    );
  }

  unblockVideo(params.id);

  const archived = getArchived(params.id);
  logScheduleEvent(
    "info",
    "repost_unblocked",
    `${archived?.label ?? params.id} was manually returned to the repost pool`,
    { meta: { archive_id: params.id, previous_views: block.views } }
  );

  return NextResponse.json({ unblocked: true, archive_id: params.id });
}
