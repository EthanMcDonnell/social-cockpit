/**
 * Limits YouTube imposes, in one place.
 *
 * These are facts about the platform rather than preferences, so they are
 * constants and not configuration. What they are not is *ours to state twice*:
 * the Shorts ceiling was written down in both `compose/draft.ts` (which rejects
 * an over-long upload) and `youtube/endpoints/videos.ts` (which decides whether
 * a fetched video counts as a Short). Two copies of a number Google has already
 * changed once — 60s to 180s in late 2024 — is a standing invitation to update
 * one and not the other, at which point the composer accepts a video the
 * classifier refuses to call a Short.
 */

/**
 * Longest a video can be and still be a Short. Raised from 60s in late 2024.
 *
 * A Short is classified by signal rather than a flag: vertical, under this
 * ceiling, and tagged #Shorts.
 */
export const YT_SHORT_MAX_SECONDS = 180;

/** Title and description ceilings the upload API enforces. */
export const YT_TITLE_MAX = 100;
export const YT_DESCRIPTION_MAX = 5000;
