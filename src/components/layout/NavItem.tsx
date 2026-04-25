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
    <div className="relative">
      {/* Glowing accent bar — expanded mode */}
      {isActive && (
        <span
          className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-6 bg-accent-cyan rounded-r-full hidden lg:block"
          style={{ boxShadow: "0 0 10px 1px var(--accent-cyan)" }}
        />
      )}

      <Link
        href={href}
        title={label}
        className={clsx(
          "flex items-center gap-3 rounded-xl text-sm transition-all duration-200",
          "lg:justify-start justify-center",
          "px-3 py-2.5",
          isActive
            ? "bg-gradient-to-r from-accent-cyan/[0.14] via-accent-cyan/[0.06] to-transparent text-accent-cyan font-medium"
            : "text-text-muted hover:text-text-primary hover:bg-bg-card/70 font-normal"
        )}
      >
        <span
          className="w-[18px] h-[18px] flex-shrink-0 transition-all duration-200"
          style={
            isActive
              ? { filter: "drop-shadow(0 0 6px var(--accent-cyan))" }
              : undefined
          }
        >
          {icon}
        </span>
        <span className="hidden lg:block tracking-wide">{label}</span>
      </Link>
    </div>
  );
}
