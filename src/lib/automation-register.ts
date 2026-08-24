import { runAutomationCycle, runFollowConfirmPoll, INTERVAL_MS } from "@/lib/automation-worker";
import { reportError, reportWarn } from "@/lib/observability";

// A cycle that overruns the 60s interval would otherwise have the next tick
// start on top of it: setInterval doesn't wait for an async callback. The
// fired_automations claim (INSERT OR IGNORE) already makes a double-send
// impossible, so this is about cost, not correctness — overlapping cycles
// double the comment-list calls against the same posts at exactly the moment
// the API is already struggling. Mirrors src/lib/schedule/register.ts.
let cycleInProgress = false;

const tick = async () => {
  if (cycleInProgress) {
    reportWarn("automation", "cycle_overlap", "previous cycle still running — skipping this tick");
    return;
  }
  cycleInProgress = true;
  try {
    await runAutomationCycle();
  } catch (err) {
    reportError("automation", "cycle_error", "cycle error", { error: err });
  }
  // comment_to_follow_dm confirm poll shares the same 60s cadence. Isolated in
  // its own try so a poll failure never affects the main comment cycle.
  try {
    await runFollowConfirmPoll();
  } catch (err) {
    reportError("automation", "follow_confirm_poll_failed", "follow-confirm poll error", { error: err });
  } finally {
    cycleInProgress = false;
  }
};

tick();
setInterval(tick, INTERVAL_MS);
