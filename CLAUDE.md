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

`see-frame` also sometimes returns a stale or unreadable image. When it does, or
when a render looks surprising, read the newest bridge PNG directly:

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

**Only `beethoven-no-1` has the current card design too.** The thin stat rules,
the thin map rules, and card 2's "PLACE OF COMPOSITION" heading over a single
"Vienna, Archduchy of Austria" address all landed after the other eleven were
last built. That part is a plain `SOTD.buildAll()` — it is a rebuild, not a
re-bake, and it leaves every frozen map alone.

## Conventions

- Tracked: source, docs, `data/works/*.json`, `data/periods.json` (which now
  carries the period colours) and `data/audio/credits.json`. Not tracked: the
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
