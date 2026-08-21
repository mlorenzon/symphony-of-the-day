#!/usr/bin/env python
"""
export_design_html.py — write design/cards.html, a browser mirror of the cards.

The point is a round trip: hand the HTML to a design tool, get changed HTML
back, and read the new numbers straight into CFG in scripts/sotd.jsx. So every
element carries the After Effects layer name it maps to (data-layer="TITLE"),
and every coordinate is the same top-left card-space number the builder uses.

CFG below MIRRORS the CFG block in sotd.jsx. It is duplicated rather than
parsed because sotd.jsx is ExtendScript, not JSON — if you change geometry
there, change it here too, or the mirror lies.

    python scripts/export_design_html.py

Portraits and map stills are embedded as base64 JPEGs, so the file is
self-contained and can be uploaded or pasted anywhere.
"""

import base64
import io
import json
import os
import re
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SLUGS = ["mozart-linz", "brahms-no-4", "shostakovich-leningrad"]

# ---------------------------------------------------------------- CFG mirror

CARD = {"w": 440, "h": 616}
FRAME = {"edge": 7, "round": 20, "inner": 11, "innerWeight": 1.5, "pad": 14}
FRONT = {"strap": 78, "portrait": 262, "rule": 5, "stats": 70, "title": 124, "life": 44}
BACK = {"strap": 76, "region": 38, "rule": 5, "map": 214, "slab": 250}
# Weighted, not thirds: "NATIONALITY" is twice the word "ERA" is.
STATS = [{"label": "ERA", "w": 0.38},
         {"label": "YEAR", "w": 0.20},
         {"label": "NATIONALITY", "w": 0.42}]
# Type sizes in card pixels. One card pixel is about 0.63 phone pixels at
# REEL["scale"], so nothing here goes below 18.
TYPE = {"given": 20, "surname": 46, "number": 84, "numLabel": 22,
        "statLabel": 18, "statValue": 30, "title": 40, "life": 28,
        "place": 46, "region": 24, "slabLabel": 18, "body": 26}
DUOTONE = {"portraitLift": 16, "mapLift": 10}

I = {"x": FRAME["pad"], "y": FRAME["pad"],
     "w": CARD["w"] - FRAME["pad"] * 2, "h": CARD["h"] - FRAME["pad"] * 2}


def bands(spec):
    """Mirrors bands() in sotd.jsx: named strips stacked down the interior."""
    out, y = {}, I["y"]
    for name, h in spec:
        out[name] = {"y": y, "h": h, "mid": y + h / 2.0}
        y += h
    assert y == I["y"] + I["h"], "bands do not tile the interior: %g" % y
    return out


FB = bands([("strap", FRONT["strap"]), ("portrait", FRONT["portrait"]),
            ("ruleA", FRONT["rule"]), ("stats", FRONT["stats"]),
            ("ruleB", FRONT["rule"]), ("title", FRONT["title"]),
            ("life", FRONT["life"])])
BB = bands([("strap", BACK["strap"]), ("region", BACK["region"]),
            ("ruleA", BACK["rule"]), ("map", BACK["map"]),
            ("ruleB", BACK["rule"]), ("slab", BACK["slab"])])

PORTRAIT_PANEL = {"x": I["x"], "y": FB["portrait"]["y"], "w": I["w"], "h": FB["portrait"]["h"]}
MAP_PANEL = {"x": I["x"], "y": BB["map"]["y"], "w": I["w"], "h": BB["map"]["h"]}

COL = {
    "cream":  (0.957, 0.925, 0.863),
    "ink":    (0.078, 0.067, 0.059),
    "bg":     (0.055, 0.051, 0.047),
    "period": (0.576, 0.157, 0.137),
}

# Reel placement, from buildReel + the CTRL slider defaults. One card at a
# time now, so there is no gap: the two cards occupy the same spot and the
# second is the first turned over.
REEL = {"w": 1080, "h": 1920, "y": 1112, "scale": 1.75, "videoBottom": 560}


def hexcol(rgb):
    return "#%02X%02X%02X" % tuple(int(round(c * 255)) for c in rgb)


def period_color(work, table):
    """Mirrors periodColorExpr: the period's colour, straight out of the table."""
    want = str(work.get("period", "")).lower()
    for per in table["periods"]:
        if per["name"].lower() == want and per.get("color"):
            return per["color"]
    return hexcol(COL["period"])


# ------------------------------------------------------------------ helpers

def data_uri(path, box, quality=82):
    """Downscale to roughly 2x its panel size and embed as a base64 JPEG."""
    img = Image.open(path).convert("RGB")
    img.thumbnail((box[0] * 2, box[1] * 2), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=quality, optimize=True)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def esc(s):
    return (str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


def box(layer, x, y, w, h, extra="", style=""):
    """A positioned element carrying its AE layer name."""
    return ('<div class="ly" data-layer="%s" style="left:%gpx;top:%gpx;'
            'width:%gpx;height:%gpx;%s" %s>' % (esc(layer), x, y, w, h, style, extra))


def text_layer(layer, x, y, w, h, s, size, font, tracking=0, align="center",
               leading=None, italic=False, bold=False, opacity=None,
               shadow=False):
    """
    Mirrors addText: the box is the AE text box, and content is centred in it
    the way the card's centerY re-centring does. Everything on this design is
    cream, so there is no colour argument.
    """
    style = (
        "display:flex;align-items:center;"
        "font-family:%s;font-size:%gpx;color:var(--cream);letter-spacing:%gem;"
        "line-height:%gpx;justify-content:%s;text-align:%s;"
        % (font, size, tracking / 1000.0,
           leading if leading else size * 1.2,
           {"center": "center", "left": "flex-start", "right": "flex-end"}[align],
           align)
    )
    if italic:
        style += "font-style:italic;"
    if bold:
        style += "font-weight:700;"
    if opacity is not None:
        style += "opacity:%g;" % opacity
    if shadow:
        style += "text-shadow:0 3px 10px rgba(0,0,0,.55);"
    return (box(layer, x, y, w, h, style=style)
            + '<span>' + esc(s) + '</span></div>')


def rect(layer, x, y, w, h, fill, radius=0):
    style = "background:%s;" % fill
    if radius:
        style += "border-radius:%gpx;" % radius
    return box(layer, x, y, w, h, style=style) + "</div>"


def duotone_panel(layer, x, y, w, h, uri, color, lift, extra_inner=""):
    """
    Mirrors the PORTRAIT / MAP sub-comps: greyscale source, a period-colour
    multiply, and a cream screen to lift the blacks back off the floor.
    """
    return (box(layer, x, y, w, h, style="overflow:hidden;")
            + ('<img src="%s" alt="">' % uri if uri else "")
            + '<div class="ly" data-layer="DUOTONE colour" style="inset:0;'
              'background:%s;mix-blend-mode:multiply"></div>' % color
            + '<div class="ly" data-layer="DUOTONE lift" style="inset:0;'
              'background:var(--cream);mix-blend-mode:screen;opacity:%g"></div>'
              % (lift / 100.0)
            + extra_inner + '</div>')


def card_chrome():
    """
    cardChrome(): a cream hairline over the art, then the dark ring. The
    rounding itself is .card's overflow, standing in for the even-odd corner
    shape AE needs.
    """
    n = FRAME["inner"]
    return ('<div class="ly ring" data-layer="CARD hairline" '
            'style="left:%gpx;top:%gpx;width:%gpx;height:%gpx;'
            'border:%gpx solid var(--cream);border-radius:%gpx;opacity:.55"></div>'
            % (n, n, CARD["w"] - n * 2, CARD["h"] - n * 2,
               FRAME["innerWeight"], FRAME["round"] - n)
            + '<div class="ly ring" data-layer="CARD border" style="inset:0;'
              'border:%gpx solid var(--ink);border-radius:%gpx"></div>'
              % (FRAME["edge"], FRAME["round"]))


def fit_size(text, steps):
    """Mirrors bindFitted: first size that the length has not outgrown."""
    size = steps[0][1]
    for over, s in steps[1:]:
        if len(text) > over:
            size = s
    return size


def nbsp(s):
    """Mirrors the bindFitted non-breaking-space glue for 'No. 36' etc."""
    return re.sub(r"\. (\d)", ". \\1", s)


def surname(work):
    c = work["composer"]
    return c.get("surname") or c["name"].split(" ")[-1]


# -------------------------------------------------------------------- faces

def card_strap(band, runs):
    """
    Card 1 needs two runs: a full name on one line can only be about 25 px
    before it runs out of card. Given names small, surname large.
    """
    out = [rect("STRAP plate", I["x"], band["y"], I["w"], band["h"], "var(--ink)")]
    for r in runs:
        size = fit_size(r["text"], r["steps"])
        h = r["size"] + 14
        out.append(text_layer(r["layer"], I["x"] + 10, r["centre"] - h / 2.0,
                              I["w"] - 20, h, r["text"], size, "var(--caps)",
                              tracking=r["tracking"],
                              opacity=r.get("opacity")))
    return "\n".join(out)


def stat_row(cells):
    """Weighted columns, and the pair centred slightly above the true middle."""
    B = FB["stats"]
    x = I["x"]
    out = []
    for col, cell in zip(STATS, cells):
        w = I["w"] * col["w"]
        if out:
            out.append('<div class="ly" data-layer="STAT divider" '
                       'style="left:%gpx;top:%gpx;width:2px;height:%gpx;'
                       'background:var(--cream);opacity:.45"></div>'
                       % (x - 1, B["y"] + 10, B["h"] - 20))
        out.append(text_layer("STAT %s label" % col["label"], x + 6, B["y"] + 7,
                              w - 12, 24, col["label"], TYPE["statLabel"],
                              "var(--caps)", tracking=90, opacity=.88))
        out.append(text_layer("STAT %s" % col["label"], x + 6, B["y"] + 23,
                              w - 12, 40, cell["text"],
                              fit_size(cell["text"], cell.get("steps",
                                       [(0, TYPE["statValue"]), (11, 26), (15, 22)])),
                              "var(--serif)", bold=True))
        x += w
    return "\n".join(out)


def front(work, color, portrait_uri):
    p = PORTRAIT_PANEL
    title = nbsp(work["title_full"])
    num = re.sub(r"^\s*(No|Nº|Nr)\.?\s*", "", work.get("number", ""), flags=re.I)
    parts = work["composer"]["name"].split(" ")
    given, sur = " ".join(parts[:-1]), work["composer"].get("surname") or parts[-1]

    out = [rect("CARD ground", 0, 0, CARD["w"], CARD["h"], color),
           duotone_panel("PORTRAIT", p["x"], p["y"], p["w"], p["h"],
                         portrait_uri, color, DUOTONE["portraitLift"])]

    if num:
        out.append(
            '<div class="ly num" data-layer="NUMBER" style="top:%gpx;right:%gpx">'
            '<span data-layer="NUMBER label">No.</span>'
            '<b data-layer="NUMBER value">%s</b></div>'
            % (p["y"] + 4, CARD["w"] - (I["x"] + I["w"] - 14), esc(num)))

    out.append(card_strap(FB["strap"], [
        {"layer": "GIVEN NAMES", "text": given, "size": TYPE["given"],
         "tracking": 120, "centre": FB["strap"]["y"] + 18, "opacity": .76,
         "steps": [(0, TYPE["given"]), (18, 17)]},
        {"layer": "SURNAME", "text": sur, "size": TYPE["surname"],
         "tracking": 20, "centre": FB["strap"]["y"] + 52,
         "steps": [(0, TYPE["surname"]), (10, 40), (14, 34), (19, 28)]},
    ]))

    out.append(rect("RULE above stats", I["x"], FB["ruleA"]["y"], I["w"],
                    FB["ruleA"]["h"], "var(--cream)"))
    out.append(rect("RULE below stats", I["x"], FB["ruleB"]["y"], I["w"],
                    FB["ruleB"]["h"], "var(--cream)"))
    out.append(stat_row([
        {"text": work["period"]},
        {"text": str(work["composition"]["year"])},
        {"text": work["composer"]["nationality"]},
    ]))

    tsize = fit_size(title, [(0, TYPE["title"]), (34, 36), (52, 32)])
    out.append(text_layer("TITLE", I["x"] + 10, FB["title"]["y"] + 6, I["w"] - 20,
                          FB["title"]["h"] - 12, title, tsize, "var(--serif)",
                          leading=tsize * 1.1, bold=True))

    age = work["composition"].get("age")
    life = "   ·   ".join([s for s in (work["composer"]["life"],
                                       ("aged %d" % age) if age else "") if s])
    out.append(text_layer("LIFE", I["x"], FB["life"]["y"] - 6, I["w"], 38,
                          life, TYPE["life"], "var(--serif)", italic=True,
                          opacity=.88))

    out.append(card_chrome())
    return "\n".join(out)


def story_slab(work):
    """
    Why it was written, and what to listen for. Both optional, which is four
    states — the slab is pinned to the bottom and grows to fit what it holds.
    """
    S = BB["slab"]
    ctx = work.get("context") or ""
    hook = work.get("listen_for") or ""
    both = bool(ctx and hook)
    tx, tw = I["x"] + 14, I["w"] - 28
    solo_h = 150
    solo_mid = S["y"] + S["h"] - solo_h / 2.0
    divider_y, hook_y = S["y"] + 136, S["y"] + 152

    slab_h = S["h"] if both else (solo_h if (ctx or hook) else 0)
    out = [rect("STORY slab", I["x"], S["y"] + S["h"] - slab_h, I["w"], slab_h,
                "var(--ink)")]

    def para(layer, text, steps, share_mid, alone_mid, h):
        size = fit_size(text, steps)
        centre = share_mid if both else alone_mid
        return text_layer(layer, tx, centre - h / 2.0, tw, h, text, size,
                          "var(--serif)", align="left", leading=size * 1.24,
                          italic=True)

    def label(layer, text, share_mid, alone_mid):
        centre = share_mid if both else alone_mid
        return text_layer(layer, tx, centre - 12, tw, 24, text,
                          TYPE["slabLabel"], "var(--caps)", tracking=200,
                          opacity=.78)

    if ctx:
        out.append(label("OCCASION label", work["context_label"].upper(),
                         S["y"] + 18, solo_mid - 42))
        out.append(para("OCCASION", ctx,
                        [(0, TYPE["body"]), (85, 23), (120, 20), (150, 18)],
                        S["y"] + 80, solo_mid + 14, 100))
    if both:
        out.append('<div class="ly" data-layer="STORY divider" '
                   'style="left:%gpx;top:%gpx;width:%gpx;height:1.5px;'
                   'background:var(--cream);opacity:.4"></div>'
                   % (tx + 40, divider_y, tw - 80))
    if hook:
        out.append(label("LISTEN label", "LISTEN OUT FOR",
                         hook_y + 12, solo_mid - 42))
        out.append(para("LISTEN", hook,
                        [(0, TYPE["body"]), (60, 23), (95, 20)],
                        hook_y + 62, solo_mid + 14, 78))
    return "\n".join(out)


def back(work, color, map_uri):
    """Card 2 — the context card: where, why, and what to listen for."""
    p = MAP_PANEL

    out = [rect("CARD ground", 0, 0, CARD["w"], CARD["h"], color)]
    out.append(card_strap(BB["strap"], [
        {"layer": "PLACE", "text": work["composition"]["place"],
         "size": TYPE["place"], "tracking": 20, "centre": BB["strap"]["mid"],
         "steps": [(0, TYPE["place"]), (10, 40), (14, 34), (19, 28)]},
    ]))
    out.append(text_layer("REGION", I["x"] + 8, BB["region"]["y"] + 3, I["w"] - 16,
                          32, work["composition"]["country_then"],
                          fit_size(work["composition"]["country_then"],
                                   [(0, TYPE["region"]), (26, 21), (34, 18)]),
                          "var(--serif)", italic=True, opacity=.88))

    if map_uri or work["map"].get("has_place"):
        out.append(rect("MAP rule top", I["x"], BB["ruleA"]["y"], I["w"],
                        BB["ruleA"]["h"], "var(--cream)"))
        out.append(duotone_panel("MAP", p["x"], p["y"], p["w"], p["h"], map_uri,
                                 color, DUOTONE["mapLift"],
                                 '<div class="pin"><i></i><b></b><s></s></div>'))
        out.append(rect("MAP rule bottom", I["x"], BB["ruleB"]["y"], I["w"],
                        BB["ruleB"]["h"], "var(--cream)"))

    out.append(story_slab(work))
    out.append(card_chrome())
    return "\n".join(out)

# --------------------------------------------------------------------- page

CSS = """
:root {
  --cream:%(cream)s; --ink:%(ink)s; --bg:%(bg)s;
  /* Windows/Adobe stock only — see the constraints note. Trajan Pro 3 ships
     Regular alone, so there is no bold caps face to ask for. */
  --serif: Cambria, "Times New Roman", Georgia, serif;
  --caps: "Trajan Pro 3", Cinzel, Optima, Palatino, "Palatino Linotype", serif;
}
* { box-sizing: border-box; }
body {
  margin:0; padding:40px; background:#15161a; color:#d8d4cc;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
}
h1 { font-size:20px; margin:0 0 6px; color:#fff; letter-spacing:.01em; }
h2 { font-size:13px; text-transform:uppercase; letter-spacing:.18em;
     color:#8d8a83; margin:40px 0 14px; font-weight:600; }
.note { max-width:860px; line-height:1.6; font-size:13.5px; color:#b6b2aa;
        background:#1d1f24; border:1px solid #2c2f36; border-left:3px solid #CD9D47;
        padding:16px 20px; border-radius:6px; margin:18px 0 8px; }
.note b { color:#efe9dd; }
.note code { background:#2a2d34; padding:1px 5px; border-radius:3px;
             font-size:12.5px; color:#e6c98a; }
.note ul { margin:10px 0 0; padding-left:20px; }
.note li { margin:5px 0; }
.rowlabel { font-size:12px; color:#8d8a83; margin:0 0 8px;
            text-transform:uppercase; letter-spacing:.14em; }
.grid { display:flex; flex-wrap:wrap; gap:36px; align-items:flex-start; }
.pair { display:flex; gap:18px; }

/* ---- the card itself: 440x616, top-left coordinates, 1px = 1 AE px ----
   overflow:hidden on a rounded box is the browser's version of the
   "CARD corners" even-odd shape layer: it clips the full-bleed art. */
.card { position:relative; width:440px; height:616px; flex:none;
        border-radius:%(round)gpx; overflow:hidden;
        filter: drop-shadow(0 14px 30px rgba(0,0,0,.65)); }
.card .ly { position:absolute; }
.card .ly > span { display:block; width:100%%; }
.card img { width:100%%; height:100%%; object-fit:cover; object-position:50%% 20%%;
            display:block; filter:grayscale(1) contrast(1.12) brightness(1.06); }
.ring { pointer-events:none; }

/* NUMBER: two runs, because one AE text layer is one style. */
.num { display:flex; align-items:flex-start; gap:8px; color:var(--cream);
       opacity:.92; }
.num span { font-family:var(--caps); font-size:22px; line-height:1;
            letter-spacing:.06em; padding-top:16px; }
.num b { font-family:var(--serif); font-weight:700; font-size:96px;
         line-height:.9; }

/* addMapPin: dark halo / cream ring / cream dot, centred on the panel */
.pin { position:absolute; left:50%%; top:50%%; }
.pin i, .pin b, .pin s {
  position:absolute; border-radius:50%%; transform:translate(-50%%,-50%%); }
.pin i { width:34px; height:34px; background:var(--ink); opacity:.5; }
.pin b { width:22px; height:22px; border:3px solid var(--cream); }
.pin s { width:8px;  height:8px;  background:var(--cream); }

/* ---- the reel: what it actually looks like on a phone ---- */
.reelwrap { width:%(reelw)gpx; height:%(reelh)gpx; overflow:hidden;
            border-radius:14px; position:relative; flex:none; }
.reel { width:1080px; height:1920px; background:var(--bg); position:relative;
        transform:scale(%(reelscale)g); transform-origin:top left; }
.reel .card { position:absolute; }
.safe { position:absolute; left:0; right:0; border:1px dashed rgba(255,255,255,.22);
        color:rgba(255,255,255,.5); font-size:22px; padding:8px 14px; }
"""


def page(cards, reel_html):
    css = CSS % dict(
        {k: hexcol(v) for k, v in COL.items()},
        round=FRAME["round"],
        reelw=1080 * 0.30, reelh=1920 * 0.30, reelscale=0.30)
    return """<!doctype html>
<html><head><meta charset="utf-8">
<title>Symphony of the Day — card design mirror</title>
<style>%s</style></head><body>

<h1>Symphony of the Day — collector cards</h1>
<div class="note">
<b>What this is.</b> A pixel mirror of two After Effects card comps, at their real
size of <b>440&nbsp;&times;&nbsp;616</b> (5:7, standard trading-card ratio). Every
element carries the AE layer name it maps to, as
<code>data-layer="TITLE"</code>. Coordinates are top-left in card space and are
the same numbers the build script uses, so a change here ports directly.
<b>Please keep the <code>data-layer</code> names</b> on anything you keep, and add
one for anything new.
</div>

<div class="note">
<b>The design is &ldquo;duotone poster&rdquo;.</b> The card <i>is</i> its period colour,
edge to edge, and the portrait and map are duotoned into it — greyscale, a
period-colour multiply, a cream screen to lift the blacks. So a viewer reads
&ldquo;which era&rdquo; as pure colour before reading a word. The palette lives in
<code>data/periods.json</code>, one hex per period; adding a fifth period means
adding a colour there, not editing code. Everything on the card is cream
(<code>#F4ECDC</code>) and the only chrome is a 7&nbsp;px ring of
<code>#14110F</code>.
</div>

<div class="note">
<b>What can actually be rebuilt.</b> These cards are generated by ExtendScript as
AE shape and box-text layers — not exported from a browser. So:
<ul>
<li><b>Fonts are Windows/Adobe stock only</b>, so the project opens on any machine:
<code>Cambria</code> (regular/bold/italic) and <code>Trajan&nbsp;Pro&nbsp;3</code> for
caps — <b>Regular only</b>, there is no bold Trajan to ask for. No webfonts.</li>
<li><b>Cheap:</b> rounded rectangles (one radius for all four corners), ellipses,
strokes, solid fills, opacity, blend modes, drop shadows, Black&nbsp;&amp;&nbsp;White.</li>
<li><b>Expensive or impossible:</b> per-corner radii, <code>backdrop-filter</code>,
arbitrary <code>clip-path</code>, text on a path, and mixed styling inside one text
run — each AE text layer is a single style, so the 26&nbsp;px &ldquo;No.&rdquo; and the
112&nbsp;px numeral beside it are two layers, not one.</li>
<li><b>All text is data-bound and varies in length.</b> Titles run 33&ndash;46
characters, surnames 5&ndash;13, the occasion 0&ndash;150 and is sometimes empty —
the slab stays either way. Text auto-shrinks in steps to fit. Any layout must
tolerate reflow — do not tune a box to one work's string.</li>
<li><b>The real test is the reel at the bottom of this page</b>, not the big cards.
That is the size a viewer actually sees on a phone, with room left for captions
and the platform UI.</li>
</ul>
</div>

%s

<h2>On the reel — 1080&times;1920, actual proportions</h2>
<div class="note"><b>One card at a time.</b> Card 1 flips in, holds while you
talk, then turns over into card 2 &mdash; the two never share the screen, so each
gets the full %g%% scale instead of half the width. The turn is one slider
(<code>Turn At</code>) so it can be matched to a voiceover. The dashed zones are
where the platform puts its own UI and where burned-in captions go: <b>the card
must stay clear of both, and stay legible at this size.</b></div>
%s

</body></html>""" % (css, cards, REEL["scale"] * 100, reel_html)


def main():
    table = json.load(open(os.path.join(ROOT, "data", "periods.json"),
                           encoding="utf-8"))
    blocks = []
    reel_cards = None

    for slug in SLUGS:
        wpath = os.path.join(ROOT, "data", "works", slug + ".json")
        work = json.load(open(wpath, encoding="utf-8"))
        color = period_color(work, table)

        ppath = os.path.join(ROOT, work["composer"]["portrait"].replace("/", os.sep)) \
            if work["composer"].get("portrait") else None
        purl = data_uri(ppath, (PORTRAIT_PANEL["w"], PORTRAIT_PANEL["h"])) \
            if ppath and os.path.exists(ppath) else ""

        mpath = os.path.join(ROOT, "data", "maps", slug + ".png")
        murl = data_uri(mpath, (MAP_PANEL["w"], MAP_PANEL["h"])) \
            if os.path.exists(mpath) else ""

        f, b = front(work, color, purl), back(work, color, murl)
        blocks.append(
            '<p class="rowlabel">%s &mdash; %s &mdash; %s</p>\n'
            '<div class="pair"><div class="card" data-comp="CARD FRONT">%s</div>'
            '<div class="card" data-comp="CARD BACK">%s</div></div>'
            % (esc(slug), esc(work["title_full"]), esc(color), f, b))
        if reel_cards is None:
            reel_cards = (f, b)

    cards = ('<h2>The three built works &mdash; front and back</h2>'
             '<div class="grid" style="flex-direction:column">%s</div>'
             % "\n".join(blocks))

    # On the reel, at the CTRL slider defaults. One card at a time now, so the
    # two states are two separate frames: before the turn, and after it.
    cw = CARD["w"] * REEL["scale"]
    ch = CARD["h"] * REEL["scale"]
    left = REEL["w"] / 2.0 - cw / 2.0
    top = REEL["y"] - ch / 2.0

    def frame(label, comp, html):
        return (
            '<figure style="margin:0;display:flex;flex-direction:column;gap:10px">'
            '<figcaption style="font-size:12px;letter-spacing:.14em;'
            'text-transform:uppercase;color:#8d8a83">%s</figcaption>'
            '<div class="reelwrap"><div class="reel">'
            '<div class="safe" style="top:0;height:%gpx">caption / talking head</div>'
            '<div class="safe" style="bottom:0;height:250px">platform UI</div>'
            '<div class="card" data-comp="%s" style="left:%gpx;top:%gpx;'
            'transform:scale(%g);transform-origin:top left">%s</div>'
            '</div></div></figure>'
            % (label, REEL["videoBottom"], comp, left, top, REEL["scale"], html))

    reel = ('<div style="display:flex;gap:28px;align-items:flex-start">'
            + frame("Card 1 &middot; details", "CARD FRONT", reel_cards[0])
            + frame("Card 2 &middot; context", "CARD BACK", reel_cards[1])
            + '</div>')


    outdir = os.path.join(ROOT, "design")
    if not os.path.isdir(outdir):
        os.makedirs(outdir)
    out = os.path.join(outdir, "cards.html")
    with open(out, "w", encoding="utf-8") as fh:
        fh.write(page(cards, reel))
    print("wrote %s (%.0f KB)" % (out, os.path.getsize(out) / 1024.0))


if __name__ == "__main__":
    sys.exit(main())
