#!/usr/bin/env python3
"""Standalone video → transcript using faster-whisper (single raw pass).

Reads a local audio/video file, runs one faster-whisper transcription pass
(no VAD, no forced alignment, no retake detection — kept deliberately simple),
and prints a JSON document to stdout:

    {"text": "...", "language": "en", "duration": 12.3,
     "model": "small", "segments": [{"start": 0.0, "end": 2.1, "text": "..."}]}

On failure it prints {"error": "..."} to stdout and exits non-zero.

faster-whisper decodes the input directly via PyAV, so mp4/mov/etc. are read
without a separate ffmpeg step.
"""
from __future__ import annotations

import argparse
import json
import os
import sys

# faster-whisper (CTranslate2) and onnxruntime each ship their own OpenMP
# runtime; on macOS the duplicate linkage aborts the process with OMP Error #15
# before any Python-level error handling runs. Allow the duplicate so the model
# can load. Must be set before importing faster_whisper.
os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")
os.environ.setdefault("OMP_NUM_THREADS", "1")


def main() -> int:
    parser = argparse.ArgumentParser(description="Transcribe a video/audio file with faster-whisper")
    parser.add_argument("--input", required=True, help="Path to a local audio/video file")
    parser.add_argument("--model", default="small", help="faster-whisper model name (default: small)")
    parser.add_argument("--language", default=None, help="Force a language code (e.g. 'en'); auto-detect if omitted")
    parser.add_argument("--compute-type", default="int8", help="CTranslate2 compute type (default: int8)")
    args = parser.parse_args()

    if not os.path.exists(args.input):
        print(json.dumps({"error": f"Input file not found: {args.input}"}))
        return 1

    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:
        print(json.dumps({"error": f"faster-whisper is not installed: {exc}"}))
        return 1

    try:
        model = WhisperModel(
            args.model,
            device="cpu",
            compute_type=args.compute_type,
            cpu_threads=os.cpu_count() or 4,
        )

        segments_iter, info = model.transcribe(
            args.input,
            language=args.language,
            beam_size=1,                       # greedy — fastest, good enough for a script
            condition_on_previous_text=False,
            vad_filter=False,
        )

        segments = []
        text_parts = []
        for seg in segments_iter:
            piece = seg.text.strip()
            if not piece:
                continue
            segments.append({
                "start": round(seg.start, 3),
                "end": round(seg.end, 3),
                "text": piece,
            })
            text_parts.append(piece)

        print(json.dumps({
            "text": " ".join(text_parts).strip(),
            "language": getattr(info, "language", args.language),
            "duration": round(getattr(info, "duration", 0.0) or 0.0, 3),
            "model": args.model,
            "segments": segments,
        }))
        return 0
    except Exception as exc:  # noqa: BLE001 — surface any failure as JSON to the caller
        print(json.dumps({"error": f"{type(exc).__name__}: {exc}"}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
