"use client";

import { useRef, useState } from "react";
import { MAX_CAROUSEL, filledPhotoSlots, type ComposeDraft } from "@/lib/compose/draft";

type Update = (patch: Partial<ComposeDraft>) => void;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileDrop({
  file,
  onFile,
  accept = "video/*",
  label = "video file",
  hint = "MP4 / MOV · uploads straight to R2",
  compact = false,
}: {
  file: File | null;
  onFile: (f: File | null) => void;
  accept?: string;
  label?: string;
  hint?: string;
  compact?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function pick(files: FileList | null) {
    const f = files?.[0];
    if (f) onFile(f);
  }

  if (file) {
    return (
      <div className="cs-file">
        <div className="cs-file-ic">{accept.startsWith("image") ? "🖼" : "▶"}</div>
        <div className="cs-file-meta">
          <b>{file.name}</b>
          <span>{formatBytes(file.size)} · {file.type || label}</span>
        </div>
        <button type="button" className="cs-file-x" onClick={() => onFile(null)} aria-label="Remove file">
          ✕
        </button>
      </div>
    );
  }

  return (
    <div
      className={`cs-drop${dragging ? " drag" : ""}${compact ? " compact" : ""}`}
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
        Drop a <b>{label}</b><br />or click to browse
      </div>
      <div className="cs-drops">{hint}</div>
      <input ref={inputRef} type="file" accept={accept} hidden onChange={(e) => pick(e.target.files)} />
    </div>
  );
}

function PhotoList({
  draft,
  update,
  photoFiles,
  setPhotoFiles,
}: {
  draft: ComposeDraft;
  update: Update;
  photoFiles: (File | null)[];
  setPhotoFiles: (files: (File | null)[]) => void;
}) {
  const photos = draft.photos.length ? draft.photos : [""];
  const files = photos.map((_, i) => photoFiles[i] ?? null);
  const count = filledPhotoSlots(draft, photoFiles).length;

  function setAt(i: number, value: string) {
    const next = [...photos];
    next[i] = value;
    update({ photos: next });
  }
  function setFileAt(i: number, f: File | null) {
    const next = [...files];
    next[i] = f;
    setPhotoFiles(next);
    if (f) setAt(i, ""); // a local file replaces any pasted URL for this slot
  }
  function removeAt(i: number) {
    const next = photos.filter((_, idx) => idx !== i);
    const nextFiles = files.filter((_, idx) => idx !== i);
    update({ photos: next.length ? next : [""] });
    setPhotoFiles(nextFiles.length ? nextFiles : [null]);
  }
  function add() {
    if (photos.length < MAX_CAROUSEL) {
      update({ photos: [...photos, ""] });
      setPhotoFiles([...files, null]);
    }
  }

  return (
    <>
      <div className="cs-field">
        <div className="cs-flabel">
          <span>Images</span>
          <b>{count <= 1 ? "1 = photo" : `${count} = carousel`} · ≤{MAX_CAROUSEL}</b>
        </div>
        {photos.map((_, i) => (
          <div className="cs-photorow" key={i}>
            <span className="cs-photonum">{i + 1}</span>
            <FileDrop
              file={files[i]}
              onFile={(f) => setFileAt(i, f)}
              accept="image/*"
              label={`image ${i + 1}`}
              hint="JPG / PNG · uploads straight to R2"
              compact
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
  photoFiles,
  setPhotoFiles,
  coverFile,
  setCoverFile,
}: {
  draft: ComposeDraft;
  update: Update;
  file: File | null;
  onFile: (f: File | null) => void;
  photoFiles: (File | null)[];
  setPhotoFiles: (files: (File | null)[]) => void;
  coverFile: File | null;
  setCoverFile: (f: File | null) => void;
}) {
  const isReel = draft.tab === "REEL";
  const isPhoto = draft.tab === "PHOTO";
  const isStory = draft.tab === "STORY";
  const canUpload = isReel || isStory; // local file → R2, or a pasted URL
  const singlePhoto = isPhoto && filledPhotoSlots(draft, photoFiles).length <= 1;

  return (
    <section className="cs-sec">
      <div className="cs-sh">
        <span className="n">01</span>
        <h2>Source</h2>
        <span className="hint">
          {isReel && "video file → R2 → video_url"}
          {isPhoto && "image file(s) → R2 · 1 = photo · 2+ = carousel"}
          {isStory && "image or video file → R2"}
        </span>
      </div>

      {canUpload && (
        <FileDrop
          file={file}
          onFile={onFile}
          accept={isStory ? "image/*,video/*" : "video/*"}
          label={isStory ? "image or video file" : "video file"}
          hint={isStory ? "JPG / PNG / MP4 / MOV · uploads straight to R2" : "MP4 / MOV · uploads straight to R2"}
        />
      )}

      {isPhoto && (
        <div style={{ marginTop: 14 }}>
          <PhotoList draft={draft} update={update} photoFiles={photoFiles} setPhotoFiles={setPhotoFiles} />
        </div>
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
              <div className="cs-flabel"><span>Cover</span><b>optional · cover_url</b></div>
              <FileDrop
                file={coverFile}
                onFile={setCoverFile}
                accept="image/*"
                label="cover image"
                hint="JPG / PNG · uploads straight to R2"
                compact
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
