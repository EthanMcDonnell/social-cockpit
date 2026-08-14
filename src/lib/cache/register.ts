import { runCacheSync } from "@/lib/cache/sync";
import { config } from "@/lib/config";

// Re-sync the Meta API cache on boot and every CACHE_SYNC_INTERVAL_MS (default
// 30 min). Mirrors the automation/transcription worker registration pattern.
const INTERVAL_MS = config.cache.syncIntervalMs;

const tick = async () => {
  try {
    await runCacheSync();
  } catch (err) {
    console.error("[cache] sync cycle error:", err);
  }
};

tick();
setInterval(tick, INTERVAL_MS);
