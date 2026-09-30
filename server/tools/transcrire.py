"""Transcrire : la transcription et la traduction ultra rapides d'un son ou
d'une vidéo de la bibliothèque. Cal, 29/09 : « il faut rajouter une app qui
fait de la traduction et du transcript ultra rapide. » L'étude qui fonde
chaque choix (modèles, sources, mémoire, ce qu'il faut approuver) :
`docs/etudes/transcrire.md`.

Deux moteurs (`transcrire_moteur`, Admin → Câblage, lu au démarrage) :

  factice  le défaut. Voie `cpu`, aucun modèle : les passages parlés sont
           trouvés par ffmpeg (`silencedetect`), chacun reçoit une phrase
           d'une banque parallèle en sept langues (la « traduction »
           factice est la même phrase dans l'autre langue), des mots
           horodatés au prorata des lettres, des voix qui alternent. Tout
           se mène de bout en bout sans GPU ; le document le dit (`engine`).
  local    le câblage réel, écrit, jamais lancé sans l'accord de Cal :
           voie `audio` (l'instance ComfyUI :8188 de DGX2 sert de jeton
           GPU : un seul travail GPU du portail par machine) ;
             - le texte : un sous-processus (`transcrire_moteur.py`) dans
               l'environnement `transcrire_python` — Whisper large-v3-turbo
               (openai-whisper, poids présents sur DGX2) ou Parakeet TDT
               0.6B v3 (NeMo, à approuver) ; il ne charge qu'un fichier
               présent sur le disque, jamais un nom (qui téléchargerait) ;
             - les voix : le service Nemotron de DGX1 (celui de Movie
               Analysis, `analyse.diar_url()`), diarisation seule — jamais
               `transcrire=1` (Whisper n'y est pas : il se téléchargerait) ;
             - la traduction : Ollama (`/api/chat`, un schéma JSON, la pensée
               coupée si le modèle en a une, `keep_alive: 0` au dernier lot).

Une transcription est un document de l'outil, `<data_dir>/transcrire/trn-….json`
(comme un projet ODIO) : seul son propriétaire (ou Cal) l'écrit
(`library.check_write`), `rev` protège d'un autre onglet (409). Les
sous-titres se calculent du document à l'export (SRT, VTT, TXT) : une seule
vérité. Ranger un sous-titre dans Asset attend une sorte `subtitle` du socle
(étude § 5.3) : la route le dit tant qu'elle manque.

Travaux : `transcrire.transcribe` (puis `transcrire.translate` à la suite si
une langue est demandée), `transcrire.translate`.
"""

from __future__ import annotations

import hashlib
import json
import queue
import random
import re
import secrets
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from core import auth, config, jobs, library
from core.comfy import Cancelled
from core.http import HttpError, Response

REPO = Path(__file__).resolve().parents[2]
HOME = Path.home()
WORKER = Path(__file__).with_name("transcrire_moteur.py")

config.declare_switch(
    "transcrire_moteur", ["factice", "local"], label="Transcrire · moteur", default="factice",
    doc="server/tools/transcrire.py, engine() : factice (texte d'essai, voie cpu) ou local (Whisper turbo / "
        "Parakeet sur DGX2, voix par le service Nemotron de DGX1, traduction par Ollama) — docs/etudes/transcrire.md")


def engine() -> str:
    return "local" if config.get("transcrire_moteur") == "local" else "factice"


# ── les langues ─────────────────────────────────────────────
LANGS = {"fr": "Français", "en": "Anglais", "es": "Espagnol", "de": "Allemand", "it": "Italien",
         "pt": "Portugais", "nl": "Néerlandais"}
# le nom de la langue pour le modèle de traduction (en anglais : les consignes le sont)
LANG_EN = {"fr": "French", "en": "English", "es": "Spanish", "de": "German", "it": "Italian",
           "pt": "Portuguese", "nl": "Dutch"}
# Parakeet TDT 0.6B v3 : les 25 langues de sa carte (huggingface.co/nvidia/parakeet-tdt-0.6b-v3)
EU25 = ("bg", "hr", "cs", "da", "nl", "en", "et", "fi", "fr", "de", "el", "hu", "it", "lv", "lt", "mt", "pl",
        "pt", "ro", "sk", "sl", "es", "sv", "ru", "uk")

# ── les moteurs (étude § 2, § 3) ────────────────────────────
ASR = {
    "parakeet-v3": {
        "name": "Parakeet TDT 0.6B v3", "family": "parakeet", "mem_gb": 3, "langs": EU25, "license": "CC-BY-4.0",
        "speed": "RTFx 3 333 (carte)", "file_key": "transcrire_parakeet_nemo",
        "file": HOME / "models" / "transcrire" / "parakeet-tdt-0.6b-v3.nemo",
        "python_key": "transcrire_parakeet_python", "python": HOME / "transcrire-env" / "bin" / "python",
        "package": "nemo", "missing": "à approuver : parakeet-tdt-0.6b-v3.nemo (2,51 Go) et un venv NeMo sur DGX2 — étude, tableau d'approbation",
        "src": "https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3",
    },
    "whisper-turbo": {
        "name": "Whisper large-v3-turbo", "family": "whisper", "mem_gb": 6, "langs": None, "license": "MIT",
        "speed": "« ~8x » large (README)", "file_key": "transcrire_whisper_pt",
        "file": HOME / ".cache" / "whisper" / "large-v3-turbo.pt",
        "python_key": "transcrire_python", "python": HOME / "comfyui-env" / "bin" / "python",
        "package": "whisper", "missing": "large-v3-turbo.pt absent de ~/.cache/whisper (présent sur DGX2 le 29/09)",
        "src": "https://github.com/openai/whisper",
    },
}
MT = {
    "qwen3:30b-a3b": {"name": "Qwen3 30B-A3B", "mem_gb": 20, "context": 0, "license": "Apache-2.0",
                      "src": "https://huggingface.co/Qwen/Qwen3-30B-A3B"},
    "mistral-small3.2:24b": {"name": "Mistral Small 3.2 24B", "mem_gb": 17, "context": 3, "license": "Apache-2.0",
                             "src": "https://huggingface.co/mistralai/Mistral-Small-3.2-24B-Instruct-2506"},
}
# Cal, 29/09 (Upscale) : « parler simplement aux gens » — la page montre ces
# mots ; les noms des modèles ne sont que dans les paramètres avancés.
# `asr` : dans l'ordre, le premier installé qui connaît la langue demandée.
MODES = {
    "rapide": {"label": "Rapide", "about": "le texte en quelques secondes",
               "asr": ("parakeet-v3", "whisper-turbo"), "beam": 1, "speakers": False, "mt": "qwen3:30b-a3b"},
    "precis": {"label": "Précis", "about": "les voix séparées, la traduction relue dans son contexte",
               "asr": ("whisper-turbo",), "beam": 5, "speakers": True, "mt": "mistral-small3.2:24b"},
}
CPL = (32, 37, 42)          # caractères par ligne : 42 est l'usage courant des chartes ; 37, 32 plus serrés
MAX_S = (5.0, 7.0, 10.0)    # durée maximale d'un sous-titre
LINES = 2
MAX_DURATION = 4 * 3600     # 4 h : la limite du service de diarisation (/etat : max_minutes 240)
BATCH = 30                  # répliques par lot de traduction

# Whisper hallucine sur le silence et la musique — le filtre de Movie Analysis
# (analyse/chaine/whisper-run.py, diarisation-serveur.py), le même ici.
HALLU = re.compile(r"sous-?titr|subtitl|radio-canada|amara\.org|merci d.avoir regard|thanks for watching|abonnez|like et|^\W*$", re.I)

# ── le factice : une banque parallèle (la même réplique dans chaque langue) ──
BANK = {
    "fr": ["Bon, on reprend depuis le début de la scène.", "Tu entres par la porte, tu t'arrêtes, et tu la regardes.",
           "La lumière baisse un peu trop vite à mon goût.", "On a encore une heure avant de perdre le soleil.",
           "Je ne sais pas si elle va accepter.", "Il faut qu'on parle de ce qui s'est passé hier soir.",
           "Personne ne m'a prévenu que la route était fermée.", "Attends, redis-moi ça plus lentement.",
           "C'est la dernière prise, après on range tout.", "Tu as vu la tête qu'il a faite ?",
           "On se retrouve à la gare à huit heures.", "Je t'avais dit de ne pas toucher à cette boîte.",
           "Silence sur le plateau, s'il vous plaît.", "Ça tourne. Action !",
           "Coupez ! C'était parfait, on la garde.", "Il reste du café pour l'équipe ?"],
    "en": ["Okay, let's take it again from the top of the scene.", "You come in through the door, you stop, and you look at her.",
           "The light drops a little too fast for my taste.", "We still have an hour before we lose the sun.",
           "I don't know if she's going to accept.", "We need to talk about what happened last night.",
           "Nobody told me the road was closed.", "Wait, say that again more slowly.",
           "This is the last take, then we pack everything up.", "Did you see the look on his face?",
           "We'll meet at the station at eight.", "I told you not to touch that box.",
           "Quiet on set, please.", "Rolling. Action!",
           "Cut! That was perfect, we'll keep it.", "Is there any coffee left for the crew?"],
    "es": ["Bueno, retomamos desde el principio de la escena.", "Entras por la puerta, te detienes y la miras.",
           "La luz baja un poco demasiado rápido para mi gusto.", "Todavía tenemos una hora antes de perder el sol.",
           "No sé si va a aceptar.", "Tenemos que hablar de lo que pasó anoche.",
           "Nadie me avisó de que la carretera estaba cortada.", "Espera, repítemelo más despacio.",
           "Es la última toma, después lo recogemos todo.", "¿Viste la cara que puso?",
           "Nos vemos en la estación a las ocho.", "Te dije que no tocaras esa caja.",
           "Silencio en el set, por favor.", "Rodando. ¡Acción!",
           "¡Corten! Ha sido perfecto, nos la quedamos.", "¿Queda café para el equipo?"],
    "de": ["Gut, wir fangen die Szene noch einmal von vorne an.", "Du kommst durch die Tür, bleibst stehen und siehst sie an.",
           "Das Licht wird mir etwas zu schnell dunkler.", "Wir haben noch eine Stunde, bevor die Sonne weg ist.",
           "Ich weiß nicht, ob sie zusagen wird.", "Wir müssen über gestern Abend reden.",
           "Niemand hat mir gesagt, dass die Straße gesperrt ist.", "Warte, sag das noch mal langsamer.",
           "Das ist der letzte Take, danach packen wir zusammen.", "Hast du sein Gesicht gesehen?",
           "Wir treffen uns um acht am Bahnhof.", "Ich habe dir gesagt, du sollst die Kiste nicht anfassen.",
           "Ruhe am Set, bitte.", "Kamera läuft. Und bitte!",
           "Aus! Das war perfekt, den behalten wir.", "Ist noch Kaffee für das Team da?"],
    "it": ["Bene, riprendiamo dall'inizio della scena.", "Entri dalla porta, ti fermi e la guardi.",
           "La luce cala un po' troppo in fretta per i miei gusti.", "Abbiamo ancora un'ora prima di perdere il sole.",
           "Non so se accetterà.", "Dobbiamo parlare di quello che è successo ieri sera.",
           "Nessuno mi ha avvisato che la strada era chiusa.", "Aspetta, ripetimelo più lentamente.",
           "È l'ultimo ciak, poi smontiamo tutto.", "Hai visto che faccia ha fatto?",
           "Ci vediamo alla stazione alle otto.", "Ti avevo detto di non toccare quella scatola.",
           "Silenzio sul set, per favore.", "Motore. Azione!",
           "Stop! Era perfetta, la teniamo.", "C'è ancora caffè per la troupe?"],
    "pt": ["Bom, vamos recomeçar do início da cena.", "Você entra pela porta, para e olha para ela.",
           "A luz cai um pouco rápido demais para o meu gosto.", "Ainda temos uma hora antes de perder o sol.",
           "Não sei se ela vai aceitar.", "Precisamos falar sobre o que aconteceu ontem à noite.",
           "Ninguém me avisou que a estrada estava fechada.", "Espera, repete isso mais devagar.",
           "É a última tomada, depois arrumamos tudo.", "Você viu a cara que ele fez?",
           "A gente se encontra na estação às oito.", "Eu te disse para não mexer nessa caixa.",
           "Silêncio no set, por favor.", "Gravando. Ação!",
           "Corta! Ficou perfeito, vamos ficar com essa.", "Ainda tem café para a equipe?"],
    "nl": ["Goed, we beginnen de scène opnieuw vanaf het begin.", "Je komt binnen door de deur, je blijft staan en je kijkt naar haar.",
           "Het licht zakt naar mijn smaak iets te snel weg.", "We hebben nog een uur voordat we de zon kwijt zijn.",
           "Ik weet niet of ze het gaat accepteren.", "We moeten praten over wat er gisteravond is gebeurd.",
           "Niemand heeft me verteld dat de weg afgesloten was.", "Wacht, zeg dat nog eens langzamer.",
           "Dit is de laatste take, daarna ruimen we alles op.", "Zag je het gezicht dat hij trok?",
           "We zien elkaar om acht uur op het station.", "Ik had je gezegd die doos niet aan te raken.",
           "Stilte op de set, alstublieft.", "Camera loopt. Actie!",
           "Cut! Dat was perfect, die houden we.", "Is er nog koffie voor de crew?"],
}


# ── les documents ───────────────────────────────────────────
_lock = threading.RLock()
ID_RX = re.compile(r"^trn-\d{8}-\d{6}-[0-9a-f]{4}$")
MAX_TEXT = 2000


def _dir() -> Path:
    p = config.data_dir() / "transcrire"
    p.mkdir(parents=True, exist_ok=True)
    return p


def _path(tid: str) -> Path:
    if not ID_RX.match(tid or ""):
        raise HttpError(404, f"transcription introuvable : {tid}")
    return _dir() / f"{tid}.json"


def _load(tid: str) -> dict | None:
    f = _path(tid)
    if not f.exists():
        return None
    return json.loads(f.read_text(encoding="utf-8"))


def _write(d: dict) -> None:
    f = _path(d["id"])
    tmp = f.with_suffix(".tmp")
    tmp.write_text(json.dumps(d, ensure_ascii=False), encoding="utf-8")
    tmp.replace(f)


def _read(tid: str) -> dict:
    """Le document, s'il existe et si la personne peut le voir (la règle de la
    bibliothèque) ; sinon 404 — on ne dit pas qu'un document invisible existe."""
    d = _load(tid)
    if not d or not library.readable(d):
        raise HttpError(404, f"transcription introuvable : {tid}")
    return d


def _update(tid: str, fn) -> dict:
    """Modifie le document sous le verrou, `rev` + 1 : les travaux et la page
    passent tous par ici."""
    with _lock:
        d = _load(tid)
        if not d:
            raise RuntimeError("la transcription a été supprimée")
        fn(d)
        d["rev"] = int(d.get("rev") or 0) + 1
        d["updated"] = library.now()
        _write(d)
        return d


def _h(text: str) -> str:
    return hashlib.sha1((text or "").strip().encode("utf-8")).hexdigest()[:12]


def _stale(seg: dict, lang: str) -> bool:
    """Une traduction manque, ou le texte a changé depuis qu'on l'a traduit."""
    return lang not in (seg.get("tr") or {}) or (seg.get("trh") or {}).get(lang) != _h(seg.get("text", ""))


ACTIVE = ("queued", "running")


def _live(jid: str | None) -> dict | None:
    """Le travail en cours d'un document : seulement tant qu'il est en file ou
    qu'il tourne (fini, arrêté ou perdu, c'est l'état du document qui parle)."""
    j = jobs.get(jid) if jid else None
    if not j or j.get("state") not in ACTIVE:
        return None
    return {k: j.get(k) for k in ("id", "state", "progress", "message", "position", "eta_s", "machine")}


def _settled(x: dict) -> dict:
    """Un document (ou une traduction) « en file » ou « en cours » dont le
    travail est fini sans l'avoir dit — arrêté, perdu à un redémarrage du
    portail — se montre en échec, avec la raison : jamais « en file » pour
    toujours. Le travail écrit l'état du document avant de finir : un travail
    réussi ne passe pas par ici."""
    if x.get("state") not in ACTIVE or not x.get("job"):      # sans numéro : le travail est en train d'être posé
        return x
    j = jobs.get(x["job"])
    if j and j.get("state") in ACTIVE:
        return x
    why = {"cancelled": "arrêté", "interrupted": "interrompu par un redémarrage du portail"}.get((j or {}).get("state"))
    return {**x, "state": "error", "error": x.get("error") or why or (j or {}).get("message") or "travail perdu (le portail a redémarré)"}


def public(d: dict) -> dict:
    out = _settled(dict(d))
    out["live"] = _live(d.get("job"))
    out["translations"] = {k: {**_settled(v), "live": _live(v.get("job"))} for k, v in (d.get("translations") or {}).items()}
    # une traduction à refaire : manquante, ou le texte a changé depuis (le hachage du texte traduit)
    out["stale_ids"] = {k: [s["id"] for s in d.get("segments", []) if _stale(s, k)] for k in (d.get("translations") or {})}
    out["stale"] = {k: len(v) for k, v in out["stale_ids"].items()}
    out["owner_name"] = auth.display_name(auth.owner_of(d))
    return out


def summary(d: dict) -> dict:
    d = _settled(d)
    return {k: d.get(k) for k in ("id", "title", "item", "created", "updated", "state", "mode", "lang", "detected",
                                  "duration", "kind", "thumb_url", "engine")} | {
        "to": sorted((d.get("translations") or {}).keys()), "segments": len(d.get("segments") or []),
        "voices": len(d.get("speakers") or []), "live": _live(d.get("job"))}


# ── les sous-titres, calculés du document ───────────────────
def _tc(t: float, sep: str = ",") -> str:
    ms = max(0, int(round(t * 1000)))
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d}{sep}{ms:03d}"


def _clock(t: float) -> str:
    s = int(t)
    return f"{s // 3600:02d}:{s % 3600 // 60:02d}:{s % 60:02d}" if s >= 3600 else f"{s // 60:02d}:{s % 60:02d}"


def wrap(text: str, cpl: int) -> list[str]:
    """Des lignes d'au plus `cpl` caractères, coupées aux espaces ; un mot plus
    long que la ligne en occupe une à lui seul."""
    lines, cur = [], ""
    for w in text.split():
        if cur and len(cur) + 1 + len(w) > cpl:
            lines.append(cur)
            cur = w
        else:
            cur = f"{cur} {w}" if cur else w
    if cur:
        lines.append(cur)
    return lines


def spread(text: str, a: float, b: float) -> list[tuple[str, float, float]]:
    """Des mots sans temps (une traduction, un texte corrigé) répartis au
    prorata des lettres sur l'intervalle de la réplique."""
    ws = text.split()
    if not ws or b <= a:
        return []
    tot = sum(len(w) + 1 for w in ws)
    out, t = [], a
    for w in ws:
        d = (b - a) * (len(w) + 1) / tot
        out.append((w, t, t + d))
        t += d
    return out


def seg_text(seg: dict, which: str) -> str:
    return (seg.get("text") if which == "src" else (seg.get("tr") or {}).get(which)) or ""


def on_text(text: str, ws: list[tuple[str, float, float]]) -> list[tuple[str, float, float]] | None:
    """Les mots horodatés du moteur remis sur les mots du texte : Whisper
    découpe « qu'est-ce » en « qu », « 'est », « -ce » (mesuré sur Getaround,
    30/09) ; recollés tels que le texte les écrit, du début du premier à la fin
    du dernier. None si le texte et les mots ne concordent pas."""
    out, k = [], 0
    for tw in text.split():
        acc, a, b = "", None, None
        while k < len(ws) and len(acc) < len(tw):
            w, x, y = ws[k]
            acc, a, b, k = acc + w, x if a is None else a, y, k + 1
        if acc != tw:
            return None
        out.append((tw, a, b))
    return out if k == len(ws) else None


def seg_words(seg: dict, which: str) -> list[tuple[str, float, float]]:
    a, b = float(seg["a"]), float(seg["b"])
    if which == "src" and seg.get("words") and not seg.get("edited"):
        ws = [(str(w).strip(), float(x), float(y)) for w, x, y in seg["words"] if str(w).strip()]
        if ws:
            return on_text(seg_text(seg, which), ws) or ws
    return spread(seg_text(seg, which), a, b)


def cues(d: dict, which: str = "src", cpl: int = 42, max_s: float = 7.0, lines: int = LINES) -> list[dict]:
    """Les sous-titres : chaque réplique en cartons d'au plus `lines` lignes de
    `cpl` caractères et `max_s` secondes, aux temps des mots ; puis, dans
    l'ordre, chaque début ≥ la fin du précédent (rogné), un carton vide de
    durée tombe — croissants par construction."""
    names = {s["id"]: s.get("name") or s["id"] for s in d.get("speakers") or []}
    raw = []
    for seg in sorted(d.get("segments") or [], key=lambda s: (float(s["a"]), float(s["b"]))):
        ws = seg_words(seg, which)
        cur: list = []
        for w in ws:
            trial = cur + [w]
            text = " ".join(x[0] for x in trial)
            if cur and (len(wrap(text, cpl)) > lines or trial[-1][2] - cur[0][1] > max_s):
                raw.append((cur, seg))
                cur = [w]
            else:
                cur = trial
        if cur:
            raw.append((cur, seg))
    out, last = [], 0.0
    for ws, seg in sorted(raw, key=lambda r: r[0][0][1]):
        a, b = max(float(ws[0][1]), last), float(ws[-1][2])
        if b - a < 0.05:
            continue
        text = " ".join(x[0] for x in ws)
        out.append({"a": round(a, 3), "b": round(b, 3), "lines": wrap(text, cpl), "spk": names.get(seg.get("spk"))})
        last = b
    return out


def to_srt(cs: list[dict]) -> str:
    return "".join(f"{i}\n{_tc(c['a'])} --> {_tc(c['b'])}\n" + "\n".join(c["lines"]) + "\n\n" for i, c in enumerate(cs, 1))


def _vtt_escape(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def to_vtt(cs: list[dict]) -> str:
    out = ["WEBVTT", ""]
    for c in cs:
        out.append(f"{_tc(c['a'], '.')} --> {_tc(c['b'], '.')}")
        body = [_vtt_escape(x) for x in c["lines"]]
        if c.get("spk"):
            body[0] = f"<v {_vtt_escape(c['spk'])}>{body[0]}"
        out += body + [""]
    return "\n".join(out) + "\n"


def to_txt(d: dict, which: str = "src", stamps: bool = False) -> str:
    names = {s["id"]: s.get("name") or s["id"] for s in d.get("speakers") or []}
    out, prev = [], None
    for seg in sorted(d.get("segments") or [], key=lambda s: float(s["a"])):
        t = seg_text(seg, which).strip()
        if not t:
            continue
        who = names.get(seg.get("spk"))
        head = (f"[{_clock(float(seg['a']))}] " if stamps else "") + (f"{who} : " if who and (who != prev or stamps) else "")
        out.append(head + t)
        prev = who
    return "\n".join(out) + ("\n" if out else "")


# ── le factice ──────────────────────────────────────────────
def speech_regions(path: Path, duration: float) -> list[tuple[float, float]]:
    """Les passages qui ne sont pas du silence (ffmpeg silencedetect, -35 dB
    pendant 0,35 s) ; tout le fichier si ffmpeg ne dit rien."""
    try:
        r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-vn", "-af",
                            "silencedetect=noise=-35dB:d=0.35", "-f", "null", "-"],
                           capture_output=True, text=True, timeout=300)
        log = r.stderr
    except (OSError, subprocess.TimeoutExpired):
        log = ""
    sil, start = [], None
    for m in re.finditer(r"silence_(start|end): (-?[\d.]+)", log):
        v = max(0.0, float(m.group(2)))
        if m.group(1) == "start":
            start = v
        elif start is not None:
            sil.append((start, v))
            start = None
    if start is not None:
        sil.append((start, duration))
    out, t = [], 0.0
    for a, b in sorted(sil):
        if a > t:
            out.append((t, min(a, duration)))
        t = max(t, b)
    if t < duration:
        out.append((t, duration))
    return [(a, b) for a, b in out if b - a >= 0.5]


def fake_transcribe(path: Path, duration: float, lang: str, speakers: bool, seed: str) -> tuple[list[dict], list[dict]]:
    rnd = random.Random(seed)
    order = list(range(len(BANK["fr"])))
    rnd.shuffle(order)
    chunks = []
    for a, b in speech_regions(path, duration):
        t = a
        while b - t >= 0.5:
            n = min(b - t, rnd.uniform(2.2, 5.2))
            if b - (t + n) < 0.8:     # pas de miette au bout du passage
                n = b - t
            chunks.append((t, t + n))
            t += n + rnd.uniform(0.15, 0.45)
    segs, voices, spk = [], [], "S1"
    for k, (a, b) in enumerate(chunks):
        idx = order[k % len(order)]
        text = BANK[lang][idx]
        if speakers and k and (a - chunks[k - 1][1] > 0.3 or rnd.random() < 0.35):
            spk = f"S{rnd.choice([n for n in range(1, 4) if f'S{n}' != spk])}"
        pad = min(0.12, (b - a) * 0.05)
        words = [[w, round(x, 3), round(y, 3)] for w, x, y in spread(text, a + pad, b - pad)]
        segs.append({"id": f"s{k + 1:04d}", "a": round(a, 3), "b": round(b, 3), "text": text, "k": idx,
                     "spk": spk if speakers else None, "words": words})
        if speakers and spk not in voices:
            voices.append(spk)
    return segs, [{"id": v, "name": f"Voix {v[1:]}"} for v in sorted(voices)]


def fake_translate(seg: dict, src: str, dst: str) -> str:
    k = seg.get("k")
    if isinstance(k, int) and src in BANK and 0 <= k < len(BANK[src]) and seg.get("text") == BANK[src][k]:
        return BANK[dst][k]
    return f"[{dst.upper()} · factice] {seg.get('text', '')}"


# ── le câblage réel (jamais lancé sans l'accord de Cal) ─────
def _setting_path(key: str, default: Path) -> Path:
    return Path(str(config.get(key) or default)).expanduser()


def asr_state(aid: str) -> dict:
    """Ce qu'il faut sur DGX2 pour ce moteur, et ce qui manque (lecture du
    disque seulement : rien n'est importé ni chargé)."""
    a = ASR[aid]
    py = _setting_path(a["python_key"], a["python"])
    weights = _setting_path(a["file_key"], a["file"])
    miss = []
    if not py.exists():
        miss.append(f"python absent : {py}")
    elif not any(py.parent.parent.glob(f"lib/python3*/site-packages/{a['package']}")):
        miss.append(f"paquet « {a['package']} » absent de {py.parent.parent}")
    if not weights.is_file():
        miss.append(a["missing"])
    return {"python": str(py), "weights": str(weights), "missing": miss}


_probe: dict = {"t": 0.0, "v": None}


def _get_json(url: str, timeout: float = 4.0, body: dict | None = None) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"} if data else {})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read() or b"{}")


def ollama_url() -> str:
    return str(config.get("transcrire_ollama") or config.get("llm_url") or "http://127.0.0.1:11434").rstrip("/")


_LOOP = {"127.0.0.1", "localhost", "::1"}


def pin_for(url: str | None = None) -> str | None:
    """Le ComfyUI de la voie audio qui est sur la même machine que le calcul :
    le texte (un sous-processus, sur la machine du portail) ou la traduction
    (l'Ollama de `url`). Il sert de jeton GPU : un seul travail GPU du portail
    par machine (core/jobs.py) — sans lui, une voie audio à deux DGX donnerait
    le jeton de l'une à un calcul qui tourne sur l'autre. En factice : aucun."""
    if engine() != "local":
        return None
    host = urllib.parse.urlparse(url).hostname if url else "127.0.0.1"
    for ep in config.get("lanes", {}).get("audio", []):
        h = urllib.parse.urlparse(ep).hostname if ep != "local" else None
        if h and (h == host or (h in _LOOP and host in _LOOP)):
            return ep
    return None


def diar_url() -> str:
    from tools import analyse   # une seule vérité : l'adresse du service que Movie Analysis emploie
    return analyse.diar_url()


def services(max_age: float = 60.0) -> dict:
    """Le service de diarisation et les modèles d'Ollama : lus (GET), jamais
    appelés à calculer. En factice : rien n'est lu."""
    if engine() != "local":
        return {"diar": {"up": None, "why": ""}, "ollama": {"up": None, "models": []}}
    if _probe["v"] is not None and time.time() - _probe["t"] < max_age:
        return _probe["v"]
    out: dict = {}
    try:
        st = _get_json(diar_url() + "/etat")
        out["diar"] = {"up": bool(st.get("pret")), "why": "" if st.get("pret") else f"service : {st.get('phase')}",
                       "voices": (st.get("modele") or {}).get("voix"), "machine": st.get("machine")}
    except (OSError, ValueError) as e:
        out["diar"] = {"up": False, "why": f"le service de diarisation ne répond pas ({diar_url()}) : {e}"}
    try:
        tags = _get_json(ollama_url() + "/api/tags")
        out["ollama"] = {"up": True, "models": sorted(m.get("name", "") for m in tags.get("models", []))}
    except (OSError, ValueError) as e:
        out["ollama"] = {"up": False, "models": [], "why": f"Ollama ne répond pas ({ollama_url()}) : {e}"}
    _probe.update(t=time.time(), v=out)
    return out


def pick_asr(mode: str, lang: str) -> tuple[str | None, str]:
    """Le moteur de texte d'un mode : le premier de sa liste qui est installé
    et connaît la langue demandée. Aucun : la raison."""
    whys = []
    for aid in MODES[mode]["asr"]:
        a = ASR[aid]
        if lang != "auto" and a["langs"] and lang not in a["langs"]:
            whys.append(f"{a['name']} : ne connaît pas « {lang} »")
            continue
        if engine() == "factice":
            return aid, ""
        miss = asr_state(aid)["missing"]
        if not miss:
            return aid, ""
        whys.append(f"{a['name']} : {'; '.join(miss)}")
    return None, " · ".join(whys)


def mt_state(mode: str) -> tuple[str, str]:
    mid = MODES[mode]["mt"]
    if engine() == "factice":
        return mid, ""
    o = services()["ollama"]
    if not o["up"]:
        return mid, o.get("why", "Ollama ne répond pas")
    if mid not in o["models"]:
        return mid, f"le modèle {mid} n'est pas dans Ollama ({ollama_url()})"
    return mid, ""


def extract_wav(src: Path, dest: Path) -> None:
    """16 kHz mono, 16 bits : ce que veulent Whisper, Parakeet et le service de diarisation."""
    r = subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(src), "-vn", "-ac", "1", "-ar", "16000",
                        "-c:a", "pcm_s16le", str(dest)], capture_output=True, text=True, timeout=1800)
    if r.returncode != 0 or not dest.exists():
        raise RuntimeError("ffmpeg n'a pas extrait le son : " + (r.stderr or "")[-400:])


def run_worker(ctx, aid: str, wav: Path, lang: str, beam: int, duration: float) -> dict:
    """Le sous-processus du moteur de texte ; arrêté si Cal arrête le travail."""
    st = asr_state(aid)
    if st["missing"]:
        raise RuntimeError(f"{ASR[aid]['name']} : {'; '.join(st['missing'])}")
    out = ctx.workdir / "asr.json"
    cmd = [st["python"], str(WORKER), "--engine", aid, "--weights", st["weights"], "--audio", str(wav),
           "--lang", lang, "--beam", str(beam), "--out", str(out), "--duration", str(duration)]
    log = ctx.workdir / "moteur.log"
    lines: queue.Queue = queue.Queue()
    with open(log, "wb") as lf:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=lf, text=True)
        # la sortie lue à part : l'arrêt se voit chaque demi-seconde, même
        # quand le moteur ne dit rien (une longue fenêtre de décodage)
        reader = threading.Thread(target=lambda: [lines.put(x) for x in proc.stdout], daemon=True)
        reader.start()
        try:
            while True:
                try:
                    line = lines.get(timeout=0.5)
                except queue.Empty:
                    if ctx.cancelled():
                        raise Cancelled("arrêté")
                    if proc.poll() is not None and not reader.is_alive():
                        break
                    continue
                if line.startswith("ETAPE "):
                    ctx.progress(None, line[6:].strip())
                elif line.startswith("PROGRES "):
                    try:
                        f = float(line.split()[1])
                    except (IndexError, ValueError):
                        continue
                    ctx.progress(0.1 + 0.65 * f, f"{ASR[aid]['name']} : {int(100 * f)} %")
            proc.wait()
        finally:
            if proc.poll() is None:                # arrêt par son PID, jamais par motif
                proc.kill()
                proc.wait(timeout=10)
    if proc.returncode != 0 or not out.exists():
        raise RuntimeError(f"{ASR[aid]['name']} a échoué : " + log.read_text(encoding="utf-8", errors="replace")[-600:])
    return json.loads(out.read_text(encoding="utf-8"))


def diarize(ctx, wav: Path) -> list[list]:
    """Le service Nemotron de DGX1 : diarisation seule. Rend [[début, fin, voix]…]."""
    q = urllib.parse.urlencode({"nom": f"transcrire-{ctx.job['id']}.wav"})
    req = urllib.request.Request(diar_url() + "/analyse?" + q, data=wav.read_bytes(), method="POST",
                                 headers={"Content-Type": "application/octet-stream"})
    with urllib.request.urlopen(req, timeout=600) as r:
        jid = json.loads(r.read())["id"]
    t0 = time.time()
    while True:
        if ctx.cancelled():
            try:   # le travail du service est retiré (sa route DELETE) ; s'il ne répond pas, on s'arrête quand même
                urllib.request.urlopen(urllib.request.Request(diar_url() + "/travail/" + jid, method="DELETE"), timeout=10)
            except OSError:
                pass
            raise Cancelled("arrêté")
        st = _get_json(diar_url() + "/travail/" + jid, timeout=90)
        if st.get("resultat"):
            return st["resultat"].get("segments_nemo") or []
        if st.get("erreur") or st.get("etat") in ("erreur", "annulé"):
            raise RuntimeError(f"diarisation : {st.get('erreur') or st.get('etat')}")
        ctx.progress(None, f"voix : {st.get('etat', '…')}" + (f" {int(100 * st['progression'])} %" if st.get("progression") else ""))
        if time.time() - t0 > 3 * 3600:
            raise RuntimeError("diarisation : plus de 3 h, abandonnée")
        time.sleep(2)


def assign_speakers(segs: list[dict], turns: list[list]) -> list[dict]:
    """Chaque réplique prend la voix qui recouvre le plus son intervalle."""
    used = set()
    for s in segs:
        best, cover = None, 0.0
        for a, b, v in turns:
            o = min(float(b), s["b"]) - max(float(a), s["a"])
            if o > cover:
                best, cover = int(v), o
        s["spk"] = f"S{best + 1}" if best is not None else None
        if s["spk"]:
            used.add(s["spk"])
    return [{"id": v, "name": f"Voix {v[1:]}"} for v in sorted(used, key=lambda x: int(x[1:]))]


SCHEMA = {"type": "object", "properties": {"t": {"type": "array", "items": {
    "type": "object", "properties": {"i": {"type": "integer"}, "text": {"type": "string"}}, "required": ["i", "text"]}}},
    "required": ["t"]}


def _thinks(model: str) -> bool:
    try:
        return "thinking" in (_get_json(ollama_url() + "/api/show", timeout=10, body={"model": model}).get("capabilities") or [])
    except (OSError, ValueError):
        return False


def mt_messages(src: str, dst: str, batch: list[tuple[int, str]], before: list[str], after: list[str]) -> list[dict]:
    sys_msg = (f"You translate film subtitles from {LANG_EN.get(src, src)} to {LANG_EN[dst]}. Translate every line, "
               "keep names, register and punctuation, do not merge or split lines. Answer only the JSON asked for, "
               "with exactly the same line numbers.")
    user = {"context_before": before, "lines": [{"i": i, "text": t} for i, t in batch], "context_after": after}
    return [{"role": "system", "content": sys_msg}, {"role": "user", "content": json.dumps(user, ensure_ascii=False)}]


CTX_STEP = 4096


def mt_context(lots: list[list[dict]]) -> int:
    """La fenêtre de contexte d'une traduction, la même pour tous ses lots
    (Ollama recharge le modèle quand `num_ctx` change). Sans elle, Ollama la
    règle d'après la mémoire vue — 256k au-delà de 48 Gio (docs.ollama.com/
    context-length) : 43 Go mesurés pour qwen3:30b-a3b sur DGX2 le 30/09, au
    lieu des ~18 du modèle. Borne haute, par construction : un jeton pour un
    signe à l'entrée (la plupart des jetons en couvrent plusieurs) ; la sortie,
    les mêmes répliques traduites, comptées au double de leur texte, plus le
    JSON ; arrondi aux 4096 du dessus."""
    need = 0
    for msgs in lots:
        chars_in = sum(len(m["content"]) for m in msgs)
        lines = json.loads(msgs[-1]["content"])["lines"]
        chars_out = sum(2 * len(x["text"]) + 24 for x in lines) + 16
        need = max(need, chars_in + chars_out + 256)
    return max(CTX_STEP, -(-need // CTX_STEP) * CTX_STEP)


def ollama_translate(model: str, msgs: list[dict], batch: list[tuple[int, str]], last: bool, thinks: bool,
                     num_ctx: int) -> dict[int, str]:
    """Un lot de répliques ; la réponse doit porter exactement les numéros
    envoyés (schéma JSON), sinon le lot échoue en le disant."""
    body = {"model": model, "stream": False, "format": SCHEMA, "options": {"temperature": 0, "num_ctx": num_ctx},
            "keep_alive": 0 if last else "2m", "messages": msgs}
    if thinks:
        body["think"] = False
    r = _get_json(ollama_url() + "/api/chat", timeout=600, body=body)
    if r.get("done_reason") == "length":
        raise RuntimeError(f"traduction : la réponse dépasse la fenêtre de {num_ctx} jetons (lot coupé, rien n'est rangé)")
    got = json.loads((r.get("message") or {}).get("content") or "{}").get("t") or []
    out = {int(x["i"]): str(x["text"]).strip() for x in got if isinstance(x, dict) and "i" in x and "text" in x}
    want = {i for i, _ in batch}
    if set(out) != want:
        raise RuntimeError(f"traduction : le modèle a rendu {len(out)} répliques pour {len(want)} envoyées (numéros différents)")
    return out


# ── les travaux ─────────────────────────────────────────────
def run_transcribe(ctx) -> dict:
    p = ctx.params
    tid = p["doc"]
    t0 = time.time()
    _update(tid, lambda d: d.update(state="running"))
    try:
        it = library.get(p["item"])
        if not it:
            raise RuntimeError("le média a quitté la bibliothèque")
        src = library.path_of(it)
        dur = float(it.get("duration") or 0)
        lang = p["lang"]
        if engine() == "factice":
            ctx.progress(0.1, "cherche les passages parlés (factice)")
            detected = lang if lang != "auto" else "fr"
            segs, voices = fake_transcribe(src, dur, detected, p["speakers"], p["item"] + p["mode"])
            for k in range(6):   # le temps d'un vrai calcul, pour voir la page attendre
                if ctx.cancelled():
                    raise Cancelled("arrêté")
                ctx.progress(0.2 + 0.12 * k, f"transcrit (factice) {int(100 * (k + 1) / 6)} %")
                time.sleep(0.15)
            used = {"asr": "factice", "diar": "factice" if p["speakers"] else None}
        else:
            wav = ctx.workdir / "audio.wav"
            ctx.progress(0.03, "extrait le son (16 kHz mono)")
            extract_wav(src, wav)
            ctx.progress(0.08, f"{ASR[p['asr']]['name']} : chargement")
            res = run_worker(ctx, p["asr"], wav, lang, p["beam"], dur)
            detected = res.get("lang") or (lang if lang != "auto" else None)
            segs = []
            for k, s in enumerate(res.get("segments") or []):
                txt = str(s.get("text") or "").strip()
                if HALLU.search(txt) or not any(c.isalpha() for c in txt):
                    continue
                segs.append({"id": f"s{k + 1:04d}", "a": round(float(s["a"]), 3), "b": round(float(s["b"]), 3), "text": txt,
                             "spk": None, "words": [[str(w).strip(), round(float(x), 3), round(float(y), 3)]
                                                    for w, x, y in s.get("words") or [] if str(w).strip()]})
            voices = []
            if p["speakers"] and segs:
                ctx.progress(0.8, "voix : envoi au service de diarisation (DGX1)")
                voices = assign_speakers(segs, diarize(ctx, wav))
            used = {"asr": p["asr"], "diar": "nemotron" if p["speakers"] else None, "asr_s": res.get("calcul_s")}
        secs = round(time.time() - t0, 1)

        def done(d):
            d.update(state="done", segments=segs, speakers=voices, detected=detected, error=None,
                     engine={**used, "mode": p["mode"], "backend": engine(), "seconds": secs})
            if p.get("to") and p["to"] != detected:
                d.setdefault("translations", {})[p["to"]] = {"state": "queued"}
        d = _update(tid, done)
        if p.get("to") and p["to"] != detected and segs:
            who = {"owner": ctx.job["owner"]} if ctx.job.get("owner") else {}   # la traduction est à qui a transcrit
            j = jobs.submit("transcrire.translate", {"doc": tid, "to": p["to"], "mode": p["mode"], "all": False},
                            title=f"Traduire · {LANGS[p['to']]} · {d.get('title', '')[:40]}", tool="transcrire",
                            thumb=ctx.job.get("thumb"), pin=pin_for(ollama_url()), **who)
            _update(tid, lambda x: x["translations"][p["to"]].update(job=j["id"]))
        return {"note": f"{len(segs)} répliques · {secs} s", "doc": tid, "seconds": secs}
    except Exception as e:
        _update(tid, lambda d: d.update(state="error", error=str(e)[:400]))
        raise


def run_translate(ctx) -> dict:
    p = ctx.params
    tid, to = p["doc"], p["to"]
    t0 = time.time()
    _update(tid, lambda d: d.setdefault("translations", {}).setdefault(to, {}).update(state="running", job=ctx.job["id"]))
    try:
        with _lock:
            d = _load(tid)
        src = d.get("detected") or (d.get("lang") if d.get("lang") != "auto" else "fr")
        todo = [s for s in d["segments"] if p.get("all") or _stale(s, to)]
        sent = {s["id"]: _h(s.get("text", "")) for s in todo}   # le texte tel qu'il part
        got: dict[str, str] = {}
        if engine() == "factice":
            for k, s in enumerate(todo):
                got[s["id"]] = fake_translate(s, src, to)
                if k % 10 == 0:
                    ctx.progress(0.1 + 0.8 * k / max(1, len(todo)), f"traduit (factice) {k}/{len(todo)}")
                    time.sleep(0.05)
            model = "factice"
        else:
            model = MODES[p["mode"]]["mt"]
            ctxn = MT[model]["context"]
            thinks = _thinks(model)
            order = {s["id"]: k for k, s in enumerate(d["segments"])}
            lots = []
            for b0 in range(0, len(todo), BATCH):
                chunk = todo[b0:b0 + BATCH]
                ks = [order[s["id"]] for s in chunk]
                before = [x.get("text", "") for x in d["segments"][max(0, ks[0] - ctxn):ks[0]]] if ctxn else []
                after = [x.get("text", "") for x in d["segments"][ks[-1] + 1:ks[-1] + 1 + ctxn]] if ctxn else []
                batch = [(n, s["text"]) for n, s in enumerate(chunk)]
                lots.append((b0, chunk, batch, mt_messages(src, to, batch, before, after)))
            num_ctx = mt_context([m for *_, m in lots])
            try:
                for b0, chunk, batch, msgs in lots:
                    if ctx.cancelled():
                        raise Cancelled("arrêté")
                    ctx.progress(0.05 + 0.9 * b0 / max(1, len(todo)), f"{MT[model]['name']} : {b0}/{len(todo)}")
                    res = ollama_translate(model, msgs, batch, last=b0 + BATCH >= len(todo), thinks=thinks, num_ctx=num_ctx)
                    got.update({s["id"]: res[n] for n, s in enumerate(chunk)})
            except Exception:
                # arrêt ou lot refusé : le modèle ne reste pas chargé pour rien (keep_alive 0, docs.ollama.com/api/chat)
                try:
                    _get_json(ollama_url() + "/api/generate", timeout=30, body={"model": model, "keep_alive": 0})
                except (OSError, ValueError):
                    pass
                raise
        secs = round(time.time() - t0, 1)
        skipped = []

        def put(x):
            for s in x["segments"]:
                if s["id"] in got:
                    if _h(s.get("text", "")) != sent[s["id"]]:
                        skipped.append(s["id"])   # retouchée pendant la traduction : reste « à retraduire »
                        continue
                    s.setdefault("tr", {})[to] = got[s["id"]]
                    s.setdefault("trh", {})[to] = sent[s["id"]]
            x["translations"][to] = {"state": "done", "job": ctx.job["id"], "model": model, "seconds": secs, "at": library.now()}
        _update(tid, put)
        return {"note": f"{LANGS[to]} · {len(got) - len(skipped)} répliques · {secs} s", "doc": tid}
    except Exception as e:
        _update(tid, lambda x: x.setdefault("translations", {}).setdefault(to, {}).update(state="error", error=str(e)[:400]))
        raise


# ── la validation d'une demande ─────────────────────────────
def _media(item_id) -> dict:
    it = library.get(str(item_id or ""))
    if not it or not library.readable(it):
        raise ValueError("choisissez un son ou une vidéo de la bibliothèque")
    if it["kind"] not in ("audio", "video"):
        raise ValueError("ni un son ni une vidéo : seuls les sons et les vidéos se transcrivent")
    if not it.get("audio"):
        raise ValueError("cette vidéo n'a pas de piste son : rien à transcrire")
    if not it.get("duration"):
        raise ValueError("durée inconnue : le fichier ne se lit pas")
    if it["duration"] > MAX_DURATION:
        raise ValueError(f"trop long : {MAX_DURATION // 3600} h au plus")
    return it


def check(d: dict) -> dict:
    it = _media(d.get("item"))
    lang = d.get("lang") or "auto"
    if lang != "auto" and lang not in LANGS:
        raise ValueError(f"langue parlée inconnue : {lang}")
    to = d.get("to") or ""
    if to and to not in LANGS:
        raise ValueError(f"langue de traduction inconnue : {to}")
    mode = d.get("mode") or "rapide"
    if mode not in MODES:
        raise ValueError(f"vitesse inconnue : {mode} (rapide, precis)")
    sp = d.get("speakers")
    speakers = MODES[mode]["speakers"] if sp is None else bool(sp)
    try:
        cpl, max_s = int(d.get("cpl", 42)), float(d.get("max_s", 7.0))
    except (TypeError, ValueError) as e:
        raise ValueError("sous-titres : des nombres") from e
    if cpl not in CPL or max_s not in MAX_S:
        raise ValueError(f"sous-titres : {', '.join(map(str, CPL))} caractères ; {', '.join(str(int(x)) for x in MAX_S)} s")
    aid, why = pick_asr(mode, lang)
    if not aid:
        raise ValueError(f"{MODES[mode]['label']} : {why}")
    if speakers and engine() == "local":
        dz = services()["diar"]
        if not dz["up"]:
            raise ValueError(f"séparer les voix : {dz['why']}")
    if to:
        _, mwhy = mt_state(mode)
        if mwhy:
            raise ValueError(f"traduire : {mwhy}")
    return {"item": it, "lang": lang, "to": to if to != lang else "", "mode": mode, "speakers": speakers,
            "cpl": cpl, "max_s": max_s, "asr": aid}


# ── les routes ──────────────────────────────────────────────
def api_options(req) -> dict:
    sv = services()
    modes = []
    for mid, m in MODES.items():
        aid, why = pick_asr(mid, "auto")
        mt, mwhy = mt_state(mid)
        modes.append({"id": mid, "label": m["label"], "about": m["about"], "speakers": m["speakers"],
                      "off": why if not aid else "", "asr": aid, "asr_name": ASR[aid]["name"] if aid else "",
                      "asr_list": [{"id": a, "name": ASR[a]["name"], "speed": ASR[a]["speed"], "license": ASR[a]["license"],
                                    "src": ASR[a]["src"], "missing": asr_state(a)["missing"] if engine() == "local" else []}
                                   for a in m["asr"]],
                      "mt": mt, "mt_name": MT[mt]["name"], "mt_off": mwhy, "mt_src": MT[mt]["src"]})
    return {"engine": engine(), "modes": modes, "langs": [{"id": k, "name": v} for k, v in LANGS.items()],
            "cpl": list(CPL), "max_s": list(MAX_S), "lines": LINES, "max_duration": MAX_DURATION,
            "diar": sv["diar"], "asset": "subtitle" in library.KINDS,
            "asset_why": "" if "subtitle" in library.KINDS else
            "Asset ne range pas encore de sous-titres : il manque la sorte « subtitle » au socle (étude, § 5.3)"}


def api_list(req) -> dict:
    out = []
    for f in _dir().glob("trn-*.json"):
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
        except ValueError:
            continue
        if library.readable(d):
            out.append(summary(d))
    out.sort(key=lambda s: s.get("created") or "", reverse=True)
    return {"docs": out}


def api_get(req, tid) -> dict:
    return public(_read(tid))


def api_run(req) -> dict:
    try:
        c = check(req.json())
    except ValueError as e:
        raise HttpError(400, str(e)) from e
    it = c["item"]
    # la garde du calcul (celle de jobs.submit) avant d'écrire le document : un guest refusé
    # ne laisse pas une transcription « en file » sans travail (le retrait ci-dessous ne
    # reste que pour ce que la file refuse après, un quota)
    me = auth.current()
    jobs._guard("transcrire.transcribe", {"asr": c["asr"], "mode": c["mode"]}, me, me, jobs._space_for(me))
    now = library.now()
    tid = f"trn-{time.strftime('%Y%m%d-%H%M%S')}-{secrets.token_hex(2)}"
    pub = library.public(it)
    d = {"id": tid, "rev": 1, "created": now, "updated": now, "title": it.get("title") or it["id"], "item": it["id"],
         "kind": it["kind"], "duration": it.get("duration"), "thumb_url": pub.get("thumb_url"),
         "lang": c["lang"], "detected": None, "mode": c["mode"], "speakers_on": c["speakers"], "state": "queued",
         "settings": {"cpl": c["cpl"], "max_s": c["max_s"]}, "segments": [], "speakers": [], "translations": {}}
    library.stamp(d, source=it)   # son auteur ; son Workspace : celui du média (403 si l'on n'y crée pas)
    with _lock:
        _write(d)
    a = ASR[c["asr"]]
    params = {"doc": tid, "item": it["id"], "lang": c["lang"], "to": c["to"], "mode": c["mode"],
              "speakers": c["speakers"], "asr": c["asr"], "beam": MODES[c["mode"]]["beam"],
              "family": a["family"], "mem_gb": a["mem_gb"]}
    try:
        j = jobs.submit("transcrire.transcribe", params, title=f"Transcrire · {d['title'][:48]}", tool="transcrire",
                        thumb=pub.get("thumb_url"), pin=pin_for())
    except Exception:
        _path(tid).unlink(missing_ok=True)
        raise
    d = _update(tid, lambda x: x.update(job=j["id"]))
    return {"doc": public(d), "job": jobs.public(j)}


def api_translate(req, tid) -> dict:
    b = req.json()
    to = b.get("to") or ""
    with _lock:
        d = _read(tid)
        library.check_write(d)
        if to not in LANGS:
            raise HttpError(400, f"langue de traduction inconnue : {to}")
        if d.get("state") != "done":
            raise HttpError(409, "la transcription n'est pas finie")
        if to == d.get("detected"):
            raise HttpError(400, f"le texte est déjà en {LANGS[to].lower()}")
        cur = (d.get("translations") or {}).get(to) or {}
        if cur.get("state") in ("queued", "running"):
            raise HttpError(409, "une traduction dans cette langue est déjà en cours")
        _, why = mt_state(d.get("mode") or "rapide")
        if why:
            raise HttpError(409, f"traduire : {why}")
        # la garde du calcul (celle de jobs.submit) avant d'écrire « en file » dans le document
        me = auth.current()
        jobs._guard("transcrire.translate", {"mode": d.get("mode") or "rapide"}, me, me, jobs._space_for(me))
        # « en file » avant l'envoi : le travail peut finir avant qu'on revienne ici
        _update(tid, lambda x: x.setdefault("translations", {}).__setitem__(to, {**cur, "state": "queued", "error": None}))
    try:
        j = jobs.submit("transcrire.translate", {"doc": tid, "to": to, "mode": d.get("mode") or "rapide", "all": bool(b.get("all"))},
                        title=f"Traduire · {LANGS[to]} · {d.get('title', '')[:40]}", tool="transcrire", thumb=d.get("thumb_url"),
                        pin=pin_for(ollama_url()))
    except Exception:
        _update(tid, lambda x: x["translations"].__setitem__(to, cur) if cur else x["translations"].pop(to, None))
        raise
    d = _update(tid, lambda x: x["translations"][to].update(job=j["id"]))
    return {"doc": public(d), "job": jobs.public(j)}


def api_save(req, tid) -> dict:
    """Corriger : des répliques (texte, traduction), le nom des voix, le titre.
    Les temps ne se changent pas ici : ils viennent du modèle."""
    b = req.json()
    with _lock:
        cur = _read(tid)
        library.check_write(cur)
        if b.get("rev") != cur.get("rev"):
            raise HttpError(409, "cette transcription a changé ailleurs (un autre onglet, une traduction finie) : rechargée")
        if cur.get("state") != "done":
            raise HttpError(409, "la transcription n'est pas finie")
        by = {s["id"]: s for s in cur["segments"]}
        edits = b.get("segments") or []
        if not isinstance(edits, list):
            raise HttpError(400, "segments : une liste")
        for e in edits:
            s = by.get((e or {}).get("id"))
            if not s:
                raise HttpError(400, f"réplique inconnue : {(e or {}).get('id')}")
            if "text" in e:
                t = str(e["text"] or "").strip()
                if len(t) > MAX_TEXT:
                    raise HttpError(400, f"réplique trop longue ({MAX_TEXT} caractères au plus)")
                if t != s.get("text"):
                    s["text"], s["edited"] = t, True
            for lang, t in (e.get("tr") or {}).items():
                if lang not in LANGS or lang not in (cur.get("translations") or {}):
                    raise HttpError(400, f"traduction inconnue : {lang}")
                t = str(t or "").strip()[:MAX_TEXT]
                s.setdefault("tr", {})[lang] = t
                s.setdefault("trh", {})[lang] = _h(s.get("text", ""))   # corrigée à la main : à jour
        names = {s["id"]: s for s in cur.get("speakers") or []}
        for sp in b.get("speakers") or []:
            if (sp or {}).get("id") not in names:
                raise HttpError(400, f"voix inconnue : {(sp or {}).get('id')}")
            names[sp["id"]]["name"] = str(sp.get("name") or "").strip()[:40] or names[sp["id"]]["name"]
        if "title" in b:
            cur["title"] = str(b["title"] or "").strip()[:120] or cur["title"]
        cur["rev"] = int(cur.get("rev") or 0) + 1
        cur["updated"] = library.now()
        _write(cur)
    return public(cur)


def _export(d: dict, fmt: str, which: str, stamps: bool) -> tuple[str, str, str]:
    if fmt not in ("srt", "vtt", "txt"):
        raise HttpError(400, "format : srt, vtt ou txt")
    if which != "src" and which not in (d.get("translations") or {}):
        raise HttpError(400, f"pas de traduction « {which} »")
    if d.get("state") != "done":
        raise HttpError(409, "la transcription n'est pas finie")
    st = d.get("settings") or {}
    if fmt == "txt":
        body, ctype = to_txt(d, which, stamps), "text/plain; charset=utf-8"
    else:
        cs = cues(d, which, int(st.get("cpl", 42)), float(st.get("max_s", 7.0)))
        body, ctype = (to_srt(cs), "application/x-subrip; charset=utf-8") if fmt == "srt" else (to_vtt(cs), "text/vtt; charset=utf-8")
    lang = d.get("detected") if which == "src" else which
    base = re.sub(r"[^\w.-]+", "_", d.get("title") or d["id"]).strip("_")[:60] or d["id"]
    return body, ctype, f"{base}.{lang or 'xx'}.{fmt}"


def api_export(req, tid):
    d = _read(tid)
    body, ctype, name = _export(d, req.q("format", "srt"), req.q("which", "src"), req.q("stamps") == "1")
    return Response(body, ctype=ctype, headers={
        "Content-Disposition": f"attachment; filename=\"{name.encode('ascii', 'replace').decode()}\"; "
                               f"filename*=UTF-8''{urllib.parse.quote(name)}", "Cache-Control": "no-store"})


def api_asset(req, tid) -> dict:
    """Ranger un sous-titre dans Asset : attend la sorte « subtitle » du socle."""
    b = req.json()
    d = _read(tid)
    library.check_write(d)
    if "subtitle" not in library.KINDS:
        raise HttpError(409, api_options(req)["asset_why"])
    fmt = b.get("format") or "srt"
    if fmt not in ("srt", "vtt"):
        raise HttpError(400, "format : srt ou vtt")
    body, _, name = _export(d, fmt, b.get("which") or "src", False)
    tmp = config.data_dir() / "uploads"
    tmp.mkdir(exist_ok=True)
    f = tmp / f"{int(time.time() * 1000)}_{secrets.token_hex(3)}_{name}"
    f.write_text(body, encoding="utf-8")
    try:
        it = library.add_file(f, kind="subtitle", title=name.rsplit(".", 1)[0], parents=[d["item"]],
                              origin={"tool": "transcrire", "user": auth.current_id() or auth.admin_id()},
                              params={"doc": tid, "which": b.get("which") or "src", "format": fmt}, move=True)
    finally:
        f.unlink(missing_ok=True)
    return library.public(it)


def api_delete(req, tid) -> dict:
    with _lock:
        d = _read(tid)
        library.check_trash(d)   # l'auteur, ou un admin du Workspace
        live = _live(d.get("job"))
        if live and live["state"] in ("queued", "running"):
            raise HttpError(409, "une transcription en cours : l'arrêter d'abord (File)")
        trash = _dir() / "corbeille"
        trash.mkdir(exist_ok=True)
        shutil.move(str(_path(tid)), str(trash / f"{tid}.json"))
    return {"ok": True, "id": tid}


def register(app) -> None:
    real = engine() == "local"
    jobs.register("transcrire.transcribe", run_transcribe, lane="audio" if real else "cpu", title="Transcrire",
                  family=(lambda p: p.get("family")) if real else None, gpu=real,
                  mem_gb=(lambda p: p.get("mem_gb")) if real else None, cost="gpu" if real else "cpu")
    jobs.register("transcrire.translate", run_translate, lane="audio" if real else "cpu", title="Traduire",
                  family="ollama-mt" if real else None, gpu=real,
                  mem_gb=(lambda p: MT[MODES[p.get("mode") or "rapide"]["mt"]]["mem_gb"]) if real else None, cost="gpu" if real else "cpu")
    app.route("GET", "/api/transcrire/options", api_options)
    app.route("GET", "/api/transcrire/docs", api_list)
    app.route("POST", "/api/transcrire/run", api_run)
    app.route("GET", "/api/transcrire/docs/{tid}", api_get)
    app.route("POST", "/api/transcrire/docs/{tid}", api_save)
    app.route("POST", "/api/transcrire/docs/{tid}/translate", api_translate)
    app.route("GET", "/api/transcrire/docs/{tid}/export", api_export)
    app.route("POST", "/api/transcrire/docs/{tid}/asset", api_asset)
    app.route("POST", "/api/transcrire/docs/{tid}/delete", api_delete)


# ── le contrôle sans GPU ────────────────────────────────────
SRT_TC = re.compile(r"^(\d{2}):(\d{2}):(\d{2}),(\d{3}) --> (\d{2}):(\d{2}):(\d{2}),(\d{3})$")
VTT_TC = re.compile(r"^(\d{2}):(\d{2}):(\d{2})\.(\d{3}) --> (\d{2}):(\d{2}):(\d{2})\.(\d{3})$")


def _secs(g) -> tuple[float, float]:
    v = [int(x) for x in g]
    return v[0] * 3600 + v[1] * 60 + v[2] + v[3] / 1000, v[4] * 3600 + v[5] * 60 + v[6] + v[7] / 1000


def parse_srt(text: str, cpl: int) -> list[str]:
    """Un analyseur indépendant : ce qui ne va pas (vide = valide)."""
    bad, last = [], 0.0
    blocks = [b for b in text.replace("\r\n", "\n").split("\n\n") if b.strip()]
    if not text.endswith("\n\n"):
        bad.append("le fichier ne finit pas par une ligne vide")
    for n, b in enumerate(blocks, 1):
        ls = b.split("\n")
        if ls[0] != str(n):
            bad.append(f"carton {n} : numéro « {ls[0]} »")
        m = SRT_TC.match(ls[1] if len(ls) > 1 else "")
        if not m:
            bad.append(f"carton {n} : horodatage « {ls[1] if len(ls) > 1 else ''} »")
            continue
        a, z = _secs(m.groups())
        if not a < z:
            bad.append(f"carton {n} : début ≥ fin")
        if a < last - 1e-6:
            bad.append(f"carton {n} : commence avant la fin du précédent")
        last = z
        body = ls[2:]
        if not body or not all(x.strip() for x in body) or len(body) > LINES:
            bad.append(f"carton {n} : {len(body)} lignes")
        if any(len(x) > cpl and " " in x for x in body):
            bad.append(f"carton {n} : ligne de plus de {cpl} caractères")
    return bad


def parse_vtt(text: str) -> list[str]:
    bad, last = [], 0.0
    if not text.startswith("WEBVTT\n"):
        bad.append("pas d'en-tête WEBVTT")
    for n, b in enumerate([b for b in text.split("\n\n")[1:] if b.strip()], 1):
        ls = b.split("\n")
        m = VTT_TC.match(ls[0])
        if not m:
            bad.append(f"carton {n} : horodatage « {ls[0]} »")
            continue
        a, z = _secs(m.groups())
        if not a < z or a < last - 1e-6:
            bad.append(f"carton {n} : temps non croissants")
        last = z
        if len(ls) < 2 or not ls[1].strip():
            bad.append(f"carton {n} : vide")
    return bad


def selftest(call, ok) -> None:
    import os
    import tempfile

    small = mt_messages("fr", "en", [(n, "Tu peux même déverrouiller ta voiture avec ton tél ?") for n in range(30)], ["avant"] * 3, [])
    big = mt_messages("fr", "en", [(n, "x" * MAX_TEXT) for n in range(30)], [], [])
    c1, c2 = mt_context([small]), mt_context([small, big])
    ok(c1 == 8192 and c2 >= len(big[1]["content"]) + 30 * 2 * MAX_TEXT and c2 % CTX_STEP == 0,
       f"traduction : une fenêtre de contexte bornée par le lot le plus long, la même pour tous ({c1}, {c2})")
    ok(pin_for() is None, "factice : aucun jeton GPU épinglé")
    lost = _settled({"state": "running", "job": "job-0000-000000-dead"})
    ok(lost["state"] == "error" and "perdu" in lost["error"] and _settled({"state": "queued"})["state"] == "queued"
       and _settled({"state": "done", "job": "job-x"})["state"] == "done",
       f"un document dont le travail a disparu se montre en échec, pas « en file » pour toujours ({lost})")
    wd = {"segments": [{"id": "s1", "a": 3.4, "b": 5.3, "text": "qu'est-ce que vous voulez ?",
                        "words": [["qu", 3.4, 3.5], ["'est", 3.5, 3.6], ["-ce", 3.6, 3.7], ["que", 3.7, 3.8], ["vous", 3.8, 4.0],
                                  ["voulez", 4.0, 5.1], ["?", 5.1, 5.3]]}]}
    cw = cues(wd)
    ok(len(cw) == 1 and cw[0]["lines"] == ["qu'est-ce que vous voulez ?"] and cw[0]["a"] == 3.4 and cw[0]["b"] == 5.3,
       f"sous-titres : les morceaux de mots de Whisper recollés comme le texte les écrit ({cw})")

    st, o = call("GET", "/api/transcrire/options")
    ok(st == 200 and o.get("engine") == "factice" and {m["id"] for m in o.get("modes", [])} == set(MODES),
       f"transcrire : options, factice par défaut ({st} {o})")
    ok(all(m.get("label") and not m.get("off") for m in o.get("modes", [])), "transcrire : les deux vitesses ouvertes en factice")
    ok(o.get("asset") is ("subtitle" in library.KINDS) and (o.get("asset") or o.get("asset_why")),
       "transcrire : ranger dans Asset dit pourquoi il attend")
    ok(all(a.get("src") and a.get("license") for m in o.get("modes", []) for a in m["asr_list"]),
       "transcrire : chaque moteur dit sa source et sa licence")

    # le format, sur un document écrit à la main (mots, texte corrigé, traduction, bornes)
    d = {"speakers": [{"id": "S1", "name": "Voix 1"}, {"id": "S2", "name": "Léa <b>"}], "segments": [
        {"id": "s1", "a": 0.5, "b": 3.0, "text": "Bonjour à tous.", "spk": "S1",
         "words": [["Bonjour", 0.5, 1.1], ["à", 1.2, 1.3], ["tous.", 1.35, 2.9]], "tr": {"en": "Hello everyone."}},
        {"id": "s2", "a": 2.8, "b": 12.0, "spk": "S2", "edited": True, "words": [["x", 2.8, 3.0]],
         "text": "Une réplique très longue qui doit forcément se couper en plusieurs cartons parce qu'elle dépasse "
                 "de loin deux lignes de quarante-deux caractères et sept secondes à l'écran.",
         "tr": {"en": "A very long line that must be split into several subtitles."}},
        {"id": "s3", "a": 12.0, "b": 12.02, "text": "ah", "spk": None},
        {"id": "s4", "a": 3600.25, "b": 3602.0, "text": "Une heure plus tard.", "spk": "S1", "tr": {"en": ""}},
    ]}
    cs = cues(d, "src", 42, 7.0)
    ok(len(cs) >= 4 and all(c["a"] < c["b"] for c in cs) and all(cs[i]["a"] >= cs[i - 1]["b"] for i in range(1, len(cs))),
       f"transcrire : cartons croissants, sans chevauchement ({cs})")
    ok(all(len(c["lines"]) <= LINES and all(len(x) <= 42 for x in c["lines"]) and c["b"] - c["a"] <= 7.0 + 1e-6 for c in cs),
       "transcrire : 2 lignes de 42 caractères, 7 s au plus")
    srt = to_srt(cs)
    ok(not parse_srt(srt, 42), f"transcrire : SRT valide ({parse_srt(srt, 42)})")
    ok("01:00:00,250 --> " in srt, "transcrire : SRT au-delà d'une heure")
    vtt = to_vtt(cs)
    ok(not parse_vtt(vtt) and "<v Léa &lt;b&gt;>" in vtt, f"transcrire : VTT valide, voix échappée ({parse_vtt(vtt)})")
    en = cues(d, "en", 42, 7.0)
    ok(en and not parse_srt(to_srt(en), 42) and all("Une" not in " ".join(c["lines"]) for c in en),
       "transcrire : SRT de la traduction, répartie au prorata")
    txt = to_txt(d, "src", stamps=True)
    ok(txt.startswith("[00:00] Voix 1 : Bonjour") and "[01:00:00] Voix 1 : Une heure plus tard." in txt, f"transcrire : TXT ({txt})")
    ok(wrap("a " * 5 + "x" * 60, 10)[-1] == "x" * 60, "transcrire : un mot plus long que la ligne tient seul")

    # un son d'essai : deux passages de tonalité séparés par un silence
    tmp = Path(tempfile.mkdtemp(prefix="sr_trn_"))
    wav, mp4 = tmp / "essai.wav", tmp / "muette.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=330:duration=4",
                    "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-f", "lavfi", "-i", "sine=frequency=440:duration=5",
                    "-filter_complex", "[1]atrim=0:2[s];[0][s][2]concat=n=3:v=0:a=1", str(wav)], capture_output=True, timeout=60)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=24:duration=1",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", str(mp4)], capture_output=True, timeout=60)
    regions = speech_regions(wav, 11.0)
    ok(len(regions) == 2 and abs(regions[0][1] - 4.0) < 0.2 and abs(regions[1][0] - 6.0) < 0.2,
       f"transcrire : les passages parlés du factice suivent le son ({regions})")
    st, au = call("PUT", "/api/library/upload?name=essai.wav&title=Essai%20voix&tool=upload", raw=wav.read_bytes())
    aid = au.get("id")
    ok(st == 200 and au.get("kind") == "audio", f"transcrire : un son déposé ({st} {au})")
    st, r = call("PUT", "/api/library/upload?name=notes.txt&tool=upload", raw=b"pas un son")
    ok(st == 415, f"transcrire : un fichier qui n'est pas un média est refusé au dépôt ({st})")
    st, mv = call("PUT", "/api/library/upload?name=muette.mp4&title=Muette&tool=upload", raw=mp4.read_bytes())
    st2, r = call("POST", "/api/transcrire/run", {"item": mv.get("id")})
    ok(st2 == 400 and "piste son" in r.get("error", ""), f"transcrire : une vidéo sans son est refusée ({st2} {r})")
    buf = subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=c=gray:s=32x24", "-frames:v", "1",
                          "-f", "image2pipe", "-vcodec", "png", "-"], capture_output=True, timeout=30).stdout
    st, im = call("PUT", "/api/library/upload?name=img.png&tool=upload", raw=buf)
    st2, r = call("POST", "/api/transcrire/run", {"item": im.get("id")})
    ok(st2 == 400 and "ni un son ni une vidéo" in r.get("error", ""), f"transcrire : une image est refusée ({st2} {r})")
    for body, msg in (({"item": aid, "lang": "xx"}, "langue inconnue"), ({"item": aid, "mode": "turbo"}, "vitesse inconnue"),
                      ({"item": aid, "cpl": 50}, "sous-titres hors bornes"), ({}, "sans média")):
        st2, r = call("POST", "/api/transcrire/run", body)
        ok(st2 == 400 and r.get("error"), f"transcrire : refusé — {msg} ({st2} {r})")
    shutil.rmtree(tmp, ignore_errors=True)

    def wait_doc(tid, pred):
        for _ in range(200):
            st, dd = call("GET", f"/api/transcrire/docs/{tid}")
            if pred(dd):
                return dd
            time.sleep(0.1)
        return dd

    # de bout en bout : transcrire (précis : les voix), traduire à la suite
    st, r = call("POST", "/api/transcrire/run", {"item": aid, "lang": "auto", "to": "en", "mode": "precis"})
    ok(st == 200 and r.get("doc", {}).get("id") and r.get("job", {}).get("id"), f"transcrire : lancé ({st} {r})")
    tid = r.get("doc", {}).get("id", "trn-00000000-000000-0000")
    dd = wait_doc(tid, lambda x: x.get("state") in ("done", "error") and (x.get("translations") or {}).get("en", {}).get("state") in ("done", "error"))
    segs = dd.get("segments") or []
    ok(dd.get("state") == "done" and len(segs) >= 2 and dd.get("detected") == "fr", f"transcrire : transcrit ({dd.get('state')} {dd.get('error')} {len(segs)})")
    ok(all(0 <= s["a"] < s["b"] <= 11.05 for s in segs) and all(segs[i]["a"] >= segs[i - 1]["b"] for i in range(1, len(segs))),
       "transcrire : répliques dans la durée, croissantes")
    ok(not any(4.2 < (s["a"] + s["b"]) / 2 < 5.8 for s in segs), "transcrire : rien dans le silence")
    ok(all(s.get("words") and s["words"][0][1] >= s["a"] and s["words"][-1][2] <= s["b"] for s in segs), "transcrire : mots horodatés dans leur réplique")
    ok(dd.get("speakers") and all(s.get("spk") for s in segs), "transcrire : précis sépare les voix")
    ok(dd.get("translations", {}).get("en", {}).get("state") == "done" and all(s.get("tr", {}).get("en") for s in segs)
       and dd.get("stale", {}).get("en") == 0, f"transcrire : traduit en anglais à la suite ({dd.get('translations')})")
    ok(segs and segs[0]["tr"]["en"] in BANK["en"], "transcrire : la traduction factice est la même réplique en anglais")

    # corriger : texte, traduction, voix ; 409 sur une vieille révision
    s0 = segs[0]["id"] if segs else "s0001"
    st, e = call("POST", f"/api/transcrire/docs/{tid}", {"rev": dd.get("rev"), "segments": [{"id": s0, "text": "Texte corrigé à la main."}],
                                                        "speakers": [{"id": (dd.get("speakers") or [{}])[0].get("id"), "name": "Léa"}]})
    ok(st == 200 and e["segments"][0]["text"] == "Texte corrigé à la main." and e["segments"][0].get("edited")
       and e["stale"]["en"] == 1 and e["speakers"][0]["name"] == "Léa", f"transcrire : corrigé, la traduction passe « à retraduire » ({st} {e.get('stale') if isinstance(e, dict) else e})")
    st, e2 = call("POST", f"/api/transcrire/docs/{tid}", {"rev": dd.get("rev"), "segments": [{"id": s0, "text": "autre"}]})
    ok(st == 409, f"transcrire : une vieille révision est refusée ({st})")
    st, e2 = call("POST", f"/api/transcrire/docs/{tid}", {"rev": e.get("rev"), "segments": [{"id": "s9999", "text": "?"}]})
    ok(st == 400, "transcrire : réplique inconnue refusée")

    # exporter : SRT, VTT, TXT, de l'original et de la traduction
    for fmt, which in (("srt", "src"), ("srt", "en"), ("vtt", "src"), ("vtt", "en"), ("txt", "src")):
        st, raw = call("GET", f"/api/transcrire/docs/{tid}/export?format={fmt}&which={which}")
        text = raw.decode("utf-8") if isinstance(raw, bytes) else str(raw)
        valid = parse_srt(text, 42) if fmt == "srt" else parse_vtt(text) if fmt == "vtt" else ([] if text.strip() else ["vide"])
        ok(st == 200 and not valid, f"transcrire : export {fmt} {which} valide ({st} {valid} {text[:200]})")
        if fmt == "srt" and which == "src":
            ok("Texte corrigé à la main." in text.replace("\n", " "), "transcrire : l'export suit la correction")
    st, r = call("GET", f"/api/transcrire/docs/{tid}/export?format=pdf")
    ok(st == 400, "transcrire : format inconnu refusé")
    st, r = call("GET", f"/api/transcrire/docs/{tid}/export?which=de")
    ok(st == 400, "transcrire : traduction absente refusée")

    # retraduire : seule la réplique corrigée ; déjà dans la langue : refusé
    st, r = call("POST", f"/api/transcrire/docs/{tid}/translate", {"to": "en"})
    dd = wait_doc(tid, lambda x: (x.get("translations") or {}).get("en", {}).get("state") in ("done", "error"))
    ok(st == 200 and dd.get("stale", {}).get("en") == 0 and "factice" in dd["segments"][0]["tr"]["en"],
       f"transcrire : la réplique corrigée est retraduite ({st} {dd.get('stale')})")
    st, r = call("POST", f"/api/transcrire/docs/{tid}/translate", {"to": "fr"})
    ok(st == 400 and "déjà" in r.get("error", ""), f"transcrire : traduire vers la langue parlée refusé ({st} {r})")
    st, r = call("POST", f"/api/transcrire/docs/{tid}/asset", {"format": "srt"})
    ok((st == 409 and "subtitle" in r.get("error", "")) if "subtitle" not in library.KINDS else st == 200,
       f"transcrire : ranger dans Asset attend le socle ({st} {r})")

    # rapide : une voix, pas de traduction ; la liste ; la corbeille
    st, r = call("POST", f"/api/transcrire/run", {"item": aid, "lang": "es", "mode": "rapide", "to": ""})
    t2 = r.get("doc", {}).get("id", "trn-00000000-000000-0000")
    d2 = wait_doc(t2, lambda x: x.get("state") in ("done", "error"))
    ok(d2.get("state") == "done" and not d2.get("speakers") and d2["segments"][0]["text"] in BANK["es"] and not d2.get("translations"),
       f"transcrire : rapide, espagnol, sans voix ni traduction ({d2.get('state')})")
    st, lst = call("GET", "/api/transcrire/docs")
    ok(st == 200 and {tid, t2} <= {x["id"] for x in lst.get("docs", [])}, "transcrire : la liste")
    st, r = call("POST", f"/api/transcrire/docs/{t2}/delete")
    st2, _ = call("GET", f"/api/transcrire/docs/{t2}")
    ok(st == 200 and st2 == 404 and (_dir() / "corbeille" / f"{t2}.json").exists(), "transcrire : à la corbeille de l'outil")
    for bad in ("trn-nexiste-pas", "trn-20260929-000000-zzzz", "jobs"):   # « .. » : le socle répond 400 avant nous
        st, _ = call("GET", f"/api/transcrire/docs/{bad}")
        ok(st == 404, f"transcrire : « {bad} » n'est pas une transcription : 404 ({st})")

    # le câblage réel : les consignes de chaque moteur existent, le moteur se lit sans GPU
    ok(WORKER.is_file() and "def main" in WORKER.read_text(encoding="utf-8"), "transcrire : le sous-processus du moteur réel existe")
    r = subprocess.run([sys.executable, str(WORKER), "--check"], capture_output=True, text=True, timeout=60,
                       env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"})
    ok(r.returncode == 0 and "ok" in r.stdout, f"transcrire : le moteur réel se charge à vide ({r.returncode} {r.stdout} {r.stderr[-300:]})")
    ok(assign_speakers([{"a": 0.0, "b": 2.0}, {"a": 2.0, "b": 5.0}], [[0, 1.5, 0], [1.5, 5, 1]])[1]["id"] == "S2",
       "transcrire : la voix qui recouvre le plus une réplique la prend")
