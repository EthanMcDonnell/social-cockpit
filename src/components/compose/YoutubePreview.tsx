"use client";

import { useEffect, useState } from "react";
import type { ComposeDraft, VideoProbe } from "@/lib/compose/draft";
import { YT_SHORT_MAX_SECONDS } from "@/lib/compose/draft";

function useObjectUrl(file: File | null | undefined): string | undefined {
  const [url, setUrl] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!file) {
      setUrl(undefined);
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);
  return url;
}

/**
 * Phone-frame preview for the YouTube studio, mirroring ReelPreview's shape but
 * with YouTube chrome (red accents, Shorts/Video label, Studio endpoint). Plays
 * the dropped file inline so the vertical crop is obvious. The footer readout
 * makes the pre-audit reality explicit: uploads land as private drafts.
 */
export function YoutubePreview({
  draft,
  file,
  probe,
}: {
  draft: ComposeDraft;
  file: File | null;
  probe: VideoProbe | null;
}) {
  const isShort = draft.tab === "SHORT";
  const videoUrl = useObjectUrl(file);
  const title = draft.title.trim() || "Your title previews here…";
  const topLabel = isShort ? "SHORTS" : "VIDEO";

  const shortsOk =
    !probe || (probe.height > probe.width && probe.durationSeconds <= YT_SHORT_MAX_SECONDS);

  return (
    <>
      <div className="cs-pvhead">
        <button type="button" className="on yt" disabled>
          {isShort ? "Shorts preview" : "Watch preview"}
        </button>
      </div>

      <div className={`cs-phone yt${isShort ? "" : " wide"}`}>
        <div className="cs-reel yt">
          {videoUrl ? (
            <video src={videoUrl} muted loop autoPlay playsInline className="cs-ytvid" />
          ) : null}
        </div>
        <div className="cs-topbar yt">
          <b>{topLabel}</b>
        </div>

        {isShort && !shortsOk && <div className="cs-badge yt">⚠ not Short-eligible</div>}

        <div className="cs-side">
          <span>♥</span>
          <span>💬</span>
          <span>➤</span>
        </div>

        <div className="cs-meta">
          <div className="cs-u">
            <span className="cs-av yt" />@channel
          </div>
          <div className="cs-cap">{title}</div>
        </div>
      </div>

      <div className="cs-pvfoot">
        <div className="ln">
          <span>Type</span>
          <b>{isShort ? "SHORT" : "VIDEO"}</b>
        </div>
        <div className="ln">
          <span>Visibility</span>
          <b>PRIVATE (draft)</b>
        </div>
        <div className="ln">
          <span>Endpoint</span>
          <b>/api/youtube/publish</b>
        </div>
      </div>
    </>
  );
}
