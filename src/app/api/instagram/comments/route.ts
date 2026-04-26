import { NextRequest, NextResponse } from "next/server";
import { listComments } from "@/lib/instagram/endpoints/comments";
import { InstagramError, RateLimitError } from "@/lib/instagram/types";
import { processFlows } from "@/lib/automation-worker";

export async function GET(request: NextRequest) {
  const postId = request.nextUrl.searchParams.get("post_id");
  if (!postId) {
    return NextResponse.json({ error: "missing_param", message: "post_id is required" }, { status: 400 });
  }

  try {
    const result = await listComments(postId);
    console.log(`[comments] post=${postId} total=${result.data.length} hasMore=${!!result.paging?.next} firstCommentUsername=${result.data[0]?.username ?? result.data[0]?.from?.username ?? "(none)"}`);
    await processFlows(postId, result.data).catch(console.error);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof RateLimitError) {
      return NextResponse.json({ error: "rate_limit", message: err.message }, { status: 429 });
    }
    if (err instanceof InstagramError) {
      return NextResponse.json({ error: "instagram_api", message: err.message, code: err.code }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: "internal", message }, { status: 500 });
  }
}
