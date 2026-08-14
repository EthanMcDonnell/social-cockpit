"use client";

import { Card } from "@/components/ui/Card";
import { Toggle } from "./Toggle";
import { useScheduleSettings, useUpdateScheduleSettings } from "@/hooks/useSchedule";

/**
 * Pause publishing, and force dry run.
 *
 * Both settings have two sources: an `.env` variable read at boot, and a stored
 * value editable here. They compose so that either source can make the system
 * *safer* and neither can override the other's decision to be safe —
 * `SCHEDULER_ENABLED=false` cannot be un-done from this panel, and a stored
 * pause cannot be un-done by `.env` without also clearing the pause.
 *
 * The pause exists because, until now, stopping the scheduler meant editing
 * `.env` and restarting the server — which on this deployment is the one thing
 * we don't do. That left no way to stop publishing at all.
 */
export function SchedulerPanel() {
  const settings = useScheduleSettings();
  const update = useUpdateScheduleSettings();

  const data = settings.data;
  const busy = settings.isLoading || update.isPending;

  // .env has disabled the worker outright, so pausing is already moot.
  const envDisabled = data ? !data.scheduler_env_enabled : false;
  const envForcesDryRun = data?.dry_run_env ?? false;

  return (
    <Card padding="none">
      <div className="divide-y divide-[var(--border)]">
        <Row
          title="Pause publishing"
          description={
            envDisabled
              ? "Already disabled by SCHEDULER_ENABLED=false in .env. Nothing will publish regardless of this switch."
              : "Scheduled posts stay on the calendar, and the worker keeps running, but nothing is published until you switch this back."
          }
          checked={data?.paused ?? false}
          locked={envDisabled}
          disabled={busy || !data}
          onChange={(paused) => update.mutate({ paused })}
          label="Pause publishing"
        />

        <Row
          title="Dry run"
          description={
            envForcesDryRun
              ? "Forced on by SCHEDULE_DRY_RUN=true in .env and cannot be switched off here."
              : "Jobs walk the whole pipeline — claims, leases, file checks — but no upload or platform call happens. Useful for testing a schedule against the live data without posting."
          }
          checked={data?.dry_run_stored ?? false}
          locked={envForcesDryRun}
          disabled={busy || !data}
          onChange={(dry_run) => update.mutate({ dry_run })}
          label="Dry run"
        />
      </div>

      {data && (
        <p className="border-t border-[var(--border)] px-5 py-3 text-xs text-[var(--text-muted)]">
          Right now:{" "}
          <span className="text-[var(--text-primary)]">
            {!data.scheduler_enabled
              ? "not publishing"
              : data.dry_run
                ? "running, but nothing leaves the machine"
                : "publishing normally"}
          </span>
          .
        </p>
      )}

      {update.isError && (
        <p className="px-5 pb-4 text-xs text-[var(--accent-red)]">
          {(update.error as Error).message}
        </p>
      )}
    </Card>
  );
}

function Row({
  title,
  description,
  checked,
  onChange,
  disabled,
  locked,
  label,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled: boolean;
  locked: boolean;
  label: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 p-5">
      <div className="space-y-1">
        <p className="text-sm font-medium text-[var(--text-primary)]">{title}</p>
        <p className="text-xs text-[var(--text-muted)] leading-relaxed">{description}</p>
      </div>
      <Toggle
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        locked={locked}
        label={label}
      />
    </div>
  );
}
