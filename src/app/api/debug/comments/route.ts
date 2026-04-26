import { NextRequest, NextResponse } from "next/server";
import { listComments } from "@/lib/instagram/endpoints/comments";
import { instagramFetch } from "@/lib/instagram/client";

export const dynamic = "force-dynamic";

// GET /api/debug/comments?post_id=123
export async function GET(request: NextRequest) {
  const postId = request.nextUrl.searchParams.get("post_id");
  if (!postId) {
    return NextResponse.json({ error: "post_id query param required" }, { status: 400 });
  }

  try {
    // Check the media object itself
    const media = await instagramFetch<{
      id: string;
      comments_count: number;
      is_comment_enabled: boolean;
      media_type: string;
      media_product_type: string;
    }>(`/${postId}`, {
      params: { fields: "id,comments_count,is_comment_enabled,media_type,media_product_type" }
    });

    // Bare comments fetch with no fields
    const bare = await instagramFetch<{ data: { id: string; username?: string }[] }>(
      `/${postId}/comments`, {}
    );

    // Fetch replies on the first comment we have
    const firstCommentId = bare.data[0]?.id;
    const replies = firstCommentId
      ? await instagramFetch<{ data: { id: string; username?: string }[] }>(
          `/${firstCommentId}/replies`, {}
        ).catch((e: Error) => ({ error: e.message }))
      : null;

    return NextResponse.json({ media, bareCommentCount: bare.data.length, bareComments: bare.data, firstCommentReplies: replies });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
