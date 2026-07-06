import { NextRequest, NextResponse } from "next/server";
import { publishContainer } from "@/lib/instagram/endpoints/publish";
import { getMedia } from "@/lib/instagram/endpoints/media";
import { InstagramError, RateLimitError } from "@/lib/instagram/types";

export const dynamic = "force-dynamic";

/**
 * POST /api/publish/finalize — publish a container that already finished
 * processing (created earlier with finalize:false, or after a 202 from
 * /api/publish). Body: { creation_id: string }.
 */
export async function POST(request: NextRequest) {
  const { creation_id } = await request.json().catch(() => ({}));
  if (!creation_id || typeof creation_id !== "string") {
    return NextResponse.json(
      { error: "missing_param", message: "creation_id is required" },
      { status: 400 }
    );
  }

  try {
    const published = await publishContainer(creation_id);
    const permalink = await getMedia(published.id, ["id", "permalink"])
      .then((m) => m.permalink)
      .catch(() => undefined);

    return NextResponse.json({
      container_id: creation_id,
      media_id: published.id,
      permalink,
      published: true,
    });
  } catch (err) {
    if (err instanceof RateLimitError) {
      return NextResponse.json({ error: "rate_limit", message: err.message }, { status: 429 });
    }
    if (err instanceof InstagramError) {
      return NextResponse.json(
        { error: "instagram_api", message: err.message, code: err.code },
        { status: 400 }
      );
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: "internal", message }, { status: 500 });
  }
}
