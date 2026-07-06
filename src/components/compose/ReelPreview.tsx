"use client";

import { useState } from "react";
import { resolvedMediaType, photoUrls, type ComposeDraft } from "@/lib/compose/draft";

export function ReelPreview({ draft }: { draft: ComposeDraft }) {
  const [view, setView] = useState<"reels" | "feed">("reels");
  const caption = draft.caption.trim() || "Your caption previews here as you type…";

  const isReel = draft.tab === "REEL";
  const mediaType = resolvedMediaType(draft);
  const photoCount = photoUrls(draft).length;
  const firstPhoto = photoUrls(draft)[0];

  const topLabel = isReel ? (view === "reels" ? "REELS" : "FEED") : mediaType;
  const coverImage = draft.tab === "PHOTO" ? firstPhoto : draft.coverUrl || undefined;

  return (
    <>
      {isReel ? (
        <div className="cs-pvhead">
          <button type="button" className={view === "reels" ? "on" : undefined} onClick={() => setView("reels")}>
            Reels tab
          </button>
          <button type="button" className={view === "feed" ? "on" : undefined} onClick={() => setView("feed")}>
            Feed
          </button>
        </div>
      ) : (
        <div className="cs-pvhead">
          <button type="button" className="on" disabled>
            {draft.tab === "PHOTO" ? "Feed preview" : "Story preview"}
          </button>
        </div>
      )}

      <div className="cs-phone">
        <div
          className="cs-reel"
          style={coverImage ? { backgroundImage: `url(${coverImage})`, backgroundSize: "cover" } : undefined}
        />
        <div className="cs-topbar"><b>{topLabel}</b></div>

        {isReel && draft.isTrial && <div className="cs-badge">● Trial · non-followers</div>}
        {mediaType === "CAROUSEL" && <div className="cs-badge">▤ {photoCount} images</div>}

        <div className="cs-side">
          <span>♥</span>
          <span>💬</span>
          <span>➤</span>
        </div>

        <div className="cs-meta">
          <div className="cs-u"><span className="cs-av" />@account</div>
          <div className="cs-cap">{caption}</div>
          {isReel && <div className="cs-audio">♪ {draft.audioName.trim() || "Original audio"}</div>}
        </div>
      </div>

      <div className="cs-pvfoot">
        <div className="ln"><span>Media type</span><b>{mediaType}</b></div>
        {isReel && (
          <>
            <div className="ln"><span>Share to feed</span><b>{draft.shareToFeed ? "YES" : "NO"}</b></div>
            {draft.isTrial && <div className="ln"><span>Graduation</span><b>{draft.graduationStrategy}</b></div>}
          </>
        )}
        <div className="ln"><span>Endpoint</span><b>/api/publish</b></div>
      </div>
    </>
  );
}
