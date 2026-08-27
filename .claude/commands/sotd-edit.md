---
description: Cut the day's recording into the finished reel and sync it to the phone
argument-hint: <slug, e.g. beethoven-no-2 — omit to use the newest recording>
---

# Cut the reel: $1

The second half of the pipeline. `/sotd` researched the work and built the card;
this takes the recording and produces the upload. Read `docs/reel-edit.md` and
`CLAUDE.md` first — the traps below are the ones that have actually happened, and
most of them fail quietly.

If `$ARGUMENTS` is empty, use the work whose card was built most recently and say
which one you picked.

## 1. Find the recording, and look at it before using it

The recordings sync into `~/Desktop/random/symphony-video/` as
`YYYY_MM_DD_HH_MM_SS.mp4`. **The newest is the day's take.** Two things live
beside them and both matter:

- **`<name>.txt`** — a transcript of what he actually said. If today's is there,
  it is the script (see §4) and you do not have to draft one.
- **`<name>_enhanced.mp4`** — a cleaned copy from a tool outside this repo,
  1080×1920 with the rotation already baked. **Prefer it when it exists**; it is
  what became `take_raw.mp4` for `beethoven-no-1`. If only the raw is there, say
  so and ask whether to wait for the enhanced version or go with the raw audio —
  the raw masters acceptably, so this is his call, not a blocker.

Probe whatever you choose. Note the duration against the generated script's
length: a take much longer than the script means he ad-libbed, which is normal.

## 2. Bake the rotation

**The phone shoots 1920×1080 with a `rotation=90` flag, not 1080×1920.** ffmpeg
honours it on decode, so the recogniser and the cut would be fine either way —
but After Effects is not to be trusted with it, and a reel that renders sideways
costs a full re-render to find out. Bake it:

```bash
ffmpeg -y -i <source> -c:v libx264 -crf 18 -preset medium -pix_fmt yuv420p -c:a copy data/takes/<slug>/take_raw.mp4
```

Then confirm `width=1080 height=1920` and that no `rotation` side data survives.
Skip this only for an `_enhanced.mp4`, which is already baked — check, don't
assume.

## 3. Word timings

```bash
python scripts/take_transcribe.py <slug>
```

The recogniser is a **clock, not a transcriber** — `take_align.py` throws its
text away and uses only the times. A misheard word is a timing wobble.

## 4. `script.txt` — the words that go on screen

**He speaks a longer version of the generated script**: its fixed opening and
close, his own middle. `take_align.py` already prefers
`data/takes/<slug>/script.txt` over the generated script, so the captions match
the voice — but that file is put **on screen verbatim**, so it has to be right.

| Situation | What to do |
|---|---|
| A `.txt` transcript synced beside the recording | Use it. Copy it in, keeping the house shape: the title beat on its own line, the body as one long line — line ends are hard caption breaks. |
| No transcript | Draft it from the recogniser's text, normalising only punctuation and spacing — **invent no wording** — then show him the draft and get it confirmed before running the align. |

Then check `align`'s report: it printed **99% heard, 1 inferred** on the first
real take. Poor coverage means the draft is wrong, not that the model is bad.

## 5. Align — and choose the turn yourself

```bash
python scripts/take_align.py <slug> --dry-run
```

**He rarely says "listen out for", so the flip cue is usually missing** and
`take_align.py` parks `Turn At` mid-reel with a warning. **Never accept the
park.** Pick the word that *starts* the listening section, not the beat where the
hook is named — otherwise card 2 arrives after its own point has been made. Read
the word timings out of `words.json` and pass it:

```bash
python scripts/take_align.py <slug> --turn-at <seconds>
```

For scale: No. 1's cue was heard and landed at 40% of the reel; No. 2 was set by
hand to 64%. Somewhere in that band is the shape to aim for.

Also read these two lines of the report:

- **Speech starting at 0.000** means the take has no head silence, `HEAD_PAD` had
  nothing to trim into, and the reel opens on the attack of the first word.
  Nothing downstream can fix it — report it as something to change at the source.
- **Caption lines past the hard character count** will wrap into the button rail.
  31 lines at ≤31 characters was comfortable on the first real take.

## 6. Reframe the shot so his head is above the card

The card cannot move — it is the same rectangle in every reel — so the person
does. **This is not optional and not cosmetic**: at default framing the card
lands across his chin.

```bash
python scripts/take_frame.py <slug> --measure
```

That writes one filmstrip of the cut with two bands on it. Read two numbers off
it, and read them as **extremes across the whole take, never off one frame** —
he moves 80–90 px while talking, and a single-frame measurement cropped the top
of his head on the first attempt:

- `--hair` — the **highest** the top of the hair ever gets, so the *smallest* y
- `--chin` — the **lowest** the bottom of the beard gets, so the *largest* y

```bash
python scripts/take_frame.py <slug> --hair <y> --chin <y>
```

The script solves for the zoom and the vertical centre, writes `video.framing`,
and prints where both features land. It matches `beethoven-no-1`, whose framing
was accepted by eye — and it cannot satisfy both constraints at once, because
lifting him costs zoom and zoom pushes the beard back down. **The hair staying in
frame wins**; the beard grazing the card top at his lowest moment is accepted, as
No. 1 does. Read the warnings: a cropped head or a lift past the take's own slack
means the two numbers are wrong, not that the take is.

## 7. Build, render, master

```js
SOTD.buildWork("<slug>");     // picks up the video block: cut, sliders, captions
SOTD.renderReel("<slug>");
```

**`renderReel` will time out the MCP request, and that is not a failure** — AE
renders on regardless. Watch `out/<slug>.ae.mp4` on disk until its size settles,
then confirm the frame count against duration × 25 fps before going on.

```bash
python scripts/reel_master.py <slug>     # out/<slug>.mp4 — the upload
```

Expect about −14 LUFS out.

## 8. Verify from the mastered file

Not from `see-frame`, which returns a stale image often enough to be useless —
it handed back three different works' frames during one session. Pull frames out
of the finished mp4 instead and look at them together. (Inside AE, the reliable
equivalent is `comp.saveFrameToPng(t, file)` from `execute-script`: it takes a
time, writes where you tell it, and no cache sits in the way — which beats
nudging a slider to drag a moment onto the comp midpoint.)

```bash
ffmpeg -ss <t> -i out/<slug>.mp4 -frames:v 1 <scratch>/f_<t>.png
```

Sample at least: card 1 with a caption, the flip, card 2 just after it, and the
last line. Check the age on card 1, that the flip lands where you put it, that
the map has settled on the city with its country label by the end, and that no
caption is clipped.

## 9. Sync it to his phone

`out/` keeps the master; the sync folder gets a **copy**, named for the slug:

```bash
cp out/<slug>.mp4 ~/Desktop/random/symphony-video/<slug>.mp4
```

Verify with `cmp` that it arrived byte-identical — it is a 90 MB+ copy into a
folder something else is watching.

## 10. Report

The reel's duration and loudness, where you put the turn and why, what the
captions came from, and anything he should change at the source next time — head
silence being the standing one. Then update `CLAUDE.md`'s **Current state** if
this take taught the pipeline something new.
