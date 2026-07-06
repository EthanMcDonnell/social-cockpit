import { CockpitShell } from "@/components/dashboard/cockpit/CockpitShell";
import { AutomationsClient } from "./AutomationsClient";

export const metadata = { title: "Automations" };

export default function AutomationsPage() {
  return (
    <CockpitShell fill>
      <AutomationsClient />
    </CockpitShell>
  );
}
