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
  const publish = usePublish();

  const update = useCallback((patch: Partial<ComposeDraft>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
    // A file only applies to video tabs — drop it when switching to Photo.
    if (patch.tab && patch.tab === "PHOTO") setFile(null);
    // Clear any prior result once the draft changes again.
    publish.reset();
  }, [publish]);

  const onFile = useCallback((f: File | null) => {
    setFile(f);
    publish.reset();
  }, [publish]);

  const canUpload = draft.tab === "REEL" || draft.tab === "STORY";
  const activeFile = canUpload ? file : null;
  const invalid = validateDraft(draft, !!activeFile);
  const isReel = draft.tab === "REEL";

  function transmit() {
    if (invalid) return;
    const input = draftToPublishInput(draft);
    if (activeFile) delete input.video_url; // bytes come from the upload
    publish.mutate({ input, file: activeFile ?? undefined });
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

        <SourcePanel draft={draft} update={update} file={activeFile} onFile={onFile} />
        <CaptionPanel draft={draft} update={update} />
        {isReel && <TrialPanel draft={draft} update={update} />}
        <DistributionPanel draft={draft} update={update} />
        <TaggingPanel draft={draft} update={update} />
      </div>

      {/* PREVIEW + ACTIONS */}
      <aside className="cs-preview">
        <ReelPreview draft={draft} />

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
