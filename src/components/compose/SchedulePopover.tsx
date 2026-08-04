"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useScheduleDraft } from "@/lib/compose/useScheduleDraft";
import { useScheduleSettings } from "@/hooks/useSchedule";
import { parseScheduledAt, systemTimeZone, toLocalInputValue } from "@/lib/schedule/tz";
import type { ComposeDraft } from "@/lib/compose/draft";
import type { PublishFiles } from "@/lib/compose/usePublish";

interface SchedulePopoverProps {
  draft: ComposeDraft;
  files: PublishFiles;
  onClose: () => void;
}

/** Default slot: the next whole hour. */
function nextHour(): number {
  return Math.ceil(Date.now() / 3_600_000) * 3_600_000;
}

/**
 * The Schedule half of the Compose actions.
 *
 * Transmit sends the post now via R2; this stages the same draft on local disk
 * and hands it to the scheduler, which does the R2 round trip itself when the
 * slot arrives. The file never leaves this machine in the meantime.
 */
export function SchedulePopover({ draft, files, onClose }: SchedulePopoverProps) {
  const settings = useScheduleSettings();
  const timeZone = settings.data?.timezone ?? systemTimeZone();
  const schedule = useScheduleDraft();

  const [when, setWhen] = useState(() => toLocalInputValue(nextHour(), timeZone));
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(false);

  // Settings arrive after first paint; re-derive the default in the real zone.
  useEffect(() => {
    if (settings.data) setWhen(toLocalInputValue(nextHour(), settings.data.timezone));
  }, [settings.data]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit() {
    const at = parseScheduledAt(when, timeZone);
    if (at == null) return;
    await schedule.mutateAsync({ draft, files, scheduledAt: at, onProgress: setProgress });
    setDone(true);
  }

  if (done) {
    return (
      <div className="cs-sched">
        <p className="cs-sched-ok">
          Scheduled ✓ <Link href="/calendar">Open the calendar →</Link>
        </p>
        <button type="button" className="cs-ghost" onClick={onClose}>
          Done
        </button>
      </div>
    );
  }

  const busy = schedule.isPending;

  return (
    <div className="cs-sched">
      <label htmlFor="cs-when">Publish at</label>
      <input
        id="cs-when"
        type="datetime-local"
        value={when}
        onChange={(e) => setWhen(e.target.value)}
        disabled={busy}
      />
      <p className="cs-sched-hint">
        {timeZone} · the file stays on this machine until then
      </p>

      {busy && progress > 0 && progress < 1 && (
        <span className="cs-sched-bar">
          <span style={{ width: `${Math.round(progress * 100)}%` }} />
        </span>
      )}
      {schedule.isError && <p className="cs-msg err">{schedule.error.message}</p>}

      <div className="cs-sched-actions">
        <button type="button" className="cs-ghost" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="cs-transmit" onClick={submit} disabled={busy}>
          {busy ? (progress < 1 ? `Staging ${Math.round(progress * 100)}%` : "Scheduling…") : "▸ Schedule"}
        </button>
      </div>
    </div>
  );
}
