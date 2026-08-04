import { CockpitShell } from "@/components/dashboard/cockpit/CockpitShell";
import { CalendarClient } from "@/components/calendar/CalendarClient";

export const metadata = {
  title: "Calendar",
};

export default function CalendarPage() {
  return (
    <CockpitShell fill>
      <CalendarClient />
    </CockpitShell>
  );
}
