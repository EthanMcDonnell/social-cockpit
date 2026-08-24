import { redirect } from "next/navigation";

/**
 * The automation-only log was folded into /logs, which carries every worker's
 * warnings and errors rather than the two that happened to have a table. Kept
 * as a redirect so existing links and bookmarks still land somewhere useful.
 */
export default function AutomationLogsPage() {
  redirect("/logs?source=automation");
}
