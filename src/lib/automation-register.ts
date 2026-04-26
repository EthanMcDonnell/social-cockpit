import { runAutomationCycle, INTERVAL_MS } from "@/lib/automation-worker";

const tick = async () => {
  try {
    await runAutomationCycle();
  } catch (err) {
    console.error("[automation] cycle error:", err);
  }
};

tick();
setInterval(tick, INTERVAL_MS);
