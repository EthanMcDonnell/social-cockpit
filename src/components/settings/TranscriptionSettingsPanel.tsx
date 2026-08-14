"use client";

import { Card } from "@/components/ui/Card";
import { Toggle } from "./Toggle";
import {
  useTranscriptionSetting,
  useSetTranscriptionEnabled,
} from "@/hooks/useTranscriptionSetting";

export function TranscriptionSettingsPanel() {
  const settingQuery = useTranscriptionSetting();
  const setEnabled = useSetTranscriptionEnabled();

  const enabled = settingQuery.data === true;
  const busy = settingQuery.isLoading || setEnabled.isPending;

  return (
    <Card padding="none">
      <div className="flex items-center justify-between gap-4 p-5">
        <div className="space-y-1">
          <p className="text-sm font-medium text-[var(--text-primary)]">
            Video transcription
          </p>
          <p className="text-xs text-[var(--text-muted)] leading-relaxed">
            Adds a transcript section to each video/reel in Posts, generated once
            with faster-whisper and cached. Off by default.
          </p>
        </div>

        <Toggle
          checked={enabled}
          onChange={(next) => setEnabled.mutate(next)}
          disabled={busy}
          label="Video transcription"
        />
      </div>
      {setEnabled.isError && (
        <p className="px-5 pb-4 text-xs text-[var(--accent-red)]">
          Failed to update setting.
        </p>
      )}
    </Card>
  );
}
