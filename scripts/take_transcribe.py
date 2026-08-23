#!/usr/bin/env python3
"""Word-level timings for a recorded take, from faster-whisper.

    python scripts/take_transcribe.py beethoven-no-5
    python scripts/take_transcribe.py beethoven-no-5 --model medium.en

Writes `data/takes/<slug>/words.json` — every word the recogniser heard, with a
start, an end and a confidence. Nothing else in the pipeline runs a recogniser;
`take_align.py` reads this file and throws the *text* away.

That is the point worth understanding. We already know exactly what was said —
`research_to_note.py` generated the script — so the recogniser is not being
asked what the words are, only when they happen. Its guesses at wording are
discarded, which is why a small model is enough and why a misheard word cannot
put wrong text on screen.

Nothing here needs admin rights. faster-whisper lives in `.venv-asr/` beside the
project and the model downloads once into `data/.cache/whisper/`; both are
untracked, and this script re-runs itself inside that venv automatically. To
build it from nothing:

    python -m venv .venv-asr
    .venv-asr/Scripts/python -m pip install faster-whisper
"""
import argparse
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TAKES = os.path.join(ROOT, "data", "takes")
VENV = os.path.join(ROOT, ".venv-asr", "Scripts", "python.exe")
MODEL_CACHE = os.path.join(ROOT, "data", ".cache", "whisper")

# small.en decodes half a minute of clear speech in about four seconds on the
# CPU and its word boundaries are as good as the big models' on a close mic.
# Bump it only if `take_align.py` reports poor coverage: the failure mode that
# matters is words it never heard at all, not words it heard wrongly.
DEFAULT_MODEL = "small.en"

# 16 kHz mono is what the model wants; anything else it resamples internally.
ASR_RATE = 16000


def relaunch_in_venv():
    """Re-run this script with the ASR venv's interpreter.

    The recogniser is the one dependency that is not stdlib-plus-requests, so
    it is quarantined in a venv rather than installed into the machine's
    Python. Hiding the switch in here means the command is the same either way.
    """
    if not os.path.exists(VENV):
        sys.exit("No ASR environment. Build it once, no admin needed:\n"
                 "    python -m venv .venv-asr\n"
                 "    .venv-asr/Scripts/python -m pip install faster-whisper")
    # subprocess, not os.execv: on Windows execv does not quote its arguments,
    # and this project's path has a space in it.
    sys.exit(subprocess.call([VENV, os.path.abspath(__file__)] + sys.argv[1:]))


def extract_audio(src, dst):
    """Pull a mono 16 kHz wav out of whatever was recorded."""
    subprocess.check_call([
        "ffmpeg", "-v", "error", "-y", "-i", src,
        "-vn", "-ac", "1", "-ar", str(ASR_RATE), "-c:a", "pcm_s16le", dst])
    return dst


def media_duration(path):
    out = subprocess.check_output([
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=nw=1:nk=1", path])
    return float(out.strip())


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("slug")
    ap.add_argument("--take", help="Media file to read (default: the slug's take_raw.*)")
    ap.add_argument("--model", default=DEFAULT_MODEL,
                    help="faster-whisper model (default: %s)" % DEFAULT_MODEL)
    ap.add_argument("--device", default="cpu", choices=("cpu", "cuda"),
                    help="cuda needs the CUDA runtime wheels; cpu is fast enough")
    args = ap.parse_args()

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        relaunch_in_venv()
        return

    folder = os.path.join(TAKES, args.slug)
    if not os.path.isdir(folder):
        sys.exit("no take folder: %s" % folder)

    take = args.take
    if not take:
        for name in ("take_raw.mp4", "take_raw.mov", "take_raw.MP4", "take_raw.MOV"):
            if os.path.exists(os.path.join(folder, name)):
                take = os.path.join(folder, name)
                break
    if not take or not os.path.exists(take):
        sys.exit("no take found in %s — put the recording there as take_raw.mp4" % folder)

    wav = extract_audio(take, os.path.join(folder, "asr.wav"))
    dur = media_duration(take)
    print("  take   %s (%.2f s)" % (os.path.basename(take), dur))

    compute = "int8" if args.device == "cpu" else "float16"
    model = WhisperModel(args.model, device=args.device, compute_type=compute,
                         download_root=MODEL_CACHE)
    # No VAD. It trims leading silence by guessing where speech starts, and
    # guessing is what this whole step exists to avoid — the cut points come
    # from the first and last *word*, which needs the words to be there.
    segments, _info = model.transcribe(wav, word_timestamps=True, beam_size=5,
                                       vad_filter=False)

    words = []
    for seg in segments:
        for w in (seg.words or []):
            text = w.word.strip()
            if text:
                words.append({"w": text, "s": round(float(w.start), 3),
                              "e": round(float(w.end), 3),
                              "p": round(float(w.probability), 3)})

    out = {"take": os.path.relpath(take, ROOT).replace("\\", "/"),
           "duration": round(dur, 3),
           "model": args.model,
           "words": words}
    path = os.path.join(folder, "words.json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1)

    if words:
        print("  heard  %d words, %.2f–%.2f s" % (len(words), words[0]["s"], words[-1]["e"]))
    else:
        print("  heard  nothing — check the take has audio")
    print("  wrote  %s" % os.path.relpath(path, ROOT).replace("\\", "/"))


if __name__ == "__main__":
    main()
