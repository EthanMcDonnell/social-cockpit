import { CockpitShell } from "@/components/dashboard/cockpit/CockpitShell";
import { SlugsClient } from "./SlugsClient";

export const metadata = { title: "Slugs" };

export default function SlugsPage() {
  return (
    <CockpitShell fill>
      <SlugsClient />
    </CockpitShell>
  );
}
