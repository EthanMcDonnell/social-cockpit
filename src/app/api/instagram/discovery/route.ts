import { NextRequest, NextResponse } from "next/server";
import {
  discoverAccount,
  DiscoveryNotConfiguredError,
} from "@/lib/instagram/endpoints/discovery";
import { InstagramError, RateLimitError } from "@/lib/instagram/types";

export const dynamic = "force-dynamic";

/** GET /api/instagram/discovery?username=kodekloud&scan=50 */
export async function GET(req: NextRequest) {
  const username = req.nextUrl.searchParams.get("username");
  if (!username) {
    return NextResponse.json(
      { error: "bad_request", message: "username is required" },
      { status: 400 }
    );
  }
  const scan = Number(req.nextUrl.searchParams.get("scan") ?? 50);

  try {
    const account = await discoverAccount(username, Number.isFinite(scan) ? scan : 50);
    return NextResponse.json(account);
  } catch (err) {
    if (err instanceof DiscoveryNotConfiguredError) {
      return NextResponse.json({ error: "not_configured", message: err.message }, { status: 501 });
    }
    if (err instanceof RangeError) {
      return NextResponse.json({ error: "bad_request", message: err.message }, { status: 400 });
    }
    if (err instanceof RateLimitError) {
      return NextResponse.json(
        { error: "rate_limit", message: err.message, usage: err.usage },
        { status: 429 }
      );
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
