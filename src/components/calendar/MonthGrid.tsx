"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { JobCard } from "./JobCard";
import { useSlotDrag } from "./useSlotDrag";
import { addDays, sameLocalDay, startOfMonth, startOfWeek, utcToWall, wallToUtc } from "@/lib/schedule/tz";
import type { ScheduledPostView } from "@/lib/schedule/types";
import type { PublishedEntry } from "@/hooks/useSchedule";

const DAY_LABEL = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
/** Chips shown before a cell collapses to "+N more". */
const MAX_CHIPS = 3;
/** Where a file dropped on a month cell lands, absent a finer target. */
const DEFAULT_HOUR = 9;

interface MonthGridProps {
  month: number;
  jobs: ScheduledPostView[];
  timeZone: string;
  selectedId?: string | null;
  /** Already-published posts, shown as muted context. Read-only. */
  history?: PublishedEntry[];
  onMove: (id: string, scheduledAt: number) => void;
  onOpen: (job: ScheduledPostView) => void;
  onSelect: (id: string | null) => void;
  onDropFiles: (files: File[], scheduledAt: number) => void;
  onExpandDay: (dayStart: number) => void;
}

export function MonthGrid({
  month,
  jobs,
  timeZone,
  selectedId,
  history,
  onMove,
  onOpen,
  onSelect,
  onDropFiles,
  onExpandDay,
}: MonthGridProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const draggingId = useRef<string | null>(null);
  const [dropDay, setDropDay] = useState<number | null>(null);
  const now = Date.now();

  // Always six rows: a month grid that changes height as you page between
  // months is a surprisingly big source of visual jitter.
  const cells = useMemo(() => {
    const first = startOfWeek(startOfMonth(month, timeZone), timeZone);
    return Array.from({ length: 42 }, (_, i) => addDays(first, i, timeZone));
  }, [month, timeZone]);

  const monthWall = utcToWall(month, timeZone);

  /** Point → the day cell beneath it, preserving the job's own time of day. */
  const cellAt = useCallback(
    (clientX: number, clientY: number): number | null => {
      const el = gridRef.current;
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      if (clientX < rect.left || clientX > rect.right) return null;
      if (clientY < rect.top || clientY > rect.bottom) return null;

      const col = Math.min(6, Math.floor(((clientX - rect.left) / rect.width) * 7));
      const row = Math.min(5, Math.floor(((clientY - rect.top) / rect.height) * 6));
      return cells[row * 7 + col] ?? null;
    },
    [cells]
  );

  /**
   * Moving a card between days keeps its time of day — dragging a 9am post to
   * next Tuesday should mean next Tuesday at 9am, not next Tuesday at midnight.
   */
  const resolveSlot = useCallback(
    (clientX: number, clientY: number): number | null => {
      const day = cellAt(clientX, clientY);
      if (day == null) return null;
      const dragged = jobs.find((j) => j.id === draggingId.current);
      const source = dragged ? utcToWall(dragged.scheduled_at, timeZone) : null;
      const target = utcToWall(day, timeZone);
      return wallToUtc(
        {
          ...target,
          hour: source?.hour ?? DEFAULT_HOUR,
          minute: source?.minute ?? 0,
          second: 0,
        },
        timeZone
      );
    },
    [cellAt, jobs, timeZone]
  );

  const { drag, startDrag } = useSlotDrag({
    resolveSlot,
    onCommit: (id, at) => {
      draggingId.current = null;
      onMove(id, at);
    },
    canDrag: (id) => {
      const job = jobs.find((j) => j.id === id);
      return !!job && job.status !== "publishing" && job.status !== "finalizing";
    },
  });

  const byDay = useMemo(() => {
    const map = new Map<number, ScheduledPostView[]>();
    for (const cell of cells) {
      const list = jobs
        .filter((j) => sameLocalDay(j.scheduled_at, cell, timeZone))
        .sort((a, b) => a.scheduled_at - b.scheduled_at);
      if (list.length) map.set(cell, list);
    }
    return map;
  }, [cells, jobs, timeZone]);

  return (
    <div className="cal-month">
      <div className="cal-month-head">
        {DAY_LABEL.map((d) => (
          <div key={d} className="cal-month-dow">
            {d}
          </div>
        ))}
      </div>

      <div
        className="cal-month-grid"
        ref={gridRef}
        onDragOver={(e) => {
          if (!Array.from(e.dataTransfer.types).includes("Files")) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          setDropDay(cellAt(e.clientX, e.clientY));
        }}
        onDragLeave={() => setDropDay(null)}
        onDrop={(e) => {
          const files = Array.from(e.dataTransfer.files ?? []);
          setDropDay(null);
          if (!files.length) return;
          e.preventDefault();
          const day = cellAt(e.clientX, e.clientY);
          if (day == null) return;
          const wall = utcToWall(day, timeZone);
          onDropFiles(
            files,
            wallToUtc({ ...wall, hour: DEFAULT_HOUR, minute: 0, second: 0 }, timeZone)
          );
        }}
      >
        {cells.map((cell) => {
          const wall = utcToWall(cell, timeZone);
          const outside = wall.month !== monthWall.month;
          const isToday = sameLocalDay(cell, now, timeZone);
          const list = byDay.get(cell) ?? [];
          const overflow = list.length - MAX_CHIPS;

          return (
            <div
              key={cell}
              className={[
                "cal-month-cell",
                outside ? "is-outside" : "",
                isToday ? "is-today" : "",
                dropDay === cell ? "is-drop" : "",
                drag?.target != null && sameLocalDay(drag.target, cell, timeZone) ? "is-drop" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onDoubleClick={() => onExpandDay(cell)}
            >
              <div className="cal-month-num">{wall.day}</div>
              <div className="cal-month-chips">
                {(history ?? [])
                  .filter((p) => sameLocalDay(p.published_at, cell, timeZone))
                  .map((p) => (
                    <a
                      key={p.id}
                      className="cal-past chip"
                      href={p.permalink}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={p.title}
                    >
                      <span className="cal-past-title">{p.title}</span>
                    </a>
                  ))}
                {list.slice(0, MAX_CHIPS).map((job) => (
                  <JobCard
                    key={job.id}
                    job={job}
                    timeZone={timeZone}
                    variant="chip"
                    selected={selectedId === job.id}
                    dragging={drag?.id === job.id}
                    onPointerDown={(e) => {
                      draggingId.current = job.id;
                      onSelect(job.id);
                      startDrag(e, job.id, job.scheduled_at);
                    }}
                    onOpen={() => onOpen(job)}
                  />
                ))}
                {overflow > 0 && (
                  <button
                    type="button"
                    className="cal-month-more"
                    onClick={() => onExpandDay(cell)}
                  >
                    +{overflow} more
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {drag &&
        (() => {
          const job = jobs.find((j) => j.id === drag.id);
          if (!job) return null;
          return (
            <div
              className="cal-proxy"
              style={{
                transform: `translate3d(${drag.x}px, ${drag.y}px, 0)`,
                width: Math.max(drag.width, 150),
              }}
            >
              <JobCard job={job} timeZone={timeZone} variant="chip" dragging />
            </div>
          );
        })()}
    </div>
  );
}
