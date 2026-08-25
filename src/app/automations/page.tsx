import { Suspense } from "react";
import { CockpitShell } from "@/components/dashboard/cockpit/CockpitShell";
import { AutomationsClient } from "./AutomationsClient";

export const metadata = { title: "Automations" };

export default function AutomationsPage() {
  return (
    <CockpitShell fill>
      {/* Reading `?flow=` needs a boundary to opt this subtree out of prerender. */}
      <Suspense fallback={<div className="flex-1" />}>
        <AutomationsClient />
      </Suspense>
    </CockpitShell>
  );
}
