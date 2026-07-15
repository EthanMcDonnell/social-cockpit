"use client";

import { useEffect, useState } from "react";
import type { VideoProbe } from "./draft";

/**
 * Read a dropped video's intrinsic dimensions and duration in the browser, so
 * Compose can validate the Shorts signals (vertical 9:16, ≤ 3 min) before letting
 * the user publish. Returns null until metadata has loaded, or if the file isn't a
 * video. Uses a detached <video> element pointed at an object URL — no bytes are
 * uploaded to probe.
 */
export function useVideoProbe(file: File | null): VideoProbe | null {
  const [probe, setProbe] = useState<VideoProbe | null>(null);

  useEffect(() => {
    setProbe(null);
    if (!file || !file.type.startsWith("video/")) return;

    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;

    const onLoaded = () => {
      setProbe({
        width: video.videoWidth,
        height: video.videoHeight,
        durationSeconds: Number.isFinite(video.duration) ? video.duration : 0,
      });
    };
    video.addEventListener("loadedmetadata", onLoaded);
    video.src = url;

    return () => {
      video.removeEventListener("loadedmetadata", onLoaded);
      video.src = "";
      URL.revokeObjectURL(url);
    };
  }, [file]);

  return probe;
}
