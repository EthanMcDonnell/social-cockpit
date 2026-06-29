"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

async function fetchEnabled(): Promise<boolean> {
  const res = await fetch("/api/settings/transcription");
  if (!res.ok) throw new Error("Failed to load transcription setting");
  const body = await res.json();
  return !!body.enabled;
}

export function useTranscriptionSetting() {
  return useQuery({
    queryKey: ["settings", "transcription"],
    queryFn: fetchEnabled,
    staleTime: 5 * 60 * 1000,
  });
}

export function useSetTranscriptionEnabled() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (enabled: boolean): Promise<boolean> => {
      const res = await fetch("/api/settings/transcription", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new Error("Failed to update setting");
      const body = await res.json();
      return !!body.enabled;
    },
    onSuccess: (enabled) => {
      queryClient.setQueryData(["settings", "transcription"], enabled);
    },
  });
}
