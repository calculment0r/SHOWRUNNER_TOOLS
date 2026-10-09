"""L'agent Showrunner : la politique de conversation, en code (docs/etudes/agent_autonome.md § 5.4, lot 1
au § 9). Des fonctions PURES : elles ne lisent ni la planche, ni la file, ni le modèle ; on leur donne ce
qu'il faut, elles rendent une décision. Le modèle ne choisit ni l'état ni la transition.

  decide(routage, conversation, registre, memoire, contexte) → l'action :
      noter · contradiction · repondre · hors_capacite · demander · choisir · plan · etape · geste
      (la première règle qui s'applique gagne, dans l'ordre du § 5.4)
  accuse(demande, pieces, contexte, travail) → l'accusé de réception (§ 5.2) : ce qui est reçu, où, ce qui va
      se passer et quand — dans la réponse de la route, en moins d'une seconde, sans modèle
  scenes_of(texte) → les scènes d'un scénario, par leurs en-têtes (§ 9.4) ; trouver_portee(scenes, portee)

« Juste par construction » : le nombre de questions vient des entrées qui manquent (0 à 3, jamais un
minimum) ; une capacité qui n'est pas prête ne peut pas être choisie (son état vient du registre) ; la
production n'existe qu'à la règle 8, derrière une validation écrite dans la conversation.
"""

from __future__ import annotations

import re
import unicodedata

MAX_QUESTIONS = 3        # § 3.1, règle 2 : 3 questions au plus par tour
MAX_CHOIX = 5
PORTEE_MAX = 16000       # § 9.4 : le texte de la portée, au plus ; au-delà, la question
ACTIONS = ("noter", "contradiction", "repondre", "hors_capacite", "demander", "choisir", "plan", "etape", "geste")
# les faits que comparent les critères des capacités (agent/capacites/*.json, `criteres[].si`) : un vocabulaire
# fermé, lu par le code — une faute de frappe dans une fiche est refusée au chargement, jamais ignorée en silence
FAITS = ("references", "sans_reference", "plusieurs_references", "image_citee", "video_citee", "son_cite", "element_cite",
         "document_cite", "commercial", "commercial_ue", "tout_ce_qui_bouge", "une_personne_parmi_plusieurs",
         "objet_immobile", "objet_et_ombres")
# ceux que dit la demande elle-même (le routeur, dans ses entrées, quand une skill les déclare) : aucun au lot 1
FAITS_DEMANDE = ("tout_ce_qui_bouge", "une_personne_parmi_plusieurs", "objet_immobile", "objet_et_ombres")
PRETS = ("branche", "factice")
SORTE_FR = {"document": ("document", "documents"), "image": ("image", "images"), "video": ("vidéo", "vidéos"),
            "audio": ("son", "sons"), "element": ("élément", "éléments"), "midi": ("clip MIDI", "clips MIDI"),
            "sequence": ("séquence", "séquences"), "playlist": ("playlist", "playlists")}
SUR = {"video": "sur une vidéo", "image": "sur une image", "audio": "sur un son", "document": "sur un document"}
NOMBRE = {1: "Une chose", 2: "Deux choses", 3: "Trois choses"}


def _cut(s, k: int) -> str:
    s = " ".join(str(s or "").split())
    return s if len(s) <= k else s[:k - 1] + "…"


def _et(parts: list) -> str:
    parts = [p for p in parts if p]
    return "" if not parts else parts[0] if len(parts) == 1 else ", ".join(parts[:-1]) + " et " + parts[-1]


# ── les faits du tour ────────────────────────────────────────
def faits(kinds: list, fiche: dict | None = None, entrees: dict | None = None) -> set:
    """Ce que le code sait du tour, dans le vocabulaire des critères : les sortes citées, la fiche du projet
    (commercial, UE), et ce que la demande dit d'elle-même quand une skill le déclare."""
    fiche, entrees = fiche or {}, entrees or {}
    refs = sum(1 for k in kinds if k in ("image", "element"))
    val = lambda k: (fiche.get(k) or {}).get("valeur") if isinstance(fiche.get(k), dict) else fiche.get(k)   # noqa: E731
    out = {"references"} if refs else {"sans_reference"}
    out |= {f for f, k in (("image_citee", "image"), ("video_citee", "video"), ("son_cite", "audio"), ("element_cite", "element"),
                           ("document_cite", "document")) if k in kinds}
    if refs >= 2:
        out.add("plusieurs_references")
    if val("commercial") is True:
        out.add("commercial")
        if val("ue") is True:
            out.add("commercial_ue")
    out |= {f for f in FAITS_DEMANDE if entrees.get(f) is True}
    return out


def _sortes(c: dict) -> set:
    out = set()
    for e in (c.get("entrees") or {}).values():
        if e.get("requis") and e.get("sorte"):
            out |= set(e["sorte"] if isinstance(e["sorte"], list) else [e["sorte"]])
    return out


def applicable(c: dict, kinds: list) -> bool:
    """Une capacité vaut pour ce qui est cité : rien de cité, ou elle ne prend que du texte, ou elle prend une des sortes citées."""
    s = _sortes(c)
    return not kinds or not s or bool(s & set(kinds))


def score(c: dict, f: set) -> tuple[float, str, str]:
    """(score, pourquoi du meilleur critère, pourquoi d'une exclusion) d'une capacité devant les faits."""
    pts, why, out = 0.0, "", ""
    best = -1e9
    for cr in c.get("criteres") or []:
        if cr.get("si") not in f:
            continue
        if cr.get("exclut"):
            out = out or cr.get("pourquoi", "")
            continue
        pts += float(cr.get("poids") or 0)
        if float(cr.get("poids") or 0) > best:
            best, why = float(cr.get("poids") or 0), cr.get("pourquoi", "")
    return pts, why, out


# ── les entrées, les questions ──────────────────────────────
def _choix(decl: dict, contexte: dict, k: str) -> tuple[list, list]:
    """Les choix d'une question et la valeur que dit chacun : `choix_de` (une liste du contexte : les scènes
    trouvées) ou `choix` (de la skill), alignés sur `valeurs` ; filtrés par ce que le contexte rend possible."""
    q = decl.get("question") or {}
    if q.get("choix_de"):
        got = [str(x) for x in contexte.get(q["choix_de"]) or []][:MAX_CHOIX]
        return got, got
    labels = [str(x) for x in q.get("choix") or []]
    vals = list(decl.get("valeurs") or []) if len(decl.get("valeurs") or []) == len(labels) else list(labels)
    possibles = (contexte.get("possibles") or {}).get(k)
    if possibles is not None:
        keep = [i for i, v in enumerate(vals) if v in possibles]
        labels, vals = [labels[i] for i in keep], [vals[i] for i in keep]
    return labels[:MAX_CHOIX], vals[:MAX_CHOIX]


def manquantes(decls: dict, entrees: dict, contexte: dict | None = None) -> list[str]:
    """Les entrées à demander, dans l'ordre déclaré : une requise qui manque ; une `si_long` qui manque quand le
    texte dépasse ce qu'un appel lit (`contexte.long`) ; une que le code n'a pas trouvée (`contexte.introuvables`)."""
    contexte = contexte or {}
    out = []
    for k, d in decls.items():
        if k in (contexte.get("introuvables") or ()):
            out.append(k)   # dite, mais pas trouvée par le code (une portée qui n'est pas dans le scénario)
        elif entrees.get(k) in (None, "", []) and (d.get("requis") or (d.get("si_long") and contexte.get("long"))):
            out.append(k)
    return out


def questions_pour(ks: list, decls: dict, contexte: dict | None = None, start: int = 1) -> list:
    """Les questions de ces entrées (3 au plus), chacune avec ses choix cliquables et la valeur de chaque choix."""
    contexte = contexte or {}
    out = []
    for k in ks[:MAX_QUESTIONS]:
        d = decls[k]
        q = d.get("question") or {}
        labels, vals = _choix(d, contexte, k)
        texte = q.get("texte") or f"{k} ?"
        if k in (contexte.get("introuvables") or ()) and contexte.get("pourquoi", {}).get(k):
            texte = f"{contexte['pourquoi'][k]} {texte}"
        out.append({"id": f"q{start + len(out)}", "entree": k, "question": texte, "choix": labels, "valeurs": vals,
                    "plusieurs": False})
    return out


def valeur_reponse(decl: dict, q: dict, choix: list, autre: str = ""):
    """La valeur d'une entrée d'après la réponse cliquée (la valeur du choix) ou écrite (« autre ») : un entier
    lu dans le texte, une valeur d'enum reconnue ; None si la réponse ne dit rien de lisible (la question revient)."""
    vals = q.get("valeurs") or []
    labels = q.get("choix") or []
    for c in choix:
        if c in labels:
            v = vals[labels.index(c)] if labels.index(c) < len(vals) else c
            return _type(decl, v)
    autre = str(autre or "").strip()
    if not autre:
        return None
    if decl.get("type") == "enum":
        fold = _plat(autre)
        for v, lab in zip(decl.get("valeurs") or [], (decl.get("question") or {}).get("choix") or decl.get("valeurs") or []):
            if fold in (_plat(v), _plat(lab)):
                return v
        return None
    return _type(decl, autre)


def _type(decl: dict, v):
    if decl.get("type") == "entier":
        m = re.search(r"\d+", str(v))
        if not m:
            return None   # « selon le texte » : le modèle décide (aucun nombre)
        n = int(m.group(0))
        return max(int(decl.get("min", n)), min(int(decl.get("max", n)), n))
    if decl.get("type") == "enum":
        return v if v in (decl.get("valeurs") or []) else None
    return _cut(v, 400) or None


def defauts(decls: dict, entrees: dict, fiche: dict | None = None) -> dict:
    """Les entrées non requises qu'on ne demande pas : celle que la fiche du projet dit (`defaut_de: fiche.x`),
    sinon la première valeur déclarée."""
    fiche = fiche or {}
    out = dict(entrees)
    for k, d in decls.items():
        if out.get(k) not in (None, ""):
            continue
        src = str(d.get("defaut_de") or "")
        f = fiche.get(src.split(".", 1)[1]) if src.startswith("fiche.") else None
        v = f.get("valeur") if isinstance(f, dict) else f
        if v is not None and (d.get("type") != "enum" or v in (d.get("valeurs") or [])):
            out[k] = v
        elif not d.get("requis") and not d.get("question") and d.get("type") == "enum":
            out[k] = d["valeurs"][0]
    return out


# ── la politique ─────────────────────────────────────────────
def _intention(reg: dict, iid: str) -> dict:
    return next((i for i in reg["intentions"] if i["id"] == iid), None) or next(i for i in reg["intentions"] if i["id"] == "autre")


def _court(c: dict) -> dict:
    return {"id": c["id"], "label": c["label"], "outil": c.get("outil"), "etat": c.get("etat"), "pourquoi": c.get("pourquoi", ""),
            **({"telechargements": c["telechargements"]} if c.get("telechargements") else {}),
            **({"licence": c["licence"]} if c.get("licence") else {})}


def hors_capacite(intent: dict, reg: dict, kinds: list, applicables: list, exclues: list, skill_absente: bool) -> dict:
    """Ce qu'on ne sait pas faire, dit par le code : ce qui manque (le pourquoi de chaque capacité), ce que le
    portail fait déjà ailleurs (une skill à venir), l'approchant prêt de la même intention (une autre sorte en
    entrée : nettoyer une image fixe au lieu de la vidéo) ou ceux que l'intention nomme."""
    caps = [c for c in reg["capacites"] if intent["id"] in c["intentions"]]
    pretes = [c for c in applicables if c.get("etat") in PRETS and c not in [x for x, _ in exclues]]
    manque = [c for c in applicables if c.get("etat") not in PRETS]
    approchant = [c for c in caps if c not in applicables and c.get("etat") in PRETS]
    approchant += [c for c in reg["capacites"] if c["id"] in (intent.get("approchants") or []) and c not in approchant]
    sur = next((SUR[k] for k in ("video", "image", "audio", "document") if k in kinds), "")
    bits = []
    if not caps:
        bits.append("Ce n'est pas dans le portail : je ne peux pas le faire d'ici.")
    elif skill_absente:
        bits.append(f"Je ne sais pas encore le faire depuis la conversation : la skill « {intent['skill']} » arrive avec le "
                    f"lot {intent.get('a_venir')} (docs/etudes/agent_autonome.md § 8).")
        if pretes:
            bits.append("Le portail le fait déjà : " + _et([f"{c['label']} (outil {c['outil']})" for c in pretes[:4]]) + ".")
        if manque:
            bits.append(f"Pas encore prêt ici{' ' + sur if sur else ''} : "
                        + "; ".join(f"{c['label']} — {_cut(c.get('pourquoi'), 120)}" for c in manque[:3]) + ".")
    else:
        bits.append(f"Je ne sais pas encore le faire {sur + ' ' if sur else ''}ici : "
                    + "; ".join(f"{c['label']} — {_cut(c.get('pourquoi'), 120)}" for c in manque[:3]) + ".")
    for c, why in exclues[:2]:
        bits.append(f"{c['label']} est écarté : {why}.")
    if approchant:
        bits.append(("Ce que le portail sait en sortir : " if not caps else "Je peux : ")
                    + _et([f"{c['label']}" for c in approchant[:3]]) + ".")
    return {"action": "hors_capacite", "regle": 4, "intention": intent["id"], "texte": " ".join(bits),
            "manque": [_court(c) for c in manque], "outils": [_court(c) for c in pretes] if skill_absente else [],
            "exclues": [{**_court(c), "pourquoi": why} for c, why in exclues], "approchant": [_court(c) for c in approchant]}


def liste_capacites(reg: dict) -> dict:
    """« Ce que je sais faire » : pour chaque intention, ses capacités prêtes, et ce qui ne l'est pas encore (code, sans modèle)."""
    lignes, pas = [], []
    for i in reg["intentions"]:
        caps = [c for c in reg["capacites"] if i["id"] in c["intentions"]]
        ok_ = [c["label"] for c in caps if c.get("etat") in PRETS]
        if ok_ and i["id"] not in ("aide.capacites", "autre"):
            lignes.append(f"- {i['label']} : {_et(ok_[:4])}" + (" (dans son outil : ma skill arrive au lot "
                                                                  f"{i['a_venir']})" if i.get("a_venir") else ""))
        pas += [f"{c['label']} ({c['etat']})" for c in caps if c.get("etat") not in PRETS and f"{c['label']} ({c['etat']})" not in pas]
    texte = "Ce que je sais faire ici :\n" + "\n".join(lignes)
    if pas:
        texte += "\nPas encore : " + _et(pas[:8]) + "."
    return {"texte": texte, "capacites": [_court(c) for c in reg["capacites"]]}


def decide(routage: dict, conversation: dict, registre: dict, memoire: dict, contexte: dict | None = None) -> dict:
    """La décision d'un tour (§ 5.4). `routage` : {intention, clarte, entrees, cible, resume, kinds (les sortes citées),
    reponses? (une carte cliquée : [{entree, valeur, texte}]), bouton? ({etape, consent?, refaire?})} ; `conversation` :
    {etat, plan: {skill, etat: propose|valide|pose|lance}} ; `registre` : celui d'agent_registre (chaque capacité avec son
    état) ; `memoire` : {fiche: {clé: {valeur, …}}, decisions} ; `contexte` : ce que le code a trouvé (scenes, long,
    introuvables, possibles, pourquoi)."""
    contexte = contexte or {}
    conversation = conversation or {}
    fiche = dict((memoire or {}).get("fiche") or {})
    intent = _intention(registre, routage.get("intention") or "autre")
    sk = registre["skills"].get(intent["skill"]) if not intent.get("a_venir") else None
    meta = (sk or {}).get("meta") or {}
    decls = meta.get("entrees") or {}
    entrees = {k: v for k, v in (routage.get("entrees") or {}).items() if v not in (None, "", [])}
    kinds = list(routage.get("kinds") or [])
    bouton = routage.get("bouton") or {}
    etapes = [e["id"] for e in meta.get("etapes") or []]

    # 1. une carte cliquée : les réponses au carnet (et à la fiche), puis on reprend
    if routage.get("reponses"):
        notes, maj = [], {}
        for r in routage["reponses"]:
            notes.append(r.get("texte") or f"{r.get('entree')} : {r.get('valeur')}")
            if r.get("valeur") is not None and r.get("entree"):
                entrees[r["entree"]] = r["valeur"]
                src = str((decls.get(r["entree"]) or {}).get("defaut_de") or "")
                if src.startswith("fiche."):
                    maj[src.split(".", 1)[1]] = r["valeur"]
        fiche.update({k: {"valeur": v} for k, v in maj.items()})
        puis = decide({**routage, "entrees": entrees, "reponses": None, "confirme": True}, conversation, registre,
                      {**(memoire or {}), "fiche": fiche}, contexte)
        return {"action": "noter", "regle": 1, "intention": intent["id"], "notes": notes, "fiche": maj, "puis": puis}

    # 8 (d'abord pour un bouton d'une étape après la première : les entrées sont réglées, le découpage validé)
    if bouton.get("etape") and etapes and bouton["etape"] != etapes[0]:
        return _etape(intent, meta, bouton, conversation)

    # 2. une entrée connue contredit la fiche du projet
    if not routage.get("confirme"):
        for k, v in entrees.items():
            src = str((decls.get(k) or {}).get("defaut_de") or "")
            old = fiche.get(src.split(".", 1)[1]) if src.startswith("fiche.") else None
            old = old.get("valeur") if isinstance(old, dict) else old
            if old is not None and old != v:
                lab = (decls[k].get("question") or {}).get("texte") or k
                return {"action": "contradiction", "regle": 2, "intention": intent["id"], "entree": k,
                        "texte": f"La fiche du projet dit « {old} » ; tu demandes « {v} ».",
                        "questions": [{"id": "q1", "entree": k, "question": f"{lab.rstrip(' ?')} : « {v} » ou « {old} » ? Lequel tient ?",
                                       "choix": [f"{v}, je change", f"{old}, je garde"], "valeurs": [v, old], "plusieurs": False}],
                        "entrees": entrees}

    # 3. ce que je sais faire : la liste du registre, sans modèle
    if intent["id"] == "aide.capacites":
        return {"action": "repondre", "regle": 3, "intention": intent["id"], **liste_capacites(registre)}

    # 4. aucune capacité prête pour ce qui est cité (ou la skill n'est pas encore écrite)
    f = faits(kinds, fiche, entrees)
    caps = [c for c in registre["capacites"] if intent["id"] in c["intentions"]]
    applicables = [c for c in caps if applicable(c, kinds)]
    exclues = [(c, score(c, f)[2]) for c in applicables if score(c, f)[2]]
    pretes = [c for c in applicables if c.get("etat") in PRETS and c not in [x for x, _ in exclues]]
    if not pretes or sk is None:
        return hors_capacite(intent, registre, kinds, applicables, exclues, sk is None and bool(caps))

    # 5. une entrée requise manque : les questions de la skill, 3 au plus, dans l'ordre déclaré
    entrees = defauts(decls, entrees, fiche)
    ks = manquantes(decls, entrees, contexte)
    if ks:
        qs = questions_pour(ks, decls, contexte)
        return {"action": "demander", "regle": 5, "intention": intent["id"], "skill": sk["id"], "entrees": entrees,
                "texte": f"{NOMBRE.get(len(qs), str(len(qs)) + ' choses')} avant de commencer.", "questions": qs}

    # 6. plusieurs capacités prêtes, et leurs critères ne départagent pas : la personne choisit — quand la skill LANCE le
    # workflow (une étape `travaux`). Une skill qui ne fait que des gestes (conversation : une carte prête, que la
    # personne règle et lance) n'a pas de workflow à engager : la meilleure est gardée pour mémoire, sans question.
    scored = sorted(((score(c, f)[0], -k, c) for k, c in enumerate(pretes)), key=lambda x: (x[0], x[1]), reverse=True)
    top = scored[0][2]
    lance = any(e.get("sorte") == "travaux" for e in meta.get("etapes") or [])
    if routage.get("capacite") and any(c["id"] == routage["capacite"] for c in pretes):
        top = next(c for c in pretes if c["id"] == routage["capacite"])
    elif lance and len(scored) > 1 and scored[0][0] == scored[1][0]:
        tied = [c for s, _, c in scored if s == scored[0][0]]
        return {"action": "choisir", "regle": 6, "intention": intent["id"], "skill": sk["id"], "entrees": entrees,
                "texte": f"Plusieurs workflows conviennent ; je recommande {tied[0]['label']}"
                         + (f" : {score(tied[0], f)[1]}." if score(tied[0], f)[1] else "."),
                "candidats": [{**_court(c), "recommandee": c is tied[0], "pourquoi_choix": score(c, f)[1]} for c in tied]}
    why = score(top, f)[1]

    # 7. une skill qui produit (des travaux) ou pose beaucoup passe par sa validation : le découpage EST le plan
    if any(e.get("sorte") in ("validation", "travaux") for e in meta.get("etapes") or []):
        return {"action": "plan", "regle": 7, "intention": intent["id"], "skill": sk["id"], "etape": etapes[0],
                "capacite": top["id"], "pourquoi": why, "entrees": entrees,
                **({"refaire": bouton.get("refaire")} if bouton.get("refaire") is not None else {})}

    # 9. petit, réversible : la skill de conversation, ses outils (ceux de l'intention), quelques gestes
    outils = (meta.get("outils_selon_intention") or {}).get(intent["id"], meta.get("outils") or [])
    boucle = next((e for e in meta.get("etapes") or [] if e.get("sorte") == "boucle"), {})
    return {"action": "geste", "regle": 9, "intention": intent["id"], "skill": sk["id"], "outils": list(outils),
            "max_gestes": int(boucle.get("max_gestes") or 3), "max_appels": int(boucle.get("max_appels") or 12),
            "capacite": top["id"], "pourquoi": why, "entrees": entrees}


def _etape(intent: dict, meta: dict, bouton: dict, conversation: dict) -> dict:
    """Règle 8 : une étape d'un plan validé, dans l'ordre, sur un clic. Les travaux (un rendu) seulement avec le consentement."""
    plan = conversation.get("plan") or {}
    et = next((e for e in meta.get("etapes") or [] if e["id"] == bouton["etape"]), None)
    attendu = {"planche": ("valide",), "cartes": ("valide",), "images": ("pose",)}   # l'état du plan que chaque étape suppose
    why = ""
    if not et:
        why = f"l'étape « {bouton['etape']} » n'est pas dans la skill"
    elif plan.get("etat") not in attendu.get(et["id"], ("valide", "pose")):
        why = {"propose": "le découpage n'est pas encore validé", "valide": "la planche n'est pas posée (défaite ?)",
               "pose": "la planche est déjà posée", "lance": "les images sont déjà lancées",
               None: "aucun plan validé"}.get(plan.get("etat"), "le plan n'en est pas là")
    elif et.get("consentement") and bouton.get("consent") != et["consentement"]:
        why = "un rendu ne part qu'avec ton accord (le bouton qui dit son coût)"
    if why:
        return {"action": "repondre", "regle": 8, "intention": intent["id"], "refus": True, "texte": f"Pas maintenant : {why}."}
    return {"action": "etape", "regle": 8, "intention": intent["id"], "skill": meta.get("id"), "etape": et["id"]}


# ── l'accusé de réception ────────────────────────────────────
def _duree(s) -> str:
    s = int(round(float(s or 0)))
    return f"{s} s" if s < 90 else f"{round(s / 60)} min"


def _piece(p: dict) -> str:
    k = p.get("kind")
    if k == "document":
        d = p.get("doc") or {}
        unit = str(d.get("unit") or "pages")
        bits = [str(d.get("label") or d.get("format") or "").strip(),
                f"{d['pages']} {unit[:-1] if d.get('pages') == 1 and unit.endswith('s') else unit}" if d.get("pages") else ""]
        return " (" + ", ".join(b for b in bits if b) + ")" if any(bits) else ""
    if k in ("video", "audio") and p.get("duration"):
        return f" ({float(p['duration']):.1f} s)".replace(".", ",")
    return ""


def accuse(demande: str, pieces: list, contexte: dict, travail: dict | None) -> dict:
    """L'accusé (§ 3.1, règle 1 ; § 5.2) : ce qui est reçu (les pièces comptées par sorte), où (l'outil, la planche,
    les objets de la planche cités), ce qui va se passer (`contexte.suite`) et quand (la place dans la file, ce
    qui occupe la machine) — par le code, dans la réponse de la route."""
    by: dict = {}
    for p in pieces or []:
        by.setdefault(p.get("kind") if p.get("kind") in SORTE_FR else "planche", []).append(p)
    parts = []
    for k in [k for k in SORTE_FR if by.get(k)]:
        n = len(by[k])
        parts.append(f"{n} {SORTE_FR[k][n > 1]}" + (_piece(by[k][0]) if n == 1 else ""))
    if by.get("planche"):
        n = len(by["planche"])
        parts.append(f"{n} objet{'s' if n > 1 else ''} de la planche")
    texte = ("Reçu : " + _et(parts) + "." if parts else "Reçu.") + (f" {contexte['suite']}" if contexte.get("suite") else "")
    t = travail or {}
    fil = {k: t.get(k) for k in ("state", "position", "ahead", "eta_s", "message")}
    if t.get("state") == "queued":
        msg = str(t.get("message") or "")
        if t.get("ahead"):
            texte += f" En file : {t['ahead']} devant" + (f", départ ≈ {_duree(t['eta_s'])}" if t.get("eta_s") else "") + "."
        elif msg.startswith("attend") or "calcule" in msg:
            texte += f" {msg[0].upper()}{msg[1:]}" + ("" if msg.endswith(".") else ".")
    return {"texte": texte, "recu": {k: len(v) for k, v in by.items()}, "contexte": {k: v for k, v in contexte.items() if k != "suite"},
            "file": fil}


# ── les scènes d'un scénario (§ 9.4) ─────────────────────────
# Fountain (fountain.io, « Scene Headings ») : une ligne qui commence par INT, EXT, EST, INT./EXT, INT/EXT ou I/E, suivi
# d'un point ou d'une espace ; forcée par un point en tête ; un numéro de scène entre dièses à la fin (#3#). Les scénarios
# français : « SÉQ. 3 », « SÉQUENCE 3 », « SCÈNE 3 », et les en-têtes numérotés (« 3. EXT. QUAI — NUIT »).
_HEAD = re.compile(r"^\s*(?:(?P<num>\d{1,4}[A-Z]?)\s*[.\-–—)]\s*)?(?P<h>(?:INT\.?\s*/\s*EXT|EXT\.?\s*/\s*INT|INT|EXT|EST|I/E|E/I)(?:\.|\s)\s*\S.*)$", re.I)
_SEQ = re.compile(r"^\s*(?P<h>(?:S[ÉE]Q(?:UENCE)?\.?|SC[ÈE]NE|SC\.)\s*(?P<num>\d{1,4}[A-Z]?)\b.*)$", re.I)
_FORCED = re.compile(r"^\.(?=[^.\s])(?P<h>.+)$")
_FNUM = re.compile(r"\s*#(?P<num>[\w.\-]+)#\s*$")
_VIDES = {"le", "la", "les", "l", "de", "du", "des", "d", "un", "une", "sequence", "scene", "seq", "sc", "et", "a", "au", "aux", "en", "the", "of"}


def _plat(s) -> str:
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode().casefold()
    return " ".join(re.sub(r"[^a-z0-9]+", " ", s).split())


def scenes_of(texte: str) -> list[dict]:
    """Les scènes d'un scénario, dans l'ordre : {n (le numéro écrit ; le rang si aucune n'en a), titre (l'en-tête), debut, fin
    (en signes), texte}. Le texte d'avant le premier en-tête (une page de titre) n'est pas une scène. Sans
    aucun en-tête : []."""
    lines = (texte or "").splitlines(keepends=True)
    heads = []
    pos = 0
    for ln in lines:
        raw = ln.rstrip("\r\n")
        s = raw.strip()
        if s and len(s) <= 120:
            m = _FORCED.match(s) or _SEQ.match(s) or _HEAD.match(s)
            if m:
                h = m.group("h").strip()
                fn = _FNUM.search(h)
                num = (fn.group("num") if fn else None) or (m.groupdict().get("num") if m.re is not _FORCED else None)
                heads.append((pos, _FNUM.sub("", h).strip(), num))
        pos += len(ln)
    # des numéros écrits (#3#, « 3. EXT. », « SÉQUENCE 3 ») : ce sont eux qui nomment ; une scène sans numéro n'en prend
    # pas un au hasard (son rang la confondrait avec une autre). Aucun numéro écrit : le rang.
    ecrits = any(num for _, _, num in heads)
    out = []
    for k, (start, titre, num) in enumerate(heads):
        end = heads[k + 1][0] if k + 1 < len(heads) else len(texte)
        out.append({"n": str(num).upper() if num else ("" if ecrits else str(k + 1)), "rang": k + 1, "titre": titre,
                    "debut": start, "fin": end, "texte": texte[start:end].strip()})
    return out


def trouver_portee(scenes: list, portee: str) -> int | None:
    """L'indice de la scène que nomme `portee` : son titre exact (un choix de la question), son numéro (« séquence 3 »,
    « scène 3 », « 3 »), ou les mots de son titre (« le quai ») quand une seule scène les a tous ; None sinon."""
    p = str(portee or "").strip()
    if not p or not scenes:
        return None
    for i, s in enumerate(scenes):
        if s["titre"] == p or _plat(s["titre"]) == _plat(p):
            return i
    m = re.fullmatch(r"(?:s[ée]q(?:uence)?\.?|sc[èe]ne|sc\.|plan)?\s*(?:n[°o]\s*)?(\d{1,4}[A-Za-z]?)", p.strip(), re.I)
    if m:
        hits = [i for i, s in enumerate(scenes) if s["n"] == m.group(1).upper()]
        return hits[0] if len(hits) == 1 else None
    mots = [w for w in _plat(p).split() if w not in _VIDES and len(w) > 1]
    if not mots:
        return None
    hits = [i for i, s in enumerate(scenes) if all(w in _plat(s["titre"]).split() for w in mots)]
    return hits[0] if len(hits) == 1 else None


# ── le contrôle (tools/check.py) : des tables ────────────────
def selftest(call, ok) -> None:
    import copy
    from tools import agent_registre as ar
    reg = ar.registre(0)
    sb = ar.skill("storyboard")
    base = {"intention": "storyboard.creer", "clarte": "precise", "cible": [], "resume": ""}
    full = {"source": "doc-x", "rendu": "photoreal"}
    pv = {"plan": {"skill": "storyboard", "etat": "valide"}}

    def d(rt, conv=None, mem=None, ctx=None, r=None):
        return decide({**base, **rt}, conv or {}, r or reg, mem or {}, ctx)

    # la table du § 5.4 : un routage et un état donnés → l'action attendue (la première règle qui s'applique gagne)
    rows = [
        ("1 · une carte cliquée → noter, puis reprendre", d({"entrees": {"source": "doc-x"},
                                                              "reponses": [{"entree": "rendu", "valeur": "crayonne", "texte": "Les cases ? → crayonné"}]}),
         lambda a: a["action"] == "noter" and a["notes"] == ["Les cases ? → crayonné"] and a["puis"]["action"] == "plan"
         and a["puis"]["entrees"]["rendu"] == "crayonne"),
        ("2 · une entrée contredit la fiche → contradiction", d({"entrees": {**full, "format": "9:16"}}, mem={"fiche": {"format": {"valeur": "16:9"}}}),
         lambda a: a["action"] == "contradiction" and a["questions"][0]["valeurs"] == ["9:16", "16:9"] and "16:9" in a["texte"]),
        ("3 · aide.capacites → la liste du registre, sans modèle", d({"intention": "aide.capacites"}),
         lambda a: a["action"] == "repondre" and a["regle"] == 3 and "Un storyboard" in a["texte"] and "Pas encore" in a["texte"]),
        ("4 · aucune capacité prête → hors_capacite", d({"intention": "vfx.retirer", "kinds": ["video"]}),
         lambda a: a["action"] == "hors_capacite" and any(c["id"] == "image.consigne" for c in a["approchant"])),
        ("4 · autre → pas dans le portail, les approchants de l'intention", d({"intention": "autre"}),
         lambda a: a["action"] == "hors_capacite" and "pas dans le portail" in a["texte"] and len(a["approchant"]) == 3),
        ("5 · une entrée requise manque → demander", d({"entrees": {"source": "doc-x"}}),
         lambda a: a["action"] == "demander" and [q["entree"] for q in a["questions"]] == ["rendu"]
         and a["questions"][0]["valeurs"] == ["crayonne", "photoreal"]),
        ("7 · le storyboard pose beaucoup → plan (le découpage à valider)", d({"entrees": full}),
         lambda a: a["action"] == "plan" and a["etape"] == "decoupage" and a["entrees"]["format"] == "16:9"),
        ("8 · découpage validé, clic → l'étape planche", d({"entrees": full, "bouton": {"etape": "planche"}}, conv=pv),
         lambda a: a["action"] == "etape" and a["etape"] == "planche"),
        ("8 · les images sans consentement → refusé", d({"entrees": full, "bouton": {"etape": "images"}},
                                                        conv={"plan": {"skill": "storyboard", "etat": "pose"}}),
         lambda a: a["action"] == "repondre" and a.get("refus") and "accord" in a["texte"]),
        ("8 · les images avec le consentement → l'étape images", d({"entrees": full, "bouton": {"etape": "images", "consent": "images"}},
                                                                    conv={"plan": {"skill": "storyboard", "etat": "pose"}}),
         lambda a: a["action"] == "etape" and a["etape"] == "images"),
        ("8 · la planche avant la validation → refusé", d({"entrees": full, "bouton": {"etape": "planche"}},
                                                          conv={"plan": {"skill": "storyboard", "etat": "propose"}}),
         lambda a: a["action"] == "repondre" and "pas encore validé" in a["texte"]),
        ("9 · petit, réversible → geste, les outils de l'intention", d({"intention": "planche.retoucher"}),
         lambda a: a["action"] == "geste" and a["max_gestes"] == 3 and "ranger" in a["outils"] and "carte_image" not in a["outils"]),
        ("9 · une image dans ce style → geste avec la carte", d({"intention": "image.creer", "kinds": ["image"]}),
         lambda a: a["action"] == "geste" and "carte_image" in a["outils"] and a["capacite"] == "image.generer.krea2"),
    ]
    for name, a, test in rows:
        ok(test(a), f"politique : règle {name} ({ {k: a.get(k) for k in ('action', 'regle', 'texte')} })")
    # la règle 6 : deux capacités prêtes, à égalité → choisir, avec la recommandation (un registre d'essai)
    r6 = copy.deepcopy(reg)
    for c in r6["capacites"]:
        if c["id"] in ("vfx.retirer_objet.void", "vfx.retirer_objet.h3_inpaint", "vfx.retirer_personne.ltx", "vfx.retirer_personne.h3"):
            c["etat"] = "branche"
    for i in r6["intentions"]:
        if i["id"] == "vfx.retirer":
            i.pop("a_venir", None)
    for i in r6["intentions"]:
        if i["id"] == "vfx.retirer":
            i["skill"] = "vfx"
    r6["skills"]["vfx"] = {"id": "vfx", "meta": {"id": "vfx", "intentions": ["vfx.retirer"], "entrees": {},   # la skill du lot 6, en essai
                                                 "etapes": [{"id": "choix", "sorte": "validation"}, {"id": "rendu", "sorte": "travaux"}]}}
    obj = d({"intention": "vfx.retirer", "kinds": ["video"], "entrees": {"objet_immobile": True}}, r=r6)
    ok(obj["action"] == "choisir" and {c["id"] for c in obj["candidats"]} == {"vfx.retirer_objet.void", "vfx.retirer_objet.h3_inpaint"}
       and obj["candidats"][0]["recommandee"] and "recommande" in obj["texte"],
       f"politique : règle 6 · deux workflows à égalité → choisir, la recommandée et pourquoi ({obj.get('action')} {obj.get('texte')})")
    # la règle du § 3.3 dans ses six branches (le même registre d'essai : les voies de la vidéo supposées installées)
    branches = [
        ("une image citée → Image, Consigne", {"kinds": ["image"]}, {}, "image.consigne"),
        ("une vidéo, tout ce qui bouge → LTX Clean-Plate", {"kinds": ["video"], "entrees": {"tout_ce_qui_bouge": True}}, {}, "vfx.retirer_personne.ltx"),
        ("une vidéo, une personne parmi d'autres → H3 Person Remover", {"kinds": ["video"], "entrees": {"une_personne_parmi_plusieurs": True}}, {},
         "vfx.retirer_personne.h3"),
        ("un objet et ses ombres → VOID", {"kinds": ["video"], "entrees": {"objet_immobile": True, "objet_et_ombres": True}}, {}, "vfx.retirer_objet.void"),
    ]
    for name, rt, mem, want in branches:
        a = d({"intention": "vfx.retirer", **rt}, mem=mem, r=r6)
        ok(a["action"] == "plan" and a["capacite"] == want, f"politique : § 3.3 · {name} ({a.get('action')} {a.get('capacite')} {a.get('texte')})")
    ue = d({"intention": "vfx.retirer", "kinds": ["video"], "entrees": {"une_personne_parmi_plusieurs": True}},
           mem={"fiche": {"commercial": {"valeur": True}, "ue": {"valeur": True}}}, r=r6)
    ok(ue["action"] == "plan" and ue["capacite"] != "vfx.retirer_personne.h3",
       f"politique : § 3.3 · un projet commercial dans l'UE → H3 écarté ({ue.get('capacite')})")
    r6b = copy.deepcopy(r6)
    for c in r6b["capacites"]:
        if c["id"].startswith("vfx.") and c["id"] != "vfx.retirer_personne.h3":
            c["etat"] = "installable"
    ue2 = d({"intention": "vfx.retirer", "kinds": ["video"], "entrees": {"une_personne_parmi_plusieurs": True}},
            mem={"fiche": {"commercial": {"valeur": True}, "ue": {"valeur": True}}}, r=r6b)
    ok(ue2["action"] == "hors_capacite" and any(c["id"] == "vfx.retirer_personne.h3" for c in ue2["exclues"]) and "écarté" in ue2["texte"],
       f"politique : § 3.3 · H3 seul installé et le projet dans l'UE → écarté, en le disant ({ue2.get('texte')})")
    rien = d({"intention": "vfx.retirer", "kinds": ["video"]})
    ok(rien["action"] == "hors_capacite" and "image.consigne" in [c["id"] for c in rien["approchant"]]
       and any(c["id"] == "vfx.retirer_personne.ltx" and c.get("telechargements") for c in rien["manque"])
       and "lot 6" in rien["texte"],
       f"politique : § 3.3 · rien d'installé (aujourd'hui) → je ne sais pas encore, ce qui manque, l'approchant : une image fixe ({rien.get('texte')})")
    # les questions = les entrées manquantes, 3 au plus, 0 si rien ne manque
    q0 = d({"entrees": full})
    q2 = d({"entrees": {}}, ctx={"possibles": {"source": ["demande"]}})
    q3 = d({"entrees": {}}, ctx={"long": True, "scenes": ["EXT. QUAI — NUIT", "INT. BAR — NUIT"], "possibles": {"source": ["brief", "demande"]}})
    qp = d({"entrees": {"source": "doc-x", "rendu": "crayonne", "portee": "séquence 9"}},
           ctx={"introuvables": ["portee"], "scenes": ["EXT. QUAI — NUIT"], "pourquoi": {"portee": "« séquence 9 » n'est pas dans le scénario."}})
    ok(q0["action"] == "plan" and q2["action"] == "demander" and [q["entree"] for q in q2["questions"]] == ["source", "rendu"]
       and q2["questions"][0]["choix"] == ["je décris la scène"] and len(q3["questions"]) == 3
       and [q["entree"] for q in q3["questions"]] == ["source", "portee", "rendu"] and q3["questions"][1]["choix"] == ["EXT. QUAI — NUIT", "INT. BAR — NUIT"]
       and qp["action"] == "demander" and qp["questions"][0]["entree"] == "portee" and "séquence 9" in qp["questions"][0]["question"],
       f"politique : les questions viennent des entrées qui manquent (0, 2, 3 au plus ; une portée introuvable : ses scènes en choix) "
       f"({q0['action']} {[q['entree'] for q in q2.get('questions', [])]} {[q['entree'] for q in q3.get('questions', [])]})")
    decl = sb["meta"]["entrees"]
    ok(valeur_reponse(decl["rendu"], q2["questions"][1], ["photoréaliste"]) == "photoreal"
       and valeur_reponse(decl["plans"], {"choix": ["6", "selon le texte"], "valeurs": ["6", "selon le texte"]}, ["selon le texte"]) is None
       and valeur_reponse(decl["plans"], {"choix": []}, [], "une dizaine, 10") == 10
       and valeur_reponse(decl["rendu"], {"choix": []}, [], "Crayonné") == "crayonne",
       "politique : une réponse cliquée ou écrite devient la valeur de l'entrée (le choix, un nombre lu, un enum reconnu)")
    # l'accusé
    a1 = accuse("fais le storyboard", [{"kind": "document", "title": "Quai", "doc": {"label": "Fountain", "pages": 96}}],
                {"outil": "Idéation", "planche": "Clip", "suite": "Je regarde ce que tu veux faire."},
                {"state": "queued", "ahead": 2, "eta_s": 70, "message": "en file · 2 devant"})
    a2 = accuse("x", [], {"suite": "Je regarde."}, {"state": "queued", "ahead": 0, "message": "attend : DGX2 calcule « Image » (ComfyUI :8188)"})
    a3 = accuse("x", [{"kind": "video", "duration": 8}, {"kind": "image"}, {"kind": "image"}, {"kind": "note"}], {}, {"state": "running"})
    ok(a1["texte"] == "Reçu : 1 document (Fountain, 96 pages). Je regarde ce que tu veux faire. En file : 2 devant, départ ≈ 70 s."
       and a2["texte"].startswith("Reçu. Je regarde. Attend : DGX2 calcule") and a3["texte"] == "Reçu : 2 images, 1 vidéo (8,0 s) et 1 objet de la planche."
       and a1["recu"] == {"document": 1} and a1["contexte"]["planche"] == "Clip",
       f"politique : l'accusé dit ce qui est reçu, où, et la file ({a1['texte']!r} {a2['texte']!r} {a3['texte']!r})")
    # les scènes : un Fountain, un scénario français, un texte sans en-tête
    fountain = ("Title: Le quai\nAuthor: X\n\nINT. BAR - NUIT\n\nLina boit.\n\nEXT. QUAI — NUIT #3#\n\nLa pluie.\n\nLINA\nOn y va.\n\n"
                ".FLASHBACK\n\nUn souvenir.\n\nINT./EXT. VOITURE - JOUR\n\nIls roulent.")
    sc = scenes_of(fountain)
    fr = scenes_of("SÉQUENCE 1 — L'arrivée\nLe train entre en gare.\n\n2. EXT. QUAI — NUIT\nLina attend.\n\nSéq. 3 - Le bar\nIls parlent.\n")
    ok([s["titre"] for s in sc] == ["INT. BAR - NUIT", "EXT. QUAI — NUIT", "FLASHBACK", "INT./EXT. VOITURE - JOUR"] and sc[1]["n"] == "3"
       and sc[0]["n"] == "" and sc[0]["rang"] == 1 and "Lina boit" in sc[0]["texte"] and "Title" not in sc[0]["texte"] and "On y va" in sc[1]["texte"]
       and [s["n"] for s in fr] == ["1", "2", "3"] and fr[1]["titre"] == "EXT. QUAI — NUIT" and "Lina attend" in fr[1]["texte"]
       and scenes_of("Un homme marche sous la pluie. Il entre dans un bar.") == [],
       f"politique : scenes_of lit un Fountain (forcée, #n#, INT./EXT.), un scénario français (SÉQUENCE, numéroté), rien sans en-tête "
       f"({[(s['n'], s['titre']) for s in sc]} {[(s['n'], s['titre']) for s in fr]})")
    ok(trouver_portee(sc, "séquence 3") == 1 and trouver_portee(sc, "le quai") == 1 and trouver_portee(sc, "EXT. QUAI — NUIT") == 1
       and trouver_portee(fr, "3") == 2 and trouver_portee(sc, "nuit") is None and trouver_portee(sc, "séquence 9") is None,
       "politique : la portée trouvée par son numéro, son titre, ses mots ; ambiguë ou absente : None (la question)")
