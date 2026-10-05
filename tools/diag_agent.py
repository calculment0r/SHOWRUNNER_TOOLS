#!/usr/bin/env python3
"""Admin → Diagnostics → « Agent » : le modèle de l'agent Showrunner d'Idéation (server/tools/ideation_agent.py)
sait-il appeler des outils et voir des images ? Ollama le dit lui-même : `POST /api/show` rend ses `capabilities`
(`completion`, `tools`, `vision`, `thinking`… — docs/api.md et types/model/capability.go du dépôt d'Ollama).
Sans `tools`, l'agent ne pose rien (le portail refuse le tour en le disant) ; sans `vision`, une image citée
n'est pas regardée. Lecture seule : `/api/show` lit le manifeste du modèle, rien ne se charge sur le GPU.

Sur DGX2, depuis ~/SHOWRUNNER_TOOLS :
    python3 tools/diag_agent.py                  l'Ollama et le modèle du portail (réglages ideation_agent_url,
                                                 sinon llm_url ; ideation_agent_modele, sinon llm_model)
    python3 tools/diag_agent.py URL [MODÈLE]     celui-là seul (l'essai sans modèle : tools/faux_ollama.py)

Dit aussi la fenêtre de contexte : celle que le portail demande (ideation_agent_ctx, 32768 par défaut), celle
que le modèle porte (num_ctx de son Modelfile, la longueur native de model_info) — la question « 32k ou 64k ? »
de docs/REPRISE.md § 2.D —, et si le modèle est aussi dans l'Ollama de l'autre machine (machine_ollama).
"""
import json
import sys
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "server"))
from core import config  # noqa: E402
from tools import ideation_agent as A  # noqa: E402  (les réglages de l'agent : une seule vérité)

url = (sys.argv[1] if len(sys.argv) > 1 else A.ollama_url()).rstrip("/")
model = sys.argv[2] if len(sys.argv) > 2 else A.model_name()


def ask(base, path, body=None, timeout=10):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(base + path, data=data, headers={"Content-Type": "application/json"} if data else {})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read() or b"{}")


def present(base, name):
    """Le nom tel qu'Ollama le liste (un nom sans étiquette est « :latest »), et sa taille ; None s'il n'y est pas."""
    for m in ask(base, "/api/tags", timeout=5).get("models", []):
        if m.get("name") in (name, f"{name}:latest"):
            return m
    return None


print(f"agent Showrunner · Ollama {url} · modèle {model}")
print(f"portail : contexte demandé {A.ctx_size()} jetons (ideation_agent_ctx), voie {A._lane()}"
      + (f", épinglé sur {A.pin_for(url)}" if A._lane() == "audio" and A.pin_for(url) else ""))
try:
    m = present(url, model)
except (OSError, ValueError) as e:
    print(f"\nOllama NE RÉPOND PAS ({url}) : {e}")
    print("→ l'agent refusera chaque tour en le disant. Vérifier : systemctl status ollama ; le réglage ideation_agent_url.")
    sys.exit(1)
try:
    print(f"Ollama {ask(url, '/api/version', timeout=5).get('version', '?')}")
except (OSError, ValueError):
    print("Ollama (version non rendue)")
if not m:
    print(f"\nle modèle « {model} » N'EST PAS dans cet Ollama.")
    print("modèles présents : " + (", ".join(x.get("name", "?") for x in ask(url, "/api/tags", timeout=5).get("models", [])) or "aucun"))
    print("→ réglage ideation_agent_modele (ou llm_model) dans showrunner.local.json, puis tools/portail.sh restart.")
    sys.exit(1)
print(f"présent : {m.get('name')} · {round((m.get('size') or 0) / 1e9, 1)} Go sur le disque")
show = ask(url, "/api/show", {"model": model}, timeout=20)
caps = [str(c) for c in show.get("capabilities") or []]
det = show.get("details") or {}
print(f"famille {det.get('family', '?')} · {det.get('parameter_size', '?')} · {det.get('quantization_level', '?')}")
if "capabilities" not in show:
    print("\ncapacités : NON RENDUES par cet Ollama (version trop ancienne ?) — l'agent refusera les tours : il lit `tools` ici.")
    sys.exit(1)
print("capacités : " + (", ".join(caps) or "aucune"))
print("  tools    : " + ("OUI" if "tools" in caps else "NON — l'agent ne peut rien poser sur la planche"))
print("  vision   : " + ("OUI" if "vision" in caps else "NON — une image citée ne sera pas regardée (l'agent le dit)"))
print("  thinking : " + ("oui (le portail la coupe : think false)" if "thinking" in caps else "non"))
# la fenêtre : num_ctx du Modelfile (PARAMETER num_ctx …), la longueur native (model_info : <famille>.context_length)
params = [ln.strip() for ln in str(show.get("parameters") or "").splitlines() if ln.strip()]
nctx = next((ln.split()[-1] for ln in params if ln.split()[:1] == ["num_ctx"]), None)
native = next((v for k, v in (show.get("model_info") or {}).items() if k.endswith(".context_length")), None)
print(f"contexte : num_ctx du modèle {nctx or '(non fixé)'} · natif {native or '?'} · le portail demande {A.ctx_size()}"
      " (Ollama conseille 64000 au moins pour un agent : docs/context-length.mdx)")
# l'autre machine : le même modèle, les mêmes capacités ? (pas pour un Ollama donné à la main : l'essai)
for name, other in ((config.get("machine_ollama") or {}) if len(sys.argv) <= 1 else {}).items():
    other = str(other).rstrip("/")
    if other == url:
        continue
    try:
        o = present(other, model)
        oc = ask(other, "/api/show", {"model": model}, timeout=20).get("capabilities") if o else None
        print(f"{name} ({other}) : " + (f"présent · capacités {', '.join(oc or []) or 'non rendues'}" if o else "le modèle n'y est pas"))
    except (OSError, ValueError) as e:
        print(f"{name} ({other}) : ne répond pas ({e})")
ready = "tools" in caps
if ready:
    print("\n→ l'agent peut travailler : il appelle ses outils" + ("." if "vision" in caps else ", sans regarder les images."))
else:
    print("\n→ l'agent NE PEUT PAS travailler avec ce modèle : il faut un modèle qui a « tools ».")
sys.exit(0 if ready else 1)
