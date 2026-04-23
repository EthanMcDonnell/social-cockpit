import { NextRequest, NextResponse } from "next/server";
import { replyToComment } from "@/lib/instagram/endpoints/comments";
import { InstagramError, RateLimitError } from "@/lib/instagram/types";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { message } = await request.json().catch(() => ({}));
  if (!message?.trim()) {
    return NextResponse.json({ error: "missing_param", message: "message is required" }, { status: 400 });
  }

  try {
    const result = await replyToComment(params.id, message.trim());
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof RateLimitError) {
      return NextResponse.json({ error: "rate_limit", message: err.message }, { status: 429 });
    }
    if (err instanceof InstagramError) {
      return NextResponse.json({ error: "instagram_api", message: err.message, code: err.code }, { status: 400 });
    }
    const message2 = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: "internal", message: message2 }, { status: 500 });
  }
}
