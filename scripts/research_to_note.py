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
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
RESEARCH_DIR = os.path.join(ROOT, "data", "research")
VAULT = r"C:\Users\mlorenzon\Desktop\random\Elite Music\Elite Music"

ERA_HINT = "periods.json buckets by year and that bucket sets the card colour"

# The card's first fact is derived, not stored, and the derivation is the
# interesting part — which of the three levels of evidence won. Import it rather
# than reimplement it, so the note cannot claim a different number from the card.
sys.path.insert(0, HERE)
from research_to_work import (card_hook, composer_age, scoring_fact,  # noqa: E402
                             SCORING_PRIORITY)

# Why each level says what it says, in the note's own words.
FORCES_BASIS = {
    "specified":      "the numbers the composer wrote into the score — the strongest "
                      "claim available, and rare",
    "premiere":       "the roster of the first performance: a fact about the evening "
                      "rather than about the work, which is why the card says "
                      "PREMIERE ORCHESTRA",
    "instrumentation": "the score's distinct parts added up. It counts *instruments*, "
                       "not players, because the string desks are almost never "
                       "numbered in the score — the weakest of the three, and the "
                       "usual case",
}


# ------------------------------------------------------------- the reel script
# Step 1.2 of the engine: the words read over the finished reel. The wording is
# fixed and only the bracketed slots move, so the note can carry the finished
# script rather than a template — and because it is derived from the record, it
# cannot drift from the card built from the same record.
#
# The template is verbatim. Do not improve it here: the series depends on the
# same sentences landing the same way every day, and the only thing that varies
# is what goes in the five slots.
SCRIPT_TEMPLATE = (
    "We're listening to {possessive} {title}, composed in {year} for "
    "{occasion} when the composer was {age} years old. Listen out for "
    "{listen}. Thanks for watching. Listen to symphonies and get your "
    "attention span back. See you tomorrow."
)

SPEECH_WPM = 150      # an unhurried voice-over; near enough to catch a long one
REEL_SECONDS = 60     # the format's ceiling

# Two slots take prose that has to be *spoken*, and the scholarly fields cannot
# always do it. "composed in 1802 for No commission. Finished in the country
# retreat..." is a grammatical wreck, and so is "Listen out for Four notes. The
# whole first movement is built from almost nothing else." So the record carries
# a spoken phrase for each — `reason.occasion_spoken` and `spoken` on the card
# hook — written to slot into the sentence, while the scholarly field stays as
# it is. Falling back to the scholarly field is deliberately noisy: a sentence
# that reads wrong in a voice-over is not a small error, and nothing downstream
# will catch it.


def spoken_title(rec):
    """The title as a person says it: no opus number, the nickname in words.

    'Symphony No. 3 in E flat major, Op. 55 "Eroica"' is a catalogue entry.
    Nobody reads an opus number aloud over a reel, and nobody pronounces the
    quotation marks — but the nickname is the half of the title a listener
    actually uses, so it stays, in apposition, where the opus number was.
    """
    if rec.get("title_spoken"):
        return rec["title_spoken"]
    title = re.sub(r",?\s*Op\.\s*\d+[a-z]?", "", rec["title_full"])
    title = re.sub(r'[,\s]*[“"]([^”"]+)[”"]', r", the \1", title)
    return re.sub(r"\s{2,}", " ", title).strip().strip(",")


def spoken_occasion(rec):
    """The phrase after "composed in <year> for". Returns (text, warning)."""
    reason = rec.get("reason") or {}
    spoken = (reason.get("occasion_spoken") or "").strip()
    if spoken:
        return spoken.rstrip("."), None
    fallback = (reason.get("occasion") or reason.get("summary") or "").strip()
    if not fallback:
        return "[Occasion]", ("nothing to say why the work exists — [Occasion] is "
                              "still a placeholder in the script")
    return fallback.rstrip("."), ("no reason.occasion_spoken, so the script reads "
                                  "reason.occasion verbatim — check it follows "
                                  '"composed in %s for"' % (rec["composition"].get("year") or "-"))


def spoken_hook(rec):
    """The phrase after "Listen out for". Returns (text, warning)."""
    hook = card_hook(rec)
    if not hook:
        return "[Listening note]", ("no listen_for hook — [Listening note] is still "
                                    "a placeholder in the script")
    spoken = (hook.get("spoken") or "").strip()
    if spoken:
        return spoken.rstrip("."), None
    return hook["hook"].rstrip("."), ('no `spoken` on the card hook, so the script '
                                      'reads the card line verbatim — check it '
                                      'follows "Listen out for"')


def reel_script(rec):
    """(script text, warnings) for the <60 second reel.

    Everything the sentence needs comes from the record, and every gap stays
    visible as its own square bracket rather than being papered over.
    """
    c, comp = rec["composer"], rec["composition"]
    warnings = []
    surname = c["name"].split()[-1]

    year = comp.get("year")
    if not year:
        warnings.append("no composition.year — [YEAR] is still a placeholder")

    age, w = composer_age(rec)
    if w:
        warnings.append(w)

    occasion, w = spoken_occasion(rec)
    if w:
        warnings.append(w)
    listen, w = spoken_hook(rec)
    if w:
        warnings.append(w)

    body = SCRIPT_TEMPLATE.format(possessive=surname + "'s",
                                  title=spoken_title(rec),
                                  year=year or "[YEAR]",
                                  occasion=occasion,
                                  age=age,
                                  listen=listen)
    words = len(body.split())
    seconds = words / SPEECH_WPM * 60.0
    if seconds > REEL_SECONDS:
        warnings.append("about %d seconds at %d words a minute — over the %d-second "
                        "ceiling. Shorten the occasion or the listening line."
                        % (round(seconds), SPEECH_WPM, REEL_SECONDS))
    return "SCRIPT\nSymphony of the Day\n" + body, warnings


def script_section(rec):
    """The note's last section: the script, fenced so it copies out clean."""
    text, warnings = reel_script(rec)
    words = len(text.split()) - 1          # "SCRIPT" is a label, not a word said
    L = ["## Script", "",
         "*Voice-over for the reel. Generated from this record — fix the record "
         "and re-run, do not edit it here. About %d words, %d seconds at %d wpm.*"
         % (words, round(words / SPEECH_WPM * 60.0), SPEECH_WPM),
         "", "```text", text, "```", ""]
    for w in warnings:
        L.append("> [!warning] %s" % w)
    if warnings:
        L.append("")
    return L


# ---------------------------------------------------------------- the caption
# Step 1.3: the words that go under the reel when it is posted. Same rule as the
# script — generated from the record, never typed — because its whole job is to
# say where the facts came from, and a hand-typed source list is one more place
# a citation can be wrong.
#
# The list is NOT every source on the record. The caption credits the sources
# behind the *script*, which is a handful of facts: the title, the year, the
# composer's age, why the work exists, and the listening note. A record also
# carries sources for the premiere venue, the nationality argument, the
# instrumentation count and so on — real scholarship that no line of the reel
# actually spends, and printing it would credit sources for claims the video
# never makes.
CAPTION_TEMPLATE = ("Symphony of the day. Today we're listening to "
                    "{possessive} {title}.\n\nSOURCES\n{sources}\n\n"
                    "#SymphonyOfTheDay #{composer} #ClassicalMusic")

CAPTION_LIMIT = 2200   # Instagram's ceiling, and the tightest of the platforms

# The claim paths the five script slots rest on, in the order the script says
# them. A record files provenance per field, so this is the join: script slot ->
# field -> claims entry -> source. Each entry is tried against `claims` in turn
# and the first one present wins, which is how the occasion follows the same
# fallback the script does.
SCRIPT_CLAIMS = (
    ("title",    ("title_full",)),
    ("composer", ("composer.name",)),
    ("year",     ("composition.year", "composition.date")),
    ("occasion", ("reason.occasion", "reason.summary")),
    ("age",      ("composer.born",)),
    ("listen",   ("listen_for",)),
)


def _invert(author):
    """'Joseph Kerman, Alan Tyson and William Drabkin' -> Chicago order.

    Chicago inverts the first name only — 'Kerman, Joseph, Alan Tyson, and
    William Drabkin' — and the record stores authors the way a title page
    prints them, so the inversion happens here rather than in the JSON.
    """
    names = [n.strip() for n in re.split(r",| and ", author) if n.strip()]
    if not names:
        return ""
    first = names[0].split()
    lead = "%s, %s" % (first[-1], " ".join(first[:-1])) if len(first) > 1 else first[0]
    if len(names) == 1:
        return lead
    if len(names) == 2:
        return "%s, and %s" % (lead, names[1])
    return "%s, %s, and %s" % (lead, ", ".join(names[1:-1]), names[-1])


def _long_date(iso):
    """2026-08-21 -> August 21, 2026. Anything else is passed through."""
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})$", iso or "")
    if not m:
        return iso or ""
    months = ("January", "February", "March", "April", "May", "June", "July",
              "August", "September", "October", "November", "December")
    return "%s %d, %s" % (months[int(m.group(2)) - 1], int(m.group(3)), m.group(1))


def chicago(s):
    """One source as a Chicago bibliography entry, in plain text.

    Plain text on purpose: this goes in a caption box that renders no markdown,
    so a title that wants italics gets them by being unquoted, the way a printed
    bibliography distinguishes a book from an article.
    """
    quoted = s.get("type") not in ("book", "score")
    bits = []
    author = _invert(s.get("author") or "")
    if author:
        bits.append(author.rstrip(".") + ".")
    elif s.get("container"):
        # No author — Wikipedia, mostly. The site takes the author's place and
        # does not then repeat itself later in the entry.
        bits.append(s["container"].rstrip(".") + ".")
    bits.append('"%s."' % s["title"].rstrip(".") if quoted else "%s." % s["title"].rstrip("."))
    if s.get("container") and not (not author and bits[0].startswith(s["container"])):
        bits.append(s["container"].rstrip(".") + ".")
    if s.get("year"):
        bits.append("%s." % s["year"])
    if s.get("accessed"):
        bits.append("Accessed %s." % _long_date(s["accessed"]))
    if s.get("url"):
        bits.append(s["url"])
    return " ".join(b for b in bits if b)


def script_sources(rec):
    """The sources behind the script's facts, in record order. (list, warnings)."""
    claims, warnings = rec.get("claims") or {}, []
    wanted, missing = [], []
    for slot, paths in SCRIPT_CLAIMS:
        for path in paths:
            if claims.get(path):
                wanted.extend(claims[path])
                break
        else:
            missing.append(slot)
    if missing:
        warnings.append("no claims filed for %s, so the caption cannot credit "
                        "%s source%s — check the record's `claims`."
                        % (", ".join(missing), "its" if len(missing) == 1 else "those",
                           "" if len(missing) == 1 else "s"))
    by_id = dict((s["id"], s) for s in rec["sources"])
    unknown = [i for i in wanted if i not in by_id]
    if unknown:
        warnings.append("claims cite source id%s %s, which %s not in `sources`"
                        % ("" if len(unknown) == 1 else "s", ", ".join(sorted(set(unknown))),
                           "is" if len(unknown) == 1 else "are"))
    # Record order, not claim order: the caption should list Grove before the
    # Wikipedia article every day, rather than reordering itself according to
    # which slot happened to need which source first.
    seen = set(wanted)
    return [s for s in rec["sources"] if s["id"] in seen], warnings


def reel_caption(rec):
    """(caption text, warnings) for the post the reel goes out in."""
    c = rec["composer"]
    surname = c["name"].split()[-1]
    sources, warnings = script_sources(rec)
    if not sources:
        warnings.append("no sources at all under the script's facts — the caption "
                        "posts an empty SOURCES list")
    text = CAPTION_TEMPLATE.format(possessive=surname + "'s",
                                   title=spoken_title(rec),
                                   sources="\n".join(chicago(s) for s in sources),
                                   # A hashtag cannot hold a space, so a
                                   # two-word surname closes up: #VaughanWilliams.
                                   composer=re.sub(r"[^0-9A-Za-z]", "", surname))
    if len(text) > CAPTION_LIMIT:
        warnings.append("%d characters — over Instagram's %d. Trim the source list "
                        "or shorten a URL." % (len(text), CAPTION_LIMIT))
    return text, warnings


def caption_section(rec):
    """The note's caption block, fenced so it copies out clean."""
    text, warnings = reel_caption(rec)
    L = ["## Caption", "",
         "*The post text. Generated from this record — the source list is the "
         "sources under the script's facts, not every source on this note. "
         "%d of %d characters.*" % (len(text), CAPTION_LIMIT),
         "", "```text", text, "```", ""]
    for w in warnings:
        L.append("> [!warning] %s" % w)
    if warnings:
        L.append("")
    return L


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

    # Forces. Between why-it-exists and the premiere: what it takes to play the
    # work is a fact about the work, the premiere roster a fact about the night.
    sc = rec.get("scoring") or {}
    if sc:
        label, text = scoring_fact(rec)
        L += ["## Forces", ""]
        if text:
            won = [k for k, _l, f, _u in SCORING_PRIORITY if (sc.get(k) or {}).get(f)]
            L.append("**%s: %s.**" % (label, text))
            if won:
                L.append("Card 2 prints this from `scoring.%s` — %s."
                         % (won[0], FORCES_BASIS[won[0]]))
        for key, heading in (("specified", "As specified in the score"),
                             ("premiere", "At the premiere"),
                             ("instrumentation", "Instrumentation"),
                             ("voices", "Voices")):
            block = sc.get(key) or {}
            if not block:
                continue
            counts = []
            if block.get("players"):
                counts.append("%d players" % block["players"])
            if block.get("instruments"):
                counts.append("%d instruments" % block["instruments"])
            if block.get("chorus"):
                counts.append("chorus of %d" % block["chorus"])
            if block.get("soloists"):
                counts.append("%d soloists" % block["soloists"])
            L += ["", "**%s.**%s" % (heading, " " + ", ".join(counts) + "." if counts else "")]
            for field in ("shorthand", "strings"):
                if block.get(field):
                    L.append("- `%s`" % block[field])
            if block.get("doublings"):
                L.append("*Doublings:* %s" % block["doublings"])
            if block.get("note"):
                L.append(block["note"])
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

    # The script, last. It is the only section that is not scholarship — the
    # words read over the finished reel — and a reader scanning the note for a
    # fact should not have to step over it to reach the sources.
    L += script_section(rec)
    # And the caption under it: the same shoot-day pair, in the order they
    # are used - the script is read to camera, the caption is pasted at
    # upload.
    L += caption_section(rec)

    return "\n".join(L)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("slug", nargs="?", help="Slug of one record")
    ap.add_argument("--all", action="store_true", help="Every record in data/research")
    ap.add_argument("--dry-run", action="store_true", help="Print instead of writing")
    ap.add_argument("--script", action="store_true",
                    help="Print the reel script and the caption, and write nothing")
    ap.add_argument("--caption", action="store_true",
                    help="Print just the post caption, and write nothing")
    args = ap.parse_args()

    if args.all:
        slugs = sorted(f[:-5] for f in os.listdir(RESEARCH_DIR)
                       if f.endswith(".json") and not f.startswith("_"))
    elif args.slug:
        slugs = [args.slug]
    else:
        sys.exit("give a slug, or --all")

    folder = os.path.join(VAULT, "Symphony of the day")
    if not os.path.isdir(folder) and not (args.script or args.caption or args.dry_run):
        sys.exit("vault folder not found: %s" % folder)

    for slug in slugs:
        path = os.path.join(RESEARCH_DIR, slug + ".json")
        if not os.path.exists(path):
            print("  skip   %s — no record" % slug)
            continue
        rec = json.load(open(path, encoding="utf-8"))

        if args.script or args.caption:
            # For the day's shoot: the two things that get used on the day, with
            # no scholarship to scroll past. The caption comes out with the
            # script because it is drafted from the same facts and posted with
            # the reel the script was read for.
            print("=" * 70)
            if args.script:
                script, warnings = reel_script(rec)
                print(script)
                for w in warnings:
                    print("  !  %s" % w)
                print("")
            caption, warnings = reel_caption(rec)
            print("CAPTION")
            print(caption)
            for w in warnings:
                print("  !  %s" % w)
            continue

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
        # The script's gaps are worth seeing at the terminal too: the note is
        # generated and easy not to reread, and a placeholder left in a
        # voice-over is only caught by a person.
        for w in reel_script(rec)[1] + reel_caption(rec)[1]:
            print("     !  %s" % w)


if __name__ == "__main__":
    main()
