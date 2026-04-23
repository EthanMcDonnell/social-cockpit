"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";

export interface NavItemProps {
  href: string;
  label: string;
  icon: React.ReactNode;
}

export function NavItem({ href, label, icon }: NavItemProps) {
  const pathname = usePathname();
  const isActive = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className="relative group">
      {/* Left accent bar — expanded mode only */}
      <span
        className={clsx(
          "absolute left-0 top-1/2 -translate-y-1/2 w-[3px] rounded-r-full transition-all duration-200 hidden lg:block",
          isActive
            ? "h-5 bg-accent-cyan opacity-100"
            : "h-3 bg-accent-cyan opacity-0 group-hover:opacity-30"
        )}
      />
      <Link
        href={href}
        title={label}
        className={clsx(
          "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150",
          "lg:justify-start justify-center",
          isActive
            ? "bg-accent-cyan/[0.1] text-accent-cyan"
            : "text-text-muted hover:text-text-primary hover:bg-bg-card/60"
        )}
      >
        <span
          className={clsx(
            "w-[18px] h-[18px] flex-shrink-0 transition-all duration-150",
            isActive ? "drop-shadow-[0_0_8px_rgba(56,189,248,0.45)]" : ""
          )}
        >
          {icon}
        </span>
        <span className="hidden lg:block">{label}</span>
      </Link>
    </div>
  );
}
