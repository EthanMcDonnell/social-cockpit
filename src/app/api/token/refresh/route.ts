import { NextResponse } from "next/server";
import { refreshAccessToken } from "@/lib/token/manager";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const result = await refreshAccessToken();
    if (!result.success) {
      return NextResponse.json(
        { error: "refresh_failed", message: result.error },
        { status: 400 }
      );
    }
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: "internal", message }, { status: 500 });
  }
}
