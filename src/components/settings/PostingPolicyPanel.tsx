"use client";

import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import { useScheduleSettings, useUpdateScheduleSettings } from "@/hooks/useSchedule";
import { systemTimeZone, zoneAbbreviation } from "@/lib/schedule/tz";
import { COMMON_ZONES } from "@/lib/schedule/zones";

/**
 * The posting policy: where slots are offered, how many a day may hold, and how
 * far apart two hooks of one video must sit.
 *
 * These were added to the API and the database earlier but had no UI at all —
 * the only way to change them was curl or the MCP server. They live in
 * `app_settings` rather than `.env` because changing them alters what every
 * slot means and so has to take effect without a restart.
 *
 * Edits are batched behind a Save rather than written per keystroke: a number
 * field passes through states like "" and "1" on the way to "12", and each of
 * those is a legal value the server would happily store.
 */
export function PostingPolicyPanel() {
  const settings = useScheduleSettings();
  const update = useUpdateScheduleSettings();
  const data = settings.data;

  const [times, setTimes] = useState<string[]>([]);
  const [maxPerDay, setMaxPerDay] = useState("");
  const [minDays, setMinDays] = useState("");

  // Re-seed whenever the server's copy changes, so an edit made elsewhere (MCP,
  // another tab) doesn't leave this form showing something stale.
  useEffect(() => {
    if (!data) return;
    setTimes(data.suggested_times);
    setMaxPerDay(String(data.max_posts_per_day));
    setMinDays(String(data.min_same_video_days));
  }, [data]);

  const zoneOptions = useMemo(() => {
    const set = new Set(COMMON_ZONES);
    set.add(systemTimeZone());
    if (data?.timezone) set.add(data.timezone);
    return Array.from(set).sort();
  }, [data?.timezone]);

  const dirty =
    !!data &&
    (maxPerDay !== String(data.max_posts_per_day) ||
      minDays !== String(data.min_same_video_days) ||
      times.join(",") !== data.suggested_times.join(","));

  const maxPerDayNum = Number(maxPerDay);
  const minDaysNum = Number(minDays);
  const problem =
    times.length === 0
      ? "At least one posting time is required."
      : !Number.isInteger(maxPerDayNum) || maxPerDayNum < 1
        ? "Max posts per day must be a whole number of at least 1."
        : !Number.isFinite(minDaysNum) || minDaysNum < 0
          ? "Minimum spacing must be zero or more."
          : null;

  const busy = settings.isLoading || update.isPending;

  function save() {
    if (problem) return;
    update.mutate({
      suggested_times: times,
      max_posts_per_day: maxPerDayNum,
      min_same_video_days: minDaysNum,
    });
  }

  return (
    <Card padding="none">
      <div className="divide-y divide-[var(--border)]">
        <Field
          title="Timezone"
          description="Every slot on the calendar is read in this zone. Changing it changes what an already-scheduled time means."
        >
          <select
            value={data?.timezone ?? ""}
            disabled={busy || !data}
            onChange={(e) => update.mutate({ timezone: e.target.value })}
            className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-3 py-1.5 text-xs text-[var(--text-primary)] disabled:opacity-50"
          >
            {zoneOptions.map((tz) => (
              <option key={tz} value={tz}>
                {tz.replace(/_/g, " ")} ({zoneAbbreviation(Date.now(), tz)})
              </option>
            ))}
          </select>
        </Field>

        <Field
          title="Preferred posting times"
          description="Where new slots are offered, earliest first. More than one entry is how a day holds more than one post — but the daily cap below still applies."
        >
          <div className="space-y-2">
            {times.map((time, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="time"
                  value={time}
                  disabled={busy}
                  onChange={(e) => {
                    const next = [...times];
                    next[i] = e.target.value;
                    setTimes(next);
                  }}
                  className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-3 py-1.5 text-xs text-[var(--text-primary)]"
                />
                <button
                  type="button"
                  disabled={busy || times.length === 1}
                  onClick={() => setTimes(times.filter((_, j) => j !== i))}
                  title={
                    times.length === 1
                      ? "At least one posting time is required"
                      : "Remove this time"
                  }
                  className="text-xs text-[var(--text-muted)] hover:text-[var(--accent-red)] disabled:opacity-40 disabled:hover:text-[var(--text-muted)]"
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              disabled={busy}
              onClick={() => setTimes([...times, "18:00"])}
              className="text-xs text-[var(--accent-cyan)] hover:underline disabled:opacity-40"
            >
              + Add time
            </button>
          </div>
        </Field>

        <Field
          title="Max posts per day"
          description="A hard ceiling, not a suggestion — booking past it is rejected. Counts posts published outside the scheduler too, so it describes the account rather than just this app's bookings."
        >
          <input
            type="number"
            min={1}
            value={maxPerDay}
            disabled={busy}
            onChange={(e) => setMaxPerDay(e.target.value)}
            className="w-20 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-3 py-1.5 text-xs text-[var(--text-primary)]"
          />
        </Field>

        <Field
          title="Days between hooks of one video"
          description="Two hooks cut from the same video share a body and a voiceover, so posting them close together reads as a near-duplicate and the later one gets throttled. Different videos are unaffected and may share a day."
        >
          <input
            type="number"
            min={0}
            value={minDays}
            disabled={busy}
            onChange={(e) => setMinDays(e.target.value)}
            className="w-20 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-3 py-1.5 text-xs text-[var(--text-primary)]"
          />
        </Field>
      </div>

      <div className="flex items-center justify-between gap-4 border-t border-[var(--border)] px-5 py-3">
        <p className="text-xs text-[var(--accent-red)]">
          {problem && dirty ? problem : update.isError ? (update.error as Error).message : ""}
        </p>
        <button
          type="button"
          disabled={busy || !dirty || !!problem}
          onClick={save}
          className="rounded-lg bg-[var(--accent-cyan)] px-3 py-1.5 text-xs font-medium text-black disabled:opacity-40"
        >
          {update.isPending ? "Saving…" : "Save"}
        </button>
      </div>
    </Card>
  );
}

function Field({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-6 p-5">
      <div className="space-y-1">
        <p className="text-sm font-medium text-[var(--text-primary)]">{title}</p>
        <p className="text-xs text-[var(--text-muted)] leading-relaxed">{description}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
