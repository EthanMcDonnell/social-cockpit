"use client";

import {
  YT_TITLE_MAX,
  YT_DESCRIPTION_MAX,
  YT_SHORT_MAX_SECONDS,
  type ComposeDraft,
  type VideoProbe,
} from "@/lib/compose/draft";
import { FileDrop } from "./SourcePanel";

type Update = (patch: Partial<ComposeDraft>) => void;

function fmtDuration(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

/** A read-only line confirming what we measured off the dropped file. */
function ProbeReadout({ draft, probe }: { draft: ComposeDraft; probe: VideoProbe | null }) {
  if (!probe) return null;
  const vertical = probe.height > probe.width;
  const shortLength = probe.durationSeconds <= YT_SHORT_MAX_SECONDS;
  const okForShort = vertical && shortLength;

  return (
    <div className="cs-scrub" aria-live="polite">
      <div className="cs-rd">
        <span>
          {probe.width}×{probe.height}
        </span>
        <span>{fmtDuration(probe.durationSeconds)}</span>
        <span>
          {draft.tab === "SHORT"
            ? okForShort
              ? "✓ qualifies as a Short"
              : !vertical
                ? "not vertical (9:16)"
                : `over ${YT_SHORT_MAX_SECONDS}s`
            : vertical
              ? "vertical"
              : "landscape"}
        </span>
      </div>
    </div>
  );
}

export function YoutubeSourcePanel({
  draft,
  update,
  file,
  onFile,
  probe,
}: {
  draft: ComposeDraft;
  update: Update;
  file: File | null;
  onFile: (f: File | null) => void;
  probe: VideoProbe | null;
}) {
  const isShort = draft.tab === "SHORT";
  const titleChars = draft.title.length;
  const descChars = draft.caption.length;

  return (
    <>
      <section className="cs-sec">
        <div className="cs-sh">
          <span className="n">01</span>
          <h2>Source</h2>
          <span className="hint">
            {isShort ? "vertical video ≤ 3 min → R2 → videos.insert" : "video file → R2 → videos.insert"}
          </span>
        </div>

        <FileDrop
          file={file}
          onFile={onFile}
          accept="video/*"
          label="video file"
          hint={
            isShort
              ? "MP4 / MOV · vertical 9:16 · uploads straight to R2"
              : "MP4 / MOV · uploads straight to R2"
          }
        />

        <ProbeReadout draft={draft} probe={probe} />
      </section>

      <section className="cs-sec">
        <div className="cs-sh">
          <span className="n">02</span>
          <h2>Details</h2>
          <span className={`hint${titleChars > YT_TITLE_MAX ? " over" : ""}`}>
            title {titleChars} / {YT_TITLE_MAX}
          </span>
        </div>

        <div className="cs-field">
          <div className="cs-flabel">
            <span>Title</span>
            <b>required · snippet.title</b>
          </div>
          <input
            className="cs-input"
            type="text"
            placeholder={isShort ? "My Short (#Shorts is added automatically)" : "Video title"}
            value={draft.title}
            onChange={(e) => update({ title: e.target.value })}
          />
        </div>

        <div className="cs-field" style={{ marginTop: 14 }}>
          <div className="cs-flabel">
            <span>Description</span>
            <b className={descChars > YT_DESCRIPTION_MAX ? "over" : undefined}>
              {descChars} / {YT_DESCRIPTION_MAX} · snippet.description
            </b>
          </div>
          <textarea
            className="cs-textarea"
            placeholder="Describe your video… links, credits, #hashtags"
            value={draft.caption}
            onChange={(e) => update({ caption: e.target.value })}
          />
        </div>
      </section>
    </>
  );
}
