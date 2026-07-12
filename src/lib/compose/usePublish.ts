"use client";

import { useMutation } from "@tanstack/react-query";
import type { PublishInput } from "@/lib/instagram/endpoints/publish";

export interface PublishOutcome {
  container_id: string;
  media_id?: string;
  permalink?: string;
  published: boolean;
}

const JSON_HEADERS = { "Content-Type": "application/json" };
const POLL_INTERVAL_MS = 3_000;
const POLL_MAX_ATTEMPTS = 40; // ~2 min

async function postJSON(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return { res, data } as { res: Response; data: Record<string, unknown> };
}

async function pollUntilFinished(containerId: string): Promise<void> {
  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const res = await fetch(`/api/publish?container_id=${encodeURIComponent(containerId)}`);
    const data = (await res.json().catch(() => ({}))) as { status_code?: string; message?: string };
    if (data.status_code === "FINISHED" || data.status_code === "PUBLISHED") return;
    if (data.status_code === "ERROR" || data.status_code === "EXPIRED") {
      throw new Error(`Instagram couldn't process this media (${data.status_code}).`);
    }
  }
  throw new Error(
    "Still processing after 2 minutes — the container was created; try finalizing it shortly."
  );
}

function extOf(file: File): string {
  const dot = file.name.lastIndexOf(".");
  return dot >= 0 ? file.name.slice(dot + 1) : "";
}

/**
 * Upload a local file straight to R2 (sign, then PUT the bytes directly — this
 * server never sees them) and return the object key. See docs/r2-integration.md.
 */
async function uploadToR2(file: File): Promise<string> {
  const contentType = file.type || "application/octet-stream";
  const { res, data } = await postJSON("/api/publish/r2-sign", {
    contentType,
    size: file.size,
    ext: extOf(file),
  });
  if (!res.ok) throw new Error((data.message as string) ?? "Could not start upload");

  const { key, uploadUrl } = data as { key: string; uploadUrl: string };
  const put = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: file,
  });
  if (!put.ok) throw new Error(`Upload to storage failed (${put.status})`);
  return key;
}

/** Local files from the Compose Studio UI, uploaded straight to R2 before publish. */
export interface PublishFiles {
  /** Reel video, or a Story video. */
  video?: File;
  /** Story image (photo story). */
  image?: File;
  /** Reel cover image. */
  cover?: File;
  /** Photo tab — index-aligned with the slots `draftToPublishInput` used to build children/image_url. */
  photos?: (File | null)[];
}

export interface PublishArgs {
  input: PublishInput;
  files?: PublishFiles;
}

/**
 * Runs the full publish flow from the client. Local files are uploaded straight to
 * R2 and referenced by object key in an `r2` map on the /api/publish body; pasted
 * URLs go through unchanged. On a 202 (still processing) it polls status then
 * POSTs /api/publish/finalize.
 */
export function usePublish() {
  return useMutation<PublishOutcome, Error, PublishArgs>({
    mutationFn: async ({ input, files }) => {
      const r2: { video_url?: string; image_url?: string; cover_url?: string; children?: (string | null)[] } = {};

      if (files?.video) r2.video_url = await uploadToR2(files.video);
      if (files?.image) r2.image_url = await uploadToR2(files.image);
      if (files?.cover) r2.cover_url = await uploadToR2(files.cover);

      const photoFiles = files?.photos ?? [];
      if (photoFiles.some(Boolean)) {
        const keys = await Promise.all(photoFiles.map((f) => (f ? uploadToR2(f) : Promise.resolve(null))));
        if (input.media_type === "CAROUSEL") {
          r2.children = keys;
        } else {
          const key = keys.find((k): k is string => !!k);
          if (key) r2.image_url = key;
        }
      }

      const body = Object.keys(r2).length ? { ...input, r2 } : input;
      const { res, data } = await postJSON("/api/publish", body);

      // Hard failure (not the 202 "still processing" case).
      if (!res.ok && res.status !== 202) {
        throw new Error((data.message as string) ?? "Publish failed");
      }

      if (data.published) return data as unknown as PublishOutcome;

      // 202 — created but still processing. Poll, then finalize.
      const containerId = data.container_id as string;
      await pollUntilFinished(containerId);

      // On a 202, /api/publish left our uploaded R2 objects in place (Instagram
      // may still have been fetching them). Hand their keys to finalize so it
      // reclaims them now that the container is FINISHED.
      const r2Keys = [r2.video_url, r2.cover_url, r2.image_url, ...(r2.children ?? [])].filter(
        (k): k is string => !!k
      );
      const fin = await postJSON("/api/publish/finalize", {
        creation_id: containerId,
        r2_keys: r2Keys,
      });
      if (!fin.res.ok) throw new Error((fin.data.message as string) ?? "Finalize failed");
      return fin.data as unknown as PublishOutcome;
    },
  });
}
