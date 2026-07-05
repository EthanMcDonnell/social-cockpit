"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { AutomationFlow, AutomationConfig, AutomationTemplateType } from "@/lib/db";

const QUERY_KEY = ["automation-flows"];

async function fetchFlows(): Promise<AutomationFlow[]> {
  const res = await fetch("/api/automation-flows");
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? "Failed to fetch flows");
  }
  return res.json();
}

export function useAutomationFlows() {
  return useQuery({ queryKey: QUERY_KEY, queryFn: fetchFlows, staleTime: 0 });
}

export function useCreateFlow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      name: string;
      trigger_keywords: string[];
      config: AutomationConfig;
      media_id?: string;
      media_ids?: string[];
      template_type?: AutomationTemplateType;
    }) => {
      const res = await fetch("/api/automation-flows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? "Failed to create flow");
      }
      return res.json() as Promise<AutomationFlow>;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}

export function useUpdateFlow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...data
    }: Partial<AutomationFlow> & { id: string }) => {
      const res = await fetch(`/api/automation-flows/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? "Failed to update flow");
      }
      return res.json() as Promise<AutomationFlow>;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}

export function useDeleteFlow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/automation-flows/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? "Failed to delete flow");
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}
