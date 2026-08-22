# The symphony-of-the-day overlay cards

A reel is a 1080×1920 comp showing **one card at a time**: card 1 gives the
details, then the card turns over and card 2 gives the context. They never share
the screen, so each gets the full width instead of half of it.

| | Card 1 · details | Card 2 · context |
|---|---|---|
| | Composer name, in a strap across the top | **PLACE OF COMPOSITION**, and the city and polity as one address, in the strap |
| | Portrait, full bleed and duotoned | |
| | The symphony number, stamped over the art | An animated map of the place, continent to city, with the country it was written in picked out and named |
| | **ERA · YEAR · NATIONALITY** | Why it was written |
| | Full title | What to listen out for |
| | Composer dates, and his age that year | |

The comps are still named `CARD FRONT` and `CARD BACK`, because that is what they
are: front and back of the same imaginary card, and the transition is literally
it being turned over. In the reel they are labelled `CARD 1 · details` and
`CARD 2 · context`.

Cards are 440×616, which is 5:7, the standard trading-card ratio.

## The design: duotone poster

**The card *is* its period colour**, edge to edge, and the portrait and map are
duotoned into it — greyscale, a period-colour multiply, a cream screen to lift
the blacks off the floor. Baroque burnt ochre, Classical crimson, Romantic
indigo, Modern teal. A viewer reads *which era* as pure colour before reading a
word, which is the whole point at reel size: a card is about 43% of screen
width there, so anything under ~24 px on the artboard is texture, not
information.

On top of that colour it is laid out as a collector card, and reads as one at a
glance: a **name strap** across the top, the **portrait** below it with the set
number stamped over the art, then **three stats** — era, year, nationality —
and the title under them. The stats read as one ruled table: the same 2 px
hairline closes the band top and bottom and divides the three columns, the two
that close it at full cream and the two that subdivide it at 45%. (They were
5 px until they read as a heavy sandwich around the type rather than a rule
under it.) The frame is two parts: a 7 px
ring of `#14110F`, and a cream hairline inset inside it that crosses the art, so
the picture reads as a window in the card rather than a panel stuck on top.
Every mark is cream `#F4ECDC`.

The period timeline is gone — the colour carries the era, and `ERA` names it.

### Type is sized against a phone, not against the artboard

This is the constraint that governs every other decision, and the one that is
easy to get wrong because the artboard looks fine at 100%:

```
phone px  =  card px  x  (overlay scale / 100)  x  (390 / 1080)
```

At `CFG.overlay.scale` of 175 that is **about 0.63 phone pixels per card
pixel**. So an 11 px label — which looks perfectly reasonable in the AE viewer —
arrives on a phone at 7 px and is simply not there. Working minimums:

| | card px | phone px |
|---|---|---|
| Surname, place | 46 | 29 |
| Title | 40 | 25 |
| Stat value | 30 | 19 |
| Dates, age | 24 | 15 |
| Body paragraphs | 26 | 16 |
| Stat label, slab label | 18 | 11 |

Every one of those lives in `CFG.type`, which exists precisely so this can be
re-tuned in one place. **Nothing goes below 18.** If something does not fit at
18, the answer is less content, not smaller type.

Two consequences worth knowing:

- **The composer's name is two runs, not one.** "Wolfgang Amadeus Mozart" on a
  single line maxes out around 25 px before it runs out of card. Splitting the
  given names off small lets the surname be 46 px — and the surname is what a
  viewer actually reads.
- **The stat columns are weighted, not thirds.** At a readable size the word
  "NATIONALITY" is twice the width of "ERA", so equal thirds clip it. The weights
  in `CFG.stats` come from the widest string each column has to hold.

### Keep the paragraphs short

The occasion and the listen-out-for note are the only paragraphs on either card,
and they are the first thing to become unreadable on a phone. They auto-shrink to
fit, which means **a long string silently costs itself legibility** rather than
overflowing:

| occasion length | renders at | on a phone |
|---|---|---|
| up to 85 chars | 26 px | 16 px — comfortable |
| up to 120 | 23 px | 15 px |
| up to 150 | 20 px | 13 px — marginal |
| over 150 | 18 px | 11 px — pause-and-read only |

Aim for **90 characters or fewer** for each. The three listening hooks are
64–71 characters and sit at 23 px; `mozart-linz` and
`shostakovich-leningrad` carry 148- and 139-character occasions and drop to
20 px, which is the weakest text on either card.

### The focus country

The map is not a backdrop; it is an argument about *where*. So the polity the
work was written in is picked out from its neighbours and named, and the two
halves of that are built in deliberately different places:

| | Where it lives | Costs a re-bake? |
|---|---|---|
| **The highlight** — the neighbours dimmed, the country left bright | The drawn geometry inside the mapcomp, painted by `api.mapFinish` | **Yes.** It is part of the map, so a frozen work carries the highlight its bake was made with |
| **The label** — the country's name, printed on the territory | A GEOlayers label in the containing comp, built by `api.mapLabel` | **Yes**, for the same reason |

Both are inside the map, so both are baked. An earlier version put the label in
`MAP · <slug>` at a constant size, which made it free to change — and made it
read as a caption laid over a map rather than as part of one. The design wants
cartography, so the label went into the map and took the bake with it. Re-wording
a country is now a re-bake of that work, not a rebuild.

**Contrast has to be tonal, not chromatic.** The MAP sub-comp desaturates the
map and multiplies the period colour over it, so every hue set on the geometry
is discarded before anyone sees a frame. A focus colour that differs from its
neighbours only in hue arrives on the card *identical to them*, and nothing
errors. The pair in `CFG.mapInk` differs in value instead, which survives any
period colour the card is painted in.

**And it is the neighbours that get painted, not the focus.** The obvious way
round — a strong wash on the focus country, neighbours untouched — was built
first and is wrong, for a reason only a render shows. The move ends at a 6°
half-span, and at that width the focus country usually fills the entire frame:
a wash heavy enough to read at the continental end then flattens every trace of
shaded relief out of the *final* frame, which is the one a viewer dwells on.
Shostakovich was the case that exposed it, because Kuibyshev sits so deep inside
the USSR that no border is in shot at the end at all — the highlight bought
nothing and cost the whole map's texture.

Dimming the neighbours gives the same separation while the map is wide and costs
nothing at the end, when there are no neighbours in shot. So the focus country
carries only a 16% lift, and the ordinary countries carry a 34% dark wash.

### The label is a GEOlayers label, and that is the whole trick

`api.mapLabel(slug)` calls `hostInterface.addLabel`, which drops a layer into the
**containing** comp carrying a Mercator position expression driven by `Latitude`
and `Longitude` effects. That layer tracks its geographic point through the
whole move for free. It also ships a **`Scale with Map`** checkbox, which is the
feature that makes the label read as printed on the territory rather than
floating over it.

**Use the documented call.** `geolayers3.addLabel(comp, templateComp, labelData)`
where `labelData` is `{lat, lon, name}`. The internal
`hostInterface.addLabel({mapcompId, labelCompId, data, coordinates, …})` does the
same job through a much longer argument list and comp ids; it was used here
first, and it was needless.

**Do not clear the Scale expression.** `Scale with Map` is not implemented by
the checkbox — it is implemented by the stock expression *on the Scale property*,
which reads the checkbox and multiplies the layer's own `value` by the map's
scale. So the label is sized by `setValue` alone. Clearing the expression first,
which is the natural thing to do before setting a value, deletes the mechanism
and leaves a label that is still in exactly the right *place* and simply never
changes size — close enough to right to be missed in a still, and only visible
by comparing two frames.

**The base scale is not a number you can pick.** GEOlayers bakes a `scaleFactor`
into that expression when the label is created, derived from whatever view the
comp happened to be sitting on at the time — so the same `value` means different
sizes depending on when you ran the script. `mapLabel` therefore probes it: set
100, read what the expression makes of that at `zoomEnd()`, and solve for the
base that lands on `CFG.mapLabel.endScale`. The returned `scaleAtStart` /
`scaleAtEnd` are the check — they should sit in the same ratio as the move.

**The template is built to be restyled — use its own controls.** Everything
visible is parented to a null called `SCALE`, the two text layers already carry
continuous rasterisation (the documented fix for labels going blurry when
scaled), and the colour layers are swatch comps blown up to 1,000,000% so they
can never run out of coverage. Set the type and recolour `LabelColors`; nothing
needs rebuilding. An earlier version here replaced the label comp's contents
wholesale on the theory that the swatches stopped covering large glyphs. They
do not — the actual bug was leading, and the rebuild was a workaround for a
misdiagnosis.

**No plate, and black type.** The label is the one mark on this design that is
not cream, because here the map is the light ground: the focus country is the
brightest thing in frame by construction, so a black name reads straight off it.
The template's plate is switched off — it is cut from a Minimax-dilated copy of
the text, and that dilation does not keep pace with type this large, so it came
out *narrower than the word it was behind*. Switching a plate or pointer off
means disabling **both** layers of the pair, the coloured one and the shape that
mattes it: a disabled matte layer still mattes.

**One line.** For the same Minimax reason the plate never bridged two lines
either, and long names are better set across the territory than stacked.
`CFG.mapLabel.wrapOver` is set past any real name.

**Where it sits.** `map_focus.py` computes the anchor: the territory's **pole of
inaccessibility** — the interior point furthest from any border, i.e. where a
cartographer would print the name. A centroid is the obvious choice and the
wrong one, because for anything crescent-shaped it falls outside the country
altogether. Then it is clamped, for a reason particular to this move: the zoom
is a **pure zoom about the city**, the view centre never moves, so a point *d*
degrees from the city sits *d* / half-span of the way to the frame edge at every
moment — and the final half-span is the small one. Un-clamped, the label of a
large empire is off screen exactly when the viewer has arrived. It is also
pushed off the city's own latitude, or at full zoom it lands on the pin, which
is at dead centre by construction.

### What the lock costs, and the only lever that changes it

A true lock means the label is exactly as much smaller at the opening as the map
is: over a 30° → 6° move, **one fifth**. `endScale` sets the size at the city and
the opening follows from it — there is no third number to tune, and adding one
is what breaks the lock.

So at the continental view the label is a small name across a small country,
which is correct cartography and is not readable on a phone. If the opening
needs a legible label, the lever is **`CFG.map.startSpan`**: at 12° rather than
30° the move is 2× instead of 5×, and a locked label reads at both ends.

Which country it is, and what to call it, are **read, never typed** — see §1.

### Bands, not coordinates

Neither face has hand-placed rows. `CFG.front` and `CFG.back` are lists of band
heights that must tile the 588 px interior exactly, and `bands()` stacks them
into `{y, h, mid}`. Change one height and everything below moves with it; get
the arithmetic wrong and `_fits` goes false rather than something quietly
hanging off the bottom of the card. The portrait and map panels are bands like
any other, so resizing one re-renders its sub-comp to match.

The palette lives in [`data/periods.json`](../data/periods.json), one hex per
period. That file is the single source of truth for both *which* period a year
falls in (`prepare_work.py` uses it) and *what colour* that period is (the card
reads it live). Adding a fifth period is a JSON edit, not a code edit.

**Nothing on a card is typed into After Effects.** Every text layer — and the
card's colour — is bound by expression to one JSON file per work, so building
tomorrow's reel is a command, not a session of retyping.

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
  --context "Written over two summers in the Styrian hills." \
  --listen "The finale is a passacaglia: the same eight-bar bass line, over and over."
```

`--context` says why it was written, `--listen` gives a viewer who has never
heard the piece something to hang onto. Both are optional and both live in one
ink slab at the bottom of the back card — see §3.

That one command looks the composer up on Wikidata for birth and death years and
a public-domain portrait (P18), downloads the portrait from Wikimedia Commons
with its licence credit, resolves the place to coordinates (P625), picks the
historical basemap snapshot at or before the year, clips it, and writes
`data/works/<slug>.json`.

Anything it gets wrong can be overridden with a flag — `--born`, `--died`,
`--nationality`, `--lon`, `--lat`, `--slug`. Add `--dry-run` to see what it
would find without writing. Omit `--context` and the whole occasion block,
including its rule, hides itself.

It also resolves the **focus country** — the next section — so for a new work
there is nothing extra to run.

### Work out which country to highlight

`country_then` on a work is prose for a human, and it names the **constituent
land only** ("Duchy of Styria") — never the sovereign state above it, which the
map already prints. The map is drawn from a geojson whose features carry a `NAME`
that After Effects turns *verbatim* into a shape-group name ("Austria Hungary"),
and the highlight matches that string. So the two are not interchangeable, and
the one that matters is read off the same file the map is drawn from:

```bash
python scripts/map_focus.py brahms-no-4          # one work
python scripts/map_focus.py --all --dry-run      # audit every work, write nothing
```

The match is **geometric, not textual**: point-in-polygon on the composition
coordinates against the clipped geojson, which is the only method that cannot be
defeated by the dataset spelling a polity differently from the way a person
would. `prepare_work.py` calls it, so this is only run by hand when a work's
year, place or clip changes — or when a label needs rewording:

```bash
python scripts/map_focus.py mozart-linz --label "Holy Roman Empire"
```

It writes `map.focus` onto the work:

```json
"focus": {
  "name":   "Austria Hungary",   // the geojson NAME — what AE matches on
  "label":  "Austria Hungary",   // what the card prints, overridable
  "match":  "contains",          // contains | nearest | unnamed | none
  "groups": 1,                   // shapes AE should light up — a cross-check
  "note":   ""
}
```

`groups` is as much the point as `name` is. A polity split across several
features — Prussia is four of them in 1815 — becomes several shape groups under
one name, and all of them have to light up or the country comes out in pieces.
`mapFinish` reports how many it actually hit, so a disagreement is a loud
failure rather than a quietly half-coloured country.

**A `match` that is not `contains` needs a human.** All four states are
reported, and only the first is silent:

| `match` | What happened | What to do |
|---|---|---|
| `contains` | A polygon holds the city | nothing |
| `nearest` | Nothing holds it — an island, or the clip cut it away | check the suggestion; edit `map.focus.name` or empty it |
| `unnamed` | The polity here has no `NAME` | name it by hand, or empty it — see the traps |
| `none` | No coordinates, or no clipped geojson | run `prepare_work.py` first |

### The name it matches and the name it prints are two different questions

`focus.name` is a **lookup key**: whatever string the basemap uses, warts and
anachronisms included, because that is what After Effects matches. `focus.label`
is an **assertion about history that a viewer reads**. Conflating them is how a
1783 card comes to print "Austrian Empire" — a state not proclaimed until August
1804 — because that is what aourednik's 1783 file happens to call those lands.

So the label has its own source of truth, in this order:

| Order | Source | `focus.source` |
|---|---|---|
| 1 | `map_focus.py --label "…"` | `given` |
| 2 | **`composition.place.polity` in `data/research/<slug>.json`** — the country of composition, Grove-checked | `research` |
| 3 | The basemap's own `NAME` | `dataset` |

The research record is the one that should normally win, because it is the only
one that was ever verified as history — see
[`research-engine.md`](research-engine.md). It is read live rather than copied
once, so correcting the research record and re-running is the whole of a
relabel. `map_focus.py` flags any work still on `dataset`, and both it and
`prepare_work.py` print which source won, so an unchecked label is visible
rather than assumed.

Correcting the history cannot break the highlight: `focus.name` stays exactly as
the geojson spells it whatever the label says. A card reading "Habsburg
Monarchy" while matching a shape called "Austrian Empire" is working correctly.

A hand-set `label` survives a re-run — but only while the polity under it is
unchanged. Re-clipping onto a different basemap year can put a different country
under the city, and carrying yesterday's label onto it would be worse than
losing the edit.

### Build the comps

```
$.evalFile(new File("<repo>/scripts/sotd.jsx"));
SOTD.buildWork("brahms-no-4");   // one work, and open its reel
SOTD.buildAll();                 // every work in CFG.works, quietly
```

Produces `SOTD Reel · brahms-no-4` plus its four sub-comps. Re-running replaces
them in place, so it is safe to iterate.

Use `buildAll` for a batch. `buildWork` opens the reel in the viewer, which makes
AE render the whole nested chain — two duotoned sub-comps and a time-remapped
card — and doing that once per work in a loop is a lot of work nobody asked for.

### Point the map at the place, and move it

`geolayers3.draw` is asynchronous and `finalize` downloads tiles, so this is a
sequence of separate calls rather than one:

```
SOTD.mapDraw("brahms-no-4");    // swaps in the year's borders; returns at once
SOTD.mapStatus();               // poll in a LATER call until called: true
SOTD.mapFinish("brahms-no-4");  // restyle, highlight the focus, aim at the city
SOTD.mapLabel("brahms-no-4");   // print the country's name on the territory
SOTD.mapZoom("brahms-no-4");    // keyframe the continent-to-city move
SOTD.mapFinalize();             // full-resolution tiles — last, and slow
```

**Read `mapFinish`'s `focus` block before going on.** It is the only moment the
highlight can be checked cheaply, and everything after it is slow:

```js
focus: { name: "Austria Hungary", expected: 1, matched: 1, ok: true }
```

`ok: false` always carries a `warning` saying which of the three things went
wrong — no focus on the work, a name that matched nothing (almost always: the
mapcomp is still holding a different year's borders, so `mapDraw` again), or a
count that disagrees with the work JSON. `SOTD.mapFocusCheck("<slug>")` asks the
same question without changing anything, and additionally reports near-misses,
which is how a dataset spelling drift shows up as a diagnosis instead of as a
country that quietly failed to light up.

`mapZoom` opens on a continent-wide view and falls in on the city over five
seconds, then settles. It is timed in **card 2's own clock**, not the reel's —
`CFG.map.lead` after the card lands — which is what lets the whole move follow
the `Turn At` slider (see §2) with nothing re-baked.
The travel is deliberately front-loaded: about three quarters of it is spent in
the first half, and the last second barely creeps, so the move decelerates into
the city rather than arriving at speed. The pin fades up over the end of it.

**`mapFinalize` does not follow the move.** It fetches tiles for whatever
static view the mapcomp is on and knows nothing about the keyframes, so one
finalize cannot serve both ends of a 5× zoom — you get a single coarse tile
stretched over the frame. Worse, a finalize with the GEOlayers panel closed
reports success and downloads nothing at all. Verify against the tile cache,
never the return value:

```bash
find "$APPDATA/aescripts/GEOlayers3/tiles" -type f -newermt '-10 minutes' | wc -l
```

See [`geolayers-3-via-mcp.md`](geolayers-3-via-mcp.md) for the full working.

How wide it opens is capped by the clipped geojson — pull back past the clip and
its dead-straight cut edge comes on screen. `map.clip_bbox` in the work JSON
records how far the geometry actually goes, and `CFG.map.startSpan` is trimmed
to fit inside it. Shostakovich opens at 23° rather than 30° for exactly this
reason.

### Freeze it before moving on

```
SOTD.freezeMapRender("brahms-no-4");   // writes data/maps/<slug>/map_*.png
SOTD.freezeMapAttach("brahms-no-4");   // in a LATER call — see §4
```

**"A LATER call" means later than the last frame, not later than the script.**
`freezeMapAttach` only checks that frame 0 exists, so calling it while the other
135 are still being written succeeds and imports a *short* sequence — one run
attached 80 frames of 136 and reported `attached: true, animated: true`. The
move then ends early and freezes on a half-zoomed view, which no return value
mentions. Wait for the full count on disk before attaching, and confirm the
imported item afterwards:

```js
// 136 = (CFG.map.dur + CFG.map.tail) * fps + 1
Math.round(findItem("map-" + slug + " [seq]").duration * CFG.reel.fps);
```

**Do not skip this.** There is only one GEOlayers mapcomp in the project, and
every card's map panel points at it. Aiming it at tomorrow's city silently
rewrites the map on every card built before. Freezing bakes the map — the whole
move, as a PNG sequence — and cuts the link, so last week's reels still render
correctly.

Only the moving part is baked, 135 frames at 412×240. The card time-remaps it
with a clamp, so it holds the continent before the move starts and the city ever
after; the bake does not need to cover the full 30 s comp, and the start time
stays editable without re-rendering. A work whose mapcomp is not animated bakes
to a single `data/maps/<slug>.png` instead, and both are picked up
automatically.

Once a work is frozen, `buildWork` picks the bake up and will not re-attach it
to the live map. To go back to live, delete `data/maps/<slug>/` and
`data/maps/<slug>.png`, then rebuild.

---

## 2. What gets built

```
SOTD/
  Works/    SOTD Reel · <slug>       1080×1920 — the deliverable
            CARD FRONT · <slug>      440×616
            CARD BACK  · <slug>      440×616
  Assets/   PORTRAIT · <slug>        412×272  — scale-to-fill crop, duotoned
            MAP · <slug>             412×240  — map panel, duotoned, plus pin
  Data/     <slug>.json              the work
            periods.json             the periods and their colours
```

The two asset comps carry a `DATA` layer of their own, because the duotone
colour is bound to the work as well — repointing a duplicated sub-comp
recolours it.

Inside the reel comp:

| Layer | What it does |
|---|---|
| `CAMERA` | Long lens, zoom 4600, so the card does not shear as it turns |
| `CTRL` | Sliders: Reveal Start, Reveal Duration, **Turn At**, **Turn Duration**, Overlay Y, Overlay Scale |
| `RIG` | 3D null both cards hang off; driven by Overlay Y and Overlay Scale |
| `CARD 1 · details` / `CARD 2 · context` | The two faces, stacked in the same spot |
| `STAGE` | Guide layer marking where your video goes. Does not render |
| `SFX · card 1 in` / `SFX · turn over` | A card-turn sound on each move |
| `BG` | Dark solid |

### Timing it to a voiceover

Four sliders, and nothing else, decide when anything happens:

| Slider | What it moves |
|---|---|
| `Reveal Start` | When card 1 flips in |
| `Reveal Duration` | How long that takes |
| `Turn At` | **When the card turns over into card 2** |
| `Turn Duration` | How long the turn takes |

`Turn At` is the one that matters when cutting to a recorded voice. Everything
downstream follows it, including the map: drag it and the map move goes with it.

The turn is a real card flip rather than a cross-fade, in two halves. Card 1
rotates 0→ 90° over the first half and vanishes at edge-on; card 2 picks up at
− 90° and rotates to flat over the second half. Both sit at the same position,
so it reads as one object being turned over — which is also what makes the flip
sound mean something.

**The map follows `Turn At` because card 2 has its own clock.** AE cannot reach a
slider down into a nested comp, so `CARD 2` is time-remapped by expression:

```js
Math.max(0, Math.min(last, time - (tt + dt)));   // tt = Turn At, dt = Turn Duration
```

That makes the card's internal zero the moment the turn finishes. Everything
inside it — the map move, the pin fade — is timed from that zero, so retiming
the reel needs no rebuild and no re-bake. It is the one piece of machinery worth
understanding before touching the timing.

### The card-turn sound

Two turns, two sounds: one as card 1 lands, one as it turns over. Fetch the clip
once:

```bash
python scripts/fetch_sfx.py
```

That downloads a Creative Commons Attribution card-turn effect, trims it to the
550 ms that is actually the gesture, fades both ends and writes
`data/audio/card-flip.wav`. The wav is not tracked; the credit line is, in
`data/audio/credits.json` — **CC BY means the reel description has to carry
it.** `buildWork` picks the file up automatically and skips the audio layers
silently if it is missing.

> **The sound is placed, not expression-driven.** A layer's start time is not an
> expressible property in AE, so the two audio layers are positioned at build
> time from `CFG.reveal`. This is the one thing that does *not* follow the
> sliders: drag `Turn At` and `SFX · turn over` stays where it was. Drag it to
> match, or set `CFG.reveal.turnAt` and rebuild.

> Instagram's own UI covers roughly the bottom 250 px of a reel, and burned-in
> captions want the top. One card instead of two buys the room to be bigger:
> `CFG.overlay` puts it at 175% scale centred on y 1112, so it spans roughly
> y 573–1651 and leaves the top 560 px for the video. `STAGE` marks that.
> Raise `Overlay Y` or drop `Overlay Scale` if captions start colliding.

---

## 3. Adapting a card to another work

Two ways, and both work:

**By script** — `SOTD.buildWork("<slug>")`. This is the canonical path; the
design lives in `sotd.jsx` and is reproducible from nothing.

**By hand in After Effects** — duplicate `CARD FRONT · <slug>`, then edit the
single disabled guide layer named **`DATA`** at the bottom of the layer stack.
Its text is a filename, e.g. `brahms-no-4.json`. Change it to another work's
JSON (imported into `SOTD/Data`) and the entire card repoints — title, composer,
portrait framing, and the card's colour with it. The two asset sub-comps carry
their own `DATA` layer for the same reason.

That indirection is why every expression on a card starts:

```js
var D = null;
try { D = footage(thisComp.layer("DATA").text.sourceText.toString()).sourceData; } catch (e) {}
```

### Changing the design

Everything geometric is in `CFG` at the top of `sotd.jsx` — card size, padding,
panel rectangles, the horizontal bands, duotone strength, fonts. Colour is the
exception: it lives in `data/periods.json`. Change a value and rebuild; do not
nudge layers in the timeline, because the next rebuild discards that.

Cambria (regular, bold, italic) for text, **Trajan Pro 3 for caps — Regular
only**. There is no bold Trajan on any stock install, so `CFG.font.capsBold` is
Trajan Regular too, deliberately: asking for `TrajanPro3-Bold` does not error,
it substitutes.

Trajan is an **Adobe Fonts activation, not a Windows font**, and it has gone
missing once — see the traps. `SOTD.buildWork` now calls `assertFonts()` first
and refuses to build if any face fails to resolve; `SOTD.fontCheck()` prints the
rows, including each font's file location, so you can see whether it is coming
from `C:\windows\Fonts` or from Adobe's livetype cache.

The `upper` flag on a `cardStrap` run uppercases the string in its own
expression. Under Trajan that is redundant — there is no lowercase to draw —
and under anything else it is what keeps the design's capitals capital. It stays
either way, and it is why the straps survived the spell on Cambria intact.

**One exception, and it is measured, not stylistic:** `CFG.mapLabel.font` is
Cambria. "HABSBURG MONARCHY" is 281 px of the map panel's 412 in Trajan against
217 px in Cambria, and there are only about 300 px between the focus country's
western border and the card edge — in Trajan the name prints across a neighbour
the highlight exists to dim. Set it to `CFG.font.caps` to unify them, then look
at a render before believing it fits.

| To change | Edit |
|---|---|
| Card size or ratio | `CFG.card`, and the panels and bands that sit inside it |
| The ring and the cream hairline | `CFG.frame`, drawn in `cardChrome` |
| Any row's height on either face | `CFG.front` / `CFG.back` — they must still tile 588 |

| A period's colour | `data/periods.json` — not the script |
| How strong the duotone is | `CFG.duotone` — the cream screen on each panel |
| Cream and ink | `CFG.col` |
| Which portrait/map rectangle | `CFG.portraitPanel`, `CFG.mapPanel` |
| The horizontal bands down each face | `CFG.front`, `CFG.back` |
| Reel size, frame rate, duration | `CFG.reel` |
| A card's layout | the `y` values in `buildCardFront` / `buildCardBack` |
| Where text comes from | the `expr:` on that layer — `bindStr` or `bindFitted` |
| When text shrinks | the `steps` array passed to `bindFitted` |
| Reveal and turn animation | the `clock` expression block in `buildReel` |
| Where the map ends up | `--map-half-span` on `prepare_work.py` (default 6°) |
| The map move — how wide, how long, how it eases | `CFG.map` |
| Where the card sits on the reel, and how big | `CFG.overlay` |
| **Any type size** | `CFG.type` — one block, see the legibility budget above |
| Which three stats appear, and their column widths | `CFG.stats` |
| How the place line shrinks | `PLACE_STEPS` — one definition, used by the card AND by `SOTD.measurePlaces()` |
| The map label's typeface | `CFG.mapLabel.font`, which is allowed to differ from `CFG.font.caps` |
| How heavy the rules round the stats are | `CFG.front.rule` — match the STAT divider width in `statRow` |
| The place line, and where it breaks | `PLACE_LINE` above `buildCardBack`; size it with `SOTD.measurePlaces()` |
| Default reveal and turn timing | `CFG.reveal` — seeds the CTRL sliders |
| Border colour or weight, and the focus country's wash | `CFG.mapInk` |
| The country label's type, plate, or how hard it scales with the map | `CFG.mapLabel` |
| Where on the territory the label sits | the `ANCHOR_*` constants in `scripts/map_focus.py` |
| Which country is highlighted | `map.focus.name` — via `scripts/map_focus.py`, never by hand-typing a name |
| What the country is *called* on the map | `composition.place.polity` in the research record, then re-run `map_focus.py` |

`bindFitted` also glues any "abbreviation-dot space digit" pair ("No. 36",
"K. 425", "Op. 98") with a non-breaking space before fitting, so a line wrap
never orphans the number from its abbreviation.

Layout inside a card is plain top-left coordinates: `addText` and `addRect` both
take a `topLeft`, and the vertical positions in `buildCardFront` /
`buildCardBack` read top to bottom in the order they appear on the card. Adding
a row means picking a `y` and shifting what follows.

### Taking the design out to a design tool

```bash
python scripts/export_design_html.py
```

Writes `design/cards.html`: a self-contained browser mirror of all six card
faces at their real 440×616, plus a 1080×1920 reel view at actual proportions.
Portraits and map stills are embedded as base64, so the file travels alone.

The mirror exists for a **round trip** — every element carries the After Effects
layer name it maps to, as `data-layer="TITLE"`, and coordinates are the same
top-left card-space numbers `CFG` uses. A design that comes back with those
names intact ports into `sotd.jsx` by reading its numbers off.

The page states its own constraints (stock fonts only, what AE shape layers can
and cannot draw, and the fact that every string is data-bound and variable
length), so a design partner is briefed by the file itself.

Two things the mirror cannot show, and one it lies about:

- **Fonts.** Off Windows it falls back to substitutes, so Cambria is
  approximated. `design/reference/*.png` are true AE renders for typography.
- **Text metrics.** AE box text and CSS line boxes do not agree to the pixel, so
  treat vertical text placement as within a pixel or two, not exact.
- `CFG` is **duplicated** at the top of `export_design_html.py`. Change geometry
  in `sotd.jsx` and change it there too, or the mirror quietly goes stale.

`design/` is not tracked: it is regenerable, and it embeds copies of the
untracked portraits.

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
paths and three different card colours: `mozart-linz` (painted portrait,
Classical crimson, title on two lines, **both** occasion and hook), `brahms-no-4`
(photograph, Romantic indigo, short title, a hook but **no** occasion — so the
hook takes the whole slab), `shostakovich-leningrad` (Modern teal, longest
title and longest name, so both auto-shrink steps fire).

### The story slab

The bottom of the back card carries two optional fields, which is four states,
and it has to look deliberate in all of them. AE cannot reflow a layout, so
rather than stacking two blocks that leave a hole when one is missing, each
block asks whether the other is there and takes the whole slab when it is not —
the divider and the spare label disappear with it. With neither field the slab
is bare, and since it is the frame colour it reads as border rather than as a
gap. Everything is driven off two `has()` flags in one shared expression
prelude, so there is a single place where "is there a hook" is decided.

### Changing the periods

`data/periods.json` is the single source of truth for periods: `prepare_work.py`
files a work by year against it, and the card reads the matching `color` live to
paint itself. Adding a fifth period means adding a row **with a colour** and
re-running `buildWork`; a period with no colour falls back to crimson.

Boundaries shipped are the conventional teaching dates: Baroque 1600, Classical
1750, Romantic 1830, Modern 1900–2025. They are contiguous rather than
overlapping, which means a work near a boundary gets filed on one side of a line
that real musicology draws fuzzily — and on this design that decides the colour
of the whole card, so it is a louder call than it used to be.

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

**Parenting silently rewrites the child's scale.** Assigning `L.parent = rig`
makes AE bake a compensating scale into the child so its world transform does
not jump. `RIG` is already at `Overlay Scale` by expression, so a card parented
to a rig at 175% comes out at `100 / 1.75 = 57%` — net 100%, and the slider
appears to do nothing at all. This was live in the project for a long time
unnoticed, because the old default of 106% compensated to 94% and also netted
100%. Reset the scale *after* parenting:

```js
L.parent = rig;
L.property("ADBE Transform Group").property("ADBE Scale").setValue([100, 100, 100]);
```

**Time remap needs at least one keyframe to stay switched on.** Enabling it
creates two; strip them all and AE turns time remapping back off, which makes
the property *hidden* — and setting an expression on a hidden property throws
`Can not "set expression" with this property`. Leave one key and let the
expression override it:

```js
while (TR.numKeys > 1) TR.removeKey(TR.numKeys);   // not: while (TR.numKeys)
```

**Never concatenate an Error in ExtendScript.** `"failed: " + e` throws
`Object of type Error found where a Number, Array, or Property is needed` — from
inside the catch block, which buries the error you were trying to report. Use
`String(e.message || e)`.

**Measure text, do not estimate it.** Em-advance guesses were wrong enough to
clip a digit: `1783` needs 66.8 px at 30 px Cambria Bold, and an estimated
column gave it 70.4 px of box — but AE wraps box text on *advance* width while
`sourceRectAtTime` reports *ink* width, so it wrapped and the `3` was clipped
below the box. Measure the real strings instead, in a throwaway comp:

```js
var L = c.layers.addText(text);   // point text, not box text
var td = P.value; td.font = font; td.fontSize = size; td.tracking = tr; P.setValue(td);
var w = L.sourceRectAtTime(0, false).width;
```

Then size columns from the widest string each has to hold, and leave ~20%
headroom for the advance-versus-ink difference. The weights in `CFG.stats` and
the auto-shrink thresholds throughout were all derived this way.

**A font that is not installed does not error — it renders.** This one actually
shipped. Trajan Pro 3 is an Adobe Fonts activation; the activation lapsed, and
AE said nothing: no error, no warning, nothing in the DOM. It resolved
`TrajanPro3-Regular` to a placeholder and drew a sans instead, and because
Trajan is a caps-only face with no lowercase to draw, the only symptom anywhere
was **lowercase letters in a render** — "Ludwig van" where every previous render
said "LUDWIG VAN". A week of cards went out with the wrong typeface on the
loudest line of both faces before anyone looked at a picture.

The test is `app.fonts` and the FontObject's **`isSubstitute`**. Two more
obvious tests do NOT work, and both were tried first:

```js
// 1. Set the font and read it back. AE echoes your string verbatim, even for
//    a font it has never heard of. Always passes.
var td = P.value; td.font = "NoSuchFontAtAll-Regular"; P.setValue(td);
P.value.font;                    // "NoSuchFontAtAll-Regular"

// 2. Ask whether the font exists. AE fabricates a placeholder FontObject
//    rather than returning nothing. Also always passes.
app.fonts.getFontsByPostScriptName("NoSuchFontAtAll-Regular").length;   // 1

// 3. Ask the FontObject itself. This one tells the truth.
app.fonts.getFontsByPostScriptName("NoSuchFontAtAll-Regular")[0].isSubstitute;
                                 // true
```

`fontFamily` was the old tell — a real Trajan reports the spaced "Trajan Pro 3",
a placeholder reports your string unspaced. It only ever worked because the
font in question had a space in its name, and it reports a false alarm for any
genuine one-word family, Cambria included.

That is `SOTD.fontCheck()`, and `assertFonts()` runs it before every build. It
covers `CFG.mapLabel.font` as well as `CFG.font`, because a face used only
inside the map is the one a substitution would survive longest in — the map is
baked, so it stops being re-rendered the moment the work is frozen.

Two lessons, not one: **check the fonts**, and **look at a render** — the DOM
was clean and correct the entire time.

**A clipped line is invisible to the measurement you would use to catch it.**
Box text does not overflow its box, it is *clipped* by it — so a string that
wraps to three lines in a box that holds two returns a `sourceRectAtTime` height
that still fits, and a line count computed from that height that still says two.
Measuring in the real box cannot detect the failure.

This bit the moment the caps face changed. Trajan is wider than Cambria, the
place line went to three lines at a size tuned for Cambria, and the card
rendered as "VIENNA, / ARCHDUCHY OF" with `AUSTRIA` simply gone — no error, and
a measurement that said it fitted.

Measure at the real **width** in a box of huge **height**, where the third line
has somewhere to go:

```js
var L = c.layers.addBoxText([boxW, 600], t);   // 600, not the real 84
// ... set font/size/leading ...
var r = L.sourceRectAtTime(0, false);
var lines = Math.round(r.height / (size * 1.2));   // now honest
```

That is what `SOTD.measurePlaces()` does. Re-run it after any change to
`CFG.font.capsBold`, `PLACE_STEPS`, or the strap's box, and read the `lines`
column — and note that `PLACE_STEPS` is defined once and used by both the card
and the probe, because the two were briefly separate copies and the copy went
stale exactly when it mattered.

**AE rounds a rectangle but does not clip to one.** A rounded `CARD ground` does
nothing to art drawn on top of it, so full-bleed portraits square off the
corners. `cardChrome` fixes it with two layers drawn last: a stroke centred on a
path inset by half its width, which covers exactly the outer 7 px and rounds the
inner corners with it, and one shape holding a plain rect *and* a rounded rect
with an **even-odd** fill — the overlap cancels, leaving only the four corner
nubs painted. Cheaper and more predictable than a track matte.

**Shape layer strokes must be added before fills.** `addProperty` appends to the
bottom of the contents list, and lower items paint first, so a stroke added
after a fill sits behind it and half of it disappears.

**`see-frame` renders the comp midpoint and ignores the playhead.** Setting
`comp.time` changes nothing about what comes back. To inspect a specific moment
— mid-flip, say — temporarily move the thing you want to see to the midpoint
(shift the `Reveal Start` slider) and restore it afterwards. The stale-image
warning in the GEOlayers notes applies here too: when a render looks wrong, read
the newest PNG in the bridge folder directly.

**`fitViewAtTime` cannot set a keyframe, whatever its name says.** Both its
`forceKeyframe` and `time` arguments are ignored — it applies the view
statically at the comp's current time, and the property still reports zero keys.
The move is written by hand onto `MapPivot` inside the mapcomp, whose scale is
exactly `59.326 / halfSpanLon`. Full working in
[`geolayers-3-via-mcp.md`](geolayers-3-via-mcp.md).

**A successful `finalize` may have downloaded nothing.** The `geolayers3`
globals live in AE's shared engine and outlive the panel, so with the panel
closed every call still returns cleanly while no tiles are fetched. The only
reliable check is the mtime of the tile cache.

**Border weight scales with the map zoom.** `fitViewAtTime` zooms by rescaling
the mapcomp's anchor layer, which scales the drawn border strokes with it. The
restyle compensates (`width = 2.0 × half_span_lon / 6`) so borders land at the
same apparent weight whatever zoom a work uses.

**An orphaned footage item prompts forever, and the dialog names the wrong
thing.** Deleting `data/maps/<slug>/` to put a work back on the live map leaves
the imported sequence item pointing at files that no longer exist. AE then
throws *Replace Footage File* every time it opens a comp — **even though no comp
uses that item**, so `usedIn.length` is 0 and nothing on screen is wrong. Two
things make it much worse than it sounds:

- **The dialog's file browser opens in the last folder you used**, not in the
  folder it actually wants. Here it opened in `data/portraits/`, so a prompt for
  a missing *map* file read as a prompt for a composer portrait, and the obvious
  response was to point it at a portrait.
- **A wrong relink succeeds silently.** `portrait-beethoven-no-3` ended up
  pointing at `beethoven-no-1.png`, and because the nine Beethoven portraits are
  byte-identical it rendered correctly and hid itself. It would have surfaced
  only when those files diverged.

While that dialog is up it holds AE's scripting engine, so every MCP call times
out and `check-bridge` reports the panel dead when it is merely blocked. Cancel
the dialog rather than relinking, then repair from script — the audit is cheap:

```js
for (var i = 1; i <= app.project.numItems; i++) {
  var t = app.project.item(i);
  if (!(t instanceof FootageItem)) continue;
  var mp = ""; try { mp = t.mainSource.missingFootagePath || ""; } catch (e) {}
  if (mp) $.writeln(t.name + "  used=" + t.usedIn.length + "  " + mp);
}
```

Anything offline with `used=0` is an orphan and can simply be removed. And it is
worth asserting that each `portrait-<slug>` item still points at
`data/portraits/<slug>.png`, because that is the check the identical files
defeat.

**A single `execute-script` call has its own timeout, separate from AE.** Chaining
`buildWork` and `freezeMapRender` in one call exceeded it: the MCP request
returned "Request timed out" while After Effects carried on, and the render
never happened — no directory, no frames, no error anywhere. AE was fine
throughout. Keep the slow steps in separate calls, the same way the async ones
already are, and read the result of each.

**The duotone throws away every hue on the map.** The MAP sub-comp desaturates
its source and then multiplies the period colour over it, so two countries
painted in different *colours* arrive on the card identical and nothing anywhere
reports it. This is why the focus country is picked out by value — near-white at
58% against a dim parchment at 14% — and why "make it a contrasting colour" is
the wrong instruction to follow literally here. Judge any map colour on a render
of `CARD BACK · <slug>`, never on a render of the mapcomp.

**Every unnamed feature draws as a group called `Feature`.** GEOlayers names each
drawn shape group from the geojson `NAME`, and a feature whose `NAME` is null
gets the literal string `Feature` — thirty-nine of them in the 1815 snapshot
alone. So `Feature` is the one name that must never be used to target a country:
matching on it highlights half the continent. `map_focus.py` refuses to write it
and `mapFinish` refuses to act on it, and both say so; if a work's polity really
is unnamed, name it by hand in `map.focus.name` after checking what the drawn
group is actually called, or leave the field empty and go without the highlight.

**A frozen work keeps the map its bake was made with — highlight, label and
all.** Both live inside the mapcomp, so both land in `data/maps/<slug>/` when
the work is frozen, and no rebuild can change either: only `mapDraw` →
`mapFinish` → `mapLabel` → `mapZoom` → `mapFinalize` → freeze again can. So a
work frozen before a map change shows the old map and says nothing about it. The
tell is that `buildWork` reports success and the card looks untouched.

**GEOlayers ships some template layers locked.** `labelComp.layer(i).remove()`
on a locked layer throws rather than skipping, so clearing a label comp has to
set `locked = false` first. The error at least names the layer.

**The card map crops the middle band of a square comp.** The mapcomp is
1080×1080 and the panel is 412×240, so the panel shows the full width but only
about 58% of the height. `mapFinish` deliberately builds a bbox whose Mercator
height is *less* than its width, forcing longitude to be the constraining
dimension — a taller bbox would silently widen the view instead of raising it.
The city therefore lands exactly at frame centre, which is why the pin needs no
projection maths.
