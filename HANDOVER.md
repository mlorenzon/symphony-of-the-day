# Handover — `research-engine` branch

Written 21 Aug 2026. Delete this file when the branch merges.

Read [`CLAUDE.md`](CLAUDE.md) first, then this. This covers only what a fresh
session cannot discover from the repo: the current state, the environment
prerequisites that fail silently, and what to do next.

---

## 1. Where things stand

Five commits on `origin/research-engine`, tree clean, nothing merged to `main`:

```
ece83a5  Correct the field notes: finalize does follow the animation
fc779c5  Drive the map from the Zoom control, not MapPivot — so it actually zooms
a8803c0  Land the duotone-poster redesign, the listen-for line and the card-flip SFX
8e10202  Pin place coordinates in the record, so the map stops guessing
478ba44  Add the research engine, and Beethoven's nine symphonies through it
```

Two things landed. **A research engine** — `data/research/<slug>.json` upstream of
the card JSON, with per-field provenance, validated by
`scripts/research_to_work.py`, written up by `scripts/research_to_note.py`. And
**a fix to the map zoom, which had never worked on any card.**

| | State |
|---|---|
| Research records | 9 (Beethoven 1–9), all validating clean |
| Zotero | 10 items in *Symphony of the day* (`R77QY4EK`), keys written back |
| Vault notes | 9, in `Symphony of the day/` |
| Card JSONs | 4 — `beethoven-no-3` plus the 3 older works. **8 Beethoven records have no card yet.** |
| Built in AE | `beethoven-no-3`, **not frozen** |
| `CFG.works` in `sotd.jsx` | still only the 3 older works |

### The map zoom, and what it means for existing work

`MapPivot.transform.scale` carries a GEOlayers expression computed from
`effect("Zoom")`, so keyframes written to it are discarded. `mapZoom` wrote 62 of
them. **No card has ever zoomed** — every "30°→6° over five seconds" was a static
view. `fc779c5` fixes this by keyframing the `Zoom` control instead. Verified:
scale now varies 1.98 → 9.89 across the move.

Consequence: `data/maps/` holds **three single PNGs**, not frame sequences. The
three older works have static map stills. Re-doing them is step 2 below.

---

## 2. Environment — the parts that fail silently

**If you are on a different account from `mlorenzon@musicaviva.com.au`, read this
carefully.** Skills and repo files are filesystem-scoped and carry over. MCP
connectors are **account-scoped** and do not.

- **Zotero is a connector.** A different account starts with its own, probably
  empty. The collection key `R77QY4EK` is a key in *this* library — if the
  account points elsewhere, that key won't resolve and you need the new one.
  Without Zotero, research runs to step 4 and then has nowhere to file sources.
- **Grove Music Online needs Claude in Chrome**, not the in-app Browser pane,
  which has no Sydney University session. The extension is installed in the
  **Default** Chrome profile only (Google account: the personal one) — *not* in
  `Profile 1`. So work happens in Default, and the uni login must be live there.
- **The extension pairs with the desktop app over native messaging**
  (`com.anthropic.claude_browser_extension`, registered under HKCU so it covers
  all profiles). There is **no account sign-in in the side panel** — don't go
  looking for one. If browser tools report "not connected", the fix that worked
  was restarting Chrome: the native host spawns ~3 s after launch. Killing the
  host process does *not* make it respawn on its own.
- **The GEOlayers 3 panel must be open** for any tile fetching. The
  `geolayers3` / `mb_GEOlayers3` globals outlive the panel and keep returning
  success while downloading nothing.

Run `check-bridge` before assuming AE is reachable.

---

## 3. Next steps, in this order

### Step 1 — Freeze `beethoven-no-3`. Do this first.

The tile cache is currently warm for this work — 24 tiles for the active style
(`esri-msv7u3vdm1pqe`) across zoom 3, 4 and 5, spanning the move. That coverage is what a freeze bakes
in, and it took real effort to get. Anything that re-aims the mapcomp loses it.

```js
SOTD.freezeMapRender("beethoven-no-3");   // then, in a SEPARATE call:
SOTD.freezeMapAttach("beethoven-no-3");
```

Two calls, because `saveFrameToPng` only lands its files once the script returns.
It should write a **frame sequence** to `data/maps/beethoven-no-3/`, not a single
PNG — if you get a single PNG, the move isn't real and something has regressed.

Confirm with a render before and after; the map must still move.

### Step 2 — Re-do the three older works

`mozart-linz`, `brahms-no-4`, `shostakovich-leningrad` have static stills.
**One at a time**, because they share the single mapcomp:

```js
SOTD.buildWork(slug);      // if needed
SOTD.mapDraw(slug);        // poll SOTD.mapStatus() in a LATER call
SOTD.mapFinish(slug);
SOTD.mapZoom(slug);        // check MapPivot scale actually varies
SOTD.mapFinalize();        // poll SOTD.mapFinalizeStatus() until ok:true
SOTD.freezeMapRender(slug); SOTD.freezeMapAttach(slug);   // separate calls
```

Do not start the next work until the previous one is frozen.

### Step 3 — Add the built works to `CFG.works`

`scripts/sotd.jsx` line ~40 still lists only the three older works, so
`buildAll()` skips everything new.

### Step 4 — Build the remaining eight Beethoven cards

The research is done; only the card JSON and the AE build are outstanding.

```bash
python scripts/research_to_work.py beethoven-no-1 --dry-run   # then without --dry-run
```

Coordinates are pinned in every record, so the geocoder is no longer consulted.
Then `buildWork` → map sequence → freeze, one at a time.

### Step 5 — Worth trying: `setViewKeyframes`

`mb_GEOlayers3.hostInterface` has `setViewKeyframes` and
`animateViewBetweenFeatures` (confirmed present, 101 methods). These look like
the sanctioned way to animate a view and would likely be better than the
hand-keyframing `mapZoom` now does. **Untested, argument shapes unknown** —
recover them from the panel's own calls in `js/main.js` as §2 of the GEOlayers
doc describes.

### Step 6 — PR

https://github.com/mlorenzon/symphony-of-the-day/pull/new/research-engine

---

## 4. Traps that already cost time

- **Verify tile fetching against the cache, never the return value.** `finalize`
  reports success with the panel shut and fetches nothing.
  `SOTD.mapFinalizeStatus()` reports `ok` only if the callback came back clean
  *and* the cache grew. `mapFinalize({purge:true})` forces a real fetch.
- **`styleId` embeds a hash of the style's configured variables.** Cached
  `esri_512_2` tiles do not serve a comp using `esri-msv7u3vdm1pqe`. Easy way to
  believe coverage exists when it doesn't.
- **Never keyframe `MapPivot`.** See §1.
- **Stale view keys survive re-aiming.** The mapcomp was animating Vienna→Linz
  from `mozart-linz` while showing the Eroica. `mapZoom` now clears them.
- **`see-frame` renders the comp midpoint and ignores the playhead**, and
  sometimes returns an unreadable frame. Fall back to the newest bridge PNG:
  `ls -t "$LOCALAPPDATA/ae-mcp-bridge/"*.png | head -1`. For a specific moment,
  use `comp.saveFrameToPng(t, file)` — in one call, read in the next.
- **`prepare_work.py` geocodes a place *name*.** It resolved "Vienna" to Vienna,
  Illinois and clipped a basemap reaching New Spain. All nine records now pin
  `place.lat` / `place.lon` / `place.wikidata`; the validator warns if they're
  missing. Keep pinning them.
- **The working tree had unrelated in-progress work in it** at the start of this
  session; `a8803c0` is that work, committed with a message written from the
  diffs, not from knowledge of intent. Worth a read before merging.

## 5. Don't

- **Don't hand-edit an AE comp you want to keep.** `buildWork` deletes and
  recreates all five comps per work, and the `.aep` isn't tracked.
- **Don't freeze on a thin tile cache.** Baking locks imagery in permanently.
- **Don't rename `mozart-linz` or `shostakovich-leningrad`.** The slug convention
  is now `surname-noNN`, but those two predate it, are built and frozen, and
  renaming orphans their portraits, stills and comps. Both the skill and
  `docs/research-engine.md` say to leave them.
- **Don't ship a research record with no `grove` source.** Wikipedia is
  unchecked until Grove has seen it, and that is the whole point of the engine.
