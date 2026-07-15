/**
 * Upload a video to YouTube via the resumable videos.insert endpoint, sourcing
 * the bytes from the R2 object the browser already uploaded — the same hosting
 * layer the Instagram publish path uses, so the media never round-trips through
 * this server's disk. Server-side only.
 *
 * ── The private-draft reality (pre-audit) ──
 * An unverified Google Cloud project has every API-uploaded video FORCED to
 * `private`, regardless of the privacyStatus we send. We send "private" anyway so
 * behavior is identical before and after the one-time compliance audit; post-audit,
 * flipping this to "public"/"unlisted" is the only change needed.
 * Docs: https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits
 *
 * ── What makes a video a "Short" ──
 * There is no Shorts endpoint or flag — same videos.insert. YouTube classifies by
 * signal: vertical 9:16, ≤ 3 min, and #Shorts in the title/description. The client
 * validates the first two off the file; we guarantee the #Shorts signal here.
 * Docs: https://developers.google.com/youtube/v3/docs/videos/insert
 */

import { presignGet } from "@/lib/storage/r2";
import { getAccessToken, clearTokenCache } from "./oauth";
import type { YoutubePublishRequest, YoutubePublishResult } from "./publish-types";

const RESUMABLE_INIT_URL =
  "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status";

// People & Blogs — a safe default; the owner can recategorize in Studio.
const DEFAULT_CATEGORY_ID = "22";

export class YoutubeUploadError extends Error {
  readonly status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.name = "YoutubeUploadError";
    this.status = status;
  }
}

/** Ensure the #Shorts signal is present for a Short without duplicating it. */
function withShortsSignal(title: string, description: string): string {
  const hasSignal = /#shorts\b/i.test(title) || /#shorts\b/i.test(description);
  if (hasSignal) return description;
  return description ? `${description}\n\n#Shorts` : "#Shorts";
}

interface VideoResource {
  id?: string;
  status?: { privacyStatus?: string };
}

/**
 * Initiate the resumable session and stream the R2 object into it. Returns the
 * created video resource. Split out so a 401 can retry with a fresh token.
 */
async function insertOnce(
  req: YoutubePublishRequest,
  description: string
): Promise<VideoResource> {
  const accessToken = await getAccessToken();

  const metadata = {
    snippet: {
      title: req.title,
      description,
      categoryId: DEFAULT_CATEGORY_ID,
      ...(req.tags?.length ? { tags: req.tags } : {}),
    },
    status: {
      // Forced to private by Google pre-audit; explicit so post-audit is a 1-line change.
      privacyStatus: "private",
      selfDeclaredMadeForKids: false,
    },
  };

  // 1) Open a resumable session — Google replies with the upload URL in Location.
  const initRes = await fetch(RESUMABLE_INIT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": req.contentType,
      "X-Upload-Content-Length": String(req.size),
    },
    body: JSON.stringify(metadata),
    cache: "no-store",
  });

  if (initRes.status === 401) {
    clearTokenCache();
    throw new YoutubeUploadError("unauthorized", 401);
  }
  if (!initRes.ok) {
    const text = await initRes.text().catch(() => "");
    throw new YoutubeUploadError(
      `Could not start upload (${initRes.status}): ${text.slice(0, 300)}`,
      initRes.status === 403 ? 403 : 502
    );
  }

  const uploadUrl = initRes.headers.get("location");
  if (!uploadUrl) {
    throw new YoutubeUploadError("YouTube did not return a resumable upload URL", 502);
  }

  // 2) Stream the R2 object straight into the session in a single PUT. The known
  //    byte length lets us set Content-Length so the body is sent framed, not
  //    chunked (Google's resumable endpoint wants a length or a Content-Range).
  const source = await fetch(await presignGet(req.key), { cache: "no-store" });
  if (!source.ok || !source.body) {
    throw new YoutubeUploadError(`Could not read the uploaded source (${source.status})`, 502);
  }

  const putRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": req.contentType,
      "Content-Length": String(req.size),
    },
    body: source.body,
    // Required by undici when streaming a request body.
    // @ts-expect-error — `duplex` is valid at runtime but missing from the DOM lib types.
    duplex: "half",
    cache: "no-store",
  });

  if (putRes.status === 401) {
    clearTokenCache();
    throw new YoutubeUploadError("unauthorized", 401);
  }
  if (!putRes.ok) {
    const text = await putRes.text().catch(() => "");
    throw new YoutubeUploadError(
      `Upload failed (${putRes.status}): ${text.slice(0, 300)}`,
      502
    );
  }

  return (await putRes.json().catch(() => ({}))) as VideoResource;
}

export async function uploadVideoFromR2(
  req: YoutubePublishRequest
): Promise<YoutubePublishResult> {
  const description = req.isShort
    ? withShortsSignal(req.title, req.description ?? "")
    : req.description ?? "";

  let video: VideoResource;
  try {
    video = await insertOnce(req, description);
  } catch (err) {
    // One retry on an expired/revoked access token (cache already cleared).
    if (err instanceof YoutubeUploadError && err.status === 401) {
      video = await insertOnce(req, description);
    } else {
      throw err;
    }
  }

  const videoId = video.id;
  if (!videoId) {
    throw new YoutubeUploadError("Upload succeeded but no video id was returned", 502);
  }

  return {
    videoId,
    watchUrl: req.isShort
      ? `https://www.youtube.com/shorts/${videoId}`
      : `https://youtu.be/${videoId}`,
    studioUrl: `https://studio.youtube.com/video/${videoId}/edit`,
    privacyStatus: video.status?.privacyStatus ?? "private",
    title: req.title,
  };
}
