#!/usr/bin/env python3
"""Assemble everything one "symphony of the day" reel needs, into a single JSON.

Looks the composer up on Wikidata for dates and a public-domain portrait, looks
the place of composition up for coordinates, picks the historical basemap
snapshot closest to (and not after) the year of composition, clips it, and
writes data/works/<slug>.json.

That JSON is the only thing After Effects reads: scripts/sotd.jsx binds every
text layer on both cards to it through expressions.

    python scripts/prepare_work.py \
        --composer "Wolfgang Amadeus Mozart" \
        --title 'Symphony No. 36 in C major, K. 425 "Linz"' \
        --year 1783 \
        --place "Linz" \
        --context "Written in four days for a concert at the Linz theatre."

Any field fetched from Wikidata can be overridden with the matching flag.
Run with --dry-run to see what it would find without writing anything.
"""
import argparse
import io
import json
import os
import re
import subprocess
import sys
import unicodedata

try:
    import requests
except ImportError:
    sys.exit("prepare_work.py needs `requests`:  pip install requests")

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DATA = os.path.join(ROOT, "data")
WORKS_DIR = os.path.join(DATA, "works")
PORTRAIT_DIR = os.path.join(DATA, "portraits")
CACHE_DIR = os.path.join(DATA, ".cache")
BASEMAP_DIR = os.path.join(DATA, "historical-basemaps", "geojson")
CLIPPED_DIR = os.path.join(DATA, "clipped")
PERIODS_FILE = os.path.join(DATA, "periods.json")
CLIP_SCRIPT = os.path.join(DATA, "clip_region.py")

UA = "symphony-of-the-day/1.0 (https://github.com/; motion-graphics research)"
WD_API = "https://www.wikidata.org/w/api.php"
COMMONS_API = "https://commons.wikimedia.org/w/api.php"

# Europe box the project already uses; every clip is the union of this and a
# generous box around the city, so a wide establishing view stays available.
EUROPE_CLIP = (-35.0, 20.0, 60.0, 78.0)
CITY_CLIP_PAD_LON = 25.0
CITY_CLIP_PAD_LAT = 16.0

# Half-width, in degrees of longitude, of the map actually shown on the card.
DEFAULT_MAP_HALF_SPAN = 6.0


# --------------------------------------------------------------------------- io

def slugify(text):
    text = unicodedata.normalize("NFKD", text)
    text = text.encode("ascii", "ignore").decode("ascii").lower()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")


def cached_get(url, params, tag):
    """GET with a on-disk cache, so re-runs don't hammer the APIs."""
    os.makedirs(CACHE_DIR, exist_ok=True)
    key = slugify(tag)[:120] + ".json"
    path = os.path.join(CACHE_DIR, key)
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    resp = requests.get(url, params=params, headers={"User-Agent": UA}, timeout=30)
    resp.raise_for_status()
    payload = resp.json()
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh)
    return payload


# ---------------------------------------------------------------------- wikidata

def wd_search(term, hint=""):
    payload = cached_get(WD_API, {
        "action": "wbsearchentities", "search": term, "language": "en",
        "uselang": "en", "format": "json", "limit": 8, "type": "item",
    }, "wdsearch-" + term + "-" + hint)
    results = payload.get("search", [])
    if not results:
        return None, None
    if hint:
        for r in results:
            blob = (r.get("description", "") + " " + r.get("label", "")).lower()
            if hint.lower() in blob:
                return r["id"], r.get("label")
    return results[0]["id"], results[0].get("label")


def wd_entity(qid):
    payload = cached_get(WD_API, {
        "action": "wbgetentities", "ids": qid, "format": "json",
        "props": "claims|labels", "languages": "en",
    }, "wdent-" + qid)
    return payload.get("entities", {}).get(qid, {})


def claim_values(entity, prop):
    out = []
    for c in entity.get("claims", {}).get(prop, []):
        snak = c.get("mainsnak", {})
        if snak.get("snaktype") != "value":
            continue
        out.append(snak.get("datavalue", {}).get("value"))
    return out


def first_claim(entity, prop):
    vals = claim_values(entity, prop)
    return vals[0] if vals else None


def wd_year(entity, prop):
    """Extract a plain year from a Wikidata time claim ('+1756-01-27T...')."""
    v = first_claim(entity, prop)
    if not isinstance(v, dict):
        return None
    m = re.match(r"([+-])(\d{1,})-", v.get("time", ""))
    if not m:
        return None
    year = int(m.group(2))
    return -year if m.group(1) == "-" else year


def wd_label(qid):
    ent = wd_entity(qid)
    return ent.get("labels", {}).get("en", {}).get("value")


# ----------------------------------------------------------------------- commons

def commons_image(filename, width=1400):
    payload = cached_get(COMMONS_API, {
        "action": "query", "titles": "File:" + filename, "prop": "imageinfo",
        "iiprop": "url|extmetadata", "iiurlwidth": width, "format": "json",
    }, "commons-" + filename)
    pages = payload.get("query", {}).get("pages", {})
    for _, page in pages.items():
        infos = page.get("imageinfo") or []
        if not infos:
            continue
        info = infos[0]
        meta = info.get("extmetadata", {})

        def field(key):
            raw = meta.get(key, {}).get("value", "")
            return re.sub(r"<[^>]+>", "", raw).strip()

        return {
            "url": info.get("thumburl") or info.get("url"),
            "descriptionurl": info.get("descriptionurl"),
            "artist": field("Artist"),
            "date": field("DateTimeOriginal"),
            "licence": field("LicenseShortName"),
        }
    return None


def build_credit(image):
    bits = [b for b in (image.get("artist"), image.get("date")) if b]
    credit = ", ".join(bits) if bits else "Wikimedia Commons"
    licence = image.get("licence")
    if licence:
        credit += " (%s)" % licence
    return credit


def download_portrait(url, slug, crop_bias):
    os.makedirs(PORTRAIT_DIR, exist_ok=True)
    out_path = os.path.join(PORTRAIT_DIR, slug + ".png")
    resp = requests.get(url, headers={"User-Agent": UA}, timeout=60)
    resp.raise_for_status()
    raw = resp.content

    try:
        from PIL import Image
    except ImportError:
        # No Pillow: keep the original bytes, let the AE portrait comp crop it.
        ext = os.path.splitext(url.split("?")[0])[1] or ".jpg"
        fallback = os.path.join(PORTRAIT_DIR, slug + ext)
        with open(fallback, "wb") as fh:
            fh.write(raw)
        return fallback, None

    img = Image.open(io.BytesIO(raw)).convert("RGB")
    w, h = img.size
    side = min(w, h)
    # Faces sit above centre in almost every painted portrait, so bias the
    # square crop upwards rather than taking the middle.
    x0 = int(round((w - side) * 0.5))
    y0 = int(round((h - side) * crop_bias))
    img = img.crop((x0, y0, x0 + side, y0 + side)).resize((900, 900), Image.LANCZOS)
    img.save(out_path, "PNG")
    return out_path, (w, h)


# ---------------------------------------------------------------------- basemaps

def available_basemap_years():
    years = []
    if not os.path.isdir(BASEMAP_DIR):
        return years
    for name in os.listdir(BASEMAP_DIR):
        m = re.match(r"^world_(bc)?(\d+)\.geojson$", name)
        if not m:
            continue
        value = int(m.group(2))
        years.append((-value if m.group(1) else value, m.group(0)))
    return sorted(years)


def nearest_basemap(year):
    """The snapshot at or before `year` — the borders as they actually were."""
    years = available_basemap_years()
    if not years:
        return None, None
    at_or_before = [y for y in years if y[0] <= year]
    chosen = at_or_before[-1] if at_or_before else years[0]
    token = re.match(r"^world_(.+)\.geojson$", chosen[1]).group(1)
    return chosen[0], token


def union_bbox(a, b):
    return (min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3]))


def run_clip(token, bbox, force=False):
    out_path = os.path.join(CLIPPED_DIR, "europe_%s.geojson" % token)
    if os.path.exists(out_path) and not force:
        return out_path, "cached"
    cmd = [sys.executable, CLIP_SCRIPT, token,
           "--bbox", *["%g" % v for v in bbox]]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise SystemExit("clip_region.py failed:\n" + proc.stdout + proc.stderr)
    return out_path, proc.stdout.strip()


# ----------------------------------------------------------------------- periods

def period_for(year):
    with open(PERIODS_FILE, "r", encoding="utf-8") as fh:
        table = json.load(fh)
    for p in table["periods"]:
        if p["from"] <= year < p["to"]:
            return p["name"]
    return table["periods"][-1]["name"] if year >= table["span"][1] else table["periods"][0]["name"]


# -------------------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--composer", required=True)
    ap.add_argument("--title", required=True, help="Full title as it should read on the card")
    ap.add_argument("--year", required=True, type=int, help="Year of composition")
    ap.add_argument("--place", default="", help="Place of composition; omit if unknown")
    ap.add_argument("--context", default="",
                    help="Patron, dedication or occasion. Left blank if not given.")
    ap.add_argument("--context-label", default="Occasion")
    ap.add_argument("--slug", default="")
    ap.add_argument("--short-title", default="", help="Nickname, e.g. Linz")
    ap.add_argument("--catalogue", default="", help="e.g. K. 425")
    ap.add_argument("--number", default="", help="e.g. No. 36")

    ap.add_argument("--born", type=int, help="Override composer birth year")
    ap.add_argument("--died", type=int, help="Override composer death year")
    ap.add_argument("--nationality", default="", help="Override, e.g. Austrian")
    ap.add_argument("--lon", type=float, help="Override place longitude")
    ap.add_argument("--lat", type=float, help="Override place latitude")
    ap.add_argument("--country-then", default="",
                    help="Polity the place belonged to at the time, e.g. Archduchy of Austria")

    ap.add_argument("--map-half-span", type=float, default=DEFAULT_MAP_HALF_SPAN,
                    help="Degrees of longitude either side of the city (default %.0f)"
                         % DEFAULT_MAP_HALF_SPAN)
    ap.add_argument("--portrait-crop", type=float, default=0.18,
                    help="0 crops from the top, 0.5 from the centre (default 0.18)")
    ap.add_argument("--no-portrait", action="store_true")
    ap.add_argument("--no-clip", action="store_true")
    ap.add_argument("--force-clip", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    surname = args.composer.split()[-1]
    tail = args.short_title or args.number or args.catalogue or args.title
    slug = args.slug or slugify(surname + "-" + tail)[:60]
    report = []

    # --- composer -----------------------------------------------------------
    qid, label = wd_search(args.composer, hint="composer")
    born, died, nationality, portrait_file = args.born, args.died, args.nationality, None
    if qid:
        ent = wd_entity(qid)
        born = born or wd_year(ent, "P569")
        died = died or wd_year(ent, "P570")
        portrait_file = first_claim(ent, "P18")
        if not nationality:
            country = first_claim(ent, "P27")
            if isinstance(country, dict) and country.get("id"):
                cent = wd_entity(country["id"])
                demonym = first_claim(cent, "P1549")
                if isinstance(demonym, dict) and demonym.get("text"):
                    nationality = demonym["text"]
                else:
                    nationality = wd_label(country["id"]) or ""
        report.append("composer   : %s (%s)  b.%s d.%s  %s" %
                      (label, qid, born, died, nationality or "-"))
    else:
        report.append("composer   : NOT FOUND on Wikidata — using flags only")

    # --- place --------------------------------------------------------------
    lon, lat, place_label = args.lon, args.lat, args.place
    if args.place and (lon is None or lat is None):
        pqid, plabel = wd_search(args.place, hint="city")
        if pqid:
            pent = wd_entity(pqid)
            coord = first_claim(pent, "P625")
            if isinstance(coord, dict):
                lon = coord.get("longitude")
                lat = coord.get("latitude")
            place_label = args.place or plabel
            report.append("place      : %s (%s)  lon %.4f lat %.4f" %
                          (plabel, pqid, lon or 0, lat or 0))
        else:
            report.append("place      : '%s' NOT FOUND — pass --lon/--lat" % args.place)
    elif args.place:
        report.append("place      : %s  lon %s lat %s (from flags)" % (place_label, lon, lat))
    else:
        report.append("place      : (unknown — card will hide the map panel)")

    # --- portrait -----------------------------------------------------------
    portrait_path, portrait_credit = "", ""
    if portrait_file and not args.no_portrait:
        image = commons_image(portrait_file)
        if image and image.get("url"):
            portrait_credit = build_credit(image)
            if not args.dry_run:
                portrait_path, size = download_portrait(image["url"], slug, args.portrait_crop)
                report.append("portrait   : %s  %s" %
                              (os.path.basename(portrait_path), portrait_credit[:60]))
            else:
                report.append("portrait   : would fetch %s" % portrait_file)
        else:
            report.append("portrait   : P18 '%s' had no usable Commons file" % portrait_file)
    elif not args.no_portrait:
        report.append("portrait   : no P18 image on the composer's Wikidata item")

    # --- basemap ------------------------------------------------------------
    basemap_year, token = nearest_basemap(args.year)
    geojson_path = ""
    if token is None:
        report.append("basemap    : data/historical-basemaps missing — see README")
    else:
        clip_bbox = EUROPE_CLIP
        if lon is not None and lat is not None:
            clip_bbox = union_bbox(EUROPE_CLIP, (
                lon - CITY_CLIP_PAD_LON, lat - CITY_CLIP_PAD_LAT,
                lon + CITY_CLIP_PAD_LON, lat + CITY_CLIP_PAD_LAT))
        report.append("basemap    : %d is nearest snapshot at-or-before %d  bbox %s" %
                      (basemap_year, args.year, tuple(round(v, 1) for v in clip_bbox)))
        if not args.no_clip and not args.dry_run:
            geojson_path, note = run_clip(token, clip_bbox, args.force_clip)
            report.append("clip       : %s" % ("reused existing file" if note == "cached"
                                               else note.splitlines()[-1]))
        else:
            geojson_path = os.path.join(CLIPPED_DIR, "europe_%s.geojson" % token)

    # --- assemble -----------------------------------------------------------
    age = (args.year - born) if born else None
    work = {
        "slug": slug,
        "title_full": args.title,
        "title_short": args.short_title,
        "catalogue": args.catalogue,
        "number": args.number,
        "period": period_for(args.year),
        "composer": {
            "name": args.composer,
            "born": born,
            "died": died,
            "life": ("%s–%s" % (born, died)) if born and died else "",
            "nationality": nationality,
            "portrait": os.path.relpath(portrait_path, ROOT).replace("\\", "/") if portrait_path else "",
            "portrait_credit": portrait_credit,
            "wikidata": qid or "",
        },
        "composition": {
            "year": args.year,
            "age": age,
            "age_line": ("%s was %d" % ((label or args.composer).split()[-1], age)) if age else "",
            "place": place_label,
            "country_then": args.country_then,
            "lon": lon,
            "lat": lat,
        },
        "context": args.context,
        "context_label": args.context_label,
        "map": {
            "basemap_year": basemap_year,
            "geojson": os.path.relpath(geojson_path, ROOT).replace("\\", "/") if geojson_path else "",
            "half_span_lon": args.map_half_span,
            "has_place": lon is not None and lat is not None,
        },
    }

    print("\n".join(report))
    if args.dry_run:
        print("\n--- would write ---")
        print(json.dumps(work, indent=2, ensure_ascii=False))
        return

    os.makedirs(WORKS_DIR, exist_ok=True)
    out = os.path.join(WORKS_DIR, slug + ".json")
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(work, fh, indent=2, ensure_ascii=False)
    print("written    : %s" % os.path.relpath(out, ROOT))
    print("\nNext:  build it in After Effects with")
    print('  SOTD.buildWork("%s")' % slug)


if __name__ == "__main__":
    main()
