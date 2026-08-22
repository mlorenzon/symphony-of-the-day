# Handover — `research-engine` branch

Written 21 Aug 2026, updated the same day. Delete this file when the branch
merges.

Read [`CLAUDE.md`](CLAUDE.md) first, then this. This covers only what a fresh
session cannot discover from the repo: the current state, the environment
prerequisites that fail silently, and what to do next.

---

## 1. Where things stand

**All twelve works are built, mapped and frozen.** Steps 1–4 of the previous
handover are done.

| | State |
|---|---|
| Research records | 9 (Beethoven 1–9), all validating clean |
| Zotero | 10 items in *Symphony of the day* (`R77QY4EK`), keys written back |
| Vault notes | 9, in `Symphony of the day/` |
| Card JSONs | 12 — Beethoven 1–9 plus the 3 older works |
| Built in AE | all 12, **all frozen**, each on a real 136-frame move |
| `CFG.works` in `sotd.jsx` | all 12 |

Every work's map is now a baked PNG sequence in `data/maps/<slug>/` — continent
to city, 136 frames at 25 fps. The three older works had static stills from
before the zoom fix; they were re-done from scratch (`buildWork` → `mapDraw` →
`mapFinish` → `mapZoom` → `mapFinalize` → freeze) and now move like the rest.

The live mapcomp last held **1815 borders aimed at Vienna** (`beethoven-no-9`).
It is free — every card is frozen, so re-aiming it costs nothing.

### What changed in the script

- `CFG.works` lists all twelve, so `buildAll()` walks the whole set.
- **The place strap lost its 34 px tier.** The strap is one band high (76 px), so
  a place that wraps needs two lines to fit inside it, which caps a wrapping
  size at 31. At 34 the second line rendered *under the region plate* and simply
  vanished: `beethoven-no-4` read "GRÄTZ, NEAR" with Troppau gone. Past ~14
  characters the line no longer fits the 356 px box at 40 either, so it now
  drops straight from 40 to 28. Verified in a render on no-4 (one line now),
  no-5 (two lines, both visible) and `brahms-no-4` (12 chars, untouched at 40).

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
- **The GEOlayers panel can also crash outright**, and it did during this
  session — see §4. Nothing scriptable detects it.

Run `check-bridge` before assuming AE is reachable.

---

## 3. Next steps

### Step 1 — Worth trying: `setViewKeyframes`

`mb_GEOlayers3.hostInterface` has `setViewKeyframes` and
`animateViewBetweenFeatures` (confirmed present, 108 methods). These look like
the sanctioned way to animate a view and would likely be better than the
hand-keyframing `mapZoom` now does. **Untested, argument shapes unknown** —
recover them from the panel's own calls in `js/main.js` as §2 of the GEOlayers
doc describes. Nothing depends on this; the hand-keyframed move works and every
card is baked.

### Step 2 — Two editorial gaps, both visible in a render

- **`brahms-no-4` has an empty `context`**, so its card back shows the
  "listen-out-for only" slab state with 100 px of bare card ground above it. It
  is the one work with no research record — it predates the engine. Running
  `symphony-research` on it would close the gap.
- **Two Beethoven places are phrases, not city names**: `beethoven-no-4` is
  "Grätz, near Troppau" (19 chars) and no-5 / no-6 are "Heiligenstadt, and
  Vienna" (24). They now render without losing text, but they set at 28 px and
  the Heiligenstadt one wraps to two lines, where every other card gets one loud
  city name at 40–46. Shortening them is a change to a **fact-checked field**
  (`place.city` in the research record), so it is Matthew's call, not a silent
  fix. The full description would move to `place.region` or `place.note`.

### Step 3 — PR

https://github.com/mlorenzon/symphony-of-the-day/pull/new/research-engine

---

## 4. Traps that already cost time

- **The GEOlayers panel can crash, and every scripted call keeps reporting
  success.** It happened on the first finalize aimed at a region with nothing
  cached (Kuibyshev). The tell is a **callback that never fires at all** — not
  slow, never — while `geolayers3.version()` and
  `hostInterface.initialized` both keep answering, because those live host-side.
  `draw` dies with it, and it dies *after* removing the old border layers.
  Neither the menu command nor `hostInterface.initEngine()` revived it;
  **closing and reopening the panel by hand did.** Nothing downstream was lost —
  re-running `mapDraw` for the work in flight picked it straight back up.
- **`freezeMapAttach` only checks frame 0.** Called while the bake is still
  writing, it succeeds and imports a *short* sequence — one run took 80 frames
  of 136 and still reported `attached: true, animated: true`. Wait for the full
  count on disk, then confirm `duration * fps === 136` on the imported item.
- **Verify tile fetching against the cache, never the return value.** `finalize`
  reports success with the panel shut and fetches nothing.
  `SOTD.mapFinalizeStatus()` reports `ok` only if the callback came back clean
  *and* the cache grew. `mapFinalize({purge:true})` forces a real fetch.
  **`ok: false` is not by itself a failure**: for a city near one already baked,
  every tile is genuinely cached already and the count does not move. Nine of
  the twelve works finalized to `tilesGained: 0` and rendered perfectly. Settle
  it by looking at the close end of the move — missing tiles render as flat
  empty colour, which is unmistakable.
- **`styleId` embeds a hash of the style's configured variables.** Cached
  `esri_512_2` tiles do not serve a comp using `esri-msv7u3vdm1pqe`. Easy way to
  believe coverage exists when it doesn't.
- **Never keyframe `MapPivot`.** Its scale carries a GEOlayers expression
  computed from `effect("Zoom")`, so keyframes written to it are discarded.
  Keyframe the `Zoom` control on the mapcomp's layer in `containing Europe`.
- **Stale view keys survive re-aiming.** `mapZoom` clears them now.
- **`see-frame` renders the comp midpoint and ignores the playhead**, and
  sometimes returns an unreadable frame — it failed that way twice this session.
  For a specific moment use `comp.saveFrameToPng(t, file)` in one call and read
  the file in the next; that never misbehaved.
- **`buildAll()` outruns the MCP call timeout.** Twelve works, each rebuilding
  five comps and re-importing a 136-frame sequence, took longer than the 600 s
  ceiling — the tool reported a timeout while the script ran happily to
  completion. `check-bridge` returns "no response" while AE is busy. Wait, then
  audit the comps rather than re-running the build.
- **`prepare_work.py` geocodes a place *name*.** All nine records pin
  `place.lat` / `place.lon` / `place.wikidata`; the validator warns if they're
  missing. Keep pinning them.
- **`a8803c0` was committed from the diffs**, not from knowledge of intent —
  it was unrelated in-progress work found in the tree. Worth a read before
  merging.

## 5. Don't

- **Don't hand-edit an AE comp you want to keep.** `buildWork` deletes and
  recreates all five comps per work, and the `.aep` isn't tracked. Rebuilding is
  safe for the maps, though: `buildMapComp` prefers a bake on disk over the live
  mapcomp, so all twelve survived a full `buildAll()` still frozen.
- **Don't freeze on a thin tile cache.** Baking locks imagery in permanently.
- **Don't rename `mozart-linz` or `shostakovich-leningrad`.** The slug convention
  is now `surname-noNN`, but those two predate it, are built and frozen, and
  renaming orphans their portraits, stills and comps. Both the skill and
  `docs/research-engine.md` say to leave them.
- **Don't ship a research record with no `grove` source.** Wikipedia is
  unchecked until Grove has seen it, and that is the whole point of the engine.
