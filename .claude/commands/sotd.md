---
description: Research a symphony and build its card in After Effects, up to the point of recording
argument-hint: <composer and symphony, e.g. Beethoven Symphony No. 2>
---

# Symphony of the day: $1

Take `$ARGUMENTS` through the whole first half of the pipeline — research,
record, note, card — and stop at the point where Matthew records the voice-over.
Nothing here touches `data/takes/`, `take_transcribe.py`, `take_align.py`,
`renderReel` or `reel_master.py`; those are his half.

Read `CLAUDE.md` and, before the map work, `docs/reel-cards.md` and
`docs/geolayers-3-via-mcp.md`. Work through the phases in order and do not skip
a verification because the previous step reported success.

## 1. Research — the `symphony-research` skill, in full

Invoke the `symphony-research` skill and follow it end to end: identity and
slug, Wikipedia as scaffold, **Grove Music Online in Claude in Chrome** as the
check, Zotero with a stored PDF for every Grove page, `data/research/<slug>.json`,
and the note.

If a research record already exists for the slug, update it rather than forking
it — and say what changed.

The skill's step 7 stops before the card. Here, do not stop: report what it
would have reported, then carry on to phase 2. The one thing that *does* stop
you is Chrome: if Claude in Chrome is not connected, say so and stop rather
than shipping an unchecked Wikipedia record.

## 2. The note, the script and the caption

```bash
python scripts/research_to_note.py <slug> --script
```

Run it until it is **quiet**. Every warning against the script is a slot that
will be read aloud wrong; every warning against the caption is a fact the script
states that `claims` does not cover. Fix the record and re-run — never the note,
which is overwritten. Say the script out loud once: the warnings catch missing
fields, not clumsy ones.

Then write it: `python scripts/research_to_note.py <slug>`

## 3. The card JSON

```bash
python scripts/research_to_work.py <slug> --dry-run   # read what the card will say
python scripts/research_to_work.py <slug>
```

Expect the "falls back to instrumentation" warning on any work with no premiere
roster — it is permanent and correct, and needs `--force` to build past. Report
any *other* warning; do not `--force` past one without saying so.

## 4. Build the comps

```js
$.evalFile(new File("C:/Users/mlorenzon/Desktop/random/symphony of the day/scripts/sotd.jsx"));
return SOTD.buildWork("<slug>");
```

Run `check-bridge` first if anything times out. `buildWork` runs `assertFonts()`
and refuses on a Trajan substitution — that is a real failure, not a warning.

## 5. The map — the full cycle, because a new work has no bake

Only if the work has no frozen map in `data/maps/<slug>/`, or its bake predates
the current highlight-and-label design. **Freeze the previous work first** —
there is one mapcomp and aiming it rewrites every unfrozen card.

```js
SOTD.mapDraw("<slug>");     // then poll SOTD.mapStatus() in a LATER call
SOTD.mapFinish("<slug>");   // READ the focus block before going on
SOTD.mapLabel("<slug>");
SOTD.mapZoom("<slug>");
SOTD.mapFinalize();         // poll SOTD.mapFinalizeStatus()
SOTD.freezeMapRender("<slug>");
SOTD.freezeMapAttach("<slug>");   // in a SEPARATE call
```

`mapFinish`'s `focus` block is the only moment the highlight can be checked. A
`match` other than `contains`, or a `LOOK` line from `map_focus.py`, means look
at the map and nudge:

```bash
python scripts/map_focus.py <slug> --nudge-lon 1.10
```

A nudge is stored on the work and costs a re-bake, not a rebuild.

## 6. Verify in a picture, not in the DOM

`see-frame` hands back a stale image often enough to be useless. Call it to
trigger the render, then open the newest bridge PNG yourself and check the mtime:

```bash
ls -t "C:/Users/mlorenzon/AppData/Local/ae-mcp-bridge/"*.png | head -1
```

Check: four facts present and none clipped inside the slab, the strap centred,
the period colour right, the country label on the territory and not across a
border.

## 7. Report and hand over

Briefly: what the work is, anything Grove corrected in Wikipedia, anything still
unknown, **the script and the caption in full**, and where the card is verified.
Then say the reel is waiting on a take — vertical, full-bleed, one take, **a
second of silence at each end** — recorded into
`~/Desktop/random/symphony-video/`, and that `/sotd-edit <slug>` cuts it from
there once it has synced.

Update `CLAUDE.md`'s **Current state** if this changed what is built, frozen or
in the project.
