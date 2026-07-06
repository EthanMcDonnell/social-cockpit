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

export interface PublishArgs {
  input: PublishInput;
  /** When present, publishes via resumable local-file upload (Reels/Stories). */
  file?: File;
}

/**
 * Runs the full publish flow from the client. With a file it POSTs multipart to
 * /api/publish/upload (resumable); otherwise JSON to /api/publish. On a 202
 * (still processing) it polls status then POSTs /api/publish/finalize.
 */
export function usePublish() {
  return useMutation<PublishOutcome, Error, PublishArgs>({
    mutationFn: async ({ input, file }) => {
      let res: Response;
      let data: Record<string, unknown>;

      if (file) {
        const form = new FormData();
        form.append("file", file);
        form.append("payload", JSON.stringify(input));
        // No Content-Type header — the browser sets the multipart boundary.
        res = await fetch("/api/publish/upload", { method: "POST", body: form });
        data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      } else {
        ({ res, data } = await postJSON("/api/publish", input));
      }

      // Hard failure (not the 202 "still processing" case).
      if (!res.ok && res.status !== 202) {
        throw new Error((data.message as string) ?? "Publish failed");
      }

      if (data.published) return data as unknown as PublishOutcome;

      // 202 — created but still processing. Poll, then finalize.
      const containerId = data.container_id as string;
      await pollUntilFinished(containerId);

      const fin = await postJSON("/api/publish/finalize", { creation_id: containerId });
      if (!fin.res.ok) throw new Error((fin.data.message as string) ?? "Finalize failed");
      return fin.data as unknown as PublishOutcome;
    },
  });
}
