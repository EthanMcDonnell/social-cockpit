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

export type { GraduationStrategy };

export type ComposeTab = "REEL" | "PHOTO" | "STORY";

export const CAPTION_MAX = 2200;
export const MAX_CAROUSEL = 10;

export interface ComposeDraft {
  tab: ComposeTab;
  videoUrl: string; // reel / video story (or supplied via a local file)
  imageUrl: string; // photo story
  photos: string[]; // Photo tab: 1 URL = image, 2–10 = carousel
  caption: string;
  coverUrl: string;
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
  tab: "REEL",
  videoUrl: "",
  imageUrl: "",
  photos: [""],
  caption: "",
  coverUrl: "",
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

/** Non-empty, trimmed photo URLs from the Photo tab. */
export function photoUrls(d: ComposeDraft): string[] {
  return d.photos.map((s) => s.trim()).filter(Boolean);
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
export function validateDraft(d: ComposeDraft, hasFile = false): string | null {
  switch (d.tab) {
    case "REEL":
      if (!hasFile && !d.videoUrl.trim()) return "Drag a video file or paste a reel URL";
      break;
    case "PHOTO": {
      const n = photoUrls(d).length;
      if (n === 0) return "Add at least one image URL";
      if (n > MAX_CAROUSEL) return `Up to ${MAX_CAROUSEL} images`;
      break;
    }
    case "STORY":
      if (!hasFile && !d.imageUrl.trim() && !d.videoUrl.trim()) return "Drag a video file or add a URL";
      break;
  }
  if (d.caption.length > CAPTION_MAX) return `Caption exceeds ${CAPTION_MAX} characters`;
  if (parseList(d.collaborators).length > 3) return "Up to 3 collaborators";
  if (parseList(d.productTags).length > 5) return "Up to 5 product tags";
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
export function resolvedMediaType(d: ComposeDraft): PublishInput["media_type"] {
  if (d.tab === "REEL") return "REELS";
  if (d.tab === "STORY") return "STORIES";
  return photoUrls(d).length >= 2 ? "CAROUSEL" : "IMAGE";
}

/** Map the flat draft to the exact POST body. */
export function draftToPublishInput(d: ComposeDraft): PublishInput {
  const shared = sharedFields(d);

  if (d.tab === "REEL") {
    const input: PublishInput = { media_type: "REELS", ...shared };
    if (d.videoUrl.trim()) input.video_url = d.videoUrl.trim();
    if (d.coverUrl.trim()) input.cover_url = d.coverUrl.trim();
    const offset = parseInt(d.thumbOffset, 10);
    if (Number.isFinite(offset) && offset > 0) input.thumb_offset = offset;
    if (d.audioName.trim()) input.audio_name = d.audioName.trim();
    input.share_to_feed = d.shareToFeed;
    if (d.isTrial) input.trial_params = { graduation_strategy: d.graduationStrategy };
    return input;
  }

  if (d.tab === "STORY") {
    const input: PublishInput = { media_type: "STORIES", ...shared };
    if (d.videoUrl.trim()) input.video_url = d.videoUrl.trim();
    else if (d.imageUrl.trim()) input.image_url = d.imageUrl.trim();
    return input;
  }

  // PHOTO — carousel at 2+, single image otherwise.
  const urls = photoUrls(d);
  if (urls.length >= 2) {
    return { media_type: "CAROUSEL", children: urls.map((image_url) => ({ image_url })), ...shared };
  }
  const input: PublishInput = { media_type: "IMAGE", ...shared };
  if (urls[0]) input.image_url = urls[0];
  if (d.altText.trim()) input.alt_text = d.altText.trim();
  return input;
}
