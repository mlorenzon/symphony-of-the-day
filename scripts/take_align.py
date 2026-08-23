#!/usr/bin/env python3
"""Turn a recorded take into an edit: cut points, card timings, captions.

    python scripts/take_align.py beethoven-no-5
    python scripts/take_align.py beethoven-no-5 --dry-run
    python scripts/take_align.py beethoven-no-5 --no-cut

Reads `words.json` from `take_transcribe.py` and the script the note generated,
aligns the two, and writes three things:

  data/takes/<slug>/align.json   every script word with a time, and how it got one
  data/takes/<slug>/locked.mp4   the take topped and tailed
  data/works/<slug>.json         a `video` block: the take, the four slider
                                 values, and the caption list

Everything downstream is then a rebuild away from correct, because the edit
lives in the work JSON rather than in the timeline. `SOTD.buildWork` reads it.

**The recogniser's words are used for their times and nothing else.** The text
on screen is the script we wrote, so a misheard word is a timing wobble rather
than a wrong caption — and a word the recogniser never heard at all still gets
a time, interpolated from its neighbours and marked `inferred` so the report
can say so.

The cut points do not come from the words. They come from `silencedetect`,
because the recogniser drops quiet openings often enough that trusting its
first word would clip the first line off the top of the reel. That is not a
hypothetical: it happened on the first take this was tested against.
"""
import argparse
import collections
import difflib
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TAKES = os.path.join(ROOT, "data", "takes")
RESEARCH = os.path.join(ROOT, "data", "research")
WORKS = os.path.join(ROOT, "data", "works")

sys.path.insert(0, HERE)
from research_to_note import reel_script          # noqa: E402

# Silence either side of the words, kept deliberately: a reel that starts on
# the attack of the first consonant sounds clipped, and Instagram's own loop
# needs somewhere to turn round.
HEAD_PAD = 0.30
TAIL_PAD = 0.55

# What counts as silence. -38 dB is quiet enough to survive room tone on a
# close mic and loud enough not to call a breath "speech".
SILENCE_DB = -38
SILENCE_MIN = 0.30

# The turn starts on the word "Listen", so the movement runs under "Listen out
# for" and the card lands face-up as the hook is named. Card 2's whole point is
# that its LISTEN OUT FOR line is up at that moment.
TURN_CUE = ("listen", "out", "for")
# Card 1 arrives just before the work is named, not on the title beat.
REVEAL_CUE = ("we're", "listening", "to")
REVEAL_LEAD = 0.25

TURN_DURATION = 0.6
REVEAL_DURATION = 0.75

# Caption shape. Short lines, because they sit over a face on a phone — and
# because the plate is measured to the ink, a long line is a WIDE plate, which
# is what actually collides with Instagram's button rail.
#
# Measured, not guessed: at the current 51 px Cambria a 35-character line inks
# 809 px, so 23.1 px a character. Centred on x 470 with 33 px of plate padding,
# the widest line that stays inside the safe box's right edge at x 880 is 32
# characters. 31 leaves room for a line of unusually wide ones.
CAP_MAX_CHARS = 31
CAP_MAX_SECONDS = 2.6
CAP_MIN_SECONDS = 0.65
# The grouping budget is soft — shuffling a dangling word forward can push a
# line a character or two past it, which is the better trade. This is the hard
# one, past which the plate crosses the safe edge.
CAP_HARD_CHARS = 33
CAP_HOLD = 0.12          # let a line linger past the last word a touch

# Words that cannot be the last thing on a caption line: they promise another
# word and the line break breaks the promise.
WEAK_ENDINGS = set(
    "a an the and or but of in on for to at with from as is was were when "
    "that his her its their who by into your our my this these one".split())


def norm(word):
    """The form two spellings of the same spoken word have in common."""
    w = word.lower()
    w = w.replace("’", "'").replace("‘", "'")
    w = re.sub(r"[^a-z0-9']", "", w)
    return w


# Tokens that end in a full stop without ending a sentence. Without this the
# captions break after "No." and leave it on screen alone for half a second.
ABBREVIATIONS = set("no op k bwv hob woo d s mr mrs ms dr st vol nos".split())


def script_tokens(rec):
    """The script as spoken words, with the places a caption must break.

    Punctuation is kept — the captions show the written script, so they get its
    commas. The script's own line break (the title beat, "Symphony of the Day")
    is a hard break: it is a separate thought and reads terribly run into the
    sentence after it.
    """
    text, warnings = reel_script(rec)
    body = text.split("\n", 1)[1]            # drop the "SCRIPT" label line
    toks, breaks = [], set()
    for line in body.split("\n"):
        line_toks = [t for t in line.split() if t.strip()]
        if not line_toks:
            continue
        toks += line_toks
        breaks.add(len(toks) - 1)            # break after this token
    return toks, breaks, warnings


def ends_sentence(tok):
    if not re.search(r"[.!?]$", tok):
        return False
    return norm(tok) not in ABBREVIATIONS


def silence_spans(wav):
    """[(start, end)] of every silent stretch, from ffmpeg."""
    out = subprocess.run(
        ["ffmpeg", "-v", "info", "-i", wav, "-af",
         "silencedetect=noise=%ddB:d=%s" % (SILENCE_DB, SILENCE_MIN),
         "-f", "null", "-"],
        stderr=subprocess.PIPE, stdout=subprocess.DEVNULL).stderr.decode("utf-8", "replace")
    spans, start = [], None
    for m in re.finditer(r"silence_(start|end): (-?[\d.]+)", out):
        kind, t = m.group(1), float(m.group(2))
        if kind == "start":
            start = t
        elif start is not None:
            spans.append((start, t))
            start = None
    return spans


def speech_bounds(wav, first_word, last_word, duration):
    """Where the talking actually starts and stops.

    Anchored on the recogniser's first and last word, then widened outward to
    the nearest silence boundary — so a line the recogniser missed at the top
    is still inside the cut.
    """
    spans = silence_spans(wav)
    start = 0.0
    for s, e in spans:
        if e <= first_word + 0.01:
            start = e
    end = duration
    for s, e in spans:
        if s >= last_word - 0.01:
            end = s
            break
    return start, end


def align(script, words):
    """Give every script token a time.

    difflib against the normalised word lists: the recogniser's sequence is the
    same sequence, with omissions and the odd substitution. Matching blocks
    carry real times; everything between two anchors is spread evenly across
    the gap and marked inferred.
    """
    s_norm = [norm(t) for t in script]
    a_norm = [norm(w["w"]) for w in words]
    timed = [None] * len(script)

    sm = difflib.SequenceMatcher(None, s_norm, a_norm, autojunk=False)
    for i, j, n in sm.get_matching_blocks():
        for k in range(n):
            w = words[j + k]
            timed[i + k] = {"s": w["s"], "e": w["e"], "p": w["p"], "how": "heard"}

    anchors = [i for i, t in enumerate(timed) if t]
    if not anchors:
        return timed, 0.0

    # Before the first anchor and after the last one, borrow the neighbouring
    # word's pace rather than inventing one.
    def pace(i0, i1):
        if i1 <= i0:
            return 0.32
        return max(0.14, (timed[i1]["s"] - timed[i0]["s"]) / (i1 - i0))

    first, last = anchors[0], anchors[-1]
    step = pace(first, anchors[min(4, len(anchors) - 1)])
    for i in range(first - 1, -1, -1):
        nxt = timed[i + 1]
        timed[i] = {"s": round(nxt["s"] - step, 3), "e": round(nxt["s"] - step * 0.15, 3),
                    "p": 0.0, "how": "inferred"}
    step = pace(anchors[max(0, len(anchors) - 5)], last)
    for i in range(last + 1, len(script)):
        prev = timed[i - 1]
        timed[i] = {"s": round(prev["e"] + step * 0.15, 3), "e": round(prev["e"] + step, 3),
                    "p": 0.0, "how": "inferred"}

    # Interior gaps: spread evenly between the two anchors that bracket them.
    for a, b in zip(anchors, anchors[1:]):
        if b - a < 2:
            continue
        t0, t1 = timed[a]["e"], timed[b]["s"]
        span = max(0.0, t1 - t0) / (b - a)
        for k in range(a + 1, b):
            s = t0 + span * (k - a - 1)
            timed[k] = {"s": round(s, 3), "e": round(s + span * 0.85, 3),
                        "p": 0.0, "how": "inferred"}

    heard = sum(1 for t in timed if t["how"] == "heard")
    return timed, heard / float(len(script))


def find_phrase(script, phrase):
    """Index of the first token of `phrase`, or None."""
    s = [norm(t) for t in script]
    for i in range(len(s) - len(phrase) + 1):
        if s[i:i + len(phrase)] == list(phrase):
            return i
    return None


def caption_lines(script, breaks, timed, cut_in):
    """Group the words into lines short enough to read on a phone.

    Three rules that pull against each other, so they are applied together
    rather than in passes: stay inside the character budget, never end a line
    on a word that promises another one, never leave a line of one short word.
    Fixing the second afterwards was the first attempt and it fought the first,
    pushing "when the" forward onto a line that then ran two characters over.
    """
    def txt(g):
        return " ".join(script[j] for j in g)

    groups, cur = [], []

    def flush(soft):
        """Close the current line. `soft` breaks may hand words to the next one."""
        if not cur:
            return
        g = list(cur)
        del cur[:]
        if soft:
            # Back a dangling word off the end and let it start the next line,
            # where the greedy fill carries on from it — so the line it joins
            # is still measured against the budget rather than blown past it.
            while len(g) > 1 and norm(script[g[-1]]) in WEAK_ENDINGS:
                cur.insert(0, g.pop())
        groups.append(g)

    for i, tok in enumerate(script):
        span = timed[i]["e"] - timed[cur[0]]["s"] if cur else 0
        if cur and (len(txt(cur + [i])) > CAP_MAX_CHARS or span > CAP_MAX_SECONDS):
            flush(True)
        cur.append(i)
        # A sentence end and the script's own line ends are hard: a caption
        # that runs across a full stop reads as one thought when it is two, and
        # nothing dangles at a full stop anyway.
        if ends_sentence(tok) or i in breaks:
            flush(False)
    flush(False)

    # A line of one short word flashes up and is gone. Rather than merge it —
    # which would either overrun the budget or run across a full stop — borrow
    # a word back off the line before it.
    for i in range(1, len(groups)):
        while (len(txt(groups[i])) < 9 and len(groups[i - 1]) > 2
               and len(txt(groups[i - 1][-1:] + groups[i])) <= CAP_MAX_CHARS
               and norm(script[groups[i - 1][-2]]) not in WEAK_ENDINGS):
            groups[i].insert(0, groups[i - 1].pop())

    lines = []
    for g in groups:
        t0 = timed[g[0]]["s"] - cut_in
        t1 = timed[g[-1]]["e"] - cut_in + CAP_HOLD
        lines.append({"t": round(max(0.0, t0), 3),
                      "d": round(max(CAP_MIN_SECONDS, t1 - t0), 3),
                      "text": " ".join(script[i] for i in g)})

    # A line whose successor starts before it ends would flicker; trim it back.
    for a, b in zip(lines, lines[1:]):
        if a["t"] + a["d"] > b["t"]:
            a["d"] = round(max(0.3, b["t"] - a["t"]), 3)
    return lines


def cut(src, dst, t_in, t_out):
    """Top and tail. Re-encoded, because a keyframe cut is not frame-accurate."""
    subprocess.check_call([
        "ffmpeg", "-v", "error", "-y", "-i", src,
        "-ss", "%.3f" % t_in, "-to", "%.3f" % t_out,
        "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p",
        "-c:a", "pcm_s16le", "-ar", "48000",
        "-movflags", "+faststart", dst])


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("slug")
    ap.add_argument("--dry-run", action="store_true", help="Report, write nothing")
    ap.add_argument("--no-cut", action="store_true", help="Skip the ffmpeg cut")
    ap.add_argument("--turn-at", type=float, help="Override the derived Turn At")
    args = ap.parse_args()

    folder = os.path.join(TAKES, args.slug)
    wpath = os.path.join(folder, "words.json")
    if not os.path.exists(wpath):
        sys.exit("no words.json — run take_transcribe.py %s first" % args.slug)
    heard = json.load(open(wpath, encoding="utf-8"))
    words = heard["words"]
    if not words:
        sys.exit("words.json is empty — the take has no speech the recogniser found")

    rpath = os.path.join(RESEARCH, args.slug + ".json")
    if not os.path.exists(rpath):
        sys.exit("no research record for %s — the script comes from it" % args.slug)
    rec = json.load(open(rpath, encoding="utf-8"))
    script, breaks, script_warnings = script_tokens(rec)
    for w in script_warnings:
        print("  !  script: %s" % w)

    timed, coverage = align(script, words)
    print("  align  %d script words, %d%% heard, %d inferred"
          % (len(script), round(coverage * 100),
             sum(1 for t in timed if t["how"] == "inferred")))

    wav = os.path.join(folder, "asr.wav")
    speech_in, speech_out = speech_bounds(wav, words[0]["s"], words[-1]["e"],
                                          heard["duration"])
    cut_in = max(0.0, speech_in - HEAD_PAD)
    cut_out = min(heard["duration"], speech_out + TAIL_PAD)
    print("  speech %.2f–%.2f s   cut %.2f–%.2f s (%.2f s reel)"
          % (speech_in, speech_out, cut_in, cut_out, cut_out - cut_in))

    if speech_in < words[0]["s"] - 0.5:
        print("  !  %.2f s of speech before the first word the recogniser caught. "
              "The cut keeps it — but its caption times are inferred."
              % (words[0]["s"] - speech_in))

    # --- the two cues -----------------------------------------------------
    i_turn = find_phrase(script, TURN_CUE)
    if i_turn is None:
        turn_at = round((cut_out - cut_in) * 0.55, 3)
        print("  !  no \"listen out for\" in the script — Turn At parked mid-reel")
    else:
        turn_at = round(timed[i_turn]["s"] - cut_in, 3)
    if args.turn_at is not None:
        turn_at = args.turn_at
        print("  turn   overridden to %.2f s" % turn_at)

    i_rev = find_phrase(script, REVEAL_CUE)
    reveal_start = round(max(0.1, timed[i_rev]["s"] - cut_in - REVEAL_LEAD), 3) \
        if i_rev is not None else 0.35

    if timed[i_turn]["how"] == "inferred" if i_turn is not None else False:
        print("  !  the turn cue was inferred, not heard — check the flip by eye")

    caps = caption_lines(script, breaks, timed, cut_in)
    over = [c for c in caps if len(c["text"]) > CAP_HARD_CHARS]
    print("  caps   %d lines, longest %d chars, %s"
          % (len(caps), max(len(c["text"]) for c in caps),
             "all fit" if not over else
             "%d past %d chars and will wrap" % (len(over), CAP_HARD_CHARS)))
    print("  cards  reveal at %.2f s, turn at %.2f s" % (reveal_start, turn_at))

    take_rel = heard["take"]
    locked_rel = "data/takes/%s/locked.mp4" % args.slug
    video = collections.OrderedDict([
        ("take", locked_rel),
        ("source", take_rel),
        ("duration", round(cut_out - cut_in, 3)),
        ("cut", {"in": round(cut_in, 3), "out": round(cut_out, 3)}),
        ("timings", collections.OrderedDict([
            ("revealStart", reveal_start),
            ("revealDuration", REVEAL_DURATION),
            ("turnAt", turn_at),
            ("turnDuration", TURN_DURATION)])),
        ("captions", caps),
    ])

    if args.dry_run:
        print("=" * 70)
        print(json.dumps(video, ensure_ascii=False, indent=2)[:1600])
        return

    align_out = {"slug": args.slug, "coverage": round(coverage, 3),
                 "cut": {"in": round(cut_in, 3), "out": round(cut_out, 3)},
                 "words": [{"w": script[i], "s": timed[i]["s"], "e": timed[i]["e"],
                            "how": timed[i]["how"]} for i in range(len(script))]}
    with open(os.path.join(folder, "align.json"), "w", encoding="utf-8") as fh:
        json.dump(align_out, fh, ensure_ascii=False, indent=1)

    wpath = os.path.join(WORKS, args.slug + ".json")
    if not os.path.exists(wpath):
        sys.exit("no work JSON at %s — run prepare_work.py first" % wpath)
    work = json.load(open(wpath, encoding="utf-8"),
                     object_pairs_hook=collections.OrderedDict)
    work["video"] = video
    with open(wpath, "w", encoding="utf-8") as fh:
        fh.write(json.dumps(work, ensure_ascii=False, indent=2))
    print("  wrote  %s" % os.path.relpath(wpath, ROOT).replace("\\", "/"))

    if not args.no_cut:
        src = os.path.join(ROOT, take_rel.replace("/", os.sep))
        dst = os.path.join(ROOT, locked_rel.replace("/", os.sep))
        cut(src, dst, cut_in, cut_out)
        print("  cut    %s" % locked_rel)

    print("\nNow, in After Effects:\n    SOTD.buildWork(\"%s\");" % args.slug)


if __name__ == "__main__":
    main()
