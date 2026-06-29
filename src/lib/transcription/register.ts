import {
  runTranscriptionCycle,
  TRANSCRIPTION_INTERVAL_MS,
} from "@/lib/transcription/worker";

const tick = async () => {
  try {
    await runTranscriptionCycle();
  } catch (err) {
    console.error("[transcription] cycle error:", err);
  }
};

tick();
setInterval(tick, TRANSCRIPTION_INTERVAL_MS);
