#!/usr/bin/env python3
"""Set the reel's loudness and write the file to post.

    python scripts/reel_master.py beethoven-no-5
    python scripts/reel_master.py beethoven-no-5 --measure-only

Takes `out/<slug>.ae.mp4` — what After Effects rendered — and writes
`out/<slug>.mp4`, which is the one to upload.

**The video is copied, not re-encoded.** Only the audio is touched, so this
costs a second and no quality. AE's H.264 is already what Instagram wants.

Why it exists: Instagram normalises what you upload to roughly -14 LUFS. A reel
that arrives quieter gets turned *up*, and if its peaks are already near zero
the gain lands on top of them. Setting the level here means the platform has
nothing left to do — and it makes every reel in the series the same loudness as
the last one, which a viewer notices far more than they notice any single
video's level.

Two-pass loudnorm: the first pass measures, the second corrects against those
measurements. One pass guesses from a running window and drifts on speech with
long gaps in it, which this script is full of.
"""
import argparse
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "out")

# Instagram's own target, and a true-peak ceiling with enough room that its
# re-encode cannot push a sample over.
TARGET_I = -14.0
TARGET_TP = -1.5
TARGET_LRA = 11.0


def measure(path):
    """First pass: what the file actually is."""
    p = subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostats", "-i", path,
         "-af", "loudnorm=I=%s:TP=%s:LRA=%s:print_format=json"
                % (TARGET_I, TARGET_TP, TARGET_LRA),
         "-f", "null", "-"],
        stderr=subprocess.PIPE, stdout=subprocess.DEVNULL)
    err = p.stderr.decode("utf-8", "replace")
    m = re.search(r"\{[^{}]*\"input_i\"[^{}]*\}", err, re.S)
    if not m:
        sys.exit("loudnorm printed no measurements:\n" + err[-1500:])
    return json.loads(m.group(0))


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("slug")
    ap.add_argument("--measure-only", action="store_true",
                    help="Report the loudness and stop")
    args = ap.parse_args()

    src = os.path.join(OUT, args.slug + ".ae.mp4")
    dst = os.path.join(OUT, args.slug + ".mp4")
    if not os.path.exists(src):
        sys.exit("no render at %s — SOTD.renderReel(\"%s\") first"
                 % (os.path.relpath(src, ROOT), args.slug))

    d = measure(src)
    print("  in     %s LUFS, true peak %s dBFS, range %s LU"
          % (d["input_i"], d["input_tp"], d["input_lra"]))
    if args.measure_only:
        return

    subprocess.check_call([
        "ffmpeg", "-v", "error", "-y", "-i", src,
        "-map", "0:v", "-map", "0:a", "-c:v", "copy",
        "-af", "loudnorm=I=%s:TP=%s:LRA=%s:"
               "measured_I=%s:measured_TP=%s:measured_LRA=%s:measured_thresh=%s:"
               "offset=%s:linear=true:print_format=summary"
               % (TARGET_I, TARGET_TP, TARGET_LRA,
                  d["input_i"], d["input_tp"], d["input_lra"], d["input_thresh"],
                  d["target_offset"]),
        "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
        "-movflags", "+faststart", dst])

    after = measure(dst)
    print("  out    %s LUFS, true peak %s dBFS" % (after["input_i"], after["input_tp"]))
    print("  wrote  %s (%.1f MB)"
          % (os.path.relpath(dst, ROOT).replace("\\", "/"),
             os.path.getsize(dst) / 1048576.0))


if __name__ == "__main__":
    main()
