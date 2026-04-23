import { AppShell } from "@/components/layout/AppShell";
import { TopBar } from "@/components/layout/TopBar";
import { AutomationsClient } from "./AutomationsClient";

export const metadata = { title: "Automations" };

export default function AutomationsPage() {
  return (
    <AppShell>
      <TopBar title="Automations" />
      <AutomationsClient />
    </AppShell>
  );
}
