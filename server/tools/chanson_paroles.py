"""Écrire les paroles d'une chanson avec le modèle de langue d'ACE-Step 1.5
(`create_sample`, le « Simple Mode / Inspiration Mode » : une description en
langage courant → légende, paroles, tempo, tonalité ; ~/ACE-Step-1.5/docs/en/
INFERENCE.md, « create_sample »). Tout en local, sur la DGX du portail.

Ce fichier est un **script** lancé par `server/tools/chanson.py` dans
l'environnement d'ACE-Step (`~/ACE-Step-1.5/.venv/bin/python`), jamais dans
le portail : il n'importe que la bibliothèque standard à son chargement (le
portail importe chaque module de `server/tools/`), ACE-Step seulement dans
`main()`.

    entrée (stdin, JSON) : {"root": "~/ACE-Step-1.5", "lm": "acestep-5Hz-lm-1.7B",
                            "query": "…", "language": "fr", "temperature": 0.85,
                            "check": false}
    sortie (stdout, une ligne JSON) : {"ok": true, "caption", "lyrics", "bpm",
                            "keyscale", "language", "duration"} ou {"ok": false, "error"}

`check` : vérifie à vide (les poids sur le disque, l'import de `create_sample`
et de `LLMHandler`, leurs paramètres) sans charger de modèle.

Le modèle n'est chargé que s'il est déjà sur le disque (`checkpoints/<lm>`) et
hors ligne (HF_HUB_OFFLINE) : aucun téléchargement.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path


def _out(d: dict) -> None:
    sys.stdout.write(json.dumps(d, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def main() -> int:
    try:
        req = json.loads(sys.stdin.read() or "{}")
    except ValueError as e:
        _out({"ok": False, "error": f"entrée illisible : {e}"})
        return 2
    root = Path(str(req.get("root") or "~/ACE-Step-1.5")).expanduser()
    lm = str(req.get("lm") or "acestep-5Hz-lm-1.7B")
    ckpt = root / "checkpoints"
    if not (ckpt / lm).is_dir():
        _out({"ok": False, "error": f"{ckpt / lm} absent : le modèle de langue d'ACE-Step n'est pas sur ce disque"})
        return 3
    # hors ligne : rien ne se télécharge, même par erreur
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    sys.path.insert(0, str(root))
    os.chdir(root)
    try:
        import inspect

        from acestep.inference import create_sample
        from acestep.llm_inference import LLMHandler
    except Exception as e:  # l'environnement d'ACE-Step est cassé : on le dit
        _out({"ok": False, "error": f"import d'ACE-Step impossible : {type(e).__name__}: {e}"})
        return 4
    if req.get("check"):
        sig = inspect.signature(create_sample)
        need = {"llm_handler", "query", "instrumental", "vocal_language", "temperature"}
        miss = sorted(need - set(sig.parameters))
        init = inspect.signature(LLMHandler.initialize)
        _out({"ok": not miss, "error": f"create_sample sans : {', '.join(miss)}" if miss else "",
              "create_sample": str(sig)[:400], "initialize": str(init)[:400], "lm": str(ckpt / lm)})
        return 0 if not miss else 5
    h = LLMHandler()
    # backend « pt » : PyTorch seul (llm_inference.py, initialize : « vllm » ou « pt »)
    msg, ok = h.initialize(checkpoint_dir=str(ckpt), lm_model_path=lm, backend="pt", device="cuda")
    if not ok:
        _out({"ok": False, "error": f"modèle de langue d'ACE-Step : {msg}"[:600]})
        return 6
    lang = req.get("language") or None
    r = create_sample(h, query=str(req.get("query") or ""), instrumental=False, vocal_language=lang,
                      temperature=float(req.get("temperature") or 0.85))
    if not getattr(r, "success", False):
        _out({"ok": False, "error": f"create_sample : {getattr(r, 'error', '') or getattr(r, 'status_message', '')}"[:600]})
        return 7
    _out({"ok": True, "caption": r.caption or "", "lyrics": r.lyrics or "", "bpm": r.bpm, "keyscale": r.keyscale or "",
          "language": r.language or lang or "", "duration": r.duration})
    return 0


if __name__ == "__main__":
    sys.exit(main())
