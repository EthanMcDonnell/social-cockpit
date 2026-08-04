import { runScheduleCycle, schedulerEnabled, isDryRun, INTERVAL_MS } from "@/lib/schedule/worker";

// Boot tick plus a fixed cadence, mirroring the automation/cache/transcription
// workers. 30s rather than their 60s because a scheduled slot should land within
// about half a minute of its time.
const tick = async () => {
  try {
    await runScheduleCycle();
  } catch (err) {
    console.error("[schedule] cycle error:", err);
  }
};

if (schedulerEnabled()) {
  console.log(
    `[schedule] worker active — every ${INTERVAL_MS / 1000}s${isDryRun() ? " (DRY RUN — nothing will be published)" : ""}`
  );
  tick();
  setInterval(tick, INTERVAL_MS);
} else {
  console.log("[schedule] worker disabled (SCHEDULER_ENABLED=false) — nothing will publish");
}
