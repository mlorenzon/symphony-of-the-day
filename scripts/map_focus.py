#!/usr/bin/env python3
"""
Work out which historical polity the city of composition sat inside, and record
it on the work so the card can highlight and label it.

Why this is a script and not a string somebody types: `country_then` on a work is
prose for a human ("Duchy of Styria, Austria-Hungary"), while the map is drawn
from a geojson whose features carry a `NAME` that After Effects turns verbatim
into a shape-group name ("Austria Hungary"). Highlighting the right shape means
matching that exact string, so it has to be read off the same file the map is
drawn from — never typed.

The match itself is geometric, not textual: point-in-polygon on the composition
coordinates. That is the part which cannot be wrong for a subtle reason.

    python scripts/map_focus.py brahms-no-4
    python scripts/map_focus.py --all --dry-run
    python scripts/map_focus.py mozart-linz --label "Holy Roman Empire"

Writes `map.focus` into data/works/<slug>.json:

    "focus": {
      "name":   "Austria Hungary",   the geojson NAME — what AE matches on
      "label":  "Austria-Hungary",   what the card prints
      "source": "research",          research | given | dataset
      "match":  "contains",          contains | nearest | unnamed | none
      "groups": 1,                   shapes AE should highlight — a cross-check
      "note":   ""
    }

**`name` and `label` are two different questions and must not be conflated.**
`name` is a lookup key: whatever string the basemap happens to use, warts and
anachronisms included, because that is what After Effects matches. `label` is an
assertion about history that a viewer reads, so it comes from the research
record — `composition.place.polity`, fact-checked against Grove — whenever there
is one. The basemap's spelling is the last resort, not the default: its 1783 and
1800 snapshots both say "Austrian Empire" for a state not proclaimed until 1804.

`source` records which of the three won, so a card printing the basemap's word
is visible rather than assumed.

`groups` is the point of the exercise as much as `name` is. A polity split
across several features (Prussia is four in 1815) becomes several shape groups
with the same name, and all of them have to light up. After Effects reports how
many it actually hit, so a disagreement between these two numbers is a loud
failure instead of a quietly half-coloured country.
"""

import argparse
import json
import math
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORKS_DIR = os.path.join(ROOT, "data", "works")
RESEARCH_DIR = os.path.join(ROOT, "data", "research")

# Features whose NAME is null are all drawn by GEOlayers as a group literally
# called "Feature" — there were 39 of them in the 1815 snapshot. Matching on
# that name would highlight every unnamed polity on the continent, so an
# unnamed focus is refused rather than guessed at.
UNNAMED_GROUP = "Feature"

# Tried in order when NAME is missing, purely to tell a human which polity was
# actually found. None of these can be used to target a shape.
NAME_FALLBACKS = ("SUBJECTO", "PARTOF", "ABBREVN")

# How much of the square mapcomp's height the card's map panel actually shows.
# CFG.mapPanel is 412x214 (CFG.back.map) against a 1080x1080 mapcomp scaled to
# fill the width, so 214/412 of the height survives the crop. Keep in step with
# CFG.back.map in scripts/sotd.jsx -- getting this wrong does not error, it just
# puts the label further down the panel than intended.
CARD_HEIGHT_FRACTION = 214.0 / 412.0

# How far from the city the label anchor may sit, as a fraction of the final
# view's half-span. These are not "how much of the frame is visible" — they are
# "how much room is left once the label itself is drawn". At the end of the move
# two lines of caps span roughly a third of the panel, so the anchor lives well
# inside the middle. ANCHOR_LAT_MIN pushes it *off* the city's own latitude, so
# it never lands on the pin, which is always at dead centre.
ANCHOR_LON_FRACTION = 0.08
ANCHOR_LAT_MIN = 0.60
ANCHOR_LAT_MAX = 0.72


# ------------------------------------------------------------------ geometry

def _rings(geometry):
    """Every polygon in a geometry, as (exterior, [holes...]) in lon/lat."""
    if not geometry:
        return []
    kind = geometry.get("type")
    coords = geometry.get("coordinates") or []
    if kind == "Polygon":
        polys = [coords]
    elif kind == "MultiPolygon":
        polys = coords
    else:
        return []
    out = []
    for poly in polys:
        if poly:
            out.append((poly[0], poly[1:]))
    return out


def _in_ring(lon, lat, ring):
    """Ray casting. Points exactly on an edge are not worth special-casing:
    a city sitting on its own border to 12 decimal places does not happen."""
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > lat) != (yj > lat):
            x = (xj - xi) * (lat - yi) / (yj - yi) + xi
            if lon < x:
                inside = not inside
        j = i
    return inside


def contains(geometry, lon, lat):
    for outer, holes in _rings(geometry):
        if not _in_ring(lon, lat, outer):
            continue
        if any(_in_ring(lon, lat, h) for h in holes):
            continue          # in a hole — an enclave belonging to someone else
        return True
    return False


def _ring_area(ring):
    """Twice the signed shoelace area, in square degrees. Only ever compared
    against other features in the same file, so the projection does not matter
    and neither does the sign."""
    total = 0.0
    n = len(ring)
    j = n - 1
    for i in range(n):
        total += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1])
        j = i
    return abs(total)


def area(geometry):
    return sum(_ring_area(outer) - sum(_ring_area(h) for h in holes)
               for outer, holes in _rings(geometry))


def _dist2_to_segment(lon, lat, a, b):
    ax, ay = a[0], a[1]
    bx, by = b[0], b[1]
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return (lon - ax) ** 2 + (lat - ay) ** 2
    t = ((lon - ax) * dx + (lat - ay) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    return (lon - (ax + t * dx)) ** 2 + (lat - (ay + t * dy)) ** 2


def distance_deg(geometry, lon, lat):
    """Distance to the nearest boundary, in degrees. Crude — degrees are not a
    length — but it is only ever used to rank candidates against each other and
    to print a number a human can sanity-check."""
    best = float("inf")
    for outer, holes in _rings(geometry):
        for ring in [outer] + list(holes):
            for i in range(len(ring)):
                d = _dist2_to_segment(lon, lat, ring[i - 1], ring[i])
                if d < best:
                    best = d
    return best ** 0.5 if best < float("inf") else None


# -------------------------------------------------------------- label anchor

def _bbox(geometry):
    xs, ys = [], []
    for outer, _ in _rings(geometry):
        for x, y in [(p[0], p[1]) for p in outer]:
            xs.append(x)
            ys.append(y)
    return (min(xs), min(ys), max(xs), max(ys)) if xs else None


def pole_of_inaccessibility(geometry, precision=0.05):
    """The point furthest from any boundary — i.e. where a cartographer would
    print the country's name.

    A centroid is the obvious choice and the wrong one: for anything crescent-
    shaped or split across islands it lands outside the polygon entirely, which
    on this design would print "Habsburg Monarchy" over Bavaria. This is the
    usual grid-and-refine search instead, which is guaranteed to return an
    interior point.
    """
    box = _bbox(geometry)
    if not box:
        return None
    w, s, e, n = box
    best, best_d = None, -1.0
    step = max((e - w) / 24.0, (n - s) / 24.0, precision)

    for _ in range(12):                      # bounded: refine, never spin
        y = s
        while y <= n:
            x = w
            while x <= e:
                if contains(geometry, x, y):
                    d = distance_deg(geometry, x, y) or 0.0
                    if d > best_d:
                        best, best_d = (x, y), d
                x += step
            y += step
        if best is None:
            # The grid fell entirely between the polygon's edges — a sliver.
            # Halve and sweep again rather than giving up.
            step /= 2.0
            if step < precision / 4.0:
                return None
            continue
        if step <= precision:
            break
        # Refine around the winner rather than re-sweeping the whole bbox.
        w, e = best[0] - step, best[0] + step
        s, n = best[1] - step, best[1] + step
        step /= 3.0

    if best is None:
        return None
    return {"lon": round(best[0], 4), "lat": round(best[1], 4),
            "clearance_deg": round(best_d, 4)}


def label_anchor(geometry, lon, lat, half_span, visible_half_lat):
    """Where to pin the label: on the territory, but still on screen at the end.

    Two requirements pull against each other. The label should sit on the
    highlighted country like a name printed on a map — and it should still be
    in frame when the move finishes. The move is a *pure zoom about the city*
    (the view centre never changes), so a point d degrees from the city sits d /
    half_span of the way to the frame edge at any moment, and the final
    half_span is the small one. A label on the far side of a large country is
    therefore off screen at the end, every time.

    So: take the pole of inaccessibility, then pull it back inside the box that
    is still visible at the end, and walk it toward the city until it is inside
    the polygon again. `fit` records which happened, because a clamped anchor
    means the label is no longer where a cartographer would have put it.
    """
    pole = pole_of_inaccessibility(geometry)
    if not pole:
        return {"lon": lon, "lat": lat, "fit": "city", "clearance_deg": 0.0}

    # Keep well inside the frame. The label is wide — two lines of caps is still
    # about a third of the panel at the end of the move — so the anchor has to
    # sit much closer to the centre than "inside the frame" would suggest.
    max_dlon = half_span * ANCHOR_LON_FRACTION
    max_dlat = visible_half_lat * ANCHOR_LAT_MAX
    x = min(max(pole["lon"], lon - max_dlon), lon + max_dlon)
    y = min(max(pole["lat"], lat - max_dlat), lat + max_dlat)

    # And push it off the city's own latitude, or at the end of the move it
    # lands on top of the pin — which sits dead centre by construction, because
    # the view is always aimed at a bbox centred on the city.
    keep_out = visible_half_lat * ANCHOR_LAT_MIN
    if abs(y - lat) < keep_out:
        away = -1.0 if (y <= lat) else 1.0     # continue the way the pole lies
        y = lat + away * keep_out

    fit = "pole" if (x, y) == (pole["lon"], pole["lat"]) else "clamped"

    if not contains(geometry, x, y):
        # Clamping can push the anchor over a border. Walk back toward the city,
        # which is inside the territory by construction.
        for t in (0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1.0):
            cx, cy = x + (lon - x) * t, y + (lat - y) * t
            if contains(geometry, cx, cy):
                x, y, fit = cx, cy, "clamped"
                break
        else:
            return {"lon": lon, "lat": lat, "fit": "city", "clearance_deg": 0.0}

    return {"lon": round(x, 4), "lat": round(y, 4), "fit": fit,
            "clearance_deg": pole["clearance_deg"]}


# --------------------------------------------------------------------- match

def feature_name(feature):
    props = feature.get("properties") or {}
    name = props.get("NAME")
    return name.strip() if isinstance(name, str) and name.strip() else ""


def descriptive_name(feature):
    """A name for the report when NAME is missing. Not usable for matching."""
    props = feature.get("properties") or {}
    for key in NAME_FALLBACKS:
        v = props.get(key)
        if isinstance(v, str) and v.strip():
            return "%s (%s)" % (v.strip(), key)
    return "(no name in any property)"


def resolve(features, lon, lat, anchor_for=None):
    """Which feature holds this point, and how confident we are about it.

    `anchor_for` is `(half_span, visible_half_lat)` in degrees, from the work's
    final view. Pass it to also compute where on the territory the label sits.
    """
    hits = [f for f in features if contains(f.get("geometry"), lon, lat)]

    if hits:
        # Overlapping polities do occur in these snapshots — a vassal drawn
        # inside its suzerain. The smallest one is the specific answer.
        hits.sort(key=lambda f: area(f.get("geometry")))
        chosen, match, note = hits[0], "contains", ""
        if len(hits) > 1:
            note = "point falls in %d overlapping features; took the smallest" % len(hits)

    else:
        # No polygon holds it — an island, a coastal rounding error, or a city
        # that the clip cut away. Nearest boundary is a suggestion for a human,
        # never applied silently.
        ranked = sorted(
            ((distance_deg(f.get("geometry"), lon, lat), f) for f in features),
            key=lambda p: (p[0] is None, p[0]))
        if not ranked or ranked[0][0] is None:
            return {"name": "", "label": "", "match": "none", "groups": 0,
                    "note": "no feature contains or is near the place"}
        dist, chosen = ranked[0]
        match = "nearest"
        note = "no feature contains the place; nearest boundary is %.3f deg away" % dist

    name = feature_name(chosen)
    if not name:
        return {"name": "", "label": "", "match": "unnamed", "groups": 0,
                "note": ("the polity here has no NAME — it draws as a group called "
                         "'%s', which every unnamed feature shares, so it cannot be "
                         "targeted. Found: %s"
                         % (UNNAMED_GROUP, descriptive_name(chosen)))}

    groups = sum(1 for f in features if feature_name(f) == name)
    out = {"name": name, "label": name, "match": match, "groups": groups,
           "note": note}
    if anchor_for is not None:
        half_span, visible_half_lat = anchor_for
        # The anchor is taken from the chosen feature alone, not the union of
        # every feature sharing its name. For a split polity that means the
        # label lands on the piece the city is in, which is the one on screen.
        out["anchor"] = label_anchor(chosen.get("geometry"), lon, lat,
                                     half_span, visible_half_lat)
    return out


# ---------------------------------------------------------------------- work

def read_json(path):
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def work_path(slug):
    return os.path.join(WORKS_DIR, slug + ".json")


def final_view(work):
    """(half_span, visible_half_lat) in degrees for the end of the move.

    Longitude is easy: the view is exactly half_span either side of the city.
    Latitude is not, because the card crops the middle band of a square comp,
    and because a degree of latitude is worth less than a degree of longitude
    on a Mercator projection the further north you are.
    """
    m = work.get("map") or {}
    lat = (work.get("composition") or {}).get("lat") or 0.0
    half_span = m.get("half_span_lon") or 6.0
    return half_span, half_span * CARD_HEIGHT_FRACTION * math.cos(math.radians(lat))


def focus_for_work(work):
    """Resolve the focus polity for an already-loaded work. Returns the focus
    dict, or one with match 'none' explaining why not."""
    m = work.get("map") or {}
    comp = work.get("composition") or {}
    lon, lat = comp.get("lon"), comp.get("lat")
    if lon is None or lat is None:
        return {"name": "", "label": "", "match": "none", "groups": 0,
                "note": "work has no coordinates"}
    rel = m.get("geojson")
    if not rel:
        return {"name": "", "label": "", "match": "none", "groups": 0,
                "note": "work has no clipped geojson; run prepare_work.py"}
    path = os.path.join(ROOT, rel.replace("/", os.sep))
    if not os.path.exists(path):
        return {"name": "", "label": "", "match": "none", "groups": 0,
                "note": "missing %s; run prepare_work.py" % rel}

    # How much of the world is on screen at the end of the move, which is what
    # decides whether a label anchored out on the territory is still in shot.
    return resolve(read_json(path).get("features") or [], lon, lat,
                   anchor_for=final_view(work))


def researched_polity(slug):
    """The fact-checked country of composition, if this work has been researched.

    `composition.place.polity` in data/research/<slug>.json. Read live rather
    than copied once, so correcting the research record and re-running is the
    whole of a relabel — there is no second place the wrong name can survive.
    """
    path = os.path.join(RESEARCH_DIR, str(slug) + ".json")
    if not os.path.exists(path):
        return ""
    try:
        rec = read_json(path)
    except (ValueError, OSError):
        return ""
    polity = (((rec.get("composition") or {}).get("place") or {}).get("polity") or "")
    return polity.strip()


def apply_nudge(work, focus, nudge=None):
    """Shift the computed anchor by a hand-set offset in degrees.

    The automatic anchor is a point — it knows where the territory's interior
    is, and nothing whatever about the label that gets printed there. The label
    is wide (two-thirds of the panel is normal), and it is centred on the
    anchor, so a point that is comfortably inside the territory can still put
    the first letter of the name on top of a border, or the last letter off the
    edge of the card. Only a render shows that, so only a human can call it.

    So this is the escape hatch, and it works like a hand-set `--label`: an
    explicit `--nudge-lon/--nudge-lat` is recorded on the work and survives
    later re-runs, but only while the polity underneath is unchanged. Re-clipping
    onto a different basemap year can put a different country under the city,
    and yesterday's hand-tuned offset would be meaningless on it.
    """
    anchor = focus.get("anchor")
    if not anchor:
        return focus

    previous = ((work.get("map") or {}).get("focus") or {})
    prev_anchor = previous.get("anchor") or {}
    if nudge is None and previous.get("name") == focus.get("name"):
        nudge = prev_anchor.get("nudge")
    if not nudge:
        return focus

    dlon = float(nudge.get("lon", 0.0))
    dlat = float(nudge.get("lat", 0.0))
    if not (dlon or dlat):
        return focus

    anchor["auto"] = {"lon": anchor["lon"], "lat": anchor["lat"]}
    anchor["nudge"] = {"lon": round(dlon, 4), "lat": round(dlat, 4)}
    anchor["lon"] = round(anchor["lon"] + dlon, 4)
    anchor["lat"] = round(anchor["lat"] + dlat, 4)
    anchor["fit"] = "nudged"

    # A nudge is deliberate, so it is applied whatever it does — but say so if
    # it walks the anchor off the frame or off the territory.
    comp = work.get("composition") or {}
    lon, lat = comp.get("lon"), comp.get("lat")
    half_span, visible_half_lat = final_view(work)
    warn = []
    if lon is not None and abs(anchor["lon"] - lon) > half_span:
        warn.append("outside the final view in longitude")
    if lat is not None and abs(anchor["lat"] - lat) > visible_half_lat:
        warn.append("outside the final view in latitude")
    if warn:
        anchor["nudge_warning"] = "; ".join(warn)
    return focus


def apply_focus(work, focus, label=None):
    """Merge a resolved focus into a work and decide what the card will print.

    Three sources, in order, and the order is the point:

    1. **`--label`** — an explicit instruction from whoever is running this.
    2. **The research record** — `composition.place.polity`, checked against
       Grove. This is the authoritative answer and the one that should normally
       win, because it is the only one that was ever verified as history.
    3. **The basemap's own `NAME`** — a lookup key that happens to read like a
       country. Last resort: aourednik's 1783 and 1800 snapshots both call the
       Habsburg lands the "Austrian Empire", a state not proclaimed until August
       1804, so taking this as the label prints a plain anachronism.

    Note that only the *label* is chosen here. `focus["name"]` stays exactly as
    the geojson spells it whatever happens, because that is what After Effects
    matches on — correcting the history must never break the highlight.
    """
    previous = (work.get("map") or {}).get("focus") or {}
    dataset = focus["name"]
    polity = researched_polity(work.get("slug"))

    if label:
        focus["label"], focus["source"] = label, "given"
    elif polity:
        focus["label"], focus["source"] = polity, "research"
    elif (previous.get("label") and previous.get("name") == dataset and dataset
            and previous.get("source") == "given"):
        # A hand-set label survives a re-run — but only while the polity under
        # it is unchanged. Re-clipping onto a different basemap year can put a
        # different country under the city, and carrying yesterday's label onto
        # it would be worse than losing the edit.
        focus["label"], focus["source"] = previous["label"], "given"
    else:
        focus["label"] = dataset
        focus["source"] = "dataset" if dataset else "none"

    work.setdefault("map", {})["focus"] = focus
    return focus


def describe(slug, work, focus):
    comp = work.get("composition") or {}
    lines = ["%-26s %s %s" % (slug, comp.get("place", "?"),
                              "(%s, %s)" % (comp.get("lon"), comp.get("lat")))]
    lines.append("  match   : %s" % focus["match"])
    lines.append("  name    : %s   (highlight key, from the basemap)" % (focus["name"] or "—"))
    lines.append("  label   : %s   (printed; source: %s)"
                 % (focus["label"] or "—", focus.get("source", "?")))
    lines.append("  groups  : %d" % focus["groups"])
    a = focus.get("anchor")
    if a:
        lines.append("  anchor  : %.3f, %.3f  (%s, clearance %.2f deg)"
                     % (a["lon"], a["lat"], a["fit"], a.get("clearance_deg", 0)))
        if a.get("nudge"):
            lines.append("  nudge   : %+.3f, %+.3f  (hand-set; auto was %.3f, %.3f)"
                         % (a["nudge"]["lon"], a["nudge"]["lat"],
                            a["auto"]["lon"], a["auto"]["lat"]))
        if a.get("nudge_warning"):
            lines.append("  ACTION  : the nudge puts the anchor %s." % a["nudge_warning"])
        if a["fit"] == "city":
            lines.append("  ACTION  : no interior point of the territory stays in "
                         "frame — the label falls back to the city.")
        # The anchor is a point; the label is a wide piece of type centred on
        # it. When the anchor is pinned to the longitude limit it is sitting
        # about as close to the city as it can, which puts the label centred
        # under the pin and its first letters out over the border the territory
        # was clamped away from. Both are things only a render shows.
        comp_lon = comp.get("lon")
        if a["fit"] == "clamped" and comp_lon is not None:
            half_span, _ = final_view(work)
            # Loose: the anchor is stored rounded to 4dp against an unrounded
            # city longitude, so an exact comparison misses the works whose
            # coordinates carry more decimals than that.
            at_limit = abs(abs(a["lon"] - comp_lon)
                           - half_span * ANCHOR_LON_FRACTION) < 1e-3
            if at_limit:
                lines.append("  LOOK    : the anchor is pinned to its longitude "
                             "limit, so the label will print centred under the pin "
                             "and may cross the border it was clamped back from. "
                             "Bake it, look at the map panel, and if the name "
                             "clashes, re-run with --nudge-lon.")
    if focus["note"]:
        lines.append("  note    : %s" % focus["note"])
    if focus["match"] in ("nearest", "unnamed", "none"):
        lines.append("  ACTION  : set map.focus.name by hand, or leave it empty "
                     "to skip the highlight")
    if focus.get("source") == "dataset" and focus["label"]:
        lines.append("  ACTION  : the label is the basemap's own wording, which is "
                     "unverified and sometimes anachronistic. Set "
                     "composition.place.polity in the research record.")
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser(
        description="Resolve the focus polity for a work and record it on the work JSON.")
    ap.add_argument("slug", nargs="?", help="work slug, e.g. brahms-no-4")
    ap.add_argument("--all", action="store_true", help="every work in data/works")
    ap.add_argument("--dry-run", action="store_true", help="report, write nothing")
    ap.add_argument("--label", help="override the printed label (implies this slug only)")
    ap.add_argument("--nudge-lon", type=float, default=None,
                    help="shift the label anchor east(+)/west(-) by this many degrees, "
                         "for when the printed name clashes with a border or an edge")
    ap.add_argument("--nudge-lat", type=float, default=None,
                    help="shift the label anchor north(+)/south(-) by this many degrees")
    args = ap.parse_args()

    nudge = None
    if args.nudge_lon is not None or args.nudge_lat is not None:
        nudge = {"lon": args.nudge_lon or 0.0, "lat": args.nudge_lat or 0.0}

    if args.all:
        slugs = sorted(f[:-5] for f in os.listdir(WORKS_DIR) if f.endswith(".json"))
    elif args.slug:
        slugs = [args.slug]
    else:
        ap.error("give a slug, or --all")

    if args.label and len(slugs) != 1:
        ap.error("--label applies to one work at a time")
    if nudge and len(slugs) != 1:
        ap.error("--nudge-lon/--nudge-lat apply to one work at a time")

    problems = 0
    for slug in slugs:
        path = work_path(slug)
        if not os.path.exists(path):
            print("%-26s no such work: %s" % (slug, path))
            problems += 1
            continue
        work = read_json(path)
        # The nudge is read against the work as it stands, so it has to be
        # applied before apply_focus overwrites map.focus with the new one.
        focus = apply_nudge(work, focus_for_work(work), nudge)
        focus = apply_focus(work, focus, args.label)
        print(describe(slug, work, focus))
        if focus["match"] != "contains" or focus.get("source") == "dataset":
            problems += 1
        if not args.dry_run:
            with open(path, "w", encoding="utf-8") as fh:
                json.dump(work, fh, indent=2, ensure_ascii=False)
        print("")

    if args.dry_run:
        print("dry run — nothing written")
    else:
        print("wrote map.focus on %d work(s)" % len(slugs))
    print("\nNext, in After Effects, for each work whose map is not yet baked:")
    print('  SOTD.mapDraw(slug) -> mapStatus() -> mapFinish(slug)   # highlights the focus')
    print('  SOTD.buildWork(slug)                                   # picks up the label')
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
