# Working in this repo

Motion graphics for the "symphony of the day" reels: a 1080×1920 vertical comp
with two collector cards in the bottom third, over a GEOlayers 3 historical map.
After Effects is driven programmatically through the `AfterEffectsMCP`
connector.

## Read first

| Before touching | Read |
|---|---|
| The cards, the reel, `sotd.jsx` | [`docs/reel-cards.md`](docs/reel-cards.md) |
| The map, GEOlayers, geojson | [`docs/geolayers-3-via-mcp.md`](docs/geolayers-3-via-mcp.md) |
| Researching a work, sources, Zotero, the vault | [`docs/research-engine.md`](docs/research-engine.md) |

All three are field notes verified against a live install, and all three have a
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

The record then feeds the card:

```bash
python scripts/research_to_work.py <slug> --dry-run
```

## The era is the colour

The card *is* its period colour, edge to edge, and `data/periods.json` is the
only place that colour lives — one hex per period, read live by expression, so
changing one is a JSON edit and a rebuild, never a code edit.

| Period | Colour | |
|---|---|---|
| Baroque | `#75550C` | dark gold |
| Classical | `#254A85` | blue |
| Romantic | `#932823` | red |
| Modern | `#12554F` | teal |

**Hue is the easy half; value is the constraint.** Every mark on a card is cream
(`#F4ECDC`) straight onto the period colour, and the strap and fact plates are
ink (`#14110F`) on it. So a period colour has to be dark enough to carry cream
type and light enough for the plates to read as panels — the four are held at
cream 5.8–7.5:1 and ink 2.1–2.7:1. **That is why Baroque is a dark gold and not
a bright yellow:** at any lightness a viewer would actually call yellow, cream
type on it fails.

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
and listening paragraphs became two of four run-in facts. `SCORED FOR` is blank
on all twelve until the `scoring` research is done, and blank facts close up, so
the Beethovens currently show three facts and the other three show two.

**All twelve were rebuilt on 23 Aug 2026** for two changes. Neither is a
re-bake, so every frozen map came through untouched:

1. **The palette was reassigned** to Baroque gold, Classical blue, Romantic red,
   Modern teal. Nine of the twelve are Classical and went from crimson to blue;
   `brahms-no-4` keeps red as Romantic and `shostakovich-leningrad` keeps teal
   as Modern, so those two are unchanged by it. **No work is Baroque yet** —
   nothing in the set predates 1750 — so the gold is still untested in a render.
2. **Card 2's strap is stacked, not pinned.** The `PLACE OF COMPOSITION` heading
   and the address now centre on their plate as one measured block. All twelve
   wrap to two lines, so all twelve had been sitting ~4 px low (17 px of air
   above, 9 below) and crowding the map.

Verified in renders read off disk, not from `see-frame`'s reply: blue on
`beethoven-no-1`, red on `brahms-no-4`, teal on `shostakovich-leningrad`, and
the strap measured at 12/12 px of air on `beethoven-no-1` and 15/15 on
`beethoven-no-5` — whose place line steps down to 21 px, which is the case a
pinned strap could not have centred.

## Conventions

- Tracked: source, docs, `data/works/*.json`, `data/research/*.json`,
  `data/periods.json` (which now carries the period colours — see
  `scripts/check_palette.py`) and
  `data/audio/credits.json`. Not tracked: the
  `.aep`, portraits, map stills, clipped geojson, basemaps, the card-turn wav —
  all regenerable by a script.
- Python is stdlib plus `requests` and `Pillow`, and `yt-dlp` + `ffmpeg` for
  `fetch_sfx.py`. ExtendScript is ES3: no `let`, no arrow functions, no
  template literals.
- Fonts are Cambria for text and Trajan Pro 3 for caps — **Regular only**, so
  `CFG.font.capsBold` is Trajan Regular too. Trajan is an Adobe Fonts
  activation, not a Windows font: it lapsed once and AE substituted a sans for a
  week of cards without a word. `buildWork` now runs `assertFonts()` first and
  refuses to build on a substitution — the test is the FontObject's
  `isSubstitute`, because the two obvious tests both pass for a font that does
  not exist. `CFG.mapLabel.font` is Cambria on purpose; see `docs/reel-cards.md`.
