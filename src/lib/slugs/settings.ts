/**
 * The default selection method, stored in `app_settings` beside the rest of the
 * posting policy.
 *
 * It belongs there rather than in `.env` for the same reason the daily cap does:
 * it is a decision about how you post, tuned from the app, and it has to take
 * effect without restarting a server we are told not to restart.
 *
 * Three levels resolve, most specific first: the job's own method, then the
 * slug's override, then this. A job booked with no method at all is not frozen
 * to today's default — it reads the setting when it fires, so changing the
 * default here changes what every unspecified job already on the calendar will
 * do.
 *
 * Server-side only.
 */

import { getSetting, setSetting } from "@/lib/settings";
import { getSlug } from "./store";
import { isSelectionMethod, type SelectionMethod } from "./types";

const DEFAULT_METHOD_KEY = "slugs.default_selection";

/** Cross-posting a library one clip at a time is the common case. */
const FALLBACK_METHOD: SelectionMethod = "most_views";

export function getDefaultSelectionMethod(): SelectionMethod {
  const stored = getSetting(DEFAULT_METHOD_KEY);
  return isSelectionMethod(stored) ? stored : FALLBACK_METHOD;
}

export function setDefaultSelectionMethod(method: SelectionMethod): void {
  if (!isSelectionMethod(method)) throw new Error(`Unknown selection method: ${method}`);
  setSetting(DEFAULT_METHOD_KEY, method);
}

/** Job method → slug override → global default. */
export function resolveSelectionMethod(
  slug: string,
  jobMethod?: SelectionMethod | null
): SelectionMethod {
  if (isSelectionMethod(jobMethod)) return jobMethod;
  const override = getSlug(slug)?.selection_method;
  if (isSelectionMethod(override)) return override;
  return getDefaultSelectionMethod();
}
