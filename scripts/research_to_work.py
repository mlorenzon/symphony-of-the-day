#!/usr/bin/env python3
"""Validate a research record, then hand it to prepare_work.py.

The research JSON (data/research/<slug>.json, schema data/research/_schema.json)
is where the scholarship lives: every field sourced, conflicts between Grove and
Wikipedia recorded, unknowns stated. The card JSON (data/works/<slug>.json) is
the lossy projection of it that After Effects reads.

    python scripts/research_to_work.py mozart-linz --dry-run
    python scripts/research_to_work.py mozart-linz

--dry-run prints the prepare_work.py command without running it, which is also
the fastest way to see what the card is about to say.

Validation is against _schema.json itself (required / enum / const / type /
additionalProperties / min-maxItems), so the schema stays the single source of
truth. On top of that it warns about the things that only show up in a render:
occasion and listening lines too long for the card, an era that disagrees with
the mechanical year bucket in periods.json, card fields with no entry in
`claims`, and sources not yet filed in Zotero.
"""
import argparse
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
RESEARCH_DIR = os.path.join(ROOT, "data", "research")
SCHEMA_FILE = os.path.join(RESEARCH_DIR, "_schema.json")
PERIODS_FILE = os.path.join(ROOT, "data", "periods.json")
PREPARE = os.path.join(HERE, "prepare_work.py")

# From docs/reel-cards.md: 90 chars is comfortable, past ~148 the type has
# shrunk far enough that the card stops reading as a card.
OCCASION_COMFORT, OCCASION_CEILING = 90, 148
HOOK_COMFORT = 90

JSON_TYPES = {
    "object": dict, "array": list, "string": str, "boolean": bool,
    "integer": int, "number": (int, float), "null": type(None),
}


# ------------------------------------------------------------------ validation

def type_ok(value, spec):
    names = spec if isinstance(spec, list) else [spec]
    for name in names:
        expected = JSON_TYPES.get(name)
        if expected is None:
            return True
        # bool is a subclass of int in Python; JSON does not agree.
        if name in ("integer", "number") and isinstance(value, bool):
            continue
        if isinstance(value, expected):
            return True
    return False


def validate(value, schema, path, errors):
    """Enough of draft-07 to keep _schema.json honest, in stdlib only."""
    if "const" in schema and value != schema["const"]:
        errors.append("%s: must be %r, got %r" % (path, schema["const"], value))
    if "enum" in schema and value not in schema["enum"]:
        errors.append("%s: %r is not one of %s" % (path, value, schema["enum"]))
    if "type" in schema and not type_ok(value, schema["type"]):
        errors.append("%s: expected %s, got %s"
                      % (path, schema["type"], type(value).__name__))
        return

    if isinstance(value, dict):
        props = schema.get("properties", {})
        for key in schema.get("required", []):
            if key not in value:
                errors.append("%s: missing required field '%s'" % (path or "(root)", key))
        extra = schema.get("additionalProperties", True)
        for key, sub in value.items():
            here = "%s.%s" % (path, key) if path else key
            if key in props:
                validate(sub, props[key], here, errors)
            elif isinstance(extra, dict):
                validate(sub, extra, here, errors)
            elif extra is False:
                errors.append("%s: unexpected field" % here)

    elif isinstance(value, list):
        if "minItems" in schema and len(value) < schema["minItems"]:
            errors.append("%s: needs at least %d item(s), has %d"
                          % (path, schema["minItems"], len(value)))
        if "maxItems" in schema and len(value) > schema["maxItems"]:
            errors.append("%s: allows at most %d item(s), has %d"
                          % (path, schema["maxItems"], len(value)))
        item_schema = schema.get("items")
        if isinstance(item_schema, dict):
            for i, item in enumerate(value):
                validate(item, item_schema, "%s[%d]" % (path, i), errors)


# -------------------------------------------------------------------- warnings

def period_for(year):
    with open(PERIODS_FILE, "r", encoding="utf-8") as fh:
        periods = json.load(fh)["periods"]
    for p in periods:
        if p["from"] <= year < p["to"]:
            return p["name"]
    return periods[-1]["name"] if year >= periods[-1]["to"] else periods[0]["name"]


MONTHS = ["January", "February", "March", "April", "May", "June",
          "July", "August", "September", "October", "November", "December"]


def long_date(iso):
    """1824-05-07 -> 7 May 1824. A partial date degrades to what it knows."""
    if not iso:
        return ""
    bits = str(iso).split("-")
    try:
        year = int(bits[0])
    except (ValueError, IndexError):
        return str(iso)
    if len(bits) == 1:
        return str(year)
    try:
        month = MONTHS[int(bits[1]) - 1]
    except (ValueError, IndexError):
        return str(year)
    if len(bits) < 3:
        return "%s %d" % (month, year)
    try:
        return "%d %s %d" % (int(bits[2]), month, year)
    except ValueError:
        return "%s %d" % (month, year)


def premiere_line(rec):
    """FIRST PERFORMANCE as one line: venue, city, date.

    A datum, not a sentence — that is what makes it affordable on a card that
    also carries three other facts. Whatever the record knows, in that order;
    the conductor, the soloists and the reception stay in the record and in the
    Obsidian note, because they will not fit and are not what a viewer needs
    in the two seconds the card is up.
    """
    fp = rec.get("first_performance") or {}
    if not fp.get("known", False):
        return ""
    # `venue` is the scholarly name and some of them carry a parenthetical -
    # "Burgtheater (K.K. Hoftheater nachst der Burg)" - which is right in the
    # record and clumsy on a card. `venue_short` wins when the record has one;
    # the parenthetical is never dropped silently.
    venue = fp.get("venue_short") or fp.get("venue")
    bits = [venue, fp.get("city"), long_date(fp.get("date"))]
    return ", ".join(b for b in bits if b)


SCORED_FOR = "SCORED FOR"
PREMIERE_ORCHESTRA = "PREMIERE ORCHESTRA"

# Card 2's first fact, in priority order. Three different questions, and the
# card answers whichever is best attested — so the LABEL has to move with the
# answer, or the card claims more than its source supports. "SCORED FOR 69
# players" asserts the composer asked for 69; "PREMIERE ORCHESTRA 69 players"
# asserts only that 69 turned up. The other three facts keep fixed labels.
SCORING_PRIORITY = [
    ("specified",       SCORED_FOR,         "players",     "players"),
    ("premiere",        PREMIERE_ORCHESTRA, "players",     "players"),
    ("instrumentation", SCORED_FOR,         "instruments", "instruments"),
]


def voices_phrase(rec):
    v = (rec.get("scoring") or {}).get("voices") or {}
    chorus, soloists = v.get("chorus"), v.get("soloists")
    if chorus and soloists:
        return "a chorus of %d and %d soloists" % (chorus, soloists)
    if chorus:
        return "a chorus of %d" % chorus
    if soloists:
        return "%d soloists" % soloists
    return ""


def scoring_fact(rec):
    """(label, text) for card 2's first fact, or ("", "") if nothing is known.

    Walks SCORING_PRIORITY and takes the first block that carries a count. The
    unit matters as much as the number: an instrumentation count is instruments,
    never players, because the strings are not in the score to be counted.
    """
    sc = rec.get("scoring") or {}
    label, text = "", ""
    for key, lab, field, unit in SCORING_PRIORITY:
        block = sc.get(key) or {}
        n = block.get(field)
        if n:
            label, text = lab, "%d %s" % (n, unit)
            break

    voices = voices_phrase(rec)
    if not text:
        # Voices alone are still a fact worth printing — a work can be known to
        # need a chorus long before anybody has counted the orchestra.
        if not voices:
            return "", ""
        return SCORED_FOR, voices[0].upper() + voices[1:]
    if voices:
        text += ", with " + voices

    if sc.get("label"):
        label = sc["label"]
    if sc.get("line"):
        text = sc["line"]
    return label, text


def scoring_line(rec):
    """Just the text, for callers that do not need the label."""
    return scoring_fact(rec)[1]


def card_hook(rec):
    """The listening line that goes on the card: the one flagged, else the first."""
    hooks = rec.get("listen_for") or []
    for h in hooks:
        if h.get("card"):
            return h
    return hooks[0] if hooks else None


def review(rec):
    warnings = []

    occasion = rec.get("reason", {}).get("summary", "")
    n = len(occasion)
    if n > OCCASION_CEILING:
        warnings.append("occasion is %d chars — past the %d-char ceiling; the card "
                        "will shrink the type uncomfortably. Cut it." % (n, OCCASION_CEILING))
    elif n > OCCASION_COMFORT:
        warnings.append("occasion is %d chars — over the %d-char comfort line, but "
                        "within what other works carry. Check the render."
                        % (n, OCCASION_COMFORT))

    # OCCASION means why the work exists — commission, patron, dedicatee,
    # purpose. The premiere is its own fact now, and several records were
    # written when this field carried premiere news instead.
    if occasion and re.search(r"premier", occasion, re.I):
        warnings.append("occasion mentions the premiere. OCCASION is now why the "
                        "work EXISTS (commission, patron, dedicatee); the venue "
                        "and date belong to FIRST PERFORMANCE, which the card "
                        "prints separately. Rewrite reason.summary.")

    sc = rec.get("scoring") or {}
    scored_label, scored_text = scoring_fact(rec)
    if not scored_text:
        warnings.append("no scoring recorded — the card's first fact will be blank "
                        "and the list will close up over it. Fill whichever you "
                        "can source, best first: scoring.specified.players (what "
                        "the composer asked for), scoring.premiere.players (who "
                        "played it), scoring.instrumentation.instruments (what the "
                        "parts add up to).")
    else:
        won = [k for k, _lab, f, _u in SCORING_PRIORITY if (sc.get(k) or {}).get(f)]
        if won and won[0] == "instrumentation":
            warnings.append("scoring falls back to instrumentation, so the card "
                            "says '%s' — instruments, not players, because the "
                            "score does not number the strings. That is correct "
                            "and it is the weakest of the three: if the premiere "
                            "roster is documented anywhere, record it under "
                            "scoring.premiere and the card upgrades itself."
                            % scored_text)
        if len(won) > 1:
            warnings.append("scoring carries %s; the card uses %s and labels it "
                            "%s. Nothing is lost — the others stay in the record."
                            % (" and ".join(won), won[0], scored_label))
        for key, _lab, field, _unit in SCORING_PRIORITY:
            block = sc.get(key) or {}
            if block and not block.get("source"):
                warnings.append("scoring.%s has no source recorded." % key)

    fp = rec.get("first_performance") or {}
    if fp.get("known") and not premiere_line(rec):
        warnings.append("first_performance is marked known but has no venue, city "
                        "or date, so the card's FIRST PERFORMANCE line is blank.")

    if fp.get("venue") and "(" in fp["venue"] and not fp.get("venue_short"):
        warnings.append("venue carries a parenthetical, which reads badly on the "
                        "card: %s. Add a venue_short." % fp["venue"])

    # The two facts sit one under the other, so anything the occasion repeats
    # from the premiere is visibly repeated.
    if occasion and fp.get("known"):
        year = str(fp.get("date", ""))[:4]
        venue_word = (fp.get("venue") or "").split()[0].strip("(,") if fp.get("venue") else ""
        echoes = [w for w in (fp.get("city"), venue_word, year) if w and w in occasion]
        if echoes:
            warnings.append("occasion repeats the premiere (%s), which now sits "
                            "directly above it. Say why the work EXISTS instead."
                            % ", ".join(echoes))

    hooks = rec.get("listen_for") or []
    flagged = [h for h in hooks if h.get("card")]
    if len(flagged) > 1:
        warnings.append("%d listening hooks are flagged card:true — only one reaches "
                        "the card, and the first wins." % len(flagged))
    elif not flagged and hooks:
        warnings.append("no listening hook is flagged card:true — falling back to the first.")
    hook = card_hook(rec)
    if hook and len(hook.get("hook", "")) > HOOK_COMFORT:
        warnings.append("card listening line is %d chars — the ones that sit well are "
                        "64–71." % len(hook["hook"]))

    year = rec.get("composition", {}).get("year")
    era = rec.get("era")
    if year and era:
        bucket = period_for(year)
        if bucket != era:
            warnings.append("era is '%s' but %d buckets as '%s' in periods.json — the "
                            "card takes the bucket, and with it the colour. Reconcile "
                            "deliberately, or say why in era_note." % (era, year, bucket))

    place = rec.get("composition", {}).get("place", {})

    # The country of composition is card text, and the only alternative to it is
    # the basemap's own wording, which is unverified and sometimes anachronistic
    # — aourednik calls the Habsburg lands the "Austrian Empire" in 1783 and
    # 1800, twenty years early. So a record without a polity does not merely
    # lack a field; it hands the card to a source nobody checked.
    if place.get("granularity") != "unknown" and not place.get("polity"):
        warnings.append("no composition.place.polity — the map label will fall back to "
                        "the basemap's own wording, which is unverified and anachronistic "
                        "for anything before 1804. Name the sovereign state.")
    year = rec.get("composition", {}).get("year")
    polity = (place.get("polity") or "").lower()
    for since, anachronism in ((1804, "austrian empire"), (1867, "austria-hungary"),
                               (1867, "austria hungary"), (1871, "german empire"),
                               (1861, "kingdom of italy"), (1922, "soviet union"),
                               (1922, "ussr")):
        if year and polity == anachronism and year < since:
            warnings.append("polity '%s' did not exist in %d — it dates from %d."
                            % (place["polity"], year, since))
    if len(place.get("polity") or "") > 34:
        warnings.append("polity is %d chars — over about 34 it wraps to a third line "
                        "on the map. Shorten it." % len(place["polity"]))

    if place.get("granularity") != "unknown" and (place.get("lat") is None or place.get("lon") is None):
        warnings.append("place has no lat/lon — prepare_work.py will geocode the name, and a "
                        "bare city name lands on the wrong continent often enough to matter. "
                        "Pin the coordinates and record the Q-id.")

    claims = rec.get("claims", {})
    for field in ("title_full", "composition.year", "composition.place",
                  "composition.place.polity",
                  "reason.summary", "composer.nationality", "listen_for"):
        if not any(k == field or k.startswith(field + ".") for k in claims):
            warnings.append("no source recorded in claims for '%s'." % field)

    sources = rec.get("sources", [])
    kinds = set(s.get("type") for s in sources)
    if "grove" not in kinds:
        warnings.append("no Grove source — Wikipedia is unchecked until Grove has "
                        "seen it.")
    unfiled = [s["id"] for s in sources if not s.get("zotero_key")]
    if unfiled:
        warnings.append("not yet in Zotero: %s" % ", ".join(unfiled))

    # A Grove URL is not a citation anybody can follow: the article sits behind
    # the Sydney University login, and Oxford revises in place, so next year's
    # page may not say what was checked today. The stored copy is the claim's
    # only durable backing — see scripts/grove_snapshot.py.
    unsnapped = [s["id"] for s in sources
                 if s.get("type") == "grove" and not s.get("snapshot")]
    if unsnapped:
        warnings.append("no stored copy of the Grove page for: %s. Capture the page, "
                        "run scripts/grove_snapshot.py, attach the PDF to the Zotero "
                        "item and record the attachment key in sources[].snapshot."
                        % ", ".join(unsnapped))

    if not rec.get("conflicts") and "conflicts" not in rec:
        warnings.append("no `conflicts` key — an empty list means checked and clean; "
                        "absent means nobody checked.")

    return warnings


# ----------------------------------------------------------------------- bridge

def command_for(rec):
    place = rec.get("composition", {}).get("place", {})
    # prepare_work.py geocodes a single place string, so give it the finest
    # grain Wikidata can actually resolve: a building is not a map coordinate.
    place_str = place.get("city") or place.get("region") or place.get("country_now") or ""
    hook = card_hook(rec) or {}

    argv = [sys.executable, PREPARE,
            "--composer", rec["composer"]["name"],
            "--title", rec["title_full"],
            "--year", str(rec["composition"]["year"])]

    def opt(flag, value):
        if value:
            argv.extend([flag, str(value)])

    opt("--place", place_str)
    # Pin the coordinates when the record has them. prepare_work.py otherwise
    # resolves the place name through a Wikidata search, which cheerfully
    # returns Vienna, Illinois for "Vienna" and then clips a basemap around it.
    if place.get("lat") is not None and place.get("lon") is not None:
        argv.extend(["--lat", str(place["lat"]), "--lon", str(place["lon"])])
    opt("--slug", rec.get("slug"))
    opt("--short-title", rec.get("title_short"))
    opt("--catalogue", rec.get("catalogue"))
    opt("--number", rec.get("number"))
    scored_label, scored_text = scoring_fact(rec)
    opt("--scored-for", scored_text)
    # The label travels with the value: see SCORING_PRIORITY.
    if scored_text and scored_label != SCORED_FOR:
        opt("--scored-for-label", scored_label)
    opt("--first-performance", premiere_line(rec))
    opt("--context", rec.get("reason", {}).get("summary"))
    opt("--listen", hook.get("hook"))
    opt("--nationality", rec["composer"].get("nationality"))
    opt("--country-then", place.get("country_then"))
    # The country of composition, printed on the map. Passed explicitly rather
    # than left to map_focus.py's own lookup so that a --dry-run shows exactly
    # what the card will say.
    opt("--polity", place.get("polity"))
    opt("--born", rec["composer"].get("born"))
    opt("--died", rec["composer"].get("died"))
    return argv


def quote(arg):
    return '"%s"' % arg.replace('"', '\\"') if " " in arg or '"' in arg else arg


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("slug", help="Slug, or a path to a research JSON")
    ap.add_argument("--dry-run", action="store_true",
                    help="Validate and print the command; do not run it")
    ap.add_argument("--check", action="store_true",
                    help="Validate only; do not build a command at all")
    ap.add_argument("--force", action="store_true",
                    help="Proceed despite warnings (errors still stop it)")
    args, passthrough = ap.parse_known_args()

    path = args.slug if os.path.exists(args.slug) else \
        os.path.join(RESEARCH_DIR, args.slug + ".json")
    if not os.path.exists(path):
        sys.exit("no research record at %s" % path)

    with open(path, "r", encoding="utf-8") as fh:
        rec = json.load(fh)
    with open(SCHEMA_FILE, "r", encoding="utf-8") as fh:
        schema = json.load(fh)

    errors = []
    validate(rec, schema, "", errors)
    if errors:
        print("%s does not match sotd-research/1:" % os.path.basename(path))
        for e in errors:
            print("  ERROR  %s" % e)
        sys.exit(1)

    warnings = review(rec)
    for w in warnings:
        print("  warn   %s" % w)
    if not warnings:
        print("  ok     schema clean, nothing to flag")

    if args.check:
        return

    argv = command_for(rec) + passthrough
    print("\n" + " ".join(quote(a) for a in argv))

    if args.dry_run:
        return
    if warnings and not args.force:
        sys.exit("\nstopping on warnings — fix them, or pass --force.")
    sys.exit(subprocess.call(argv))


if __name__ == "__main__":
    main()
