import { AppShell } from "@/components/layout/AppShell";
import { TopBar } from "@/components/layout/TopBar";
import { InboxClient } from "./InboxClient";

export const metadata = {
  title: "Inbox",
};

export default function InboxPage() {
  return (
    <AppShell>
      <TopBar title="Inbox" />
      <InboxClient />
    </AppShell>
  );
}
