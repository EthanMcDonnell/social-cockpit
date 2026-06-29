import { NextRequest, NextResponse } from "next/server";
import {
  isTranscriptionEnabled,
  setTranscriptionEnabled,
} from "@/lib/transcription/service";

export const dynamic = "force-dynamic";

// GET — current app-wide transcription toggle state.
export async function GET() {
  return NextResponse.json({ enabled: isTranscriptionEnabled() });
}

// PUT — set the app-wide transcription toggle. Body: { enabled: boolean }
export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json(
      { error: "bad_request", message: "Expected { enabled: boolean }." },
      { status: 400 }
    );
  }
  setTranscriptionEnabled(body.enabled);
  return NextResponse.json({ enabled: isTranscriptionEnabled() });
}
