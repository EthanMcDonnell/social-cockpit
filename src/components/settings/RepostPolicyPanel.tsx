"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Toggle } from "@/components/settings/Toggle";
import { useScheduleSettings, useUpdateScheduleSettings } from "@/hooks/useSchedule";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * When and whether old content gets a second run.
 *
 * Edits are batched behind a Save rather than written per keystroke, for the
 * same reason the posting policy is: a number field passes through "" and "2"
 * on the way to "20000", and each of those is a value the server would happily
 * store — here one of them would make every video in the archive repostable.
 *
 * The two toggles at the top of the Slugs page are the other half of this.
 * Nothing here turns reposting on for any content: that is a per-slug opt-in,
 * deliberately, so enabling a cadence can never start recycling material you
 * never marked as evergreen.
 */
export function RepostPolicyPanel() {
  const settings = useScheduleSettings();
  const update = useUpdateScheduleSettings();
  const data = settings.data?.repost;

  const [minViews, setMinViews] = useState("");
  const [blockBelow, setBlockBelow] = useState("");
  const [minGap, setMinGap] = useState("");
  const [evaluateAfter, setEvaluateAfter] = useState("");
  const [maxPerWeek, setMaxPerWeek] = useState("");
  const [times, setTimes] = useState<string[][]>([]);

  // Re-seed whenever the server's copy changes, so an edit made elsewhere
  // (MCP, another tab) doesn't leave this form showing something stale.
  useEffect(() => {
    if (!data) return;
    setMinViews(String(data.min_views));
    setBlockBelow(String(data.block_below_views));
    setMinGap(String(data.min_gap_days));
    setEvaluateAfter(String(data.evaluate_after_hours));
    setMaxPerWeek(String(data.max_per_week));
    setTimes(data.times_by_weekday.map((day) => [...day]));
  }, [data]);

  const numbers = {
    min_views: Number(minViews),
    block_below_views: Number(blockBelow),
    min_gap_days: Number(minGap),
    evaluate_after_hours: Number(evaluateAfter),
    max_per_week: Number(maxPerWeek),
  };

  const problem =
    !Number.isInteger(numbers.min_views) || numbers.min_views < 0
      ? "Minimum views must be a whole number."
      : !Number.isInteger(numbers.block_below_views) || numbers.block_below_views < 0
        ? "The block threshold must be a whole number."
        : numbers.block_below_views >= numbers.min_views && numbers.min_views > 0
          ? "The block threshold should sit below the minimum view count, or every repost retires its video."
          : !Number.isInteger(numbers.min_gap_days) || numbers.min_gap_days < 1
            ? "The rest period must be at least 1 day."
            : !Number.isInteger(numbers.evaluate_after_hours) || numbers.evaluate_after_hours < 1
              ? "The judging delay must be at least 1 hour."
              : !Number.isInteger(numbers.max_per_week) || numbers.max_per_week < 0
                ? "Max per week must be a whole number."
                : null;

  const dirty =
    !!data &&
    (String(data.min_views) !== minViews ||
      String(data.block_below_views) !== blockBelow ||
      String(data.min_gap_days) !== minGap ||
      String(data.evaluate_after_hours) !== evaluateAfter ||
      String(data.max_per_week) !== maxPerWeek ||
      JSON.stringify(data.times_by_weekday) !== JSON.stringify(times));

  const busy = settings.isLoading || update.isPending;

  function save() {
    if (problem) return;
    update.mutate({ repost: { ...numbers, times_by_weekday: times } });
  }

  function setDayTime(day: number, index: number, value: string) {
    const next = times.map((d) => [...d]);
    next[day][index] = value;
    setTimes(next);
  }

  function toggleDay(day: number) {
    const next = times.map((d) => [...d]);
    // A day with no times is how "no repost that day" is expressed. Restoring
    // one picks a mid-afternoon default rather than copying a neighbouring day,
    // which would undo the staggering the defaults exist to provide.
    next[day] = next[day].length ? [] : ["13:00"];
    setTimes(next);
  }

  return (
    <Card padding="none">
      <div className="divide-y divide-[var(--border)]">
        <div className="p-5">
          <p className="text-sm font-medium text-[var(--text-primary)]">Reposting</p>
          <p className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">
            Reposts publish as <strong>trial reels</strong>, shown to non-followers first, and are
            only ever promoted to your main feed by hand. That is fixed, not a setting. Nothing is
            reposted until you enable it on a slug — see the Slugs page.
          </p>
        </div>

        <Field
          title="Minimum views to qualify"
          description="A video must have earned at least this many views the first time round before it is worth running again."
        >
          <NumberInput value={minViews} onChange={setMinViews} disabled={busy} width="6rem" />
        </Field>

        <Field
          title="Retire below"
          description="If a repost lands under this, that video is blocked from reposting again. Shown on the Slugs page with the view count that caused it, and reversible there."
        >
          <NumberInput value={blockBelow} onChange={setBlockBelow} disabled={busy} width="6rem" />
        </Field>

        <Field
          title="Judge a repost after"
          description="How long to wait before reading a repost's views. Long enough that a slow start isn't mistaken for a flop."
        >
          <div className="flex items-center gap-2">
            <NumberInput value={evaluateAfter} onChange={setEvaluateAfter} disabled={busy} />
            <span className="text-xs text-[var(--text-muted)]">hours</span>
          </div>
        </Field>

        <Field
          title="Rest between runs"
          description="How long a video must wait before a second outing. Videos that have never been reposted always go first, whatever this is set to."
        >
          <div className="flex items-center gap-2">
            <NumberInput value={minGap} onChange={setMinGap} disabled={busy} />
            <span className="text-xs text-[var(--text-muted)]">days</span>
          </div>
        </Field>

        <Field
          title="Max reposts per week"
          description="A ceiling on how often the app books a repost. The account-wide daily cap still applies on top of this."
        >
          <NumberInput value={maxPerWeek} onChange={setMaxPerWeek} disabled={busy} />
        </Field>

        <div className="p-5">
          <p className="text-sm font-medium text-[var(--text-primary)]">Repost times</p>
          <p className="mt-1 mb-3 text-xs leading-relaxed text-[var(--text-muted)]">
            When repost slots are booked, per day. Deliberately staggered rather than identical —
            the same clock reading every day reads as automation. Switch a day off to skip it.
          </p>
          <div className="space-y-1.5">
            {WEEKDAYS.map((label, day) => {
              const slots = times[day] ?? [];
              return (
                <div key={label} className="flex items-center gap-3">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => toggleDay(day)}
                    className={`w-12 shrink-0 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                      slots.length
                        ? "bg-[var(--accent-cyan)]/15 text-[var(--accent-cyan)]"
                        : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                    } disabled:opacity-40`}
                  >
                    {label}
                  </button>
                  {slots.length ? (
                    slots.map((time, index) => (
                      <input
                        key={index}
                        type="time"
                        value={time}
                        disabled={busy}
                        onChange={(e) => setDayTime(day, index, e.target.value)}
                        className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-2.5 py-1 text-xs text-[var(--text-primary)]"
                      />
                    ))
                  ) : (
                    <span className="text-xs text-[var(--text-muted)]">No repost</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <Field
          title="Book repost slots automatically"
          description="Keeps the calendar topped up over the next two weeks. Does nothing until a slug is set to be a repost pool. Auto-booked slots can be moved or deleted like any other, and deleting one keeps it deleted."
        >
          <Toggle
            checked={data?.autobook ?? false}
            disabled={busy || !data}
            onChange={(value) => update.mutate({ repost: { autobook: value } })}
            label="Book repost slots automatically"
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

function NumberInput({
  value,
  onChange,
  disabled,
  width = "4.5rem",
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  width?: string;
}) {
  return (
    <input
      type="number"
      min={0}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      style={{ width }}
      className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-3 py-1.5 text-xs text-[var(--text-primary)] disabled:opacity-50"
    />
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
        <p className="text-xs leading-relaxed text-[var(--text-muted)]">{description}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
