import { getTokenStatus } from "@/lib/token/manager";
import { NavItem } from "./NavItem";

const NAV_ITEMS = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
    ),
  },
  {
    href: "/posts",
    label: "Posts",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M3 9h18M9 21V9" />
      </svg>
    ),
  },
  {
    href: "/compose",
    label: "Compose",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
      </svg>
    ),
  },
  {
    href: "/automations",
    label: "Automations",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
      </svg>
    ),
  },
  {
    href: "/inbox",
    label: "Inbox",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
];

const SETTINGS_ITEM = {
  href: "/settings",
  label: "Settings",
  icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
};

type TokenStatus = "healthy" | "warning" | "expired" | "unknown";

function TokenFooter({
  status,
  daysRemaining,
}: {
  status: TokenStatus;
  daysRemaining: number | null;
}) {
  const dotColor: Record<TokenStatus, string> = {
    healthy: "bg-accent-green",
    warning: "bg-accent-amber",
    expired: "bg-accent-red",
    unknown: "bg-text-muted",
  };

  const pingColor: Record<TokenStatus, string> = {
    healthy: "bg-accent-green",
    warning: "bg-accent-amber",
    expired: "bg-accent-red",
    unknown: "bg-text-muted",
  };

  const statusLabel: Record<TokenStatus, string> = {
    healthy:
      daysRemaining != null ? `${daysRemaining}d remaining` : "Token active",
    warning:
      daysRemaining != null
        ? `Expiring in ${daysRemaining}d`
        : "Expiring soon",
    expired: "Token expired",
    unknown: "No expiry set",
  };

  return (
    <div className="px-3 py-3 border-t border-border/60 lg:px-4">
      <div className="flex items-center lg:justify-start justify-center gap-2.5">
        {/* Pulsing dot */}
        <div className="relative flex-shrink-0 w-2 h-2">
          <span
            className={`absolute inset-0 rounded-full animate-ping opacity-50 ${pingColor[status]}`}
          />
          <span
            className={`relative w-2 h-2 rounded-full block ${dotColor[status]}`}
          />
        </div>
        <div className="hidden lg:block min-w-0">
          <p className="text-[11px] font-medium text-text-muted leading-none truncate">
            {statusLabel[status]}
          </p>
          <p className="text-[9px] text-text-muted/40 mt-1 font-mono uppercase tracking-wider">
            Instagram API
          </p>
        </div>
      </div>
    </div>
  );
}

export async function Sidebar() {
  const tokenState = getTokenStatus();

  return (
    <aside
      className="hidden md:flex md:w-16 lg:w-60 flex-shrink-0 flex-col h-full border-r border-border/70 rounded-r-2xl overflow-hidden"
      style={{
        background:
          "linear-gradient(170deg, var(--bg-sidebar) 0%, color-mix(in srgb, var(--bg-sidebar) 80%, var(--bg-card) 20%) 100%)",
      }}
    >
      {/* Brand header */}
      <div className="h-14 px-3 lg:px-5 flex items-center gap-3 flex-shrink-0">
        {/* Glowing icon mark */}
        <div
          className="w-7 h-7 flex-shrink-0 rounded-lg flex items-center justify-center"
          style={{
            background:
              "linear-gradient(135deg, color-mix(in srgb, var(--accent-cyan) 20%, transparent) 0%, color-mix(in srgb, var(--accent-cyan) 8%, transparent) 100%)",
            border: "1px solid color-mix(in srgb, var(--accent-cyan) 25%, transparent)",
            boxShadow:
              "0 0 16px -2px color-mix(in srgb, var(--accent-cyan) 30%, transparent), inset 0 1px 0 color-mix(in srgb, var(--accent-cyan) 15%, transparent)",
          }}
        >
          <svg
            viewBox="0 0 14 14"
            fill="none"
            className="w-3.5 h-3.5 text-accent-cyan"
          >
            <rect x="1" y="1" width="5" height="5" rx="1" fill="currentColor" opacity="0.95" />
            <rect x="8" y="1" width="5" height="5" rx="1" fill="currentColor" opacity="0.6" />
            <rect x="1" y="8" width="5" height="5" rx="1" fill="currentColor" opacity="0.6" />
            <rect x="8" y="8" width="5" height="5" rx="1" fill="currentColor" opacity="0.25" />
          </svg>
        </div>
        <div className="hidden lg:block">
          <span
            className="font-heading text-[11px] font-bold tracking-[0.16em] uppercase"
            style={{
              background: "linear-gradient(90deg, var(--text-primary) 0%, var(--text-muted) 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            Social Cockpit
          </span>
        </div>
      </div>

      {/* Divider */}
      <div className="h-px bg-border/60 flex-shrink-0" />

      {/* Navigation */}
      <nav className="flex-1 px-2 py-4 space-y-0.5 overflow-y-auto">
        {/* Nav section label */}
        <p className="hidden lg:block px-3 mb-2 text-[9px] font-mono uppercase tracking-[0.18em] text-text-muted/40 select-none">
          Navigate
        </p>
        {NAV_ITEMS.map((item) => (
          <NavItem key={item.href} href={item.href} label={item.label} icon={item.icon} />
        ))}
      </nav>

      {/* Bottom utility section */}
      <div className="px-2 pb-2 border-t border-border/60 pt-2">
        <NavItem
          href={SETTINGS_ITEM.href}
          label={SETTINGS_ITEM.label}
          icon={SETTINGS_ITEM.icon}
        />
      </div>

      {/* Token status footer */}
      <TokenFooter status={tokenState.status} daysRemaining={tokenState.daysRemaining} />
    </aside>
  );
}
