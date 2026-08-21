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

The record then feeds the card:

```bash
python scripts/research_to_work.py <slug> --dry-run
```

## Making a change

1. Edit `scripts/sotd.jsx` — geometry, palette, fonts and panel rectangles are
   all in the `CFG` block at the top.
2. Rebuild every affected work:
   `["mozart-linz","brahms-no-4","shostakovich-leningrad"]` → `SOTD.buildWork`.
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
Beethoven 1–9. The live mapcomp last held 1815 borders aimed at Vienna.

## Conventions

- Tracked: source, docs, `data/works/*.json`, `data/periods.json` (which now
  carries the period colours) and `data/audio/credits.json`. Not tracked: the
  `.aep`, portraits, map stills, clipped geojson, basemaps, the card-turn wav —
  all regenerable by a script.
- Python is stdlib plus `requests` and `Pillow`, and `yt-dlp` + `ffmpeg` for
  `fetch_sfx.py`. ExtendScript is ES3: no `let`, no arrow functions, no
  template literals.
- Fonts are Windows/Adobe stock only (Cambria, Trajan Pro 3) so the project
  opens anywhere.
