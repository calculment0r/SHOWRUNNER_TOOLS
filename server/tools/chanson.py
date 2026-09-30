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
    "soigne": {"label": "Soigné", "about": "la voix la plus juste, plus long à venir", "model": "yue"},
}
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
    preset = d.get("preset") or "rapide"
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
    return music_yue.yue_params({"tags": style, "lyrics": p["lyrics"] if p["vocal"] else "", "duration_s": p["duration"],
                                 "seed": p["seed"] + k, "mode": "melody" if cover else "full",
                                 "precision": p.get("precision", "bf16"), "ref": p["ref"] if cover else "",
                                 "title": p["title"]})


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
    return ctx.add(path, kind="audio", title=title, prompt=p["prompt"], parents=parents,
                   params={"chanson": {**p, "seed": seed, "n": 1}, "seed": seed, "take": k, "engine": eng,
                           "model": p["model"], **(extra or {})},
                   origin={"model": model}, tags=["musique", "chanson", "essai" if essai else "généré"], folder="Musique")


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


def api_list(req):
    try:
        limit = max(1, min(200, int(req.q("limit", "60") or 60)))
    except ValueError as e:
        raise HttpError(400, "limit : un nombre") from e
    items = library.query(kinds=["audio"], tool=TOOL, limit=5000)["items"]
    me = auth.current_id()
    songs = [it for it in items if not _is_stem(it) and (me is None or it.get("owner") == me)]
    out = []
    for s in songs[:limit]:
        out.append({**s, "stems": stems_of(s["id"], items), "odio": _odio_link(s["id"])})
    return {"songs": out, "total": len(songs)}


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
def _submit(p: dict, title: str):
    j = jobs.submit(f"chanson.{p['model']}", p, title=title[:90], tool=TOOL)
    return jobs.public(j)


def api_create(req):
    try:
        p = song_params(req.json())
    except (ValueError, TypeError) as e:
        raise HttpError(400, str(e)) from e
    return _submit(p, f"Chanson · {p['title']}")


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
    return {"presets": [{"id": k, **v} for k, v in PRESETS.items()], "models": models, "refs": refs,
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
    lreal = paroles_engine() == "reel"
    jobs.register("chanson.paroles", run_lyrics_real if lreal else run_lyrics_test, lane="audio" if lreal else "cpu",
                  title="Paroles" + ("" if lreal else " (essai)"), family="ace-step-lm" if lreal else None, gpu=lreal, cost="gpu" if lreal else "cpu")
    app.route("GET", "/api/chanson/options", api_options)
    app.route("GET", "/api/chanson/list", api_list)
    app.route("POST", "/api/chanson/create", api_create)
    app.route("POST", "/api/chanson/variant", api_variant)
    app.route("POST", "/api/chanson/paroles", api_lyrics)
    app.route("POST", "/api/chanson/stems", api_stems)
    app.route("POST", "/api/chanson/odio", api_odio)
    app.route("POST", "/api/chanson/studio/demande", api_studio_ask)
    app.route("GET", "/api/chanson/onde/{item_id}", api_wave)


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

    base = {"prompt": "pop mélancolique, piano, 96 BPM", "lyrics": "[Verse]\nla nuit\n[Chorus]\nreste", "duration": 12}
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
