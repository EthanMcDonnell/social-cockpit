import Link from "next/link";
import { AppShell } from "@/components/layout/AppShell";
import { TopBar } from "@/components/layout/TopBar";

export const metadata = {
  title: "Compose",
};

export default function ComposePage() {
  return (
    <AppShell>
      <TopBar title="Compose" />
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center gap-6">
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-widest text-[var(--text-muted)] font-medium">
            Coming Soon
          </p>
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">
            Post Composer
          </h2>
          <p className="text-sm text-[var(--text-muted)] max-w-xs">
            Create and schedule Instagram posts, manage drafts, and upload media directly from the cockpit.
          </p>
        </div>

        <ul className="space-y-2 text-left">
          {[
            "Draft and preview posts before publishing",
            "Schedule posts with calendar picker",
            "Multi-image carousel support",
            "Reels and video upload",
            "Caption templates and hashtag sets",
          ].map((feature) => (
            <li key={feature} className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
              <span className="text-[var(--border)]">○</span>
              {feature}
            </li>
          ))}
        </ul>

        <Link
          href="/dashboard"
          className="text-xs text-[var(--accent-cyan)] hover:underline"
        >
          ← Back to Dashboard
        </Link>
      </div>
    </AppShell>
  );
}
