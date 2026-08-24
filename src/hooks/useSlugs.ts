"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
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
      asJson<{ slug: SlugSummary }>(
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
      asJson<{ slug: SlugSummary }>(
        await fetch(`/api/slugs/${encodeURIComponent(slug)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        })
      ),
    onSuccess: (_data, vars) => invalidate(vars.slug),
  });
}

export function useDeleteSlug() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (slug: string) =>
      asJson<{ deleted: string }>(
        await fetch(`/api/slugs/${encodeURIComponent(slug)}`, { method: "DELETE" })
      ),
    onSuccess: (_data, slug) => invalidate(slug),
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
