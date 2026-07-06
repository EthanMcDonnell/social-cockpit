"use client";

import { useRef, useState } from "react";
import { MAX_CAROUSEL, photoUrls, type ComposeDraft } from "@/lib/compose/draft";

type Update = (patch: Partial<ComposeDraft>) => void;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function FileDrop({ file, onFile }: { file: File | null; onFile: (f: File | null) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function pick(files: FileList | null) {
    const f = files?.[0];
    if (f) onFile(f);
  }

  if (file) {
    return (
      <div className="cs-file">
        <div className="cs-file-ic">▶</div>
        <div className="cs-file-meta">
          <b>{file.name}</b>
          <span>{formatBytes(file.size)} · {file.type || "video"}</span>
        </div>
        <button type="button" className="cs-file-x" onClick={() => onFile(null)} aria-label="Remove file">
          ✕
        </button>
      </div>
    );
  }

  return (
    <div
      className={`cs-drop${dragging ? " drag" : ""}`}
      role="button"
      tabIndex={0}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        pick(e.dataTransfer.files);
      }}
    >
      <div className="cs-dropring">＋</div>
      <div className="cs-dropt">
        Drop a <b>video file</b><br />or click to browse
      </div>
      <div className="cs-drops">MP4 / MOV · resumable upload</div>
      <input ref={inputRef} type="file" accept="video/*" hidden onChange={(e) => pick(e.target.files)} />
    </div>
  );
}

function PhotoList({ draft, update }: { draft: ComposeDraft; update: Update }) {
  const photos = draft.photos.length ? draft.photos : [""];
  const count = photoUrls(draft).length;

  function setAt(i: number, value: string) {
    const next = [...photos];
    next[i] = value;
    update({ photos: next });
  }
  function removeAt(i: number) {
    const next = photos.filter((_, idx) => idx !== i);
    update({ photos: next.length ? next : [""] });
  }
  function add() {
    if (photos.length < MAX_CAROUSEL) update({ photos: [...photos, ""] });
  }

  return (
    <>
      <div className="cs-field">
        <div className="cs-flabel">
          <span>Image URLs</span>
          <b>{count <= 1 ? "1 = photo" : `${count} = carousel`} · ≤{MAX_CAROUSEL}</b>
        </div>
        {photos.map((url, i) => (
          <div className="cs-photorow" key={i}>
            <span className="cs-photonum">{i + 1}</span>
            <input
              className="cs-input"
              type="text"
              placeholder="https://…/image.jpg"
              value={url}
              onChange={(e) => setAt(i, e.target.value)}
            />
            {photos.length > 1 && (
              <button type="button" className="cs-file-x" onClick={() => removeAt(i)} aria-label={`Remove image ${i + 1}`}>
                ✕
              </button>
            )}
          </div>
        ))}
      </div>
      {photos.length < MAX_CAROUSEL && (
        <button type="button" className="cs-addrow" onClick={add}>
          ＋ Add image
        </button>
      )}
    </>
  );
}

export function SourcePanel({
  draft,
  update,
  file,
  onFile,
}: {
  draft: ComposeDraft;
  update: Update;
  file: File | null;
  onFile: (f: File | null) => void;
}) {
  const isReel = draft.tab === "REEL";
  const isPhoto = draft.tab === "PHOTO";
  const isStory = draft.tab === "STORY";
  const canUpload = isReel || isStory; // resumable = video only
  const singlePhoto = isPhoto && photoUrls(draft).length <= 1;

  return (
    <section className="cs-sec">
      <div className="cs-sh">
        <span className="n">01</span>
        <h2>Source</h2>
        <span className="hint">
          {isReel && "upload_type=resumable · or video_url"}
          {isPhoto && "image_url · 2+ → CAROUSEL"}
          {isStory && "video upload · or image_url"}
        </span>
      </div>

      {canUpload && (
        <>
          <FileDrop file={file} onFile={onFile} />
          {!file && (
            <div className="cs-field" style={{ marginTop: 14 }}>
              <div className="cs-flabel"><span>…or paste a hosted video URL</span></div>
              <input
                className="cs-input"
                type="text"
                placeholder="https://…/video.mp4"
                value={draft.videoUrl}
                onChange={(e) => update({ videoUrl: e.target.value })}
              />
            </div>
          )}
          {isStory && !file && (
            <div className="cs-field">
              <div className="cs-flabel"><span>…or an image URL (photo story)</span></div>
              <input
                className="cs-input"
                type="text"
                placeholder="https://…/image.jpg"
                value={draft.imageUrl}
                onChange={(e) => update({ imageUrl: e.target.value })}
              />
            </div>
          )}
        </>
      )}

      {isPhoto && (
        <>
          <div className="cs-drop is-soon" aria-disabled="true" title="Local photo upload needs a public host">
            <div className="cs-dropring">🖼</div>
            <div className="cs-dropt">
              Upload from computer<br />
              <b>needs a public host</b>
            </div>
            <div className="cs-drops">Placeholder · pending ngrok / Tailscale Funnel</div>
          </div>
          <div className="cs-note">
            Instagram fetches photos from a public URL, so local files need a publicly-served
            link. Paste hosted image URLs for now.
          </div>
          <div style={{ marginTop: 14 }}>
            <PhotoList draft={draft} update={update} />
          </div>
        </>
      )}

      {singlePhoto && (
        <div className="cs-field" style={{ marginTop: 14 }}>
          <div className="cs-flabel"><span>Alt text</span><b>≤1000</b></div>
          <input
            className="cs-input"
            type="text"
            placeholder="Describe the image for accessibility"
            value={draft.altText}
            onChange={(e) => update({ altText: e.target.value })}
          />
        </div>
      )}

      {isReel && (
        <>
          <div className="cs-two">
            <div className="cs-field">
              <div className="cs-flabel"><span>Cover URL</span></div>
              <input
                className="cs-input"
                type="text"
                placeholder="optional · cover_url"
                value={draft.coverUrl}
                onChange={(e) => update({ coverUrl: e.target.value })}
              />
            </div>
            <div className="cs-field">
              <div className="cs-flabel"><span>Cover frame</span><b>thumb_offset</b></div>
              <input
                className="cs-input"
                type="number"
                min={0}
                placeholder="0"
                value={draft.thumbOffset}
                onChange={(e) => update({ thumbOffset: e.target.value })}
              />
            </div>
          </div>
          <div className="cs-scrub" aria-hidden="true">
            <div className="cs-film">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} />
              ))}
            </div>
            <div className="cs-rd">
              <span>0:00</span>
              <span>frame @ {draft.thumbOffset || 0} ms</span>
              <span>end</span>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
