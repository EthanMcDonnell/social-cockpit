"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ScheduledPostView,
  ScheduleStatus,
  SchedulePlatform,
} from "@/lib/schedule/types";

const JOBS_KEY = "schedule-jobs";
const SETTINGS_KEY = ["schedule-settings"];

export interface ScheduleWindow {
  from: number;
  to: number;
}

interface JobsResponse {
  timezone: string;
  jobs: ScheduledPostView[];
}

export interface ScheduleSettings {
  timezone: string;
  abbreviation: string;
  /** Effective state: what the worker will actually do right now. */
  scheduler_enabled: boolean;
  dry_run: boolean;
  /** The .env half of the two flags above, which the UI cannot change. */
  scheduler_env_enabled: boolean;
  dry_run_env: boolean;
  /** The stored half, which it can. */
  paused: boolean;
  dry_run_stored: boolean;
  suggested_times: string[];
  max_posts_per_day: number;
}

/** The subset a client may write. Everything else on the payload is read-only. */
export type ScheduleSettingsPatch = Partial<{
  timezone: string;
  suggested_times: string[];
  max_posts_per_day: number;
  paused: boolean;
  dry_run: boolean;
}>;

async function asJson<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((body as { message?: string }).message ?? `Request failed (${res.status})`);
  }
  return body as T;
}

// ─── Reads ───────────────────────────────────────────────────────────────────

/**
 * Jobs in the visible window. Keyed by the window so paging between weeks hits
 * cache on the way back, and `placeholderData` keeps the previous week's cards
 * on screen while the next loads — the grid never blanks out mid-navigation.
 */
export function useScheduledPosts(window: ScheduleWindow) {
  return useQuery({
    queryKey: [JOBS_KEY, window.from, window.to],
    queryFn: async () => {
      const params = new URLSearchParams({
        from: String(window.from),
        to: String(window.to),
      });
      return asJson<JobsResponse>(await fetch(`/api/schedule?${params}`));
    },
    placeholderData: (prev) => prev,
    // A publishing job changes state without any user action, so the grid needs
    // to notice on its own. Matches the worker's 30s cadence.
    refetchInterval: 30_000,
  });
}

export interface PublishedEntry {
  id: string;
  platform: "ig";
  published_at: number;
  title: string;
  media_type: string;
  permalink?: string;
}

/**
 * Posts that already went out, for the history overlay. Served from the local
 * media cache, so it's free — but only worth fetching when the overlay is on.
 */
export function usePublishedHistory(window: ScheduleWindow, enabled: boolean) {
  return useQuery({
    queryKey: ["schedule-history", window.from, window.to],
    enabled,
    queryFn: async () => {
      const params = new URLSearchParams({
        from: String(window.from),
        to: String(window.to),
      });
      const data = await asJson<{ posts: PublishedEntry[] }>(
        await fetch(`/api/schedule/history?${params}`)
      );
      return data.posts;
    },
    placeholderData: (prev) => prev,
    staleTime: 5 * 60_000,
  });
}

export function useScheduleSettings() {
  return useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: async () => asJson<ScheduleSettings>(await fetch("/api/schedule/settings")),
    staleTime: 5 * 60_000,
  });
}

/**
 * Write any subset of the editable settings.
 *
 * The API only touches keys that are present, so a panel can send one field
 * without echoing the rest back and clobbering a concurrent edit. Jobs are
 * invalidated on success because timezone and cadence both change how existing
 * slots are rendered.
 */
export function useUpdateScheduleSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: ScheduleSettingsPatch) =>
      asJson<ScheduleSettings>(
        await fetch("/api/schedule/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        })
      ),
    onSuccess: (data) => {
      qc.setQueryData(SETTINGS_KEY, data);
      qc.invalidateQueries({ queryKey: [JOBS_KEY] });
    },
  });
}

/** Timezone-only convenience wrapper, kept for the calendar's zone picker. */
export function useSetTimeZone() {
  const update = useUpdateScheduleSettings();
  return { ...update, mutate: (timezone: string) => update.mutate({ timezone }) };
}

// ─── Writes ──────────────────────────────────────────────────────────────────

/**
 * Rewrite every cached window in place. Drag-and-drop must feel instant, so the
 * card moves on `onMutate` and only snaps back if the server rejects it — a
 * round trip before the card moves is exactly the jank we're avoiding.
 */
function patchCachedJob(
  qc: ReturnType<typeof useQueryClient>,
  id: string,
  patch: Partial<ScheduledPostView>
) {
  qc.setQueriesData<JobsResponse>({ queryKey: [JOBS_KEY] }, (old) =>
    old
      ? { ...old, jobs: old.jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)) }
      : old
  );
}

export interface UpdateJobArgs {
  id: string;
  scheduled_at?: number;
  status?: ScheduleStatus;
  payload?: Record<string, unknown>;
  automation?: unknown;
  grace_minutes?: number;
}

export function useUpdateScheduledPost() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...body }: UpdateJobArgs) =>
      asJson<{ job: ScheduledPostView }>(
        await fetch(`/api/schedule/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
      ),

    onMutate: async ({ id, scheduled_at, status }) => {
      await qc.cancelQueries({ queryKey: [JOBS_KEY] });
      const snapshot = qc.getQueriesData<JobsResponse>({ queryKey: [JOBS_KEY] });
      const patch: Partial<ScheduledPostView> = {};
      if (scheduled_at != null) patch.scheduled_at = scheduled_at;
      if (status) patch.status = status;
      if (Object.keys(patch).length) patchCachedJob(qc, id, patch);
      return { snapshot };
    },

    onError: (_err, _vars, context) => {
      // Put every window back exactly as it was — the drop was refused.
      context?.snapshot.forEach(([key, data]) => qc.setQueryData(key, data));
    },

    onSettled: () => qc.invalidateQueries({ queryKey: [JOBS_KEY] }),
  });
}

export function useCancelScheduledPost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      asJson<{ ok: boolean }>(await fetch(`/api/schedule/${id}`, { method: "DELETE" })),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: [JOBS_KEY] });
      const snapshot = qc.getQueriesData<JobsResponse>({ queryKey: [JOBS_KEY] });
      qc.setQueriesData<JobsResponse>({ queryKey: [JOBS_KEY] }, (old) =>
        old ? { ...old, jobs: old.jobs.filter((j) => j.id !== id) } : old
      );
      return { snapshot };
    },
    onError: (_e, _v, context) =>
      context?.snapshot.forEach(([key, data]) => qc.setQueryData(key, data)),
    onSettled: () => qc.invalidateQueries({ queryKey: [JOBS_KEY] }),
  });
}

export function useRunScheduledPost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      asJson<{ job: ScheduledPostView }>(
        await fetch(`/api/schedule/${id}/run`, { method: "POST" })
      ),
    onMutate: async (id) => {
      patchCachedJob(qc, id, { status: "publishing" });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: [JOBS_KEY] }),
  });
}

export interface CreateJobArgs {
  scheduled_at: number;
  platform: SchedulePlatform;
  media?: { role: string; staged_id: string; index?: number }[];
  automation?: unknown;
  [key: string]: unknown;
}

export function useCreateScheduledPost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateJobArgs) =>
      asJson<{ job: ScheduledPostView }>(
        await fetch("/api/schedule", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: [JOBS_KEY] }),
  });
}

// ─── Staging ─────────────────────────────────────────────────────────────────

export interface StagedUpload {
  id: string;
  size_bytes: number;
  content_type: string;
}

/**
 * Stream a dropped file to local staging. Deliberately not an R2 upload: the
 * bytes stay on this machine until the scheduled slot arrives.
 *
 * XHR rather than fetch, purely for `upload.onprogress` — a large video needs a
 * progress ring or the card looks frozen.
 */
export function stageFile(
  file: File,
  onProgress?: (fraction: number) => void
): Promise<StagedUpload> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/schedule/media?filename=${encodeURIComponent(file.name)}`);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      let body: { message?: string } = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* keep the status-code message */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as unknown as StagedUpload);
      else reject(new Error(body.message ?? `Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Upload failed — is the server still running?"));
    xhr.send(file);
  });
}
