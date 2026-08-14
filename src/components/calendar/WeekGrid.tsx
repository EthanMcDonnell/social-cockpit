"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { JobCard } from "./JobCard";
import { useSlotDrag } from "./useSlotDrag";
import {
  addDays,
  dayOfWeek,
  formatTime,
  sameLocalDay,
  startOfDay,
  utcToWall,
  wallToUtc,
} from "@/lib/schedule/tz";
import type { ScheduledPostView } from "@/lib/schedule/types";
import type { PublishedEntry } from "@/hooks/useSchedule";

/** Pixels per hour. 56 fits a whole day on a laptop without cards getting cramped. */
const HOUR_H = 56;
/** Drag snapping, in minutes. Fine enough to be precise, coarse enough to feel magnetic. */
const SNAP_MIN = 15;
const CARD_H = 54;
const DOW_LABEL = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface WeekGridProps {
  weekStart: number;
  jobs: ScheduledPostView[];
  timeZone: string;
  selectedId?: string | null;
  /** 7 for the week view, 1 for the day view — the timeline is otherwise identical. */
  dayCount?: number;
  /** Already-published posts, drawn behind the scheduled ones. Read-only. */
  history?: PublishedEntry[];
  onMove: (id: string, scheduledAt: number) => void;
  onOpen: (job: ScheduledPostView) => void;
  onSelect: (id: string | null) => void;
  /** A file was dropped from the desktop onto a slot. */
  onDropFiles: (files: File[], scheduledAt: number) => void;
}

/** Cards that overlap in time share a column, so none is completely hidden. */
interface Placed {
  job: ScheduledPostView;
  dayIndex: number;
  top: number;
  lane: number;
  lanes: number;
}

export function WeekGrid({
  weekStart,
  jobs,
  timeZone,
  selectedId,
  dayCount = 7,
  history,
  onMove,
  onOpen,
  onSelect,
  onDropFiles,
}: WeekGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const colsRef = useRef<HTMLDivElement>(null);
  const [dropSlot, setDropSlot] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [scrollbarW, setScrollbarW] = useState(0);

  const days = useMemo(
    () => Array.from({ length: dayCount }, (_, i) => addDays(weekStart, i, timeZone)),
    [weekStart, timeZone, dayCount]
  );

  // The "now" line only needs minute resolution.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  // Open on the working day rather than at midnight — nobody schedules at 03:00,
  // and landing there makes the grid look empty.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = 7 * HOUR_H;
  }, []);

  // The body scrolls and the header doesn't, so a classic (space-taking)
  // scrollbar makes the body narrower than the header and the day columns drift
  // left — a couple of pixels each, a whole scrollbar's worth by Sunday. Feed
  // the measured width back as padding on the header. Zero on overlay
  // scrollbars, which is exactly right: they take no space.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setScrollbarW(el.offsetWidth - el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /** Viewport point → the slot beneath it, snapped. Shared by drag and file-drop. */
  const resolveSlot = useCallback(
    (clientX: number, clientY: number): number | null => {
      const el = colsRef.current;
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      if (clientX < rect.left || clientX > rect.right) return null;

      const colWidth = rect.width / dayCount;
      const dayIndex = Math.min(
        dayCount - 1,
        Math.max(0, Math.floor((clientX - rect.left) / colWidth))
      );

      const rawMinutes = ((clientY - rect.top) / HOUR_H) * 60;
      const clamped = Math.min(24 * 60 - SNAP_MIN, Math.max(0, rawMinutes));
      const snapped = Math.round(clamped / SNAP_MIN) * SNAP_MIN;

      // Build the instant from wall-clock components rather than adding minutes
      // to midnight, so a DST day doesn't land an hour off.
      const wall = utcToWall(days[dayIndex], timeZone);
      return wallToUtc(
        {
          ...wall,
          hour: Math.floor(snapped / 60),
          minute: snapped % 60,
          second: 0,
        },
        timeZone
      );
    },
    [days, timeZone, dayCount]
  );

  const { drag, startDrag } = useSlotDrag({
    resolveSlot,
    onCommit: onMove,
    scrollRef,
    canDrag: (id) => {
      const job = jobs.find((j) => j.id === id);
      return !!job && job.status !== "publishing" && job.status !== "finalizing";
    },
  });

  // ── placement, with overlap lanes ──
  const placed = useMemo<Placed[]>(() => {
    const byDay = new Map<number, ScheduledPostView[]>();
    for (const job of jobs) {
      const idx = days.findIndex((d) => sameLocalDay(d, job.scheduled_at, timeZone));
      if (idx < 0) continue;
      const list = byDay.get(idx) ?? [];
      list.push(job);
      byDay.set(idx, list);
    }

    const out: Placed[] = [];
    for (const entry of Array.from(byDay.entries())) {
      const [dayIndex, list] = entry;
      list.sort((a, b) => a.scheduled_at - b.scheduled_at);

      // Greedy lane assignment: a card joins the first lane whose last card has
      // already ended by the time this one starts.
      const laneEnds: number[] = [];
      const assigned = list.map((job) => {
        const wall = utcToWall(job.scheduled_at, timeZone);
        const top = ((wall.hour * 60 + wall.minute) / 60) * HOUR_H;
        let lane = laneEnds.findIndex((end) => end <= top);
        if (lane === -1) {
          lane = laneEnds.length;
          laneEnds.push(0);
        }
        laneEnds[lane] = top + CARD_H;
        return { job, dayIndex, top, lane };
      });

      for (const a of assigned) out.push({ ...a, lanes: laneEnds.length });
    }
    return out;
  }, [jobs, days, timeZone]);

  // ── desktop file drop ──
  const onDragOver = (e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer.types).includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDropSlot(resolveSlot(e.clientX, e.clientY));
  };

  const onDrop = (e: React.DragEvent) => {
    const files = Array.from(e.dataTransfer.files ?? []);
    if (!files.length) return;
    e.preventDefault();
    const slot = resolveSlot(e.clientX, e.clientY);
    setDropSlot(null);
    if (slot != null) onDropFiles(files, slot);
  };

  const nowTop = useMemo(() => {
    const wall = utcToWall(now, timeZone);
    return ((wall.hour * 60 + wall.minute) / 60) * HOUR_H;
  }, [now, timeZone]);

  const todayIndex = days.findIndex((d) => sameLocalDay(d, now, timeZone));
  const dragTarget = drag?.target ?? null;

  return (
    <div className="cal-week" style={{ ["--cal-sbw" as string]: `${scrollbarW}px` }}>
      <div className="cal-week-head" style={{ ["--cal-days" as string]: dayCount }}>
        <div className="cal-gutter-cell" />
        {days.map((day, i) => {
          const wall = utcToWall(day, timeZone);
          const isToday = i === todayIndex;
          return (
            <div key={day} className={`cal-dayhead${isToday ? " is-today" : ""}`}>
              <span className="cal-dayhead-dow">{DOW_LABEL[dayOfWeek(day, timeZone)]}</span>
              <span className="cal-dayhead-num">{wall.day}</span>
            </div>
          );
        })}
      </div>

      <div className="cal-week-scroll" ref={scrollRef}>
        <div className="cal-week-body" style={{ height: 24 * HOUR_H }}>
          <div className="cal-gutter">
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="cal-gutter-hour" style={{ height: HOUR_H }}>
                <span>{String(h).padStart(2, "0")}:00</span>
              </div>
            ))}
          </div>

          <div
            className="cal-week-cols"
            ref={colsRef}
            onDragOver={onDragOver}
            onDragLeave={() => setDropSlot(null)}
            onDrop={onDrop}
            onPointerDown={(e) => {
              if (e.target === e.currentTarget) onSelect(null);
            }}
          >
            {/* hour rules */}
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="cal-rule" style={{ top: h * HOUR_H }} />
            ))}
            {/* day separators */}
            {days.map((day, i) => (
              <div
                key={day}
                className={`cal-daycol${i === todayIndex ? " is-today" : ""}`}
                style={{ left: `${(i * 100) / dayCount}%`, width: `${100 / dayCount}%` }}
              />
            ))}

            {todayIndex >= 0 && (
              <div
                className="cal-now"
                style={{
                  top: nowTop,
                  left: `${(todayIndex * 100) / dayCount}%`,
                  width: `${100 / dayCount}%`,
                }}
              >
                <span className="cal-now-dot" />
              </div>
            )}

            {/* live drop preview for both card drags and file drops */}
            {(dragTarget != null || dropSlot != null) &&
              (() => {
                const slot = dragTarget ?? dropSlot!;
                const idx = days.findIndex((d) => sameLocalDay(d, slot, timeZone));
                if (idx < 0) return null;
                const wall = utcToWall(slot, timeZone);
                return (
                  <div
                    className="cal-ghost"
                    style={{
                      top: ((wall.hour * 60 + wall.minute) / 60) * HOUR_H,
                      height: CARD_H,
                      left: `calc(${(idx * 100) / dayCount}% + 3px)`,
                      width: `calc(${100 / dayCount}% - 6px)`,
                    }}
                  >
                    <span>{formatTime(slot, timeZone)}</span>
                  </div>
                );
              })()}

            {/* history sits underneath — context, not something you can act on */}
            {(history ?? []).map((post) => {
              const idx = days.findIndex((d) => sameLocalDay(d, post.published_at, timeZone));
              if (idx < 0) return null;
              const wall = utcToWall(post.published_at, timeZone);
              const colPct = 100 / dayCount;
              return (
                <a
                  key={post.id}
                  className="cal-past"
                  href={post.permalink}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={post.title}
                  style={{
                    top: ((wall.hour * 60 + wall.minute) / 60) * HOUR_H,
                    left: `calc(${idx * colPct}% + 3px)`,
                    width: `calc(${colPct}% - 6px)`,
                  }}
                >
                  <span className="cal-past-time">{formatTime(post.published_at, timeZone)}</span>
                  <span className="cal-past-title">{post.title}</span>
                </a>
              );
            })}

            {placed.map(({ job, dayIndex, top, lane, lanes }) => {
              const colPct = 100 / dayCount;
              const laneW = colPct / lanes;
              return (
                <JobCard
                  key={job.id}
                  job={job}
                  timeZone={timeZone}
                  selected={selectedId === job.id}
                  dragging={drag?.id === job.id}
                  style={{
                    top,
                    height: CARD_H,
                    left: `calc(${dayIndex * colPct + lane * laneW}% + 3px)`,
                    width: `calc(${laneW}% - 6px)`,
                  }}
                  onPointerDown={(e) => {
                    onSelect(job.id);
                    startDrag(e, job.id, job.scheduled_at);
                  }}
                  onOpen={() => onOpen(job)}
                />
              );
            })}
          </div>
        </div>
      </div>

      {/* The dragged card follows the pointer as a fixed-position proxy. */}
      {drag &&
        (() => {
          const job = jobs.find((j) => j.id === drag.id);
          if (!job) return null;
          return (
            <div
              className="cal-proxy"
              style={{
                transform: `translate3d(${drag.x}px, ${drag.y}px, 0)`,
                width: drag.width,
                height: drag.height,
              }}
            >
              <JobCard job={job} timeZone={timeZone} dragging />
              {drag.target != null && (
                <span className="cal-proxy-time">{formatTime(drag.target, timeZone)}</span>
              )}
            </div>
          );
        })()}
    </div>
  );
}

export { HOUR_H, SNAP_MIN, startOfDay };
