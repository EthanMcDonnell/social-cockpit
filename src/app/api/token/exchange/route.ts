import { NextRequest, NextResponse } from "next/server";
import { exchangeShortLivedToken } from "@/lib/token/manager";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const { token } = await request.json();
    if (!token?.trim()) {
      return NextResponse.json({ error: "missing_param", message: "token is required" }, { status: 400 });
    }
    const result = await exchangeShortLivedToken(token.trim());
    if (!result.success) {
      return NextResponse.json({ error: "exchange_failed", message: result.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true, expiresAt: result.expiresAt });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: "internal", message }, { status: 500 });
  }
}
