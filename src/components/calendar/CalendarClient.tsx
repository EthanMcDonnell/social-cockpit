"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { WeekGrid } from "./WeekGrid";
import { MonthGrid } from "./MonthGrid";
import { ComposerDrawer, type ComposerDraft } from "./ComposerDrawer";
import {
  usePublishedHistory,
  useScheduledPosts,
  useScheduleSettings,
  useSetTimeZone,
  useUpdateScheduledPost,
} from "@/hooks/useSchedule";
import {
  addDays,
  addMonths,
  startOfDay,
  startOfMonth,
  startOfWeek,
  systemTimeZone,
  utcToWall,
  zoneAbbreviation,
} from "@/lib/schedule/tz";
import type { ScheduledPostView } from "@/lib/schedule/types";

type View = "week" | "month" | "day";

const MONTH_NAME = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function CalendarClient() {
  const settings = useScheduleSettings();
  const setTz = useSetTimeZone();
  const move = useUpdateScheduledPost();

  const timeZone = settings.data?.timezone ?? systemTimeZone();

  const [view, setView] = useState<View>("week");
  const [anchor, setAnchor] = useState(() => Date.now());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<ScheduledPostView | null>(null);
  const [draft, setDraft] = useState<ComposerDraft | null>(null);
  const [showHistory, setShowHistory] = useState(true);

  // The window the grid shows, and therefore what we ask the API for. Month view
  // is padded to its leading/trailing week so the six-row grid is never short of
  // data at its edges.
  const window_ = useMemo(() => {
    if (view === "day") {
      const from = startOfDay(anchor, timeZone);
      return { from, to: addDays(from, 1, timeZone), start: from };
    }
    if (view === "month") {
      const first = startOfWeek(startOfMonth(anchor, timeZone), timeZone);
      return { from: first, to: addDays(first, 42, timeZone), start: startOfMonth(anchor, timeZone) };
    }
    const from = startOfWeek(anchor, timeZone);
    return { from, to: addDays(from, 7, timeZone), start: from };
  }, [view, anchor, timeZone]);

  const jobsQuery = useScheduledPosts({ from: window_.from, to: window_.to });
  // Memoised so the keyboard handler below doesn't re-subscribe on every render.
  const jobs = useMemo(() => jobsQuery.data?.jobs ?? [], [jobsQuery.data]);

  const historyQuery = usePublishedHistory(
    { from: window_.from, to: window_.to },
    showHistory
  );
  const history = showHistory ? historyQuery.data ?? [] : [];

  const step = useCallback(
    (direction: number) => {
      setAnchor((current) => {
        if (view === "month") return addMonths(current, direction, timeZone);
        return addDays(current, direction * (view === "week" ? 7 : 1), timeZone);
      });
    },
    [view, timeZone]
  );

  const onMove = useCallback(
    (id: string, scheduledAt: number) => move.mutate({ id, scheduled_at: scheduledAt }),
    [move]
  );

  const onDropFiles = useCallback(
    (files: File[], scheduledAt: number) => {
      setEditing(null);
      setDraft({ scheduledAt, files });
    },
    []
  );

  // ── keyboard ──
  // Paging and view switching without the mouse, plus [ / ] to nudge whatever
  // card is selected — the keyboard equivalent of dragging it.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select")) return;
      if (editing || draft) return;

      if (e.key === "ArrowLeft") return step(-1);
      if (e.key === "ArrowRight") return step(1);
      if (e.key === "t" || e.key === "T") return setAnchor(Date.now());
      if (e.key === "w" || e.key === "W") return setView("week");
      if (e.key === "m" || e.key === "M") return setView("month");
      if (e.key === "d" || e.key === "D") return setView("day");

      if ((e.key === "[" || e.key === "]") && selectedId) {
        const job = jobs.find((j) => j.id === selectedId);
        if (!job) return;
        const delta = (e.key === "]" ? 15 : -15) * 60_000;
        onMove(job.id, job.scheduled_at + delta);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, selectedId, jobs, onMove, editing, draft]);

  const heading = useMemo(() => {
    const w = utcToWall(window_.start, timeZone);
    if (view === "month") return `${MONTH_NAME[w.month - 1]} ${w.year}`;
    if (view === "day") return `${MONTH_NAME[w.month - 1]} ${w.day}, ${w.year}`;
    const end = utcToWall(addDays(window_.from, 6, timeZone), timeZone);
    const left = `${MONTH_NAME[w.month - 1].slice(0, 3)} ${w.day}`;
    const right =
      w.month === end.month
        ? `${end.day}`
        : `${MONTH_NAME[end.month - 1].slice(0, 3)} ${end.day}`;
    return `${left} – ${right}, ${end.year}`;
  }, [window_, view, timeZone]);

  return (
    <div className="cal">
      <header className="cal-bar">
        <div className="cal-bar-left">
          <span className="cal-tag">06</span>
          <h1>Calendar</h1>
        </div>

        <div className="cal-nav">
          <button type="button" onClick={() => step(-1)} aria-label="Previous">
            ‹
          </button>
          <button type="button" className="cal-today" onClick={() => setAnchor(Date.now())}>
            Today
          </button>
          <button type="button" onClick={() => step(1)} aria-label="Next">
            ›
          </button>
          <span className="cal-heading">{heading}</span>
        </div>

        <div className="cal-bar-right">
          <div className="cal-seg small">
            {(["day", "week", "month"] as View[]).map((v) => (
              <button
                key={v}
                type="button"
                className={view === v ? "on" : undefined}
                onClick={() => setView(v)}
              >
                {v}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={`cal-toggle${showHistory ? " on" : ""}`}
            onClick={() => setShowHistory((s) => !s)}
            title="Show posts that already went out"
          >
            Past posts
          </button>
          <TimeZonePicker
            timeZone={timeZone}
            abbreviation={settings.data?.abbreviation ?? ""}
            onChange={(tz) => setTz.mutate(tz)}
          />
          <button
            type="button"
            className="cal-btn primary"
            onClick={() => {
              setEditing(null);
              setDraft({ scheduledAt: nextRoundHour(anchor) });
            }}
          >
            + Schedule
          </button>
        </div>
      </header>

      {settings.data && !settings.data.scheduler_enabled && (
        <p className="cal-banner warn">
          The worker is disabled on this instance (SCHEDULER_ENABLED=false). Posts can be
          scheduled but nothing will publish.
        </p>
      )}
      {settings.data?.dry_run && (
        <p className="cal-banner">
          Dry run — jobs run through the full pipeline but nothing is uploaded or published.
        </p>
      )}
      {jobsQuery.isError && (
        <p className="cal-banner warn">{(jobsQuery.error as Error).message}</p>
      )}

      <div className={`cal-stage${jobsQuery.isFetching ? " is-loading" : ""}`}>
        {view === "month" ? (
          <MonthGrid
            month={window_.start}
            jobs={jobs}
            history={history}
            timeZone={timeZone}
            selectedId={selectedId}
            onMove={onMove}
            onOpen={setEditing}
            onSelect={setSelectedId}
            onDropFiles={onDropFiles}
            onExpandDay={(day) => {
              setAnchor(day);
              setView("day");
            }}
          />
        ) : (
          <WeekGrid
            weekStart={window_.from}
            dayCount={view === "day" ? 1 : 7}
            jobs={jobs}
            history={history}
            timeZone={timeZone}
            selectedId={selectedId}
            onMove={onMove}
            onOpen={setEditing}
            onSelect={setSelectedId}
            onDropFiles={onDropFiles}
          />
        )}
      </div>

      {(editing || draft) && (
        <ComposerDrawer
          timeZone={timeZone}
          job={editing}
          draft={draft}
          onClose={() => {
            setEditing(null);
            setDraft(null);
          }}
        />
      )}
    </div>
  );
}

/** The next whole hour — a sane default slot for a post created from the button. */
function nextRoundHour(from: number): number {
  const base = Math.max(from, Date.now());
  return Math.ceil(base / 3_600_000) * 3_600_000;
}

const COMMON_ZONES = [
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Dubai",
  "Asia/Singapore",
  "Australia/Sydney",
  "UTC",
];

function TimeZonePicker({
  timeZone,
  abbreviation,
  onChange,
}: {
  timeZone: string;
  abbreviation: string;
  onChange: (tz: string) => void;
}) {
  // The system zone is offered even when it isn't in the shortlist — it's the
  // one a single-user install almost always wants.
  const options = useMemo(() => {
    const set = new Set(COMMON_ZONES);
    set.add(systemTimeZone());
    set.add(timeZone);
    return Array.from(set).sort();
  }, [timeZone]);

  return (
    <label className="cal-tz" title="Every slot on this calendar is read in this timezone">
      <select value={timeZone} onChange={(e) => onChange(e.target.value)}>
        {options.map((tz) => (
          <option key={tz} value={tz}>
            {tz.replace(/_/g, " ")}
          </option>
        ))}
      </select>
      <span>{abbreviation || zoneAbbreviation(Date.now(), timeZone)}</span>
    </label>
  );
}
