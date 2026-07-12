/**
 * Instagram content publishing — the two-step Graph API flow:
 *   1. POST /{ig-user}/media          → create a media container
 *   2. poll  /{container}?fields=status_code  → wait for FINISHED
 *   3. POST /{ig-user}/media_publish  → publish the container
 *
 * Covers every container parameter the API exposes (reels, trial reels,
 * carousels, stories, tagging, partnership labels). Server-side only.
 *
 * Docs: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media
 */

import { instagramFetch } from "../client";
import { getMedia } from "./media";

// ─── Types ──────────────────────────────────────────────────────────────────

export type PublishMediaType = "REELS" | "IMAGE" | "CAROUSEL" | "STORIES";
export type GraduationStrategy = "MANUAL" | "SS_PERFORMANCE";

/** Container processing states returned by `status_code`. */
export type StatusCode =
  | "EXPIRED"
  | "ERROR"
  | "FINISHED"
  | "IN_PROGRESS"
  | "PUBLISHED";

export interface UserTag {
  username: string;
  /** 0.0–1.0, required for image feed posts; omit for video/reel. */
  x?: number;
  y?: number;
}

export interface ProductTag {
  product_id: string;
  x?: number;
  y?: number;
}

export interface TrialParams {
  graduation_strategy: GraduationStrategy;
}

/** A carousel child: either an already-created container id, or a spec to create. */
export type CarouselChild =
  | string
  | {
      image_url?: string;
      video_url?: string;
      user_tags?: UserTag[];
      alt_text?: string;
    };

export interface CreateContainerInput {
  /** Omit for a single image post (the API defaults to IMAGE). */
  media_type?: PublishMediaType;
  image_url?: string;
  video_url?: string;
  caption?: string;
  /** Reel cover image URL (Reels tab). */
  cover_url?: string;
  /** Reel thumbnail frame, in milliseconds from the video start. */
  thumb_offset?: number;
  /** Reel: also show in the main Feed (default true on Instagram). */
  share_to_feed?: boolean;
  /** Rename the reel's original audio (once). */
  audio_name?: string;
  location_id?: string;
  /** Alt text — images only. */
  alt_text?: string;
  user_tags?: UserTag[];
  /** Up to 3 usernames invited as collaborators (feed images, reels, carousels). */
  collaborators?: string[];
  /** Up to 5 product tags. */
  product_tags?: ProductTag[];
  /** Trial reel — publish to non-followers first, then graduate. REELS only. */
  trial_params?: TrialParams;
  is_paid_partnership?: boolean;
  is_ai_generated?: boolean;
  /** Set true when this container is a carousel item. */
  is_carousel_item?: boolean;
  /** Carousel: child container ids (comma-joined for the API). */
  children?: string[];
  /**
   * Escape hatch for any parameter this client doesn't model yet (e.g. a new
   * Graph API field). Merged last — values are sent verbatim.
   */
  extra?: Record<string, string | number | boolean>;
}

export interface PublishInput extends Omit<CreateContainerInput, "children"> {
  /** For carousels: existing container ids, or child specs to create first. */
  children?: CarouselChild[];
}

export interface PublishOptions {
  /** Publish the container after it finishes processing. Default true. */
  finalize?: boolean;
  /** Max time to wait for the container to reach FINISHED. Default 120_000ms. */
  timeoutMs?: number;
  /** Poll interval while waiting. Default 3_000ms. */
  intervalMs?: number;
}

export interface PublishResult {
  container_id: string;
  status_code: StatusCode;
  published: boolean;
  /** Present once published. */
  media_id?: string;
  permalink?: string;
}

/** Thrown when a container hasn't finished processing within the timeout. */
export class ContainerTimeoutError extends Error {
  readonly containerId: string;
  readonly lastStatus: StatusCode;
  constructor(containerId: string, lastStatus: StatusCode) {
    super(
      `Container ${containerId} still ${lastStatus} after timeout — poll /api/publish?container_id=${containerId} and finalize when FINISHED.`
    );
    this.name = "ContainerTimeoutError";
    this.containerId = containerId;
    this.lastStatus = lastStatus;
  }
}

/** Thrown when Instagram reports the container failed to process. */
export class ContainerFailedError extends Error {
  readonly containerId: string;
  readonly statusCode: StatusCode;
  constructor(containerId: string, statusCode: StatusCode, detail?: string) {
    super(
      `Container ${containerId} failed processing (${statusCode})${detail ? `: ${detail}` : ""}.`
    );
    this.name = "ContainerFailedError";
    this.containerId = containerId;
    this.statusCode = statusCode;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function requireAccountId(): string {
  const accountId = process.env.INSTAGRAM_ACCOUNT_ID;
  if (!accountId) {
    throw new Error("INSTAGRAM_ACCOUNT_ID is not set. Add it to .env.local.");
  }
  return accountId;
}

type Params = Record<string, string | number | boolean | undefined>;

/** Flatten a container input into Graph API query params (JSON-encoding objects). */
function marshalContainer(input: CreateContainerInput): Params {
  const p: Params = {};

  if (input.media_type) p.media_type = input.media_type;
  if (input.image_url) p.image_url = input.image_url;
  if (input.video_url) p.video_url = input.video_url;
  if (input.caption != null) p.caption = input.caption;
  if (input.cover_url) p.cover_url = input.cover_url;
  if (input.thumb_offset != null) p.thumb_offset = input.thumb_offset;
  if (input.share_to_feed != null) p.share_to_feed = input.share_to_feed;
  if (input.audio_name) p.audio_name = input.audio_name;
  if (input.location_id) p.location_id = input.location_id;
  if (input.alt_text) p.alt_text = input.alt_text;
  if (input.is_carousel_item != null) p.is_carousel_item = input.is_carousel_item;
  if (input.is_paid_partnership != null) p.is_paid_partnership = input.is_paid_partnership;
  if (input.is_ai_generated != null) p.is_ai_generated = input.is_ai_generated;

  if (input.user_tags?.length) p.user_tags = JSON.stringify(input.user_tags);
  if (input.product_tags?.length) p.product_tags = JSON.stringify(input.product_tags);
  if (input.collaborators?.length) p.collaborators = JSON.stringify(input.collaborators);
  if (input.trial_params) p.trial_params = JSON.stringify(input.trial_params);
  if (input.children?.length) p.children = input.children.join(",");

  if (input.extra) Object.assign(p, input.extra);

  return p;
}

// ─── Primitive steps (composable for advanced flows) ──────────────────────────

/** Step 1 — create a media container. Returns its id. */
export async function createMediaContainer(
  input: CreateContainerInput
): Promise<{ id: string }> {
  const accountId = requireAccountId();
  return instagramFetch<{ id: string }>(`/${accountId}/media`, {
    method: "POST",
    params: marshalContainer(input),
  });
}

/** Step 2 — read a container's processing status. */
export async function getContainerStatus(
  containerId: string
): Promise<{ id: string; status_code: StatusCode; status?: string }> {
  return instagramFetch<{ id: string; status_code: StatusCode; status?: string }>(
    `/${containerId}`,
    { params: { fields: "status_code,status" } }
  );
}

/** Step 3 — publish a finished container. Returns the new media id. */
export async function publishContainer(
  creationId: string
): Promise<{ id: string }> {
  const accountId = requireAccountId();
  return instagramFetch<{ id: string }>(`/${accountId}/media_publish`, {
    method: "POST",
    params: { creation_id: creationId },
  });
}

/**
 * Poll a container until it reaches FINISHED. Resolves with the final status,
 * throws ContainerFailedError on ERROR/EXPIRED, ContainerTimeoutError on timeout.
 */
export async function waitForContainer(
  containerId: string,
  { timeoutMs = 120_000, intervalMs = 3_000 }: PublishOptions = {}
): Promise<StatusCode> {
  const deadline = Date.now() + timeoutMs;
  let last: StatusCode = "IN_PROGRESS";

  while (Date.now() < deadline) {
    const { status_code, status } = await getContainerStatus(containerId);
    last = status_code;

    if (status_code === "FINISHED" || status_code === "PUBLISHED") return status_code;
    if (status_code === "ERROR" || status_code === "EXPIRED") {
      throw new ContainerFailedError(containerId, status_code, status);
    }

    await new Promise((r) => setTimeout(r, intervalMs));
  }

  throw new ContainerTimeoutError(containerId, last);
}

// ─── Orchestrated one-shot flow ───────────────────────────────────────────────

/**
 * Full publish flow: create the container (recursively creating carousel
 * children first), wait for processing, then publish. Set `finalize: false` to
 * stop after the container is ready (for scheduling or manual finalization).
 *
 * On a processing timeout the container id is returned (published: false) rather
 * than thrown, so callers can poll and finalize it later.
 */
/**
 * Shared tail: wait for a container to finish processing, then publish it
 * (unless finalize:false). On a processing timeout, returns the container id
 * (published:false) rather than throwing, so it can be finalized later.
 */
async function completeContainer(
  containerId: string,
  opts: PublishOptions
): Promise<PublishResult> {
  const { finalize = true } = opts;

  let status: StatusCode;
  try {
    status = await waitForContainer(containerId, opts);
  } catch (err) {
    if (err instanceof ContainerTimeoutError) {
      return { container_id: containerId, status_code: err.lastStatus, published: false };
    }
    throw err;
  }

  if (!finalize) {
    return { container_id: containerId, status_code: status, published: false };
  }

  const published = await publishContainer(containerId);
  const permalink = await getMedia(published.id, ["id", "permalink"])
    .then((m) => m.permalink)
    .catch(() => undefined);

  return {
    container_id: containerId,
    media_id: published.id,
    permalink,
    status_code: "PUBLISHED",
    published: true,
  };
}

export async function publishMedia(
  input: PublishInput,
  opts: PublishOptions = {}
): Promise<PublishResult> {
  // Carousel: materialize any child specs into container ids first.
  let childIds: string[] | undefined;
  if (input.media_type === "CAROUSEL" && input.children?.length) {
    childIds = [];
    for (const child of input.children) {
      if (typeof child === "string") {
        childIds.push(child);
        continue;
      }
      const created = await createMediaContainer({ ...child, is_carousel_item: true });
      await waitForContainer(created.id, opts);
      childIds.push(created.id);
    }
  }

  // Override children (CarouselChild[]) with the resolved container ids.
  const container = await createMediaContainer({ ...input, children: childIds });
  return completeContainer(container.id, opts);
}
