"""Vidéo : ce que H3 reçoit, et la mise en forme de l'invite (Cal, 09/10/2026).

Cal, verbatim : « regarde par exemple mon dernier essai vidéo avec ce prompt : "il mange des @element1 et @element2
se dispute en francais, il en viennent aux main , cinema d'action". Mon output est complètement nul, on dirait qu'il
ne comprend vraiment pas ce que je veux… il n'a même pas vraiment utilisé les character sheets je pense. »

L'audit (docs/etudes/movie.md, « Fait le 09/10 — l'audit des références ») : H3 reçoit ce texte français presque tel
quel, alors que ses guides officiels (MiniMax-AI/MiniMax-H3, skills/h3-prompt-writing : SKILL.md, references/base-en
et ref-en) demandent l'anglais pour tout, sauf les répliques dans `<d>[French] …</d>` ; une description de 350 à 500
mots, plan par plan (composition, sujets, lieu et lumière, actions, caméra, son) ; des plans `[Shot 2] At 00:03.500,` ;
des répliques écrites mot pour mot avec leur locuteur `(S1)`. Et le README d'H3 : son pipeline officiel passe par
« H3-Context-IR », un réécrivain que la version ouverte n'inclut pas — « we strongly recommend incorporating it into
your generation pipeline or following the "Prompting Guidance" to build your own context-processing system ». Ce
module est ce réécrivain, en local :

  POST /api/movie/apercu  {mode, params}   tout de suite : ce que H3 recevra (le plan compilé de movie.plan : l'invite,
                                           les images et leur ordre, les sujets et leur définition, les vidéos, les sons,
                                           la toile, la durée, le préréglage) et les vérifications (`checks`)
  POST /api/movie/invite  {mode, params}   un travail `movie.invite` : le modèle de texte local (Ollama, celui de
                                           l'agent d'Idéation) écrit l'invite au format officiel, en sortie structurée
                                           (un schéma JSON) ; le code l'assemble et la vérifie. Son résultat
                                           (`result.invite`) : `params` — desc, sound, music, subjects, summary, à mettre
                                           dans la page, que la personne relit et corrige —, `apercu` (ce que H3
                                           recevra alors), `source` (« modèle » ou « gabarit ») et `why`.

Juste par construction : le modèle n'écrit que le contenu (le style, l'apparence de chaque sujet, les plans et leur
début, les répliques — qui, langue, mots, ton —, le son, la musique, le résumé) ; la forme est du code : les jetons
viennent d'une liste fermée (énumération du schéma), les identifiants de voix (S1, S2…) suivent l'ordre des
premières répliques, les temps de coupe sont relus (le premier plan à 0, croissants, dans la durée ; sinon répartis à
parts égales, et dit), les répliques vont dans `<d>[Langue] …</d>` sans un mot changé. movie.plan compile ensuite
comme pour un texte écrit à la main : une mention qui ne pointe vers rien bloque le rendu, une entrée non citée est
dite, la langue et les temps sont relus.

Sans modèle de texte joignable (ou en échec), le gabarit : le texte de la personne gardé, découpé en plans s'il l'est,
les temps de coupe posés à parts égales — et `why` dit pourquoi ce n'est pas mieux (le portail ne traduit pas sans
modèle).

Réglages : `movie_invite_url`, `movie_invite_modele` (sinon ceux de l'agent d'Idéation : `ideation_agent_url`,
`ideation_agent_modele`, puis `llm_url`, `llm_model`). Le contrôle passe par le faux Ollama (tools/faux_ollama.py).
"""

from __future__ import annotations

import json
import re
import time
import urllib.request

from core import config, jobs, library, mentions
from core.http import HttpError

NUM_PREDICT = 4096   # la réponse (comme l'agent d'Idéation)
LANGS = {"fr": "French", "francais": "French", "français": "French", "french": "French", "en": "English",
         "anglais": "English", "english": "English", "es": "Spanish", "espagnol": "Spanish", "spanish": "Spanish",
         "it": "Italian", "italien": "Italian", "italian": "Italian", "de": "German", "allemand": "German",
         "german": "German", "pt": "Portuguese", "portugais": "Portuguese", "portuguese": "Portuguese",
         "ja": "Japanese", "japonais": "Japanese", "japanese": "Japanese", "zh": "Chinese", "chinois": "Chinese",
         "chinese": "Chinese", "ko": "Korean", "coréen": "Korean", "korean": "Korean", "ar": "Arabic", "arabe": "Arabic",
         "arabic": "Arabic", "ru": "Russian", "russe": "Russian", "russian": "Russian", "corse": "Corsican",
         "corsican": "Corsican"}


def _mv():
    from tools import movie
    return movie


# ── le modèle de texte ──────────────────────────────────────
def writer_url() -> str:
    if config.get("movie_invite_url"):
        return str(config.get("movie_invite_url")).rstrip("/")
    from tools import ideation_agent
    return ideation_agent.ollama_url()


def writer_model() -> str:
    if config.get("movie_invite_modele"):
        return str(config.get("movie_invite_modele"))
    from tools import ideation_agent
    return ideation_agent.model_name()


def _post(url: str, body: dict | None = None, timeout: float = 600.0) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"} if data else {})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read() or b"{}")


_probe: dict = {}


def writer_state(max_age: float = 30.0) -> dict:
    """Le modèle de texte répond-il, et y est-il ? (`/api/tags`, `/api/show` : lu, jamais appelé à calculer.)"""
    url, model = writer_url(), writer_model()
    got = _probe.get(url + "|" + model)
    if got and time.time() - got[0] < max_age:
        return got[1]
    out = {"url": url, "model": model, "up": False, "why": "", "thinks": False}
    try:
        names = {m.get("name", "") for m in _post(url + "/api/tags", timeout=4).get("models", [])}
        if model not in names and f"{model}:latest" not in names:
            out["why"] = f"le modèle {model} n'est pas dans Ollama ({url}) — réglage movie_invite_modele"
        else:
            caps = _post(url + "/api/show", {"model": model}, timeout=10).get("capabilities") or []
            out.update(up=True, thinks="thinking" in caps)
    except (OSError, ValueError) as e:
        out["why"] = f"Ollama ne répond pas ({url}) : {e}"
    _probe[url + "|" + model] = (time.time(), out)
    return out


# ── ce que le modèle reçoit ─────────────────────────────────
# Les règles des guides officiels d'H3 (MiniMax-AI/MiniMax-H3, skills/h3-prompt-writing, relus le 09/10), résumées
# pour le modèle de texte ; la forme exacte (sections, étiquettes, temps, <d>) est posée par le code, pas par lui.
SYSTEM = """You write the content of a prompt for MiniMax H3, a model that generates a video with its sound, following its official prompt-writing guides. Answer with the JSON object only.

Language: write everything in English. Spoken lines (dialogue, lyrics) stay in the language the user asks for, word for word, inside "lines"; never translate them and never put spoken words in a shot description. The user may write in French or another language: understand it, then write in English.

References: the user names references with tokens such as @image1, @element1, @video1, @audio1. Each token stands for exactly what <inputs> says it is (a character is a person, a location is a place, an object is an object). Keep the tokens exactly as written, use only the tokens listed in <inputs>, and mention every listed image or element token at least once in the shots. When a token is a character, it is the person who acts and speaks, never something that is eaten, held or shown, even if the request is ambiguous ("il mange des @element1" means the characters are eating, not that a character is eaten).

Shots: describe the video along its timeline. For each shot: the composition and framing, each visible subject (position, action, expression), the environment and lighting, the action and reactions, the camera movement, and the synchronized sound. Concrete, visible and audible details only; no plot summary and no abstract words like "cinematic" or "beautiful" without saying what is seen. The first shot starts at 0 seconds; each later shot starts at a strictly increasing time, in seconds, inside the duration; a cut brings new information (subject, space, viewpoint or time). Keep the shots the user already split, in the same order; otherwise choose 1 to 4 shots for the duration.

Camera: use one of Push In, Pull Out, Zoom In, Zoom Out, Pan Left, Pan Right, Truck Left, Truck Right, Tilt Up, Tilt Down, Pedestal Up, Pedestal Down, Arc Shot, Tracking Shot, Static Shot, Shake Slightly, Shake Strongly, POV, Roll Clockwise, Roll Counterclockwise, optionally "with small amplitude" or "with large amplitude" and "at slow speed" or "at fast speed", written as a natural sentence inside the shot ("The camera pushes in with small amplitude at slow speed toward ...").

Dialogue: when people speak, write each line in "lines" of the shot where it is spoken: who speaks (a token, or a short description of a speaker who is not a token), the language, the exact words, and the delivery ("shouts angrily", "mutters in a hoarse voice"). If the user asks for an argument or a conversation without giving the words, write short natural lines in the requested language that fit the duration (about two to three words per second of speech, leaving time for action).

style: one or two English sentences that state the visual style and look (for example live-action, cinematic, lighting, color, film texture).
subjects: for each image or element token, its visible appearance in English (age, build, face, hair, clothing; for an object: shape, material, color), taken from the input description; no name, no personality.
soundscape: one to four sentences on ambience, physical action sounds and non-verbal human sounds (no dialogue, no music).
music: one to three sentences on a score that only the audience hears (instruments, tempo, dynamics), or "N/A" when none is wanted.
summary: one English sentence on what the target video shows, using the tokens.
Length: about 300 to 450 English words across all shot descriptions; with a lot of dialogue, fit the spoken lines first."""


def schema(tokens: list[str], speakers: list[str]) -> dict:
    tok = {"type": "string", "enum": tokens} if tokens else {"type": "string"}
    line = {"type": "object", "properties": {"who": {"type": "string"}, "language": {"type": "string"},
                                              "text": {"type": "string"}, "delivery": {"type": "string"}},
            "required": ["who", "language", "text", "delivery"]}
    shot = {"type": "object", "properties": {"start": {"type": "number"}, "description": {"type": "string"},
                                              "lines": {"type": "array", "items": line}},
            "required": ["start", "description", "lines"]}
    return {"type": "object", "properties": {
        "style": {"type": "string"},
        "subjects": {"type": "array", "items": {"type": "object", "properties": {"token": tok, "appearance": {"type": "string"}},
                                                "required": ["token", "appearance"]}},
        "shots": {"type": "array", "minItems": 1, "items": shot},
        "soundscape": {"type": "string"}, "music": {"type": "string"}, "summary": {"type": "string"}},
        "required": ["style", "subjects", "shots", "soundscape", "music", "summary"]}


def _inputs_of(pl: dict, params: dict) -> list[dict]:
    """Les entrées nommables du plan, dans l'ordre : {token, kind, what, title, description}."""
    out = []
    if pl["mode"] == "r2v":
        R = pl["_R"]
        for s in R["subjects"]:
            what = {"character": "character (a person)", "object": "object"}.get(s["role"], s["role"]) if s["kind"] == "element" \
                else {"auto": "image (what it shows)", "character": "character (a person)", "location": "location (a place)",
                      "style": "visual style", "object": "object"}.get(s["role"], s["role"])
            if s["kind"] == "element" and s.get("etype") == "object":
                what = "object"
            # la description résolue par movie._inputs (la dernière version d'un élément versionné), ou celle que la
            # personne a déjà mise en anglais (`subjects`)
            desc = s.get("description") or ""
            out.append({"token": "@" + s["token"], "kind": s["kind"], "what": what, "title": s["title"],
                        "description": " ".join(desc.split())[:900]})
        for v in R["videos"]:
            out.append({"token": "@" + v["token"], "kind": "video", "what": f"video, {_mv().ROLE_EN[v['role']]} reference",
                        "title": "", "description": ""})
        for a in R["audios"]:
            if a.get("token"):
                out.append({"token": "@" + a["token"], "kind": "audio", "what": f"audio, {_mv().ROLE_EN[a['role']]} reference",
                            "title": "", "description": ""})
    elif pl["mode"] == "i2v":
        for n, x in enumerate(pl["_pictures"], start=1):
            out.append({"token": f"@image{n}", "kind": "image", "title": x["label"], "description": "",
                        "what": "the first frame of the video" if x["label"] == "première image" else "the last frame of the video"})
    return out


def _speech_lang(params: dict, desc: str) -> str:
    """La langue des répliques : celle que la personne a choisie, sinon celle qu'elle nomme (« se dispute en
    français »), sinon celle dans laquelle elle écrit."""
    if params.get("speech_lang") in ("fr", "en"):
        return {"fr": "French", "en": "English"}[params["speech_lang"]]
    m = re.search(r"\ben\s+(fran[cç]ais|anglais|espagnol|italien|allemand|portugais|japonais|chinois|corse)\b|"
                  r"\bin\s+(french|english|spanish|italian|german|portuguese|japanese|chinese|korean)\b", desc, re.I)
    if m:
        return LANGS[(m.group(1) or m.group(2)).lower().replace("francais", "français")]
    return "French" if mentions.langue(desc) == "fr" else "English"


def user_message(mode: str, params: dict, pl: dict) -> str:
    ins = _inputs_of(pl, params)
    kind = {"t2v": "text to video (no reference)", "i2v": "first and/or last frame to video",
            "r2v": "reference generation (reference images, videos and sounds)"}[mode]
    lines = [f"<mode>{kind}</mode>",
             f"<duration>{pl['seconds']:.2f} seconds ({pl['frames']} frames at 24 fps)</duration>",
             f"<frame>{pl['width']} x {pl['height']} pixels</frame>",
             "<inputs>"]
    for x in ins:
        lines.append(f"{x['token']}: {x['what']}" + (f" — \"{x['title']}\"" if x["title"] else "")
                     + (f" — description: {x['description']}" if x["description"] else ""))
    lines.append("</inputs>" if ins else "(none)</inputs>")
    marks = _mv().shot_marks(pl["desc"])
    if marks:
        lines.append(f"<shots>the user already split the video into {len(marks)} shots: keep them, in this order</shots>")
    lines.append(f"<spoken_language>{_speech_lang(params, pl['desc'])}</spoken_language>")
    lines.append(f"<request>\n{pl['desc']}\n</request>")
    if (params.get("sound") or "").strip():
        lines.append(f"<sound>{params['sound'].strip()}</sound>")
    if (params.get("music") or "").strip():
        lines.append(f"<music>{params['music'].strip()}</music>")
    return "\n".join(lines)


# ── l'assemblage : la forme est du code ─────────────────────
def _clean(s) -> str:
    """Un texte du modèle, sur une ligne, sans chevrons (ils fermeraient une étiquette ou un <d>)."""
    return " ".join(str(s or "").replace("<", " ").replace(">", " ").split())


def _lang(name: str, default: str) -> str:
    k = str(name or "").strip().lower()
    return LANGS.get(k) or (k[:1].upper() + k[1:] if re.fullmatch(r"[a-zà-ÿ]{3,20}", k) else default)


def _sentence(s: str) -> str:
    s = s.strip()
    return s if not s or s[-1] in ".!?" else s + "."


def assemble(obj: dict, mode: str, pl: dict, params: dict) -> tuple[dict, list[str]]:
    """L'objet du modèle → les réglages de la page (desc, sound, music, subjects, summary) et ce qu'il faut dire."""
    mv = _mv()
    notes = []
    tokens = {x["token"] for x in _inputs_of(pl, params)}
    seconds = float(pl["seconds"])
    shots = [s for s in (obj.get("shots") or []) if isinstance(s, dict) and _clean(s.get("description"))]
    if not shots:
        raise ValueError("le modèle de texte n'a rendu aucun plan")
    starts = []
    for s in shots:
        try:
            starts.append(float(s.get("start") or 0))
        except (TypeError, ValueError):
            starts.append(-1.0)
    good = starts[0] == 0 and all(0 < b < seconds and b > a for a, b in zip(starts, starts[1:]))
    if not good:
        starts = [round(k * seconds / len(shots), 1) for k in range(len(shots))]
        if len(shots) > 1:
            notes.append("les débuts de plans rendus par le modèle sortaient de la durée ou ne croissaient pas : "
                         "répartis à parts égales")
    speech = _speech_lang(params, pl["desc"])
    ids: dict[str, int] = {}
    out_shots = []
    for k, (s, t) in enumerate(zip(shots, starts), start=1):
        text = _sentence(_clean(s.get("description")))
        said = []
        for ln in s.get("lines") or []:
            if not isinstance(ln, dict) or not _clean(ln.get("text")):
                continue
            who = _clean(ln.get("who"))
            tok = "@" + who.lstrip("@") if re.fullmatch(r"@?(image|element|video|audio)\d+", who, re.I) else ""
            if tok and tok.lower() not in tokens:
                notes.append(f"une réplique est donnée à {tok}, qui n'est pas une entrée : elle reste sans sujet")
                who, tok = "a voice", ""
            key = (tok or who).lower()
            ids.setdefault(key, len(ids) + 1)
            verb = _clean(ln.get("delivery")) or "says"
            words = str(ln.get("text")).replace("<", "").replace(">", "").strip()
            said.append(f"{tok or who or 'a voice'} (S{ids[key]}) {verb}: <d>[{_lang(ln.get('language'), speech)}] {words}</d>")
        head = f"[Shot {k}]" + (f" At {mv.cut_time(t)}, " if k > 1 else " ")
        out_shots.append(head + " ".join([text] + said))
    style = _sentence(_clean(obj.get("style")))
    if mode == "r2v":
        desc = (style + "\n" if style else "") + "\n".join(out_shots)
    else:   # base-en § 4.1 : le style au début de [Shot 1]
        first = out_shots[0].replace("[Shot 1] ", "[Shot 1] " + (style + " " if style else ""), 1)
        desc = "\n".join([first] + out_shots[1:])
    subjects = {}
    for x in obj.get("subjects") or []:
        if isinstance(x, dict) and str(x.get("token", "")).lower() in tokens and _clean(x.get("appearance")):
            subjects[str(x["token"]).lower()] = _clean(x["appearance"])
    if mode == "r2v":
        miss = [t for t in sorted(tokens) if re.match(r"@(image|element)\d", t) and t not in subjects]
        if miss:
            notes.append(f"le modèle n'a pas décrit {', '.join(miss)} : la description de l'élément part telle quelle")
    music = _clean(obj.get("music")) or "N/A"
    out = {"desc": desc, "sound": _sentence(_clean(obj.get("soundscape"))), "music": music if music == "N/A" else _sentence(music)}
    if mode == "r2v":
        out["subjects"] = subjects
        out["summary"] = _sentence(_clean(obj.get("summary")))
    return out, notes


def gabarit(mode: str, pl: dict, params: dict, why: str) -> tuple[dict, list[str]]:
    """Sans modèle de texte : le texte de la personne, en plans ; les temps de coupe posés à parts égales quand ils
    manquent (le guide base-en § 4.2). Rien n'est traduit ni inventé."""
    mv = _mv()
    desc = pl["desc"]
    marks = mv.shot_marks(desc)
    if not marks:
        desc = "[Shot 1] " + desc
    elif len(marks) > 1 and any(m["at"] is None for m in marks[1:]):
        n, seconds = len(marks), float(pl["seconds"])
        parts = re.split(r"(\[Shot \d+\](?:\s*At \d{1,2}:\d{1,2}(?:\.\d{1,3})?\s*,?)?)", desc)
        k, rebuilt = 0, []
        for x in parts:
            if re.fullmatch(r"\[Shot \d+\](?:\s*At \d{1,2}:\d{1,2}(?:\.\d{1,3})?\s*,?)?", x):
                k += 1
                x = f"[Shot {k}]" + (f" At {mv.cut_time(round((k - 1) * seconds / n, 1))}," if k > 1 else "")
                rebuilt.append(x + " ")
            else:
                rebuilt.append(x.lstrip() if rebuilt and rebuilt[-1].endswith(" ") else x)
        desc = "".join(rebuilt).strip()
    out = {"desc": desc, "sound": params.get("sound") or "", "music": params.get("music") or ""}
    notes = [why] if why else []
    if mentions.langue(pl["desc"]) == "fr":
        notes.append("sans modèle de texte, le portail ne traduit pas : écris la description en anglais (les répliques "
                     "restent en français dans <d>[French] …</d>), ou relance quand le modèle répond")
    return out, notes


# ── les vérifications que la page montre ────────────────────
def checks(pl: dict) -> list[dict]:
    """[{id, level: ok | remarque | erreur, text}] : ce que le code a vérifié du plan, dans l'ordre de lecture."""
    mv = _mv()
    out = []
    add = lambda i, lv, t: out.append({"id": i, "level": lv, "text": t})  # noqa: E731
    bad = [e for e in pl["errors"] if "ne pointent vers rien" in e or "ne servent qu'en" in e]
    add("mentions", "erreur" if bad else "ok",
        bad[0] if bad else (f"{len(pl['mentions'])} mention{'s' if len(pl['mentions']) > 1 else ''} : "
                            + ", ".join(f"{k} → {v}" for k, v in pl["mentions"].items()) if pl["mentions"] else "aucune mention"))
    idle = [n for n in pl["notes"] if "pas dans le prompt" in n]
    if pl["mode"] == "r2v":
        add("cites", "remarque" if idle else "ok", idle[0] if idle else "chaque entrée est citée dans la description")
    lang = pl.get("language")
    add("langue", "remarque" if lang == "fr" else "ok",
        "la description est en français : H3 la veut en anglais (sauf les répliques dans <d>)" if lang == "fr"
        else "description en anglais, répliques dans leur langue" if lang == "en" else "langue non décidée (peu de mots)")
    e_sh = [e for e in pl["errors"] if e.startswith("[Shot")]
    n_sh = [n for n in pl["notes"] if "[Shot" in n or "plans se numérotent" in n or "premier plan ne porte" in n]
    shots = pl.get("shots") or []
    add("plans", "erreur" if e_sh else "remarque" if n_sh else "ok",
        (e_sh or n_sh)[0] if (e_sh or n_sh) else (f"{len(shots)} plans, coupes dans les {pl['seconds']:.2f} s" if len(shots) > 1
                                                   else f"un plan de {pl['seconds']:.2f} s"))
    said = re.findall(r"<d>\[([^\]]+)\]", pl["prompt_sent"] or "")
    add("repliques", "ok" if said else "remarque",
        f"{len(said)} réplique{'s' if len(said) > 1 else ''} au format H3 ({', '.join(sorted(set(said)))})" if said
        else "aucune réplique écrite : si quelqu'un parle, H3 ne dira que ce qui est écrit dans <d>[Langue] …</d>")
    body = pl["prompt_sent"].split("detailed_description:", 1)[-1].split("integrated_multimodal_description:", 1)[-1]
    body = body.split("overall_soundscape:", 1)[0]
    words = len(re.sub(r"<d>.*?</d>", " ", body, flags=re.S).split())
    add("longueur", "ok" if words >= 200 else "remarque",
        f"{words} mots de description" + ("" if words >= 200 else " : les guides H3 visent 350 à 500 mots (l'échec documenté est le manque de précision)"))
    for sj in pl.get("subjects") or []:
        if sj["token"].startswith("@element"):
            gone = next((n for n in pl["notes"] if n.startswith(sj["token"] + " ") and "laissée" in n), "")
            fall = next((n for n in pl["notes"] if n.startswith(sj["token"] + " ") and "à la place" in n), "")
            fr = next((n for n in pl["notes"] if n.startswith(sj["token"] + " ") and "en français" in n), "")
            add(f"element:{sj['token']}", "remarque" if (gone or fall or fr) else "ok",
                f"{sj['token']} « {sj['title']} » : {len(sj['pictures'])} image{'s' if len(sj['pictures']) > 1 else ''} "
                f"({', '.join(sj['pictures'])})" + (f" — {(gone or fall or fr).split(' : ', 1)[1]}" if (gone or fall or fr) else ""))
    add("toile", "ok", f"{pl['width']} × {pl['height']} · {mv.METHODS[pl['method']]['label']}"
        + (f" en deux étages (depuis {pl['draft'][0]} × {pl['draft'][1]})" if pl.get("draft") else " en un étage")
        + f" · {pl['frames']} images ({pl['seconds']:.2f} s)")
    other = [e for e in pl["errors"] if e not in bad and e not in e_sh]
    for e in other:
        add("autre", "erreur", e)
    return out


def apercu(mode: str, params: dict) -> dict:
    """Ce que H3 recevra, tout de suite, et les vérifications (la page « ce que le modèle reçoit »)."""
    mv = _mv()
    pl = mv.plan(mode, params)
    return {**mv.public_plan(pl), "checks": checks(pl), "writer": writer_state()}


# ── le travail : écrire l'invite ────────────────────────────
def write(mode: str, params: dict, cancelled=lambda: False) -> dict:
    """{params, apercu, source, why, notes, model} : l'invite écrite (ou le gabarit), puis le plan qu'elle donne."""
    mv = _mv()
    pl = mv.plan(mode, params)
    if not pl["desc"]:
        raise ValueError("écrivez d'abord ce que vous voulez voir : la mise en forme part de votre texte")
    st = writer_state(max_age=5)
    source, why, notes = "gabarit", "", []
    got = None
    if st["up"]:
        ins = _inputs_of(pl, params)
        from tools import ideation_agent as ia
        # la fenêtre de l'agent d'Idéation (le même modèle : Ollama le recharge si `num_ctx` change), puis
        # déchargé (`keep_alive: 0`) : la mémoire revient à H3 aussitôt (docs/etudes/orchestration.md § 3.1)
        body = {"model": st["model"], "stream": False, "keep_alive": 0,
                "options": {"num_ctx": ia.ctx_size(), "num_predict": NUM_PREDICT, "temperature": 0.4},
                "format": schema([x["token"] for x in ins if x["kind"] in ("image", "element")], []),
                "messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user_message(mode, params, pl)}]}
        if st.get("thinks"):
            body["think"] = False
        try:
            r = _post(st["url"] + "/api/chat", body, timeout=600)
            if r.get("error"):
                raise ValueError(str(r["error"]))
            if r.get("done_reason") == "length":
                raise ValueError(f"la réponse dépasse la fenêtre ({NUM_PREDICT} jetons en sortie)")
            got, notes = assemble(json.loads((r.get("message") or {}).get("content") or "{}"), mode, pl, params)
            source = "modèle"
        except (OSError, ValueError, KeyError, TypeError) as e:
            why = f"le modèle de texte a échoué ({type(e).__name__} : {e}) : le gabarit à la place"
    else:
        why = f"pas de modèle de texte : {st['why']}"
    if cancelled():
        raise RuntimeError("arrêté")
    if got is None:
        got, notes = gabarit(mode, pl, params, why)
    new = {**params, **got}
    after = mv.plan(mode, new)
    return {"params": got, "apercu": {**mv.public_plan(after), "checks": checks(after)}, "source": source, "why": why,
            "notes": notes, "model": st["model"] if source == "modèle" else None}


def run_invite(ctx) -> dict:
    p = ctx.params
    ctx.progress(0.05, "écrit l'invite au format H3")
    out = write(p.get("mode"), p.get("params") or {}, cancelled=ctx.cancelled)
    ctx.progress(1.0, "invite prête" if out["source"] == "modèle" else "gabarit (sans modèle de texte)")
    return {"invite": out, "note": "invite écrite par le modèle de texte" if out["source"] == "modèle" else out["why"]}


# ── les routes ──────────────────────────────────────────────
def _body(req) -> tuple[str, dict]:
    d = req.json()
    mode = d.get("mode", "")
    if mode not in _mv().MODES:
        raise HttpError(400, f"mode inconnu : {mode}")
    params = d.get("params") if isinstance(d.get("params"), dict) else {}
    return mode, params


def r_apercu(req):
    mode, params = _body(req)
    return apercu(mode, params)


def r_invite(req):
    mode, params = _body(req)
    if not (params.get("desc") or "").strip():
        raise HttpError(400, "écrivez d'abord ce que vous voulez voir : la mise en forme part de votre texte")
    from tools import ideation_agent as ia
    real = ia._lane() == "audio"
    title = "Vidéo · invite · " + " ".join(str(params.get("desc")).split())[:48]
    return jobs.public(jobs.submit("movie.invite", {"mode": mode, "params": params}, title=title, tool="movie",
                                   pin=ia.pin_for(writer_url()) if real else None))


def register(app) -> None:
    from tools import ideation_agent as ia
    real = ia._lane() == "audio"
    # le jeton GPU de la machine du modèle de texte (comme l'agent d'Idéation) : jamais à côté d'un rendu H3
    jobs.register("movie.invite", run_invite, lane="audio" if real else "cpu", title="Vidéo · invite",
                  family="ollama-agent" if real else None, gpu=real, mem_gb=ia.MEM_GB if real else None,
                  cost="gpu" if real else "cpu")
    app.route("POST", "/api/movie/apercu", r_apercu)
    app.route("POST", "/api/movie/invite", r_invite)


# ── le contrôle (tools/check.py), contre le faux Ollama (tools/faux_ollama.py) ──
def selftest(call, ok) -> None:
    import importlib.util
    import tempfile
    from pathlib import Path
    from PIL import Image
    mv = _mv()
    spec = importlib.util.spec_from_file_location("faux_ollama", config.REPO / "tools" / "faux_ollama.py")
    F = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(F)
    f = F.Faux()
    saved = {k: config.CFG.get(k) for k in ("ideation_agent_url", "ideation_agent_modele", "movie_invite_url", "movie_invite_modele")}
    tmp = Path(tempfile.mkdtemp())

    def png(name, color, w=512, h=512):
        Image.new("RGB", (w, h), color).save(tmp / name)
        return tmp / name

    def wait(jid):
        j = {}
        for _ in range(200):
            _, j = call("GET", f"/api/jobs/{jid}")
            if j.get("state") in ("done", "error", "cancelled", "interrupted"):
                break
            time.sleep(0.1)
        return j
    # deux personnages comme ceux de Cal : importés de Character Factory (visage verrouillé, tenues, expressions :
    # core_api._walk_cf), sans planche masquée ni crops « .char » (docs/REPRISE.md § 2.F)
    cf = [{"path": png("v.png", (200, 150, 120)), "role": "face", "label": "visage"},
          {"path": png("t.png", (40, 60, 90), 512, 768), "role": "full body", "label": "Costume bleu"},
          {"path": png("e.png", (210, 160, 130)), "role": "expression", "label": "colère"}]
    a = library.create_element("Marc", "character", "male, 34. Visage carré, barbe de trois jours, cheveux noirs courts.", cf,
                                source={"tool": "character-factory", "slug": "marc-essai"})
    b = library.create_element("Léa", "character", "female, 30, short black hair, red jacket", cf)
    ins = {"element": [{"item": a["id"]}, {"item": b["id"]}]}
    cal = "il mange des @element1 et @element2 se dispute en francais, il en viennent aux main , cinema d'action"
    try:
        # sans modèle de texte : l'aperçu tout de suite, puis le gabarit, qui le dit
        config.CFG["movie_invite_url"] = "http://127.0.0.1:9"
        _probe.clear()
        st, ap = call("POST", "/api/movie/apercu", {"mode": "r2v", "params": {"inputs": ins, "desc": cal}})
        lv = {c["id"]: c["level"] for c in ap.get("checks", [])} if st == 200 else {}
        ok(st == 200 and ap["ok"] and lv.get("langue") == "remarque" and lv.get("repliques") == "remarque"
           and lv.get("element:@element1") == "remarque" and lv.get("mentions") == "ok" and not ap["writer"]["up"]
           and [p["tag"] for p in ap["pictures"]] == ["<Picture 1>", "<Picture 2>", "<Picture 3>", "<Picture 4>"],
           f"aperçu : l'invite de Cal, ce que H3 recevra, la langue et les répliques signalées ({st} {lv})")
        st, j = call("POST", "/api/movie/invite", {"mode": "r2v", "params": {"inputs": ins, "desc": cal}})
        j = wait(j.get("id")) if st == 200 else {}
        inv = (j.get("result") or {}).get("invite") or {}
        ok(j.get("state") == "done" and inv.get("source") == "gabarit" and "Ollama ne répond pas" in (inv.get("why") or "")
           and inv["params"]["desc"].startswith("[Shot 1] il mange") and any("ne traduit pas" in n for n in inv["notes"]),
           f"invite sans modèle : le gabarit, et pourquoi ({j.get('state')} {j.get('message')} {inv.get('why')})")
        st, _ = call("POST", "/api/movie/invite", {"mode": "r2v", "params": {"inputs": ins, "desc": "  "}})
        ok(st == 400, "invite : rien à mettre en forme sans texte")
        st, _ = call("POST", "/api/movie/apercu", {"mode": "x", "params": {}})
        ok(st == 400, "aperçu : un mode inconnu est refusé")
        # le gabarit pose les temps de coupe d'un découpage du Multishot, à parts égales
        g, _ = gabarit("r2v", mv.plan("r2v", {"inputs": ins, "desc": "[Shot 1] @element1 eats. [Shot 2] @element2 shouts. [Shot 3] They fight.",
                                              "frames": 124}), {}, "")
        ok(g["desc"] == "[Shot 1] @element1 eats. [Shot 2] At 00:01.700, @element2 shouts. [Shot 3] At 00:03.400, They fight.",
           f"gabarit : les temps de coupe du guide posés à parts égales ({g['desc']!r})")
        # avec le modèle de texte (le faux) : l'invite au format officiel, en anglais, répliques en français
        config.CFG["movie_invite_url"] = f.start()
        config.CFG["movie_invite_modele"] = f.models[0]
        _probe.clear()
        st, j = call("POST", "/api/movie/invite", {"mode": "r2v", "params": {"inputs": ins, "desc": cal, "frames": 192}})
        ok(st == 200 and j.get("kind") == "movie.invite" and j.get("tool") == "movie", f"invite : un travail en file ({st})")
        j = wait(j.get("id")) if st == 200 else {}
        inv = (j.get("result") or {}).get("invite") or {}
        P = inv.get("params") or {}
        sent = (inv.get("apercu") or {}).get("prompt_sent", "")
        body = f.calls[-1] if f.calls else {}
        ok(j.get("state") == "done" and inv.get("source") == "modèle" and body.get("format", {}).get("properties", {})
           .get("subjects", {}).get("items", {}).get("properties", {}).get("token", {}).get("enum") == ["@element1", "@element2"]
           and body.get("keep_alive") == 0 and "<spoken_language>French</spoken_language>" in body["messages"][1]["content"],
           f"invite : le modèle reçoit les jetons en liste fermée, la langue des répliques, et se décharge ({j.get('message')})")
        ok("\n[Shot 2] At 00:02.700, " in P.get("desc", "") and "@element1 (S1) shouts angrily: <d>[French] Tu as encore pris ma part !</d>" in P["desc"]
           and "@element2 (S2) snaps back: <d>[French]" in P["desc"] and P.get("subjects", {}).get("@element2", "").startswith("the person")
           and P.get("summary", "").startswith("@element1 and @element2"),
           f"invite : les plans, leurs temps de coupe, les voix S1 S2 dans l'ordre, les sujets décrits ({P.get('desc', '')[:200]!r})")
        ok("<Subject 1> (S1) shouts angrily: <d>[French] Tu as encore pris ma part !</d>" in sent
           and "[reference generation] <Subject 1> and <Subject 2> argue over a meal" in sent
           and "<Subject 2> is Léa, the person described as female, 30" in sent and "@" not in sent
           and all(c["level"] == "ok" for c in inv["apercu"]["checks"] if c["id"] in ("mentions", "langue", "plans", "repliques")),
           f"invite : ce que H3 recevra, compilé et vérifié ({[c for c in inv['apercu']['checks'] if c['level'] != 'ok']})")
        # l'assemblage : des temps hors du plan sont répartis, une réplique à une entrée inconnue reste sans sujet
        pl = mv.plan("r2v", {"inputs": ins, "desc": cal})
        got, notes = assemble({"style": "Live-action", "subjects": [], "shots": [
            {"start": 0, "description": "@element1 eats <b>noodles</b>", "lines": []},
            {"start": 9, "description": "@element2 shouts", "lines": [{"who": "@element7", "language": "français", "text": "Non !", "delivery": ""}]}],
            "soundscape": "", "music": "", "summary": ""}, "r2v", pl, {})
        ok(got["desc"] == "Live-action.\n[Shot 1] @element1 eats b noodles /b.\n[Shot 2] At 00:02.600, @element2 shouts. a voice (S1) says: <d>[French] Non !</d>"
           and any("parts égales" in n for n in notes) and any("@element7" in n for n in notes) and got["music"] == "N/A",
           f"invite : la forme est du code — temps relus, chevrons retirés, voix inconnue sans sujet ({got['desc']!r} {notes})")
        st, o = call("GET", "/api/movie/options")
        ok(st == 200 and o["llm"]["up"] and o["llm"]["model"] == f.models[0], f"options : l'état du modèle de texte ({o.get('llm')})")
    finally:
        for k, v in saved.items():
            if v is None:
                config.CFG.pop(k, None)
            else:
                config.CFG[k] = v
        _probe.clear()
        f.close()
