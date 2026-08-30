/**
 * How a repost is published — the part that is not configurable.
 *
 * Every repost goes out as a **trial reel** that is **promoted by hand**. There
 * is no setting for this and no UI control, deliberately: a trial reel shows to
 * non-followers first, which is exactly what you want when re-running something
 * your followers have already seen, and automatic graduation would push a
 * recycled video back into the main feed on the platform's judgement rather
 * than yours.
 *
 * Keeping the constant here rather than in `lib/repost/settings.ts` is the
 * point. A key in the settings table would say "the alternative is one toggle
 * away". It is not on offer.
 *
 * Server-side only.
 */

import type { GraduationStrategy, PublishInput } from "@/lib/instagram/endpoints/publish";

/** Never `SS_PERFORMANCE`. See the module comment. */
export const REPOST_GRADUATION_STRATEGY: GraduationStrategy = "MANUAL";

/**
 * Force trial-reel parameters onto a repost's payload.
 *
 * Applied after the job's own payload and the candidate's stored defaults have
 * been merged, so nothing a caller supplied can turn a repost into an ordinary
 * feed post — including a `trial_params` copied out of the original publish.
 */
export function asTrialRepost(payload: PublishInput): PublishInput {
  return {
    ...payload,
    trial_params: { graduation_strategy: REPOST_GRADUATION_STRATEGY },
  };
}
