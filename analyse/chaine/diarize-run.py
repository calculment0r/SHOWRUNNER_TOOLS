#!/usr/bin/env python3
"""
Diarisation — qui parle, quand — pyannote/speaker-diarization-3.1 sur le GPU.

    python diarize-run.py video.mp4 turns.json [--speakers N] [--min N --max N]

Sortie : { "turns": [ {start, end, speaker: "SPEAKER_00"}, … ] }
Les étiquettes SPEAKER_xx sont ensuite rapprochées du casting par speakers.mjs
(la personne à l'image quand SPEAKER_00 parle, le plus souvent = SPEAKER_00).

Exige le jeton Hugging Face dans ~/.cache/huggingface/token et l acceptation
des conditions de pyannote/speaker-diarization-3.1 et pyannote/segmentation-3.0.
"""
import sys, json, os, subprocess, tempfile
import torch

video, out = sys.argv[1], sys.argv[2]
def opt(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default

token_file = os.path.expanduser("~/.cache/huggingface/token")
if not os.path.exists(token_file):
    print("✗ jeton Hugging Face absent :", token_file, file=sys.stderr); sys.exit(1)
token = open(token_file).read().strip()

# pyannote veut de l audio : on extrait une piste mono 16 kHz avec ffmpeg
wav = tempfile.NamedTemporaryFile(suffix=".wav", delete=False).name
subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", video, "-ac", "1", "-ar", "16000", "-vn", wav], check=True)

from pyannote.audio import Pipeline
pipe = Pipeline.from_pretrained("pyannote/speaker-diarization-3.1", token=token)
pipe.to(torch.device("cuda" if torch.cuda.is_available() else "cpu"))

kw = {}
if opt("--speakers"): kw["num_speakers"] = int(opt("--speakers"))
if opt("--min"): kw["min_speakers"] = int(opt("--min"))
if opt("--max"): kw["max_speakers"] = int(opt("--max"))
result = pipe(wav, **kw)
ann = getattr(result, "speaker_diarization", result)   # API 3.x vs 4.x

turns = [{"start": round(seg.start, 3), "end": round(seg.end, 3), "speaker": spk}
         for seg, _, spk in ann.itertracks(yield_label=True)]
os.unlink(wav)
json.dump({"turns": turns}, open(out, "w"), indent=1)
speakers = sorted({t["speaker"] for t in turns})
print(f"{len(turns)} tours de parole, {len(speakers)} voix : {', '.join(speakers)} → {out}", file=sys.stderr)
for t in turns[:8]:
    print(f"   {t['start']:6.2f} → {t['end']:6.2f}  {t['speaker']}", file=sys.stderr)
