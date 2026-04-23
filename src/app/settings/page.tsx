import { AppShell } from "@/components/layout/AppShell";
import { TopBar } from "@/components/layout/TopBar";
import { TokenStatusPanel } from "@/components/settings/TokenStatusPanel";
import { ExchangeTokenForm } from "@/components/settings/ExchangeTokenForm";

export const metadata = {
  title: "Settings",
};

export default function SettingsPage() {
  return (
    <AppShell>
      <TopBar title="Settings" />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-xl space-y-6">
          <section className="space-y-2">
            <h2 className="text-xs uppercase tracking-widest text-[var(--text-muted)] font-medium">
              Account
            </h2>
            <TokenStatusPanel />
          </section>

          <section className="space-y-2">
            <h2 className="text-xs uppercase tracking-widest text-[var(--text-muted)] font-medium">
              Token Management
            </h2>
            <ExchangeTokenForm />
          </section>

          <section className="space-y-2">
            <h2 className="text-xs uppercase tracking-widest text-[var(--text-muted)] font-medium">
              Environment Variables
            </h2>
            <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-5">
              <p className="text-xs text-[var(--text-muted)] leading-relaxed mb-3">
                The following variables must be set in <code className="font-mono text-[var(--text-primary)]">.env.local</code>:
              </p>
              <div className="space-y-1.5">
                {[
                  "INSTAGRAM_ACCOUNT_ID",
                  "INSTAGRAM_ACCESS_TOKEN",
                  "INSTAGRAM_APP_SECRET",
                  "TOKEN_EXPIRES_AT",
                ].map((key) => (
                  <p key={key} className="font-mono text-xs text-[var(--text-primary)]">
                    {key}
                  </p>
                ))}
              </div>
            </div>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
