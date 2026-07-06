import { CockpitShell } from "@/components/dashboard/cockpit/CockpitShell";
import { AutomationLogsClient } from "./AutomationLogsClient";

export const metadata = { title: "Automation Logs" };

export default function AutomationLogsPage() {
  return (
    <CockpitShell fill>
      <AutomationLogsClient />
    </CockpitShell>
  );
}
