# Working in this repo

Motion graphics for the "symphony of the day" reels: a 1080×1920 vertical comp
with two collector cards in the bottom third, over a GEOlayers 3 historical map.
After Effects is driven programmatically through the `AfterEffectsMCP`
connector.

## Read first

| Before touching | Read |
|---|---|
| The cards, the reel, `sotd.jsx` | [`docs/reel-cards.md`](docs/reel-cards.md) |
| The recorded take, subtitles, the cut, rendering | [`docs/reel-edit.md`](docs/reel-edit.md) |
| The map, GEOlayers, geojson | [`docs/geolayers-3-via-mcp.md`](docs/geolayers-3-via-mcp.md) |
| Researching a work, sources, Zotero, the vault | [`docs/research-engine.md`](docs/research-engine.md) |

All four are field notes verified against a live install, and all four have a
**Traps** section. Reading the relevant one first reliably saves more time than
it costs — several of the traps fail silently rather than erroring.

## This repo stands on the research library

`research/` is a **git submodule**, pinned to a commit of
[`mlorenzon/research`](https://github.com/mlorenzon/research) — the general
research library that owns ingesting sources, citekeys, extracted text and the
Obsidian vault conventions. It is pinned, not tracked live, so you can always
tell which version of those conventions a given reel was made under.

| Owned there (`research/`) | Owned here |
|---|---|
| Ingest, citekeys, extracted text | After Effects, the cards, the map |
| Zotero as the bibliographic record | The recording, the cut, the render |
| Vault note frontmatter, pandoc citations | The reel script and the caption |

**When filing a source or writing a note, follow the library's conventions, not
your own** — read `research/docs/vault-notes.md` (frontmatter, the citekey
join, the preserved-prose marker) and `research/docs/answering-from-corpus.md`
(**cite printed pages, not PDF pages**) before writing. `symphony-research`
specialises those rules for symphonies; it does not replace them.

The rule that keeps the split honest: **anything invented here that is not
specific to symphonies gets promoted up into `research`.** After Effects stays
here; a better way to file a source does not.

First checkout needs `git submodule update --init`.

## The golden rule

**The design lives in `scripts/sotd.jsx`, not in the `.aep`.**

`SOTD.buildWork(slug)` deletes and recreates that work's five comps every time.
Anything nudged by hand in the timeline is gone on the next rebuild, and the
`.aep` is not tracked, so a hand-edit is not recoverable from git either.

Change the script, rebuild, verify. Never hand-edit a comp you want to keep.

## Connecting

Every `execute-script` call runs in a fresh function scope, so re-load the
library at the top of each call that needs it:

```js
$.evalFile(new File("C:/Users/mlorenzon/Desktop/random/symphony of the day/scripts/sotd.jsx"));
return SOTD.buildWork("mozart-linz");
```

`sotd.jsx` publishes itself to `$.global.SOTD`, so once any call has loaded it,
later calls in the same AE session can use `SOTD` directly — which is what makes
the multi-call async map workflow possible.

Run `check-bridge` first if anything times out or behaves oddly.

## Researching a work

The scholarship lives in `data/research/<slug>.json`, not in the card JSON. The
`symphony-research` skill runs it: Wikipedia for the shape, **Grove Music Online
fact-checks every field**, sources go to the Zotero *Symphony of the day*
collection, and a readable note goes in the Obsidian vault. Grove needs Claude
in Chrome — the in-app Browser pane has no Sydney University session.

Every Grove page consulted is also **stored as a PDF on its Zotero item**, and
its attachment key recorded in `sources[].snapshot`. Grove sits behind that
login and Oxford revises articles in place, so the URL alone will not let anyone
re-check the claim later. `--check` warns until the copy exists.

The record then feeds two things. The card:

```bash
python scripts/research_to_work.py <slug> --dry-run
```

…and the two things the shoot day needs, which are the note's last two
sections: the reel's voice-over script, and the caption the reel is posted
with. The script's wording is fixed for the series and only five slots move —
composer, title, year, occasion, age, listening note — so it is generated from
the record like the rest of the note, never typed. Two of the slots need prose written to be
spoken rather than read: `reason.occasion_spoken` has to follow "composed in
1808 for", and `spoken` on the card hook has to follow "Listen out for". Without
them the script falls back to the scholarly wording and says so, loudly, at the
terminal and in the note.

The caption is generated beside it, and its source list is **the sources under
the script's facts, not every source on the note** — read from `claims`, so a
fact the script says that nothing in `claims` covers is a warning rather than a
silently uncredited claim. Chicago style, plain text, and checked against
Instagram's 2200 characters.

```bash
python scripts/research_to_note.py <slug> --script    # both, writes nothing
```

## Editing the reel

A recording of the script in, a finished reel out. Six commands, and the whole
edit is derived — nothing is dragged in a timeline, because `buildWork` would
throw it away.

```bash
python scripts/take_transcribe.py <slug>   # word timings, into words.json
python scripts/take_align.py <slug>        # cut + card timings + captions
python scripts/take_frame.py <slug>        # --measure, then --hair/--chin
```
```js
SOTD.buildWork("<slug>");                  // comp, timed and captioned
SOTD.renderReel("<slug>");                 // out/<slug>.ae.mp4 — blocks AE
```
```bash
python scripts/reel_master.py <slug>       # out/<slug>.mp4 — the upload
```

Put the recording at `data/takes/<slug>/take_raw.mp4`: vertical, full-bleed, one
take, a second of silence at each end. **After Effects finishes the reel and
ffmpeg cuts it** — the flip timing is one expression-driven slider with the map
move hanging off it, so flattening the overlay into an NLE would turn every
200 ms adjustment into a re-render. Premiere is not in this pipeline.

**The recogniser is a clock, not a transcriber.** The script is already known —
`research_to_note.py` wrote it — so faster-whisper supplies word *times* and its
text is discarded. A misheard word is a timing wobble; it cannot put wrong text
on screen. The cut points come from `silencedetect` rather than from the words,
because on the first take the recogniser dropped the opening line entirely and
cutting to its first word would have lopped "Symphony of the Day" off the reel.

The edit lands in `data/works/<slug>.json` under `video` — the take, the four
slider values, the caption list — so a rebuild restores it exactly.

`.venv-asr/` holds faster-whisper, needs no admin rights, and
`take_transcribe.py` re-runs itself inside it. Build it once:

```bash
python -m venv .venv-asr && .venv-asr/Scripts/python -m pip install faster-whisper
```

## The era is the colour

The card *is* its period colour, edge to edge, and `data/periods.json` is the
only place that colour lives — one hex per period, read live by expression, so
changing one is a JSON edit and a rebuild, never a code edit.

| Period | Colour | |
|---|---|---|
| Baroque | `#5E2080` | imperial purple |
| Classical | `#254A85` | blue |
| Romantic | `#932823` | red |
| Modern | `#12554F` | teal |

**Hue is the easy half; value is the constraint.** Every mark on a card is cream
(`#F4ECDC`) straight onto the period colour, and the strap and fact plates are
ink (`#14110F`) on it. So a period colour has to be dark enough to carry cream
type and light enough for the plates to read as panels — the four are held at
cream 6.9–9.0:1 and ink 1.8–2.3:1. **That is why Baroque is purple and not the
yellow a hue-first reading would pick:** at any lightness a viewer would
actually call yellow, cream type on it fails, and a yellow dark enough to carry
cream reads as brown. Yellow would have needed black type, black type would have
needed light plates, and that is a second card design rather than a fourth
colour.

Baroque sits at the dark end of both numbers on purpose — a purple light enough
to reach ink 2.1 reads electric rather than rich — which is why the checker's ink
floor is 1.75 and not the 2.1 the other three share.

Run the checker after any edit to the file. It prints the table and fails on a
colour outside the band, a gap in the boundaries, or two periods a viewer could
not tell apart:

```bash
python scripts/check_palette.py
```

A period with **no** colour falls back to graphite, deliberately a colour no
period owns — it used to fall back to crimson, which was safe only until
Romantic went red, at which point an unfiled work would have painted itself
Romantic and looked entirely correct.

## Card 2 is four facts

Card 2's lower half is a list of labelled facts, each a run-in heading — the
label in Trajan caps, then the fact in sentence case on the same line, no rules
between them:

| Fact | Work JSON key | Means |
|---|---|---|
| `SCORED FOR` / `PREMIERE ORCHESTRA` | `facts.scored_for` | How many players — **and the label moves with the source**, see below |
| `FIRST PERFORMANCE` | `facts.first_performance` | Venue, city, date as one line. Derived from `first_performance` |
| `OCCASION` | `facts.occasion` | **Why the work exists** — commission, patron, dedicatee, purpose |
| `LISTEN OUT FOR` | `facts.listen_for` | The hook for someone who has never heard it |

**Occasion is not the premiere.** They are two different facts — Beethoven 9 was
commissioned in London and first played in Vienna sixteen months later. Three
records still carry premiere news in `reason.summary` (`beethoven-no-5`, `-no-6`,
`-no-7`); `research_to_work.py` warns on them, and they need rewriting to say
why the work exists instead.

**Nothing here auto-shrinks.** Titles and the place line have size steps; these
do not. Keep each fact under ~75 characters and all four inside `CFG.back.slab`
(274 px), or the last one is clipped. The body sits at 19 px
(`CFG.type.factBody`) and the labels stay behind at 16 — the budget is about ten
lines for all four facts together. A missing fact closes up and the rest
re-centre, so a work with nothing researched for one of them still looks
deliberate — `mozart-linz` currently shows two.

Three of the four labels are card structure, in `CFG.facts` in `sotd.jsx`: a
work does not get to rename one, it only gets to leave the value out.

## The first fact's label moves with its source

The number of performers can come from three different places, and they are not
the same claim — so the label changes to match, and only ever to one of two
values. The priority is in `SCORING_PRIORITY` in `research_to_work.py`:

| Priority | Research field | Card label | Card says |
|---|---|---|---|
| 1 | `scoring.specified.players` | `SCORED FOR` | `110 players` — the composer wrote the numbers into the score |
| 2 | `scoring.premiere.players` | `PREMIERE ORCHESTRA` | `69 players` — who was actually on the platform |
| 3 | `scoring.instrumentation.instruments` | `SCORED FOR` | `67 instruments` — what the parts add up to |

**The unit changes with the source, not just the number.** An instrumentation
count is *instruments*, never players, because string numbers are almost never in
the score to be counted. Saying "67 players" from that data would be inventing a
string section.

Record every level you can source — the derivation picks the best and the rest
stay in the record. There is deliberately **no modern-complement option**: a
present-day string section is a convention of ours, not a fact about the work,
and this series prints the period fact or nothing. Same rule as
`composition.place.polity`.

`research_to_work.py` warns when a work falls back to level 3, so an upgrade is
visible as soon as a premiere roster turns up.

## The country in focus

The card highlights the polity the work was written in and prints its name on
the map. These are two questions, not one:

- **Which shape to highlight** is **read, never typed** — `map_focus.py` does
  point-in-polygon on the composition coordinates against the clipped geojson,
  because After Effects matches the dataset's own spelling verbatim.
- **What to call it** is scholarship, and lives in the research record as
  `composition.place.polity` — the authoritative country of composition. The
  basemap's own wording is the last resort and is often anachronistic (it calls
  the Habsburg lands the "Austrian Empire" two decades early), so `map_focus.py`
  flags any work still relying on it.

```bash
python scripts/map_focus.py <slug>            # prepare_work.py already calls this
python scripts/map_focus.py --all --dry-run   # audit every work
```

A `match` other than `contains` in that output means a human has to look.

So does a **`LOOK`** line, which fires when the anchor is pinned to its
longitude limit — the anchor is a point, the label is wide type centred on it,
and nothing in the calculation knows the width, so the name can print across the
border it was clamped back from. Currently 11 of 12 works. Bake, look at the map
panel, and nudge if it clashes:

```bash
python scripts/map_focus.py <slug> --nudge-lon 1.10
```

The nudge is stored on the work and survives re-runs, like a hand-set `--label`.
It is inside the map, so changing it costs a re-bake, not a rebuild.

Details — the nudge, and why the highlight contrasts by *value* rather than by
hue — are in [`docs/reel-cards.md`](docs/reel-cards.md) and
[`docs/geolayers-3-via-mcp.md`](docs/geolayers-3-via-mcp.md).

## Making a change

1. Edit `scripts/sotd.jsx` — geometry, palette, fonts and panel rectangles are
   all in the `CFG` block at the top.
2. Rebuild every affected work:
   `["mozart-linz","brahms-no-4","shostakovich-leningrad"]` → `SOTD.buildWork`.
   A change to the **map** — the focus-country highlight, the country label,
   the border ink — is not a rebuild: all of it is baked into frozen works and
   needs the whole
   `mapDraw → mapFinish → mapLabel → mapZoom → mapFinalize → freeze`
   cycle per work.
3. Verify with a render. Do not trust the DOM alone; text overflow, clipped
   layers and paint-order mistakes only show up in a picture.

A rebuild **preserves** the work JSON, the downloaded portrait, and any frozen
map still. It **replaces** the PORTRAIT, MAP, CARD FRONT, CARD BACK and reel
comps wholesale.

## Verifying

`see-frame` renders the **comp midpoint** and ignores the playhead — setting
`comp.time` changes nothing. To inspect a specific moment, temporarily move that
moment to the midpoint (e.g. shift the `Reveal Start` slider) and restore it
afterwards.

**`see-frame` returns a stale image often enough that you should not read the
image it hands back at all.** Three of four calls in one session returned a
different comp from a previous day — a request for `CARD BACK` came back as the
front face, a request for `CARD FRONT` as a 1080×1920 reel frame. Call it to
trigger the render, then open the newest bridge PNG yourself; the mtime is the
only proof of what you are looking at:

```bash
ls -t "C:/Users/mlorenzon/AppData/Local/ae-mcp-bridge/"*.png | head -1
```

## The one constraint that bites

There is a single GEOlayers mapcomp, and every card's map panel points at it.
Aiming it at a new work silently rewrites the map on **every card built
earlier**. Freeze a finished work before starting the next:

```js
SOTD.freezeMapRender(slug);   // then, in a SEPARATE call:
SOTD.freezeMapAttach(slug);
```

Frozen works are immune to later map changes and stay frozen across rebuilds.

## Current state

Twelve works are built and frozen, each with a real 136-frame map move baked to
`data/maps/<slug>/`: `mozart-linz`, `brahms-no-4`, `shostakovich-leningrad`, and
Beethoven 1–9. The live mapcomp last held 1800 borders aimed at Vienna, with the
Austrian Empire highlighted.

All twelve carry a `map.focus`, so they know which country to highlight and what
to call it. But the highlight AND the label are both drawn inside the mapcomp
and therefore baked, so neither reaches a work until it is re-baked.

**Only `beethoven-no-1` has the current map** (highlight + label, the label
nudged east off the pin and re-baked). `shostakovich-leningrad` was baked with
the highlight but before the label existed. **The other ten have neither** — and
since the old card-space label was removed, they currently show no country name
at all. Each needs the full map cycle — but `mapDraw` only has to be repeated
when the **basemap year** changes, so the remaining eleven group into four
draws:

| Basemap | Works still to re-bake |
|---|---|
| 1783 | `mozart-linz` |
| 1800 | `beethoven-no-4` … `beethoven-no-8` (five) |
| 1815 | `beethoven-no-9` |
| 1880 | `brahms-no-4` |
| 1938 | `shostakovich-leningrad` (highlight only — needs the label) |

**All twelve have the current card design.** Card 2 was rebuilt as a fact list
(22 Aug 2026): the strap came down from 120 px to 96 (place 40 px → 24), the
24 px went to the slab, the two divider rules went entirely, and the occasion
and listening paragraphs became two of four run-in facts.

**The nine Beethovens now have all four facts** (23 Aug 2026): their `scoring`
research is done, so `SCORED FOR` is filled and each shows the full list. It is
level 3 on all nine — the cached Grove article carries composition dates, first
performances, publication and dedications but **no instrumentation and no
premiere rosters**, so levels 1 and 2 are unavailable and every count is the
score's distinct parts, in *instruments*. The counts run 17 (No. 4, the only one
with a single flute) to 28 (No. 9, plus 4 vocal soloists); the validator's
"falls back to instrumentation" warning is therefore permanent and correct on
all nine, and `research_to_work.py` needs `--force` to build past it. The count
rests on Wikipedia alone and is recorded as uncorroborated. `mozart-linz`,
`brahms-no-4` and `shostakovich-leningrad` have no research record at all and
still show two facts each.

**Level 2 was then hunted properly and is genuinely not there** (23 Aug 2026).
Three performance-practice sources are now in Zotero with PDFs attached — Clive
Brown, *Early Music* 16/1 (1988); Albrecht, *Music in Art* 34 (2009); Albrecht,
*The Horn Call* 29/3 (1999) — and the eight relevant records carry what each
documents. **No work upgraded**, so every card still reads `SCORED FOR`. The
reason is worth keeping, because it stops the search being repeated:

| Work | What the sources actually give |
|---|---|
| 1, 5, 6 | the theatre establishment, by Brown's *inference* — no roster |
| 3 | Lobkowitz account books for the **private** 1804/1805 performances (~26 and ~35 players), not the 7 Apr 1805 public premiere |
| 4 | a detailed list for the Jan 1808 University Hall performance (~55), a later hearing |
| 7 | Beethoven's memorandum names the **Redoutensaal**, so it is not this premiere |
| 8 | **Beethoven's own memorandum: 69 string players.** Recorded in `scoring.premiere.strings` with `players` left null — the wind is Brown's inference, so no total can be stated |
| 9 | the fall 1822 Kärntnertor house roster; the premiere force was far larger |

The one real prize is **Albrecht, *Beethoven's Ninth Symphony: Rehearsing and
Performing its 1824 Premiere* (Boydell, 2024)**, whose Appendix D annotates that
1822 roster toward 1824 and gives "possibly a total of 24 violins". **Sydney
holds it in no form** — checked on Cambridge Core (excluded from their CUP
deal), De Gruyter (purchase only) and JSTOR (`jj.5806809`, present but not
subscribed), and no print copy. It needs an inter-library loan. Appendix E would
also fill `scoring.voices.chorus`, still null.

**The nine Beethoven work JSONs were regenerated on 23 Aug 2026** and so are
ahead of the built comps: they need `SOTD.buildWork` to put the new first fact
on a card. It is a rebuild, not a re-bake — every frozen map is untouched.

**All twelve were rebuilt on 23 Aug 2026** for two changes. Neither is a
re-bake, so every frozen map came through untouched:

1. **The palette was reassigned** to Baroque purple, Classical blue, Romantic
   red, Modern teal. Nine of the twelve are Classical and went from crimson to blue;
   `brahms-no-4` keeps red as Romantic and `shostakovich-leningrad` keeps teal
   as Modern, so those two are unchanged by it. **No work is Baroque yet** —
   nothing in the set predates 1750 — so the purple has only ever been seen in
   the HTML mirror, never in an After Effects render.
2. **Card 2's strap is stacked, not pinned.** The `PLACE OF COMPOSITION` heading
   and the address now centre on their plate as one measured block. All twelve
   wrap to two lines, so all twelve had been sitting ~4 px low (17 px of air
   above, 9 below) and crowding the map.

Verified in renders read off disk, not from `see-frame`'s reply: blue on
`beethoven-no-1`, red on `brahms-no-4`, teal on `shostakovich-leningrad`, and
the strap measured at 12/12 px of air on `beethoven-no-1` and 15/15 on
`beethoven-no-5` — whose place line steps down to 21 px, which is the case a
pinned strap could not have centred.

**Step 3 — the recorded reel — is built and proved end to end** (23 Aug 2026),
but only against a stand-in: a SAPI-synthesised voice over a measurement grid,
at `data/takes/beethoven-no-5/`. Every mechanism in the chain is real and was
verified in renders read off disk — the cut is frame-accurate (the take's
burnt-in timecode read 15.360 at comp time 13.52 against a cut at 1.823), the
flip lands on "Listen out for", the fourteen captions sit in the band, and
`out/beethoven-no-5.mp4` is 27.0 s at −14.8 LUFS. **No real recording has been
through it yet**, so the numbers most likely to move on first contact are
`CFG.safe` and the caption budget.

**The AE project now holds three works: `beethoven-no-1`,
`beethoven-no-2` and `beethoven-no-3`** (23–26 Aug 2026). The
other eleven were deleted from the project deliberately — it is the first to be
recorded, and a project with twelve works in it is twelve things to scroll
past. Nothing was lost: `SOTD.buildWork(slug)` rebuilds any of them from the
work JSON, and every frozen map is still on disk in `data/maps/<slug>/`, which
is what makes that true. `CFG.works` still lists all twelve, so `buildAll()`
would bring them all back.

The project was also purged of 515 orphaned solids and nulls left behind by
past rebuilds — 590 items down to 78. **Solids only: `removeUnusedFootage()`
would have taken the work JSON with them**, because AE does not count an
expression as a use. See the trap in `docs/reel-cards.md`.

`beethoven-no-1` is rebuilt into the new layout and verified: all four facts,
the map carrying its HABSBURG MONARCHY label, and the frozen sequence still
attached after the rebuild. It has no take yet, so its reel is the nominal
30 seconds with an empty captions comp — recording it and running the four
commands is the next thing that happens.

**The layout changed for every work, and only two have been rebuilt into it.**
Full-bleed video behind the card meant the card had to come down from 175% to
120%, move left of centre (x 470) and hang from an anchor near its own top edge
— so it spans y 744–1484, clears Instagram's button rail, and leaves the top
740 px of frame for a face. The caption band sits under it at y 1562. Set by
hand in the comp and read back into `CFG.overlay` / `CFG.caption`, so it is
reproducible. `beethoven-no-1` and `beethoven-no-5` were rebuilt into it;
the other ten no longer exist in the project and will get it whenever they are
rebuilt. It is a rebuild, not a
re-bake, so every frozen map survives:

```js
SOTD.buildAll();
```

Card 2's fact list is the thing to watch when that happens — it is the tightest
type in the design and it just lost 14% of its size. `Overlay Scale` is a
slider if it stops reading.

**Card 2's body type went 18 px to 19** (25 Aug 2026), in `CFG.type.factBody`
and mirrored in `export_design_html.py` — the fact list was set at the old
175% card scale and 18 was the reel's floor, not a comfortable size, once the
card came down to 120%. The labels stayed at 16. It costs about a line of the
slab's ten-line budget, so the per-fact aim came down from 80 characters to 75;
`beethoven-no-1` measures 185 px of the 274 with 44 px of air either side.
Rebuilt and verified in a render read off disk. **Only `beethoven-no-1` has
it** — every other work gets it when it is next rebuilt, and it is a rebuild,
not a re-bake.

**`beethoven-no-2` is done to the point of recording** (25 Aug 2026). Its
research was re-verified against the live Grove article — the work-list entry for
op.36 confirms 1801–2, first performance 5 April 1803, and the Lichnowsky
dedication verbatim, and §6 confirms the finishing touches at Heiligenstadt in
the summer of 1802. Nothing in the record was wrong. It was re-baked through the
full map cycle, so it now carries the highlight and the HABSBURG MONARCHY label;
the `LOOK` line resolved clean on inspection and it needs no `--nudge-lon`.

**The spoken and printed age was a year too high, and is now derived from a
date** (25 Aug 2026). `[AGE]` in the script and "aged N" on card 1 were both
`composition.year - composer.born`, which is right only for a composer born on
1 January. Beethoven was baptised on 17 December, so every one of the nine was
overstated by a year — No. 2 said 32 for a symphony he finished at 31, and
No. 1 says 30 for one premiered when he was 29. The record now carries
`composer.born_date` and, where `date` is a span, `composition.completed`;
`research_to_note.composer_age` owns the sum and `research_to_work.py` passes it
to `prepare_work.py` as `--age` so the card and the voice-over cannot disagree.
See `docs/research-engine.md`.

**`beethoven-no-1` and `-no-2` are corrected; the other seven are not.** Those
seven have no `born_date`, so each prints a loud warning against its script and
each still carries a card built with the old sum. The fix per work is two fields
and a rebuild.

No. 1 is 29, not 30: Grove gives the composition as 1799–1800 and the premiere as
2 April 1800, so `composition.completed` is set to `1800-04` as the latest the
work can have been finished. The precision does not matter — every date in 1800
before his 17 December birthday gives 29 — and that reasoning is in the record's
`unknowns` so nobody has to redo it. Its card is rebuilt and verified at
"aged 29" in a render read off disk.

**But No. 1's reel was already cut, and the voice says "thirty years old".**
`out/beethoven-no-1.mp4` and the copy in the sync folder still carry the old
card *and* the old spoken age. Re-rendering would fix the card and leave the
voice-over wrong, which reads worse than being consistently wrong — so it has
deliberately NOT been re-rendered. That reel needs a re-record, or it goes out
as it is.

**The first real recording is through the chain** (25 Aug 2026),
`beethoven-no-2`: a 51.4 s take in, a 50.2 s reel out at −14.8 LUFS, true peak
−1.3 dBFS, `out/beethoven-no-2.mp4`. Verified by pulling frames off the mastered
file — card 1 and its captions, the flip landing edge-on at 32.5 s, card 2 with
the map moving under it, and the last caption on "is his first symphonic
scherzo." The two numbers flagged as most likely to move on first contact both
held: 31 caption lines, longest 31 characters, all inside the band, and
`CFG.safe` needed no change.

Four things the stand-in take could not have taught, all of which will recur
every day:

1. **The phone shoots 1920×1080 with a `rotation=90` flag, not 1080×1920.**
   ffmpeg honours it on decode, so the recogniser and the cut are fine either
   way — but After Effects is not to be trusted with it. Bake it before the
   take goes in `data/takes/<slug>/`:
   `ffmpeg -i <raw> -c:v libx264 -crf 18 -preset medium -pix_fmt yuv420p -c:a copy take_raw.mp4`
2. **The recordings land in `~/Desktop/random/symphony-video/`** as
   `YYYY_MM_DD_HH_MM_SS.mp4`, newest is the day's take. An `_enhanced.mp4`
   beside one is a cleaned copy from a tool outside this repo — that is what
   became `take_raw.mp4` for `beethoven-no-1`. No. 2 went through on the raw
   audio and mastered fine.
3. **The take is not the generated script.** Matthew speaks a longer version of
   it — the fixed opening and close, his own middle. `script.txt` in the take
   folder is what the captions come from, and `take_align.py` already prefers it
   over the generated script; it aligned at 99% heard, 1 word inferred. Where no
   written transcript exists, the recogniser's text is a usable *draft* for it,
   but it is on screen verbatim, so it gets confirmed before it is used.
4. **The turn cue is usually missing, so `--turn-at` is not optional.** The
   spoken version rarely contains "listen out for", and `take_align.py` then
   parks the flip mid-reel. Pick the word that starts the listening section —
   here "Now, you'd think this symphony would be gloomy…" at 32.18 s — rather
   than the beat where the hook is named, or card 2 arrives after its own point
   has been made. No. 1's cue was heard and landed at 40% of the reel; No. 2 at
   64% by hand, which is the shape to aim for.

One thing to fix at the source: **the take had no head silence.** `silencedetect`
put speech at 0.000, so `HEAD_PAD` had nothing to trim into and the reel opens on
the attack of the first word. A second of room tone before the first syllable is
what the pipeline wants.

**`prepare_work.py` used to destroy the edit, and no longer does** (25 Aug
2026). It rebuilds the work JSON from scratch, and it had no notion of the
`video` block — so re-deriving a card for a work whose reel had already been cut
silently threw away the cut, the four slider values and every caption. Nothing
warned, because the block is written by a different script (`take_align.py`) and
the file is tracked, so the loss only showed up as a diff nobody was reading.
Correcting No. 1's age would have triggered exactly that.

It now loads any existing work JSON first and carries forward the two things it
does not derive: the `video` block, and a hand-set label nudge on
`map.focus.anchor` — the latter because `map_focus.py` preserves a nudge by
loading the work from disk, while `prepare_work.py` builds a fresh dict, so the
previous focus has to be seeded in before `apply_focus` runs or `apply_nudge` has
nothing to find. It says `edit : kept the video block …` when it does.

**The head goes above the card, and it is derived like everything else**
(25 Aug 2026). `video.framing` — `zoom` on the cover scale, `x`/`y` for the
centre — reframes the take because the card cannot move: it is the same
rectangle in every reel of the series. Those numbers were hand-dragged in the
comp for `beethoven-no-1`, which is the kind of nudge `buildWork` throws away, so
`scripts/take_frame.py` now owns the arithmetic:

```bash
python scripts/take_frame.py <slug> --measure          # a filmstrip of the cut
python scripts/take_frame.py <slug> --hair 250 --chin 920
```

**The two measurements are extremes, not one frame.** He moves 80–90 px over a
take — measuring No. 2 at a single moment put the hair 135 px out and cropped
his head at the top of the reel. `--hair` is the *highest* the hair ever gets
(smallest y) and `--chin` the *lowest* the beard gets (largest y), read off one
filmstrip that carries both bands across the whole cut.

**The two constraints cannot both be met, and No. 1 settles which loses.** The
frame is exactly as tall as the take, so lifting him needs zoom to pay for it,
and zoom makes him bigger, which pushes the beard back down. Measuring what No.
1's accepted framing actually does — hair reaching source 330, beard 890, at
zoom 1.32 and centre 854 — gives 22 px of headroom and lets the beard dip 18 px
under the card. So **the hair staying in frame is the hard constraint** and the
beard grazing the card is accepted: a cropped head reads as a mistake, a beard
touching a card edge does not. The solver reproduces 1.320 / 854 exactly from No.
1's own measurements, which is the check that the reference is right.

No. 2 solved to **zoom 1.148, centre 540,838** and re-rendered; the head is clear
of the card at every sampled moment, its lowest and most upright included. Its
zoom is set by the lift rather than by head size — he sits lower in that take —
and the script says so when that happens.

**`beethoven-no-3` is shot, cut and posted** (26 Aug 2026): a 71.5 s take in, a
**70.5 s reel** out at −14.40 LUFS, true peak −1.24 dBFS,
`out/beethoven-no-3.mp4`. The longest reel of the series so far, and the first
where the ad-libbed middle is most of it — 48 caption lines against No. 2's 31,
longest 31 characters, all inside the band. Verified off the mastered file: card
1 at "aged 33", the flip edge-on at 33.2 s, card 2's four facts, and the map
settled on Vienna under its HABSBURG MONARCHY label. Framing solved to **zoom
1.212, centre 540,822** — hair at reel y 22.4 and beard 17.2 px under the card,
both identical to No. 1's accepted numbers.

**A stale bake makes `freezeMapRender` refuse, and the refusal reads like
success.** It returns `{rendered: false, reason: "already frozen"}` — which is
true but not the point: `buildWork` attaches any bake it finds in
`data/maps/<slug>/` and therefore never creates the live `MAP` layer that
`freezeMapRender` looks for. So a work with an out-of-date map cannot be re-baked
by running the cycle at it. **Move the old frames aside first, then re-run
`buildWork`, then freeze:**

```bash
mv data/maps/<slug>/*.png <somewhere>/     # then SOTD.buildWork(slug)
```

This will bite on all ten remaining works, because every one of them has exactly
this problem — a bake from before the highlight and label existed.

**`mapDraw` really can be skipped when the basemap year is unchanged.** No. 2 and
No. 3 are both 1800, same geojson, same clip bbox, same focus polity, so
`mapFinish → mapLabel → mapZoom` on the borders already drawn was enough, and the
whole panel-crash class of failure was avoided by never calling `draw`.
`mapFinalize` then reported `tilesGained: 0`, which the doc flags as ambiguous —
cache already warm, or panel shut and fetching nothing. **Resolve it by looking,
not by purging:** `comp.saveFrameToPng` on the mapcomp at three times showed Esri
terrain, 1800 borders and the highlight all present, which settles it in one call
and risks nothing. `{purge: true}` would have thrown the cache away to answer the
same question.

**Force-killing After Effects arms a "crash repair options" dialog**, and that
dialog blocks the script bridge on the next launch exactly as the original hang
did — so the obvious fix for an unresponsive bridge reproduces the symptom. Worse
if the session is locked: AE launched into a black screen wedges on that dialog
with its working set frozen (153 MB here) and the main window never created, and
no amount of waiting moves it. **Check the session is awake before restarting
AE**, and expect to dismiss the dialog by hand afterwards. The tell from outside:
a visible `#32770` window with *no child controls* — Adobe draws its own, so
enumerating it reads blank.

**No. 3's spoken and printed age is 33, and that is a decision, not a
derivation.** The record has no `composer.born_date`, so
`research_to_note.py` warned and the generated script said 33; he recorded 33.
Correcting the card alone would have put 32 on screen against a voice and a
caption both saying 33, so it ships consistent. **Whether 33 is right is
genuinely open**: `composition.date` is `1803`, which with a 17 December birthday
gives 32 — but the Eroica was finished in early 1804, which gives 33. That needs
Grove and a `composition.completed`, and until it has one No. 3 is not evidence
either way for the other six.

**Three takes, three with no head silence.** `silencedetect` again put speech at
0.000, so `HEAD_PAD` had nothing to trim into and the reel opens on the attack of
"Symphony". It is the one thing that cannot be fixed downstream. **The turn cue
was missing again too** — the spoken version has no "listen out for" at all — and
was set by hand to 32.92 s, the sentence turning from the Napoleon story to the
music itself. That is 46.7% of the reel, between No. 1's 40% and No. 2's 64%.

## Conventions

- Tracked: source, docs, `data/works/*.json` (including the derived `video`
  block — the edit is data, the media is not), `data/research/*.json`,
  `data/periods.json` (which now carries the period colours — see
  `scripts/check_palette.py`) and
  `data/audio/credits.json`. Not tracked: the
  `.aep`, portraits, map stills, clipped geojson, basemaps, the card-turn wav —
  all regenerable by a script. Nor `data/takes/` (the recordings and everything
  derived from one), `out/` (the rendered reels) or `.venv-asr/`.
- Python is stdlib plus `requests` and `Pillow`, and `yt-dlp` + `ffmpeg` for
  `fetch_sfx.py`. `ffmpeg` also cuts and masters the reel. The one dependency
  outside that is **faster-whisper, quarantined in `.venv-asr/`** and used by
  exactly one script — nothing else imports it, and the rest of the pipeline
  runs without it. ExtendScript is ES3: no `let`, no arrow functions, no
  template literals.
- Fonts are Cambria for text and Trajan Pro 3 for caps — **Regular only**, so
  `CFG.font.capsBold` is Trajan Regular too. Trajan is an Adobe Fonts
  activation, not a Windows font: it lapsed once and AE substituted a sans for a
  week of cards without a word. `buildWork` now runs `assertFonts()` first and
  refuses to build on a substitution — the test is the FontObject's
  `isSubstitute`, because the two obvious tests both pass for a font that does
  not exist. `CFG.mapLabel.font` is Cambria on purpose; see `docs/reel-cards.md`.
