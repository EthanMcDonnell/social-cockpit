/**
 * Wire types shared between the client publish hook and the /api/youtube/publish
 * route. Client-safe — no server-only imports, so it can be pulled into the
 * browser bundle.
 */

export interface YoutubePublishRequest {
  /** R2 object key of the already-uploaded source (see docs/r2-integration.md). */
  key: string;
  /** Byte length of the object — the resumable PUT's Content-Length. */
  size: number;
  /** MIME type of the source, e.g. "video/mp4". */
  contentType: string;
  title: string;
  description?: string;
  /** Short intent: appends the #Shorts signal when absent from title/description. */
  isShort: boolean;
  tags?: string[];
}

export interface YoutubePublishResult {
  videoId: string;
  /** youtube.com/shorts/… or youtu.be/… depending on isShort. */
  watchUrl: string;
  /** studio.youtube.com edit page — where the owner flips visibility public. */
  studioUrl: string;
  /** Actual visibility. Pre-audit this is always "private" (Google forces it). */
  privacyStatus: string;
  title: string;
}
