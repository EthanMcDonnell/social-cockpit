"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Automation } from "@/lib/db";

async function fetchAutomations(postId: string): Promise<Automation[]> {
  const res = await fetch(`/api/automations?post_id=${postId}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? "Failed to fetch automations");
  }
  return res.json();
}

export function useAutomations(postId: string | null) {
  return useQuery({
    queryKey: ["automations", postId],
    queryFn: () => fetchAutomations(postId!),
    enabled: !!postId,
    staleTime: 0,
  });
}

export function useCreateAutomation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: Omit<Automation, "id" | "created_at">) => {
      const res = await fetch("/api/automations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? "Failed to create automation");
      }
      return res.json() as Promise<Automation>;
    },
    onSuccess: (automation) => {
      queryClient.invalidateQueries({ queryKey: ["automations", automation.post_id] });
    },
  });
}

export function useUpdateAutomation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, postId, ...data }: Partial<Automation> & { id: string; postId: string }) => {
      const res = await fetch(`/api/automations/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? "Failed to update automation");
      }
      return { automation: await res.json() as Automation, postId };
    },
    onSuccess: ({ postId }) => {
      queryClient.invalidateQueries({ queryKey: ["automations", postId] });
    },
  });
}

export function useDeleteAutomation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, postId }: { id: string; postId: string }) => {
      const res = await fetch(`/api/automations/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? "Failed to delete automation");
      }
      return { postId };
    },
    onSuccess: ({ postId }) => {
      queryClient.invalidateQueries({ queryKey: ["automations", postId] });
    },
  });
}
