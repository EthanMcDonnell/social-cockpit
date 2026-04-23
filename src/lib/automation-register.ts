import { runAutomationCycle } from "@/lib/automation-worker";

const INTERVAL_MS = 60_000;

const tick = async () => {
  try {
    await runAutomationCycle();
  } catch (err) {
    console.error("[automation] cycle error:", err);
  }
};

tick();
setInterval(tick, INTERVAL_MS);
