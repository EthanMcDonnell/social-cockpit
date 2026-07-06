import { runAutomationCycle, runFollowConfirmPoll, INTERVAL_MS } from "@/lib/automation-worker";

const tick = async () => {
  try {
    await runAutomationCycle();
  } catch (err) {
    console.error("[automation] cycle error:", err);
  }
  // comment_to_follow_dm confirm poll shares the same 60s cadence. Isolated in
  // its own try so a poll failure never affects the main comment cycle.
  try {
    await runFollowConfirmPoll();
  } catch (err) {
    console.error("[automation] follow-confirm poll error:", err);
  }
};

tick();
setInterval(tick, INTERVAL_MS);
