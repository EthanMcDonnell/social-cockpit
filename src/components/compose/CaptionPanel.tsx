"use client";

import { captionStats, CAPTION_MAX, type ComposeDraft } from "@/lib/compose/draft";

type Update = (patch: Partial<ComposeDraft>) => void;

export function CaptionPanel({ draft, update }: { draft: ComposeDraft; update: Update }) {
  const { chars, hashtags, mentions } = captionStats(draft.caption);
  const over = chars > CAPTION_MAX;
  const isReel = draft.tab === "REEL";

  return (
    <section className="cs-sec">
      <div className="cs-sh">
        <span className="n">02</span>
        <h2>Caption</h2>
        <span className={`hint${over ? " over" : ""}`}>
          {chars} / {CAPTION_MAX} · {hashtags}# · {mentions}@
        </span>
      </div>

      <textarea
        className="cs-textarea"
        placeholder="Write your caption… #hashtags @mentions"
        value={draft.caption}
        onChange={(e) => update({ caption: e.target.value })}
      />

      <div className="cs-two" style={{ marginTop: 14 }}>
        {isReel && (
          <div className="cs-field">
            <div className="cs-flabel"><span>Audio name</span></div>
            <input
              className="cs-input"
              type="text"
              placeholder="Rename original audio"
              value={draft.audioName}
              onChange={(e) => update({ audioName: e.target.value })}
            />
          </div>
        )}
        <div className="cs-field">
          <div className="cs-flabel"><span>Location</span><b>location_id</b></div>
          <input
            className="cs-input"
            type="text"
            placeholder="Page ID for a place"
            value={draft.locationId}
            onChange={(e) => update({ locationId: e.target.value })}
          />
        </div>
      </div>
    </section>
  );
}
