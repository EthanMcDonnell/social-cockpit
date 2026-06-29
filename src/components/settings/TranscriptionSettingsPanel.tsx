"use client";

import { Card } from "@/components/ui/Card";
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

        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          disabled={busy}
          onClick={() => setEnabled.mutate(!enabled)}
          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors disabled:cursor-default disabled:opacity-50 ${
            enabled ? "bg-[var(--accent-cyan)]" : "bg-[var(--border)]"
          }`}
        >
          <span
            aria-hidden="true"
            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ease-in-out ${
              enabled ? "translate-x-5" : "translate-x-0"
            }`}
          />
        </button>
      </div>
      {setEnabled.isError && (
        <p className="px-5 pb-4 text-xs text-[var(--accent-red)]">
          Failed to update setting.
        </p>
      )}
    </Card>
  );
}
