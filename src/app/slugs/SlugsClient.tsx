"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PlatformGlyph } from "@/components/dashboard/cockpit/PlatformGlyph";
import { PlatformSwitch } from "@/components/dashboard/cockpit/PlatformSwitch";
import { CalSelect } from "@/components/calendar/CalSelect";
import {
  useAddSlugVideo,
  useCreateSlug,
  useDeleteSlug,
  useRemoveSlugVideo,
  useSlugDetail,
  useLinkSlugPost,
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
  type SlugPost,
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
  const [picked, setPicked] = useState<string | null>(null);
  const [platform, setPlatform] = useState<SchedulePlatform>("ig");

  const list = slugs.data?.slugs ?? [];

  /**
   * Which pool the right-hand pane is showing.
   *
   * Derived rather than synced in an effect. The selection *is* a function of
   * the list and what was last clicked, so holding it in state would paint an
   * empty pane first and correct it a frame later — and would silently keep
   * pointing at a pool that has since been deleted.
   */
  const selected = picked && list.some((entry) => entry.slug === picked)
    ? picked
    : list[0]?.slug ?? null;

  return (
    <div className="slugs">
      <header className="slugs-bar">
        <div className="slugs-bar-left">
          <span className="slugs-tag">07</span>
          <h1>Slugs</h1>
        </div>
        <p className="slugs-lede">
          Book a calendar slot against a slug and the video is chosen when the slot arrives —
          highest views, longest wait, whatever you pick.
        </p>
        {/*
          Controlled, like Compose: which platform this page is previewing is a
          question about this pool, not the dashboard-wide `?platform=` the
          uncontrolled switch drives.
        */}
        <PlatformSwitch value={platform} onChange={setPlatform} />
      </header>

      <div className="slugs-body">
        <nav className="slugs-list">
          <NewSlugForm onCreated={setPicked} />
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
              onClick={() => setPicked(entry.slug)}
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
            // Remount per pool: without this, a path typed into one pool's add
            // form is still sitting there after clicking another, ready to be
            // added to the wrong one.
            key={selected}
            slug={selected}
            platform={platform}
            defaultMethod={slugs.data?.default_selection ?? "most_views"}
            onDeleted={() => setPicked(null)}
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
        {/*
          A slug an automation fires on is that flow's identity, so it cannot be
          deleted from here — only emptied. Offering the button that will be
          refused would be worse than offering the one that works.
        */}
        <button
          type="button"
          className="slugs-btn ghost danger"
          onClick={async () => {
            const poolOnly = !!data?.slug.automation;
            try {
              await remove.mutateAsync({ slug, poolOnly });
              if (!poolOnly) onDeleted();
            } catch (err) {
              setError(err instanceof Error ? err.message : "Could not delete that.");
            }
          }}
          title={
            data?.slug.automation
              ? `#${slug} is the automation "${data.slug.automation.name}" — only its videos can be removed here`
              : "Remove this slug and its pool"
          }
        >
          {data?.slug.automation ? "Empty pool" : "Delete slug"}
        </button>
      </header>

      {data?.slug.automation ? (
        <p className="slugs-note">
          Shares its name with the automation flow{" "}
          {/* Deep link: the flow id, not just the section — landing on the list
              and having to find the row again is a step the link can take. */}
          <Link href={`/automations?flow=${encodeURIComponent(data.slug.automation.flow_id)}`}>
            {data.slug.automation.name}
          </Link>
          {data.slug.automation.is_active ? " (active)" : " (paused)"} — posting under this slug
          attaches to it.
        </p>
      ) : (
        <p className="slugs-note muted">No automation flow uses this slug yet.</p>
      )}

      <div className="slugs-method">
        <label htmlFor="slug-method">Selection</label>
        <CalSelect
          id="slug-method"
          value={override}
          options={[
            { value: "", label: `Default (${SELECTION_LABELS[defaultMethod]})` },
            ...SELECTION_METHODS.map((method) => ({
              value: method,
              label: SELECTION_LABELS[method],
            })),
          ]}
          onChange={(value) =>
            update.mutate({
              slug,
              selection_method: (value || null) as SelectionMethod | null,
            })
          }
          aria-label="Selection method"
        />
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

      <SlugHistory
        slug={slug}
        history={data?.history ?? []}
        pool={pool}
        platform={platform}
      />

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

/**
 * Posts already published under this slug.
 *
 * The reason this exists: a pool holds local files, and an established account's
 * performance lives on posts. Until a candidate is pointed at the post it
 * produced, a clip that did 24k ranks as unscored — the numbers are right
 * there and unusable. Linking is a one-time act per post.
 */
function SlugHistory({
  slug,
  history,
  pool,
  platform,
}: {
  slug: string;
  history: SlugPost[];
  pool: SlugVideoView[];
  platform: SchedulePlatform;
}) {
  const link = useLinkSlugPost();
  if (!history.length) return null;

  const unlinked = history.filter((post) => !post.linked_video_id).length;

  return (
    <div className="slugs-history">
      <div className="slugs-history-head">
        <span>Published under this slug</span>
        <span className="slugs-hint">
          {unlinked
            ? `${unlinked} of ${history.length} not yet matched to a video — link one and its views count towards selection.`
            : `All ${history.length} matched.`}
        </span>
      </div>

      {history.map((post) => (
        <div key={`${post.platform}-${post.external_id}`} className="slugs-post">
          <PlatformGlyph platform={post.platform} size={10} />
          <span className="slugs-post-title">
            {post.permalink ? (
              <a href={post.permalink} target="_blank" rel="noopener noreferrer">
                {post.title ?? post.external_id}
              </a>
            ) : (
              (post.title ?? post.external_id)
            )}
            <span>{post.posted_at ? post.posted_at.slice(0, 10) : ""}</span>
          </span>
          <span className="slugs-post-views">
            {post.views != null ? formatCount(post.views) : "—"}
          </span>

          {post.linked_video_id ? (
            <span className="slugs-post-link">
              <b>{post.linked_label}</b>
              <button
                type="button"
                className="slugs-x"
                aria-label="Unlink this post"
                onClick={() =>
                  link.mutate({
                    slug,
                    id: post.linked_video_id!,
                    platform: post.platform,
                    external_id: post.external_id,
                    unlink: true,
                  })
                }
              >
                ✕
              </button>
            </span>
          ) : (
            <CalSelect
              value=""
              placeholder="Link to…"
              align="end"
              // Nothing in the pool means nothing to link to — an empty popup
              // is a worse answer than a control that says so by being dead.
              disabled={!pool.length}
              options={pool.map((video) => ({
                value: video.id,
                label: video.label ?? video.filename,
              }))}
              onChange={(id) =>
                id &&
                link.mutate({
                  slug,
                  id,
                  platform: post.platform,
                  external_id: post.external_id,
                })
              }
              aria-label={`Link ${post.title ?? post.external_id} to a video`}
            />
          )}
        </div>
      ))}

      {!pool.length && (
        <p className="slugs-hint">
          Add the local file behind one of these below, then link it — that is what makes
          {platform === "yt" ? " YouTube " : " Instagram "}
          selection able to rank on what already worked.
        </p>
      )}
    </div>
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
