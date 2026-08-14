import { Suspense } from "react";
import { CockpitShell } from "@/components/dashboard/cockpit/CockpitShell";
import { TokenStatusPanel } from "@/components/settings/TokenStatusPanel";
import { ExchangeTokenForm } from "@/components/settings/ExchangeTokenForm";
import { TranscriptionSettingsPanel } from "@/components/settings/TranscriptionSettingsPanel";
import { YouTubeConnectPanel } from "@/components/settings/YouTubeConnectPanel";
import { PostingPolicyPanel } from "@/components/settings/PostingPolicyPanel";
import { SchedulerPanel } from "@/components/settings/SchedulerPanel";

export const metadata = {
  title: "Settings",
};

/**
 * The two variables without which the server will not boot.
 *
 * This list used to name nine, describe them all as mandatory, and point at
 * `.env.local` — a file this app does not read. It also went stale the moment
 * the scheduler landed, because nothing tied it to what the code actually
 * reads. Rather than restate all 38 here and drift again, it names only the
 * hard requirements and sends you to the file that is generated from the
 * config module.
 */
const REQUIRED_ENV_VARS = ["INSTAGRAM_ACCOUNT_ID", "INSTAGRAM_ACCESS_TOKEN"];

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
      {/*
        Grouped by what you'd come here to do, rather than by which subsystem
        implements it: everything about the account first, everything about
        posting next, connections after that, and the read-only environment
        summary last. Token status and the exchange form were two sections that
        are one job, so they now sit together.
      */}
      <div className="max-w-xl space-y-8">
        <section className="space-y-3">
          <SectionLabel tag="S1">Account</SectionLabel>
          <TokenStatusPanel />
          <ExchangeTokenForm />
        </section>

        <section className="space-y-3">
          <SectionLabel tag="S2">Publishing</SectionLabel>
          <PostingPolicyPanel />
        </section>

        <section className="space-y-3">
          <SectionLabel tag="S3">Scheduler</SectionLabel>
          <SchedulerPanel />
        </section>

        <section className="space-y-3">
          <SectionLabel tag="S4">Integrations</SectionLabel>
          <Suspense fallback={null}>
            <YouTubeConnectPanel />
          </Suspense>
          <TranscriptionSettingsPanel />
        </section>

        <section className="space-y-3">
          <SectionLabel tag="S5">Environment</SectionLabel>
          <div className="panel">
            <p className="text-xs text-[var(--text-muted)] leading-relaxed mb-3">
              Configuration lives in{" "}
              <code className="font-mono text-[var(--amber)]">.env</code>. These two are
              required — the server refuses to start without them:
            </p>
            <div className="space-y-1.5">
              {REQUIRED_ENV_VARS.map((key) => (
                <p key={key} className="font-mono text-xs text-[var(--text-primary)]">
                  <span className="text-[var(--amber-dim)]">›</span> {key}
                </p>
              ))}
            </div>
            <p className="text-xs text-[var(--text-muted)] leading-relaxed mt-3">
              Everything else is optional and documented in{" "}
              <code className="font-mono text-[var(--amber)]">.env.example</code>. Posting
              cadence is not an environment variable — it is stored in the database and
              edited in the app.
            </p>
          </div>
        </section>
      </div>
    </CockpitShell>
  );
}
