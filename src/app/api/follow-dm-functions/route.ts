import { NextResponse } from "next/server";
import { listDmPacks } from "@/lib/follow-dm-functions";

export const dynamic = "force-dynamic";

// Mirrors /api/automation-reply-functions — lists the DM message packs (opener +
// nudge previews) available to the comment_to_follow_dm editor.
export async function GET() {
  return NextResponse.json(listDmPacks());
}
