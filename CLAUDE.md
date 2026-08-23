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

…and the reel's voice-over script, which is the note's last section. The
wording is fixed for the series and only five slots move — composer, title,
year, occasion, age, listening note — so it is generated from the record like
the rest of the note, never typed. Two of the slots need prose written to be
spoken rather than read: `reason.occasion_spoken` has to follow "composed in
1808 for", and `spoken` on the card hook has to follow "Listen out for". Without
them the script falls back to the scholarly wording and says so, loudly, at the
terminal and in the note.

```bash
python scripts/research_to_note.py <slug> --script
```

## Editing the reel

A recording of the script in, a finished reel out. Five commands, and the whole
edit is derived — nothing is dragged in a timeline, because `buildWork` would
throw it away.

```bash
python scripts/take_transcribe.py <slug>   # word timings, into words.json
python scripts/take_align.py <slug>        # cut + card timings + captions
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
do not. Keep each fact under ~80 characters and all four inside `CFG.back.slab`
(274 px), or the last one is clipped. A missing fact closes up and the rest
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
| 1800 | `beethoven-no-2` … `beethoven-no-8` (seven) |
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

**The layout changed for every work, and only two have been rebuilt into it.**
Full-bleed video behind the card meant the card had to come down from 175% to
120%, move left of centre (x 470) and hang from an anchor near its own top edge
— so it spans y 744–1484, clears Instagram's button rail, and leaves the top
740 px of frame for a face. The caption band sits under it at y 1562. Set by
hand in the comp and read back into `CFG.overlay` / `CFG.caption`, so it is
reproducible. `beethoven-no-5` is rebuilt into it; the other eleven still carry
the old centred 175% layout. It is a rebuild, not a
re-bake, so every frozen map survives:

```js
SOTD.buildAll();
```

Card 2's fact list is the thing to watch when that happens — it is the tightest
type in the design and it just lost 14% of its size. `Overlay Scale` is a
slider if it stops reading.

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
