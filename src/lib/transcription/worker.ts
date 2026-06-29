import { getAllMedia, getMedia } from "@/lib/instagram/endpoints/media";
import {
  getTranscript,
  isTranscriptionConfigured,
  isTranscriptionEnabled,
  queueTranscription,
} from "./service";

// Re-scan the account for new videos every 30 minutes. The first cycle runs
// immediately on server boot (see register.ts).
export const TRANSCRIPTION_INTERVAL_MS = 30 * 60 * 1000;

/**
 * Fetch all media, filter to videos/reels, and queue any that don't yet have a
 * stored transcript. Each job resolves a fresh CDN URL at processing time, so a
 * long backlog can't fail on expired URLs. No-op when the feature is disabled.
 */
export async function runTranscriptionCycle(): Promise<void> {
  if (!isTranscriptionEnabled()) return;
  if (!isTranscriptionConfigured()) {
    console.warn(
      "[transcription] TRANSCRIPTION_PYTHON is not set — skipping cycle. " +
        "Set it to a Python interpreter with faster-whisper to enable transcription."
    );
    return;
  }

  const media = await getAllMedia();
  const videos = media.filter(
    (m) => m.media_type === "VIDEO" || m.media_type === "REEL"
  );

  let enqueued = 0;
  for (const m of videos) {
    if (getTranscript(m.id)) continue;
    queueTranscription(m.id, async () => {
      const fresh = await getMedia(m.id);
      return fresh.media_url ?? null;
    });
    enqueued++;
  }

  if (enqueued > 0) {
    console.log(`[transcription] queued ${enqueued} video(s) for transcription`);
  }
}
