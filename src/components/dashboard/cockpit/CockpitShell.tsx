import { Suspense, type ReactNode } from "react";
import { CockpitHeader } from "./CockpitHeader";

interface CockpitShellProps {
  children: ReactNode;
  /**
   * "fill" locks the page to the viewport height with the content area managing
   * its own internal scroll — used by the two-pane app views (Inbox,
   * Automations). Omitted, the page scrolls as a normal document inside the
   * centered instrument deck.
   */
  fill?: boolean;
}

const HeaderFallback = <div style={{ height: 64 }} />;

export function CockpitShell({ children, fill }: CockpitShellProps) {
  if (fill) {
    return (
      <div className="cockpit is-fill">
        <div className="ck-topbar">
          <Suspense fallback={HeaderFallback}>
            <CockpitHeader />
          </Suspense>
        </div>
        <div className="ck-fill">{children}</div>
      </div>
    );
  }

  return (
    <div className="cockpit">
      <div className="deck">
        <Suspense fallback={HeaderFallback}>
          <CockpitHeader />
        </Suspense>
        <div className="ck-page">{children}</div>
      </div>
    </div>
  );
}
