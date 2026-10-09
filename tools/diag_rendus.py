#!/usr/bin/env python3
"""Ce que les modèles ont VRAIMENT reçu : les derniers rendus Vidéo (H3) et Image (Cal, 09/10/2026 : « on a plein
de tests où H3 ne comprenait pas bien… et même sur les images cela ne marchait pas super »).

Lecture seule, bibliothèque standard. Admin → Diagnostics → « Rendus · ce que le modèle a reçu » ; ou sur DGX2,
depuis ~/SHOWRUNNER_TOOLS :
    python3 tools/diag_rendus.py          les 4 dernières vidéos et les 4 dernières images
    python3 tools/diag_rendus.py 8        les 8 dernières de chaque

Pour chaque vidéo : le mode, le préréglage, la toile et ses étages, la durée, ce que la personne a écrit, les mentions
et ce qu'elles sont devenues, chaque sujet et sa définition, les images envoyées dans l'ordre de `ref_images` (et de
quel élément, quelle pièce), les vidéos et les sons, ce que le plan a dit avant le rendu, ce que le graphe charge, puis
l'invite envoyée à H3 en entier. Pour chaque image : le modèle, la taille, les références envoyées dans l'ordre (et
celles gardées grisées), le prompt écrit et le prompt envoyé. De quoi copier les rendus de l'atelier et les analyser
(docs/etudes/movie.md, « Fait le 09/10 — l'audit des références »). Rien n'est modifié.
"""
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
try:   # le dossier des données du portail (showrunner.local.json, SHOWRUNNER_DATA) ; sinon celui de DGX2
    sys.path.insert(0, str(REPO / "server"))
    from core import config   # noqa: E402
    DATA = Path(config.CFG["data_dir"]).expanduser() / "library"
except Exception:   # noqa: BLE001 — un diagnostic lit ce qu'il peut
    DATA = Path.home() / "showrunner-data" / "library"
N = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 4


def items():
    for f in DATA.glob("*/item.json"):
        try:
            yield json.loads(f.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue


ALL = list(items())
BY_ID = {it.get("id"): it for it in ALL}


def title(iid) -> str:
    it = BY_ID.get(iid) or {}
    return f"« {it.get('title') or '?'} » ({iid})" if it else f"({iid}, plus dans la bibliothèque)"


def mmss(s) -> str:
    try:
        s = int(float(s))
    except (TypeError, ValueError):
        return "?"
    return f"{s // 60} min {s % 60:02d}" if s >= 60 else f"{s} s"


def video(it: dict) -> None:
    p = it.get("params") or {}
    print("=" * 100)
    print(f"VIDÉO {it.get('id')}  « {it.get('title')} »  {it.get('created', '')[:19]}")
    print(f"moteur={p.get('engine')}  machine={it.get('machine') or '?'}  rendu en {mmss(it.get('render_seconds'))}  "
          f"modèle : {(it.get('origin') or {}).get('model')}")
    st = p.get("stages")
    print(f"mode {p.get('mode')} · préréglage {p.get('method')} · format {p.get('format') or p.get('family')} · toile "
          f"{p.get('width')}×{p.get('height')}" + (f" en deux étages depuis {p['draft'][0]}×{p['draft'][1]}" if st == 2 and p.get('draft') else " en un étage")
          + f" · {p.get('frames')} images ({p.get('seconds')} s) · {p.get('steps')} pas · graine {p.get('seed')}")
    req = p.get("request") or {}
    print("ce que la personne a écrit :")
    print("  " + (str(req.get("desc") or p.get("desc") or "(rien)").replace("\n", "\n  ")))
    if req.get("subjects"):
        print("définitions données (mise en forme) : " + json.dumps(req["subjects"], ensure_ascii=False))
    print("mentions : " + (", ".join(f"{k} → {v}" for k, v in (p.get("mentions") or {}).items()) or "aucune"))
    subs = p.get("subjects")
    if subs is None:
        print("sujets : (non gardés avant le 09/10 — l'invite ci-dessous les contient)")
    for s in subs or []:
        print(f"  {s.get('tag')} {s.get('token')} « {s.get('title')} » ({s.get('role')}) : {', '.join(s.get('pictures') or []) or 'aucune image'}"
              + (f" · décrit par : {s.get('described')}" if s.get("described") else ""))
    pics = p.get("pictures") or []
    print(f"images envoyées ({len(pics)}, dans l'ordre de ref_images) :")
    for x in pics:
        print(f"  {x.get('tag'):13} {x.get('label')}  · rôle {x.get('role') or '—'} · de {title(x.get('item'))}")
    for v in p.get("videos") or []:
        print(f"  {v.get('tag')} {v.get('token')} ({v.get('role')})" + (f" + bande-son {v.get('audio_tag')}" if v.get("audio_tag") else ""))
    for a in p.get("audios") or []:
        print(f"  {a.get('tag')} {a.get('token') or '(voix d’un élément)'} ({a.get('role')})")
    notes = p.get("notes")
    print("ce que le plan a dit avant le rendu :" + (" (non gardé avant le 09/10)" if notes is None else (" rien" if not notes else "")))
    for n in notes or []:
        print(f"  - {n}")
    g = p.get("graph") or {}
    if g:
        cls = {}
        for n in g.values():
            cls[n.get("class_type")] = cls.get(n.get("class_type"), 0) + 1
        six = (g.get("6") or {}).get("inputs") or {}
        print(f"graphe : {len(g)} nœuds · nœud 6 {(g.get('6') or {}).get('class_type')} {six.get('width')}×{six.get('height')} "
              f"{six.get('length')} images · LoadImage ×{cls.get('LoadImage', 0)} · LoadVideo ×{cls.get('LoadVideo', 0)} · "
              f"LoadAudio ×{cls.get('LoadAudio', 0)} · agrandisseur latent : {'oui' if 'MinimaxH3LatentUpscaler3DRefineHandoff' in cls else 'non'}")
        loras = [n["inputs"].get("lora_name") for n in g.values() if n.get("class_type") in ("LoraLoaderModelOnly", "MiniMaxH3TurboLoRA")]
        print("LoRA : " + " → ".join(str(x) for x in loras if x))
    sent = str(p.get("prompt_sent") or "")
    print(f"--- l'invite envoyée à H3 ({len(sent.split())} mots, {len(sent)} signes) ---")
    print(sent or "(vide)")


def image(it: dict) -> None:
    p = it.get("params") or {}
    o = it.get("origin") or {}
    print("=" * 100)
    print(f"IMAGE {it.get('id')}  « {it.get('title')} »  {it.get('created', '')[:19]}  modèle {o.get('model')} ({o.get('backend')})")
    print(f"{p.get('job')} · {p.get('model')} · {p.get('tool') or ''} {it.get('width')}×{it.get('height')} · {p.get('aspect') or ''} "
          f"{p.get('quality') or ''} · graine {p.get('seed')}" + (f" · source {title(p['source'])}" if p.get("source") else ""))
    refs = p.get("refs") or []
    print(f"références envoyées ({len(refs)}, dans l'ordre) :")
    for k, r in enumerate(refs, start=1):
        print(f"  {k}. {title(r.get('item'))}" + (f" · pièce {r['ref']}" if r.get("ref") else ""))
    for r in p.get("refs_held") or []:
        print(f"  (grisée, non envoyée) {title(r.get('item'))}")
    print("prompt écrit : " + str(p.get("prompt") or "(aucun)"))
    print("prompt envoyé : " + str(it.get("prompt") or "(aucun)"))


vids = sorted((it for it in ALL if it.get("kind") == "video" and (it.get("params") or {}).get("mode") in ("t2v", "i2v", "r2v")),
              key=lambda it: it.get("created", ""), reverse=True)[:N]
imgs = sorted((it for it in ALL if it.get("kind") == "image" and (it.get("params") or {}).get("job") in ("image.generate", "image.edit")),
              key=lambda it: it.get("created", ""), reverse=True)[:N]
print(f"bibliothèque : {DATA} · {len(vids)} vidéo(s) de l'outil Vidéo, {len(imgs)} image(s) de l'outil Image (les plus récentes)")
if not vids:
    print("aucune vidéo de l'outil Vidéo")
for it in vids:
    video(it)
if not imgs:
    print("aucune image de l'outil Image")
for it in imgs:
    image(it)
