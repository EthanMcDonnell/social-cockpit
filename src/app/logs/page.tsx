import { Suspense } from "react";
import { CockpitShell } from "@/components/dashboard/cockpit/CockpitShell";
import { LogsClient } from "./LogsClient";

export const metadata = { title: "System Logs" };

export default function LogsPage() {
  return (
    <CockpitShell fill>
      {/* useSearchParams needs a boundary to opt this subtree out of prerender. */}
      <Suspense fallback={<div className="flex-1" />}>
        <LogsClient />
      </Suspense>
    </CockpitShell>
  );
}
