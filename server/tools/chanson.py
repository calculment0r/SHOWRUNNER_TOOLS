"""Musique, l'app : une chanson par prompt, avec nos modèles libres.

Cal, 29/09 : « on a aussi en app : faire de la musique (simple avec prompt,
fonctions de base de YuE (ou YuE2), avec quand même la possibilité de pouvoir
mettre une réf son pour faire une cover ou s'en inspirer) » ; puis : « mon
onglet music […] le générateur de song avec nos outils libres […] la
séparation de stems reste possible mais envoie vers le studio ODIO et il
faudra un autre abonnement ». L'étude qui fonde chaque choix :
`docs/etudes/musique_app.md` ; le partage Apps / Studio :
`docs/etudes/apps_studio_elements.md` § 3.

Ce que la page montre, en mots simples ; ce que ce module en fait :

  Rapide    ACE-Step 1.5 XL base par ComfyUI (« l'outil des régions courtes
            et des itérations », musique_generatif.md § 2.4) — travail
            `chanson.ace`
  Soigné    YuE2 3B bf16 par ComfyUI (WildSongBench : 6,73 contre 6,01 pour
            ACE-Step, ~/YuE/README.md) — travail `chanson.yue`
  Reprendre (une référence son) : YuE2 seul — SheetSage2 transcrit la
            mélodie de la référence, YuE2 la rechante dans le style demandé
            (~/YuE/docs/covers.md ; `ref` de music_yue.py)
  S'en inspirer : ACE-Step seul — le timbre de la référence par le nœud
            ReferenceTimbreAudio de ComfyUI (expérimental, écrit dans
            music_gen.build_ace_graph, jamais rendu)
  Relire la partition (05/10, Cal : « on devait pas avoir un mode de
            validation de ce que le modèle va faire avant de le calculer ?
            notre modèle "qualité" le fait. on met ce modèle par défaut
            aussi ») : avec Soigné et Reprendre (YuE2), la page fait d'abord
            écrire la partition — le plan ABC de YuE2 (YuE2GenerateABC), ou
            la mélodie de la référence transcrite par SheetSage2 —, la
            montre (structure, accords, tempo, tonalité, durée), la laisse
            modifier, puis la fait chanter telle quelle (entrée `abc` de
            YuE2GenerateMusic, « supply an edited score », nodes_yue2.py:53 ;
            musique_generatif.md § 1.2-1.4). Travail `chanson.plan`. Rapide
            et S'en inspirer (ACE-Step) n'ont pas de plan lisible à relire :
            ACE-Step compose et rend d'un même geste (§ 2, § 6). Soigné est
            le préréglage par défaut, le mode relire est allumé par défaut.
  Écris-les pour moi : les paroles par le modèle de langue d'ACE-Step 1.5
            (`create_sample`, le « Simple Mode » de sa documentation) —
            travail `chanson.paroles`, script chanson_paroles.py
  Séparer les pistes, Ouvrir dans ODIO : le Studio (droit `access` de la
            personne, ou admin) — `music.stems` (music_stems.py), puis un
            projet ODIO dont chaque piste est un stem

Moteurs : ceux des interrupteurs existants (Admin → Câblage), lus au
démarrage — `music_engine` (ACE-Step), `music_yue` (YuE2), `music_stems`
(séparation) — et un neuf, `chanson_paroles`. Tous factices par défaut :
voie `cpu`, des sons d'essai (sinus, nappe, bruit filtré) étiquetés « essai ».

Tout ce que l'app fabrique est un objet de la bibliothèque (`tool` :
« chanson », dossier Musique), avec sa recette dans `params.chanson` : une
variante la rejoue avec une autre graine.

Les Spaces (05/10, docs/etudes/musique_spaces_playlists.md § 2) : des dossiers
de travail dans le Workspace ; tout ce que l'app fait naître y va (le champ
`music_space` de l'objet, « Mon Space » sans lui) — la section « les Spaces ».
"""

from __future__ import annotations

import json
import random
import re
import secrets
import subprocess
import threading
import time
from array import array
from pathlib import Path

from core import auth, config, jobs, library
from core.comfy import Cancelled, ComfyError
from core.http import HttpError
from tools import music, music_gen, music_stems, music_yue

TOOL = "chanson"
HOME = Path.home()

config.declare_switch(
    "chanson_paroles", [False, True], label="Musique (app) · écrire les paroles", default=False,
    doc="server/tools/chanson.py : paroles d'essai (factice) ou le modèle de langue d'ACE-Step 1.5 "
        "(create_sample, sous-processus du venv ~/ACE-Step-1.5, LM 5 Hz 1,7B déjà sur disque) — docs/etudes/musique_app.md")

# ── ce que la page propose (les mots simples ; le modèle n'est que dans les avancés) ──
PRESETS = {
    "rapide": {"label": "Rapide", "about": "une idée en quelques secondes", "model": "ace"},
    "soigne": {"label": "Soigné", "about": "la voix la plus juste, une partition à relire avant", "model": "yue"},
}
# le préréglage par défaut : Soigné, celui qui écrit une partition qu'on relit avant le
# rendu (décision de Cal du 05/10 : « on met ce modèle par défaut aussi »)
DEFAULT_PRESET = "soigne"
# pourquoi un modèle n'a pas de partition à relire avant le rendu
PLAN_WHY = {"ace": "ACE-Step compose et rend le son d'un même geste : son modèle de langue prépare des codes "
                   "audio internes, pas une partition lisible (docs/etudes/musique_generatif.md § 2.1, § 6) — "
                   "rien à relire avant le calcul ; Soigné (YuE2) écrit d'abord sa partition"}
# les sections d'une partition (étiquettes de SheetSage2, sheetsage2.py:242-246), en mots simples
SECTION_FR = {"intro": "Intro", "verse": "Couplet", "pre-chorus": "Pré-refrain", "prechorus": "Pré-refrain",
              "chorus": "Refrain", "bridge": "Pont", "outro": "Fin", "instrumental": "Instrumental", "solo": "Solo",
              "inst": "Instrumental", "end": "Fin", "interlude": "Interlude", "break": "Pause"}
MODELS = {
    "ace": {"name": "ACE-Step 1.5", "full": "ACE-Step 1.5 XL base (ComfyUI)", "dur": (10.0, 600.0), "lyrics_max": 4000,
            "switch": "\"music_engine\": \"ace-step\"",
            "source": "~/ACE-Step-1.5/docs/en/INFERENCE.md (caption 512 signes, lyrics 4096, duration 10-600 s) ; "
                      "server/workflows/music_ace15_xl_base.json (gabarit officiel)"},
    "yue": {"name": "YuE2", "full": "YuE2 3B (ComfyUI)", "dur": (music_yue.DUR_MIN, music_yue.DUR_MAX), "lyrics_max": 4000,
            "switch": "\"music_yue\": true",
            "source": "docs/etudes/yue.md § 4 ; nodes_yue2.py (max_duration 0,04-900 s, une durée maximale)"},
}
REFS = {
    "cover": {"label": "Reprendre", "about": "garde sa mélodie, change le style", "model": "yue",
              "source": "~/YuE/docs/covers.md : SheetSage2 transcrit la mélodie, YuE2 la rechante (cot=melody)"},
    "inspire": {"label": "S'en inspirer", "about": "garde sa couleur, pas sa mélodie", "model": "ace",
                "source": "ComfyUI comfy_extras/nodes_ace.py ReferenceTimbreAudio (expérimental) ; "
                          "ACE-Step INFERENCE.md:376 reference_audio « for style transfer »"},
}
DURATIONS = (30, 60, 120, 180)
# les langues du chant : celles que le nœud d'ACE-Step connaît (music.LANGS) ; pour
# YuE2, la langue s'écrit dans le style (docs/generation.md) — anglais et
# mandarin seuls documentés (README), les autres non documentés
LANGS = {"fr": ("Français", "French"), "en": ("Anglais", "English"), "es": ("Espagnol", "Spanish"),
         "de": ("Allemand", "German"), "it": ("Italien", "Italian"), "pt": ("Portugais", "Portuguese"),
         "ja": ("Japonais", "Japanese"), "zh": ("Chinois", "Chinese"), "ko": ("Coréen", "Korean")}
PROMPT_MAX = 500          # ACE-Step : 512 signes (INFERENCE.md) ; YuE2 : 2000 (garde-fou du portail)
MAX_N = 4
SEED_MAX = 2 ** 32 - 1
DEFAULT_KEY = "C major"
WAVE_N = 480              # les barres de la forme d'onde
ADV = {"ace": ("bpm", "key", "language"), "yue": ("precision", "language")}
ADV_FR = {"bpm": "tempo", "key": "tonalité", "language": "langue", "precision": "précision"}

STEM_FR = music_stems.STEM_FR
# les couleurs des pistes dans ODIO (musique.js, STEM_COLOR) : des noms de jetons
STEM_COLOR = {"vocals": "coral-3", "drums": "or", "bass": "grn2", "other": "cy", "guitar": "amb", "piano": "coral-2",
              "instrumental": "cy"}
STUDIO_WHY = "Séparer les pistes et ouvrir dans ODIO font partie du Studio."

_lock = threading.Lock()


def _dir() -> Path:
    d = config.data_dir() / "chanson"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _read_json(name: str) -> dict:
    f = _dir() / name
    try:
        d = json.loads(f.read_text(encoding="utf-8"))
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def _write_json(name: str, d: dict) -> None:
    f = _dir() / name
    tmp = f.with_suffix(f".{secrets.token_hex(3)}.tmp")
    tmp.write_text(json.dumps(d, ensure_ascii=False), encoding="utf-8")
    tmp.replace(f)


def engine(model: str) -> str:
    """« reel » quand l'interrupteur du modèle est mis, sinon « factice »."""
    if model == "ace":
        return "reel" if music.mode() == "ace-step" else "factice"
    return "reel" if music_yue.mode() == "comfyui" else "factice"


def paroles_engine() -> str:
    return "reel" if config.get("chanson_paroles") is True else "factice"


# ── le Studio : qui peut séparer et ouvrir dans ODIO ─────────
# Le droit `access` de la porte (core/auth.py, « le Studio » ; étude
# apps_studio_elements.md § 3.6) : lu là, une seule vérité — un admin l'a
# toujours, la porte coupée (essais) vaut Cal. La porte ferme aussi les deux
# routes (auth.STUDIO_ROUTES) ; `need_studio` le redit au plus près du geste.
# La demande est celle du portail (POST /api/auth/studio, visible dans Admin).
def studio_state(u: dict | None = None, *, current: bool = True) -> dict:
    u = auth.current() if current and u is None else u
    if auth.has_studio(u):
        return {"ok": True, "why": "", "asked": None}
    return {"ok": False, "why": STUDIO_WHY, "asked": auth.studio_asked(u),
            "how": "Cal ouvre le Studio d'une personne dans Admin (Demandes, ou Personnes)"}


def need_studio() -> None:
    s = studio_state()
    if not s["ok"]:
        raise HttpError(403, f"{STUDIO_WHY} Demande-le à Cal (bouton « Demander le Studio »).")


# ── la recette d'une chanson ─────────────────────────────────
def _bpm_of(text: str) -> int | None:
    m = re.search(r"(\d{2,3})\s*bpm", text or "", re.I)
    return int(m.group(1)) if m and 30 <= int(m.group(1)) <= 300 else None


def _audio(iid, what: str) -> str:
    it = library.get(iid) if isinstance(iid, str) and iid else None
    if not it or it.get("kind") != "audio":
        raise ValueError(f"{what} : un son de la bibliothèque")
    return it["id"]


def _int(v, lo: int, hi: int, what: str) -> int:
    if isinstance(v, bool) or not isinstance(v, (int, float)) or v != v or int(v) != v:
        raise ValueError(f"{what} : un nombre entier")
    if not lo <= v <= hi:
        raise ValueError(f"{what} : de {lo} à {hi}")
    return int(v)


def song_params(d: dict) -> dict:
    """La demande de la page, jugée : une valeur hors bornes est refusée, pas
    corrigée ; un réglage qui ne compte pas pour ce modèle aussi. Rend la
    recette complète (ce qu'une variante rejoue)."""
    if not isinstance(d, dict):
        raise ValueError("la demande est un objet")
    prompt = d.get("prompt")
    if not isinstance(prompt, str) or not prompt.strip():
        raise ValueError("décris la chanson : un style, une ambiance")
    prompt = prompt.strip()
    if len(prompt) > PROMPT_MAX:
        raise ValueError(f"la description tient en {PROMPT_MAX} signes au plus")
    vocal = d.get("vocal", True)
    if not isinstance(vocal, bool):
        raise ValueError("chanté : vrai ou faux")
    lyrics = d.get("lyrics") or ""
    if not isinstance(lyrics, str):
        raise ValueError("les paroles sont un texte")
    lyrics = lyrics.strip()
    if vocal and not lyrics:
        raise ValueError("chanté : écris les paroles, ou « Écris-les pour moi »")
    if not vocal and lyrics:
        raise ValueError("instrumental : sans paroles (passe en « Chanté » pour les garder)")
    preset = d.get("preset") or DEFAULT_PRESET
    if preset not in PRESETS:
        raise ValueError(f"préréglage inconnu : {preset} ({', '.join(PRESETS)})")
    ref = d.get("ref") or ""
    ref_mode = d.get("ref_mode") or ""
    if ref:
        ref = _audio(ref, "la référence")
        if ref_mode not in REFS:
            raise ValueError("une référence : « Reprendre » ou « S'en inspirer »")
    elif ref_mode:
        raise ValueError(f"« {REFS.get(ref_mode, {}).get('label', ref_mode)} » demande une référence son")
    model = d.get("model") or (REFS[ref_mode]["model"] if ref else PRESETS[preset]["model"])
    if model not in MODELS:
        raise ValueError(f"modèle inconnu : {model} ({', '.join(MODELS)})")
    if ref and REFS[ref_mode]["model"] != model:
        raise ValueError(f"« {REFS[ref_mode]['label']} » ne se fait qu'avec {MODELS[REFS[ref_mode]['model']]['name']}")
    M = MODELS[model]
    if len(lyrics) > M["lyrics_max"]:
        raise ValueError(f"les paroles tiennent en {M['lyrics_max']} signes au plus")
    dur = d.get("duration", 60)
    if isinstance(dur, bool) or not isinstance(dur, (int, float)) or dur != dur:
        raise ValueError("durée : un nombre de secondes")
    lo, hi = M["dur"]
    if not lo <= dur <= hi:
        raise ValueError(f"durée : de {lo:g} à {hi:g} secondes avec {M['name']}")
    n = _int(d.get("n", 1), 1, MAX_N, "versions")
    seed = d.get("seed")
    seed = random.randint(0, 2 ** 31 - 1) if seed in (None, "", -1) else _int(seed, 0, SEED_MAX, "graine")
    adv = d.get("adv") or {}
    if not isinstance(adv, dict):
        raise ValueError("les paramètres avancés sont un objet")
    bad = [k for k, v in adv.items() if v not in (None, "") and k not in ADV[model]]
    if bad:
        raise ValueError(f"« {ADV_FR.get(bad[0], bad[0])} » ne compte pas pour {M['name']}")
    language = adv.get("language") or "fr"
    if language not in LANGS:
        raise ValueError(f"langue : {', '.join(LANGS)}")
    out = {"prompt": prompt, "vocal": vocal, "lyrics": lyrics, "preset": preset, "model": model, "ref": ref,
           "ref_mode": ref_mode if ref else "", "duration": round(float(dur), 2), "n": n, "seed": seed,
           "language": language}
    if model == "ace":
        bpm = adv.get("bpm")
        out["bpm"] = _int(bpm, 30, 300, "tempo") if bpm not in (None, "") else (_bpm_of(prompt) or 120)
        key = adv.get("key") or DEFAULT_KEY
        if key not in music.KEYSCALES:
            raise ValueError(f"tonalité inconnue : {key}")
        out["key"] = key
    else:
        precision = adv.get("precision") or "bf16"
        if precision not in music_yue.CKPTS:
            raise ValueError("précision : bf16 (qualité) ou int8 (rapide)")
        out["precision"] = precision
    # la partition relue (le mode « relire la partition ») : YuE2 seul la chante
    abc = d.get("abc") or ""
    if not isinstance(abc, str):
        raise ValueError("la partition est un texte")
    abc = abc.strip()
    if abc:
        if model != "yue":
            raise ValueError(f"une partition ne se chante qu'avec YuE2 : {PLAN_WHY.get(model, '')}")
        if len(abc) > music_yue.MAX_ABC:
            raise ValueError(f"la partition tient en {music_yue.MAX_ABC} signes au plus")
        chk = music_yue.abc_check(abc) if music_yue.abc_tools() else {"ok": None}
        if chk["ok"] is False:
            raise ValueError(f"la partition ne suit pas le dialecte de YuE2 : {chk['error']}")
    out["abc"] = abc
    title = d.get("title") or ""
    out["title"] = (title.strip()[:80] if isinstance(title, str) else "") or prompt[:60]
    parent = d.get("parent") or ""
    out["parent"] = _audio(parent, "la chanson d'origine") if parent else ""
    return out


def yue_of(p: dict, k: int = 0) -> dict:
    """Les réglages YuE2 d'une prise (music_yue.yue_params les juge encore) :
    la langue du chant écrite dans le style (docs/generation.md) ; une reprise
    en « melody » (docs/covers.md)."""
    style = p["prompt"]
    word = LANGS[p["language"]][1]
    if p["vocal"] and word.lower() not in style.lower():
        style = f"{word}, {style}"
    cover = p["ref_mode"] == "cover"
    abc = p.get("abc") or ""
    # une partition relue remplace le plan (ou la transcription de la référence) : YuE2
    # la chante telle quelle ; la référence reste en parent de la chanson (_store)
    return music_yue.yue_params({"tags": style, "lyrics": p["lyrics"] if p["vocal"] else "", "duration_s": p["duration"],
                                 "seed": p["seed"] + k, "mode": "melody" if cover else "full",
                                 "precision": p.get("precision", "bf16"), "ref": p["ref"] if cover and not abc else "",
                                 "abc": abc, "title": p["title"]})


def ace_of(p: dict) -> dict:
    """La recette d'une région au format de music_gen.build_ace_graph (le
    graphe du gabarit officiel, l'audio de style par ReferenceTimbreAudio) :
    une seule construction du graphe ACE-Step pour ODIO et pour l'app."""
    v = {"caption": p["prompt"], "instrumental": not p["vocal"], "lyrics": p["lyrics"], "duration": p["duration"],
         "bpm": p["bpm"], "keyscale": p["key"], "timesignature": "4", "language": p["language"]}
    if p["ref_mode"] == "inspire":
        v["style_audio"] = p["ref"]
    return {"values": v, "n": p["n"], "seed": p["seed"], "title": p["title"]}


def ace_gen(p: dict) -> dict:
    """Les réglages jugés par music.gen_params (bornes d'ACE-Step 1.5)."""
    return music.gen_params({"tags": p["prompt"], "lyrics": p["lyrics"], "instrumental": not p["vocal"],
                             "duration": p["duration"], "bpm": p["bpm"], "keyscale": p["key"], "timesignature": "4",
                             "language": p["language"], "seed": p["seed"], "title": p["title"]})


# ── ranger une prise ────────────────────────────────────────
def _store(ctx, p: dict, path: Path, k: int, eng: str, extra: dict | None = None, seed: int | None = None) -> dict:
    essai = eng == "factice"
    title = p["title"] + (f" · {k + 1}" if p["n"] > 1 else "") + (" (essai)" if essai else "")
    parents = [x for x in (p["ref"], p["parent"]) if x]
    seed = p["seed"] + k if seed is None else seed
    model = "factice" if essai else ("yue2-3b-" + p.get("precision", "bf16") if p["model"] == "yue" else "ace-step-1.5-xl-base")
    msp = birth_space(p, (ctx.params or {}).get("music_space") or "")
    return ctx.add(path, kind="audio", title=title, prompt=p["prompt"], parents=parents,
                   params={"chanson": {**p, "seed": seed, "n": 1}, "seed": seed, "take": k, "engine": eng,
                           "model": p["model"], **(extra or {})},
                   origin={"model": model}, tags=["musique", "chanson", "essai" if essai else "généré"], folder="Musique",
                   extra={"music_space": msp} if msp else None)


# ── les moteurs d'essai : des sons plausibles, sans modèle ───
def fake_inspire(dest: Path, ref_id: str, gp: dict, workdir: Path) -> None:
    """« S'en inspirer » en essai : le son d'essai d'ACE (music.test_tone : la
    tonalité, le tempo, la durée) mêlé à la référence filtrée et bouclée
    (ffmpeg aloop/amix) — de quoi entendre que la référence a fait le trajet."""
    tone = workdir / f"ton_{secrets.token_hex(3)}.wav"
    music.test_tone(tone, gp)
    src = library.path_of(library.get(ref_id))
    r = subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-y", "-i", str(tone), "-stream_loop", "-1", "-i", str(src),
                        "-filter_complex", "[1:a]aresample=48000,lowpass=f=2400,aecho=0.8:0.6:90:0.3,volume=0.55[r];"
                                           "[0:a][r]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.9[o]",
                        "-map", "[o]", "-ac", "2", "-ar", "48000", "-c:a", "pcm_s16le", str(dest)],
                       capture_output=True, text=True, timeout=300)
    tone.unlink(missing_ok=True)
    if r.returncode != 0:
        raise RuntimeError(f"ffmpeg (inspiration d'essai) : {r.stderr.strip()[:300]}")


def run_ace_test(ctx):
    p = song_params(ctx.params)
    ids = []
    t0 = time.time()
    for k in range(p["n"]):
        ctx.check()
        ctx.progress(0.05 + 0.9 * k / p["n"], f"version {k + 1} / {p['n']} (moteur d'essai)")
        gp = ace_gen({**p, "seed": p["seed"] + k})
        dest = ctx.workdir / f"chanson_{k + 1:02d}.wav"
        if p["ref_mode"] == "inspire":
            fake_inspire(dest, p["ref"], gp, ctx.workdir)
        else:
            music.test_tone(dest, gp)
        ids.append(_store(ctx, p, dest, k, "factice")["id"])
    secs = round(time.time() - t0, 1)
    return {"note": f"{len(ids)} version{'s' if len(ids) > 1 else ''} d'essai en {secs:g} s (moteur factice)",
            "audio": ids, "render_seconds": secs}


def run_ace_real(ctx):
    p = song_params(ctx.params)
    ace_gen(p)                                            # les bornes d'ACE-Step, avant tout envoi
    pp = ace_of(p)
    style = None
    if p["ref_mode"] == "inspire":
        ctx.progress(0.03, "envoie la référence à ComfyUI")
        style = ctx.comfy.upload(library.path_of(library.get(p["ref"])))
    g = music_gen.build_ace_graph(pp, style)
    problems = music_yue.check_graph(g, music_yue.fetch_info(ctx.comfy, [n["class_type"] for n in g.values()]))
    if problems:
        raise ComfyError("graphe ACE-Step refusé avant l'envoi : " + " ; ".join(problems[:8]))
    t0 = time.time()
    paths = ctx.run_graph(g, prefix="chanson", label="ACE-Step 1.5", timeout=3600)
    secs = round(time.time() - t0, 1)
    # une seule graine pour le lot (EmptyAceStep1.5LatentAudio, batch_size) : chaque prise la garde, avec son rang
    ids = [_store(ctx, p, path, k, "comfyui", {"graph": music.GEN_GRAPH, "render_seconds": secs}, seed=p["seed"])["id"]
           for k, path in enumerate(paths)]
    if not ids:
        raise ComfyError("ComfyUI n'a rendu aucun son")
    return {"note": f"{len(ids)} version{'s' if len(ids) > 1 else ''} en {secs:g} s", "audio": ids, "render_seconds": secs}


def run_yue_test(ctx):
    p = song_params(ctx.params)
    ids = []
    t0 = time.time()
    for k in range(p["n"]):
        ctx.check()
        ctx.progress(0.05 + 0.9 * k / p["n"], f"version {k + 1} / {p['n']} (moteur d'essai)")
        yp = yue_of(p, k)
        dest = ctx.workdir / f"chanson_{k + 1:02d}.wav"
        score = music_yue.fake_render(dest, yp)
        ids.append(_store(ctx, p, dest, k, "factice", {"score": score[:music_yue.SCORE_KEEP]})["id"])
    secs = round(time.time() - t0, 1)
    return {"note": f"{len(ids)} version{'s' if len(ids) > 1 else ''} d'essai en {secs:g} s (moteur factice)",
            "audio": ids, "render_seconds": secs}


def run_yue_real(ctx):
    p = song_params(ctx.params)
    ids = []
    t0 = time.time()
    for k in range(p["n"]):
        ctx.check()
        ctx.progress(0.03 + 0.9 * k / p["n"], f"YuE2 · version {k + 1} / {p['n']}")
        yp = yue_of(p, k)
        for path, score in music_yue.render_real(ctx, yp):
            ids.append(_store(ctx, p, path, k, "comfyui", {"score": score, "checkpoint": music_yue.CKPTS[yp["precision"]]})["id"])
    if not ids:
        raise ComfyError("ComfyUI n'a rendu aucun son")
    secs = round(time.time() - t0, 1)
    return {"note": f"{len(ids)} version{'s' if len(ids) > 1 else ''} en {secs:g} s", "audio": ids, "render_seconds": secs}


# ── relire la partition avant de chanter (le plan de YuE2) ──
def plan_params(d: dict) -> dict:
    """La demande de la page (celle de Créer) : la recette jugée, sans partition ;
    seul YuE2 (Soigné, Reprendre) écrit une partition qu'on relit avant le rendu."""
    p = song_params({**d, "abc": ""}) if isinstance(d, dict) else song_params(d)
    if p["model"] != "yue":
        raise ValueError(f"pas de partition à relire avec {MODELS[p['model']]['name']} : {PLAN_WHY[p['model']]}")
    return p


def abc_resume(abc: str) -> dict:
    """Ce qu'une partition dit d'avance, en mots simples : tempo (Q:), mesure (M:),
    tonalité (K:), ses sections (`% verse`…, abc-editing.md) avec leurs mesures et
    leurs accords (sur la voix Vocal), la durée nominale. Une lecture de surface du
    dialecte de YuE2 pour la page ; le jugement complet reste abc_tools."""
    q = re.search(r"^Q:\s*(?:\d+/\d+\s*=\s*)?(\d+(?:\.\d+)?)", abc or "", re.M)
    m = re.search(r"^M:\s*(\d+)/(\d+)", abc or "", re.M)
    k = re.search(r"^K:\s*(\S+)", abc or "", re.M)
    sections, cur, voice = [], None, None
    for line in (abc or "").splitlines():
        t = line.strip()
        if not t:
            continue
        if t.startswith("%"):
            tag = t.lstrip("%").strip().lower()
            # la même étiquette redite à chaque groupe de mesures : la même section
            if tag and not (cur and cur["tag"] == tag):
                cur = {"tag": tag, "label": SECTION_FR.get(tag, tag.capitalize()), "bars": 0, "chords": []}
                sections.append(cur)
            continue
        mv = re.match(r"^\[?V:\s*([^\s\]]+)", t)
        if mv:
            voice = mv.group(1)
            continue
        if re.match(r"^[A-Za-z]:", t) or voice != "Vocal":
            continue
        if cur is None:
            cur = {"tag": "", "label": "—", "bars": 0, "chords": []}
            sections.append(cur)
        cur["bars"] += len(re.findall(r"\|+", t))
        for ch in re.findall(r'"([^"]+)"', t):
            if not cur["chords"] or cur["chords"][-1] != ch:
                cur["chords"].append(ch)
    for x in sections:
        x["chords"] = x["chords"][:24]
    bpm = float(q.group(1)) if q else None
    qpb = int(m.group(1)) * 4 / int(m.group(2)) if m else 4.0     # des noires par mesure
    bars = sum(x["bars"] for x in sections)
    return {"bpm": bpm, "meter": f"{m.group(1)}/{m.group(2)}" if m else "", "key": k.group(1) if k else "",
            "sections": sections, "bars": bars, "seconds": round(bars * qpb * 60 / bpm, 1) if bpm and bars else None}


def _lyric_sections(lyrics: str, vocal: bool) -> list[tuple[str, int]]:
    """Les sections des paroles ([Verse], [Chorus]…) et leur longueur en vers."""
    if not vocal or not lyrics.strip():
        return [("intro", 0), ("verse", 0), ("chorus", 0), ("outro", 0)]
    out = []
    for blk in re.split(r"\n(?=\s*\[)", lyrics.strip()):
        mt = re.match(r"\s*\[([^\]]+)\]", blk)
        tag = re.sub(r"[^a-z-]", "", (mt.group(1) if mt else "verse").lower().split()[0]) or "verse"
        lines = [x for x in blk.splitlines()[1 if mt else 0:] if x.strip()]
        out.append((tag if tag in SECTION_FR else "verse", len(lines)))
    return out


def fake_plan(p: dict) -> str:
    """La partition d'essai (moteur factice) : celle que YuE2 écrirait n'est pas
    connue sans lui ; on écrit, dans son dialecte (music_yue.fake_abc), une
    partition qui suit les sections des paroles (deux mesures par vers, notre
    choix pour l'essai), au tempo du style (« 96 BPM », sinon 96), à la durée
    demandée. Une reprise : la mélodie seule, comme SheetSage2 en « melody »."""
    bpm = music_yue._tempo(p["prompt"])
    secs = p["duration"]
    if p["ref_mode"] == "cover":
        it = library.get(p["ref"]) or {}
        secs = min(secs, float(it.get("duration") or secs))
        parts = [("verse", 0)]
    else:
        parts = _lyric_sections(p["lyrics"], p["vocal"])
    want = max(len(parts), int(round(secs * bpm / 240)))           # des mesures de 4/4
    raw = [max(2, 2 * n) if n else 4 for _, n in parts]
    k = want / sum(raw)
    sections = [[tag, max(1, int(round(r * k)))] for (tag, _), r in zip(parts, raw)]
    return music_yue.fake_abc(p["seed"], bpm, 4, 9, "minor", sections, sing=p["vocal"] or p["ref_mode"] == "cover",
                              chords=p["ref_mode"] != "cover")


def _plan_result(abc: str, engine_: str, p: dict, note: str) -> dict:
    return {"note": note, "abc": abc, "engine": engine_, "check": music_yue.abc_check(abc), "resume": abc_resume(abc),
            "seed": p["seed"], "model": "sheetsage2" if p["ref_mode"] == "cover" else "yue2"}


def run_plan_test(ctx):
    p = plan_params(ctx.params)
    ctx.progress(0.3, "partition d'essai (moteur factice)")
    return _plan_result(fake_plan(p), "factice", p, "partition d'essai écrite (moteur factice, pas YuE2)")


def run_plan_real(ctx):
    """Le plan réel : YuE2GenerateABC seul (le graphe de music_yue.build_abc_graph,
    le style et les paroles que le rendu lira), ou, pour une reprise, la mélodie de
    la référence par SheetSage2 (music_midi.build_sheetsage_graph, « melody »)."""
    from tools import music_midi
    p = plan_params(ctx.params)
    yp = yue_of({**p, "abc": ""})
    if p["ref_mode"] == "cover":
        ctx.progress(0.05, "envoie la référence à ComfyUI")
        name = ctx.comfy.upload(library.path_of(library.get(p["ref"])))
        g = music_midi.build_sheetsage_graph(name, "melody")
        label = "SheetSage2 · partition"
    else:
        g = music_yue.build_abc_graph({"tags": yp["tags"], "lyrics": yp["lyrics"], "seed": yp["seed"], "mode": "full",
                                       "precision": yp["precision"]})
        label = "YuE2 · partition"
    problems = music_yue.check_graph(g, music_yue.fetch_info(ctx.comfy, [n["class_type"] for n in g.values()]))
    if problems:
        raise ComfyError("graphe de la partition refusé avant l'envoi : " + " ; ".join(problems[:8]))
    pid = ctx.comfy.queue(g)
    entry = ctx.comfy.wait(pid, cancelled=ctx.cancelled, report=ctx.comfy_report(label), timeout=music_yue.TIMEOUT)
    abc = music_yue._score_of(entry, g)
    if not abc.strip():
        raise ComfyError("pas de partition rendue (sortie texte de PreviewAny vide)")
    return _plan_result(abc, "comfyui", p, "partition transcrite par SheetSage2" if p["ref_mode"] == "cover" else "partition écrite par YuE2")


# ── les paroles : « Écris-les pour moi » ────────────────────
# Paroles d'essai (moteur factice) : des vers écrits pour ces essais, tirés à
# la graine ; ce n'est pas un modèle — la page le dit (« essai »).
BANK = {
    "fr": {"verse": ["Les néons s'allument au bout de la rue", "J'ai gardé ton pull et la clé perdue",
                     "Le dernier métro file sans nous attendre", "On parlait trop fort pour ne rien entendre",
                     "La pluie dessine des routes sur la vitre", "Je compte les heures, je relis ton titre",
                     "Il reste un café froid sur le rebord", "Et ton rire qui traîne dans le corridor"],
           "chorus": ["Reste encore un peu, la nuit est à nous", "Danse avec moi jusqu'au bout de tout",
                      "Si demain s'efface, on garde ce soir", "Deux cœurs en lumière dans le noir"]},
    "en": {"verse": ["Streetlights hum along the empty road", "I kept your jacket and the key you stole",
                     "The midnight train is leaving without us", "We talked too loud to hear the thunder's hush",
                     "The rain is drawing maps across the glass", "I count the hours and let the minutes pass",
                     "There's a cold coffee sitting by the door", "And your laughter lingers on the floor"],
           "chorus": ["Stay a little longer, the night is ours", "Dance with me beneath the broken stars",
                      "If tomorrow fades, we'll keep tonight", "Two hearts burning in the neon light"]},
}


def fake_lyrics(prompt: str, language: str, seed: int) -> str:
    rng = random.Random(f"{seed}:{prompt}")
    b = BANK.get(language, BANK["en"])
    v1, v2 = rng.sample(b["verse"], 4), rng.sample(b["verse"], 4)
    ch = rng.sample(b["chorus"], 4)
    return "\n".join(["[Verse]", *v1, "", "[Chorus]", *ch, "", "[Verse]", *v2, "", "[Chorus]", *ch, "", "[Outro]", ch[0]])


def lyrics_params(d: dict) -> dict:
    if not isinstance(d, dict):
        raise ValueError("la demande est un objet")
    prompt = d.get("prompt")
    if not isinstance(prompt, str) or not prompt.strip():
        raise ValueError("décris d'abord la chanson : les paroles partent de sa description")
    prompt = prompt.strip()
    if len(prompt) > PROMPT_MAX:
        raise ValueError(f"la description tient en {PROMPT_MAX} signes au plus")
    language = d.get("language") or "fr"
    if language not in LANGS:
        raise ValueError(f"langue : {', '.join(LANGS)}")
    seed = d.get("seed")
    seed = random.randint(0, 2 ** 31 - 1) if seed in (None, "", -1) else _int(seed, 0, SEED_MAX, "graine")
    return {"prompt": prompt, "language": language, "seed": seed}


def ace_root() -> Path:
    return Path(config.get("chanson_acestep_dir") or HOME / "ACE-Step-1.5").expanduser()


def ace_python() -> Path:
    return Path(config.get("chanson_acestep_python") or ace_root() / ".venv/bin/python").expanduser()


def ace_lm() -> str:
    return str(config.get("chanson_paroles_lm") or "acestep-5Hz-lm-1.7B")


SCRIPT = Path(__file__).with_name("chanson_paroles.py")


def paroles_state() -> dict:
    """Le moteur réel des paroles : ses fichiers sur la machine du portail."""
    miss = [str(x) for x in (ace_python(), ace_root() / "checkpoints" / ace_lm(), SCRIPT) if not x.exists()]
    return {"engine": paroles_engine(), "ready_real": not miss, "why_real": ("absent : " + ", ".join(miss)) if miss else "",
            "model": f"ACE-Step 1.5 · {ace_lm()} (create_sample)", "switch": "\"chanson_paroles\": true",
            "source": "~/ACE-Step-1.5/docs/en/INFERENCE.md, create_sample (« Simple Mode » / « Inspiration Mode »)"}


def lyrics_command() -> list[str]:
    return [str(ace_python()), str(SCRIPT)]


def run_lyrics_test(ctx):
    p = lyrics_params(ctx.params)
    ctx.progress(0.5, "paroles d'essai (moteur factice)")
    return {"note": "paroles d'essai (moteur factice, pas un modèle)", "lyrics": fake_lyrics(p["prompt"], p["language"], p["seed"]),
            "engine": "factice", "language": p["language"]}


def run_lyrics_real(ctx):
    p = lyrics_params(ctx.params)
    st = paroles_state()
    if not st["ready_real"]:
        raise RuntimeError(st["why_real"])
    ctx.progress(0.1, "le modèle de langue d'ACE-Step écrit les paroles")
    req = {"root": str(ace_root()), "lm": ace_lm(), "query": p["prompt"], "language": p["language"], "temperature": 0.85}
    proc = subprocess.Popen(lyrics_command(), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            text=True, cwd=str(ace_root()))
    t0 = time.time()
    out = err = ""
    try:
        # la demande part par communicate (une seule fois : il ferme lui-même
        # l'entrée) ; les appels suivants ne font qu'attendre
        payload = json.dumps(req)
        while True:
            try:
                out, err = proc.communicate(input=payload, timeout=1.0)
                break
            except subprocess.TimeoutExpired:
                payload = None
                if ctx.cancelled():
                    raise Cancelled("arrêté")
                if time.time() - t0 > 900:
                    raise RuntimeError("les paroles prennent trop longtemps (> 15 min)")
    finally:
        if proc.poll() is None:              # arrêt par son PID, jamais par motif
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()
    lines = [ln for ln in (out or "").splitlines() if ln.startswith("{")]
    try:
        r = json.loads(lines[-1])
    except (IndexError, ValueError) as e:
        raise RuntimeError(f"le script des paroles n'a rien rendu : {(err or out or '').strip()[-400:]}") from e
    if not r.get("ok") or not (r.get("lyrics") or "").strip():
        raise RuntimeError(r.get("error") or "paroles vides")
    return {"note": f"paroles écrites en {time.time() - t0:.0f} s (ACE-Step 1.5)", "lyrics": r["lyrics"].strip(),
            "caption": r.get("caption", ""), "bpm": r.get("bpm"), "keyscale": r.get("keyscale", ""),
            "engine": "ace-step", "language": r.get("language") or p["language"]}


# ── la forme d'onde ─────────────────────────────────────────
def peaks(it: dict, n: int = WAVE_N) -> dict:
    """Le pic de chaque tranche (0 à 1), du son décodé par ffmpeg en mono
    8 kHz ; gardé sous l'identifiant de l'objet (un objet ne change jamais)."""
    cache = _dir() / "ondes"
    cache.mkdir(exist_ok=True)
    f = cache / f"{it['id']}.json"
    if f.exists():
        try:
            return json.loads(f.read_text(encoding="utf-8"))
        except ValueError:
            pass
    r = subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-i", str(library.path_of(it)), "-ac", "1", "-ar", "8000",
                        "-f", "s16le", "-"], capture_output=True, timeout=180)
    if r.returncode != 0:
        raise HttpError(500, "forme d'onde impossible : " + r.stderr.decode("utf-8", "replace")[-300:])
    a = array("h")
    a.frombytes(r.stdout[: len(r.stdout) // 2 * 2])
    total = len(a)
    out = []
    for i in range(n):
        seg = a[i * total // n:(i + 1) * total // n]
        out.append(round(max((abs(x) for x in seg), default=0) / 32768, 3))
    top = max(out) or 1.0
    d = {"id": it["id"], "peaks": [round(x / top, 3) for x in out], "duration": round(total / 8000, 3)}
    tmp = f.with_suffix(f".{secrets.token_hex(3)}.tmp")
    tmp.write_text(json.dumps(d), encoding="utf-8")
    tmp.replace(f)
    return d


# ── les chansons de la personne, leurs pistes, leur projet ODIO ──
def _is_stem(it: dict) -> bool:
    return bool((it.get("params") or {}).get("stem"))


def stems_of(song_id: str, items: list[dict] | None = None) -> list[dict]:
    """Les pistes séparées d'une chanson : la plus récente de chaque sorte."""
    if items is None:
        items = library.query(kinds=["audio"], tool=TOOL, limit=5000)["items"]
    seen: dict[str, dict] = {}
    for it in items:                                     # du plus récent au plus ancien
        pr = it.get("params") or {}
        if pr.get("src") == song_id and pr.get("stem") and pr["stem"] not in seen:
            seen[pr["stem"]] = it
    order = list(STEM_FR)
    return sorted(seen.values(), key=lambda it: order.index(it["params"]["stem"]) if it["params"]["stem"] in order else 99)


def _odio_link(song_id: str) -> str | None:
    pid = _read_json("odio.json").get(song_id, {}).get("project")
    if not pid:
        return None
    try:
        music._read(pid)
    except HttpError:
        return None
    return pid


# ── les Spaces (docs/etudes/musique_spaces_playlists.md § 2) ─
# Un Space (`msp-…`) est un dossier de travail de Musique, À L'INTÉRIEUR d'un
# Workspace — `space` est déjà le Workspace (core/espaces.py) : dans les données,
# le champ d'un objet s'appelle `music_space`. Décisions de Cal du 05/10 :
#   S1  un Space qu'on crée est PARTAGÉ avec le Workspace : on y voit les chansons
#       de tous ceux qui y créent ; « Mon Space » reste personnel — le Space par
#       défaut de chaque personne dans chaque Workspace : un objet sans
#       `music_space` y est, toutes les chansons d'avant comprises (sans migration) ;
#   S2  supprimer un Space renvoie ses chansons dans « Mon Space » de leur auteur ;
#       rien ne va à la corbeille.
# Un Space n'a pas de droits propres : il est jugé comme un document partagé de son
# Workspace (library.check_create, check_write ; auth.can_trash_item → espaces.can_*).
# Ce qui naît dans l'app va dans le Space courant de la page (une chanson, un son
# déposé ou importé) ; ce qui naît d'une chanson (une variante, des stems), dans
# celui de la chanson (la règle de Suno), même si la page en regarde un autre.
# La table : <data_dir>/chanson/spaces.json, une par Workspace —
#   {<esp-…>: {<msp-…>: {id, name, cover, color, created, owner, archived, deleted?}}}
# Juste par construction : le Space d'un objet est son `music_space` s'il nomme un
# Space vivant de son Workspace, sinon « Mon Space » de son auteur (space_of_item).
# Supprimer (S2) ne réécrit donc aucun objet — la fiche garde `deleted`, et Ctrl+Z
# la rend telle quelle ; un objet rapatrié d'un autre Workspace tombe dans « Mon Space ».
SPACES = "spaces.json"
MON, TOUS = "mon", "*"          # « Mon Space », « Tous les Spaces » : les mots des routes et de la page
MSP_RX = re.compile(r"msp-[0-9a-f]{12}")   # library.MUSIC_SPACE_RX en juge la forme dans un patch
# la couleur d'un Space : un nom de jeton de commun/tokens.css (règle 1 du thème), jamais l'orange (l'action)
SPACE_COLORS = ("cy", "grn2", "amb", "coral-2", "verd-2", "coral-3", "coral-1")
MOVE_MAX = 500


def _ws() -> str | None:
    """Le Workspace de la requête (ou du travail en cours) : celui où vivent ses Spaces."""
    return library.new_space(check=False)


def spaces_table(ws: str | None = None, *, deleted: bool = False) -> dict:
    """Les Spaces d'un Workspace (le courant par défaut) : {msp: fiche}, sans les supprimés."""
    t = _read_json(SPACES).get(ws or _ws() or "") or {}
    return {k: v for k, v in t.items() if isinstance(v, dict) and (deleted or not v.get("deleted"))}


def space_of_item(it: dict | None, table: dict | None = None) -> str:
    """Le Space d'un objet : son `music_space` s'il nomme un Space vivant de son
    Workspace (`table` : celle de ce Workspace, si on l'a déjà), sinon "" — « Mon
    Space » de son auteur (une chanson d'avant, un Space supprimé : S2)."""
    m = (it or {}).get("music_space") or ""
    if not m:
        return ""
    t = spaces_table(library.space_of(it)) if table is None else table
    return m if m in t else ""


def creatable_space(v) -> str:
    """Le Space où naît ce que la page crée (le `music_space` d'une demande) : ""
    (ou « mon ») pour « Mon Space », sinon un Space vivant et ouvert du Workspace
    courant. ValueError (400) qui dit pourquoi. Les volets voisins s'en servent
    (une playlist naît dans le Space courant)."""
    if v in (None, "", MON):
        return ""
    if not isinstance(v, str) or not MSP_RX.fullmatch(v):
        raise ValueError("Space : « mon » ou un identifiant msp-…")
    sp = spaces_table().get(v)
    if not sp:
        raise ValueError("ce Space n'est pas (ou plus) dans ce Workspace : choisis-en un autre dans le menu Space")
    if sp.get("archived"):
        raise ValueError(f"le Space « {sp['name']} » est archivé : rouvre-le (menu Space) pour y créer")
    return v


def birth_space(p: dict, asked: str = "") -> str:
    """Le Space d'une prise (p : la recette) : celui de la chanson d'origine quand
    elle en a une (une variante ; demain une prolongation), la règle de Suno, même si
    la page regarde un autre Space ; sinon celui que la page a demandé (le Space
    courant, jugé à l'envoi : s'il a disparu depuis, « Mon Space »)."""
    if p.get("parent"):
        return space_of_item(library.get(p["parent"]))
    return asked if asked and asked in spaces_table() else ""


def _song_rows(table: dict) -> tuple[list[dict], list[dict], str | None]:
    """Les sons de l'app dans ce Workspace (pistes comprises), les chansons que la
    personne peut voir ici avec leur Space (`_msp`) : les Spaces partagés (S1), et son
    « Mon Space » — jamais celui d'un autre."""
    items = library.query(kinds=["audio"], tool=TOOL, limit=5000)["items"]
    me = auth.current_id()
    rows = []
    for it in items:
        if _is_stem(it):
            continue
        m = space_of_item(it, table)
        if m or me is None or it.get("owner") == me:
            rows.append({**it, "_msp": m})
    return items, rows, me


def _counts(rows: list[dict]) -> dict:
    out: dict = {}
    for r in rows:
        k = r["_msp"] or MON
        out[k] = out.get(k, 0) + 1
    return out


def _space_doc(ws: str | None, sp: dict) -> dict:
    """Un Space vu par les juges de la bibliothèque : un document de son Workspace, partagé (S1)."""
    return {"id": sp["id"], "title": sp.get("name"), "space": ws, "owner": sp.get("owner"), "shared": True}


def space_public(ws: str | None, sp: dict, counts: dict | None = None) -> dict:
    u = auth.current()
    cov = library.get(sp["cover"]) if sp.get("cover") else None
    doc = _space_doc(ws, sp)
    return {**{k: sp.get(k) for k in ("id", "name", "color", "created", "owner", "cover")}, "archived": bool(sp.get("archived")),
            "owner_name": auth.display_name(sp["owner"]) if sp.get("owner") else "",
            "cover_url": library.public(cov).get("thumb_url") if cov and cov.get("kind") == "image" else None,
            "count": (counts or {}).get(sp["id"], 0),
            "can": {"edit": auth.can_write_item(doc, u), "delete": auth.can_trash_item(doc, u)}}


def api_spaces(req):
    """Les Spaces du Workspace courant, « Mon Space » d'abord ; ce que la personne y peut."""
    ws = _ws()
    table = spaces_table(ws)
    _, rows, _ = _song_rows(table)
    counts = _counts(rows)
    ok, why = (True, "")
    try:
        library.check_create(ws)
    except PermissionError as e:
        ok, why = False, str(e)
    spaces = sorted((space_public(ws, sp, counts) for sp in table.values()), key=lambda s: (s["archived"], (s["name"] or "").lower()))
    return {"workspace": ws, "mine": {"id": MON, "name": "Mon Space", "count": counts.get(MON, 0)},
            "spaces": spaces, "all": len(rows), "colors": list(SPACE_COLORS), "can_create": ok, "why_create": why}


def _space_name(v, table: dict, sid: str | None) -> str:
    from core import espaces
    name = espaces.clean_name(v, "le nom du Space")
    if name.lower() in ("mon space", "tous les spaces"):
        raise HttpError(400, f"« {name} » est un mot de la page : choisis un autre nom")
    if any(x["name"].lower() == name.lower() and x["id"] != sid for x in table.values()):
        raise HttpError(409, f"un Space s'appelle déjà « {name} » dans ce Workspace")
    return name


def _space_cover(v) -> str:
    if v in (None, ""):
        return ""
    it = library.get(v) if isinstance(v, str) else None
    if not it or it.get("kind") != "image":
        raise HttpError(400, "la pochette : une image de la bibliothèque, dans ce Workspace")
    return it["id"]


def _space_color(v, default: str) -> str:
    if v in (None, ""):
        return default
    if v not in SPACE_COLORS:
        raise HttpError(400, f"couleur : {', '.join(SPACE_COLORS)} (des jetons du thème)")
    return v


def api_spaces_post(req):
    """Créer (`action` « create » : name, color?, cover?), changer (« update » : id et
    name, color, cover, archived), supprimer (« delete », S2 : ses chansons retournent
    dans « Mon Space » de leur auteur), rendre un Space supprimé (« restore », Ctrl+Z)."""
    d = req.json()
    if not isinstance(d, dict):
        raise HttpError(400, "la demande est un objet")
    act = d.get("action") or ("update" if d.get("id") else "create")
    if act not in ("create", "update", "delete", "restore"):
        raise HttpError(400, "action : create, update, delete ou restore")
    ws = _ws()
    key = ws or ""
    me = auth.current_id() or auth.admin_id()
    with _lock:
        db = _read_json(SPACES)
        t = db.setdefault(key, {})
        live = {k: v for k, v in t.items() if isinstance(v, dict) and not v.get("deleted")}
        if act == "create":
            library.check_create(ws)          # créer un Space, c'est créer dans ce Workspace
            sid = f"msp-{secrets.token_hex(6)}"
            sp = {"id": sid, "name": _space_name(d.get("name"), live, None),
                  "cover": _space_cover(d.get("cover")),
                  "color": _space_color(d.get("color"), SPACE_COLORS[len(live) % len(SPACE_COLORS)]),
                  "created": library.now(), "owner": me, "archived": False}
            t[sid] = sp
        else:
            sid = d.get("id")
            sp = t.get(sid) if isinstance(sid, str) else None
            if not sp or (act != "restore") == bool(sp.get("deleted")):
                raise HttpError(404, "ce Space n'est pas (ou plus) dans ce Workspace")
            doc = _space_doc(ws, sp)
            if act == "update":
                library.check_write(doc)
                if "name" in d:
                    sp["name"] = _space_name(d["name"], live, sid)
                if "cover" in d:
                    sp["cover"] = _space_cover(d["cover"])
                if "color" in d:
                    sp["color"] = _space_color(d["color"], sp.get("color") or SPACE_COLORS[0])
                if "archived" in d:
                    if not isinstance(d["archived"], bool):
                        raise HttpError(400, "archived : vrai ou faux")
                    sp["archived"] = d["archived"]
            else:
                if not auth.can_trash_item(doc, auth.current()):
                    owner = auth.display_name(sp.get("owner")) or auth.admin_name()
                    raise PermissionError(f"« {sp['name']} » : seul·e {owner} (son auteur) ou un admin du Workspace le supprime "
                                          "ou le rend")
                if act == "delete":
                    sp.update(deleted=library.now(), deleted_by=me)
                else:
                    if any(x["name"].lower() == sp["name"].lower() for x in live.values()):
                        raise HttpError(409, f"un Space s'appelle déjà « {sp['name']} » : renomme-le avant de rendre celui-ci")
                    sp.pop("deleted", None)
                    sp.pop("deleted_by", None)
            sp["updated"] = library.now()
        _write_json(SPACES, db)
    table = spaces_table(ws)
    _, rows, _ = _song_rows(table)
    counts = _counts(rows)
    if act == "delete":
        # S2 : ses chansons sont déjà dans « Mon Space » de leur auteur (space_of_item) ; rien n'est réécrit
        back = sum(1 for it in library.query(kinds=["audio"], tool=TOOL, limit=5000)["items"]
                   if it.get("music_space") == sid and not _is_stem(it))
        return {"ok": True, "id": sid, "deleted": True, "returned": back}
    return space_public(ws, t[sid], counts)


def api_move(req):
    """Déplacer des objets vers un Space (`to` : « mon » ou msp-…) : `ids`, et les
    pistes séparées de chaque chanson, qui suivent leur chanson ; ou reposer un état
    d'avant (`restore` : {id: Space}, ce que rend `before` — Ctrl+Z). Tout ou rien :
    chaque objet est jugé (library.check_write) avant la première écriture. « Mon
    Space » est celui de l'auteur de chaque objet (S1 : il est personnel)."""
    d = req.json()
    if not isinstance(d, dict):
        raise HttpError(400, "la demande est un objet")
    table = spaces_table()
    plan: list[tuple[dict, str]] = []
    if d.get("restore") is not None:
        rs = d["restore"]
        if not isinstance(rs, dict) or not 1 <= len(rs) <= 4 * MOVE_MAX:
            raise HttpError(400, "restore : {objet: Space}")
        for iid, to in rs.items():
            if not isinstance(to, str) or (to and to not in table):
                raise HttpError(409, "un des Spaces d'avant n'existe plus : rien n'est reposé")
            it = library.get(iid)
            if not it:
                raise HttpError(404, f"introuvable : {iid}")
            plan.append((it, to))
    else:
        ids, to = d.get("ids"), d.get("to")
        if not isinstance(ids, list) or not 1 <= len(ids) <= MOVE_MAX or not all(isinstance(x, str) for x in ids):
            raise HttpError(400, f"ids : de 1 à {MOVE_MAX} objets")
        if to == MON:
            target = ""
        elif isinstance(to, str) and to in table:
            target = to
            if table[to].get("archived"):
                raise HttpError(409, f"le Space « {table[to]['name']} » est archivé : rouvre-le pour y ranger")
        else:
            raise HttpError(404, "ce Space n'est pas (ou plus) dans ce Workspace")
        its = []
        u = auth.current()
        for iid in dict.fromkeys(ids):
            it = library.get(iid)
            if not it:
                raise HttpError(404, f"introuvable : {iid}")
            # « Mon Space » est à chacun (S1) : on n'en sort pas la chanson d'un autre (Cal, si)
            who = auth.owner_of(it)
            if u is not None and not auth.is_admin(u) and not space_of_item(it, table) and who and who != u.get("id"):
                raise PermissionError(f"« {it.get('title') or iid} » est dans le « Mon Space » de {auth.display_name(who) or who} : "
                                      "seul·e son auteur l'en sort")
            its.append(it)
        songs = {it["id"] for it in its if it.get("kind") == "audio" and not _is_stem(it)}
        seen = {it["id"] for it in its}
        if songs:   # les pistes séparées suivent leur chanson (celles d'ODIO aussi)
            for x in library.query(kinds=["audio"], limit=10 ** 6)["items"]:
                pr = x.get("params") or {}
                if pr.get("stem") and pr.get("src") in songs and x["id"] not in seen:
                    st = library.get(x["id"])
                    if st:
                        its.append(st)
                        seen.add(st["id"])
        plan = [(it, target) for it in its]
    for it, _ in plan:
        library.check_write(it)
    me = auth.current_id()
    before, stems, elsewhere = {}, 0, 0
    for it, to in plan:
        old = space_of_item(it, table)
        if old == to and (it.get("music_space") or "") == to:
            continue
        library.update(it["id"], {"music_space": to})
        before[it["id"]] = old
        if _is_stem(it):
            stems += 1
        elif not to and me and auth.owner_of(it) != me:
            elsewhere += 1
    return {"moved": list(before), "before": before, "stems": stems, "elsewhere": elsewhere,
            "to": (d.get("to") if d.get("restore") is None else None)}


class _Depot:
    """La requête d'un dépôt, vue par core_api.lib_upload : son outil et son « via » sont ceux
    de Musique ; le reste (le corps, sa taille, les bornes d'un ami) est la requête même."""

    def __init__(self, req, **q) -> None:
        self._r, self._q = req, q

    def q(self, name: str, default: str = "") -> str:
        return self._q[name] if name in self._q else self._r.q(name, default)

    def __getattr__(self, name):
        return getattr(self._r, name)


def api_import(req):
    """PUT /api/chanson/import?name=…&title=…&space=…&as=ref|son — un son déposé dans
    l'app, rangé dans le Space courant dès sa naissance : une référence (`ref` : un
    dépôt comme un autre, outil « upload », hors des chansons) ou un son importé
    (`son` : outil « chanson », une carte de la scène, sans recette). Le dépôt lui-même
    (bornes, contenu conforme à son nom) est celui de la bibliothèque (core_api)."""
    from tools import core_api
    as_ = req.q("as") or "ref"
    if as_ not in ("ref", "son"):
        raise HttpError(400, "as : ref (une référence son) ou son (un son importé)")
    try:
        msp = creatable_space(req.q("space"))          # avant d'écrire quoi que ce soit
    except ValueError as e:
        raise HttpError(400, str(e)) from e
    name = req.q("name", "")
    if library.EXT_KIND.get(Path(name).suffix.lower()) != "audio":
        raise HttpError(415, "un son : wav, mp3, flac, m4a, ogg…")
    it = core_api.lib_upload(_Depot(req, tool="upload" if as_ == "ref" else TOOL, via="chanson" if as_ == "ref" else "import",
                                    folder="" if as_ == "ref" else "Musique"))
    if msp:   # dans la requête même du dépôt : la page ne le pose jamais
        it = library.public(library.update(it["id"], {"music_space": msp}))
    return it


def api_list(req):
    """Les chansons d'un Space (`space` : « mon » par défaut, msp-…, ou « * » : tous —
    les Spaces partagés et « Mon Space »), chacune avec son Space (`music_space`, ""
    pour « Mon Space »), ses pistes, son projet ODIO ; les comptes par Space. Un Space
    qui n'est plus là : « Mon Space » (`space` dit celui qui est montré)."""
    try:
        limit = max(1, min(200, int(req.q("limit", "60") or 60)))
    except ValueError as e:
        raise HttpError(400, "limit : un nombre") from e
    table = spaces_table()
    want = req.q("space", MON) or MON
    if want not in (MON, TOUS) and want not in table:
        want = MON
    items, rows, _ = _song_rows(table)
    songs = [r for r in rows if want == TOUS or (r["_msp"] or MON) == want]
    out = []
    for s in songs[:limit]:
        row = {k: v for k, v in s.items() if k != "_msp"}
        out.append({**row, "music_space": s["_msp"], "stems": stems_of(s["id"], items), "odio": _odio_link(s["id"])})
    return {"songs": out, "total": len(songs), "space": want, "counts": _counts(rows)}


def _tonic(key: str) -> dict | None:
    """« F minor », « Bb », « F#m » (partition ABC, K:) → la tonalité d'ODIO."""
    m = re.match(r"\s*([A-G])([#b]?)\s*(m(?!aj)|min|minor|major|maj)?", key or "")
    if not m:
        return None
    pc = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}[m.group(1)] + {"#": 1, "b": -1, "": 0}[m.group(2)]
    minor = (m.group(3) or "").startswith("m") and m.group(3) not in ("maj", "major")
    return {"tonic": pc % 12, "mode": "minor" if minor else "major"}


def song_meta(song: dict) -> tuple[float, dict | None]:
    """Le tempo et la tonalité d'une chanson : ceux de sa partition (YuE2 les
    écrit, Q: et K:), sinon ceux de sa recette (ACE-Step), sinon 120."""
    pr = song.get("params") or {}
    score = pr.get("score") or ""
    q = re.search(r"^Q:\s*1/4\s*=\s*(\d+)", score, re.M)
    k = re.search(r"^K:\s*(\S+)", score, re.M)
    rec = pr.get("chanson") or {}
    bpm = float(q.group(1)) if q else float(rec.get("bpm") or 120)
    key = _tonic(k.group(1)) if k else (_tonic(rec.get("key", "")) if rec.get("key") else None)
    return max(20.0, min(300.0, bpm)), key


def odio_project(song: dict, stems: list[dict]) -> dict:
    """Un projet ODIO (version 2, music.validate) : la chanson sur sa piste
    (muette quand ses pistes séparées sont là), puis une piste audio par stem,
    toutes au même départ et de la même longueur (music_stems les cale à
    l'échantillon près). Les pistes ont la forme de app.addTrack('audio') de
    musique/musique.js : un lecteur (`player`), sa tranche, la sortie."""
    bpm, key = song_meta(song)
    p = music.empty((song.get("title") or "Chanson")[:80])
    p["bpm"] = round(bpm, 2)
    if key:
        p["key"] = key
    master = p["modules"][0]["id"]
    rows = [(song, "Chanson", "coral-2", bool(stems))] + [
        (s, STEM_FR.get(s["params"]["stem"], s["params"]["stem"]).capitalize(), STEM_COLOR.get(s["params"]["stem"], "cy"), False)
        for s in stems]
    for i, (it, name, color, mute) in enumerate(rows):
        tid, src, strip = f"t{i + 1}", f"m{2 * i + 1}", f"m{2 * i + 2}"
        p["tracks"].append({"id": tid, "name": name[:60], "kind": "audio", "color": color, "mute": False, "solo": False,
                            "src": src, "strip": strip})
        y = 40 + 260 * i
        p["modules"] += [{"id": src, "type": "player", "track": tid, "x": 40, "y": y, "on": True, "params": {}},
                         {"id": strip, "type": "strip", "track": tid, "x": 380, "y": y, "on": True, "params": {}}]
        p["cables"] += [{"a": src, "b": strip}, {"a": strip, "b": master}]
        beats = max(0.25, float(it.get("duration") or 10) * bpm / 60)
        p["clips"].append({"id": f"c{i + 1}", "track": tid, "start": 0, "len": round(beats, 4), "item": it["id"], "off": 0,
                           "mute": mute, "name": name[:60]})
    p["modules"][0]["x"] = 760
    return p


def api_odio(req):
    """Ouvrir dans ODIO : un projet neuf avec la chanson et ses pistes ; le même
    projet tant que les pistes n'ont pas changé."""
    need_studio()
    d = req.json()
    song = library.get(d.get("item") or "") if isinstance(d.get("item"), str) else None
    if not song or song.get("kind") != "audio" or _is_stem(song):
        raise HttpError(400, "une chanson de la bibliothèque")
    stems = stems_of(song["id"])
    want = sorted(s["id"] for s in stems)
    links = _read_json("odio.json")
    old = links.get(song["id"]) or {}
    pid = _odio_link(song["id"])
    if pid and sorted(old.get("stems") or []) == want:
        return {"id": pid, "open": f"musique/?p={pid}", "created": False, "tracks": len(want) + 1}
    p = odio_project(song, stems)
    now = library.now()
    p.update(id=f"mus-{time.strftime('%Y%m%d-%H%M%S')}-{secrets.token_hex(2)}", rev=1, created=now, updated=now)
    library.stamp(p, source=song)   # son auteur ; son Workspace : celui de la chanson (403 si l'on n'y crée pas)
    try:
        music.validate(p)
    except ValueError as e:
        raise HttpError(500, f"projet ODIO refusé : {e}") from e
    with music._lock:                        # le même verrou et la même écriture que create_project
        music._write(p)
    with _lock:
        links = _read_json("odio.json")
        links[song["id"]] = {"project": p["id"], "stems": want, "at": now}
        _write_json("odio.json", links)
    return {"id": p["id"], "open": f"musique/?p={p['id']}", "created": True, "tracks": len(p["tracks"])}


# ── les routes ──────────────────────────────────────────────
def _submit(p: dict, title: str, msp: str = ""):
    # le Space courant voyage avec le travail, à côté de la recette (une variante ne le rejoue pas)
    j = jobs.submit(f"chanson.{p['model']}", {**p, "music_space": msp} if msp else p, title=title[:90], tool=TOOL)
    return jobs.public(j)


def api_create(req):
    d = req.json()
    try:
        p = song_params(d)
        msp = creatable_space(d.get("music_space"))     # le Space courant de la page
    except (ValueError, TypeError) as e:
        raise HttpError(400, str(e)) from e
    return _submit(p, f"Chanson · {p['title']}", msp)


def api_variant(req):
    """Une variante : la recette de la chanson, une autre graine, une version."""
    d = req.json()
    it = library.get(d.get("item") or "") if isinstance(d.get("item"), str) else None
    rec = ((it or {}).get("params") or {}).get("chanson")
    if not it or not isinstance(rec, dict):
        raise HttpError(400, "une chanson de l'app (sa recette manque)")
    try:
        p = song_params({**rec, "adv": {k: rec.get(k) for k in ADV.get(rec.get("model"), ())},
                         "n": 1, "seed": -1, "parent": it["id"]})
    except (ValueError, TypeError) as e:
        raise HttpError(400, f"la recette ne passe plus : {e}") from e
    return _submit(p, f"Variante · {p['title']}")


def api_plan(req):
    """Relire avant de chanter : la partition seule (travail `chanson.plan`)."""
    try:
        p = plan_params(req.json())
    except (ValueError, TypeError) as e:
        raise HttpError(400, str(e)) from e
    j = jobs.submit("chanson.plan", {**req.json(), "seed": p["seed"]}, title=f"Partition · {p['title']}"[:90], tool=TOOL)
    return jobs.public(j)


def api_plan_read(req):
    """Une partition retouchée à la main : ce qu'elle dit (abc_resume) et son jugement (abc_tools)."""
    abc = (req.json() or {}).get("abc")
    if not isinstance(abc, str) or not abc.strip() or len(abc) > music_yue.MAX_ABC:
        raise HttpError(400, f"partition : un texte de 1 à {music_yue.MAX_ABC} signes")
    return {"resume": abc_resume(abc), "check": music_yue.abc_check(abc)}


def api_lyrics(req):
    try:
        p = lyrics_params(req.json())
    except (ValueError, TypeError) as e:
        raise HttpError(400, str(e)) from e
    pin = music_stems._local_audio_endpoint() if paroles_engine() == "reel" else None
    j = jobs.submit("chanson.paroles", p, title=f"Paroles · {p['prompt'][:60]}", tool=TOOL, pin=pin)
    return jobs.public(j)


def _stem_model() -> dict:
    o = music_stems.options()
    m = next((x for x in o["models"] if x["id"] == o["recommended"]), None)
    if not m or not m["ready"]:
        why = (m or {}).get("why") or "aucun modèle de séparation prêt"
        raise HttpError(409, f"séparation indisponible : {why}")
    return m


def api_stems(req):
    need_studio()
    d = req.json()
    try:
        src = _audio(d.get("item"), "la chanson")
        if _is_stem(library.get(src)):
            raise ValueError("c'est déjà une piste séparée")
        m = _stem_model()
        p = music_stems.stems_params({"src": src, "model": m["id"], "stems": m["stems"]})
    except (ValueError, TypeError) as e:
        raise HttpError(400, str(e)) from e
    return jobs.public(music_stems.submit(p, tool=TOOL))


def api_studio_ask(req):
    """L'ancienne route de l'app Musique : la demande du portail (POST /api/auth/studio)."""
    r = auth.request_studio(auth.current())
    return {"ok": r["ok"], "asked": r["asked"]}


def api_wave(req, item_id):
    if not library.ID_RE.fullmatch(item_id or ""):
        raise HttpError(400, "objet invalide")
    it = library.get(item_id)
    if not it or it.get("kind") != "audio":
        raise HttpError(404, "pas de son pour cet objet")
    return peaks(it)


def _ready(model: str) -> tuple[bool, str]:
    cpu = bool(config.get("lanes", {}).get("cpu"))
    if engine(model) == "factice":
        return cpu, ("" if cpu else "aucune voie « cpu » dans la configuration du portail")
    if model == "ace":
        g = music.engines().get("generate") or {}
        return bool(g.get("ok")), g.get("why", "")
    o = music_yue.options()
    return bool(o["ready"]), o.get("why", "")


def options(req=None) -> dict:
    models = {}
    for mid, M in MODELS.items():
        ok, why = _ready(mid)
        models[mid] = {"name": M["name"], "full": M["full"], "engine": engine(mid), "ready": ok, "why": why,
                       "min": M["dur"][0], "max": M["dur"][1], "switch": M["switch"], "source": M["source"],
                       "adv": list(ADV[mid])}
    refs = {}
    for rid, R in REFS.items():
        m = models[R["model"]]
        ok, why = m["ready"], m["why"]
        if ok and rid == "cover" and engine("yue") == "reel":
            yo = music_yue.options()
            ok, why = bool(yo.get("ref_ready")), ("" if yo.get("ref_ready") else "SheetSage2 manque aux machines de la voie audio")
        refs[rid] = {"label": R["label"], "about": R["about"], "model": R["model"], "ready": ok, "why": why,
                     "source": R["source"], "experimental": rid == "inspire"}
    try:
        sm = _stem_model()
        stems = {"ready": True, "why": "", "model": sm["label"], "stems": sm["stems"], "engine": music_stems.mode()}
    except HttpError as e:
        stems = {"ready": False, "why": e.message, "engine": music_stems.mode()}
    ps = paroles_state()
    cpu = bool(config.get("lanes", {}).get("cpu"))
    lyr = {"engine": ps["engine"], "ready": cpu if ps["engine"] == "factice" else ps["ready_real"],
           "why": "" if ps["engine"] == "factice" or ps["ready_real"] else ps["why_real"], "model": ps["model"],
           "switch": ps["switch"], "source": ps["source"]}
    plan = {"default": True, "preset": DEFAULT_PRESET, "engine": engine("yue"),
            "models": {mid: {"ok": mid == "yue", "why": PLAN_WHY.get(mid, "")} for mid in MODELS},
            "check": music_yue.abc_tools_state(),
            "source": "~/YuE/docs/editing.md (« white-box ») ; nodes_yue2.py:53 (« supply an edited score ») ; "
                      "docs/etudes/musique_generatif.md § 1.2-1.4"}
    return {"presets": [{"id": k, **v} for k, v in PRESETS.items()], "default_preset": DEFAULT_PRESET, "plan": plan,
            "models": models, "refs": refs,
            "durations": list(DURATIONS), "languages": [{"id": k, "label": v[0]} for k, v in LANGS.items()],
            "keys": music.KEYSCALES, "max_n": MAX_N, "prompt_max": PROMPT_MAX, "lyrics": lyr, "stems": stems,
            "studio": studio_state(), "odio": "musique/?p="}


def api_options(req):
    return options(req)


def register(app) -> None:
    for model in ("ace", "yue"):
        real = engine(model) == "reel"
        fn = {("ace", False): run_ace_test, ("ace", True): run_ace_real,
              ("yue", False): run_yue_test, ("yue", True): run_yue_real}[(model, real)]
        jobs.register(f"chanson.{model}", fn, lane="audio" if real else "cpu",
                      title=f"Chanson · {MODELS[model]['name']}" + ("" if real else " (essai)"),
                      family="ace-step" if model == "ace" else "yue", gpu=real, cost="gpu" if real else "cpu")
    preal = engine("yue") == "reel"
    jobs.register("chanson.plan", run_plan_real if preal else run_plan_test, lane="audio" if preal else "cpu",
                  title="Partition" + ("" if preal else " (essai)"), family="yue" if preal else None, gpu=preal,
                  cost="gpu" if preal else "cpu")
    lreal = paroles_engine() == "reel"
    jobs.register("chanson.paroles", run_lyrics_real if lreal else run_lyrics_test, lane="audio" if lreal else "cpu",
                  title="Paroles" + ("" if lreal else " (essai)"), family="ace-step-lm" if lreal else None, gpu=lreal, cost="gpu" if lreal else "cpu")
    app.route("GET", "/api/chanson/options", api_options)
    app.route("GET", "/api/chanson/list", api_list)
    app.route("POST", "/api/chanson/create", api_create)
    app.route("POST", "/api/chanson/variant", api_variant)
    app.route("POST", "/api/chanson/paroles", api_lyrics)
    app.route("POST", "/api/chanson/plan", api_plan)
    app.route("POST", "/api/chanson/plan/lire", api_plan_read)
    app.route("POST", "/api/chanson/stems", api_stems)
    app.route("POST", "/api/chanson/odio", api_odio)
    app.route("POST", "/api/chanson/studio/demande", api_studio_ask)
    app.route("GET", "/api/chanson/onde/{item_id}", api_wave)
    app.route("GET", "/api/chanson/spaces", api_spaces)
    app.route("POST", "/api/chanson/spaces", api_spaces_post)
    app.route("POST", "/api/chanson/spaces/move", api_move)
    app.route("PUT", "/api/chanson/import", api_import)


# ── le contrôle sans GPU (tools/check.py) ───────────────────
def selftest(call, ok) -> None:
    st, o = call("GET", "/api/chanson/options")
    ok(st == 200 and [p["id"] for p in o.get("presets", [])] == ["rapide", "soigne"]
       and o["presets"][0]["model"] == "ace" and o["presets"][1]["model"] == "yue",
       f"chanson : deux préréglages en mots simples, le modèle derrière ({st})")
    ok(o.get("models", {}).get("ace", {}).get("engine") == "factice" and o["models"]["yue"]["engine"] == "factice"
       and o["models"]["ace"]["ready"] and o["models"]["yue"]["ready"], "chanson : moteurs factices prêts")
    ok(o.get("studio", {}).get("ok") is True and o.get("stems", {}).get("ready") is True and o.get("lyrics", {}).get("ready"),
       f"chanson : Studio (porte coupée = Cal), séparation et paroles prêtes ({o.get('stems')})")

    ok(o.get("default_preset") == "soigne" and o.get("plan", {}).get("default") is True
       and o["plan"]["models"]["yue"]["ok"] and not o["plan"]["models"]["ace"]["ok"] and "ACE-Step" in o["plan"]["models"]["ace"]["why"],
       f"chanson : Soigné par défaut, relire la partition par défaut, Rapide dit pourquoi il n'a rien à relire ({o.get('plan')})")
    base = {"prompt": "pop mélancolique, piano, 96 BPM", "lyrics": "[Verse]\nla nuit\n[Chorus]\nreste", "duration": 12,
            "preset": "rapide"}
    ok(song_params({k: v for k, v in base.items() if k != "preset"})["model"] == "yue",
       "chanson : sans préréglage, Soigné (YuE2) — le défaut du 05/10")
    p = song_params(base)
    ok(p["model"] == "ace" and p["bpm"] == 96 and p["key"] == DEFAULT_KEY and p["n"] == 1 and p["language"] == "fr",
       f"recette rapide : ACE-Step, le tempo lu dans le style ({p.get('bpm')})")
    ok(song_params({**base, "preset": "soigne"})["model"] == "yue", "recette soignée : YuE2")
    y = yue_of(song_params({**base, "preset": "soigne", "seed": 5}), 2)
    ok(y["tags"].startswith("French, ") and y["seed"] == 7 and y["mode"] == "full" and y["lyrics"].startswith("[Verse]"),
       f"YuE2 : la langue dans le style, graine + rang ({y['tags'][:40]})")
    ok(ace_gen(song_params({**base, "vocal": False, "lyrics": ""}))["lyrics"] == "[Instrumental]", "ACE-Step : instrumental")
    for bad, why in (({"prompt": ""}, "sans description"),
                     ({**base, "lyrics": ""}, "chanté sans paroles"),
                     ({**base, "vocal": False}, "instrumental avec paroles"),
                     ({**base, "duration": 700}, "700 s avec ACE-Step (600 au plus)"),
                     ({**base, "duration": 5, "preset": "soigne"}, "5 s avec YuE2"),
                     ({**base, "n": 5}, "5 versions"),
                     ({**base, "adv": {"precision": "int8"}}, "une précision pour ACE-Step"),
                     ({**base, "preset": "soigne", "adv": {"bpm": 100}}, "un tempo pour YuE2"),
                     ({**base, "adv": {"key": "H major"}}, "tonalité inconnue"),
                     ({**base, "ref_mode": "cover"}, "reprendre sans référence"),
                     ({**base, "ref": "aud-nexiste-pas", "ref_mode": "cover"}, "référence absente"),
                     ({**base, "prompt": "x" * 600}, "description trop longue")):
        try:
            song_params(bad)
            ok(False, f"chanson : refusé — {why}")
        except ValueError:
            ok(True, f"chanson : refusé — {why}")
    ok(song_params({**base, "duration": 700, "preset": "soigne"})["duration"] == 700, "YuE2 : 700 s acceptées (900 au plus)")

    def wait(jid):
        jj = {}
        for _ in range(600):
            _, jj = call("GET", f"/api/jobs/{jid}")
            if jj.get("state") in ("done", "error", "cancelled"):
                return jj
            time.sleep(0.2)
        return jj

    st, j = call("POST", "/api/chanson/create", {**base, "n": 2, "seed": 40})
    ok(st == 200 and j.get("kind") == "chanson.ace" and j.get("tool") == TOOL, f"chanson rapide en file ({st} {str(j)[:160]})")
    j = wait(j["id"]) if st == 200 else {}
    its = j.get("items") or []
    ok(j.get("state") == "done" and len(its) == 2 and all(abs((i.get("duration") or 0) - 12) < 0.05 for i in its)
       and its[0]["params"]["chanson"]["prompt"] == base["prompt"] and "(essai)" in its[0]["title"]
       and its[0]["origin"]["tool"] == TOOL and [i["params"]["seed"] for i in its] == [40, 41],
       f"deux versions d'essai de 12 s, la recette rangée ({j.get('state')} {j.get('message')})")
    if not its:
        return
    song = its[0]
    st, w = call("GET", f"/api/chanson/onde/{song['id']}")
    ok(st == 200 and len(w.get("peaks", [])) == WAVE_N and max(w["peaks"]) == 1.0 and abs(w["duration"] - 12) < 0.1,
       f"la forme d'onde : {WAVE_N} pics ({st})")

    st, j2 = call("POST", "/api/chanson/create", {**base, "preset": "soigne", "duration": 10, "seed": 3})
    j2 = wait(j2["id"]) if st == 200 else {}
    y1 = (j2.get("items") or [{}])[0]
    ok(j2.get("state") == "done" and j2.get("kind") == "chanson.yue" and (y1.get("params") or {}).get("score", "").startswith("X:1"),
       f"chanson soignée d'essai, avec sa partition ({j2.get('state')} {j2.get('message')})")

    # relire la partition avant de chanter (le plan de YuE2), puis la chanter telle quelle
    soigne = {**base, "preset": "soigne", "duration": 30, "seed": 11,
              "lyrics": "[Verse]\nla nuit tombe\nsur la ville\n[Chorus]\nreste encore\nun peu\n[Verse]\nle métro file\nsans nous\n[Chorus]\nreste encore\nun peu"}
    st, jp = call("POST", "/api/chanson/plan", soigne)
    ok(st == 200 and jp.get("kind") == "chanson.plan" and jp.get("tool") == TOOL, f"relire : la partition en file ({st} {str(jp)[:120]})")
    jp = wait(jp["id"]) if st == 200 else {}
    pr = jp.get("result") or {}
    rs = pr.get("resume") or {}
    ok(jp.get("state") == "done" and pr.get("abc", "").startswith("X:1") and pr.get("engine") == "factice"
       and [x["tag"] for x in rs.get("sections", [])] == ["verse", "chorus", "verse", "chorus"]
       and rs.get("bpm") == 96 and rs.get("meter") == "4/4" and rs.get("bars", 0) >= 8 and all(x["chords"] for x in rs["sections"])
       and abs((rs.get("seconds") or 0) - 30) <= 6,
       f"relire : la partition d'essai suit les sections des paroles, au tempo du style ({jp.get('state')} {rs})")
    st, bad = call("POST", "/api/chanson/plan", base)
    ok(st == 400 and "ACE-Step" in bad.get("error", ""), f"relire avec Rapide : refusé, la raison dite ({st} {bad})")
    st, lu = call("POST", "/api/chanson/plan/lire", {"abc": pr.get("abc", "")})
    ok(st == 200 and lu.get("resume") == rs and "ok" in lu.get("check", {}), f"relire : une partition retouchée se relit ({st})")
    abc = pr.get("abc", "")
    st, jw = call("POST", "/api/chanson/create", {**soigne, "abc": abc, "n": 2})
    jw = wait(jw["id"]) if st == 200 else {}
    w1 = jw.get("items") or [{}]
    ok(jw.get("state") == "done" and jw.get("kind") == "chanson.yue" and len(w1) == 2
       and all(x.get("params", {}).get("score") == abc and x["params"]["chanson"]["abc"] == abc for x in w1),
       f"chanter la partition relue : deux versions, la partition rangée telle quelle ({jw.get('state')} {jw.get('message')})")
    st, bad = call("POST", "/api/chanson/create", {**base, "abc": abc})
    ok(st == 400 and "YuE2" in bad.get("error", ""), f"une partition avec Rapide : refusée ({st})")
    yv = yue_of(song_params({**soigne, "abc": abc}))
    ok(yv["abc"] == abc and yv["mode"] == "full" and not yv["ref"] and "2" not in music_yue.build_graph(yv)
       and music_yue.build_graph(yv)["3"]["inputs"]["abc"] == abc and music_yue.check_graph(music_yue.build_graph(yv), music_yue.FAKE_INFO) == [],
       "le graphe réel d'une partition relue : pas de YuE2GenerateABC, la partition dans YuE2GenerateMusic.abc, jugé bon")
    gp = music_yue.build_abc_graph({"tags": yv["tags"], "lyrics": yv["lyrics"], "seed": yv["seed"], "mode": "full", "precision": "bf16"})
    ok(music_yue.check_graph(gp, music_yue.FAKE_INFO) == [] and gp["2"]["inputs"]["lyrics"] == yv["lyrics"],
       "le graphe réel du plan : YuE2GenerateABC seul, les paroles que le rendu lira, jugé bon")
    ok(abc_resume('X:1\nM:3/4\nL:1/16\nQ:1/4=90\nV: Vocal clef=treble name="Vocal Melody" snm="Vocal"\nK:Am\n% chorus\n'
                  'V: Vocal\n"Am"A12|"F"F12|"F"c12|\nV: Ins\nZ3|') ==
       {"bpm": 90.0, "meter": "3/4", "key": "Am", "bars": 3, "seconds": 6.0,
        "sections": [{"tag": "chorus", "label": "Refrain", "bars": 3, "chords": ["Am", "F"]}]},
       "la lecture d'une partition : tempo, mesure, tonalité, sections, accords, durée")

    st, jv = call("POST", "/api/chanson/variant", {"item": song["id"]})
    jv = wait(jv["id"]) if st == 200 else {}
    v1 = (jv.get("items") or [{}])[0]
    ok(jv.get("state") == "done" and v1.get("parents") == [song["id"]] and v1["params"]["chanson"]["prompt"] == base["prompt"]
       and v1["params"]["seed"] != song["params"]["seed"], f"une variante : même recette, autre graine, lignée ({jv.get('state')})")

    st, ji = call("POST", "/api/chanson/create", {**base, "ref": song["id"], "ref_mode": "inspire"})
    ji = wait(ji["id"]) if st == 200 else {}
    i1 = (ji.get("items") or [{}])[0]
    ok(ji.get("state") == "done" and i1.get("parents") == [song["id"]] and ji.get("kind") == "chanson.ace",
       f"s'en inspirer (essai) : ACE-Step, la référence en parent ({ji.get('state')} {ji.get('message')})")
    st, jc = call("POST", "/api/chanson/create", {**base, "ref": song["id"], "ref_mode": "cover", "duration": 10})
    jc = wait(jc["id"]) if st == 200 else {}
    c1 = (jc.get("items") or [{}])[0]
    ok(jc.get("state") == "done" and jc.get("kind") == "chanson.yue" and c1.get("parents") == [song["id"]],
       f"reprendre (essai) : YuE2, la référence en parent ({jc.get('state')} {jc.get('message')})")
    st, jr = call("POST", "/api/chanson/plan", {**base, "preset": "soigne", "ref": song["id"], "ref_mode": "cover", "duration": 10})
    jr = wait(jr["id"]) if st == 200 else {}
    rr = jr.get("result") or {}
    ok(jr.get("state") == "done" and rr.get("model") == "sheetsage2" and rr.get("resume", {}).get("bars", 0) >= 1
       and not any(x["chords"] for x in rr["resume"]["sections"]),
       f"relire une reprise : la mélodie de la référence (SheetSage2, mélodie seule) ({jr.get('state')} {jr.get('message')})")
    st, jk = call("POST", "/api/chanson/create", {**base, "preset": "soigne", "ref": song["id"], "ref_mode": "cover", "duration": 10,
                                                   "abc": rr.get("abc", "")})
    jk = wait(jk["id"]) if st == 200 else {}
    k1 = (jk.get("items") or [{}])[0]
    ok(jk.get("state") == "done" and k1.get("parents") == [song["id"]] and k1.get("params", {}).get("score") == rr.get("abc"),
       f"reprendre une partition relue : la référence reste en parent ({jk.get('state')} {jk.get('message')})")
    st, bad = call("POST", "/api/chanson/create", {**base, "ref": song["id"], "ref_mode": "cover", "model": "ace"})
    ok(st == 400 and "YuE2" in bad.get("error", ""), f"reprendre avec ACE-Step : refusé, la raison dite ({st})")

    # le graphe réel, jugé à vide contre le schéma des nœuds (rien n'est envoyé)
    gi = music_gen.build_ace_graph(ace_of(song_params({**base, "ref": song["id"], "ref_mode": "inspire", "n": 2})), "ref.flac")
    ok(music_yue.check_graph(gi, music_gen.FAKE_INFO_ACE) == [] and gi["3"]["inputs"]["positive"] == ["122", 0]
       and gi["98"]["inputs"]["batch_size"] == 2, f"graphe « s'en inspirer » : ReferenceTimbreAudio, jugé bon ({music_yue.check_graph(gi, music_gen.FAKE_INFO_ACE)})")
    yc = yue_of(song_params({**base, "ref": song["id"], "ref_mode": "cover"}))
    gc = music_yue.build_graph(yc, "ref.flac")
    ok(yc["mode"] == "melody" and yc["ref"] == song["id"] and music_yue.check_graph(gc, music_yue.FAKE_INFO) == [],
       "graphe « reprendre » : SheetSage2 → partition → YuE2, jugé bon")

    st, jl = call("POST", "/api/chanson/paroles", {"prompt": "folk d'automne", "language": "fr", "seed": 2})
    jl = wait(jl["id"]) if st == 200 else {}
    lyr = (jl.get("result") or {}).get("lyrics", "")
    ok(jl.get("state") == "done" and "[Verse]" in lyr and "[Chorus]" in lyr and song_params({**base, "lyrics": lyr})["lyrics"],
       f"écris-les pour moi (essai) : des sections que YuE2 et ACE-Step lisent ({jl.get('state')})")
    st, bad = call("POST", "/api/chanson/paroles", {"prompt": ""})
    ok(st == 400, "des paroles sans description : refusé")
    ps = paroles_state()
    ok(lyrics_command()[1].endswith("chanson_paroles.py") and "create_sample" in ps["source"], "le script des paroles, sa source")

    st, js = call("POST", "/api/chanson/stems", {"item": song["id"]})
    ok(st == 200 and js.get("kind") == "music.stems" and js.get("tool") == TOOL, f"séparer : music.stems, rangé sous l'app ({st})")
    js = wait(js["id"]) if st == 200 else {}
    st, lst = call("GET", "/api/chanson/list")
    row = next((s for s in lst.get("songs", []) if s["id"] == song["id"]), {})
    ok(js.get("state") == "done" and len(row.get("stems", [])) == 4 and all(s["params"]["src"] == song["id"] for s in row["stems"])
       and not any(s["id"] in {x["id"] for x in row["stems"]} for s in lst["songs"]),
       f"la liste : la chanson et ses quatre pistes, les pistes hors de la liste ({js.get('state')} {len(row.get('stems', []))})")
    st, od = call("POST", "/api/chanson/odio", {"item": song["id"]})
    pj = music._read(od["id"]) if st == 200 else {}
    items_in = [c["item"] for c in pj.get("clips", [])]
    ok(st == 200 and od["created"] and len(pj.get("tracks", [])) == 5 and all(t["kind"] == "audio" for t in pj["tracks"])
       and items_in[0] == song["id"] and set(items_in[1:]) == {s["id"] for s in row["stems"]} and pj["clips"][0]["mute"]
       and pj["bpm"] == 96 and od["open"] == f"musique/?p={od['id']}",
       f"ouvrir dans ODIO : un projet, la chanson (muette) et ses pistes au même départ ({st} {od})")
    try:
        music.validate(pj)
        ok(True, "le projet ODIO passe music.validate")
    except ValueError as e:
        ok(False, f"le projet ODIO passe music.validate ({e})")
    st, od2 = call("POST", "/api/chanson/odio", {"item": song["id"]})
    ok(st == 200 and od2["id"] == od["id"] and od2["created"] is False, "ouvrir encore : le même projet")
    st, lst = call("GET", "/api/chanson/list")
    ok(next((s for s in lst["songs"] if s["id"] == song["id"]), {}).get("odio") == od["id"], "la liste dit le projet ODIO")
    st, od3 = call("POST", "/api/chanson/odio", {"item": y1.get("id", "")})
    pj3 = music._read(od3["id"]) if st == 200 else {}
    ok(st == 200 and len(pj3.get("tracks", [])) == 1 and not pj3["clips"][0].get("mute"),
       f"ouvrir dans ODIO sans pistes séparées : la chanson seule ({st})")
    ok(song_meta({"params": {"score": "X:1\nQ:1/4=88\nK:Fm\n"}}) == (88.0, {"tonic": 5, "mode": "minor"})
       and song_meta({"params": {"chanson": {"bpm": 110, "key": "D major"}}}) == (110.0, {"tonic": 2, "mode": "major"}),
       "tempo et tonalité : la partition d'abord, puis la recette")

    # le Studio : un ami sans le droit ne sépare pas, ne va pas dans ODIO
    ami = {"id": "ami-essai", "name": "Ami", "role": "ami", "state": "active"}
    ok(studio_state(ami, current=False)["ok"] is False and studio_state({**ami, "access": "studio"}, current=False)["ok"]
       and studio_state({**ami, "role": "admin"}, current=False)["ok"], "Studio : un ami non, l'accès studio ou un admin oui")
    auth.set_current(ami)
    try:
        try:
            need_studio()
            ok(False, "Studio : un ami est refusé (403)")
        except HttpError as e:
            ok(e.status == 403 and "Studio" in str(e), "Studio : un ami est refusé (403), la raison dite")
    finally:
        auth.set_current(None)

    _selftest_spaces(call, ok, wait, base, song, v1)


def _selftest_spaces(call, ok, wait, base: dict, song: dict, v1: dict) -> None:
    """Les Spaces (musique_spaces_playlists.md § 2) : la naissance, la variante qui
    reste dans le Space d'origine, les pistes qui suivent, l'import, déplacer et
    Ctrl+Z, archiver, supprimer (S2) ; puis S1 et S2 entre deux personnes."""
    import io

    from PIL import Image

    st, s0 = call("GET", "/api/chanson/spaces")
    ok(st == 200 and s0.get("mine", {}).get("id") == MON and s0["mine"]["name"] == "Mon Space" and s0.get("workspace")
       and s0.get("can_create") is True and s0.get("colors") == list(SPACE_COLORS),
       f"spaces : « Mon Space » d'abord, le Workspace, créer permis ({st} {str(s0)[:160]})")
    ok(s0["mine"]["count"] >= 2, f"spaces : les chansons d'avant sont dans « Mon Space », sans migration ({s0['mine']['count']})")
    ok("music_space" not in song and "music_space" not in v1, "une chanson et sa variante d'avant : pas de champ, « Mon Space »")
    st, A = call("POST", "/api/chanson/spaces", {"name": "Album été"})
    ok(st == 200 and MSP_RX.fullmatch(A.get("id", "")) and A.get("color") in SPACE_COLORS and A.get("can") == {"edit": True, "delete": True}
       and A.get("count") == 0 and A.get("archived") is False, f"spaces : créer « Album été » ({st} {A})")
    st, B = call("POST", "/api/chanson/spaces", {"name": "Démos", "color": "amb"})
    ok(st == 200 and B.get("color") == "amb" and B["id"] != A.get("id"), f"spaces : créer « Démos », sa couleur ({st})")
    for body, want, why in (({"name": "album   ÉTÉ"}, 409, "un nom déjà pris (casse, espaces)"), ({"name": ""}, 400, "un nom vide"),
                            ({"name": "Mon Space"}, 400, "un mot de la page"), ({"name": "Rouge", "color": "red"}, 400, "une couleur hors des jetons"),
                            ({"name": "Pochette", "cover": song["id"]}, 400, "une pochette qui n'est pas une image"),
                            ({"action": "detruire"}, 400, "une action inconnue")):
        st, _ = call("POST", "/api/chanson/spaces", body)
        ok(st == want, f"spaces : refusé — {why} ({st})")

    # la naissance : une chanson dans le Space courant
    st, ja = call("POST", "/api/chanson/create", {**base, "seed": 70, "music_space": A["id"]})
    ja = wait(ja["id"]) if st == 200 else {}
    a1 = (ja.get("items") or [{}])[0]
    ok(ja.get("state") == "done" and a1.get("music_space") == A["id"], f"naissance : la chanson dans le Space courant ({ja.get('state')} {a1.get('music_space')})")
    st, bad = call("POST", "/api/chanson/create", {**base, "music_space": "msp-000000000000"})
    st2, bad2 = call("POST", "/api/chanson/create", {**base, "music_space": "Album"})
    ok(st == 400 and "Space" in bad.get("error", "") and st2 == 400, f"naissance : un Space absent ou mal écrit, refusé ({st} {st2})")
    if not a1.get("id"):
        return
    st, la = call("GET", f"/api/chanson/list?space={A['id']}")
    st2, lm = call("GET", "/api/chanson/list")
    st3, lt = call("GET", "/api/chanson/list?space=*&limit=200")
    ids = lambda r: [x["id"] for x in r.get("songs", [])]   # noqa: E731
    tous = {x["id"]: x.get("music_space") for x in lt.get("songs", [])}
    ok(ids(la) == [a1["id"]] and la.get("space") == A["id"] and a1["id"] not in ids(lm) and song["id"] in ids(lm)
       and lm.get("space") == MON and tous.get(a1["id"]) == A["id"] and tous.get(song["id"]) == ""
       and lt.get("counts", {}).get(A["id"]) == 1 and lt["counts"].get(MON) == lm.get("total"),
       f"la liste : par Space, « Tous » avec le Space de chaque chanson, les comptes ({la.get('total')} {lm.get('total')} {lt.get('counts')})")
    st, lx = call("GET", "/api/chanson/list?space=msp-000000000000")
    ok(st == 200 and lx.get("space") == MON, "la liste : un Space qui n'est plus là montre « Mon Space »")

    # une variante reste dans le Space de la chanson d'origine, même si la page en regarde un autre
    st, jv = call("POST", "/api/chanson/variant", {"item": a1["id"], "music_space": B["id"]})
    jv = wait(jv["id"]) if st == 200 else {}
    va = (jv.get("items") or [{}])[0]
    ok(jv.get("state") == "done" and va.get("music_space") == A["id"] and va.get("parents") == [a1["id"]],
       f"variante : dans le Space de la chanson d'origine, pas celui que la page regarde ({va.get('music_space')})")
    # les pistes séparées naissent avec leur chanson
    st, js = call("POST", "/api/chanson/stems", {"item": a1["id"]})
    js = wait(js["id"]) if st == 200 else {}
    stems = [library.get(x) for x in (js.get("result") or {}).get("stems", {}).values()]
    ok(js.get("state") == "done" and len(stems) == 4 and all(x and x.get("music_space") == A["id"] for x in stems),
       f"stems : dans le Space de leur chanson ({js.get('state')} {[x.get('music_space') if x else None for x in stems]})")

    # importer : un son importé, une référence déposée, dans le Space courant dès leur naissance
    wav = library.path_of(library.get(song["id"])).read_bytes()
    st, imp = call("PUT", f"/api/chanson/import?name=demo.wav&title=D%C3%A9mo&space={A['id']}&as=son", raw=wav)
    st2, ref = call("PUT", f"/api/chanson/import?name=ref.wav&title=R%C3%A9f&space={A['id']}", raw=wav)
    ok(st == 200 and imp.get("music_space") == A["id"] and imp["origin"]["tool"] == TOOL and imp["origin"].get("via") == "import"
       and st2 == 200 and ref.get("music_space") == A["id"] and ref["origin"]["tool"] == "upload" and ref["origin"].get("via") == "chanson",
       f"importer : un son (une carte) et une référence (un dépôt), dans le Space courant ({st} {st2})")
    st, la = call("GET", f"/api/chanson/list?space={A['id']}")
    ok(imp.get("id") in ids(la) and ref.get("id") not in ids(la), "importer : le son importé est une carte du Space, la référence non")
    buf = io.BytesIO()
    Image.new("RGB", (64, 48), (40, 120, 90)).save(buf, "PNG")
    st, _ = call("PUT", "/api/chanson/import?name=x.png&as=son", raw=buf.getvalue())
    st2, _ = call("PUT", "/api/chanson/import?name=x.wav&space=msp-000000000000&as=son", raw=wav)
    st3, _ = call("PUT", "/api/chanson/import?name=x.wav&as=planche", raw=wav)
    ok((st, st2, st3) == (415, 400, 400), f"importer : une image, un Space absent, une sorte inconnue — refusés ({st} {st2} {st3})")

    # déplacer : la chanson et ses pistes ; Ctrl+Z repose l'état d'avant
    st, mv = call("POST", "/api/chanson/spaces/move", {"ids": [a1["id"]], "to": B["id"]})
    moved = {x["id"] for x in stems} | {a1["id"]}
    ok(st == 200 and set(mv.get("moved", [])) == moved and mv.get("stems") == 4
       and all((library.get(x) or {}).get("music_space") == B["id"] for x in moved) and set(mv["before"].values()) == {A["id"]},
       f"déplacer : la chanson et ses quatre pistes ({st} {mv.get('stems')})")
    st, back = call("POST", "/api/chanson/spaces/move", {"restore": mv.get("before", {})})
    ok(st == 200 and all((library.get(x) or {}).get("music_space") == A["id"] for x in moved), f"déplacer, puis Ctrl+Z : tout revient ({st})")
    st, mm = call("POST", "/api/chanson/spaces/move", {"ids": [imp["id"]], "to": MON})
    ok(st == 200 and "music_space" not in (library.get(imp["id"]) or {"music_space": 1}) and mm.get("elsewhere") == 0,
       f"déplacer vers « Mon Space » : le champ s'en va ({st})")
    for body, want, why in (({"ids": [a1["id"]], "to": "msp-000000000000"}, 404, "un Space absent"), ({"ids": [], "to": MON}, 400, "rien"),
                            ({"ids": ["aud-20000101-000000-dead"], "to": MON}, 404, "un objet inconnu"),
                            ({"restore": {a1["id"]: "msp-000000000000"}}, 409, "reposer dans un Space qui n'est plus")):
        st, _ = call("POST", "/api/chanson/spaces/move", body)
        ok(st == want, f"déplacer : refusé — {why} ({st})")
    st, bad = call("POST", f"/api/library/{a1['id']}", {"music_space": "Album"})
    ok(st == 400 and "music_space" in bad.get("error", ""), f"le socle : library.update juge la forme de music_space ({st})")

    # renommer, une pochette, archiver (on n'y crée plus, on n'y range plus), rouvrir
    st, img = call("PUT", "/api/library/upload?name=pochette.png&title=Pochette", raw=buf.getvalue())
    st, a2 = call("POST", "/api/chanson/spaces", {"action": "update", "id": A["id"], "name": "Album hiver", "cover": img.get("id"), "color": "cy"})
    ok(st == 200 and a2.get("name") == "Album hiver" and a2.get("cover") == img.get("id") and a2.get("cover_url") and a2["color"] == "cy"
       and a2.get("count") == 2, f"spaces : renommer, une pochette, une couleur ({st} {a2})")
    st, a3 = call("POST", "/api/chanson/spaces", {"id": A["id"], "archived": True})
    st2, bad = call("POST", "/api/chanson/create", {**base, "music_space": A["id"]})
    st3, _ = call("POST", "/api/chanson/spaces/move", {"ids": [imp["id"]], "to": A["id"]})
    st4, sl = call("GET", "/api/chanson/spaces")
    ok(st == 200 and a3.get("archived") is True and st2 == 400 and "archivé" in bad.get("error", "") and st3 == 409
       and [x["id"] for x in sl.get("spaces", [])][-1] == A["id"],
       f"archiver : on n'y crée plus, on n'y range plus, il passe en fin de liste ({st} {st2} {st3})")
    call("POST", "/api/chanson/spaces", {"id": A["id"], "archived": False})

    # supprimer (S2) : ses chansons retournent dans « Mon Space » de leur auteur ; rien à la corbeille ; Ctrl+Z
    call("POST", "/api/chanson/spaces/move", {"ids": [imp["id"]], "to": B["id"]})
    st, dl = call("POST", "/api/chanson/spaces", {"action": "delete", "id": B["id"]})
    st2, sl = call("GET", "/api/chanson/spaces")
    st3, lm = call("GET", "/api/chanson/list?limit=200")
    gone = library.get(imp["id"]) or {}
    ok(st == 200 and dl.get("returned") == 1 and B["id"] not in [x["id"] for x in sl.get("spaces", [])]
       and imp["id"] in ids(lm) and gone.get("music_space") == B["id"] and space_of_item(gone) == "",
       f"supprimer (S2) : la chanson revient dans « Mon Space », rien n'est réécrit ni jeté ({st} {dl})")
    st, _ = call("POST", "/api/chanson/spaces", {"action": "delete", "id": B["id"]})
    st2, rs = call("POST", "/api/chanson/spaces", {"action": "restore", "id": B["id"]})
    st3, lb = call("GET", f"/api/chanson/list?space={B['id']}")
    ok(st == 404 and st2 == 200 and rs.get("id") == B["id"] and ids(lb) == [imp["id"]],
       f"supprimer deux fois : 404 ; Ctrl+Z rend le Space et sa chanson ({st} {st2})")
    try:
        creatable_space(B["id"])
        ok(birth_space({"parent": va["id"]}) == A["id"] and birth_space({}, "msp-000000000000") == "" and creatable_space(MON) == "",
           "birth_space : la chanson d'origine d'abord ; un Space disparu depuis l'envoi : « Mon Space »")
    except ValueError as e:
        ok(False, f"creatable_space : un Space rendu est ouvert ({e})")

    _selftest_partage(ok, wav, base)


def _selftest_partage(ok, wav: bytes, base: dict) -> None:
    """S1 et S2 entre deux personnes d'un même Workspace, la porte allumée (comme
    asset.py) : un Space créé par Ana est celui de Bob aussi ; « Mon Space » reste à
    chacun ; Bob ne supprime pas le Space d'Ana ; Ana le supprime : chaque chanson
    revient dans « Mon Space » de son auteur."""
    from tools.admin import essai_http as H

    def err(d) -> str:
        return d.get("error", "") if isinstance(d, dict) else str(d)[:80]

    before = config.CFG.get("auth")
    config.CFG["auth"] = True
    auth.startup()
    with auth._lock:
        auth._hits.clear()
    same = {"Origin": f"http://127.0.0.1:{config.get('port')}"}
    try:
        _, _, cal = H("POST", "/api/auth/enter", {"name": "nico007"}, headers=same)

        def who(tok, ws=None):
            def req(method, path, body=None, *, raw=None, hd=None):
                h = {**same, **({"X-SR-Espace": ws} if ws else {}), **(hd or {})}
                return H(method, path, body, cookie=tok, headers=h, raw=raw)[:2]
            return req

        C = who(cal)
        s, t = C("POST", "/api/equipes", {"name": "Spaces Essai"})
        tid, W = (t.get("id"), (t.get("spaces") or [{}])[0].get("id")) if isinstance(t, dict) else (None, None)
        s1, _ = C("POST", f"/api/equipes/{tid}/membres", {"pseudo": "Ana Spaces", "role": "member"})
        s2, _ = C("POST", f"/api/equipes/{tid}/membres", {"pseudo": "Bob Spaces", "role": "member"})
        _, _, ANA = H("POST", "/api/auth/enter", {"name": "Ana Spaces"}, headers=same)
        _, _, BOB = H("POST", "/api/auth/enter", {"name": "Bob Spaces"}, headers=same)
        ok((s, s1, s2) == (200, 200, 200) and W and ANA and BOB, f"partage : une Team, Ana et Bob membres ({s} {s1} {s2})")
        if not (W and ANA and BOB):
            return
        a, b = who(ANA, W), who(BOB, W)
        s, sp = a("POST", "/api/chanson/spaces", {"name": "Album de la Team"})
        A = sp.get("id") if isinstance(sp, dict) else None
        s2, lb = b("GET", "/api/chanson/spaces")
        seen = next((x for x in (lb.get("spaces") or []) if x["id"] == A), {}) if isinstance(lb, dict) else {}
        ok(s == 200 and A and lb.get("workspace") == W and seen.get("owner_name") == "Ana Spaces"
           and seen.get("can") == {"edit": True, "delete": False},
           f"partage (S1) : le Space d'Ana est dans la liste de Bob ; Bob le change, il ne le supprime pas ({s} {s2} {seen.get('can')})")
        hd = {"Content-Type": "audio/wav"}
        _, ia = a("PUT", f"/api/chanson/import?name=a.wav&title=Son+d+Ana&space={A}&as=son", raw=wav, hd=hd)
        _, ib = b("PUT", f"/api/chanson/import?name=b.wav&title=Son+de+Bob&space={A}&as=son", raw=wav, hd=hd)
        _, iam = a("PUT", "/api/chanson/import?name=am.wav&title=Mon+son+d+Ana&as=son", raw=wav, hd=hd)
        _, ibm = b("PUT", "/api/chanson/import?name=bm.wav&title=Mon+son+de+Bob&as=son", raw=wav, hd=hd)
        got = [x.get("id") for x in (ia, ib, iam, ibm) if isinstance(x, dict)]
        ok(len(got) == 4 and all(got), f"partage : Ana et Bob importent, dans le Space et dans leur « Mon Space » ({got})")
        if len(got) < 4 or not all(got):
            return
        ia, ib, iam, ibm = got
        # Bob crée une chanson dans le Space d'Ana : le travail tourne en son nom, elle naît dans le Space
        s, j = b("POST", "/api/chanson/create", {**base, "seed": 90, "music_space": A})
        jj = {}
        for _ in range(600):
            _, jj = b("GET", f"/api/jobs/{j.get('id')}") if isinstance(j, dict) else (0, {})
            if jj.get("state") in ("done", "error", "cancelled"):
                break
            time.sleep(0.2)
        bg = ((jj.get("items") or [{}])[0]).get("id")
        bgi = library.see(bg) or {} if bg else {}
        ok(jj.get("state") == "done" and bgi.get("music_space") == A and auth.owner_of(bgi) != auth.owner_of(library.see(ia) or {}),
           f"partage : Bob crée dans le Space d'Ana, la chanson y naît ({s} {jj.get('state')} {jj.get('message')})")
        ids = lambda r: {x["id"] for x in (r.get("songs") or [])} if isinstance(r, dict) else set()   # noqa: E731
        _, la = a("GET", f"/api/chanson/list?space={A}")
        _, lam = a("GET", "/api/chanson/list")
        _, lat = a("GET", "/api/chanson/list?space=*")
        _, lbm = b("GET", "/api/chanson/list")
        ok(ids(la) == {ia, ib, bg} and ids(lam) == {iam} and ids(lat) == {ia, ib, bg, iam} and ids(lbm) == {ibm},
           f"partage (S1) : Ana voit tout le Space, son « Mon Space » seul, jamais celui de Bob "
           f"({len(ids(la))} {len(ids(lam))} {len(ids(lat))} {len(ids(lbm))})")
        s, d = a("POST", "/api/chanson/spaces/move", {"ids": [ibm], "to": A})
        s2, d2 = b("POST", "/api/chanson/spaces/move", {"ids": [ia], "to": MON})
        s3, _ = b("POST", "/api/chanson/spaces/move", {"restore": d2.get("before", {})}) if s2 == 200 else (0, {})
        ok(s == 403 and "Mon Space" in err(d) and s2 == 200 and d2.get("elsewhere") == 1 and s3 == 200,
           f"partage : Ana ne sort pas une chanson du « Mon Space » de Bob ; Bob renvoie celle d'Ana dans le sien, puis Ctrl+Z "
           f"({s} {err(d)[:60]} {s2} {s3})")
        s, d = b("POST", "/api/chanson/spaces", {"action": "delete", "id": A})
        s2, rn = b("POST", "/api/chanson/spaces", {"id": A, "name": "Album de toute la Team"})
        ok(s == 403 and "Ana Spaces" in err(d) and s2 == 200 and rn.get("name") == "Album de toute la Team",
           f"partage : Bob renomme, il ne supprime pas le Space d'Ana — la raison dite ({s} {err(d)[:80]} {s2})")
        s, d = a("POST", "/api/chanson/spaces", {"action": "delete", "id": A})
        _, lam = a("GET", "/api/chanson/list")
        _, lbm = b("GET", "/api/chanson/list")
        ok(s == 200 and d.get("returned") == 3 and ids(lam) == {ia, iam} and ids(lbm) == {ib, ibm, bg}
           and all(library.see(x) for x in (ia, ib, bg)),
           f"partage (S2) : Ana supprime ; chaque chanson revient dans « Mon Space » de son auteur, rien n'est jeté ({s} {d})")
    finally:
        auth.set_current(None)
        auth.set_current_space(None)
        config.CFG["auth"] = before
