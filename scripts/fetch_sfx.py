#!/usr/bin/env python
"""
fetch_sfx.py — fetch and trim the card-flip sound effect.

The reel plays one short card-turn sound per card, staggered so the two are
heard as two. The source is a Creative Commons Attribution clip on YouTube, so
it is redistributable with credit but is not tracked here — this script is how
it comes back, the same way prepare_work.py refetches portraits. The credit
line lives in data/audio/credits.json, which IS tracked.

    pip install yt-dlp          # ffmpeg must also be on PATH
    python scripts/fetch_sfx.py

Writes data/audio/card-flip.wav: the useful 550 ms of the source, faded at both
ends and normalised, at 48 kHz stereo.
"""

import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTDIR = os.path.join(ROOT, "data", "audio")

SFX = {
    "name": "card-flip",
    "url": "https://www.youtube.com/watch?v=eMOZhWmdEMo",
    "title": "turn over the cards",
    "author": "SKY SOUND EFFECT",
    "license": "CC BY 3.0 (YouTube Creative Commons Attribution)",
    # The source is 930 ms with silence at both ends: the gesture itself runs
    # from about 275 ms to the hard cut at 820 ms.
    "start": 0.270,
    "end": 0.820,
    "fade_in": 0.012,
    "fade_out": 0.070,
}


def run(cmd):
    p = subprocess.run(cmd, capture_output=True, text=True)
    if p.returncode:
        sys.stderr.write(p.stderr[-2000:] + "\n")
        raise SystemExit("failed: %s" % " ".join(cmd[:3]))
    return p


def main():
    if not os.path.isdir(OUTDIR):
        os.makedirs(OUTDIR)

    raw = os.path.join(OUTDIR, "_%s-source.wav" % SFX["name"])
    out = os.path.join(OUTDIR, "%s.wav" % SFX["name"])

    run([sys.executable, "-m", "yt_dlp", "--no-warnings", "-f", "bestaudio",
         "-x", "--audio-format", "wav", "--force-overwrites",
         "-o", os.path.join(OUTDIR, "_%s-source.%%(ext)s" % SFX["name"]),
         SFX["url"]])

    dur = SFX["end"] - SFX["start"]
    # loudnorm would pump a transient this short, so this is a plain gain to
    # bring the -8.6 dBFS source peak up to -3; the reel sets the level in AE.
    filters = "afade=t=in:st=0:d=%g,afade=t=out:st=%g:d=%g,volume=5.6dB" % (
        SFX["fade_in"], dur - SFX["fade_out"], SFX["fade_out"])

    run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
         "-ss", "%g" % SFX["start"], "-to", "%g" % SFX["end"], "-i", raw,
         "-af", filters, "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", out])

    os.remove(raw)

    credits = os.path.join(OUTDIR, "credits.json")
    with open(credits, "w", encoding="utf-8") as fh:
        json.dump({SFX["name"]: {k: SFX[k] for k in
                                 ("url", "title", "author", "license")}},
                  fh, indent=2, ensure_ascii=False)
        fh.write("\n")

    print("wrote %s (%.0f ms)" % (out, dur * 1000))
    print("credit: %s — %s — %s" % (SFX["title"], SFX["author"], SFX["license"]))


if __name__ == "__main__":
    sys.exit(main())
