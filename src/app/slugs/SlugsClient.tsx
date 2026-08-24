"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PlatformGlyph } from "@/components/dashboard/cockpit/PlatformGlyph";
import {
  useAddSlugVideo,
  useCreateSlug,
  useDeleteSlug,
  useRemoveSlugVideo,
  useSlugDetail,
  useSlugs,
  useUpdateSlug,
  useUpdateSlugVideo,
} from "@/hooks/useSlugs";
import type { SchedulePlatform } from "@/lib/schedule/types";
import {
  SELECTION_DESCRIPTIONS,
  SELECTION_LABELS,
  SELECTION_METHODS,
  type SelectionMethod,
  type SlugVideoPayload,
  type SlugVideoView,
} from "@/lib/slugs/types";

const PLATFORMS: SchedulePlatform[] = ["ig", "yt"];
const PLATFORM_NAME: Record<SchedulePlatform, string> = { ig: "Instagram", yt: "YouTube" };

/**
 * The slug registry.
 *
 * A slug is one string with two facets — the pool of videos it can post, and
 * the automation flow it fires. This page owns the pool; the flow keeps its
 * home on Automations and is linked from here so the string never looks like it
 * means two unrelated things.
 */
export function SlugsClient() {
  const slugs = useSlugs();
  const [selected, setSelected] = useState<string | null>(null);
  const [platform, setPlatform] = useState<SchedulePlatform>("ig");

  const list = useMemo(() => slugs.data?.slugs ?? [], [slugs.data]);

  // Land on something rather than an empty right-hand pane, and follow along if
  // the selected slug is deleted from under us.
  useEffect(() => {
    if (!list.length) return setSelected(null);
    if (!selected || !list.some((entry) => entry.slug === selected)) {
      setSelected(list[0].slug);
    }
  }, [list, selected]);

  return (
    <div className="slugs">
      <header className="slugs-bar">
        <div className="slugs-bar-left">
          <span className="slugs-tag">POOLS</span>
          <h1>Slugs</h1>
        </div>
        <p className="slugs-lede">
          Book a calendar slot against a slug and the video is chosen when the slot arrives —
          highest views, longest wait, whatever you pick.
        </p>
        <div className="slugs-seg">
          {PLATFORMS.map((p) => (
            <button
              key={p}
              type="button"
              className={platform === p ? "on" : undefined}
              onClick={() => setPlatform(p)}
            >
              <PlatformGlyph platform={p} size={11} />
              {PLATFORM_NAME[p]}
            </button>
          ))}
        </div>
      </header>

      <div className="slugs-body">
        <nav className="slugs-list">
          <NewSlugForm onCreated={setSelected} />
          {slugs.isLoading && <p className="slugs-empty">Loading…</p>}
          {!slugs.isLoading && !list.length && (
            <p className="slugs-empty">
              No pools yet. Start one above, or publish anything with a slug and it appears here.
            </p>
          )}
          {list.map((entry) => (
            <button
              key={entry.slug}
              type="button"
              className={`slugs-item${selected === entry.slug ? " on" : ""}`}
              onClick={() => setSelected(entry.slug)}
            >
              <span className="slugs-item-name">{entry.name ?? entry.slug}</span>
              <span className="slugs-item-meta">
                #{entry.slug} · {entry.video_count} video{entry.video_count === 1 ? "" : "s"}
              </span>
              <span className="slugs-item-counts">
                {PLATFORMS.map((p) => (
                  <span key={p} className={entry.eligible[p] ? "" : "is-out"}>
                    <PlatformGlyph platform={p} size={9} /> {entry.eligible[p]}
                  </span>
                ))}
                {entry.automation && <span className="slugs-auto" title={`Automation: ${entry.automation.name}`}>⌁</span>}
              </span>
            </button>
          ))}
        </nav>

        {selected ? (
          <SlugDetail
            slug={selected}
            platform={platform}
            defaultMethod={slugs.data?.default_selection ?? "most_views"}
            onDeleted={() => setSelected(null)}
          />
        ) : (
          <div className="slugs-detail slugs-empty-pane">
            <p>Pick a slug to see its pool.</p>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Start a pool before anything has been posted to it.
 *
 * Publishing with a slug creates one too, but a pool you can fill *first* is
 * the whole point of being able to book a slot against it — otherwise the only
 * way to get a slug onto the calendar is to post something manually first.
 */
function NewSlugForm({ onCreated }: { onCreated: (slug: string) => void }) {
  const create = useCreateSlug();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setError(null);
    try {
      const { slug } = await create.mutateAsync({ slug: trimmed, name: trimmed });
      setName("");
      onCreated(slug.slug);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create that slug.");
    }
  }

  return (
    <div className="slugs-new">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
        placeholder="New pool, e.g. Gym tips"
        aria-label="New slug"
      />
      <button type="button" onClick={submit} disabled={!name.trim() || create.isPending}>
        {create.isPending ? "…" : "+"}
      </button>
      {error && <p className="slugs-err">{error}</p>}
    </div>
  );
}

function SlugDetail({
  slug,
  platform,
  defaultMethod,
  onDeleted,
}: {
  slug: string;
  platform: SchedulePlatform;
  defaultMethod: SelectionMethod;
  onDeleted: () => void;
}) {
  const detail = useSlugDetail(slug, platform);
  const update = useUpdateSlug();
  const remove = useDeleteSlug();
  const addVideo = useAddSlugVideo();
  const removeVideo = useRemoveSlugVideo();
  const updateVideo = useUpdateSlugVideo();

  const [path, setPath] = useState("");
  const [label, setLabel] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const data = detail.data;

  // Re-seed from the server rather than only on mount, so switching slugs — or
  // an edit made in another tab — doesn't leave this field showing the old one.
  useEffect(() => {
    setName(data?.slug.name ?? "");
  }, [data?.slug.name, slug]);

  const pool = data?.slug.videos ?? [];
  const override = data?.slug.selection_method ?? "";

  async function add() {
    setError(null);
    if (!path.trim()) return setError("Give a path to a video on this machine.");
    try {
      await addVideo.mutateAsync({ slug, path: path.trim(), label: label.trim() || undefined });
      setPath("");
      setLabel("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add that video.");
    }
  }

  return (
    <section className="slugs-detail">
      <header className="slugs-head">
        <div className="slugs-title">
          <input
            className="slugs-rename"
            value={name}
            placeholder={slug}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              const trimmed = name.trim();
              if (trimmed !== (data?.slug.name ?? "")) update.mutate({ slug, name: trimmed || null });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            aria-label="Pool name"
          />
          <p className="slugs-sub">#{slug}</p>
        </div>
        <button
          type="button"
          className="slugs-btn ghost danger"
          onClick={async () => {
            await remove.mutateAsync(slug);
            onDeleted();
          }}
        >
          Delete pool
        </button>
      </header>

      {data?.slug.automation ? (
        <p className="slugs-note">
          Shares its name with the automation flow{" "}
          <Link href="/automations">{data.slug.automation.name}</Link>
          {data.slug.automation.is_active ? " (active)" : " (paused)"} — posting under this slug
          attaches to it.
        </p>
      ) : (
        <p className="slugs-note muted">No automation flow uses this slug yet.</p>
      )}

      <div className="slugs-method">
        <label htmlFor="slug-method">Selection</label>
        <select
          id="slug-method"
          value={override}
          onChange={(e) =>
            update.mutate({
              slug,
              selection_method: (e.target.value || null) as SelectionMethod | null,
            })
          }
        >
          <option value="">Default ({SELECTION_LABELS[defaultMethod]})</option>
          {SELECTION_METHODS.map((method) => (
            <option key={method} value={method}>
              {SELECTION_LABELS[method]}
            </option>
          ))}
        </select>
        <p className="slugs-hint">
          {SELECTION_DESCRIPTIONS[data?.effective_method ?? defaultMethod]}
        </p>
      </div>

      {data?.blocked ? (
        <div className={`slugs-next ${data.blocked.exhausted ? "is-warn" : "is-err"}`}>
          <span className="slugs-next-tag">Next up on {PLATFORM_NAME[platform]}</span>
          <b>Nothing</b>
          <span className="slugs-next-why">{data.blocked.error}</span>
        </div>
      ) : data?.next_up ? (
        <div className="slugs-next">
          <span className="slugs-next-tag">Next up on {PLATFORM_NAME[platform]}</span>
          <b>{data.next_up.video.label ?? data.next_up.video.filename}</b>
          <span className="slugs-next-why">{data.next_up.reason}</span>
        </div>
      ) : null}

      <div className="slugs-pool">
        <div className="slugs-row is-head">
          <span>Video</span>
          <span>Views</span>
          <span>Engagement</span>
          <span>Posted to</span>
          <span />
        </div>
        {!pool.length && !detail.isLoading && (
          <p className="slugs-empty">
            Nothing in this pool. Add a video below, or publish one with{" "}
            <code>slug: &quot;{slug}&quot;</code>.
          </p>
        )}
        {pool.map((video) => (
          <PoolRow
            key={video.id}
            video={video}
            isNext={data?.next_up?.video.id === video.id}
            onSave={(patch) => updateVideo.mutate({ slug, id: video.id, ...patch })}
            onRemove={() => removeVideo.mutate({ slug, id: video.id })}
          />
        ))}
      </div>

      <div className="slugs-add">
        <input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="/Users/you/clips/gym-3.mp4"
        />
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Label (optional)"
        />
        <button type="button" className="slugs-btn" disabled={addVideo.isPending} onClick={add}>
          {addVideo.isPending ? "Adding…" : "Add video"}
        </button>
      </div>
      <p className="slugs-hint">
        The file stays where it is — a pool holds a reference to your own library, never a copy.
      </p>
      {error && <p className="slugs-err">{error}</p>}
    </section>
  );
}

function PoolRow({
  video,
  isNext,
  onSave,
  onRemove,
}: {
  video: SlugVideoView;
  isNext: boolean;
  onSave: (patch: { label?: string | null; payload?: SlugVideoPayload }) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className={`slugs-row${isNext ? " is-next" : ""}${video.missing ? " is-missing" : ""}`}>
        <button
          type="button"
          className="slugs-cell-name"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <b>{video.label ?? video.filename}</b>
          <span title={video.path}>{video.missing ? "file is missing" : video.filename}</span>
        </button>
        <span>{video.scored ? formatCount(video.views ?? 0) : "—"}</span>
        <span>{video.engagement != null ? `${(video.engagement * 100).toFixed(1)}%` : "—"}</span>
        <span className="slugs-cell-posts">
          {video.posts.length ? (
            video.posts.map((post) => (
              <span
                key={`${post.platform}-${post.external_id}`}
                title={`${post.platform === "yt" ? "YouTube" : "Instagram"} · ${new Date(post.posted_at).toLocaleString()}`}
              >
                <PlatformGlyph platform={post.platform} size={10} />
              </span>
            ))
          ) : (
            <span className="slugs-unposted">not yet posted</span>
          )}
        </span>
        <button type="button" className="slugs-x" onClick={onRemove} aria-label="Remove from pool">
          ✕
        </button>
      </div>
      {open && <PoolRowEditor video={video} onSave={onSave} onDone={() => setOpen(false)} />}
    </>
  );
}

/**
 * What this candidate posts with when the slug picks it.
 *
 * A job booked against a slug usually carries no caption of its own — the point
 * is that it does not know which video it will get. These are the defaults it
 * falls back to, and without them a video added by hand goes out blank.
 */
function PoolRowEditor({
  video,
  onSave,
  onDone,
}: {
  video: SlugVideoView;
  onSave: (patch: { label?: string | null; payload?: SlugVideoPayload }) => void;
  onDone: () => void;
}) {
  const [label, setLabel] = useState(video.label ?? "");
  const [caption, setCaption] = useState(video.payload.ig?.caption ?? "");
  const [title, setTitle] = useState(video.payload.yt?.title ?? "");

  return (
    <div className="slugs-editor">
      <label>
        Name
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={video.filename} />
      </label>
      <label>
        Instagram caption
        <textarea
          rows={3}
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder="Comment GYM for the plan 👇"
        />
      </label>
      <label>
        YouTube title
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={video.label ?? video.filename}
          maxLength={100}
        />
      </label>
      <div className="slugs-editor-foot">
        <p className="slugs-hint">
          Used when the slot that picks this video didn&apos;t bring its own.
        </p>
        <button
          type="button"
          className="slugs-btn"
          onClick={() => {
            onSave({
              label: label.trim() || null,
              payload: {
                ...video.payload,
                ig: { ...video.payload.ig, caption: caption.trim() || undefined },
                yt: { ...video.payload.yt, title: title.trim() || undefined },
              },
            });
            onDone();
          }}
        >
          Save
        </button>
      </div>
    </div>
  );
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
