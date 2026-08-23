# Editing the reel

Step 3: a recording of the script goes in, a reel Instagram will take comes out
— subtitled, with the cards timed to the voice and the card turning over on
cue.

```
take_raw.mp4  →  take_transcribe.py  →  words.json
                                            ↓
                 script from the record  →  take_align.py  →  locked.mp4
                                                            →  work JSON
                                                                  ↓
                                            SOTD.buildWork  →  the comp
                                            SOTD.renderReel →  out/<slug>.ae.mp4
                                            reel_master.py  →  out/<slug>.mp4
```

## Why After Effects finishes it, and ffmpeg cuts it

The obvious alternative is to render the cards out of AE with an alpha channel
and edit in Premiere. Don't. **The timing of the flip is the thing being fitted
to the voice**, and in the reel comp that timing is one slider with everything
downstream hanging off it by expression — including the map move inside card 2,
which is time-remapped to start when the turn ends. Flatten the overlay to a
movie and all of that becomes a re-render: change the flip by 200 ms, wait for
a 1080×1920 ProRes 4444 pass, look, change it again.

So AE keeps the picture. What AE is genuinely bad at is trimming a recording,
and that is what ffmpeg is for — and because the trim comes from measured
times rather than from dragging, it does not need an NLE at all.

Premiere earns its place at exactly one thing: assembling several takes by eye.
If a day's recording ever needs that, the rule does not change — **lock the
picture first, then time the cards to it.** Every timestamp in this pipeline is
relative to the locked cut, so re-cutting after timing means doing the timing
again.

## Recording

- **Vertical, 1080×1920, full-bleed.** The video fills the frame and the card
  sits over it. Anything else gets scaled to cover, never to fit.
- **One take.** Top and tail are found for you; a flubbed restart in the middle
  is not, and would need cutting by hand.
- **Leave a second of silence at each end** before and after speaking. The cut
  points are found by looking for it.
- **Say the script.** Not approximately — the captions are the written script,
  and the aligner matches what it hears against it. Improvising is fine, but
  every improvised word becomes an inferred timing and the caption still shows
  what was written.
- **Keep your face in the top third.** The card covers y 744–1484 and the
  captions sit below it — the top 740 px of frame is yours.

## The four commands

```bash
python scripts/take_transcribe.py <slug>     # words.json — timings only
python scripts/take_align.py <slug>          # locked.mp4 + the work JSON
```
```js
SOTD.buildWork("<slug>");                    // the comp, timed and captioned
SOTD.renderReel("<slug>");                   // out/<slug>.ae.mp4  (blocks AE)
```
```bash
python scripts/reel_master.py <slug>         # out/<slug>.mp4 — the upload
```

Put the recording at `data/takes/<slug>/take_raw.mp4` first. Everything in that
folder is untracked and regenerable except the recording itself.

## The recogniser is a clock, not a transcriber

We already know what was said: `research_to_note.py` generated the script, and
it is fixed for the series. So faster-whisper is not being asked *what* the
words are, only *when* they are, and `take_align.py` throws its text away after
using it to line the two sequences up.

That is worth being deliberate about, because it changes what can go wrong:

- A misheard word is a timing wobble on one word. It cannot put wrong text on
  screen, because the text on screen is the script.
- A word the recogniser never heard still gets a time, interpolated between the
  words either side of it and marked `inferred` in `align.json`.
- `small.en` is therefore enough. It decodes half a minute in about four
  seconds on the CPU. Raise the model only if coverage is poor.

Coverage is reported every run:

```
  align  67 script words, 94% heard, 4 inferred
```

## The cut points do not come from the words

They come from `silencedetect`, and the reason is a bug this pipeline was built
on top of. On the very first take, the recogniser silently dropped the opening
line — "Symphony of the Day", a second and a half of perfectly clear speech.
Cutting at its first word would have lopped the opening off the reel and
nothing would have complained.

So the cut is anchored on the recogniser's first and last word and then widened
outward to the nearest silence, which recovers anything it missed at either
end. When that happens the run says so:

```
  !  1.46 s of speech before the first word the recogniser caught.
     The cut keeps it — but its caption times are inferred.
```

## The two cues

| Slider | Where the value comes from |
|---|---|
| `Reveal Start` | 0.25 s before "We're listening to" — card 1 is up as the work is named, not on the title beat |
| `Turn At` | the start of "**Listen** out for" |
| `Reveal Duration`, `Turn Duration` | constants; nothing in the voice decides them |

The turn starting *on* "Listen" is the one timing decision with an argument
behind it. The movement runs under the phrase and the card lands face-up as the
hook itself is named — which is the moment card 2's `LISTEN OUT FOR` line means
something. Starting it after the phrase lands the card on a hook already spoken.

Override it when a take needs it, without re-running anything else:

```bash
python scripts/take_align.py <slug> --turn-at 14.9
```

## The edit lives in the work JSON

`buildWork` deletes and recreates all five comps every time, so an edit made in
the timeline is gone at the next rebuild. Everything the edit consists of is
therefore written to `data/works/<slug>.json` under `video`:

```json
"video": {
  "take": "data/takes/beethoven-no-5/locked.mp4",
  "source": "data/takes/beethoven-no-5/take_raw.mp4",
  "duration": 27.012,
  "cut": { "in": 1.823, "out": 28.835 },
  "timings": { "revealStart": 1.508, "revealDuration": 0.75,
               "turnAt": 14.377, "turnDuration": 0.6 },
  "captions": [ { "t": 0.0, "d": 1.76, "text": "Symphony of the Day" }, … ]
}
```

The comp is as long as the take — `CFG.reel.dur` is only the fallback for a
work with no recording yet. The two card-turn sounds are placed from the same
timings, which fixes the old warning that dragging `Turn At` left the sound
behind: it is still true if you drag the slider by hand, but the derived value
now arrives with the sound already on it.

## Captions

One text layer and one plate per line, in `CAPTIONS · <slug>`, with in and out
points — no keyframes. The plate is measured to the ink with
`sourceRectAtTime`, so a three-word line gets a three-word plate rather than a
full-width slab.

The grouping rules are in `take_align.py` and each exists because of something
that looked wrong on screen:

- **31 characters and 2.6 seconds** per line, soft limits; 33 is the hard one,
  past which the plate crosses into the button rail. Measured — see below.
- **Break at the script's own line ends.** "Symphony of the Day" is a separate
  beat and reads terribly run into the sentence after it.
- **Do not break at "No."** — `ABBREVIATIONS` exists because the first version
  left "No." alone on screen for half a second.
- **Never end a line on a weak word.** "Listen out for four notes, and a" hangs;
  the "and a" belongs with what it introduces.
- **Never leave a line of one short word.** It flashes.

The last two rules pull against the first, and the order matters. Fixing weak
endings in a pass *after* grouping was the first attempt: it shunted "when the"
onto the following line, which then ran two characters over the budget and
wrapped. So the backoff happens at the moment a line closes, and the words it
hands back become the start of the next line — which is then filled and
measured like any other. An orphan is fixed the same way round: it borrows a
word back off the line before it rather than merging into it, because merging
would either overrun or run across a full stop.

## Instagram's safe zone

`CFG.safe` is four numbers — top 220, bottom 310, left 60, right 200 — and the
layout is measured against them. The right-hand 200 px is the
like/comment/share rail, which is why the card is left of centre rather than
centred.

Where things actually sit, measured off the built comp rather than intended:

| | left | right | top | bottom |
|---|---|---|---|---|
| Safe box | 60 | 880 | 220 | 1610 |
| Card | 206 | 734 | 744 | 1484 |
| Widest caption plate | 97 | 844 | 1521 | 1603 |

The card is 120% and hangs from an anchor near its own top edge
(`CFG.overlay.anchor`), which is what leaves the top 740 px of frame clear for
a face. Both card faces take the same anchor, and its x half must stay at the
card's horizontal centre — that is the axis the flip turns about.

`bottom` was 380 until the caption band was placed by eye at y 1562. That put
the widest plate at 1603 and made the guess wrong, so the guess moved.

**These are approximations, not published figures.** Meta does not give exact
numbers and the UI moves between versions. So `buildReel` draws them as a guide
layer: post one reel, screenshot it on the phone, and correct these four values
rather than nudging any layer. Everything else follows.

The card came down from 175% to 120% to make room for a face behind it. That is
a real cost — every type size on the card shrinks by a third with it, and card
2's fact list is the tightest thing in the design. `Overlay Scale` is a slider;
if the facts stop reading on a phone, raise it and let the card cover more of
the frame.

**The caption budget follows the type size, and it is measured.** At 51 px
Cambria a 35-character line inks 809 px; centred on x 470 with 33 px of plate
padding either side, 32 characters is the widest line whose plate stays inside
x 880. `CAP_MAX_CHARS` is 31, for a margin. Change the caption size and that
number has to be re-measured, or the plates start crossing the rail.

## Loudness

AE's render is left alone and `reel_master.py` writes the file to post, copying
the video stream untouched and normalising only the audio to −14 LUFS with a
−1.5 dBFS true-peak ceiling.

Instagram normalises uploads to roughly that anyway. Doing it here means the
platform has nothing left to do — the first render measured −17 LUFS with peaks
at −0.2 dBFS, which is precisely the shape that gets turned up into clipping —
and it makes every reel in the series the same loudness as the one before,
which a viewer notices far more than they notice any single video's level.

## Traps

- **`see-frame` cannot be trusted here either.** Use
  `comp.saveFrameToPng(t, file)` from `execute-script`: it takes a time, writes
  where you tell it, and there is no cache in the way. That is how every frame
  in this document was checked.
- **The recogniser needs its own interpreter.** `take_transcribe.py` re-runs
  itself inside `.venv-asr` automatically, so the command is the same either
  way — but if the venv is missing it stops and tells you how to build it. No
  admin rights are needed for any of it.
- **Re-cutting invalidates the timings.** They are relative to the locked cut,
  so `take_align.py` writes both together and always will. Never cut by hand
  and keep the old timings.
- **A rebuild replaces the caption comp.** Edit `take_align.py`'s rules or the
  work JSON, never the layers.
- **Audio in the take is the reel's audio.** There is no music bed, and the two
  card-flip sounds sit under the voice at −9 dB. If a take is recorded quiet,
  fix it at the take, not with the flip sounds.
