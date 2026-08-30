/**
 * Wire types for the video archive.
 *
 * `import type` only, so this module is erased at runtime and can be pulled into
 * the browser bundle without dragging better-sqlite3 along (same discipline as
 * src/lib/schedule/types.ts and src/lib/slugs/types.ts).
 */

/** A video this app has published, preserved so it stays repostable. */
export interface ArchivedVideo {
  id: string;
  /**
   * The archive's real identity. Two publishes of the same bytes from different
   * directories are one archived video, so a clip cannot get two turns in the
   * repost rotation by being copied around the user's disk.
   */
  sha256: string;
  /** Absolute path of the copy inside the archive directory. */
  path: string;
  /** Where it was published from, for display. May no longer exist. */
  source_path?: string;
  size_bytes: number;
  content_type: string;
  label?: string;
  /** The slug it was first published under — the repost opt-in is read here. */
  origin_slug?: string;
  created_at: string;
}

export interface ArchiveUsage {
  used: number;
  cap: number;
  count: number;
}
