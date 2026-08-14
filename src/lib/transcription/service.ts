import { execFile } from "child_process";
import { config } from "@/lib/config";
import { getSetting, setSetting } from "@/lib/settings";
import { promisify } from "util";
import fs from "fs";
import os from "os";
import path from "path";
import {
  getTranscriptsDb,
  rowToTranscript,
  type Transcript,
  type TranscriptRow,
  type TranscriptSummary,
} from "./db";

// How many leading characters of a transcript to include as a list preview.
const PREVIEW_CHARS = 200;

const execFileAsync = promisify(execFile);

const SETTING_ENABLED = "transcription_enabled";

// Per-media in-process lock so two concurrent requests for the same video
// don't both spawn a (slow, expensive) transcription pass.
const inFlight = new Map<string, Promise<Transcript>>();

// ─── App-wide toggle (default OFF) ──────────────────────────────────────────

/**
 * This toggle used to live in a second `app_settings` table inside
 * `transcripts.db` — same name and same shape as the real one in
 * `automations.db`, so nothing could tell you which file held a given key.
 *
 * It reads through to the old location when the new one has no row, rather than
 * copying on upgrade. A migration that moves data has to run, can half-run, and
 * has to be undone if you roll back; a fallback read has none of those
 * properties. The first write lands in the new table and the fallback goes
 * quiet, and the legacy row is deliberately left where it is so an older build
 * still finds it.
 */
export function isTranscriptionEnabled(): boolean {
  const stored = getSetting(SETTING_ENABLED);
  if (stored !== null) return stored === "1";

  const legacy = getTranscriptsDb()
    .prepare("SELECT value FROM app_settings WHERE key = ?")
    .get(SETTING_ENABLED) as { value: string } | undefined;
  return legacy?.value === "1";
}

export function setTranscriptionEnabled(enabled: boolean): void {
  setSetting(SETTING_ENABLED, enabled ? "1" : "0");
}

// ─── Cache lookup ────────────────────────────────────────────────────────────

export function getTranscript(mediaId: string): Transcript | null {
  const row = getTranscriptsDb()
    .prepare("SELECT * FROM transcripts WHERE media_id = ?")
    .get(mediaId) as TranscriptRow | undefined;
  return row ? rowToTranscript(row) : null;
}

// Batch-fetch lightweight summaries for a set of media IDs in a single query.
// `text` is truncated and counted in SQL, so full transcripts are never loaded.
export function getTranscriptSummaries(
  mediaIds: string[]
): Map<string, TranscriptSummary> {
  const result = new Map<string, TranscriptSummary>();
  if (mediaIds.length === 0) return result;

  const placeholders = mediaIds.map(() => "?").join(",");
  const rows = getTranscriptsDb()
    .prepare(
      `SELECT media_id,
              language,
              duration,
              model,
              created_at,
              length(text)       AS char_count,
              substr(text, 1, ?) AS preview
         FROM transcripts
        WHERE media_id IN (${placeholders})`
    )
    .all(PREVIEW_CHARS, ...mediaIds) as {
    media_id: string;
    language: string | null;
    duration: number | null;
    model: string;
    created_at: string;
    char_count: number;
    preview: string;
  }[];

  for (const r of rows) {
    result.set(r.media_id, {
      mediaId: r.media_id,
      language: r.language,
      duration: r.duration,
      model: r.model,
      charCount: r.char_count,
      preview: r.preview,
      createdAt: r.created_at,
    });
  }
  return result;
}

// ─── Python interpreter / model resolution ──────────────────────────────────

// The Python interpreter (with faster-whisper installed) must be supplied
// explicitly via TRANSCRIPTION_PYTHON. When it's absent, transcription is
// treated as not configured and simply does not run — we never fall back to a
// system python that wouldn't have the deps.
function resolvePython(): string | null {
  return config.transcription.python ?? null;
}

export function isTranscriptionConfigured(): boolean {
  return !!config.transcription.python;
}

function resolveModel(): string {
  return config.transcription.model;
}

interface ScriptOutput {
  text?: string;
  language?: string | null;
  duration?: number | null;
  model?: string;
  segments?: { start: number; end: number; text: string }[];
  error?: string;
}

// ─── Run transcription (once) and persist ────────────────────────────────────

export async function runTranscription(
  mediaId: string,
  videoUrl: string
): Promise<Transcript> {
  // Already cached → return immediately (transcribe-once guarantee).
  const cached = getTranscript(mediaId);
  if (cached) return cached;

  const python = resolvePython();
  if (!python) {
    throw new Error(
      "Transcription is not configured. Set TRANSCRIPTION_PYTHON to a Python interpreter with faster-whisper installed."
    );
  }

  const existing = inFlight.get(mediaId);
  if (existing) return existing;

  const job = (async (): Promise<Transcript> => {
    const tmpFile = path.join(
      os.tmpdir(),
      `transcribe-${mediaId}-${Date.now()}.mp4`
    );
    try {
      // Download the (already-fetched, time-limited) CDN video URL to disk.
      const res = await fetch(videoUrl);
      if (!res.ok) {
        throw new Error(`Failed to download video (HTTP ${res.status})`);
      }
      const buf = Buffer.from(await res.arrayBuffer());
      await fs.promises.writeFile(tmpFile, buf);

      const script = path.join(process.cwd(), "scripts", "transcribe.py");
      const { stdout } = await execFileAsync(
        python,
        [script, "--input", tmpFile, "--model", resolveModel()],
        {
          timeout: 10 * 60 * 1000, // 10 min ceiling
          maxBuffer: 32 * 1024 * 1024,
          env: {
            ...process.env,
            KMP_DUPLICATE_LIB_OK: "TRUE",
            OMP_NUM_THREADS: "1",
          },
        }
      );

      let parsed: ScriptOutput;
      try {
        parsed = JSON.parse(stdout.trim().split("\n").pop() ?? "{}");
      } catch {
        throw new Error("Transcription script returned invalid output");
      }
      if (parsed.error) throw new Error(parsed.error);

      const text = (parsed.text ?? "").trim();
      const segments = JSON.stringify(parsed.segments ?? []);

      getTranscriptsDb()
        .prepare(
          `INSERT INTO transcripts (media_id, text, language, duration, model, segments)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(media_id) DO UPDATE SET
             text = excluded.text, language = excluded.language,
             duration = excluded.duration, model = excluded.model,
             segments = excluded.segments`
        )
        .run(
          mediaId,
          text,
          parsed.language ?? null,
          parsed.duration ?? null,
          parsed.model ?? resolveModel(),
          segments
        );

      return getTranscript(mediaId)!;
    } finally {
      fs.promises.unlink(tmpFile).catch(() => {});
      inFlight.delete(mediaId);
    }
  })();

  inFlight.set(mediaId, job);
  return job;
}

// ─── Sequential background queue ─────────────────────────────────────────────
// Transcription is CPU-bound, so jobs run strictly one at a time to avoid
// piling up whisper passes. The queue is fed by the background worker; the URL
// is resolved lazily at processing time because Instagram CDN URLs are
// time-limited and would expire while a backlog drains.

const MAX_ATTEMPTS = 3;

interface QueueJob {
  mediaId: string;
  // Resolves a fresh, non-expired video URL right before transcription.
  resolveUrl: () => Promise<string | null>;
}

const queue: QueueJob[] = [];
const queued = new Set<string>(); // mediaIds waiting or running in the queue
const failed = new Map<string, number>(); // mediaId -> attempt count
let draining = false;

/**
 * Enqueue a video for one-time background transcription. No-op when the
 * transcript already exists, the job is already queued/in-flight, or the
 * media has repeatedly failed.
 */
export function queueTranscription(
  mediaId: string,
  resolveUrl: () => Promise<string | null>
): void {
  if (getTranscript(mediaId)) return;
  if (queued.has(mediaId) || inFlight.has(mediaId)) return;
  if ((failed.get(mediaId) ?? 0) >= MAX_ATTEMPTS) return;

  queued.add(mediaId);
  queue.push({ mediaId, resolveUrl });
  void drainQueue();
}

async function drainQueue(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    let job: QueueJob | undefined;
    while ((job = queue.shift())) {
      try {
        const url = await job.resolveUrl();
        if (!url) throw new Error("No video URL available");
        await runTranscription(job.mediaId, url);
        failed.delete(job.mediaId);
      } catch (err) {
        const attempts = (failed.get(job.mediaId) ?? 0) + 1;
        failed.set(job.mediaId, attempts);
        console.error(
          `[transcription] job ${job.mediaId} failed (attempt ${attempts}/${MAX_ATTEMPTS}):`,
          err
        );
      } finally {
        queued.delete(job.mediaId);
      }
    }
  } finally {
    draining = false;
  }
}
