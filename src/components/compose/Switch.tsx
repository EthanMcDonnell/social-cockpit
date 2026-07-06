"use client";

export function Switch({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (value: boolean) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`cs-sw${on ? " on" : ""}`}
      onClick={() => onChange(!on)}
    />
  );
}
