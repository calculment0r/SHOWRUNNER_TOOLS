"""L'agent Showrunner : le registre des capacités (docs/etudes/agent_autonome.md § 5.6, le lot 1
au § 9 ; le catalogue de la veille : docs/etudes/veille_1009.md § 3).

Tout ce que le portail sait faire, ou pourrait faire, en DONNÉES (le dossier `agent/` du dépôt) :

  agent/intentions.json         le vocabulaire fermé des intentions (le routeur n'en sort aucune autre)
  agent/capacites/<id>.json     une fiche par workflow : intentions, outil, travail de la file ou
                                route, entrées, sortie, critères, limites, exigences, coût, licence
  agent/skills/<id>/            une skill : SKILL.md (la consigne : un résumé pour Cal, le corps en
                                anglais pour le modèle), skill.json (le contrat lu par le code),
                                ses schémas de sortie (decoupage.schema.json…)

L'ÉTAT d'une capacité est calculé ici, jamais écrit à la main : `branche` (le travail est déclaré
dans la file, l'interrupteur posé, la voie a ses instances, les modèles et les nœuds sont dans la
ComfyUI d'une machine), `factice` (le moteur d'essai : l'interrupteur n'est pas posé), `installable`
(documenté, il manque le travail, un modèle, un réglage : le geste de Cal), `absent` (aucune méthode
connue) — chacun avec son `pourquoi`, comme `EDIT_TOOLS["extend"]["off"]` d'Image. Gardé 30 s, comme
`ideation_agent.engine_state`.

Le routeur (server/tools/ideation_agent.py) lit l'enum des intentions et le schéma des entrées
(`schema_routeur`) ; la politique (server/tools/agent_politique.py) lit les capacités, leur état,
leurs critères et les questions des skills. `tools/check.py` garde le registre complet : chaque
sorte de `jobs.register` est le travail d'une capacité, ou marquée interne avec sa raison.

Route : `GET /api/agent/registre` → {intentions, capacites (avec etat, pourquoi), skills, erreurs}.
"""

from __future__ import annotations

import importlib
import json
import re
import threading
import time
import urllib.parse
from pathlib import Path

from core import config, jobs
from core.comfy import Comfy, ComfyError

DIR = config.REPO / "agent"
ETATS = ("branche", "factice", "installable", "absent")
PRETS = ("branche", "factice")   # ce que la politique peut choisir : le moteur d'essai tourne aussi
CONSENTEMENTS = ("aucun", "rendu", "telechargement")
SORTIES = ("reponse", "planche", "image", "video", "son", "document", "deck", "objet3d", "sequence", "aucune")
SORTES = ("image", "video", "audio", "element", "document", "midi", "sequence", "playlist", "note")   # library.KINDS + une note de la planche
TYPES = ("texte", "entier", "enum")
EXIGE = ("interrupteur", "image", "pret", "noeuds", "comfy_modeles", "comfyui_min")
ETAPES = ("structure", "boucle", "code", "validation", "travaux")
ID = re.compile(r"[a-z0-9]+(?:[._][a-z0-9]+)*")
SKILL_ID = re.compile(r"[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?")   # Agent Skills : 1 à 64 signes, minuscules, chiffres, traits d'union
ROUTE = re.compile(r"(GET|POST|PUT|DELETE) (/api/\S+)")
DATE = re.compile(r"\d{4}-\d{2}-\d{2}")
MAX_AGE = 30.0
SKILL_LINES = 500      # « Keep your main SKILL.md under 500 lines » (la spécification d'Agent Skills, l'étude § 2.1)
CORPS = "# Instructions"   # dans SKILL.md : ce qui suit cette ligne est la consigne du modèle

_app = None
_cache: dict = {"t": 0.0, "v": None}
_comfy: dict = {}       # instance → (t, {nœud: info}, {dossier: [fichiers]}, version)
_lock = threading.Lock()


# ── un validateur de schéma JSON : le sous-ensemble qu'emploient nos schémas ──
def valide(schema: dict, x, chemin: str = "") -> list[str]:
    """Les écarts de `x` au schéma (type, enum, required, properties, items, minItems, maxItems,
    minimum, maximum, maxLength) ; [] s'il le suit. Une propriété que le schéma ne nomme pas est
    refusée (`additionalProperties` de fait : un découpage ne transporte rien d'autre)."""
    out: list[str] = []
    where = chemin or "la racine"
    if "enum" in schema and x not in schema["enum"]:
        return [f"{where} : « {str(x)[:40]} » n'est pas parmi {', '.join(map(str, schema['enum']))}"]
    t = schema.get("type")
    if t == "object":
        if not isinstance(x, dict):
            return [f"{where} : un objet"]
        props = schema.get("properties") or {}
        for k in schema.get("required") or []:
            if k not in x:
                out.append(f"{where} : « {k} » manque")
        for k, v in x.items():
            if k not in props:
                out.append(f"{where} : « {k} » n'est pas dans le schéma")
            else:
                out += valide(props[k], v, f"{chemin}.{k}" if chemin else k)
        return out
    if t == "array":
        if not isinstance(x, list):
            return [f"{where} : une liste"]
        if len(x) < int(schema.get("minItems") or 0):
            out.append(f"{where} : {schema['minItems']} au moins")
        if schema.get("maxItems") is not None and len(x) > schema["maxItems"]:
            out.append(f"{where} : {schema['maxItems']} au plus")
        for i, v in enumerate(x):
            out += valide(schema.get("items") or {}, v, f"{chemin}[{i}]")
        return out
    if t == "string":
        if not isinstance(x, str):
            return [f"{where} : un texte"]
        if schema.get("maxLength") is not None and len(x) > schema["maxLength"]:
            out.append(f"{where} : {schema['maxLength']} signes au plus")
        return out
    if t in ("number", "integer"):
        if isinstance(x, bool) or not isinstance(x, (int, float)) or (t == "integer" and not float(x).is_integer()):
            return [f"{where} : un {'entier' if t == 'integer' else 'nombre'}"]
        if schema.get("minimum") is not None and x < schema["minimum"]:
            out.append(f"{where} : {schema['minimum']} au moins")
        if schema.get("maximum") is not None and x > schema["maximum"]:
            out.append(f"{where} : {schema['maximum']} au plus")
        return out
    if t == "boolean" and not isinstance(x, bool):
        return [f"{where} : vrai ou faux"]
    return out


def borne(schema: dict, x):
    """`x` ramené dans les bornes du schéma : un texte coupé à sa longueur, une liste à son nombre, un
    nombre dans son intervalle, les propriétés inconnues retirées. La sortie structurée d'Ollama tient la
    forme ; les longueurs, elle ne les garantit pas (non documenté) : on les tient ici, par construction,
    au lieu de refuser tout un découpage pour une phrase trop longue. Ce qui reste faux (un enum, un champ
    requis) se lit ensuite par `valide`."""
    t = schema.get("type")
    if t == "object" and isinstance(x, dict):
        props = schema.get("properties") or {}
        return {k: borne(props[k], v) for k, v in x.items() if k in props}
    if t == "array" and isinstance(x, list):
        if schema.get("maxItems") is not None:
            x = x[:schema["maxItems"]]
        return [borne(schema.get("items") or {}, v) for v in x]
    if t == "string" and isinstance(x, str):
        n = schema.get("maxLength")
        x = " ".join(x.split()) if "\n" not in x else x.strip()
        return x if n is None or len(x) <= n else x[:n - 1].rstrip() + "…"
    if t in ("number", "integer") and isinstance(x, (int, float)) and not isinstance(x, bool):
        if schema.get("minimum") is not None:
            x = max(schema["minimum"], x)
        if schema.get("maximum") is not None:
            x = min(schema["maximum"], x)
        return int(round(x)) if t == "integer" else x
    return x


# ── charger et valider les données ──────────────────────────
def _lire(p: Path):
    return json.loads(p.read_text(encoding="utf-8"))


def outils_connus() -> set:
    """Les outils que le modèle peut appeler (server/tools/ideation_agent.py) : une skill n'en nomme pas d'autres."""
    from tools import ideation_agent as ia
    return set(ia.READ_TOOLS) | set(ia.WRITE_TOOLS) | set(ia.NOTE_TOOLS)


def _front(text: str) -> tuple[dict, str]:
    """L'en-tête YAML d'un SKILL.md (seulement `clé: valeur` sur une ligne : name, description…) et le reste."""
    m = re.match(r"---\n(.*?)\n---\n?(.*)", text, re.S)
    if not m:
        return {}, text
    head = {}
    for ln in m.group(1).splitlines():
        k, _, v = ln.partition(":")
        if k.strip() and v.strip():
            head[k.strip()] = v.strip().strip('"')
    return head, m.group(2)


def _entree_errs(k: str, e, quoi: str) -> list[str]:
    if not isinstance(e, dict):
        return [f"{quoi} : l'entrée « {k} » est un objet"]
    out = []
    if not isinstance(e.get("requis", False), bool):
        out.append(f"{quoi} : « {k} ».requis est vrai ou faux")
    s = e.get("sorte")
    sortes = s if isinstance(s, list) else [s] if s else []
    if any(x not in SORTES for x in sortes):
        out.append(f"{quoi} : « {k} ».sorte : {', '.join(SORTES)}")
    if not sortes and e.get("type") not in TYPES:
        out.append(f"{quoi} : « {k} » a une sorte ({', '.join(SORTES)}) ou un type ({', '.join(TYPES)})")
    if e.get("type") == "enum" and not (isinstance(e.get("valeurs"), list) and e["valeurs"]):
        out.append(f"{quoi} : « {k} » (enum) nomme ses valeurs")
    q = e.get("question")
    if q is not None and not (isinstance(q, dict) and str(q.get("texte") or "").strip()):
        out.append(f"{quoi} : « {k} ».question a un texte")
    if isinstance(q, dict) and isinstance(q.get("choix"), list) and isinstance(e.get("valeurs"), list) \
            and len(q["choix"]) != len(e["valeurs"]):
        out.append(f"{quoi} : « {k} » : autant de choix que de valeurs (un choix dit une valeur)")
    return out


def charger() -> dict:
    """Les intentions, les capacités, les skills, lus et vérifiés ; ce qui ne va pas est dit dans `erreurs`
    (une fiche fautive est écartée, le reste sert)."""
    from tools import agent_politique as pol
    errs: list[str] = []
    try:
        doc = _lire(DIR / "intentions.json")
    except (OSError, ValueError) as e:
        return {"intentions": [], "capacites": [], "skills": {}, "erreurs": [f"intentions.json : {e}"]}
    intentions, seen = [], set()
    for i in doc.get("intentions") or []:
        iid = str(i.get("id") or "")
        bad = [] if ID.fullmatch(iid) else [f"intention « {iid} » : un identifiant en minuscules, à points"]
        bad += [f"intention « {iid} » : {k} manque" for k in ("label", "une_ligne", "skill", "sortie") if not i.get(k)]
        if not (isinstance(i.get("exemples"), list) and 3 <= len(i["exemples"]) <= 6):
            bad.append(f"intention « {iid} » : 3 à 6 exemples")
        if i.get("sortie") not in SORTIES:
            bad.append(f"intention « {iid} » : sortie = {', '.join(SORTIES)}")
        if iid in seen:
            bad.append(f"intention « {iid} » : deux fois")
        seen.add(iid)
        if bad:
            errs += bad
            continue
        intentions.append(i)
    known = {i["id"] for i in intentions}
    skills: dict = {}
    for d in sorted(p for p in (DIR / "skills").iterdir() if p.is_dir()) if (DIR / "skills").is_dir() else []:
        try:
            meta = _lire(d / "skill.json")
            md = (d / "SKILL.md").read_text(encoding="utf-8")
        except (OSError, ValueError) as e:
            errs.append(f"skill {d.name} : {e}")
            continue
        head, body = _front(md)
        bad = []
        if not SKILL_ID.fullmatch(d.name) or head.get("name") != d.name or meta.get("id") != d.name:
            bad.append(f"skill {d.name} : name (SKILL.md), id (skill.json) et dossier sont le même nom (1 à 64 signes : a-z, 0-9, -)")
        if not 1 <= len(head.get("description") or "") <= 1024:
            bad.append(f"skill {d.name} : une description de 1 à 1 024 signes (SKILL.md)")
        if len(md.splitlines()) > SKILL_LINES:
            bad.append(f"skill {d.name} : SKILL.md de plus de {SKILL_LINES} lignes")
        if CORPS not in body:
            bad.append(f"skill {d.name} : SKILL.md a sa partie « {CORPS} » (la consigne du modèle)")
        for k, e in (meta.get("entrees") or {}).items():
            bad += _entree_errs(k, e, f"skill {d.name}")
        et = meta.get("etapes") or []
        if not et or any(not isinstance(x, dict) or x.get("sorte") not in ETAPES or not x.get("id") for x in et):
            bad.append(f"skill {d.name} : des étapes typées ({', '.join(ETAPES)}), chacune son id")
        tools = set(meta.get("outils") or []) | {t for v in (meta.get("outils_selon_intention") or {}).values() for t in v}
        unknown = tools - outils_connus()
        if unknown:
            bad.append(f"skill {d.name} : outils inconnus {sorted(unknown)}")
        if any(x not in known for x in meta.get("intentions") or []):
            bad.append(f"skill {d.name} : une intention inconnue")
        schema = None
        for x in et:
            if x.get("schema"):
                try:
                    schema = _lire(d / x["schema"])
                except (OSError, ValueError) as e:
                    bad.append(f"skill {d.name} : {x['schema']} : {e}")
        if bad:
            errs += bad
            continue
        skills[d.name] = {"id": d.name, "meta": meta, "description": head["description"],
                          "corps": body.split(CORPS, 1)[1].strip(), "schema": schema}
    for i in intentions:   # chaque intention a sa skill, ou le lot qui l'écrira
        if i["skill"] not in skills and not i.get("a_venir"):
            errs.append(f"intention « {i['id']} » : la skill « {i['skill']} » n'existe pas (ni a_venir)")
        if i["skill"] in skills and i["id"] not in (skills[i["skill"]]["meta"].get("intentions") or []):
            errs.append(f"intention « {i['id']} » : sa skill « {i['skill']} » ne la nomme pas")
    entrees: dict = {}
    for s in skills.values():   # une entrée a le même sens d'une skill à l'autre (le schéma du routeur les réunit)
        for k, e in (s["meta"].get("entrees") or {}).items():
            sig = (e.get("type"), json.dumps(e.get("sorte")), json.dumps(e.get("valeurs")))
            if entrees.setdefault(k, sig) != sig:
                errs.append(f"l'entrée « {k} » change de sens d'une skill à l'autre")
    capacites, cseen = [], set()
    for p in sorted((DIR / "capacites").glob("*.json")) if (DIR / "capacites").is_dir() else []:
        try:
            c = _lire(p)
        except ValueError as e:
            errs.append(f"{p.name} : {e}")
            continue
        bad = fiche_errs(c, known, pol.FAITS)
        if c.get("id") and p.stem != c["id"]:
            bad.append(f"{p.name} : le fichier porte le nom de la fiche ({c['id']}.json)")
        if c.get("id") in cseen:
            bad.append(f"{p.name} : deux fiches « {c['id']} »")
        cseen.add(c.get("id"))
        if bad:
            errs += bad
            continue
        capacites.append(c)
    for i in intentions:
        for a in i.get("approchants") or []:
            if a not in cseen:
                errs.append(f"intention « {i['id']} » : approchant inconnu « {a} »")
    return {"intentions": intentions, "capacites": capacites, "skills": skills, "erreurs": errs}


def fiche_errs(c, intentions: set, faits: tuple) -> list[str]:
    """Ce qui ne va pas dans une fiche de capacité (le format de l'étude § 5.6, et les cinq champs de la veille § 3.3)."""
    if not isinstance(c, dict):
        return ["une fiche est un objet"]
    cid = str(c.get("id") or "?")
    q = f"capacité « {cid} »"
    out = [] if ID.fullmatch(cid) else [f"{q} : un identifiant en minuscules, à points"]
    out += [f"{q} : {k} manque" for k in ("label", "outil", "rempli_par") if not str(c.get(k) or "").strip()]
    if not (isinstance(c.get("intentions"), list) and c["intentions"] and all(x in intentions for x in c["intentions"])):
        out.append(f"{q} : des intentions de agent/intentions.json")
    for k in ("travail", "route"):
        if k not in c or not (c[k] is None or isinstance(c[k], str)):
            out.append(f"{q} : {k} est une sorte de la file, une route, ou null")
    if c.get("route") and not ROUTE.fullmatch(c["route"]):
        out.append(f"{q} : route = « POST /api/… »")
    if not isinstance(c.get("entrees"), dict):
        out.append(f"{q} : entrees est un objet")
    else:
        for k, e in c["entrees"].items():
            out += _entree_errs(k, e, q)
    if not (isinstance(c.get("sortie"), dict) and c["sortie"].get("sorte") in SORTIES):
        out.append(f"{q} : sortie.sorte = {', '.join(SORTIES)}")
    for cr in c.get("criteres") if isinstance(c.get("criteres"), list) else [None]:
        if not (isinstance(cr, dict) and cr.get("si") in faits and str(cr.get("pourquoi") or "").strip()
                and (cr.get("exclut") is True or isinstance(cr.get("poids"), (int, float)))):
            out.append(f"{q} : un critère = {{si (un fait de agent_politique.FAITS), poids ou exclut, pourquoi}}")
            break
    ex = (c.get("etat") or {}).get("exige") if isinstance(c.get("etat"), dict) else None
    if not isinstance(ex, dict) or any(k not in EXIGE for k in ex):
        out.append(f"{q} : etat.exige est un objet ({', '.join(EXIGE)})")
    elif ex.get("interrupteur") and "=" not in ex["interrupteur"]:
        out.append(f"{q} : etat.exige.interrupteur = « réglage=valeur »")
    if not (isinstance(c.get("cout"), dict) and c["cout"].get("classe") in jobs.COSTS):
        out.append(f"{q} : cout.classe = {', '.join(jobs.COSTS)}")
    if c.get("consentement") not in CONSENTEMENTS:
        out.append(f"{q} : consentement = {', '.join(CONSENTEMENTS)}")
    lic = c.get("licence")
    if not (isinstance(lic, dict) and str(lic.get("nom") or "").strip() and isinstance(lic.get("lue"), bool)):
        out.append(f"{q} : licence = {{nom, lue (vrai ou faux)}}")
    if not isinstance(c.get("sources"), list):
        out.append(f"{q} : sources est une liste")
    if not DATE.fullmatch(str(c.get("verifie") or "")):
        out.append(f"{q} : verifie = AAAA-MM-JJ")
    for t in c.get("telechargements") or []:
        if not (isinstance(t, dict) and t.get("depot") and t.get("fichier") and t.get("dossier")):
            out.append(f"{q} : un téléchargement = {{depot, fichier, dossier, go, licence}}")
            break
    return out


def skill(sid: str) -> dict | None:
    """Une skill chargée (sa consigne, son contrat, son schéma) — lue dans le registre gardé."""
    return registre()["skills"].get(sid)


# ── l'état, calculé ──────────────────────────────────────────
def route_existe(route: str) -> bool:
    """« POST /api/… » : une route que le portail sert (les {paramètres} remplacés par un mot)."""
    m = ROUTE.fullmatch(route or "")
    if not m or _app is None:
        return False
    path = re.sub(r"\{\w+\}", "x", m.group(2))
    return any(meth == m.group(1) and rx.match(path) for meth, rx, _ in _app.routes)


def _interrupteur(spec: str) -> tuple[bool, str, object]:
    k, _, want = spec.partition("=")
    sw = config.SWITCHES.get(k.strip()) or {}
    cur = config.get(k.strip(), sw.get("default"))
    return str(cur).lower() == want.strip().lower(), k.strip(), cur


def _version(v) -> tuple:
    try:
        return tuple(int(x) for x in str(v).lstrip("v").split(".")[:3])
    except ValueError:
        return ()


def _lire_comfy(ep: str, noeuds: list, dossiers: list) -> tuple[dict, dict, str]:
    """Ce qu'une instance ComfyUI dit d'elle (lecture seule, gardée 30 s) : les nœuds demandés
    (`/object_info/<nœud>`), les fichiers des dossiers demandés (`/models/<dossier>`, la route de
    ComfyUI server.py) et sa version (`/system_stats`, system.comfyui_version)."""
    key = (ep, tuple(sorted(noeuds)), tuple(sorted(dossiers)))
    got = _comfy.get(key)
    if got and time.time() - got[0] < MAX_AGE:
        return got[1], got[2], got[3]
    c = Comfy(ep, timeout=10)
    info = {}
    for n in noeuds:
        info.update(c.object_info(n))
    files = {}
    for d in dossiers:
        try:
            files[d] = list(c._json("GET", f"/models/{urllib.parse.quote(d)}") or [])
        except ComfyError:
            files[d] = []   # un dossier que cette ComfyUI ne connaît pas (404) : rien dedans
    ver = str(((c._json("GET", "/system_stats") or {}).get("system") or {}).get("comfyui_version") or "")
    _comfy[key] = (time.time(), info, files, ver)
    return info, files, ver


def _manque_comfy(ep: str, ex: dict) -> list[str]:
    modeles = [str(x) for x in ex.get("comfy_modeles") or []]
    info, files, ver = _lire_comfy(ep, list(ex.get("noeuds") or []), sorted({m.split("/", 1)[0] for m in modeles if "/" in m}))
    out = [f"nœud {n}" for n in ex.get("noeuds") or [] if n not in info]
    for m in modeles:
        d, _, f = m.partition("/")
        if f not in files.get(d, []):
            out.append(m)
    if ex.get("comfyui_min") and _version(ver) < _version(ex["comfyui_min"]):
        out.append(f"ComfyUI ≥ {ex['comfyui_min']} (là : {ver or 'version illisible'})")
    return out


def _go(t: dict) -> str:
    return f" ({t['go']} Go)" if t.get("go") else ""


def etat_de(c: dict) -> tuple[str, str]:
    """(état, pourquoi) d'une capacité, lus dans le portail tel qu'il tourne : la file, les réglages, les
    instances, ce que dit l'outil lui-même (`pret`, `image`), ce que dit la ComfyUI."""
    kind, route = c.get("travail"), c.get("route")
    ex = (c.get("etat") or {}).get("exige") or {}
    doc = bool(c.get("telechargements") or c.get("sources"))
    dl = "; ".join(f"{t['fichier']}{_go(t)}" for t in c.get("telechargements") or [])
    if kind and kind not in jobs.HANDLERS:
        why = f"le travail « {kind} » n'existe pas encore dans le portail" + (f" ; à télécharger : {dl}" if dl else "")
        return ("installable" if doc else "absent"), why
    if route and not route_existe(route):
        return ("installable" if doc else "absent"), f"la route {route} n'existe pas encore"
    if ex.get("interrupteur"):
        on, k, cur = _interrupteur(ex["interrupteur"])
        if not on:
            return "factice", f"le moteur d'essai : réglage {k} = {cur} (Admin → Câblage ; {ex['interrupteur']} pour le vrai)"
    lane = jobs.HANDLERS[kind][1] if kind else None
    eps = list((config.get("lanes") or {}).get(lane, [])) if lane else []
    if kind and not eps:
        return "installable", f"aucune instance sur la voie « {lane} » (réglage lanes de showrunner.local.json)"
    try:
        if ex.get("pret"):
            mod, _, fn = ex["pret"].rpartition(".")
            v = getattr(importlib.import_module(f"tools.{mod}"), fn)()
            if not (v.get("ok") or v.get("ready")):
                return "installable", str(v.get("why") or "pas prêt (l'outil le dit)")
        if ex.get("image"):
            from tools import image
            av = image.availability().get(ex["image"]) or {}
            if not av.get("on"):
                miss = "; ".join(f"{m} : {', '.join(x[:4])}" for m, x in (av.get("missing") or {}).items())
                return "installable", f"aucune machine n'a ce qu'il faut ({miss or 'aucune instance de la voie image'})"
        if ex.get("noeuds") or ex.get("comfy_modeles") or ex.get("comfyui_min"):
            http = [e for e in eps if str(e).startswith("http")]
            if not http:
                return "factice", f"la voie « {lane} » n'a pas de ComfyUI ici : le moteur d'essai"
            manques = {}
            for ep in http:
                if not jobs.endpoint_alive(ep)[0]:
                    manques[jobs.machine_of(ep)] = ["ne répond pas"]
                    continue
                m = _manque_comfy(ep, ex)
                if not m:
                    return "branche", ""
                manques[jobs.machine_of(ep)] = m
            return "installable", "manque " + " ; ".join(f"sur {k} : {', '.join(v[:5])}" for k, v in manques.items()) + (
                f" — à télécharger : {dl}" if dl else "")
    except Exception as e:  # noqa: BLE001 — un état illisible n'est jamais « branché »
        return "installable", f"l'état ne se lit pas ({type(e).__name__} : {e})"[:300]
    return "branche", ""


def registre(max_age: float = MAX_AGE) -> dict:
    """Le registre chargé, chaque capacité avec son état (gardé `max_age` secondes ; 0 : relu)."""
    with _lock:
        if _cache["v"] and time.time() - _cache["t"] < max_age:
            return _cache["v"]
    reg = charger()
    for c in reg["capacites"]:
        c["etat"], c["pourquoi"] = etat_de(c)
    with _lock:
        _cache.update(t=time.time(), v=reg)
    return reg


def capacite(reg: dict, cid: str) -> dict | None:
    return next((c for c in reg["capacites"] if c["id"] == cid), None)


def intention(reg: dict, iid: str) -> dict | None:
    return next((i for i in reg["intentions"] if i["id"] == iid), None)


def public(reg: dict | None = None) -> dict:
    reg = reg or registre()
    return {"intentions": [{"id": i["id"], "label": i["label"], "skill": i["skill"], **({"a_venir": i["a_venir"]} if i.get("a_venir") else {})}
                           for i in reg["intentions"]],
            "capacites": [{k: c.get(k) for k in ("id", "label", "intentions", "outil", "etat", "pourquoi", "cout", "consentement",
                                                 "licence", "telechargements", "limites")} for c in reg["capacites"]],
            "skills": [{"id": s["id"], "label": s["meta"].get("label"), "description": s["description"]} for s in reg["skills"].values()],
            "erreurs": reg["erreurs"]}


# ── ce que lit le routeur ────────────────────────────────────
def intentions_texte(reg: dict) -> str:
    """Les intentions en une ligne chacune (l'id, ce qu'elle couvre, un exemple) : ≈ 2 800 signes, 700 jetons (l'étude § 5.3 : ≈ 2 000)."""
    return "\n".join(f"- {i['id']}: {i['une_ligne']} (e.g. « {i['exemples'][0]} »)" for i in reg["intentions"])


def entrees_texte(reg: dict) -> str:
    """Ce que peut prendre une intention (les entrées des skills), une ligne chacune, pour le routeur."""
    out, seen = [], set()
    for s in reg["skills"].values():
        for k, e in (s["meta"].get("entrees") or {}).items():
            if k in seen:
                continue
            seen.add(k)
            what = ("the id of a cited piece, « demande » or « brief »" if e.get("sorte") else
                    f"a number from {e.get('min', 1)} to {e.get('max', 99)}" if e.get("type") == "entier" else
                    "one of: " + ", ".join(e["valeurs"]) if e.get("type") == "enum" else "a few words")
            q = (e.get("question") or {}).get("texte")
            out.append(f"- {k} ({', '.join(s['meta'].get('intentions') or [])}): {what}" + (f" — « {q} »" if q else ""))
    return "\n".join(out)


def schema_routeur(reg: dict, sources: list | tuple = ()) -> dict:
    """La sortie du routeur (l'étude § 5.3, § 9.3) : l'intention dans l'enum du registre, la clarté, les
    entrées connues (celles des skills : leurs types ; une entrée d'une sorte du portail ne peut nommer
    qu'une des `sources` de ce tour), les objets visés, un résumé. Construit à chaque appel : une valeur
    qui n'existe pas ne peut pas sortir."""
    props: dict = {}
    for s in reg["skills"].values():
        for k, e in (s["meta"].get("entrees") or {}).items():
            if e.get("sorte"):
                if sources:
                    props[k] = {"type": "string", "enum": list(sources)}
            elif e.get("type") == "entier":
                props[k] = {"type": "integer", **({"minimum": e["min"]} if "min" in e else {}), **({"maximum": e["max"]} if "max" in e else {})}
            elif e.get("type") == "enum":
                props[k] = {"type": "string", "enum": list(e["valeurs"])}
            else:
                props[k] = {"type": "string", "maxLength": 200}
    return {"type": "object", "required": ["intention", "clarte", "entrees", "cible", "resume"], "properties": {
        "intention": {"type": "string", "enum": [i["id"] for i in reg["intentions"]]},
        "clarte": {"type": "string", "enum": ["precise", "vague"]},
        "entrees": {"type": "object", "properties": props},
        "cible": {"type": "array", "items": {"type": "string"}, "maxItems": 24},
        "resume": {"type": "string", "maxLength": 200}}}


# ── la route ─────────────────────────────────────────────────
def r_registre(req):
    """Le registre et l'état de chaque capacité (lecture ; aucun calcul, aucun travail). `?frais=1` : relu."""
    return public(registre(0 if req.q("frais") in ("1", "oui") else MAX_AGE))


def register(app) -> None:
    global _app
    _app = app
    app.route("GET", "/api/agent/registre", r_registre)


# ── le contrôle (tools/check.py) ─────────────────────────────
def selftest(call, ok) -> None:
    from tools import agent_politique as pol
    reg = charger()
    ok(not reg["erreurs"], f"registre : chaque fiche, chaque intention, chaque skill se lit et suit son format ({reg['erreurs'][:6]})")
    ok(len(reg["intentions"]) == 20 and any(i["id"] == "autre" for i in reg["intentions"]),
       f"registre : le vocabulaire fermé, 20 intentions, « autre » compris ({len(reg['intentions'])})")
    ok({"conversation", "storyboard"} <= set(reg["skills"]), f"registre : les skills du lot 1 ({sorted(reg['skills'])})")
    want = {"planche.gestes", "image.generer.krea2", "image.generer.qwen21", "image.generer.zimage", "image.consigne", "video.i2v",
            "video.r2v", "video.t2v", "transcrire", "presentation.pdf", "presentation.video", "objet.mesh", "montage.export",
            "vfx.retirer_personne.ltx", "vfx.retirer_personne.h3"}
    have = {c["id"] for c in reg["capacites"]}
    ok(want <= have, f"registre : les capacités du lot 1 (§ 9.1) — manquent {sorted(want - have)}")
    # le travail de chaque capacité qui tourne est une sorte déclarée, sa route une route du portail
    full = registre(0)
    bad = [c["id"] for c in full["capacites"] if c["etat"] in PRETS and c.get("travail") and c["travail"] not in jobs._META]
    badr = [c["id"] for c in full["capacites"] if c["etat"] in PRETS and c.get("route") and not route_existe(c["route"])]
    ok(not bad and not badr, f"registre : le travail d'une capacité prête est une sorte de la file, sa route une route du portail ({bad} {badr})")
    # la veille (§ 3.5) : une capacité installable porte une source et une licence
    inst = [c for c in full["capacites"] if c["etat"] == "installable"]
    ok(inst and all(c["sources"] and c["licence"]["nom"] for c in inst),
       f"registre : chaque capacité installable dit ses sources et sa licence ({[c['id'] for c in inst if not c['sources']]})")
    by = {c["id"]: c for c in full["capacites"]}
    ok(by["planche.gestes"]["etat"] == "branche" and by["image.generer.krea2"]["etat"] == "factice"
       and "image_backend" in by["image.generer.krea2"]["pourquoi"] and by["vfx.retirer_personne.ltx"]["etat"] == "installable"
       and "movie.retoucher" in by["vfx.retirer_personne.ltx"]["pourquoi"],
       f"registre : l'état calculé — un geste branché, Krea 2 factice (le moteur d'essai), LTX-2.5 installable "
       f"({by['planche.gestes']['etat']} {by['image.generer.krea2']['etat']} {by['vfx.retirer_personne.ltx']['etat']})")
    # l'état d'après la ComfyUI : un travail déclaré, une voie à une instance, des nœuds et des modèles présents ou non
    _selftest_comfy(ok, pol)
    # le format : une fiche fautive est dite, pas prise
    errs = fiche_errs({"id": "x.y", "label": "x", "intentions": ["inconnue"], "outil": "x", "travail": None, "route": "GET x",
                       "entrees": {"a": {"sorte": "fichier"}}, "sortie": {"sorte": "?"}, "criteres": [{"si": "lune"}],
                       "etat": {"exige": {"voeu": 1}}, "cout": {"classe": "or"}, "consentement": "oui", "licence": {},
                       "sources": [], "rempli_par": "x", "verifie": "hier"}, {i["id"] for i in reg["intentions"]}, pol.FAITS)
    ok(len(errs) >= 9, f"registre : une fiche fautive est dite, champ par champ ({len(errs)} : {errs[:3]})")
    # le schéma du routeur : l'enum des intentions ; une entrée d'une sorte du portail ne nomme qu'une source du tour
    sch = schema_routeur(full, ["doc-1", "demande"])
    ok(sch["properties"]["intention"]["enum"] == [i["id"] for i in full["intentions"]]
       and sch["properties"]["entrees"]["properties"]["source"]["enum"] == ["doc-1", "demande"]
       and sch["properties"]["entrees"]["properties"]["rendu"]["enum"] == ["crayonne", "photoreal"]
       and not valide(sch, {"intention": "storyboard.creer", "clarte": "precise", "entrees": {"plans": 9}, "cible": [], "resume": "x"})
       and valide(sch, {"intention": "rever", "clarte": "precise", "entrees": {}, "cible": [], "resume": "x"}),
       "registre : le schéma du routeur, construit depuis le registre (l'enum, les entrées, les sources du tour)")
    txt = intentions_texte(full)
    ok(len(txt) < 3200 and "storyboard.creer" in txt, f"registre : les intentions en une ligne chacune pour le routeur ({len(txt)} signes)")
    # la route : ce que lit la page (« Ce que je sais faire »), et la garde (un guest ne calcule rien en la lisant)
    st, r = call("GET", "/api/agent/registre")
    ok(st == 200 and {c["id"] for c in r.get("capacites") or []} == have and all(c.get("etat") in ETATS for c in r["capacites"])
       and r.get("erreurs") == [] and len(r.get("skills") or []) >= 2,
       f"registre : GET /api/agent/registre rend les intentions, les capacités et leur état, les skills ({st})")
    _selftest_guest(ok)
    # le validateur, la borne
    sch2 = {"type": "object", "required": ["a"], "properties": {"a": {"type": "string", "maxLength": 5},
                                                                "n": {"type": "integer", "minimum": 1, "maximum": 3},
                                                                "l": {"type": "array", "maxItems": 2, "items": {"enum": ["x", "y"]}}}}
    b = borne(sch2, {"a": "abcdefgh", "n": 9, "l": ["x", "y", "x"], "z": 1})
    ok(valide(sch2, {"a": "abcdefgh"}) and not valide(sch2, b) and b["n"] == 3 and len(b["a"]) == 5 and "z" not in b
       and valide(sch2, {"a": "a", "l": ["w"]}),
       f"registre : le validateur de schéma, et la borne qui ramène dans les bornes ({b})")


def _selftest_comfy(ok, pol) -> None:
    """Un travail d'essai sur une voie à une fausse ComfyUI (tools/faux_comfy.py) : la fiche est branchée quand
    les nœuds et les modèles y sont, installable sinon (avec ce qui manque, par machine) ; factice sans
    l'interrupteur."""
    from tools.admin import _faux
    srv, F, url = _faux().start()
    saved = {k: config.CFG.get(k) for k in ("lanes", "registre_essai")}
    try:
        jobs.register("registre.essai", lambda ctx: {"note": "ok"}, lane="registre-essai", title="Essai du registre", cost="cpu")
        config.CFG["lanes"] = {**(config.CFG.get("lanes") or {}), "registre-essai": [url]}
        fiche = {"id": "essai.comfy", "travail": "registre.essai", "route": None, "sources": ["essai"],
                 "etat": {"exige": {"noeuds": ["LoraLoaderModelOnly"], "comfy_modeles": ["loras/essai.safetensors"], "comfyui_min": "0.3.0"}}}
        F.loras, F.version = [], "0.37.2"
        e1 = etat_de(fiche)
        F.loras = ["essai.safetensors"]
        _comfy.clear()
        e2 = etat_de(fiche)
        e3 = etat_de({**fiche, "etat": {"exige": {"noeuds": ["LTXAddVideoICLoRAGuide"]}}})
        F.version = "0.2.9"
        _comfy.clear()
        e4 = etat_de(fiche)
        config.CFG["registre_essai"] = "non"
        config.declare_switch("registre_essai", ["non", "oui"], label="Essai du registre", default="non")
        e5 = etat_de({**fiche, "etat": {"exige": {"interrupteur": "registre_essai=oui"}}})
        ok(e1[0] == "installable" and "loras/essai.safetensors" in e1[1] and e2 == ("branche", "")
           and e3[0] == "installable" and "LTXAddVideoICLoRAGuide" in e3[1] and e4[0] == "installable" and "0.3.0" in e4[1]
           and e5[0] == "factice" and "registre_essai" in e5[1],
           f"registre : l'état lu dans la ComfyUI (nœuds, modèles par /models/<dossier>, version) et l'interrupteur ({e1} {e2} {e3} {e4} {e5})")
    finally:
        srv.shutdown()
        jobs.HANDLERS.pop("registre.essai", None)
        jobs._META.pop("registre.essai", None)
        config.SWITCHES.pop("registre_essai", None)
        _comfy.clear()
        for k, v in saved.items():
            if v is None:
                config.CFG.pop(k, None)
            else:
                config.CFG[k] = v


def _selftest_guest(ok) -> None:
    """La garde : un guest (viewer) qui lit le registre ne lance aucun travail ; la lecture ne dit rien d'un Workspace."""
    from core import auth
    from tools.admin import essai_http as H
    before = {k: config.CFG.get(k) for k in ("auth", "equipes_guests_essai")}
    same = {"Origin": f"http://127.0.0.1:{config.get('port')}"}
    n0 = len(jobs._jobs)
    try:
        config.CFG["auth"] = True
        config.CFG["equipes_guests_essai"] = True
        auth.startup()
        with auth._lock:
            auth._hits.clear()
        _, _, cal = H("POST", "/api/auth/enter", {"name": "nico007"}, headers=same)
        H("POST", "/api/equipes/tea-nirvalab/membres", {"pseudo": "Vic Registre", "role": "guest", "guest": "viewer",
                                                         "spaces": ["esp-general"]}, cookie=cal, headers=same)
        _, _, vic = H("POST", "/api/auth/enter", {"name": "Vic Registre"}, headers=same)
        s1, d1, _ = H("GET", "/api/agent/registre", cookie=vic, headers={**same, "X-SR-Espace": "esp-general"})
        s0, _, _ = H("GET", "/api/agent/registre", headers=same)
        ok(bool(vic) and s1 in (200, 403) and s0 == 401 and len(jobs._jobs) == n0
           and (s1 == 403 or not any(k in json.dumps(d1) for k in ("esp-general", "tea-nirvalab"))),
           f"registre : rejoué par un guest, la lecture ne lance rien et ne dit rien d'un Workspace ; sans session, 401 ({s1} {s0})")
    finally:
        for k, v in before.items():
            if v is None:
                config.CFG.pop(k, None)
            else:
                config.CFG[k] = v
