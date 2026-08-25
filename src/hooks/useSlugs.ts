"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  Slug,
  SelectionMethod,
  SlugDetail,
  SlugSelection,
  SlugSelectionFailure,
  SlugSummary,
  SlugVideoPayload,
  SlugVideoView,
} from "@/lib/slugs/types";
import type { SchedulePlatform } from "@/lib/schedule/types";

const LIST_KEY = ["slugs"];

interface SlugListResponse {
  default_selection: SelectionMethod;
  methods: SelectionMethod[];
  slugs: SlugSummary[];
}

export interface SlugDetailResponse {
  slug: SlugDetail;
  effective_method: SelectionMethod;
  /** What would go out if this slug fired right now. */
  next_up: SlugSelection | null;
  /** Why nothing would, when nothing would. */
  blocked: SlugSelectionFailure | null;
}

async function asJson<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((body as { message?: string }).message ?? `Request failed (${res.status})`);
  }
  return body as T;
}

// ─── Reads ───────────────────────────────────────────────────────────────────

export function useSlugs() {
  return useQuery({
    queryKey: LIST_KEY,
    queryFn: async () => asJson<SlugListResponse>(await fetch("/api/slugs")),
    staleTime: 30_000,
  });
}

/**
 * One pool, scored, with the pick it would make right now.
 *
 * Keyed by platform because eligibility and therefore the pick differ per
 * platform — the same pool can be three deep on YouTube and empty on Instagram.
 */
export function useSlugDetail(slug: string | null, platform: SchedulePlatform = "ig") {
  return useQuery({
    queryKey: ["slug", slug, platform],
    enabled: !!slug,
    queryFn: async () =>
      asJson<SlugDetailResponse>(await fetch(`/api/slugs/${encodeURIComponent(slug!)}?platform=${platform}`)),
    // Metrics move under the app's feet; a stale preview is a misleading one.
    staleTime: 60_000,
  });
}

// ─── Writes ──────────────────────────────────────────────────────────────────

function useInvalidate() {
  const client = useQueryClient();
  return (slug?: string) => {
    client.invalidateQueries({ queryKey: LIST_KEY });
    if (slug) client.invalidateQueries({ queryKey: ["slug", slug] });
    // A pool change moves what every booked slug job would pick.
    client.invalidateQueries({ queryKey: ["schedule-jobs"] });
  };
}

export function useCreateSlug() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (body: { slug: string; name?: string; selection_method?: SelectionMethod }) =>
      asJson<{ slug: Slug }>(
        await fetch("/api/slugs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
      ),
    onSuccess: (data) => invalidate(data.slug?.slug),
  });
}

export function useUpdateSlug() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async ({
      slug,
      ...patch
    }: {
      slug: string;
      name?: string | null;
      selection_method?: SelectionMethod | null;
    }) =>
      asJson<{ slug: Slug }>(
        await fetch(`/api/slugs/${encodeURIComponent(slug)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        })
      ),
    onSuccess: (_data, vars) => invalidate(vars.slug),
  });
}

/**
 * Delete a slug, or just empty its pool.
 *
 * A slug an automation flow fires on cannot be deleted — it is that flow's
 * identity — so the page offers clearing the pool instead, which is the part it
 * owns.
 */
export function useDeleteSlug() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async ({ slug, poolOnly }: { slug: string; poolOnly?: boolean }) =>
      asJson<{ deleted?: string; cleared?: number }>(
        await fetch(
          `/api/slugs/${encodeURIComponent(slug)}${poolOnly ? "?pool=1" : ""}`,
          { method: "DELETE" }
        )
      ),
    onSuccess: (_data, vars) => invalidate(vars.slug),
  });
}

export function useAddSlugVideo() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async ({
      slug,
      ...body
    }: {
      slug: string;
      path: string;
      label?: string;
      payload?: SlugVideoPayload;
    }) =>
      asJson<{ video: SlugVideoView }>(
        await fetch(`/api/slugs/${encodeURIComponent(slug)}/videos`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
      ),
    onSuccess: (_data, vars) => invalidate(vars.slug),
  });
}

/**
 * Edit a candidate's label and payload defaults.
 *
 * The defaults matter most for a video added by hand: a slug job that carries
 * no caption of its own falls back to the candidate's, and without one the post
 * goes out blank.
 */
export function useUpdateSlugVideo() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async ({
      slug,
      id,
      ...patch
    }: {
      slug: string;
      id: string;
      label?: string | null;
      payload?: SlugVideoPayload;
    }) =>
      asJson<{ video: SlugVideoView }>(
        await fetch(`/api/slugs/${encodeURIComponent(slug)}/videos/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        })
      ),
    onSuccess: (_data, vars) => invalidate(vars.slug),
  });
}

export function useRemoveSlugVideo() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async ({ slug, id }: { slug: string; id: string }) =>
      asJson<{ deleted: string }>(
        await fetch(`/api/slugs/${encodeURIComponent(slug)}/videos/${id}`, { method: "DELETE" })
      ),
    onSuccess: (_data, vars) => invalidate(vars.slug),
  });
}
