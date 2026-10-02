#!/usr/bin/env python3
"""Les workflows YuE2 de Cal contre le graphe du portail : où les paroles passent, et ce qui diffère.

Lecture seule, bibliothèque standard. Sur DGX2, depuis ~/SHOWRUNNER_TOOLS :
    python3 tools/diag_yue_workflow.py                       les workflows AUDIO/*YuE2* de ComfyUI
    python3 tools/diag_yue_workflow.py chemin/du/workflow.json

Pour chaque workflow : chaque nœud YuE2 avec ses réglages nommés (les `widgets_values` rangés par les noms de
/object_info de ComfyUI), et, pour l'entrée `lyrics`/`style`/`abc` de chaque nœud, d'où elle vient (un champ de texte,
un autre nœud). Puis le graphe que le portail envoie (music_yue.build_graph) pour les mêmes paroles, nœud par nœud.
Rien n'est modifié, rien n'est mis en file.
"""
import json
import sys
import urllib.request
from pathlib import Path

HOME = Path.home()
COMFY = "http://127.0.0.1:8188"
DIRS = [HOME / "ComfyUI/user/default/workflows/AUDIO", HOME / "ComfyUI/user/default/workflows"]
SHOW = ("YuE2", "SheetSage2", "EmptyYuE2", "KSampler", "ConditioningZeroOut", "SaveAudio", "PreviewAny", "Primitive", "String", "Seed", "Text")


def object_info(cls):
    try:
        with urllib.request.urlopen(f"{COMFY}/object_info/{cls}", timeout=5) as r:
            return json.load(r).get(cls)
    except Exception:
        return None


def widget_names(cls):
    """Les entrées qui sont des réglages (pas des liens), dans l'ordre où l'interface les range."""
    info = object_info(cls)
    if not info:
        return None
    names = []
    for sect in ("required", "optional"):
        for name, conf in ((info.get("input") or {}).get(sect) or {}).items():
            t = conf[0] if isinstance(conf, list) and conf else None
            if isinstance(t, list) or t in ("INT", "FLOAT", "STRING", "BOOLEAN", "COMBO") or t == "COMFY_DYNAMICCOMBO_V3":
                names.append(name)
    return names


def short(v, n=90):
    s = json.dumps(v, ensure_ascii=False) if not isinstance(v, str) else repr(v)
    return s if len(s) <= n else s[:n] + f"… ({len(s)} signes)"


def show_workflow(path):
    wf = json.loads(path.read_text(encoding="utf-8"))
    nodes = {n["id"]: n for n in wf.get("nodes", [])}
    links = {l[0]: l for l in wf.get("links", [])}
    print("=" * 78)
    print(f"WORKFLOW {path.name}  ({len(nodes)} nœuds)")
    for n in sorted(nodes.values(), key=lambda x: x["id"]):
        t = n.get("type", "")
        if not any(s in t for s in SHOW):
            continue
        names = widget_names(t) if t.startswith(("YuE2", "SheetSage2", "EmptyYuE2")) else None
        vals = n.get("widgets_values") or []
        print(f"\n[{n['id']}] {t}   « {n.get('title') or ''} »")
        if isinstance(vals, dict):
            for k, v in vals.items():
                print(f"    {k} = {short(v)}")
        elif names and len(names) >= len(vals):
            for k, v in zip(names, vals):
                print(f"    {k} = {short(v)}")
        else:
            print(f"    widgets_values = {short(vals, 300)}" + ("   (noms : ComfyUI injoignable)" if names is None else ""))
        for i in n.get("inputs", []):
            if i.get("link") is not None:
                l = links.get(i["link"])
                src = nodes.get(l[1]) if l else None
                print(f"    {i['name']} <- [{l[1]}] {src.get('type') if src else '?'} (sortie {l[2]})")


def show_portal():
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "server"))
    from tools import music_yue
    lyr = "[Verse]\nLa nuit tombe sur la ville\nTes yeux brillent dans le noir\n\n[Chorus]\nReste avec moi jusqu'au matin"
    p = music_yue.yue_params({"tags": "French, warm female vocal, pop, 96 BPM, piano", "lyrics": lyr, "duration_s": 60, "seed": 1})
    g = music_yue.build_graph(p)
    print("=" * 78)
    print("GRAPHE DU PORTAIL (music_yue.build_graph, paroles d'essai)")
    for nid, n in sorted(g.items(), key=lambda kv: int(kv[0])):
        print(f"\n[{nid}] {n['class_type']}")
        for k, v in n["inputs"].items():
            print(f"    {k} = {short(v)}")


args = [a for a in sys.argv[1:] if not a.isdigit()]
files = [Path(a) for a in args] if args else sorted({f for d in DIRS if d.is_dir() for f in d.glob("*YuE2*.json")})
if not files:
    print("aucun workflow *YuE2*.json trouvé dans", ", ".join(map(str, DIRS)))
for f in files:
    show_workflow(f)
show_portal()
