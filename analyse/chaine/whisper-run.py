#!/usr/bin/env python3
"""
Transcription locale, langue détectée — Whisper large-v3-turbo sur le GPU.

    python whisper-run.py video.mp4 <préfixe>      → <préfixe>.srt + <préfixe>.json

Le .json garde les mots horodatés ; le .srt sert à captions-to-audio.mjs.
"""
import sys, json, whisper

video, prefix = sys.argv[1], sys.argv[2]
model = whisper.load_model("large-v3-turbo", device="cuda")
audio = whisper.load_audio(video)
mel = whisper.log_mel_spectrogram(whisper.pad_or_trim(audio), n_mels=model.dims.n_mels).to(model.device)
probs = model.detect_language(mel)[1]
lang = max(probs, key=probs.get)
print(f"langue détectée : {lang} ({100 * probs[lang]:.0f} %)", file=sys.stderr)
r = model.transcribe(video, language=lang, word_timestamps=True, fp16=True, verbose=False)

# Whisper hallucine sur le silence et la musique : des mentions de sous-titrage,
# des remerciements de fin de vidéo, des « ... ». On les écarte — ce n'est pas du dialogue.
import re
HALLU = re.compile(r"sous-?titr|subtitl|radio-canada|amara\.org|merci d.avoir regard|thanks for watching|abonnez|like et|^\W*$", re.I)
before = len(r["segments"])
r["segments"] = [s for s in r["segments"] if not HALLU.search(s["text"].strip()) and re.search(r"[A-Za-zÀ-ÿ]", s["text"])]
if before != len(r["segments"]):
    print(f"{before - len(r['segments'])} segment(s) hallucinés écartés (sous-titrage, remerciements, « ... »)", file=sys.stderr)

def tc(s):
    h = int(s // 3600); m = int(s % 3600 // 60); x = s % 60
    return f"{h:02d}:{m:02d}:{x:06.3f}".replace(".", ",")

with open(f"{prefix}.srt", "w", encoding="utf-8") as f:
    for i, s in enumerate(r["segments"], 1):
        f.write(f"{i}\n{tc(s['start'])} --> {tc(s['end'])}\n{s['text'].strip()}\n\n")
json.dump({"lang": lang, "segments": [{"start": s["start"], "end": s["end"], "text": s["text"].strip(),
           "words": [{"w": w["word"], "s": w["start"], "e": w["end"]} for w in s.get("words", [])]} for s in r["segments"]]},
          open(f"{prefix}.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(f"{len(r['segments'])} segments → {prefix}.srt / {prefix}.json", file=sys.stderr)
