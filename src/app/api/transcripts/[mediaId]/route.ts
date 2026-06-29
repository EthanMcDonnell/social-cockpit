import { NextRequest, NextResponse } from "next/server";
import {
  getTranscript,
  isTranscriptionConfigured,
  isTranscriptionEnabled,
  runTranscription,
} from "@/lib/transcription/service";
import { getMedia } from "@/lib/instagram/endpoints/media";
import { InstagramError, RateLimitError } from "@/lib/instagram/types";

export const dynamic = "force-dynamic";
// Transcription can take a while on CPU — give the route room.
export const maxDuration = 600;

// GET — return a cached transcript if one exists, else 404.
export async function GET(
  _request: NextRequest,
  { params }: { params: { mediaId: string } }
) {
  const transcript = getTranscript(params.mediaId);
  if (!transcript) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json(transcript);
}

// POST — transcribe the video (once) and store it. Refuses when the feature
// is disabled app-wide.
export async function POST(
  _request: NextRequest,
  { params }: { params: { mediaId: string } }
) {
  if (!isTranscriptionEnabled()) {
    return NextResponse.json(
      { error: "disabled", message: "Transcription is turned off." },
      { status: 403 }
    );
  }

  if (!isTranscriptionConfigured()) {
    return NextResponse.json(
      {
        error: "not_configured",
        message:
          "Transcription is not configured. Set TRANSCRIPTION_PYTHON on the server.",
      },
      { status: 503 }
    );
  }

  const { mediaId } = params;

  const cached = getTranscript(mediaId);
  if (cached) return NextResponse.json(cached);

  try {
    const media = await getMedia(mediaId);
    if (media.media_type !== "VIDEO" && media.media_type !== "REEL") {
      return NextResponse.json(
        { error: "unsupported", message: "Only videos and reels can be transcribed." },
        { status: 400 }
      );
    }
    if (!media.media_url) {
      return NextResponse.json(
        { error: "no_media_url", message: "No video URL available for this post." },
        { status: 400 }
      );
    }

    const transcript = await runTranscription(mediaId, media.media_url);
    return NextResponse.json(transcript);
  } catch (err) {
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
