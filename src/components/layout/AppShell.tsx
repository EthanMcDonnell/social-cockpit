import { Sidebar } from "./Sidebar";
import { MobileBottomNav } from "./MobileBottomNav";

export interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="flex h-screen overflow-hidden bg-bg-base text-text-primary">
      <Sidebar />
      <main className="flex-1 flex flex-col overflow-hidden pb-16 md:pb-0">
        {children}
      </main>
      <MobileBottomNav />
    </div>
  );
}
