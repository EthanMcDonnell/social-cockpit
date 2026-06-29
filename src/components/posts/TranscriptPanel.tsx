"use client";

import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { useTranscript } from "@/hooks/useTranscript";
import { useTranscriptionSetting } from "@/hooks/useTranscriptionSetting";

interface TranscriptPanelProps {
  mediaId: string;
  mediaType: string;
}

export function TranscriptPanel({ mediaId, mediaType }: TranscriptPanelProps) {
  const settingQuery = useTranscriptionSetting();
  const enabled = settingQuery.data === true;
  const isVideo = mediaType === "VIDEO" || mediaType === "REEL";

  const transcriptQuery = useTranscript(mediaId, enabled && isVideo);
  const [copied, setCopied] = useState(false);

  // Feature off app-wide, or not a transcribable post → render nothing.
  if (!enabled || !isVideo) return null;

  const transcript = transcriptQuery.data;

  async function handleCopy() {
    if (!transcript?.text) return;
    await navigator.clipboard.writeText(transcript.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Card padding="none">
      <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
        <p className="text-xs uppercase tracking-widest text-[var(--text-muted)] font-medium">
          Transcript
        </p>
        {transcript && (
          <button
            onClick={handleCopy}
            className="text-[11px] text-[var(--text-muted)] hover:text-[var(--accent-cyan)] transition-colors"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        )}
      </div>

      <div className="p-5">
        {transcriptQuery.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-3 w-full" />
            ))}
          </div>
        ) : transcript ? (
          <div className="space-y-3">
            <p className="text-sm leading-relaxed text-[var(--text-primary)] whitespace-pre-wrap">
              {transcript.text || (
                <span className="italic text-[var(--text-muted)]">
                  No speech detected in this video.
                </span>
              )}
            </p>
            <p className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
              {transcript.model}
              {transcript.language ? ` · ${transcript.language}` : ""}
              {transcript.duration ? ` · ${Math.round(transcript.duration)}s` : ""}
            </p>
          </div>
        ) : (
          <div className="flex items-center gap-2.5 text-sm text-[var(--text-muted)]">
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
            Queued for transcription… this runs once in the background and is
            then saved.
          </div>
        )}
      </div>
    </Card>
  );
}
