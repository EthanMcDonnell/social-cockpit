"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CalSelect } from "./CalSelect";
import { PlatformGlyph } from "@/components/dashboard/cockpit/PlatformGlyph";
import { useAutomationFlows } from "@/hooks/useAutomationFlows";
import {
  stageFile,
  useCancelScheduledPost,
  useCreateScheduledPost,
  useRunScheduledPost,
  useUpdateScheduledPost,
  type StagedUpload,
} from "@/hooks/useSchedule";
import { suggestKeywords } from "@/lib/schedule/keywords";
import { parseScheduledAt, toLocalInputValue } from "@/lib/schedule/tz";
import type { PublishInput } from "@/lib/instagram/endpoints/publish";
import type {
  SchedulePlatform,
  ScheduledPostView,
  YoutubeJobPayload,
} from "@/lib/schedule/types";

export interface ComposerDraft {
  scheduledAt: number;
  files?: File[];
  platform?: SchedulePlatform;
}

interface ComposerDrawerProps {
  timeZone: string;
  /** Editing an existing job. */
  job?: ScheduledPostView | null;
  /** Creating a new one, usually from a slot click or a desktop file drop. */
  draft?: ComposerDraft | null;
  onClose: () => void;
}

interface PendingMedia {
  name: string;
  progress: number;
  staged?: StagedUpload;
  error?: string;
}

export function ComposerDrawer({ timeZone, job, draft, onClose }: ComposerDrawerProps) {
  const editing = !!job;
  const create = useCreateScheduledPost();
  const update = useUpdateScheduledPost();
  const cancel = useCancelScheduledPost();
  const runNow = useRunScheduledPost();
  const flows = useAutomationFlows();

  const [platform, setPlatform] = useState<SchedulePlatform>(
    job?.platform ?? draft?.platform ?? "ig"
  );
  const [when, setWhen] = useState(() =>
    toLocalInputValue(job?.scheduled_at ?? draft?.scheduledAt ?? Date.now(), timeZone)
  );
  const [caption, setCaption] = useState(
    () => (job?.payload as PublishInput)?.caption ?? ""
  );
  const [title, setTitle] = useState(() => (job?.payload as YoutubeJobPayload)?.title ?? "");
  const [media, setMedia] = useState<PendingMedia[]>([]);
  const [localPath, setLocalPath] = useState("");
  const [automationKey, setAutomationKey] = useState(job?.automation?.key ?? "");
  const [keywords, setKeywords] = useState(
    () => job?.automation?.trigger_keywords?.join(", ") ?? ""
  );
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  // Stage dropped files immediately: the upload is the slow part, and running it
  // while the caption is being written means Schedule is instant when clicked.
  useEffect(() => {
    if (editing || started.current || !draft?.files?.length) return;
    started.current = true;

    setMedia(draft.files.map((f) => ({ name: f.name, progress: 0 })));
    draft.files.forEach((file, i) => {
      stageFile(file, (fraction) =>
        setMedia((m) => m.map((entry, j) => (i === j ? { ...entry, progress: fraction } : entry)))
      )
        .then((staged) =>
          setMedia((m) =>
            m.map((entry, j) => (i === j ? { ...entry, staged, progress: 1 } : entry))
          )
        )
        .catch((err: Error) =>
          setMedia((m) => m.map((entry, j) => (i === j ? { ...entry, error: err.message } : entry)))
        );
    });
  }, [draft, editing]);

  // Escape closes, matching every other transient surface in the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const suggestions = useMemo(() => suggestKeywords(caption), [caption]);
  const uploading = media.some((m) => !m.staged && !m.error);
  const keyedFlows = (flows.data ?? []).filter((f) => f.automation_key);

  async function submit() {
    setError(null);
    const at = parseScheduledAt(when, timeZone);
    if (at == null) return setError("Pick a date and time.");

    try {
      if (editing) {
        await update.mutateAsync({
          id: job!.id,
          scheduled_at: at,
          payload: platform === "yt" ? { title } : { caption },
          automation: automationKey
            ? {
                key: automationKey,
                trigger_keywords: splitKeywords(keywords),
              }
            : null,
        });
      } else {
        const staged = media.filter((m) => m.staged);
        await create.mutateAsync({
          scheduled_at: at,
          platform,
          ...(platform === "yt"
            ? { title, description: caption, isShort: true }
            : { caption }),
          ...(localPath ? { video_path: localPath } : {}),
          media: staged.map((m, i) => ({
            role: staged.length > 1 ? "child" : mediaRoleFor(m),
            staged_id: m.staged!.id,
            ...(staged.length > 1 ? { index: i } : {}),
          })),
          ...(automationKey
            ? {
                automation: {
                  key: automationKey,
                  name: automationKey,
                  trigger_keywords: splitKeywords(keywords),
                  config: { comment_replies: [], initial_message: "" },
                },
              }
            : {}),
        });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    }
  }

  const busy = create.isPending || update.isPending;

  return (
    <>
      <div className="cal-scrim" onClick={onClose} />
      <aside className="cal-drawer" role="dialog" aria-label={editing ? "Edit scheduled post" : "Schedule a post"}>
        <header className="cal-drawer-head">
          <h2>{editing ? "Scheduled post" : "Schedule a post"}</h2>
          <button type="button" className="cal-x" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="cal-drawer-body">
          {!editing && (
            <div className="cal-field">
              <label>Platform</label>
              <div className="cal-seg">
                {(["ig", "yt"] as SchedulePlatform[]).map((p) => (
                  <button
                    key={p}
                    type="button"
                    className={platform === p ? "on" : undefined}
                    onClick={() => setPlatform(p)}
                  >
                    <PlatformGlyph platform={p} size={12} />
                    {p === "ig" ? "Instagram" : "YouTube"}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="cal-field">
            <label htmlFor="cal-when">When</label>
            <input
              id="cal-when"
              type="datetime-local"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
            />
            <p className="cal-hint">Interpreted in {timeZone}.</p>
          </div>

          {platform === "yt" && (
            <div className="cal-field">
              <label htmlFor="cal-title">Title</label>
              <input
                id="cal-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Video title"
                maxLength={100}
              />
            </div>
          )}

          <div className="cal-field">
            <label htmlFor="cal-caption">{platform === "yt" ? "Description" : "Caption"}</label>
            <textarea
              id="cal-caption"
              rows={5}
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder={platform === "yt" ? "Description…" : "Comment LINK for the guide 👇"}
            />
          </div>

          {!editing && (
            <div className="cal-field">
              <label>Media</label>
              {media.map((m) => (
                <div key={m.name} className={`cal-upload${m.error ? " is-err" : ""}`}>
                  <span className="cal-upload-name">{m.name}</span>
                  {m.error ? (
                    <span className="cal-upload-err">{m.error}</span>
                  ) : (
                    <span className="cal-upload-bar">
                      <span style={{ width: `${Math.round(m.progress * 100)}%` }} />
                    </span>
                  )}
                </div>
              ))}
              {!media.length && (
                <>
                  <input
                    value={localPath}
                    onChange={(e) => setLocalPath(e.target.value)}
                    placeholder="/Users/you/clips/reel.mp4"
                  />
                  <p className="cal-hint">
                    A path on this machine, or drop a file onto the calendar. Either way the
                    file stays local until the post goes out.
                  </p>
                </>
              )}
            </div>
          )}

          {editing && !!job!.media_files.length && (
            <div className="cal-field">
              <label>Media</label>
              {job!.media_files.map((m) => (
                <div key={m.id} className={`cal-upload${m.missing ? " is-err" : ""}`}>
                  <span className="cal-upload-name">{m.filename}</span>
                  {m.missing && <span className="cal-upload-err">file is missing</span>}
                </div>
              ))}
            </div>
          )}

          {platform === "ig" && (
            <div className="cal-field">
              <label htmlFor="cal-auto">Comment automation</label>
              <CalSelect
                id="cal-auto"
                value={automationKey}
                onChange={setAutomationKey}
                options={[
                  { value: "", label: "None" },
                  ...keyedFlows.map((f) => ({
                    value: f.automation_key!,
                    label: `${f.name} (${f.automation_key})`,
                  })),
                  // A key typed into the field below isn't a flow yet, but it
                  // still has to show as the current selection.
                  ...(automationKey && !keyedFlows.some((f) => f.automation_key === automationKey)
                    ? [{ value: automationKey, label: `${automationKey} (new)` }]
                    : []),
                ]}
              />
              <input
                value={automationKey}
                onChange={(e) => setAutomationKey(e.target.value)}
                placeholder="or a new key, e.g. summer-giveaway"
              />
              {automationKey && (
                <>
                  <input
                    value={keywords}
                    onChange={(e) => setKeywords(e.target.value)}
                    placeholder="Trigger keywords, comma separated"
                  />
                  {!!suggestions.length && (
                    <div className="cal-suggest">
                      <span>From your caption:</span>
                      {suggestions.map((s) => (
                        <button key={s} type="button" onClick={() => setKeywords(s)}>
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
              <p className="cal-hint">
                Reusing a key across posts adds each one to the same flow instead of creating
                a duplicate.
              </p>
            </div>
          )}

          {editing && job!.result?.error && (
            <p className="cal-msg err">{job!.result.error}</p>
          )}
          {editing && job!.result?.permalink && (
            <p className="cal-msg ok">
              <a href={job!.result.permalink} target="_blank" rel="noopener noreferrer">
                View on Instagram →
              </a>
            </p>
          )}
          {editing && job!.result?.studio_url && (
            <p className="cal-msg ok">
              <a href={job!.result.studio_url} target="_blank" rel="noopener noreferrer">
                Open in YouTube Studio →
              </a>
            </p>
          )}
          {error && <p className="cal-msg err">{error}</p>}
        </div>

        <footer className="cal-drawer-foot">
          {editing && (
            <>
              <button
                type="button"
                className="cal-btn ghost danger"
                onClick={async () => {
                  await cancel.mutateAsync(job!.id);
                  onClose();
                }}
              >
                Delete
              </button>
              {job!.status !== "published" && (
                <button
                  type="button"
                  className="cal-btn ghost"
                  onClick={() => runNow.mutate(job!.id)}
                >
                  Post now
                </button>
              )}
            </>
          )}
          <button
            type="button"
            className="cal-btn primary"
            disabled={busy || uploading}
            onClick={submit}
          >
            {busy ? "Saving…" : uploading ? "Uploading…" : editing ? "Save" : "Schedule"}
          </button>
        </footer>
      </aside>
    </>
  );
}

function splitKeywords(raw: string): string[] {
  return raw
    .split(/[,\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** A single dropped file is a video unless it's obviously an image. */
function mediaRoleFor(m: PendingMedia): "video" | "image" {
  return m.staged?.content_type.startsWith("image/") ? "image" : "video";
}
