/**
 * Shortlist of zones offered in the timezone pickers.
 *
 * Shared by the calendar header and the settings panel so the two can't drift.
 * Neither list is exhaustive — both add the system zone and the currently
 * stored zone on top of this, so a zone set via the API is always shown even
 * when it isn't here.
 */
export const COMMON_ZONES = [
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Dubai",
  "Asia/Singapore",
  "Australia/Brisbane",
  "Australia/Sydney",
  "UTC",
];
