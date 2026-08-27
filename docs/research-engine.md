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

## Forces

Generated, not written: the winning `scoring` block, the count the card prints,
and which of the three levels supplied it. Omitted entirely when the record has
no `scoring`. The prose comes from the blocks' own `note` and `doublings`
fields, so that is where to explain how a count was arrived at.

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

## Script

The reel voice-over, then the post caption, both fenced. Generated, never
written here.
```

## The script

The note's second-to-last section is the words read over the reel — step 1.2 of
the engine, between the research and the card. The wording is fixed for the series
and only five slots move:

> **SCRIPT**
> Symphony of the Day
> We're listening to *[Composer's]* *[Symphony title]*, composed in *[YEAR]* for
> *[Occasion]* when the composer was *[AGE]* years old. Listen out for
> *[Listening note]*. Thanks for watching. Listen to symphonies and get your
> attention span back. See you tomorrow.

Do not improve the sentences. The series works because the same words land the
same way every day; the only thing that varies is what goes in the brackets.

It is generated from the record for the same reason the rest of the note is: a
script typed by hand is a fourth place a fact can be wrong. `[YEAR]` is
`composition.year`, and the title drops the opus number and says the nickname in
words, because nobody reads "Op. 55" aloud.

**`[AGE]` is not a subtraction of years.** It was, until 25 August 2026, and it
was a year too high for most of the series: Beethoven was baptised on 17
December, so 1802 − 1770 = 32 while he was in fact 31 all through the
Heiligenstadt summer in which he finished the Second. Subtracting years is
correct only for a composer born on 1 January. So the age is taken against a
*date*:

| The record has | The age is |
|---|---|
| `composer.born_date` and a month-precise finish — `composition.completed`, or a `composition.date` that is a single date rather than a span | exact |
| `composer.born_date` and only a year | the age held before the birthday, **and a warning** naming both candidates and asking for `composition.completed` |
| no `composer.born_date` | the old subtraction, **and a warning** |

`composition.completed` exists only for this: the finest date the work was
*finished*, where `date` is a span and cannot say. It parses ISO, a bare month,
or a season — `"summer 1802"`.

The same number is printed on card 1 ("aged 31"), so `research_to_work.py`
computes it with `research_to_note.composer_age` and passes it to
`prepare_work.py` as `--age`. `prepare_work.py` keeps the subtraction as its
fallback, for a work driven straight from the command line with no record
behind it.

**The other two slots need prose written for the mouth, and the scholarly
fields cannot do it.** `reason.occasion` is a sentence in its own right, so
dropping it in gives "composed in 1802 for No commission. Finished in the
country retreat…"; the card hook is one too, so "Listen out for Four notes. The
whole first movement is built from almost nothing else." So the record carries
a spoken wording alongside each — `reason.occasion_spoken`, and `spoken` on the
hook flagged `card` — and the scholarly wording stays exactly as it was. They
are the same fact twice, in two registers, not two facts.

Write them to slot in: no capital, no full stop, and ending on a noun where you
can, because the sentence continues past both of them.

| Slot | Field | Good | Wrong |
|---|---|---|---|
| `[Occasion]` | `reason.occasion_spoken` | `a benefit concert of his own, granted him for his charity work` | `A benefit concert for the composer.` |
| `[Listening note]` | `listen_for[].spoken` | `four notes, and a whole first movement built from almost nothing else` | `Four notes. The whole first movement is built from almost nothing else.` |

A work with nothing commissioning it still has to answer "for": say so in words
that follow the preposition — "nobody but himself, in the summer his deafness
became undeniable" — rather than leaving the slot to fail.

Anything missing stays as its own square bracket in the script and is warned
about, at the terminal and again in the note as a callout. A placeholder read
aloud is a wasted take, and nothing downstream will catch it.

The script is checked for length as well: word count at 150 words a minute,
warned over 60 seconds. The Beethovens run 26–30 seconds, so the ceiling is
generous — but an occasion line written as a paragraph will find it.

```bash
python scripts/research_to_note.py <slug> --script    # script + caption, writes nothing
```

## The caption

The script is read to camera; the caption is pasted under the reel at upload.
They are drafted together, from the same record, in the same run — step 1.3, and
the last section of the note.

> Symphony of the day. Today we're listening to *[Composer's]* *[Symphony title]*.
>
> SOURCES
> *[Chicago-formatted list]*
>
> #SymphonyOfTheDay #*[Composer]* #ClassicalMusic

Fixed wording again, and the same reason: the top line is the script's own
opening fact, so it says the title exactly as the voice does — opus number
dropped, nickname in words, from the same `spoken_title`. The hashtag closes up
a two-word surname (`#VaughanWilliams`), because a hashtag cannot hold a space.

**The source list is the sources under the script, not the sources on the
note.** That is the whole point of the section: it credits the work behind the
claims the reel actually makes. A record also carries sources for the premiere
venue, the nationality argument, the instrumentation count — real scholarship
that no line of the voice-over spends, and listing it would credit a source for
a claim the video never makes.

Which sources those are is read from `claims`, never chosen by hand. Each of the
script's five slots names the field it rests on, and the first field with a
claim wins — which is how the occasion follows the same fallback the script
does:

| Slot | Claim path, first present wins |
|---|---|
| title | `title_full` |
| composer | `composer.name` |
| year | `composition.year`, then `composition.date` |
| occasion | `reason.occasion`, then `reason.summary` |
| age | `composer.born` (and `composer.born_date`) |
| listening note | `listen_for` |

So a fact the script says and `claims` does not cover is a warning, at the
terminal and in the note — the same treatment as a `[Placeholder]`. An
uncredited claim is the one kind of error this series cannot post.

The entries are Chicago bibliography style, in plain text, in record order:
author inverted, article and entry titles in quotation marks, book and score
titles bare because a caption box renders no italics. Volume and issue numbers
are not in the record, so a journal entry reduces to container and year. Record
order rather than claim order, so the same two sources come out in the same
sequence every day instead of reshuffling by which slot needed which first.

Length is checked against Instagram's 2200 characters — the tightest ceiling of
the platforms — and warned over. The Beethovens run about 550.

```bash
python scripts/research_to_note.py <slug> --script     # script + caption, writes nothing
python scripts/research_to_note.py <slug> --caption    # just the caption
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
python scripts/research_to_note.py <slug> --script    # the reel script and the caption
python scripts/research_to_note.py <slug> --caption   # just the post caption
python scripts/research_to_note.py --all              # rewrite every vault note
```
