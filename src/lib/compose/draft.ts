/**
 * The Compose Studio draft — a flat, input-friendly shape the UI edits, plus the
 * mapping to the `PublishInput` body the publish endpoints accept.
 *
 * The UI has three tabs — Reel / Photo / Story. "Photo" is a single image at one
 * item and auto-becomes a carousel at 2+; the API media_type is derived here.
 *
 * `import type` only from the endpoint module so no server code leaks into the
 * client bundle.
 */

import type {
  PublishInput,
  GraduationStrategy,
  UserTag,
  ProductTag,
} from "@/lib/instagram/endpoints/publish";
import type { Platform } from "@/hooks/usePlatform";

export type { GraduationStrategy };

// The media-type strip is platform-scoped: Instagram shows Reel / Photo / Story;
// YouTube shows Short / Video. A single union keeps `draft.tab` one field, and
// the platform decides which subset is offered (see tabsForPlatform).
export type ComposeTab = "REEL" | "PHOTO" | "STORY" | "SHORT" | "VIDEO";

export const CAPTION_MAX = 2200;
export const MAX_CAROUSEL = 10;

// YouTube snippet limits (Data API v3): title ≤ 100 chars, description ≤ 5000.
export const YT_TITLE_MAX = 100;
export const YT_DESCRIPTION_MAX = 5000;
// A Short is classified by signal, not a flag: vertical + short + the #Shorts tag.
// Duration ceiling was raised from 60s to 3 min in late 2024.
export const YT_SHORT_MAX_SECONDS = 180;

const TABS_BY_PLATFORM: Record<Platform, { value: ComposeTab; label: string }[]> = {
  ig: [
    { value: "REEL", label: "Reel" },
    { value: "PHOTO", label: "Photo" },
    { value: "STORY", label: "Story" },
  ],
  yt: [
    { value: "SHORT", label: "Short" },
    { value: "VIDEO", label: "Video" },
  ],
};

export function tabsForPlatform(platform: Platform): { value: ComposeTab; label: string }[] {
  return TABS_BY_PLATFORM[platform];
}

/** The tab a platform lands on when it becomes active. */
export function defaultTabFor(platform: Platform): ComposeTab {
  return TABS_BY_PLATFORM[platform][0].value;
}

export interface ComposeDraft {
  platform: Platform;
  tab: ComposeTab;
  title: string; // YouTube video title (Instagram uses caption only)
  photos: string[]; // Photo tab: per-slot structure; 1 filled = image, 2–10 = carousel
  caption: string;
  thumbOffset: string; // kept as a string for the input; parsed on submit
  shareToFeed: boolean;
  audioName: string;
  locationId: string;
  altText: string; // single-image alt text
  isTrial: boolean;
  graduationStrategy: GraduationStrategy;
  isPaidPartnership: boolean;
  isAiGenerated: boolean;
  collaborators: string; // comma / space separated usernames
  userTags: string; // comma / space separated usernames (phase 1)
  productTags: string; // comma / space separated product ids
}

export const initialDraft: ComposeDraft = {
  platform: "ig",
  tab: "REEL",
  title: "",
  photos: [""],
  caption: "",
  thumbOffset: "",
  shareToFeed: true,
  audioName: "",
  locationId: "",
  altText: "",
  isTrial: false,
  graduationStrategy: "MANUAL",
  isPaidPartnership: false,
  isAiGenerated: false,
  collaborators: "",
  userTags: "",
  productTags: "",
};

/**
 * Photo-tab slots that have content — a local file pending upload to R2 — in
 * slot order. `photoFiles` is index-aligned with
 * `d.photos`; files live outside ComposeDraft (same pattern as the Reel/Story
 * `file` state) since they aren't serializable. The caller (ComposeStudio /
 * usePublish) should derive both `draftToPublishInput`'s children/image_url
 * *and* the parallel R2 key list from this single function, so the two stay
 * aligned by construction instead of by two independent filters.
 */
export function filledPhotoSlots(
  d: ComposeDraft,
  photoFiles: (File | null)[] = []
): { url: string; file: File | null }[] {
  return d.photos
    .map((raw, i) => ({ url: raw.trim(), file: photoFiles[i] ?? null }))
    .filter((slot) => slot.url || slot.file);
}

/** Split a comma/space/newline separated list, trim, drop leading @ and blanks. */
function parseList(raw: string): string[] {
  return raw
    .split(/[,\n]+/)
    .flatMap((s) => s.split(/\s+/))
    .map((s) => s.trim().replace(/^@/, ""))
    .filter(Boolean);
}

/** Live caption stats for the counter display. */
export function captionStats(caption: string) {
  return {
    chars: caption.length,
    hashtags: (caption.match(/#/g) ?? []).length,
    mentions: (caption.match(/@/g) ?? []).length,
  };
}

/**
 * Client-side gate mirroring the server's `validate()`. Returns an error string
 * to show / disable Transmit, or null when the draft is submittable.
 */
export function validateDraft(
  d: ComposeDraft,
  hasFile = false,
  photoFiles: (File | null)[] = []
): string | null {
  switch (d.tab) {
    case "REEL":
      if (!hasFile) return "Drop a video file";
      break;
    case "PHOTO": {
      const n = filledPhotoSlots(d, photoFiles).length;
      if (n === 0) return "Add at least one image";
      if (n > MAX_CAROUSEL) return `Up to ${MAX_CAROUSEL} images`;
      break;
    }
    case "STORY":
      if (!hasFile) return "Drop an image or video file";
      break;
  }
  if (d.caption.length > CAPTION_MAX) return `Caption exceeds ${CAPTION_MAX} characters`;
  if (parseList(d.collaborators).length > 3) return "Up to 3 collaborators";
  if (parseList(d.productTags).length > 5) return "Up to 5 product tags";
  return null;
}

/** Probed properties of the dropped YouTube video, read client-side from a
 *  <video> element. Null until metadata has loaded. */
export interface VideoProbe {
  width: number;
  height: number;
  durationSeconds: number;
}

/**
 * Client-side gate for a YouTube draft, mirroring what the upload endpoint needs.
 * A title and a video file are always required. The "Short" tab additionally
 * enforces the Shorts signals — vertical aspect and ≤ 3 min — before enabling
 * Publish, since a non-vertical or long clip silently uploads as a normal video.
 * `probe` is null until the browser has read the file's metadata; we don't block
 * Publish on a not-yet-probed file, we only reject one we've measured and know is
 * out of spec.
 */
export function validateYoutubeDraft(
  d: ComposeDraft,
  hasFile = false,
  probe: VideoProbe | null = null
): string | null {
  if (!d.title.trim()) return "Add a title";
  if (d.title.length > YT_TITLE_MAX) return `Title exceeds ${YT_TITLE_MAX} characters`;
  if (!hasFile) return "Drop a video file";
  if (d.caption.length > YT_DESCRIPTION_MAX)
    return `Description exceeds ${YT_DESCRIPTION_MAX} characters`;

  if (d.tab === "SHORT" && probe) {
    if (probe.height <= probe.width) return "A Short must be vertical (9:16)";
    if (probe.durationSeconds > YT_SHORT_MAX_SECONDS)
      return `A Short must be ${YT_SHORT_MAX_SECONDS}s or shorter`;
  }
  return null;
}

/** Fields shared across every media type. */
function sharedFields(d: ComposeDraft): Partial<PublishInput> {
  const s: Partial<PublishInput> = {};
  if (d.caption.trim()) s.caption = d.caption;
  if (d.locationId.trim()) s.location_id = d.locationId.trim();
  if (d.isPaidPartnership) s.is_paid_partnership = true;
  if (d.isAiGenerated) s.is_ai_generated = true;

  const collaborators = parseList(d.collaborators);
  if (collaborators.length) s.collaborators = collaborators;

  const userTags: UserTag[] = parseList(d.userTags).map((username) => ({ username }));
  if (userTags.length) s.user_tags = userTags;

  const productTags: ProductTag[] = parseList(d.productTags).map((product_id) => ({ product_id }));
  if (productTags.length) s.product_tags = productTags;

  return s;
}

/** The API media_type a draft resolves to (1 photo = IMAGE, 2+ = CAROUSEL). */
export function resolvedMediaType(
  d: ComposeDraft,
  photoFiles: (File | null)[] = []
): PublishInput["media_type"] {
  if (d.tab === "REEL") return "REELS";
  if (d.tab === "STORY") return "STORIES";
  return filledPhotoSlots(d, photoFiles).length >= 2 ? "CAROUSEL" : "IMAGE";
}

/**
 * Map the flat draft to the exact POST body. `photoFiles` slots (Photo tab, local
 * files pending R2 upload) are left with no `image_url` — the caller (usePublish)
 * fills those via the parallel `r2` key map after uploading, using the same
 * `filledPhotoSlots` order so the two line up by construction.
 */
export function draftToPublishInput(d: ComposeDraft, photoFiles: (File | null)[] = []): PublishInput {
  const shared = sharedFields(d);

  if (d.tab === "REEL") {
    const input: PublishInput = { media_type: "REELS", ...shared };
    // video_url and cover_url are filled by usePublish from the R2 uploads.
    const offset = parseInt(d.thumbOffset, 10);
    if (Number.isFinite(offset) && offset > 0) input.thumb_offset = offset;
    if (d.audioName.trim()) input.audio_name = d.audioName.trim();
    input.share_to_feed = d.shareToFeed;
    if (d.isTrial) input.trial_params = { graduation_strategy: d.graduationStrategy };
    return input;
  }

  if (d.tab === "STORY") {
    // image_url or video_url is filled by usePublish from the R2 upload,
    // depending on whether the dropped file is an image or a video.
    return { media_type: "STORIES", ...shared };
  }

  // PHOTO — carousel at 2+ filled slots, single image otherwise. A slot backed by
  // a local file gets no image_url here; usePublish fills it via r2.children /
  // r2.image_url after uploading, in this same slot order.
  const slots = filledPhotoSlots(d, photoFiles);
  if (slots.length >= 2) {
    return {
      media_type: "CAROUSEL",
      children: slots.map((s) => (s.file ? {} : { image_url: s.url })),
      ...shared,
    };
  }
  const input: PublishInput = { media_type: "IMAGE", ...shared };
  if (slots[0] && !slots[0].file) input.image_url = slots[0].url;
  if (d.altText.trim()) input.alt_text = d.altText.trim();
  return input;
}
