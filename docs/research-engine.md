# The research engine

One work in, three artefacts out:

| Artefact | Where | For |
|---|---|---|
| Research record | `data/research/<slug>.json` | The machine. Upstream of the card. |
| Sources | Zotero → **Symphony of the day** (`R77QY4EK`) | Citing, and going back |
| Note | Obsidian vault → `Symphony of the day/` | Reading |

The procedure is the `symphony-research` skill in
`.claude/skills/symphony-research/`. This file is the reasoning behind it:
why the record is shaped the way it is, and what goes wrong.

## Why the record is not the card

`data/works/<slug>.json` is what After Effects reads, and it is deliberately
tiny — one occasion line, one listening line, one place, one year. It has to
be: the card is 1080 px wide and the type stops reading below about 16 px.

If research went straight into that file, everything that did not fit would be
lost, and there would be nowhere to record *how we know*. So the research
record is the full account, and the card JSON is its lossy projection:

```
data/research/<slug>.json          the scholarship, every field sourced
        │
        │  scripts/research_to_work.py   — validates, then calls
        ▼
scripts/prepare_work.py            — geocodes, fetches portrait, clips basemap
        │
        ▼
data/works/<slug>.json             the ~15 strings the card can hold
```

This also means **re-researching is cheap and rebuilding is safe**. The record
survives every rebuild; the golden rule in `CLAUDE.md` still holds downstream
of it.

## Slugs

`surname-noNN`: `beethoven-no-3`, `brahms-no-4`. The number wins even when the
work has a famous nickname, because a composer with nine symphonies is the
normal case and `beethoven-eroica` sitting between `beethoven-no-2` and
`beethoven-no-4` makes the set unbrowsable. The nickname is not lost — it lives
in `title_short`, on the card, and in the vault note's filename, which is where
anyone actually reading will meet it.

Two consequences worth knowing:

- The slug depends on the **number**, so a disputed numbering has to be settled
  before the record is written. Renaming later means rewriting the slug-derived
  source ids (`wp-<slug>`), every `claims` entry pointing at them, any
  `conflicts.resolved_with`, and the Citation Key in the Zotero item's Extra
  field. All recoverable, all avoidable.
- `mozart-linz` and `shostakovich-leningrad` predate the rule. They are built
  and frozen, and renaming them would orphan their portraits, map stills and
  comps. Leave them.

## The three fields that carry the engine

Everything else in `data/research/_schema.json` is ordinary metadata. These
three are why it is a research *engine* and not a spreadsheet.

**`claims`** maps a field path to the source ids that support it:

```json
"claims": {
  "composition.year":   ["grove-mozart", "wp-linz"],
  "composition.place":  ["grove-mozart"],
  "reason.patron":      ["grove-mozart"]
}
```

Two ids means Grove and Wikipedia independently agree — record it, it is
information. One Grove id means Grove is the only support. A card field with no
entry is an unsourced assertion, and `research_to_work.py --check` says so.

**`conflicts`** records where the sources disagreed and what was done:

```json
"conflicts": [{
  "field": "reason.dedicatee",
  "wikipedia": "Count Thun-Hohenstein",
  "grove": "no dedicatee; Thun was the host, not the dedicatee",
  "resolution": "patron/host recorded; dedicatee left empty",
  "resolved_with": "grove-mozart"
}]
```

`"conflicts": []` means *checked and clean*. A missing `conflicts` key means
nobody checked. The validator distinguishes them, because the difference is the
whole point.

**`unknowns`** states what is genuinely not known. A gap that is stated is
usable; a gap that is silent gets filled by the next person with a guess.

## The country of composition

Card 2 highlights one polity on the map and prints its name. That name is
`composition.place.polity` — **the authoritative country of composition**, and
the one field on the record whose only alternative is a source nobody checked.

There are three different answers to "where was it written", and the record
holds all three because they are all true at once:

| Field | Beethoven 3, 1803 | What it is |
|---|---|---|
| `place.region` / `city` | Oberdöbling, Vienna | where he sat |
| `place.country_then` | Archduchy of Austria | the constituent land — printed under the place name |
| **`place.polity`** | **Habsburg Monarchy** | **the sovereign state — printed on the map** |

Getting this from the map data instead is the trap. The historical basemap is a
drawing dataset, not a reference work: aourednik's 1783 *and* 1800 snapshots both
call the Habsburg lands "Austrian Empire", a state not proclaimed until 11 August
1804. So an absent `polity` does not leave a gap on the card — it prints that.
`--check` warns when the field is missing, when the polity postdates the year
(the validator knows the dates of a handful of the usual offenders), and when it
is too long to print.

**`polity` and the highlight are deliberately decoupled.** The shape After
Effects lights up is matched on the basemap's own `NAME`, warts included, and
`map_focus.py` records that separately as `map.focus.name`. Correcting the
history therefore cannot break the highlight, and a card can — correctly — read
"Habsburg Monarchy" while matching a shape the dataset calls "Austrian Empire".
`map.focus.source` records which of `research`, `given` or `dataset` supplied
the printed name, so an unchecked label is visible rather than assumed.

Watch the dates: no Austrian Empire before August 1804, no Austria-Hungary
before 1867, no unified Italy before 1861 or Germany before 1871, no Soviet
Union before 1922. Anything contested, or mid-succession in the year of
composition, goes in `polity_note`.

## Card constraints the record has to respect

Measured, in `docs/reel-cards.md`:

| Field | Comfortable | Observed ceiling |
|---|---|---|
| `reason.summary` → occasion | ≤ 90 chars | 148 (`mozart-linz`) |
| card `listen_for.hook` | 64–71 chars | ~90 before it shrinks |

Past the ceiling the type keeps shrinking rather than erroring, so this fails
silently in the DOM and only shows up in a render. `--check` flags it early.

## Era vs period, and the colour

`data/periods.json` buckets by year, and that bucket **is the card's colour**.
`era` in the record is the scholarly judgment, which does not always agree —
a 1902 work can be squarely Romantic while the file calls it Modern.

The card takes the bucket. So when they disagree, either accept it and write
`era_note`, or move the boundary in `periods.json` on purpose. What you must
not do is let it happen unnoticed; the validator warns.

## The Obsidian note

`Symphony of the day/<Composer> — <Work>.md`, generated by
`scripts/research_to_note.py` from the record — never written by hand, so the
note and the JSON cannot drift.

That puts a requirement back on the record: the note's prose *is* the record's
prose. `reason.detail`, `first_performance.notes` and each
`listen_for[].detail` are what the reader actually reads, so write them as
sentences, not as notes-to-self. The layout below is what the script produces.

```markdown
---
work: <title_full>
composer: <name>
year: <year>
slug: <slug>
research: "[[../../symphony of the day/data/research/<slug>.json]]"
zotero: "Symphony of the day"
tags: [symphony-of-the-day, <slug>]
---

# <Composer> — <Work>

**<Place>, <date>.** One paragraph on where and when, at the finest grain
known, and what the composer's situation was.

## Why it exists

The occasion, the patron, the dedicatee, the money if there was any. This is
the section the card compresses to a single line, so write the version the card
cannot hold.

## First performance

Date, venue, who conducted, how it went. Say plainly if it is unknown.

## Listen for

- **<hook>** — <detail>

## What Grove corrected

Anything Wikipedia had wrong, and what the record now says. Skip the section
if nothing was corrected, but only after checking.

## Still unknown

- <unknown>

## Sources

- <author>, "<title>", <container> — Zotero `<key>`
```

## Keeping the Grove page

Grove sits behind the Sydney University login and Oxford revises articles in
place, so a bare URL in `sources` promises nothing: nobody can open it later
without the session, and even with it the wording you checked may be gone. So
keep the page you actually consulted, attached to its Zotero item — one article
at a time, only ones genuinely opened. Private, and the same thing a reader has
always done with a photocopier.

Capture happens in the browser, because only the browser has the session. On the
article page in Claude in Chrome:

```js
const h = '<!-- Consulted via Oxford Music Online ' + new Date().toISOString()
        + ' -- ' + location.href + ' -->
' + document.documentElement.outerHTML;
const b = new Blob([h], {type: 'text/html'});
const a = document.createElement('a');
a.href = URL.createObjectURL(b); a.download = 'snap.html';
document.body.appendChild(a); a.click(); a.remove();
```

Then print it and attach it:

```bash
python scripts/grove_snapshot.py <saved.html> --expect "German composer"
```

`--expect` is worth passing. Chrome reports a successful print for a PDF that
has lost all its text, so the only real check is reading the text back out,
which is what the script does.

Attach the PDF to the article's Zotero item, set the item's **Accessed** date,
and put the same date on the `sources` entry in the record — then record the
attachment key in that entry's **`snapshot`** field. Grove stamps "Subscriber:
University of Sydney; date: ..." into its own page furniture, so the PDF carries
its provenance internally as well.

`snapshot` is what makes this a step rather than a good intention:
`research_to_work.py --check` warns for every `grove` source without one, the
same way it warns for a source that never reached Zotero. A record is not
finished while that warning stands.

**One download per tab.** Chrome blocks a tab's second automatic download
without asking and without any visible error — the file simply never appears.
Open a fresh tab per article. The download lands in Downloads under a temporary
name, so the URL comment on line 1 is what tells you which article you got.

**Do not use Grove's own PDF button.** It opens a native print dialog that
freezes the tab's renderer; screenshots time out and the tab has to be closed to
recover.

## Traps

- **Grove needs Claude in Chrome**, the real browser with the Sydney University
  session. The in-app Browser pane is a different browser and is not logged in.
  If Chrome is not connected, stop — a record with no `grove` source is not
  finished, and shipping one quietly is the failure this engine exists to
  prevent.
- **Numbering schemes.** Dvořák's "New World" is No. 9 now and No. 5 in older
  editions; Schubert's "Great" is No. 8 or No. 9 by edition. Record both, say
  which the card uses — and since the slug is built from the number, settle this
  *before* writing the record rather than renaming afterwards.
- **Patron ≠ dedicatee.** Wikipedia conflates them routinely and the difference
  is usually the interesting part of the story.
- **Partial premieres get reported as complete ones.** Check whether the first
  performance was public, private, or of some movements only.
- **`prepare_work.py` geocodes one place string.** A building-level place still
  hands it the city — Wikidata will not resolve a palace to a coordinate. The
  building lives in the record and the note.
- **Nationality is anachronistic more often than not.** Use the identity Grove
  uses and put the complication in `nationality_note`. Grove's own labels track
  the modern state holding the birthplace — Bonn and Hamburg give German,
  Salzburg Austrian, St Petersburg Russian — but that is an observed pattern,
  not a stated policy, and Grove sometimes assigns no nationality at all
  (Leopold Mozart is just "Composer, violinist and theorist"). Quote what the
  article actually says; do not reason from what it ought to say.
- **Omitting `place.polity` ships an unchecked claim, not a blank.** The map
  label falls back to the basemap's wording, which is wrong by two decades for
  anything Habsburg before 1804. A missing field that fails loudly would be
  safer; this one fails by printing something plausible.

## Commands

```bash
python scripts/grove_snapshot.py <saved.html> --expect "<phrase>"   # print + verify
python scripts/research_to_work.py <slug> --check     # validate the record
python scripts/research_to_work.py <slug> --dry-run   # ...and show the build command
python scripts/research_to_work.py <slug>             # ...and run it
python scripts/research_to_note.py <slug>             # write the vault note
python scripts/research_to_note.py --all              # rewrite every vault note
```
