import {
  runTranscriptionCycle,
  TRANSCRIPTION_INTERVAL_MS,
} from "@/lib/transcription/worker";
import { reportError } from "@/lib/observability";

const tick = async () => {
  try {
    await runTranscriptionCycle();
  } catch (err) {
    reportError("transcription", "cycle_error", "cycle error", { error: err });
  }
};

tick();
setInterval(tick, TRANSCRIPTION_INTERVAL_MS);
