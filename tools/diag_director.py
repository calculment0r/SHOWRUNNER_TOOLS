#!/usr/bin/env python3
"""Où est le nœud « Director » de ComfyUI, et ce qu'il prend : pour s'en inspirer (le panneau Multishot de Vidéo).

Lecture seule, bibliothèque standard. Sur DGX2 puis DGX1, depuis ~/SHOWRUNNER_TOOLS :
    python3 tools/diag_director.py              cherche « director » (nom de dossier, de classe, de nœud)
    python3 tools/diag_director.py timeline     autre mot

Montre : les dossiers de ~/ComfyUI/custom_nodes dont le nom le contient (et le début de leur README), les fichiers
Python qui l'écrivent (classes, NODE_CLASS_MAPPINGS) et, si ComfyUI tourne (:8188), les nœuds de /object_info dont le
nom ou le nom affiché le contient, avec leurs entrées (type, bornes, infobulle) et leurs sorties. Les fichiers JS
d'interface (web/, js/) sont listés : c'est là qu'une frise de plans se dessinerait. Rien n'est modifié.
"""
import json
import re
import sys
import urllib.request
from pathlib import Path

WORD = (sys.argv[1] if len(sys.argv) > 1 else "director").lower()
CN = Path.home() / "ComfyUI" / "custom_nodes"
print(f"mot : « {WORD} »   custom_nodes : {CN}")

print("\n== dossiers ==")
hits = [d for d in sorted(CN.iterdir()) if d.is_dir() and WORD in d.name.lower()] if CN.is_dir() else []
for d in hits:
    print(f"- {d.name}")
    for readme in list(d.glob("README*"))[:1]:
        print("    " + readme.read_text(encoding="utf-8", errors="replace")[:700].replace("\n", "\n    "))
if not hits:
    print("(aucun dossier à ce nom ; recherche dans le contenu des fichiers Python plus bas)")

print("\n== fichiers Python qui l'écrivent ==")
n = 0
for f in (CN.rglob("*.py") if CN.is_dir() else []):
    if "node_modules" in f.parts or ".git" in f.parts:
        continue
    try:
        t = f.read_text(encoding="utf-8", errors="replace")
    except OSError:
        continue
    if re.search(r"class\s+\w*" + WORD + r"\w*|NODE_CLASS_MAPPINGS[^}]*" + WORD + r"|[\"']" + WORD, t, re.I):
        n += 1
        if n > 25:
            break
        cls = re.findall(r"class\s+(\w*" + WORD + r"\w*)", t, re.I)[:6]
        print(f"- {f.relative_to(CN)}   classes : {', '.join(cls) or '-'}   ({len(t.splitlines())} lignes)")
if not n:
    print("(aucun)")

print("\n== fichiers d'interface (JS) dans ces dossiers ==")
for d in hits:
    for sub in ("web", "js", "web/js"):
        for f in sorted((d / sub).glob("*.js"))[:12] if (d / sub).is_dir() else []:
            print(f"- {f.relative_to(CN)}   ({f.stat().st_size} octets)")

print("\n== /object_info (ComfyUI :8188) ==")
try:
    with urllib.request.urlopen("http://127.0.0.1:8188/object_info", timeout=20) as r:
        info = json.load(r)
except Exception as e:
    print(f"ComfyUI injoignable ({e})")
    info = {}
for name, spec in info.items():
    if WORD in name.lower() or WORD in str(spec.get("display_name", "")).lower():
        print(f"\n[{name}]  « {spec.get('display_name')} »  catégorie : {spec.get('category')}")
        for sect in ("required", "optional"):
            for k, conf in ((spec.get("input") or {}).get(sect) or {}).items():
                t = conf[0] if isinstance(conf, list) and conf else conf
                ex = conf[1] if isinstance(conf, list) and len(conf) > 1 and isinstance(conf[1], dict) else {}
                t = "COMBO" if isinstance(t, list) else t
                bits = {a: ex[a] for a in ("default", "min", "max", "step") if a in ex}
                tip = (ex.get("tooltip") or "")[:160]
                print(f"    {sect[:3]} {k}: {t} {bits or ''} {('— ' + tip) if tip else ''}")
        print(f"    sorties : {spec.get('output')}  {spec.get('output_name')}")
        if spec.get("description"):
            print("    " + str(spec["description"])[:600])
