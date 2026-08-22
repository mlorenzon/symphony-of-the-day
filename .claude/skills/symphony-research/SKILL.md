---
name: symphony-research
description: Research one symphony to a sourced record for the "symphony of the day" reels — Wikipedia fact-checked against Grove Music Online, saved to data/research/<slug>.json, filed in the Zotero "Symphony of the day" collection with a stored PDF of every Grove page consulted, and written up as a note in the Obsidian vault. Use WHENEVER Matthew names a symphony to research, says "today's symphony is…", "research Dvořák 9", "do the New World", or asks for the research JSON, the sources, or the Obsidian note for a work. Trigger on a bare symphony name too — in this project, naming a work is a request to research it.
---

# Researching a symphony

One work in, three artefacts out: a sourced JSON record, a Zotero folder of the
sources, and a readable note. The JSON is upstream of the card
(`data/works/<slug>.json`); the note is what a human reads.

Read `docs/research-engine.md` before the first run of a session — it carries
the schema rationale and the failure modes. This file is the procedure.

## 1. Fix the identity of the work

Symphony names are ambiguous before they are anything else. Settle, in order:
composer, number, key, catalogue number, nickname. "Dvořák 9" and "Dvořák 5"
are the same symphony under two numbering schemes; Schubert's "Great" is No. 8
or No. 9 depending on the edition. If the request is ambiguous, resolve it from
context if you can and **say which reading you took**; ask only if two readings
would produce different cards.

Slug: `surname-noNN` — `beethoven-no-3`, `brahms-no-4`. **Use the number even
when the work has a famous nickname**, so a composer's symphonies sort in order
on disk; the nickname lives in `title_short` and in the note's filename, where
a human will actually read it. For a work with no number at all, use the
nickname (`mozart-jupiter` would be `mozart-no-41`, but a standalone tone poem
would not).

Where the numbering itself is disputed, pick the modern number and record both
— see the numbering trap below.

`mozart-linz` and `shostakovich-leningrad` predate this rule and stay as they
are; they are built and frozen, and renaming them would orphan portraits, map
stills and comps. Do not "fix" them.

Check `data/works/` and `data/research/` first — a re-run should update the
record, not fork it.

## 2. Wikipedia first, as a scaffold only

Read the work's article and the composer's. Take the shape of the story and the
leads: names, dates, places, the premiere, the claims about reception. Treat
none of it as settled. Note the citations it offers — those are your next
sources, and several will be worth saving to Zotero in their own right.

## 3. Grove Music Online, as the check

Grove is behind the Sydney University login in **Claude in Chrome** — the real
browser with the live session, not the in-app Browser pane, which is not logged
in. Search Grove for the composer article and, where one exists, the work
article. Read the sections that bear on the fields you need.

Fact-check every field against Grove, not just the ones that look risky. The
things that most often differ:

- **Dates of composition** — Wikipedia frequently gives a completion date where
  Grove gives a span, or repeats a 19th-century attribution Grove has revised.
- **Place** — Wikipedia tends to name the city; Grove often knows the house, the
  patron's estate, or that the work moved between two places.
- **The country of composition** — `composition.place.polity`, the sovereign
  state the place belonged to *in that year*. This is card text: the map
  highlights that polity and prints this name. Establish it deliberately rather
  than reaching for the modern country or the duchy — they are three different
  answers, and `country_then` already holds the duchy. Vienna in 1803 is the
  Archduchy of Austria, within the Holy Roman Empire, under the Habsburg
  Monarchy; the card wants the sovereign one. **Check the date against the
  state's own dates**: no Austrian Empire before August 1804, no Austria-Hungary
  before 1867, no unified Italy before 1861 or Germany before 1871, no Soviet
  Union before 1922. Anything contested or mid-succession goes in `polity_note`.
- **Patron vs dedicatee** — routinely conflated on Wikipedia. They are often
  different people, and the difference is usually the interesting part.
- **Premiere** — date, venue, conductor, and whether the premiere was public,
  private, or partial. Partial premieres are widely reported as complete ones.
- **Nationality** — anachronistic on Wikipedia more often than not.

### Save the page before you leave it

**Every Grove article you consult gets a stored copy — no exceptions.** Grove is
behind the Sydney University login and Oxford revises articles in place, so a
URL in `sources` is not a citation anyone can follow later: not without the
session, and not with any guarantee the wording you checked survived. The copy
is private, one article at a time, and only of pages actually opened.

Do it *while you are on the page* — the browser is the only thing that has the
session. In Claude in Chrome, on the article:

```js
const h = '<!-- Consulted via Oxford Music Online ' + new Date().toISOString()
        + ' -- ' + location.href + ' -->
' + document.documentElement.outerHTML;
const b = new Blob([h], {type: 'text/html'});
const a = document.createElement('a');
a.href = URL.createObjectURL(b); a.download = 'snap.html';
document.body.appendChild(a); a.click(); a.remove();
```

It lands in Downloads under a temporary name; the URL comment on line 1 is what
identifies it. Then print and verify it:

```bash
python scripts/grove_snapshot.py <saved.html> --expect "<a phrase from the article>"
```

Pass `--expect`. Chrome reports a clean print for a PDF that has silently lost
all its text, so reading the text back out is the only real check.

**One download per tab** — Chrome blocks a tab's second automatic download
without asking and without an error, so open a fresh tab per article. **Never
click Grove's own PDF button**: it opens a native print dialog that freezes the
tab's renderer, and the tab has to be closed to recover.

Where Grove and Wikipedia disagree, Grove wins unless a more specific scholarly
source says otherwise. **Record the disagreement in `conflicts` either way** —
that is the audit trail, and it is the reason this engine exists.

If Grove is thin on a point, or the two sources disagree and Grove does not
settle it, go further: the Grove article's bibliography, the standard critical
edition's preface, journal literature. If the decisive source is paywalled,
**give Matthew the DOI and ask him to fetch it from the Sydney University
Library portal** rather than working around it or settling for less.

## 4. Write the record

`data/research/<slug>.json`, against `data/research/_schema.json`. The schema
carries the field-by-field notes; the rules that are easy to get wrong:

- **`claims`** maps each field to the source ids that support it. Every field
  that reaches the card needs an entry. Two ids means Grove and Wikipedia agree
  — that is worth recording, not redundant.
- **`conflicts: []`** means checked and clean. Omitting the key means nobody
  checked. Never omit it.
- **`unknowns`** states what is genuinely not known. Prefer it to silence, and
  never fill a gap with a plausible-sounding inference.
- **`reason.summary`** is card text: aim for 90 characters or fewer. The long
  version goes in `reason.detail`.
- **`listen_for`** takes 1–3 hooks, exactly one flagged `card: true`. The card
  hook should be actionable by someone who has never heard the piece — "the
  finale: one eight-bar bass line, over and over, rebuilt every time", not "note
  the passacaglia". 64–71 characters sits best.
- **`era`** is the scholarly judgment. `data/periods.json` buckets by year and
  that bucket drives the card's colour, so if the two disagree, decide it
  deliberately and write `era_note`.

Then validate:

```bash
python scripts/research_to_work.py <slug> --check
```

Fix everything it flags before going on.

## 5. File the sources in Zotero

Collection **Symphony of the day** (key `R77QY4EK`). Prefer
`zotero_add_by_doi`; fall back to `zotero_add_by_url` for Grove and Wikipedia,
which have no DOI. Pass `if_exists: "file"` so re-runs refile rather than
duplicate. Tag each item with the slug.

Write the returned item keys back into the record's `sources[].zotero_key` — the
validator warns until every source has one.

Then attach each Grove snapshot PDF to its item with `zotero_attach_file`, set
the item's **Accessed** date to the day you consulted it, and record the
returned attachment key in `sources[].snapshot`. The validator warns until every
`grove` source has one of those too. Zotero rejects `.html` attachments, which
is why the snapshot is printed to PDF rather than filed as the saved page.

## 6. Write the Obsidian note

Set `obsidian_note` to `Symphony of the day/<Composer> — <Work>.md`, then:

```bash
python scripts/research_to_note.py <slug>
```

The note is **laid out from the record**, not written separately: the prose
comes from the `detail` fields on `reason`, `first_performance` and each
`listen_for` entry, so the two cannot drift. That means the prose has to be in
the record — write those `detail` fields properly in step 4 and the note takes
care of itself. Re-running overwrites, so fix the record and regenerate rather
than editing the note.

## 7. Report

Tell Matthew, briefly: what the work is, anything Grove corrected in Wikipedia,
anything still unknown, and the command to build the card. Do not build the card
unless he asks — research and build are separate steps.

```bash
python scripts/research_to_work.py <slug> --dry-run
```

## Traps

- **Grove needs Claude in Chrome.** The in-app Browser pane has no Sydney
  University session. If Chrome is not connected, say so and stop rather than
  quietly shipping an unchecked Wikipedia record.
- **A record with no `grove` source is not finished**, whatever else is in it —
  and a `grove` source with no `snapshot` is a citation that will not survive
  the year. Both are validator warnings; neither is optional.
- **Chrome allows one automatic download per tab**, then blocks the rest
  silently. Four captures in one tab produce one file and no error. Fresh tab
  each time.
- **Grove's own PDF button freezes the tab.** It opens a native print dialog the
  renderer waits on; screenshots time out and only closing the tab recovers it.
- **The card is lossy on purpose.** Resist trimming the research to fit it —
  put the full account in the record and let `reason.summary` and the card hook
  be the short forms.
- **`prepare_work.py` geocodes one place string**, so a building-level place
  still hands it the city. The building lives in the record and the note.
- **Leaving `polity` out does not leave the map blank — it prints the basemap's
  guess.** aourednik's snapshots are a drawing dataset, not a reference work,
  and its 1783 and 1800 files both label the Habsburg lands "Austrian Empire",
  two decades before that state existed. A record with no polity therefore ships
  an unchecked claim onto the card rather than an obvious gap.
- **Numbering schemes are traps, not trivia.** Where a work has two numbers,
  put both in the record and say which the card uses.
