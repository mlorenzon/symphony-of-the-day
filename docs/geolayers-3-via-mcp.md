# Driving GEOlayers 3 from the After Effects MCP connector

Field notes from getting a working historical-borders mapcomp built through
`mcp__AfterEffectsMCP__execute-script`. Everything here was verified against a
live install, not inferred from docs.

**Environment this was established on**

| | |
|---|---|
| After Effects | 26.0x67 |
| GEOlayers 3 | 1.18.1 build 971 |
| Extension path | `%APPDATA%\Adobe\CEP\extensions\GEOlayers3 1_18_1_build971` |
| MCP bridge | 1.7.4-mcp-enhanced, folder `%LOCALAPPDATA%\ae-mcp-bridge` |
| Tile cache | `%APPDATA%\aescripts\GEOlayers3\tiles\` |
| Preferences | `%APPDATA%\aescripts\GEOlayers3\preferences.json` |
| Style interfaces | `<ext>\support_files\defaultStyleInterfaces\*.json` |

> The extension folder name contains a **literal space**. ExtendScript's
> `Folder.fsName` reports it URI-encoded as `GEOlayers3%201_18_1_build971`, which
> will not resolve from PowerShell, Grep or Glob. Use the space form outside
> ExtendScript, the `%20` form inside it.

---

## 1. Why this works at all

GEOlayers 3 is a CEP panel, and CEP panels normally can't be driven from
ExtendScript — you can't reach into their Chromium UI. But its `manifest.xml`
declares:

```xml
<ScriptPath>./jsx/hostscript.jsxbin</ScriptPath>
```

That compiled host script is loaded into After Effects' **shared main
ExtendScript engine** — the same engine `execute-script` runs in. So its globals
are simply sitting in scope:

```js
geolayers3                      // vendor's public scripting API
mb_GEOlayers3.hostInterface     // internal panel RPC, ~100 methods
```

Sanity check, returns `"1.18.1"`:

```js
return geolayers3.version();
```

The panel must have been loaded once in the session for these to exist.
`mb_GEOlayers3.hostInterface.initialized` tells you. Open the panel with:

```js
app.executeCommand(app.findMenuCommandId("GEOlayers 3"));   // id 5018 here
```

`"GEOlayers 3 MapStyler"` returns id `0` — no menu command, can't be opened this way.

**GEOlayers installs no AE effect plugin.** Filtering all 445 effects for "geo"
returns only stock `ADBE Geometry`. Everything it produces is ordinary comps,
shape layers, footage and expressions, so it's all scriptable after the fact.

---

## 2. The two APIs

### `geolayers3` — public, documented, stable

Signatures confirmed against <https://github.com/GEOlayers/Help>:

```js
geolayers3.draw(comp, addObj, [callback[, options]])
geolayers3.addToBrowser(addObj, [callback[, options]])
geolayers3.drawBrowserSelection(comp, [callback[, options]])
geolayers3.getBrowserSelection([callback[, options]])
geolayers3.fitViewAtTime(comp, bbox[, forceKeyframe[, time]])
geolayers3.setViewAtTime(comp, view[, forceKeyframe[, time]])
geolayers3.readFileJson(file[, encoding])
geolayers3.finalize(comps, callback[, options])
geolayers3.getMapcomps()
```

- `comp` accepts a mapcomp **name string**, a mapcomp, or the containing comp.
- `bbox` is `[lonMin, latMin, lonMax, latMax]` in WGS 84.
- `view` is `{latitude, longitude, zoom, bearing, pitch}`.
- `finalize`'s **callback is not optional in practice** — it is the only place
  errors appear. Its `options` are
  `{onlyCurrentFrame, previewQuality, onlyWorkArea, purgeImageryCache}`, all
  defaulting to `false`. See §7.
- `getMapcomps()` returns plain AE `CompItem`s, not GEOlayers wrappers, so
  there is no status or style field on them to read.

Enumerating the live object gives **38 functions**. Notably absent, in case you
go looking: `analyseMapcomp`, `addTiles`, `getZoomRange` — those are on
`hostInterface` below, not here.
- `addObj` is an ExtendScript `File`, a URL string, or a geojson object.
  `addToBrowser` accepts geojson URLs directly.
- Also present: `geolayers3.utils.*` (~80 AE helpers), `.charts`, `.logger`,
  `watch`/`watchCsv`/`unwatch`, `geocode`, `addLabel`, `importProject`.

Functions are jsxbin-compiled, so `toString()` gives `[compiled code]` and
`.length` gives arity but no parameter names. Don't try to introspect them.

### `mb_GEOlayers3.hostInterface` — internal, undocumented

**101 methods** (counted), each taking **one options object**: `createMapcomp`,
`removeMapcomp`, `duplicateMapcomp`, `setViewKeyframes`,
`animateViewBetweenFeatures`, `analyseMapcomp`, `addTiles`, `getZoomRange`,
`create3DLandscapeSetup`, `createDiagram`, `addToRenderQueue`, `queueInAme`,
`evalStr`, … — all seven of those named have been confirmed present.

`setViewKeyframes` and `animateViewBetweenFeatures` are the interesting pair:
they look like the sanctioned way to animate a view, and would likely be
better than the hand-keyframing in §5. **Untested — argument shapes unknown.**

**These return JSON strings, not objects.** Always parse:

```js
var res = JSON.parse(mb_GEOlayers3.hostInterface.getLabelTemplates());
// { status: 0, description: "completed", value: [...] }
```

`status: 0` is success. Errors come back as structured data rather than throwing,
e.g. `{"status":2,"description":"error mapcomp not existing"}`.

Argument shapes aren't documented anywhere — recover them by reading the panel's
own calls in `js/main.js` (minified onto one line, so slice by character index
rather than grepping for context):

```powershell
$t = [IO.File]::ReadAllText("$env:APPDATA\Adobe\CEP\extensions\GEOlayers3 1_18_1_build971\js\main.js")
$i = $t.IndexOf("createMapcomp"); $t.Substring([Math]::Max(0,$i-500), 1100)
```

---

## 3. What is NOT scriptable: creating a mapcomp

**Verified dead end. Don't repeat it.**

`hostInterface.createMapcomp({mapcompWrapper, mapcompTemplateAepName})` needs a
wrapper built by `mapcompHelpers.mapcompWrapperFactory`, which lives in the
panel's Angular code, not the host script. Its shape (reconstructed from
`main.js`):

```js
{
  comp: {name, width, height, duration, frameRate, pixelAspect},
  view: {latitude, longitude, zoom, bearing, pitch},
  containingComp: {},           // active comp, or {}
  data: { syncGeo, syncZoom, minZoom, maxZoom, syncRotation, linkMapcompId,
          mapcompLabels, mapcompLabelInterface, imagery, imgQuality, … },
  styleInterface: <parsed defaultStyleInterfaces/*.json>,
  styleInterfaceId: styleInterface.id,
  status: {id: 0, description: "preview"}
}
```

Useful constants pulled from `main.js`: defaults are 1920×1080, 25 fps, 30 s,
`imgQuality` 80; `gl.globalMaxZoom` is 23; the status factory maps
`0 → "preview"`, `1 → "finalization active"`, `2 → "finalized"`, `3 → "error"`.

The blocker is `data.mapcompLabelInterface`. It's assembled panel-side by
`getMatchingLabelTemplateInterfaces`, which calls the host's
`getMapcompLabelTemplateSpecs` — and that returns **"error mapcomp not
existing"** until a mapcomp already exists. Circular.

What actually happened when attempted:

- `mapcompLabelInterface: null` → `TypeError: null is not an object`, nothing created.
- With a hand-built stub → got much further: created `containing <name>`, the
  mapcomp, `GEOlayers 3 Items`, imported all label templates (28 project items),
  **then threw**. `geolayers3.getMapcomps()` still returned `0` — GEOlayers never
  registered it. The comp held 16 disabled label-template layers and no map or
  tile layers. A shell, not a mapcomp.

The registration marker is a comp called **`GEOlayers 3 Project Data`**. If that
doesn't exist, the mapcomp isn't real regardless of what else got built.

**So: create the first mapcomp in the panel.** After that, `duplicateMapcomp`
handles further ones and everything else is scriptable.

---

## 4. What a real mapcomp looks like

Creating one named `Europe` at 1080×1080 produces 34 project items:

```
containing Europe   [1080x1080, 2L]   <- Europe Anchor, Europe
Europe              [1080x1080, 21L]  <- the mapcomp itself
GEOlayers 3 Project Data [512x512]    <- registration marker
Label Templates/    11 template comps (01 Place Top … 11 Locator 2)
Tiles/              cdb1_512_2_03.png, cdb1_512_2_12.png
```

Layer stack inside the mapcomp (top to bottom):

```
1-16  mapcomplabeltemplate_* / City dot / Town dot   [all disabled]
17    providerattributiontemplate                    [enabled — leave it, licensing]
18    <your drawn shape layers>
19    MapPivot
20-21 tile_512_2_12_0, tile_512_2_03_0
```

Drawn shapes land **above** the tiles and **below** MapPivot. `fitViewAtTime`
works by rescaling the `<name> Anchor` layer in the *containing* comp — a fit
from world to Europe moved scale `3.48 → 1.70`.

---

## 5. Recipes that work

### Fit the view

```js
geolayers3.fitViewAtTime("Europe", [-11, 36, 32, 61]);
```

Synchronous. Returns the resulting view as
`{latitude, longitude, zoom, bearing, pitch}`.

### Animating the view — the name lies

`fitViewAtTime(comp, bbox, forceKeyframe, time)` and its sibling
`setViewAtTime` **ignore both trailing arguments**. Passing `true, 5` sets no
keyframe and does not act at t=5; the view is applied statically at whatever the
comp's current time happens to be. Verified: after two calls at different times
the property still reported `numKeys: 0`.

Animate it yourself instead. But **not by keyframing `MapPivot`** — that is the
trap this section used to walk into, and it cost a lot of time downstream.

### Do NOT keyframe MapPivot

`MapPivot.transform.scale` carries a GEOlayers expression, and
`expressionEnabled` is `true`. It computes itself and discards anything you key
onto it:

```js
var ZoomEff = comp("containing Europe").layer("Europe").effect("Zoom").param(1);
var scaleVal = 100*Math.pow(2, ZoomEff.valueAtTime(myTime))/mapSize*globalInterpolationTileSize;
```

An earlier version of `sotd.jsx` wrote 62 linear keyframes to that scale. They
were real, counted, and completely inert: `valueAtTime` returned the *same*
number at every time, so no card ever zoomed, and every "5× move" in the
project was a static view. Everything downstream that looked broken — coarse
imagery, a finalize that fetched three tiles — was this one fact wearing a
disguise.

### Keyframe the view controls instead

The real controls are five effects on the mapcomp's **layer in the containing
comp** (not on the mapcomp): `Latitude`, `Longitude`, `Zoom` (a Slider
Control), `Bearing`, `Pitch`.

```js
var cont = /* the "containing <name>" comp */;
var Z = cont.layer("Europe").property("ADBE Effect Parade")
            .property("Zoom").property(1);
Z.setValueAtTime(t, zoomLevel);
```

**Clear stale keys first.** Nothing does it for you: a mapcomp re-aimed at a new
work kept animating the *previous* work's pan, so a card labelled Vienna was
travelling to Linz. `hostInterface.removeMapcompControlKeys` exists for this.

### Half-span degrees ↔ zoom level

The old measurement here was correct and is still the basis of the conversion:

- **`scale = K / halfSpanLon`**, exactly. Fitting half-spans of 30/20/13/9/6°
  gave scales of 1.9775/2.9663/4.5636/6.5918/9.8877 — `K = 59.326` throughout.
- **The centre is independent of zoom.** A zoom centred on one point does not
  move it.

Combine that with `scale% = 100·2^zoom/512` from the expression and the whole
conversion collapses to one line, because scale ∝ 1/span means **halving the
span is exactly +1 zoom**:

```js
function zoomForSpan(zEnd, endH, H) { return zEnd + Math.log(endH / H) / Math.LN2; }
```

Checked against the live comp: span 6° ↔ zoom 5.6618 ↔ scale 9.8877%.

The useful corollary: interpolating the span **geometrically** is the same thing
as interpolating zoom **linearly**, so an easing curve written for one carries
over to the other untouched. Get the end zoom from one `fitViewAtTime` on the
city, derive every wider view from it, and set the keys to LINEAR — on bezier,
AE rounds its own curve through your samples and overshoots.

Measured after switching `sotd.jsx` over, which is what a working move looks
like:

```
t=0.25  zoom 3.340  scale 1.98  span 30.0°     continent
t=2.00  zoom 4.541  scale 4.55  span 13.1°
t=5.25  zoom 5.662  scale 9.89  span  6.0°     city
```

If the scale column does not change, you are keyframing the wrong property.
That is the one-line check worth running before believing any zoom works.

Interpolate the span **geometrically** (`start · (end/start)^u`), not linearly —
halving the span reads as the same amount of movement at any scale, so a linear
ramp appears to accelerate violently at the end. And set the keys to LINEAR: on
bezier, AE rounds its own curve through your samples and overshoots.

**`finalize` DOES follow these keyframes.** This section twice claimed
otherwise, and the reversals are worth keeping, because the wrong conclusion was
reached from evidence that looked airtight both times.

The claim was that finalize only ever sees the current static view. The evidence:
finalizing a keyframed 30°→6° move produced tiles at one zoom level, and a cache
check showed nothing downloaded for three days. Reasonable — and wrong. **There
was no animation.** The keys were on `MapPivot`, which ignores them (see §5), so
finalize was correctly finalizing the single static view that actually existed.
It was never the one at fault.

Once the keys went onto the `Zoom` control, a single `finalize` fetched **21 new
tiles across zoom 3, 4 and 5**, spanning the move, with the callback returning
`err: null`. That is the whole correction: finalize samples the animated view.
There is no need to bake in bands, and `addTiles` is not needed either.

Two failure modes remain real, and both report success:

- **Tiles are fetched by the panel's Chromium side.** The `geolayers3` and
  `mb_GEOlayers3` globals live in AE's shared ExtendScript engine and keep
  working after the panel is gone, so every scripted call still *succeeds* while
  quietly fetching nothing. Reopening the panel with
  `app.executeCommand(app.findMenuCommandId("GEOlayers 3"))` restores the
  globals' host side but was **not** by itself enough to make downloads resume.
- **The callback is the only place errors appear**, and the one that matters most
  is a real sentence: *"Too many tiles. The imagery coverage is too large for a
  single Mapcomp. Please consider splitting your animation to multiple
  Mapcomps."* — thrown when the sampled views exceed `maxTilesForFinalization`
  (1000). Call `finalize` without a callback and that diagnosis becomes silence.

So never trust the return value. Verify against the cache:

```bash
find "$APPDATA/aescripts/GEOlayers3/tiles" -type f -newermt '-10 minutes' | wc -l
```

`SOTD.mapFinalize` / `mapFinalizeStatus` wrap all of this: they pass a callback,
scope sampling to the move with `onlyWorkArea`, count the cache before and after,
and report `ok` only when the callback came back clean **and** the cache grew.
`{purge: true}` sets `purgeImageryCache` to force a real fetch, which is how to
tell a genuine download from re-laid cache.

One trap in the wrapping itself: `finalize` is async, so **restore the work area
inside the callback**, not after the call. Restoring it synchronously puts it
back before the sampling has read it — the same class of mistake as polling for
`saveFrameToPng` on the same thread (§8).

If the tile count does exceed the cap, the developer's own advice is to split
across multiple mapcomps — `hostInterface.duplicateMapcomp` exists for that.

---

## 6. Basemap styles — availability is the trap

Style definitions are JSON in `support_files/defaultStyleInterfaces/`. Two
independent things can make one unusable:

1. `requiredStyleSourceVars` non-empty → needs GEOlayers' **hosted map data**
   (a MapTiler-backed subscription). Check `preferences.json` →
   `maptilerApiKey` and `checkForMapdataSubscription`.
2. Its `id` appears in `preferences.json` → `hideDefaultStyleInterfacesIds` →
   it isn't even shown in the panel.

Audit both before recommending anything:

```powershell
$p = Get-Content "$env:APPDATA\aescripts\GEOlayers3\preferences.json" -Raw | ConvertFrom-Json
$d = "$env:APPDATA\Adobe\CEP\extensions\GEOlayers3 1_18_1_build971\support_files\defaultStyleInterfaces"
Get-ChildItem $d -Filter *.json | ForEach-Object {
  $j = Get-Content $_.FullName -Raw | ConvertFrom-Json
  $hidden = if ($p.hideDefaultStyleInterfacesIds -contains $j.id) { "HIDDEN" } else { "visible" }
  $req = if ([string]::IsNullOrEmpty(($j.requiredStyleSourceVars -join ""))) { "public" } else { "NEEDS-GL-DATA" }
  "{0,-10} {1,-32} {2,-8} {3}" -f $j.id, $j.name, $hidden, $req
}
```

State on this machine — only these four are both visible and subscription-free:

| id | name | modern borders | labels |
|---|---|---|---|
| `esri` | ESRI → World Shaded Relief | no | no |
| `esri` | ESRI → World Physical | no | no |
| `cdb1` | CartoDB (all variants) | **yes** | varies |
| `bing1` | Bing Aerial | no | no |

Plus `ras2` Universal Raster (bring your own tile URL) and the dataviz styles.

Gated behind the subscription: Basic, Advanced, Lite, Satellite, Natural Earth,
Admin Boundaries, and **both Water Masks** (`wmsk`, `wmskNe` — also hidden).

**For historical maps:** CartoDB is the wrong family. Even `light_nolabels`
keeps modern national boundaries baked into the raster, which sit under your
historical borders. Positron (`light_all`) additionally bakes in continent
labels — at zoom 2 the word "EUROPE" is rendered enormous. Use ESRI World Shaded
Relief or World Physical, which are purely physical.

---

## 7. Tiles

Tiles are downloaded by the **Chromium side**, not the host script. Consequences:

- Changing the view from script does **not** refetch tiles. After
  `fitViewAtTime` the comp still had only the two zoom-2 preview tiles from
  creation. Imagery stayed coarse until finalized.
- `geolayers3.finalize()` is the documented way to pull full-resolution tiles,
  and it **does** cover an animated view — but only with a callback, and only
  with the panel open. See §5.
- The cache is the only honest witness. `<styleId>` includes a hash of the
  style's configured variables, so a "bring your own tile URL" style like Esri
  appears as e.g. `esri-msv7u3vdm1pqe` — and tiles from a *differently
  configured* instance of the same style will not serve it. A cache holding
  `esri_512_2` does not help a comp using `esri-msv7u3vdm1pqe`, which is an easy
  way to think coverage exists when it does not.
- Tile files are named `<styleId>_<size>_<zoom>_<index>.png`, e.g.
  `cdb1_512_2_12.png`, cached in `%APPDATA%\aescripts\GEOlayers3\tiles\`.
  Reading one directly is the fastest way to confirm what's actually baked into
  the imagery (labels, boundaries) — much more reliable than squinting at a render.
- Relevant prefs: `maxTilesForFinalization` (1000), `tileMergerMaxTilesAtATime`
  (32), `saveTilesInProjectDirectory` (false).

**Sequence matters:** settle the style *before* finalizing, or you download a
full tile set and immediately throw it away.

---

## 8. Gotchas

**`see-frame` can return a stale image.** It returned a completely unrelated
graphic from 6 days earlier while reporting the right comp name and dimensions.
The bridge folder accumulates `__mcp_seeframe_*.png` and the wrong one can come
back — apparently a race when the render is still in flight. When a render looks
surprising, verify against the DOM and read the newest file by timestamp:

```powershell
Get-ChildItem "$env:LOCALAPPDATA\ae-mcp-bridge" -Filter *.png |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
```

Then `Read` that path directly.

**Trust `getMapcomps()` over the project panel.** Comps can exist that look like
a mapcomp and aren't registered. `geolayers3.getMapcomps().length` is the truth.
It returns AE `CompItem` objects (their keys are `width`, `numLayers`, `layer`,
…), not wrappers — don't try to read `.view` or `.styleInterface` off them.

**`getMapcompWrappers`** rejected `{}`, `{mapcompId: id}` and `{mapcompIds:[id]}`.
Argument shape still unknown; read state off the comps instead.

**Cleanup.** If a scripted attempt half-builds something, `removeMapcomp` won't
help (it needs a registered mapcomp). Delete project items directly — removing
top-level folders cascades, so 28 items came out in 3 `.remove()` calls.

---

## 9. Preparing GeoJSON: clip before you draw

Source data: [aourednik/historical-basemaps](https://github.com/aourednik/historical-basemaps),
GPL-3.0, WGS 84, 46 world snapshots from 123000 BC to 2010 plus `places.geojson`.
~73 MB total. Properties include `NAME`, `SUBJECTO`, `PARTOF`, `BORDERPRECISION`.

Feed GEOlayers whole-world files and you pay for geometry you never see —
Russia and the Ottoman Empire carry their entire Asian extent. `clip_region.py`
in this repo cuts geometry to a bbox (Sutherland–Hodgman) and simplifies
(Douglas–Peucker) first. For 1783 clipped to Europe:

```
features   641   -> 95
vertices   47620 -> 6727   (86% removed)
size       1.83 MB -> 0.26 MB
```

GEOlayers then simplifies further on import, down to 3,640 vertices.

### Clip much wider than you display

Sutherland–Hodgman leaves dead-straight edges along the bbox, and they are
obvious in a render. The trap is that **the visible area is larger than the bbox
you fit to.** `fitViewAtTime` fits the whole bbox inside the comp, so whichever
dimension has slack shows *more* than you asked for. For a square comp and a
wide bbox, that slack is all in latitude:

```python
import math
def my(lat): return math.log(math.tan(math.radians(45 + lat/2)))
def iy(y):   return math.degrees(2*math.atan(math.exp(y))) - 90
w, s, e, n = -11, 36, 32, 61          # bbox fitted to a 1080x1080 comp
half = math.radians(e - w) / 2         # width is the constraint
c    = (my(s) + my(n)) / 2
print(iy(c - half), iy(c + half))      # -> 34.31 .. 61.99, not 36..61
```

Fitting `[-11, 36, 32, 61]` actually shows **lat 34.3 to 62.0**. A clip at lat 34
therefore lands right at the frame edge and its straight cut is visible.

Settled on clipping to `[-35, 20, 60, 78]` and displaying `[-11, 36, 32, 61]`.
Cost of the margin was modest — 95 → 109 features, 6,727 → 8,091 vertices — and
GEOlayers simplifies on import anyway (final layer: 108 groups, 184 paths,
6,049 vertices).

**Telling a clip artifact from real data.** Historical datasets often *do* draw
straight boundaries across empty desert, so a straight line isn't proof. Compare
the clipped geometry against the unclipped source:

```python
# a clip forces every affected polity to the IDENTICAL latitude;
# real boundaries are ragged and differ per polity
Morocco   28.394 -> 34.000
Algiers   31.873 -> 34.000
Tunis     33.020 -> 34.000
```

Three different genuine boundaries collapsing onto exactly `34.000` is the
signature of the clip. Had they stayed at 28.4/31.9/33.0, the line would have
been real and re-clipping would have achieved nothing.

---

## 10. Working order

1. **Panel:** create the mapcomp, pick the style, set size and frame rate.
   (Frame rate defaults to 25 — set it at creation to match the edit.)
2. Script: `clip_region.py <year>` to prepare geometry.
3. Script: `geolayers3.draw(...)`, then poll for the callback.
4. Script: restyle fills and strokes — the defaults are always wrong.
5. Script: `fitViewAtTime` to a bbox inside the clip bbox.
6. Script: keyframe the **`Zoom` control** for the move — clearing stale view
   keys first, and never `MapPivot` (§5). Check that `MapPivot`'s scale now
   *varies over time*; if it doesn't, the move isn't real.
7. **Panel must be open.** `finalize()` with a callback, last — then verify the
   tile cache grew. Success is not a return value (§7).
8. Verify by reading the newest bridge PNG, not by trusting `see-frame`.

Steps 6 and 7 are in that order for a reason: finalize samples whatever the view
actually does, so there is no point fetching tiles for a move that isn't there
yet. And bake/freeze only after 7 — baking locks the imagery in permanently, so
freezing on a thin cache bakes the coarse version for good.
