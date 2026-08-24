"use client";

import { PlatformGlyph } from "@/components/dashboard/cockpit/PlatformGlyph";
import { formatTime } from "@/lib/schedule/tz";
import type { ScheduledPostView, ScheduleStatus } from "@/lib/schedule/types";
import type { PublishInput } from "@/lib/instagram/endpoints/publish";
import type { YoutubeJobPayload } from "@/lib/schedule/types";
import { SELECTION_LABELS } from "@/lib/slugs/types";

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
  // A slug job has no file and often no payload — until it fires, the honest
  // headline is the pool it will draw from, not a caption nobody wrote.
  if (job.content_slug && !job.media.length) {
    const caption =
      job.platform === "yt"
        ? (job.payload as YoutubeJobPayload).title?.trim()
        : (job.payload as PublishInput).caption?.trim();
    return caption ? caption.split("\n")[0] : `#${job.content_slug}`;
  }
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
  if (job.content_slug && !job.media.length) return "Reel";
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
        {job.content_slug && !job.media.length && (
          <span
            className="cal-card-slug"
            title={`Picks from #${job.content_slug} when the slot arrives${
              job.selection_effective ? ` — ${SELECTION_LABELS[job.selection_effective]}` : ""
            }`}
          >
            #
          </span>
        )}
        {job.slug_eligible === 0 && (
          <span className="cal-card-warn" title="This slug's pool is empty for this platform — the slot will fail">
            ▲
          </span>
        )}
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
        <span className="cal-card-kind">
          {job.content_slug && !job.media.length
            ? `#${job.content_slug}${job.slug_eligible != null ? ` · ${job.slug_eligible}` : ""}`
            : jobKind(job)}
        </span>
        <span className={`cal-card-status${busy ? " is-busy" : ""}`}>
          {STATUS_LABEL[job.status]}
        </span>
      </footer>
    </article>
  );
}

export { STATUS_LABEL };
