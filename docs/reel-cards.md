# The symphony-of-the-day overlay cards

A reel is a 1080×1920 comp with two collector cards in the bottom third — front
and back of the same imaginary card, side by side, each flipping in on a 3D
reveal.

| | Front | Back |
|---|---|---|
| | Composer portrait | Year of composition, and the composer's age |
| | Full title | The year marked on a timeline of artistic periods |
| | Composer name, dates, nationality | Place of composition, and the polity it sat in then |
| | Number and catalogue | A map of that place, with a pin |
| | | Why it was written — blank when nothing is known |

Cards are 440×616, which is 5:7, the standard trading-card ratio.

**Nothing on a card is typed into After Effects.** Every text layer is bound by
expression to one JSON file per work, so building tomorrow's reel is a command,
not a session of retyping.

---

## 1. The daily workflow

### Gather the data

```bash
python scripts/prepare_work.py \
  --composer "Johannes Brahms" \
  --title "Symphony No. 4 in E minor, Op. 98" \
  --year 1885 \
  --place "Mürzzuschlag" \
  --number "No. 4" --catalogue "Op. 98" \
  --nationality "German" \
  --country-then "Duchy of Styria, Austria-Hungary" \
  --context "Written over two summers in the Styrian hills."
```

That one command looks the composer up on Wikidata for birth and death years and
a public-domain portrait (P18), downloads the portrait from Wikimedia Commons
with its licence credit, resolves the place to coordinates (P625), picks the
historical basemap snapshot at or before the year, clips it, and writes
`data/works/<slug>.json`.

Anything it gets wrong can be overridden with a flag — `--born`, `--died`,
`--nationality`, `--lon`, `--lat`, `--slug`. Add `--dry-run` to see what it
would find without writing. Omit `--context` and the whole occasion block,
including its rule, hides itself.

### Build the comps

```
$.evalFile(new File("<repo>/scripts/sotd.jsx"));
SOTD.buildWork("brahms-no-4");
```

Produces `SOTD Reel · brahms-no-4` plus its four sub-comps. Re-running replaces
them in place, so it is safe to iterate.

### Point the map at the place

`geolayers3.draw` is asynchronous and `finalize` downloads tiles, so this is a
sequence of separate calls rather than one:

```
SOTD.mapDraw("brahms-no-4");    // swaps in the year's borders; returns at once
SOTD.mapStatus();               // poll in a LATER call until called: true
SOTD.mapFinish("brahms-no-4");  // restyle the borders, aim at the city
SOTD.mapFinalize();             // full-resolution tiles — last, and slow
```

### Freeze it before moving on

```
SOTD.freezeMapRender("brahms-no-4");   // writes data/maps/<slug>.png
SOTD.freezeMapAttach("brahms-no-4");   // in a LATER call — see §4
```

**Do not skip this.** There is only one GEOlayers mapcomp in the project, and
every card's map panel points at it. Aiming it at tomorrow's city silently
rewrites the map on every card built before. Freezing bakes the map to a still
and cuts the link, so last week's reels still render correctly.

Once a work is frozen, `buildWork` picks the still up automatically and will not
re-attach it to the live map. To go back to live, delete
`data/maps/<slug>.png` and rebuild.

---

## 2. What gets built

```
SOTD/
  Works/    SOTD Reel · <slug>       1080×1920 — the deliverable
            CARD FRONT · <slug>      440×616
            CARD BACK  · <slug>      440×616
  Assets/   PORTRAIT · <slug>        388×304  — scale-to-fill crop
            MAP · <slug>             388×220  — map panel plus pin
  Data/     <slug>.json              the work
            periods.json             the timeline table
```

Inside the reel comp:

| Layer | What it does |
|---|---|
| `CAMERA` | Long lens, zoom 4600, so the off-centre cards do not shear |
| `CTRL` | Sliders: Reveal Start, Reveal Duration, Card Gap, Overlay Y, Overlay Scale |
| `RIG` | 3D null both cards hang off; driven by Overlay Y and Overlay Scale |
| `CARD FRONT` / `CARD BACK` | 3D layers with `Side` and `Reveal Delay` sliders |
| `STAGE` | Guide layer marking where your video goes. Does not render |
| `BG` | Dark solid |

Retiming the reveal is one slider, not a keyframe hunt: all rotation, opacity
and Z motion is expression-driven off `CTRL`.

> Instagram's own UI covers roughly the bottom 250 px of a reel. The cards sit
> lower than that by default because the brief asked for the bottom third —
> raise the `Overlay Y` slider if captions start colliding with them.

---

## 3. Adapting a card to another work

Two ways, and both work:

**By script** — `SOTD.buildWork("<slug>")`. This is the canonical path; the
design lives in `sotd.jsx` and is reproducible from nothing.

**By hand in After Effects** — duplicate `CARD FRONT · <slug>`, then edit the
single disabled guide layer named **`DATA`** at the bottom of the layer stack.
Its text is a filename, e.g. `brahms-no-4.json`. Change it to another work's
JSON (imported into `SOTD/Data`) and the entire card repoints — title, composer,
portrait framing, timeline marker, everything.

That indirection is why every expression on a card starts:

```js
var D = null;
try { D = footage(thisComp.layer("DATA").text.sourceText.toString()).sourceData; } catch (e) {}
```

### Changing the design

Everything geometric is in `CFG` at the top of `sotd.jsx` — card size, padding,
panel rectangles, palette, fonts, timeline metrics. Change a value there and
rebuild; do not nudge layers in the timeline, because the next rebuild discards
that.

Fonts in use are all Windows/Adobe stock, so the project opens anywhere:
Cambria (regular, bold, italic) for text, Trajan Pro 3 for small caps.

| To change | Edit |
|---|---|
| Card size or ratio | `CFG.card`, and the panel rects that sit inside it |
| Colours | `CFG.col` — one palette drives both cards |
| Which portrait/map rectangle | `CFG.portraitPanel`, `CFG.mapPanel` |
| Timeline bar position or height | `CFG.tl` |
| Reel size, frame rate, duration | `CFG.reel` |
| A card's layout | the `y` values in `buildCardFront` / `buildCardBack` |
| Where text comes from | the `expr:` on that layer — `bindStr` or `bindFitted` |
| When text shrinks | the `steps` array passed to `bindFitted` |
| Reveal animation | the `reveal` expression in `placeCard` |
| Map zoom | `--map-half-span` on `prepare_work.py` (default 6°) |
| Border colour or weight | the restyle loop in `api.mapFinish` |

Layout inside a card is plain top-left coordinates: `addText` and `addRect` both
take a `topLeft`, and the vertical positions in `buildCardFront` /
`buildCardBack` read top to bottom in the order they appear on the card. Adding
a row means picking a `y` and shifting what follows.

### What a rebuild keeps and what it discards

`SOTD.buildWork(slug)` recreates the PORTRAIT, MAP, CARD FRONT, CARD BACK and
reel comps from scratch, so **anything adjusted by hand in those comps is lost**.
The `.aep` is not tracked, so git will not bring it back either.

It preserves the work JSON, the downloaded portrait, and any frozen map still —
a frozen work is re-attached to its still rather than to the live map.

If you want a hand-made variant to survive, duplicate the comp and rename it out
of the `CARD FRONT · <slug>` pattern; the builder only replaces exact matches.

### Checking a change

Render, don't reason. Text overflow, clipped layers and shape paint-order
mistakes do not show up in the DOM. Note that `see-frame` renders the comp
midpoint and ignores the playhead — see the traps below.

Worth re-rendering after any layout change, because they exercise different
paths: `mozart-linz` (painted portrait, mid-length title, full occasion text),
`brahms-no-4` (photograph, short title on one line, **no** occasion — the block
and its rule should be invisible), `shostakovich-leningrad` (long title, Modern
period, marker near the right end of the timeline).

### Changing the periods

`data/periods.json` is the single source of truth for the timeline. The bar
segments, their labels, the highlight and the year marker are all generated from
it and read it live. Adding a fifth period means editing that file and re-running
`buildWork` — the segment count is built from the file, not hard-coded.

Boundaries shipped are the conventional teaching dates: Baroque 1600, Classical
1750, Romantic 1830, Modern 1900–2025. They are contiguous rather than
overlapping so the bar reads cleanly, which means a work near a boundary gets
filed on one side of a line that real musicology draws fuzzily.

---

## 4. Traps

Everything here cost time on a live install. Companion notes for the map side
are in [`geolayers-3-via-mcp.md`](geolayers-3-via-mcp.md).

**`$.evalFile` does not define globals.** It evaluates in the *caller's* scope,
so `var SOTD = ...` inside the file is local to whichever wrapper function
loaded it and is gone by the next MCP call. The multi-call map workflow needs it
to survive, hence the explicit `$.global.SOTD = SOTD` at the end of the file.

**You cannot mutate a TextDocument in an expression.** This looks right, throws
no error, and silently does nothing — the seed text stays on screen:

```js
var d = value; d.text = "new"; d.fontSize = 17; d;    // NO
```

The style API is the one that works, and it preserves box size, font and
justification:

```js
text.sourceText.style.setText(t).setFontSize(17).setLeading(20);   // yes
```

This matters because auto-shrinking is what lets one card design take titles
from `Symphony No. 4 in E minor, Op. 98` to the full Shostakovich mouthful.
Leading has to follow the size down, or shrunk text keeps the loose spacing set
for the largest step.

**Box text positions by its centre.** `boxTextPos` is always `[-w/2, -h/2]`
relative to the layer position, so the box's top-left is exactly
`position + boxTextPos` — no measuring needed. Box text is also *top*-aligned
inside its box, so a two-line title in a box sized for four hangs high and
leaves a hole. Re-centring on the measured bounds fixes it for any length:

```js
var r = thisLayer.sourceRectAtTime(time, false);
[x, targetCentreY - (r.top + r.height / 2)];
```

**`addCamera` leaves the camera at the comp's top-left corner.** The
`centerPoint` argument sets the point of interest, not the position, which
defaults to `[0, 0, -1500]` and shears every 3D layer off-axis. Set position and
point of interest explicitly, with `position.z = -zoom` for a straight-on view.

**`saveFrameToPng` finishes after your script returns.** The write shares the
script's thread, so sleeping or polling for the file inside the same call
starves the very work being waited on and the file never lands. Symptoms are a
missing file, or `"File exists but couldn't be open for reading"` from a
half-written one. Split it: render in one call, import in the next — same shape
as the async `geolayers3.draw` workflow.

**Shape layer strokes must be added before fills.** `addProperty` appends to the
bottom of the contents list, and lower items paint first, so a stroke added
after a fill sits behind it and half of it disappears.

**`see-frame` renders the comp midpoint and ignores the playhead.** Setting
`comp.time` changes nothing about what comes back. To inspect a specific moment
— mid-flip, say — temporarily move the thing you want to see to the midpoint
(shift the `Reveal Start` slider) and restore it afterwards. The stale-image
warning in the GEOlayers notes applies here too: when a render looks wrong, read
the newest PNG in the bridge folder directly.

**Border weight scales with the map zoom.** `fitViewAtTime` zooms by rescaling
the mapcomp's anchor layer, which scales the drawn border strokes with it. The
restyle compensates (`width = 2.0 × half_span_lon / 6`) so borders land at the
same apparent weight whatever zoom a work uses.

**The card map crops the middle band of a square comp.** The mapcomp is
1080×1080 and the panel is 388×220, so the panel shows the full width but only
about 57% of the height. `mapFinish` deliberately builds a bbox whose Mercator
height is *less* than its width, forcing longitude to be the constraining
dimension — a taller bbox would silently widen the view instead of raising it.
The city therefore lands exactly at frame centre, which is why the pin needs no
projection maths.
