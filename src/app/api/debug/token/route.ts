import { NextResponse } from "next/server";
import { instagramFetch } from "@/lib/instagram/client";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Check basic token identity
    const me = await instagramFetch<{ id: string; username: string }>(
      "/me",
      { params: { fields: "id,username" } }
    );

    // Try fetching media to check instagram_business_basic
    const media = await instagramFetch<{ data: { id: string }[] }>(
      "/me/media",
      { params: { fields: "id", limit: "1" } }
    ).catch((e: Error) => ({ error: e.message }));

    // Try fetching comments on that media to check instagram_business_manage_comments
    let commentsTest: unknown = null;
    if ("data" in media && media.data[0]) {
      commentsTest = await instagramFetch(
        `/${media.data[0].id}/comments`,
        { params: { fields: "id,username", limit: "3" } }
      ).catch((e: Error) => ({ error: e.message }));
    }

    return NextResponse.json({ me, media, commentsTest });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
