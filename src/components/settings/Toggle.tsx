"use client";

/**
 * The settings switch, extracted so the three panels that use one agree on how
 * it looks and behaves.
 *
 * `locked` is distinct from `disabled`: disabled means "busy, try again in a
 * moment", while locked means the control is not yours to change because `.env`
 * has already decided. The panels pair it with a line of text saying which
 * variable made the decision, since a switch you cannot move and cannot explain
 * is worse than no switch.
 */
export function Toggle({
  checked,
  onChange,
  disabled = false,
  locked = false,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  locked?: boolean;
  label: string;
}) {
  const inert = disabled || locked;

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={inert}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors disabled:cursor-default disabled:opacity-50 ${
        checked ? "bg-[var(--accent-cyan)]" : "bg-[var(--border)]"
      }`}
    >
      <span
        aria-hidden="true"
        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ease-in-out ${
          checked ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}
