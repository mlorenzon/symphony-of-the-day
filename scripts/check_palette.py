#!/usr/bin/env python3
"""
Check data/periods.json against the two contrast constraints the card design
actually imposes, and print the table.

The duotone-poster design paints the whole card in its period colour, then puts
cream type straight onto it and lays ink plates (the strap, the fact slab) over
it. So a period colour is not a free choice of hue: it has to be dark enough
that cream stays readable and light enough that the ink plates still read as
panels. Both are VALUE questions, which is why "make Baroque yellow" resolves
to a dark gold rather than a yellow -- at any lightness a viewer would call
yellow, cream on it fails.

Run this after ANY edit to periods.json, and before believing a new period's
colour. It is advisory: it exits 1 on a failure so it can gate a commit, but
nothing in the build calls it.

    python scripts/check_palette.py
"""
import colorsys
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# From CFG.col in scripts/sotd.jsx. Every mark on a card is one of these two.
CREAM = "#F4ECDC"
INK = "#14110F"

# The band the shipped set sits in, with a little air either side. These are
# not WCAG numbers -- cream on the darkest period clears AA for body text with
# room to spare. They are "does this colour belong to the same family as the
# other three", which is the thing that actually goes wrong when a colour is
# picked by hue alone.
#
# INK_MIN was 1.9 when the set ran 2.15-2.30, and Baroque purple broke it: a
# purple light enough to reach 2.1 reads electric rather than rich, and #5E2080
# lands at 1.79 with plates that still visibly separate. So the floor is what
# the eye accepts at the bottom of the range, not what the first three
# happened to share -- checked in the mirror, not inferred. Below about 1.7 the
# strap and the fact slab stop reading as panels and the card goes flat.
CREAM_MIN, CREAM_MAX = 5.0, 10.0
INK_MIN, INK_MAX = 1.75, 3.0


def _lin(c):
    c /= 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def rgb(hexstr):
    h = hexstr.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def luminance(hexstr):
    r, g, b = rgb(hexstr)
    return 0.2126 * _lin(r) + 0.7152 * _lin(g) + 0.0722 * _lin(b)


def contrast(a, b):
    x, y = luminance(a), luminance(b)
    x, y = max(x, y), min(x, y)
    return (x + 0.05) / (y + 0.05)


def hsl(hexstr):
    r, g, b = [c / 255.0 for c in rgb(hexstr)]
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    return h * 360, s * 100, l * 100


def main():
    path = os.path.join(ROOT, "data", "periods.json")
    with open(path, encoding="utf-8") as fh:
        table = json.load(fh)

    print("%-11s %-8s %-6s %-7s %-7s %s"
          % ("PERIOD", "COLOUR", "Y", "cream", "ink", "hue/sat/light"))
    bad = []
    prev_to = None
    for per in table["periods"]:
        name, col = per["name"], per.get("color")
        if not col:
            bad.append("%s has no colour" % name)
            print("%-11s %-8s  --  no colour, the card falls back to graphite"
                  % (name, "-"))
            continue

        cc, ci = contrast(col, CREAM), contrast(col, INK)
        h, s, l = hsl(col)
        flags = []
        if not CREAM_MIN <= cc <= CREAM_MAX:
            flags.append("cream %.2f outside %.1f-%.1f" % (cc, CREAM_MIN, CREAM_MAX))
        if not INK_MIN <= ci <= INK_MAX:
            flags.append("ink %.2f outside %.1f-%.1f" % (ci, INK_MIN, INK_MAX))
        print("%-11s %-8s %.4f %-7.2f %-7.2f H%3.0f S%2.0f L%2.0f %s"
              % (name, col, luminance(col), cc, ci, h, s, l,
                 "  <-- " + "; ".join(flags) if flags else ""))
        for f in flags:
            bad.append("%s: %s" % (name, f))

        # Contiguous boundaries: prepare_work.py files a year by walking this
        # list, so a gap silently leaves a work with no period and no colour.
        if prev_to is not None and per["from"] != prev_to:
            bad.append("%s starts at %d but the previous period ended at %d"
                       % (name, per["from"], prev_to))
        prev_to = per["to"]

    # Two periods that read as the same colour defeat the whole design, which
    # asks a viewer to know the era before reading a word.
    pers = [p for p in table["periods"] if p.get("color")]
    for i in range(len(pers)):
        for j in range(i + 1, len(pers)):
            a, b = pers[i], pers[j]
            dh = abs(hsl(a["color"])[0] - hsl(b["color"])[0])
            dh = min(dh, 360 - dh)
            if dh < 30 and abs(luminance(a["color"]) - luminance(b["color"])) < 0.03:
                bad.append("%s and %s are the same colour to a viewer "
                           "(%.0f deg apart, same value)"
                           % (a["name"], b["name"], dh))

    print()
    if bad:
        print("FAIL")
        for b in bad:
            print("  - " + b)
        return 1
    print("OK - %d periods, all inside the design's contrast band."
          % len(table["periods"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
