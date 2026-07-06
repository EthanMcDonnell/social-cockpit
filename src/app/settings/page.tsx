import { CockpitShell } from "@/components/dashboard/cockpit/CockpitShell";
import { TokenStatusPanel } from "@/components/settings/TokenStatusPanel";
import { ExchangeTokenForm } from "@/components/settings/ExchangeTokenForm";
import { TranscriptionSettingsPanel } from "@/components/settings/TranscriptionSettingsPanel";

export const metadata = {
  title: "Settings",
};

const ENV_VARS = [
  "INSTAGRAM_ACCOUNT_ID",
  "INSTAGRAM_ACCESS_TOKEN",
  "INSTAGRAM_APP_SECRET",
  "TOKEN_EXPIRES_AT",
];

function SectionLabel({ tag, children }: { tag: string; children: React.ReactNode }) {
  return (
    <div className="p-h" style={{ marginBottom: 0 }}>
      <span className="tag">{tag}</span>
      <h2>{children}</h2>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <CockpitShell>
      <div className="max-w-xl space-y-8">
        <section className="space-y-3">
          <SectionLabel tag="S1">Account</SectionLabel>
          <TokenStatusPanel />
        </section>

        <section className="space-y-3">
          <SectionLabel tag="S2">Token Management</SectionLabel>
          <ExchangeTokenForm />
        </section>

        <section className="space-y-3">
          <SectionLabel tag="S3">Features</SectionLabel>
          <TranscriptionSettingsPanel />
        </section>

        <section className="space-y-3">
          <SectionLabel tag="S4">Environment Variables</SectionLabel>
          <div className="panel">
            <p className="text-xs text-[var(--text-muted)] leading-relaxed mb-3">
              The following variables must be set in{" "}
              <code className="font-mono text-[var(--amber)]">.env.local</code>:
            </p>
            <div className="space-y-1.5">
              {ENV_VARS.map((key) => (
                <p key={key} className="font-mono text-xs text-[var(--text-primary)]">
                  <span className="text-[var(--amber-dim)]">›</span> {key}
                </p>
              ))}
            </div>
          </div>
        </section>
      </div>
    </CockpitShell>
  );
}
