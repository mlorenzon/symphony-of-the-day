#!/usr/bin/env python3
"""Lay out a research record as a readable note in the Obsidian vault.

The prose lives in the record's `detail` fields — this only arranges it, so the
note and the JSON cannot drift. Re-running overwrites the note.

    python scripts/research_to_note.py beethoven-no-5
    python scripts/research_to_note.py --all --dry-run

The note lands in "<vault>/Symphony of the day/", at the path the record's
`obsidian_note` field names.
"""
import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
RESEARCH_DIR = os.path.join(ROOT, "data", "research")
VAULT = r"C:\Users\mlorenzon\Desktop\random\Elite Music\Elite Music"

ERA_HINT = "periods.json buckets by year and that bucket sets the card colour"


def place_line(place):
    """Finest grain first, coarsest last — the way a person would say it."""
    parts = [place.get(k) for k in ("building", "city", "region") if place.get(k)]
    then = place.get("country_then")
    if then:
        parts.append(then)
    return ", ".join(parts) or "Place unknown"


def fmt(rec):
    c, comp = rec["composer"], rec["composition"]
    place, reason, fp = comp["place"], rec["reason"], rec["first_performance"]
    surname = c["name"].split()[-1]
    title = rec["title_full"]
    L = []

    note_name = os.path.basename(rec.get("obsidian_note") or (rec["slug"] + ".md"))
    L += ["---",
          "work: %s" % json.dumps(title, ensure_ascii=False),
          "composer: %s" % c["name"],
          "year: %s" % (comp.get("year") or "unknown"),
          "era: %s" % rec["era"],
          # The country of composition, in the frontmatter as well as the body:
          # it is the field the card prints on the map, so it wants to be
          # queryable across the vault rather than buried in a paragraph.
          "country_of_composition: %s"
          % json.dumps(place.get("polity") or "unknown", ensure_ascii=False),
          # Queryable for the same reason: it is the one identity claim the card
          # makes about the person rather than the piece, and the set has to
          # agree with itself about it across composers.
          "composer_nationality: %s"
          % json.dumps(c.get("nationality") or "unknown", ensure_ascii=False),
          "slug: %s" % rec["slug"],
          "research: %s" % os.path.join("data", "research", rec["slug"] + ".json").replace("\\", "/"),
          "zotero: Symphony of the day",
          "tags: [symphony-of-the-day, %s]" % rec["slug"],
          "---", "",
          "# %s — %s" % (surname, title), ""]

    # Where and when.
    when = comp.get("date") or (str(comp.get("year")) if comp.get("year") else "date unknown")
    L.append("**%s, %s.**" % (place_line(place), when))
    # Named separately from the place line because it is the one the card acts
    # on: the map highlights this polity and prints this name. The alternative
    # is the historical basemap's own wording, which nobody checked.
    if place.get("polity"):
        L.append("Country of composition: **%s**." % place["polity"])
    if place.get("polity_note"):
        L.append(place["polity_note"])
    if place.get("note"):
        L.append(place["note"])
    if comp.get("year") and c.get("born"):
        L.append("%s was %d." % (surname, comp["year"] - c["born"]))
    # The nationality is a label the card prints and readers argue about, so the
    # note carries the reasoning next to it rather than leaving the bare word.
    if c.get("nationality"):
        L += ["", "Nationality: **%s**." % c["nationality"]]
        if c.get("nationality_note"):
            L.append(c["nationality_note"])
    if rec.get("era_note"):
        L += ["", "*Era: %s. %s*" % (rec["era"], rec["era_note"])]
    L.append("")

    # Why it exists.
    L += ["## Why it exists", ""]
    L.append(reason["summary"])
    for label, key in (("Patron", "patron"), ("Dedicatee", "dedicatee"),
                       ("Occasion", "occasion"), ("Commission", "commission")):
        if reason.get(key):
            L.append("- **%s:** %s" % (label, reason[key]))
    if reason.get("detail"):
        L += ["", reason["detail"]]
    L.append("")

    # First performance.
    L += ["## First performance", ""]
    if not fp.get("known"):
        L.append("Not reliably recorded. %s" % fp.get("notes", ""))
    else:
        bits = [fp.get("date"), fp.get("venue"), fp.get("city")]
        L.append("**%s.**" % ", ".join(b for b in bits if b))
        for label, key in (("Conductor", "conductor"), ("Ensemble", "ensemble"),
                           ("Soloists", "soloists"), ("Reception", "reception")):
            if fp.get(key):
                L.append("- **%s:** %s" % (label, fp[key]))
        if fp.get("notes"):
            L += ["", fp["notes"]]
    L.append("")

    # Listen for.
    L += ["## Listen for", ""]
    for h in rec["listen_for"]:
        mark = " ← on the card" if h.get("card") else ""
        L.append("**%s**%s" % (h["hook"], mark))
        if h.get("timing"):
            L.append("*%s*" % h["timing"])
        if h.get("detail"):
            L.append(h["detail"])
        L.append("")

    # What Grove corrected.
    conflicts = rec.get("conflicts") or []
    L += ["## What Grove corrected", ""]
    if not conflicts:
        L.append("Nothing. Every field was checked against Grove and the two agreed.")
    else:
        for k in conflicts:
            L.append("**%s**" % k["field"])
            if k.get("wikipedia"):
                L.append("- Wikipedia: %s" % k["wikipedia"])
            if k.get("grove"):
                L.append("- Grove: %s" % k["grove"])
            if k.get("other"):
                L.append("- Other: %s" % k["other"])
            L.append("- → %s" % k["resolution"])
            L.append("")
    L.append("")

    # Still unknown.
    unknowns = rec.get("unknowns") or []
    if unknowns:
        L += ["## Still unknown", ""]
        L += ["- %s" % u for u in unknowns]
        L.append("")

    # Sources.
    L += ["## Sources", ""]
    for s in rec["sources"]:
        who = s.get("author") or ""
        bits = [b for b in (who, "*%s*" % s["title"], s.get("container"),
                            str(s["year"]) if s.get("year") else None) if b]
        line = "- " + ", ".join(bits)
        if s.get("zotero_key"):
            line += " — Zotero `%s`" % s["zotero_key"]
        if s.get("url"):
            line += "\n  <%s>" % s["url"]
        L.append(line)
    L.append("")

    return "\n".join(L)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("slug", nargs="?", help="Slug of one record")
    ap.add_argument("--all", action="store_true", help="Every record in data/research")
    ap.add_argument("--dry-run", action="store_true", help="Print instead of writing")
    args = ap.parse_args()

    if args.all:
        slugs = sorted(f[:-5] for f in os.listdir(RESEARCH_DIR)
                       if f.endswith(".json") and not f.startswith("_"))
    elif args.slug:
        slugs = [args.slug]
    else:
        sys.exit("give a slug, or --all")

    folder = os.path.join(VAULT, "Symphony of the day")
    if not os.path.isdir(folder):
        sys.exit("vault folder not found: %s" % folder)

    for slug in slugs:
        path = os.path.join(RESEARCH_DIR, slug + ".json")
        if not os.path.exists(path):
            print("  skip   %s — no record" % slug)
            continue
        rec = json.load(open(path, encoding="utf-8"))
        text = fmt(rec)
        rel = rec.get("obsidian_note") or ("Symphony of the day/%s.md" % slug)
        out = os.path.join(VAULT, rel.replace("/", os.sep))
        if args.dry_run:
            print("=" * 70)
            print("would write %s (%d chars)" % (out, len(text)))
            print(text[:900])
        else:
            with open(out, "w", encoding="utf-8") as fh:
                fh.write(text)
            print("  wrote  %s" % rel)


if __name__ == "__main__":
    main()
