"use client";

import { useMutation } from "@tanstack/react-query";
import { stageFile } from "@/hooks/useSchedule";
import { draftToPublishInput, filledPhotoSlots, type ComposeDraft } from "./draft";
import type { PublishFiles } from "./usePublish";

/**
 * Schedule the current Compose draft instead of transmitting it now.
 *
 * The difference from `usePublish` is where the bytes go: that hook uploads
 * straight to R2 because the post is going out this second. Here the files are
 * streamed to local staging and stay on this machine until the slot arrives —
 * the scheduler uploads to R2 itself at publish time.
 */

export interface ScheduleDraftArgs {
  draft: ComposeDraft;
  files?: PublishFiles;
  /** Epoch ms. */
  scheduledAt: number;
  onProgress?: (fraction: number) => void;
}

export interface ScheduleDraftResult {
  id: string;
  scheduled_at: number;
}

interface StagedRef {
  role: "video" | "image" | "cover" | "child";
  staged_id: string;
  index?: number;
}

export function useScheduleDraft() {
  return useMutation<ScheduleDraftResult, Error, ScheduleDraftArgs>({
    mutationFn: async ({ draft, files, scheduledAt, onProgress }) => {
      // Report one aggregate progress figure across every file, so the button
      // can show a single percentage rather than a race between uploads.
      const queue: { role: StagedRef["role"]; file: File; index?: number }[] = [];
      if (files?.video) queue.push({ role: "video", file: files.video });
      if (files?.image) queue.push({ role: "image", file: files.image });
      if (files?.cover) queue.push({ role: "cover", file: files.cover });

      const isYoutube = draft.platform === "yt";
      const photoSlots = isYoutube ? [] : filledPhotoSlots(draft, files?.photos ?? []);
      photoSlots.forEach((slot, i) => {
        if (slot.file) queue.push({ role: "child", file: slot.file, index: i });
      });

      const done = new Array(queue.length).fill(0);
      const report = () =>
        onProgress?.(queue.length ? done.reduce((a, b) => a + b, 0) / queue.length : 1);

      const media: StagedRef[] = [];
      for (let i = 0; i < queue.length; i++) {
        const entry = queue[i];
        const staged = await stageFile(entry.file, (f) => {
          done[i] = f;
          report();
        });
        done[i] = 1;
        report();
        media.push({ role: entry.role, staged_id: staged.id, index: entry.index });
      }

      // A single photo isn't a carousel child — collapse it back to the image slot.
      const childCount = media.filter((m) => m.role === "child").length;
      if (childCount === 1) {
        const only = media.find((m) => m.role === "child")!;
        only.role = "image";
        delete only.index;
      }

      const body = isYoutube
        ? {
            platform: "yt" as const,
            title: draft.title,
            description: draft.caption,
            isShort: draft.tab === "SHORT",
          }
        : { platform: "ig" as const, ...draftToPublishInput(draft, files?.photos ?? []) };

      const res = await fetch("/api/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, scheduled_at: scheduledAt, media }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message ?? "Could not schedule this post.");

      return { id: data.job.id, scheduled_at: data.job.scheduled_at };
    },
  });
}
