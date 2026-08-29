#!/usr/bin/env python3
"""Regenerate identity/social-cockpit-lockup.svg with the wordmark as outlines.

The header wordmark is Barlow Semi Condensed Bold at 0.3em tracking, with
"COCKPIT" in amber (see `.ck-sig` in src/app/globals.css). An SVG <text> element
cannot promise that: whoever opens the file needs the family installed, and a
fallback silently reflows the lockup - the previous version overran its own
viewBox in any renderer that missed Arial Narrow. Converting the glyphs to paths
makes the file say exactly what the app says, everywhere.

The font is read out of the Next build's font cache, which is the same file the
running app serves. Read-only: this script opens `.next/static/media/*.woff2`
and writes nothing outside docs/portfolio/.

    pip install fonttools brotli
    python3 docs/portfolio/make_lockup.py
"""

from __future__ import annotations

import glob
import sys
from pathlib import Path

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent / "identity" / "social-cockpit-lockup.svg"

FAMILY = "Barlow Semi Condensed"
SUBFAMILY = "Bold"
TEXT = [("SOCIAL·", "#F2EFE9"), ("COCKPIT", "#FFB324")]  # --txt, --amber
TRACKING = 0.30      # 0.3em, matching .ck-sig
SIZE = 148           # cap height on the 512-tall canvas
BASELINE = 304
TEXT_X = 540
PAD = 80             # right margin, matched to the mark's left margin


def find_font() -> Path:
    for path in sorted(glob.glob(str(ROOT / ".next/static/media/*.woff2"))):
        font = TTFont(path, lazy=True)
        if (font["name"].getDebugName(1), font["name"].getDebugName(2)) == (
            f"{FAMILY} {SUBFAMILY}",
            "Regular",
        ) or (font["name"].getDebugName(1), font["name"].getDebugName(2)) == (
            FAMILY,
            SUBFAMILY,
        ):
            return Path(path)
    sys.exit(f"no {FAMILY} {SUBFAMILY} woff2 under .next/static/media")


def main() -> None:
    font = TTFont(find_font())
    upm = font["head"].unitsPerEm
    scale = SIZE / upm
    glyphs = font.getGlyphSet()
    cmap = font.getBestCmap()

    runs, x = [], TEXT_X
    for word, colour in TEXT:
        paths = []
        for ch in word:
            name = cmap[ord(ch)]
            pen = SVGPathPen(glyphs)
            glyphs[name].draw(pen)
            d = pen.getCommands()
            if d:
                paths.append(f'<path transform="translate({x:.2f} {BASELINE}) '
                             f'scale({scale:.5f} {-scale:.5f})" d="{d}"/>')
            x += glyphs[name].width * scale + SIZE * TRACKING
        runs.append((colour, paths))

    width = round(x - SIZE * TRACKING + PAD)

    body = "\n".join(
        f'  <g fill="{colour}">\n' + "\n".join("    " + p for p in paths) + "\n  </g>"
        for colour, paths in runs
    )
    OUT.write_text(f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} 512" role="img" aria-labelledby="title desc">
  <title id="title">Social Cockpit radar and wordmark</title>
  <desc id="desc">The Social Cockpit radar mark next to the SOCIAL COCKPIT wordmark on charcoal.</desc>
  <defs>
    <linearGradient id="sweep" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#FFB324" stop-opacity=".58"/><stop offset="1" stop-color="#FFB324" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="{width}" height="512" rx="64" fill="#121110"/>
  <circle cx="256" cy="256" r="176" fill="#171613" stroke="#3B3730" stroke-width="12"/>
  <circle cx="256" cy="256" r="112" fill="none" stroke="#3B3730" stroke-width="12"/>
  <!-- Posed mid-rotation. The leading edge sits just past the blip, so the
       contact reads as freshly swept rather than as a stopped hand. -->
  <g transform="rotate(38 256 256)">
    <path d="M256 256V80A176 176 0 0 1 380.45 131.55Z" fill="url(#sweep)"/>
    <path d="M256 256V80" fill="none" stroke="#FFB324" stroke-width="16" stroke-linecap="round"/>
  </g>
  <circle cx="371" cy="188" r="14" fill="#FFC72E"/>
  <!-- Barlow Semi Condensed Bold at 0.3em, converted to outlines by
       make_lockup.py so the lockup cannot reflow on a machine without it. -->
{body}
</svg>
''')
    print(f"wrote {OUT.name} ({width}x512)")


if __name__ == "__main__":
    main()
