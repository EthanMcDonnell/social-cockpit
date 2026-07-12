"use client";

import { useCallback, useState } from "react";
import {
  initialDraft,
  validateDraft,
  draftToPublishInput,
  type ComposeDraft,
} from "@/lib/compose/draft";
import { usePublish } from "@/lib/compose/usePublish";
import { MediaTypeStrip } from "./MediaTypeStrip";
import { SourcePanel } from "./SourcePanel";
import { CaptionPanel } from "./CaptionPanel";
import { TrialPanel } from "./TrialPanel";
import { DistributionPanel } from "./DistributionPanel";
import { TaggingPanel } from "./TaggingPanel";
import { ReelPreview } from "./ReelPreview";

export function ComposeStudio() {
  const [draft, setDraft] = useState<ComposeDraft>(initialDraft);
  const [file, setFile] = useState<File | null>(null);
  const [photoFiles, setPhotoFiles] = useState<(File | null)[]>([null]);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const publish = usePublish();

  const update = useCallback((patch: Partial<ComposeDraft>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
    // A file only applies to its own tab — drop stale ones when switching away.
    if (patch.tab && patch.tab !== "REEL") setCoverFile(null);
    // A Story file may be an image and a Reel file must be a video, so a file
    // never carries over between tabs — drop it on any tab switch.
    if (patch.tab) setFile(null);
    if (patch.tab && patch.tab !== "PHOTO") setPhotoFiles([null]);
    // Clear any prior result once the draft changes again.
    publish.reset();
  }, [publish]);

  const onFile = useCallback((f: File | null) => {
    setFile(f);
    publish.reset();
  }, [publish]);

  const onPhotoFiles = useCallback((files: (File | null)[]) => {
    setPhotoFiles(files);
    publish.reset();
  }, [publish]);

  const onCoverFile = useCallback((f: File | null) => {
    setCoverFile(f);
    publish.reset();
  }, [publish]);

  const canUpload = draft.tab === "REEL" || draft.tab === "STORY";
  const activeFile = canUpload ? file : null;
  const activePhotoFiles = draft.tab === "PHOTO" ? photoFiles : [];
  const activeCoverFile = draft.tab === "REEL" ? coverFile : null;
  const invalid = validateDraft(draft, !!activeFile, activePhotoFiles);
  const isReel = draft.tab === "REEL";

  function transmit() {
    if (invalid) return;
    const input = draftToPublishInput(draft, activePhotoFiles);
    // A Story file can be an image or a video; route it by MIME type. Reel and
    // cover are always their fixed kinds. Every source uploads to R2 in usePublish.
    const fileIsImage = !!activeFile && activeFile.type.startsWith("image/");
    publish.mutate({
      input,
      files: {
        video: activeFile && !fileIsImage ? activeFile : undefined,
        image: activeFile && fileIsImage ? activeFile : undefined,
        cover: activeCoverFile ?? undefined,
        photos: activePhotoFiles,
      },
    });
  }

  const result = publish.data;

  return (
    <div className="cs-stage">
      {/* CONTROLS */}
      <div className="cs-controls">
        <div className="cs-title">
          <span className="cs-tag">05</span>
          <h1>Compose</h1>
          <span className="cs-endpoint">POST /api/publish</span>
        </div>

        <MediaTypeStrip value={draft.tab} onChange={(tab) => update({ tab })} />

        <SourcePanel
          draft={draft}
          update={update}
          file={activeFile}
          onFile={onFile}
          photoFiles={activePhotoFiles}
          setPhotoFiles={onPhotoFiles}
          coverFile={activeCoverFile}
          setCoverFile={onCoverFile}
        />
        <CaptionPanel draft={draft} update={update} />
        {isReel && <TrialPanel draft={draft} update={update} />}
        <DistributionPanel draft={draft} update={update} />
        <TaggingPanel draft={draft} update={update} />
      </div>

      {/* PREVIEW + ACTIONS */}
      <aside className="cs-preview">
        <ReelPreview draft={draft} photoFiles={activePhotoFiles} coverFile={activeCoverFile} />

        {publish.isError && <div className="cs-msg err">{publish.error.message}</div>}
        {result?.published && (
          <div className="cs-msg ok">
            Published ✓{" "}
            {result.permalink && (
              <a href={result.permalink} target="_blank" rel="noopener noreferrer">
                View on Instagram →
              </a>
            )}
          </div>
        )}
        {invalid && !publish.isPending && <div className="cs-msg warn">{invalid}</div>}

        <div className="cs-actions">
          <button type="button" className="cs-ghost" disabled title="Scheduling ships in a later phase">
            Schedule
          </button>
          <button
            type="button"
            className="cs-transmit"
            disabled={!!invalid || publish.isPending}
            onClick={transmit}
          >
            {publish.isPending ? "Transmitting…" : "▸ Transmit"}
          </button>
        </div>
      </aside>
    </div>
  );
}
