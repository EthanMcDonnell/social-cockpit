"use client";

import { PlatformGlyph } from "@/components/dashboard/cockpit/PlatformGlyph";
import { formatTime } from "@/lib/schedule/tz";
import type { ScheduledPostView, ScheduleStatus } from "@/lib/schedule/types";
import type { PublishInput } from "@/lib/instagram/endpoints/publish";
import type { YoutubeJobPayload } from "@/lib/schedule/types";

/** Human label for each state — the card's one-word status line. */
const STATUS_LABEL: Record<ScheduleStatus, string> = {
  pending: "Scheduled",
  publishing: "Publishing",
  finalizing: "Processing",
  published: "Published",
  failed: "Failed",
  missed: "Missed",
  cancelled: "Cancelled",
  paused: "Paused",
};

/** The headline a card shows: YouTube has a title, Instagram has only a caption. */
export function jobTitle(job: ScheduledPostView): string {
  if (job.platform === "yt") {
    const p = job.payload as YoutubeJobPayload;
    return p.title?.trim() || "Untitled video";
  }
  const caption = (job.payload as PublishInput).caption?.trim();
  if (caption) return caption.split("\n")[0];
  return job.media_files[0]?.filename ?? "Untitled post";
}

export function jobKind(job: ScheduledPostView): string {
  if (job.platform === "yt") {
    return (job.payload as YoutubeJobPayload).isShort ? "Short" : "Video";
  }
  const type = (job.payload as PublishInput).media_type ?? "IMAGE";
  return { REELS: "Reel", IMAGE: "Photo", CAROUSEL: "Carousel", STORIES: "Story" }[type] ?? type;
}

interface JobCardProps {
  job: ScheduledPostView;
  timeZone: string;
  /** Absolute placement inside a week column. Omitted in month/agenda views. */
  style?: React.CSSProperties;
  variant?: "slot" | "chip" | "row";
  dragging?: boolean;
  selected?: boolean;
  onPointerDown?: (e: React.PointerEvent) => void;
  onOpen?: () => void;
}

export function JobCard({
  job,
  timeZone,
  style,
  variant = "slot",
  dragging,
  selected,
  onPointerDown,
  onOpen,
}: JobCardProps) {
  const busy = job.status === "publishing" || job.status === "finalizing";
  const classes = [
    "cal-card",
    `is-${job.platform}`,
    `st-${job.status}`,
    `v-${variant}`,
    dragging ? "is-dragging" : "",
    selected ? "is-selected" : "",
    job.media_missing ? "is-warn" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <article
      className={classes}
      style={style}
      onPointerDown={onPointerDown}
      onDoubleClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen?.();
        }
      }}
      tabIndex={0}
      role="button"
      aria-label={`${jobKind(job)} at ${formatTime(job.scheduled_at, timeZone)} — ${STATUS_LABEL[job.status]}`}
    >
      <header className="cal-card-top">
        <PlatformGlyph platform={job.platform} size={11} />
        <span className="cal-card-time">{formatTime(job.scheduled_at, timeZone)}</span>
        {job.automation && (
          <span className="cal-card-auto" title="Comment automation attached">
            ⌁
          </span>
        )}
        {job.media_missing && (
          <span className="cal-card-warn" title="The source file is missing — this will fail">
            ▲
          </span>
        )}
      </header>

      <p className="cal-card-title">{jobTitle(job)}</p>

      <footer className="cal-card-foot">
        <span className="cal-card-kind">{jobKind(job)}</span>
        <span className={`cal-card-status${busy ? " is-busy" : ""}`}>
          {STATUS_LABEL[job.status]}
        </span>
      </footer>
    </article>
  );
}

export { STATUS_LABEL };
