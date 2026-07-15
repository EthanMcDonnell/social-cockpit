"use client";

import { useMutation } from "@tanstack/react-query";
import { uploadToR2Detailed } from "./r2-upload";
import type {
  YoutubePublishRequest,
  YoutubePublishResult,
} from "@/lib/youtube/publish-types";

export interface YoutubePublishArgs {
  file: File;
  title: string;
  description?: string;
  isShort: boolean;
  tags?: string[];
}

/**
 * Publish flow for YouTube: upload the local video straight to R2 (shared with
 * the Instagram path), then POST its key to /api/youtube/publish, which streams
 * it into videos.insert. Pre-audit the result lands as a private draft.
 */
export function useYoutubePublish() {
  return useMutation<YoutubePublishResult, Error, YoutubePublishArgs>({
    mutationFn: async ({ file, title, description, isShort, tags }) => {
      const { key, contentType, size } = await uploadToR2Detailed(file);

      const reqBody: YoutubePublishRequest = {
        key,
        size,
        contentType,
        title: title.trim(),
        description: description?.trim() || undefined,
        isShort,
        tags,
      };

      const res = await fetch("/api/youtube/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reqBody),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error((data.message as string) ?? "YouTube upload failed");
      return data as unknown as YoutubePublishResult;
    },
  });
}
