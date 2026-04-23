import { clsx } from "clsx";

type BadgeVariant = "default" | "cyan" | "amber" | "green" | "red" | "muted";

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  className?: string;
}

const variantClasses: Record<BadgeVariant, string> = {
  default: "bg-[var(--border)] text-[var(--text-primary)]",
  cyan: "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20",
  amber: "bg-amber-500/10 text-amber-400 border border-amber-500/20",
  green: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20",
  red: "bg-red-500/10 text-red-400 border border-red-500/20",
  muted: "bg-transparent text-[var(--text-muted)] border border-[var(--border)]",
};

export function Badge({ children, variant = "default", className }: BadgeProps) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded px-1.5 py-0.5 text-xs font-mono font-medium",
        variantClasses[variant],
        className
      )}
    >
      {children}
    </span>
  );
}
