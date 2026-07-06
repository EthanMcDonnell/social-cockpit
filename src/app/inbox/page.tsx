import { CockpitShell } from "@/components/dashboard/cockpit/CockpitShell";
import { InboxClient } from "./InboxClient";

export const metadata = {
  title: "Inbox",
};

export default function InboxPage() {
  return (
    <CockpitShell fill>
      <InboxClient />
    </CockpitShell>
  );
}
