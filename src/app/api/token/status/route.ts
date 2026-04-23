import { NextResponse } from "next/server";
import { getTokenStatus } from "@/lib/token/manager";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const status = getTokenStatus();
    return NextResponse.json(status);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: "internal", message }, { status: 500 });
  }
}
