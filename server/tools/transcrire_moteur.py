"""Le moteur réel de Transcrire, lancé en sous-processus par
`server/tools/transcrire.py` (moteur `local`) dans l'environnement qui a le
modèle (`transcrire_python`, par défaut `~/comfyui-env/bin/python` sur DGX2).
Le portail ne l'importe jamais pour calculer : rien de lourd au niveau du
module (pkgutil le charge au démarrage comme tout fichier de `tools/`, et il
n'a pas de `register`).

    python transcrire_moteur.py --engine whisper-turbo --weights ~/.cache/whisper/large-v3-turbo.pt \
        --audio audio.wav --lang auto --beam 1 --out asr.json [--duration 612.3] [--words 0|1]
    python transcrire_moteur.py --check        # se lit, sans rien importer de lourd

Rend `{"lang", "segments": [{"a", "b", "text", "words": [[mot, début, fin]…]}], "calcul_s", "engine"}`.
Sur la sortie standard, une ligne « ETAPE … » par étape (la page la montre).

Juste par construction : un modèle ne se charge **que d'un fichier présent**
(`whisper.load_model(chemin)`, `ASRModel.restore_from(chemin)`) — jamais par
son nom, qui le ferait télécharger (openai-whisper et NeMo le font seuls).

Sources : openai-whisper (github.com/openai/whisper : `load_model` accepte un
chemin, `transcribe(word_timestamps=True)`, `beam_size`/`best_of`), le script
de Movie Analysis (`analyse/chaine/whisper-run.py` : détection de la langue
sur les 30 premières secondes) ; Parakeet TDT 0.6B v3
(huggingface.co/nvidia/parakeet-tdt-0.6b-v3 : `transcribe(…, timestamps=True)`,
`timestamp['word']` et `['segment']`, `change_attention_model("rel_pos_local_attn",
[256, 256])` au-delà de 24 min).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time

ENGINES = ("whisper-turbo", "parakeet-v3")


def step(msg: str) -> None:
    print("ETAPE " + msg, flush=True)


class _Progress:
    """À la place de la barre tqdm de `whisper.transcribe` (transcribe.py :
    `tqdm.tqdm(total=content_frames, unit="frames")`, puis `pbar.update(…)`
    à chaque fenêtre de 30 s décodée) : la part faite, en lignes « PROGRES »
    que le portail lit — la vraie progression d'un long film."""

    def __init__(self, total=None, **_):
        self.total, self.n, self.last = max(1, int(total or 1)), 0, -1.0

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def update(self, k=1):
        self.n += k
        f = min(1.0, self.n / self.total)
        if f - self.last >= 0.02 or f >= 1.0:
            self.last = f
            print(f"PROGRES {f:.3f}", flush=True)


def whisper_run(a) -> dict:
    import types

    import whisper
    # le module (whisper.transcribe est la fonction, que __init__ réexporte)
    sys.modules["whisper.transcribe"].tqdm = types.SimpleNamespace(tqdm=_Progress)
    step("chargement de Whisper")
    m = whisper.load_model(a.weights, device="cuda")
    audio = whisper.load_audio(a.audio)
    lang = None if a.lang == "auto" else a.lang
    if lang is None:
        mel = whisper.log_mel_spectrogram(whisper.pad_or_trim(audio), n_mels=m.dims.n_mels).to(m.device)
        probs = m.detect_language(mel)[1]
        lang = max(probs, key=probs.get)
    step(f"transcription ({lang})")
    # les temps au mot (mode complet) : l'alignement DTW de l'attention croisée
    # (whisper/timing.py, add_word_timestamps), au pas de 20 ms (audio.py :
    # TOKENS_PER_SECOND = 50) ; le mode rapide s'en passe — une passe de moins
    opts = {"language": lang, "word_timestamps": bool(a.words), "fp16": True, "verbose": None}
    if a.beam > 1:
        opts.update(beam_size=a.beam, best_of=a.beam)
    r = m.transcribe(audio, **opts)
    segs = [{"a": float(s["start"]), "b": float(s["end"]), "text": s["text"].strip(),
             "words": [[w["word"].strip(), float(w["start"]), float(w["end"])] for w in s.get("words", [])]}
            for s in r.get("segments", [])]
    return {"lang": lang, "segments": segs}


def parakeet_run(a) -> dict:
    import nemo.collections.asr as nemo_asr
    step("chargement de Parakeet")
    m = nemo_asr.models.ASRModel.restore_from(a.weights, map_location="cuda")
    if a.duration > 20 * 60:   # la carte : 24 min en attention pleine (A100 80 Go), 3 h en attention locale
        m.change_attention_model(self_attention_model="rel_pos_local_attn", att_context_size=[256, 256])
    step("transcription")
    out = m.transcribe([a.audio], timestamps=True)
    ts = out[0].timestamp
    words = [[w["word"], float(w["start"]), float(w["end"])] for w in ts.get("word", [])]
    segs = []
    for s in ts.get("segment", []):
        sa, sb = float(s["start"]), float(s["end"])
        segs.append({"a": sa, "b": sb, "text": str(s["segment"]).strip(),
                     "words": [w for w in words if w[1] >= sa - 1e-3 and w[2] <= sb + 1e-3]})
    # la langue détectée : la carte dit qu'il la détecte, pas comment la lire — non documenté
    return {"lang": None if a.lang == "auto" else a.lang, "segments": segs}


def main() -> int:
    ap = argparse.ArgumentParser(description="le moteur réel de Transcrire")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--engine", choices=ENGINES)
    ap.add_argument("--weights")
    ap.add_argument("--audio")
    ap.add_argument("--lang", default="auto")
    ap.add_argument("--beam", type=int, default=1)
    ap.add_argument("--duration", type=float, default=0.0)
    ap.add_argument("--words", type=int, choices=(0, 1), default=1)
    ap.add_argument("--out")
    a = ap.parse_args()
    if a.check:
        print("ok · moteurs : " + ", ".join(ENGINES))
        return 0
    if not (a.engine and a.weights and a.audio and a.out):
        ap.error("--engine, --weights, --audio et --out")
    if not os.path.isfile(a.weights):
        print(f"poids absents : {a.weights} (aucun téléchargement : à approuver par Cal)", file=sys.stderr)
        return 2
    t0 = time.time()
    res = whisper_run(a) if a.engine == "whisper-turbo" else parakeet_run(a)
    res.update(calcul_s=round(time.time() - t0, 2), engine=a.engine)
    tmp = a.out + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(res, f, ensure_ascii=False)
    os.replace(tmp, a.out)
    step(f"fini : {len(res['segments'])} segments en {res['calcul_s']} s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
