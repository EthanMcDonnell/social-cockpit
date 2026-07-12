"use client";

import { useEffect, useState } from "react";
import { resolvedMediaType, filledPhotoSlots, type ComposeDraft } from "@/lib/compose/draft";

/** Object URL for a local file preview, revoked on change/unmount. */
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

export function ReelPreview({
  draft,
  photoFiles = [],
  coverFile,
}: {
  draft: ComposeDraft;
  photoFiles?: (File | null)[];
  coverFile?: File | null;
}) {
  const [view, setView] = useState<"reels" | "feed">("reels");
  const caption = draft.caption.trim() || "Your caption previews here as you type…";

  const isReel = draft.tab === "REEL";
  const mediaType = resolvedMediaType(draft, photoFiles);
  const slots = filledPhotoSlots(draft, photoFiles);
  const photoCount = slots.length;
  const firstPhotoFileUrl = useObjectUrl(slots[0]?.file);
  const firstPhoto = slots[0]?.file ? firstPhotoFileUrl : slots[0]?.url;
  const coverFileUrl = useObjectUrl(coverFile);

  const topLabel = isReel ? (view === "reels" ? "REELS" : "FEED") : mediaType;
  const coverImage = draft.tab === "PHOTO" ? firstPhoto : coverFileUrl || undefined;

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
