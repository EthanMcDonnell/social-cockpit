"use client";

import { useCallback, useState } from "react";
import {
  initialDraft,
  validateDraft,
  validateYoutubeDraft,
  draftToPublishInput,
  defaultTabFor,
  type ComposeDraft,
} from "@/lib/compose/draft";
import type { Platform } from "@/hooks/usePlatform";
import { usePublish } from "@/lib/compose/usePublish";
import { useYoutubePublish } from "@/lib/compose/useYoutubePublish";
import { useVideoProbe } from "@/lib/compose/useVideoProbe";
import { SchedulePopover } from "./SchedulePopover";
import { PlatformSwitch } from "@/components/dashboard/cockpit/PlatformSwitch";
import { MediaTypeStrip } from "./MediaTypeStrip";
import { SourcePanel } from "./SourcePanel";
import { CaptionPanel } from "./CaptionPanel";
import { TrialPanel } from "./TrialPanel";
import { DistributionPanel } from "./DistributionPanel";
import { TaggingPanel } from "./TaggingPanel";
import { YoutubeSourcePanel } from "./YoutubeSourcePanel";
import { ReelPreview } from "./ReelPreview";
import { YoutubePreview } from "./YoutubePreview";

export function ComposeStudio() {
  const [draft, setDraft] = useState<ComposeDraft>(initialDraft);
  const [file, setFile] = useState<File | null>(null);
  const [photoFiles, setPhotoFiles] = useState<(File | null)[]>([null]);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [scheduling, setScheduling] = useState(false);
  const publish = usePublish();
  const ytPublish = useYoutubePublish();

  const platform = draft.platform;
  const isYoutube = platform === "yt";

  const resetPublishState = useCallback(() => {
    publish.reset();
    ytPublish.reset();
  }, [publish, ytPublish]);

  const update = useCallback(
    (patch: Partial<ComposeDraft>) => {
      setDraft((prev) => ({ ...prev, ...patch }));
      // A file only applies to its own tab — drop stale ones when switching away.
      if (patch.tab && patch.tab !== "REEL") setCoverFile(null);
      // A Story file may be an image and a Reel/Short file must be a video, so a
      // file never carries over between tabs — drop it on any tab switch.
      if (patch.tab) setFile(null);
      if (patch.tab && patch.tab !== "PHOTO") setPhotoFiles([null]);
      resetPublishState();
    },
    [resetPublishState]
  );

  // Switching platform swaps the whole studio: field set, media-type strip,
  // preview chrome, endpoint. Land on the platform's default tab and drop any
  // media/state carried from the other platform.
  const changePlatform = useCallback(
    (p: Platform) => {
      if (p === platform) return;
      setDraft((prev) => ({ ...prev, platform: p, tab: defaultTabFor(p) }));
      setFile(null);
      setPhotoFiles([null]);
      setCoverFile(null);
      resetPublishState();
    },
    [platform, resetPublishState]
  );

  const onFile = useCallback((f: File | null) => {
    setFile(f);
    resetPublishState();
  }, [resetPublishState]);

  const onPhotoFiles = useCallback((files: (File | null)[]) => {
    setPhotoFiles(files);
    resetPublishState();
  }, [resetPublishState]);

  const onCoverFile = useCallback((f: File | null) => {
    setCoverFile(f);
    resetPublishState();
  }, [resetPublishState]);

  // ── Instagram derived state ──
  const igCanUpload = draft.tab === "REEL" || draft.tab === "STORY";
  const igActiveFile = !isYoutube && igCanUpload ? file : null;
  const activePhotoFiles = !isYoutube && draft.tab === "PHOTO" ? photoFiles : [];
  const activeCoverFile = !isYoutube && draft.tab === "REEL" ? coverFile : null;
  const isReel = draft.tab === "REEL";

  // ── YouTube derived state ──
  const ytFile = isYoutube ? file : null;
  const probe = useVideoProbe(ytFile);

  const invalid = isYoutube
    ? validateYoutubeDraft(draft, !!ytFile, probe)
    : validateDraft(draft, !!igActiveFile, activePhotoFiles);

  const pending = isYoutube ? ytPublish.isPending : publish.isPending;

  function transmit() {
    if (invalid) return;
    if (isYoutube) {
      if (!ytFile) return;
      ytPublish.mutate({
        file: ytFile,
        title: draft.title,
        description: draft.caption,
        isShort: draft.tab === "SHORT",
      });
      return;
    }
    const input = draftToPublishInput(draft, activePhotoFiles);
    const fileIsImage = !!igActiveFile && igActiveFile.type.startsWith("image/");
    publish.mutate({
      input,
      files: {
        video: igActiveFile && !fileIsImage ? igActiveFile : undefined,
        image: igActiveFile && fileIsImage ? igActiveFile : undefined,
        cover: activeCoverFile ?? undefined,
        photos: activePhotoFiles,
      },
    });
  }

  const igResult = publish.data;
  const ytResult = ytPublish.data;
  const endpoint = isYoutube ? "POST /api/youtube/publish" : "POST /api/publish";

  return (
    <div className="cs-stage">
      {/* CONTROLS */}
      <div className="cs-controls">
        <div className="cs-title">
          <span className="cs-tag">05</span>
          <h1>Compose</h1>
          <span className="cs-endpoint">{endpoint}</span>
        </div>

        <PlatformSwitch value={platform} onChange={changePlatform} />

        <MediaTypeStrip platform={platform} value={draft.tab} onChange={(tab) => update({ tab })} />

        {isYoutube ? (
          <YoutubeSourcePanel draft={draft} update={update} file={ytFile} onFile={onFile} probe={probe} />
        ) : (
          <>
            <SourcePanel
              draft={draft}
              update={update}
              file={igActiveFile}
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
          </>
        )}
      </div>

      {/* PREVIEW + ACTIONS */}
      <aside className="cs-preview">
        {isYoutube ? (
          <YoutubePreview draft={draft} file={ytFile} probe={probe} />
        ) : (
          <ReelPreview draft={draft} photoFiles={activePhotoFiles} coverFile={activeCoverFile} />
        )}

        {!isYoutube && publish.isError && <div className="cs-msg err">{publish.error.message}</div>}
        {!isYoutube && igResult?.published && (
          <div className="cs-msg ok">
            Published ✓{" "}
            {igResult.permalink && (
              <a href={igResult.permalink} target="_blank" rel="noopener noreferrer">
                View on Instagram →
              </a>
            )}
          </div>
        )}

        {isYoutube && ytPublish.isError && <div className="cs-msg err">{ytPublish.error.message}</div>}
        {isYoutube && ytResult && (
          <div className="cs-msg ok">
            Uploaded as private draft ✓{" "}
            <a href={ytResult.studioUrl} target="_blank" rel="noopener noreferrer">
              Open in YouTube Studio →
            </a>
          </div>
        )}

        {invalid && !pending && <div className="cs-msg warn">{invalid}</div>}

        <div className="cs-actions">
          <button
            type="button"
            className="cs-ghost"
            disabled={!!invalid || pending}
            onClick={() => setScheduling((s) => !s)}
            title="Publish this later — the file stays on this machine until then"
          >
            Schedule
          </button>
          <button
            type="button"
            className={`cs-transmit${isYoutube ? " yt" : ""}`}
            disabled={!!invalid || pending}
            onClick={transmit}
          >
            {pending ? "Transmitting…" : isYoutube ? "▸ Upload draft" : "▸ Transmit"}
          </button>
        </div>

        {scheduling && (
          <SchedulePopover
            draft={draft}
            files={{
              video: igActiveFile && !igActiveFile.type.startsWith("image/") ? igActiveFile : ytFile ?? undefined,
              image: igActiveFile?.type.startsWith("image/") ? igActiveFile : undefined,
              cover: activeCoverFile ?? undefined,
              photos: activePhotoFiles,
            }}
            onClose={() => setScheduling(false)}
          />
        )}
      </aside>
    </div>
  );
}
