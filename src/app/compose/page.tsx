import { CockpitShell } from "@/components/dashboard/cockpit/CockpitShell";
import { ComposeStudio } from "@/components/compose/ComposeStudio";

export const metadata = {
  title: "Compose",
};

export default function ComposePage() {
  return (
    <CockpitShell>
      <div className="compose">
        <ComposeStudio />
      </div>
    </CockpitShell>
  );
}
