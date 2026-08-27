#!/usr/bin/env python3
"""Reframe a take so the head sits above the card, and record the decision.

    python scripts/take_frame.py beethoven-no-2 --measure
    python scripts/take_frame.py beethoven-no-2 --hair 250 --chin 920

The card cannot move. It is the same rectangle in every reel of the series —
`CFG.overlay` in sotd.jsx hangs it from an anchor near its own top edge so it
spans y 744-1484 — so when it lands on a face, the *person* moves instead. That
is what `video.framing` is for: `zoom` multiplies the cover scale and `x`/`y`
place the centre of the take, both in the reel's own pixels.

Those numbers used to be set by dragging the layer in the comp, which is exactly
the kind of hand-nudge `buildWork` throws away. So the judgement is reduced to
two measurements taken once off a filmstrip of the cut, and the arithmetic is
done here and written to the work JSON, where a rebuild will honour it.

## The two measurements are EXTREMES, not one frame

He moves 80-90 px over a take, so a single frame is not the shot. Measure, in the
source pixels of `data/takes/<slug>/locked.mp4`:

  --hair   the HIGHEST the top of the hair ever gets (the SMALLEST y)
  --chin   the LOWEST the bottom of the beard ever gets (the LARGEST y)

`--measure` writes one filmstrip with both bands across the whole cut so the two
extremes can be read off it together.

## Why it cannot satisfy both, and which one wins

The frame is exactly as tall as the take, so lifting him needs zoom to pay for
it — and zoom makes him bigger, which pushes the beard back down. Past a point
the two constraints are simply incompatible, and no zoom keeps the hair in frame
at his most upright *and* the beard clear of the card at his lowest.

`beethoven-no-1`'s framing was accepted by eye, and measuring what it actually
does settles which way to lose: at zoom 1.32, centre y 854, with hair reaching
330 and beard reaching 890, it lands the hair at **22 px** from the top and lets
the beard dip **18 px under the card**. So the hair staying in frame is the hard
constraint, and the beard grazing the card top at his lowest moment is accepted —
a cropped head reads as a mistake, a beard touching a card edge does not.
"""
import argparse
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TAKES = os.path.join(ROOT, "data", "takes")
WORKS = os.path.join(ROOT, "data", "works")

REEL_W, REEL_H = 1080, 1920

# The card's top edge, from the three numbers in CFG.overlay that decide it: the
# anchor sits at y 838, the anchor is 78 card-pixels below the card's top edge,
# and the card is drawn at 120%. Kept as the arithmetic rather than as 744, so a
# change to any of the three is visible here.
OVERLAY_Y, OVERLAY_ANCHOR_Y, OVERLAY_SCALE = 838.0, 78.0, 1.20
CARD_TOP = OVERLAY_Y - OVERLAY_ANCHOR_Y * OVERLAY_SCALE

# --- the reference, measured off beethoven-no-1 ---------------------------
# Its framing (zoom 1.32, centre y 854) was accepted by eye. Its hair reaches
# source y 330 and its beard reaches 890, which is what those two numbers mean
# in the finished reel. Every later take is matched to them, so the series keeps
# one head size and one headroom instead of a new judgement every day.
REF_ZOOM, REF_CENTRE_Y = 1.32, 854.0
REF_HAIR_SRC, REF_CHIN_SRC = 330.0, 890.0
HEADROOM = (REF_HAIR_SRC - REEL_H / 2.0) * REF_ZOOM + REF_CENTRE_Y      # 22.4 px
REF_SPAN = (REF_CHIN_SRC - REF_HAIR_SRC) * REF_ZOOM                    # 739 px

# Keep a little of the zoom in reserve rather than shifting the take to the very
# limit of its own slack, where a rounding error shows the empty frame behind it.
SLACK_MARGIN = 20.0


def locked(slug):
    p = os.path.join(TAKES, slug, "locked.mp4")
    if not os.path.exists(p):
        sys.exit("No cut at %s — run take_align.py first."
                 % os.path.relpath(p, ROOT).replace("\\", "/"))
    return p


def duration(path):
    return float(subprocess.check_output(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", path]))


def measure(slug, samples, hair_band, chin_band):
    """One filmstrip of the cut: the hair band over the beard band, per sample."""
    try:
        from PIL import Image, ImageDraw
    except ImportError:
        sys.exit("--measure needs Pillow:  pip install Pillow")

    src = locked(slug)
    dur = duration(src)
    times = [round(dur * (i + 0.5) / samples, 2) for i in range(samples)]
    tmp = os.path.join(TAKES, slug, "_frm.png")
    tiles, tw = [], 340

    for t in times:
        subprocess.check_call(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
                               "-ss", str(t), "-i", src, "-frames:v", "1", tmp])
        im = Image.open(tmp).convert("RGB")
        parts = []
        for (lo, hi), colour in ((hair_band, (255, 60, 60)), (chin_band, (60, 235, 60))):
            band = im.crop((260, lo, 820, hi))
            h = int(band.height * tw / float(band.width))
            band = band.resize((tw, h), Image.LANCZOS)
            d = ImageDraw.Draw(band)
            for sy in range(lo, hi, 20):
                y = int((sy - lo) * h / float(hi - lo))
                d.line([(0, y), (tw, y)], fill=colour, width=1)
                d.text((3, y), str(sy), fill=(255, 255, 0))
            parts.append(band)
        tile = Image.new("RGB", (tw, parts[0].height + parts[1].height + 16), "black")
        tile.paste(parts[0], (0, 0))
        tile.paste(parts[1], (0, parts[0].height + 16))
        ImageDraw.Draw(tile).text((tw - 60, parts[0].height + 2), "t=%.0f" % t,
                                  fill=(0, 255, 255))
        tiles.append(tile)

    os.remove(tmp)
    cols = min(5, len(tiles))
    rows = (len(tiles) + cols - 1) // cols
    sheet = Image.new("RGB", (tw * cols, tiles[0].height * rows), "black")
    for i, tl in enumerate(tiles):
        sheet.paste(tl, ((i % cols) * tw, (i // cols) * tiles[0].height))
    out = os.path.join(TAKES, slug, "framing_strip.png")
    sheet.save(out)

    print("  strip  %s — %d samples across %.1f s"
          % (os.path.relpath(out, ROOT).replace("\\", "/"), samples, dur))
    print("         top band  (red)   y %d-%d: find the HIGHEST hair, smallest y"
          % hair_band)
    print("         low band (green)  y %d-%d: find the LOWEST beard, largest y"
          % chin_band)
    print("  then   python scripts/take_frame.py %s --hair <y> --chin <y>" % slug)


def solve(hair, chin):
    """(zoom, centre y, notes) putting the hair at the reference headroom.

    Two things set the zoom, and the larger wins:

      * matching the reference head SIZE, so every reel in the series frames the
        face the same, and
      * paying for the upward shift the headroom needs. The take is exactly as
        tall as the frame, so the only vertical slack is what zoom creates:
        960*(zoom-1) either side. Ask for a bigger lift than that and the empty
        frame shows below him.
    """
    notes = []
    span = chin - hair
    z_size = REF_SPAN / span
    # y = HEADROOM + (960 - hair) * z, and the shift up is 960 - y, so
    # 960*(z-1) >= 960 - y + margin solves to the bound below.
    z_slack = (960.0 + 960.0 - HEADROOM + SLACK_MARGIN) / (960.0 + (960.0 - hair))
    zoom = max(z_size, z_slack)
    if z_slack > z_size:
        notes.append("zoom is set by the lift, not by head size (%.3f over %.3f) — "
                     "he sits low in this take, so it costs zoom to raise him"
                     % (z_slack, z_size))
    y = HEADROOM + (960.0 - hair) * zoom
    return zoom, y, notes


def land(src_y, zoom, y):
    return (src_y - REEL_H / 2.0) * zoom + y


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("slug")
    ap.add_argument("--measure", action="store_true",
                    help="Write the filmstrip to measure from, and stop")
    ap.add_argument("--samples", type=int, default=9,
                    help="How many moments to sample for --measure")
    ap.add_argument("--hair-band", type=int, nargs=2, default=(150, 450),
                    metavar=("LO", "HI"), help="Source y range of the top band")
    ap.add_argument("--chin-band", type=int, nargs=2, default=(780, 1000),
                    metavar=("LO", "HI"), help="Source y range of the lower band")
    ap.add_argument("--hair", type=float,
                    help="HIGHEST source y of the top of the hair (smallest)")
    ap.add_argument("--chin", type=float,
                    help="LOWEST source y of the bottom of the beard (largest)")
    ap.add_argument("--x", type=float, default=REEL_W / 2.0,
                    help="Horizontal centre (default: frame centre)")
    ap.add_argument("--dry-run", action="store_true", help="Print, write nothing")
    args = ap.parse_args()

    if args.measure:
        return measure(args.slug, args.samples,
                       tuple(args.hair_band), tuple(args.chin_band))

    if args.hair is None or args.chin is None:
        sys.exit("Give --hair and --chin from the filmstrip, or run --measure first.")
    if args.chin <= args.hair:
        sys.exit("--chin must be BELOW --hair: both are source y, counted downward.")

    zoom, y, notes = solve(args.hair, args.chin)
    print("  solved zoom %.3f, centre %.0f,%.0f" % (zoom, args.x, y))
    for n in notes:
        print("    note   %s" % n)
    hair_at, chin_at = land(args.hair, zoom, y), land(args.chin, zoom, y)
    print("    %-16s src %4.0f -> reel %6.1f   (no-1: %.1f)"
          % ("hair, highest", args.hair, hair_at, HEADROOM))
    print("    %-16s src %4.0f -> reel %6.1f   (card top %.0f)"
          % ("beard, lowest", args.chin, chin_at, CARD_TOP))
    print("    %-16s %5.1f px  (no-1 dips %.1f)"
          % ("beard under card", chin_at - CARD_TOP,
             (REF_CHIN_SRC - REEL_H / 2.0) * REF_ZOOM + REF_CENTRE_Y - CARD_TOP))
    print("    %-16s %5.1f px of slack, %.1f used"
          % ("vertical", 960.0 * (zoom - 1.0), 960.0 - y))

    if hair_at < 0:
        print("  !  the top of the head is cropped. Check --hair: it is the "
              "HIGHEST the hair gets, so the SMALLEST y on the strip.")
    if 960.0 - y > 960.0 * (zoom - 1.0):
        print("  !  the lift exceeds the take's slack — the empty frame will show "
              "below him. Something is wrong with the measurements.")
    dip = chin_at - CARD_TOP
    if dip > 90:
        print("  !  the beard dips %.0f px under the card at his lowest, well past "
              "no-1's 18. He is sitting low or leaning about a lot; worth an eye "
              "on the render before it goes out." % dip)

    wpath = os.path.join(WORKS, args.slug + ".json")
    if not os.path.exists(wpath):
        sys.exit("No work JSON at %s" % os.path.relpath(wpath, ROOT))
    with open(wpath, encoding="utf-8") as fh:
        work = json.load(fh)
    if not work.get("video"):
        sys.exit("The work has no `video` block — run take_align.py first: "
                 "framing belongs to an edit, not to a card.")

    work["video"]["framing"] = {"zoom": round(zoom, 3),
                                "x": round(args.x, 1),
                                "y": round(y, 1)}
    if args.dry_run:
        print("\n--- would write video.framing ---")
        print(json.dumps(work["video"]["framing"], indent=2))
        return

    with open(wpath, "w", encoding="utf-8") as fh:
        json.dump(work, fh, indent=2, ensure_ascii=False)
    print("  wrote  %s" % os.path.relpath(wpath, ROOT).replace("\\", "/"))
    print("\nNext, in After Effects:")
    print('  SOTD.buildWork("%s")' % args.slug)


if __name__ == "__main__":
    main()
