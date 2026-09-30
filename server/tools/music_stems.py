"""Séparer un son en pistes (stems) — voix, batterie, basse, autre, et
guitare/piano quand un modèle le fait — pour les caler dans ODIO.

  music.stems   {"src": id d'un son, "model": id des options, "stems": [...]}
                -> un objet audio par piste (`params.stem` = son nom,
                   `parents` = [src]) : même fréquence, même nombre
                   d'échantillons, même départ que la source

Deux moteurs, choisis par `showrunner.local.json` (lu au démarrage) :

  factice (défaut)        voie `cpu` : des filtres ffmpeg (passe-haut, passe-bas…),
                          étiquetés « essai ». Pas une séparation : de quoi
                          mener ODIO de bout en bout sans GPU.
  "music_stems": true     voie `audio`, selon le modèle :
     comfy   ComfyUI, nœud AudioSeparateDemucs (AudioSeparation, set-soft) —
             Demucs v4 ; le modèle n'est pris que s'il est marqué 💾 (sur
             disque), jamais un téléchargement
     asep    audio-separator 0.44.2 (venv ~/audio-studio, lu seulement) en
             sous-processus sur la machine du portail — les RoFormer
     chain   la voix par BS-RoFormer, puis Demucs sur l'instrumental

Le calage : la source est décodée une seule fois par ffmpeg en WAV 24 bits
stéréo à sa fréquence ; c'est ce WAV que reçoit le séparateur, et chaque
piste est ramenée par ffmpeg à cette fréquence et à ce nombre exact
d'échantillons (aresample, apad, atrim), en FLAC 24 bits. Le compte est
vérifié piste par piste.

Les mesures publiées, ce qui est installé, ce qu'on retient et ce qu'il
faudrait télécharger : docs/etudes/stems.md.
"""

from __future__ import annotations

import json
import re
import shutil
import socket
import subprocess
import time
import wave
from pathlib import Path

from core import config, jobs, library
from core.comfy import Cancelled, Comfy, ComfyError
from core.http import HttpError
from tools.music_yue import check_graph, fetch_info

HOME = Path.home()
ON_DISK = "\U0001F4BE"          # AudioSeparation marque ainsi un modèle déjà sur disque
DEMUCS_OUTS = ("vocals", "drums", "bass", "other", "guitar", "piano")  # sorties d'AudioSeparateDemucs, dans l'ordre
STEM_FR = {"vocals": "voix", "drums": "batterie", "bass": "basse", "other": "autre",
           "guitar": "guitare", "piano": "piano", "instrumental": "instrumental"}
TIMEOUT = 3600
MULTISONG = "Multisong (MVSep)"
ZFT = "ZFTurbo/Music-Source-Separation-Training, docs/pretrained_models.md"
ASEP_SCORES = "python-audio-separator 0.44.2, models-scores.json (médiane sur des pistes de MUSDB18)"
MVSEP = "mvsep.com/quality_checker/multisong_leaderboard, relevé le 29/09/2026"

# ── le catalogue : ce que le portail sait lancer ─────────────
# measures : SDR en dB (plus haut = mieux), telles que publiées ; « n » = pistes
MODELS: dict[str, dict] = {
    "htdemucs_ft": {
        "label": "Demucs v4 affiné (htdemucs_ft)",
        "stems": ["vocals", "drums", "bass", "other"],
        "runner": "comfy", "comfy_model": "Hybrid Transformer fine-tuned",
        "files": ["ComfyUI/models/audio/Demucs/htdemucs_ft.safetensors"],
        "measures": [
            {"set": MULTISONG, "sdr": {"bass": 12.05, "drums": 11.24, "other": 5.74, "vocals": 8.33, "instrumental": 14.64},
             "note": "entrée 262 « Demucs4 HT (htdemucs_ft) » ; avec shifts=10, overlap 0,95 (entrée 435) : "
                     "+0,1 à +0,2 dB pour dix fois le calcul", "source": MVSEP},
            {"set": MULTISONG, "sdr": {"drums": 11.13, "bass": 11.96, "other": 5.85, "vocals": 8.38},
             "note": "les quatre modèles affinés qui le composent, chacun sur sa piste", "source": ZFT},
            {"set": "MUSDB18, n=13", "sdr": {"vocals": 10.79, "drums": 10.02, "bass": 12.02}, "source": ASEP_SCORES},
        ],
        "speed": "8 s pour 30 s de musique (DGX2, 28/09, docs/etudes/musique.md)",
        "license": "MIT (Demucs ; poids repris par set-soft/audio_separation, MIT)",
    },
    "bs_roformer_viperx": {
        "label": "BS-RoFormer viperx 1297 (voix / instrumental)",
        "stems": ["vocals", "instrumental"],
        "runner": "asep", "asep_model": "model_bs_roformer_ep_317_sdr_12.9755.ckpt",
        "files": ["ComfyUI/models/audio/RoFormer/model_bs_roformer_ep_317_sdr_12.9755.ckpt",
                  "ComfyUI/models/audio/RoFormer/model_bs_roformer_ep_317_sdr_12.9755.yaml"],
        "measures": [
            {"set": MULTISONG, "sdr": {"vocals": 10.87, "instrumental": 17.18},
             "note": "entrée 6176 « BS Roformer, viperx edition » ; ZFTurbo publie le même 10,87", "source": MVSEP},
            {"set": "MUSDB18, n=40", "sdr": {"vocals": 11.77, "instrumental": 16.45}, "source": ASEP_SCORES},
        ],
        "speed": "non mesuré ici",
        "license": "non précisée par sa source (dépôt de modèles d'UVR, TRvlvr/model_repo)",
    },
    "roformer_htdemucs_ft": {
        "label": "voix BS-RoFormer + Demucs affiné sur l'instrumental",
        "stems": ["vocals", "drums", "bass", "other"],
        "runner": "chain",
        "files": [],
        "measures": [
            {"set": MULTISONG, "sdr": {"bass": 12.47, "drums": 11.86, "other": 7.13, "vocals": 11.01, "instrumental": 17.32},
             "note": "entrée 6855 « output_bs-r_only_htdemucs_ft » : BS-RoFormer puis htdemucs_ft, d'après son nom "
                     "(réglages non publiés)", "source": MVSEP},
        ],
        "note": "le reste de voix que Demucs trouverait dans l'instrumental n'est pas gardé",
        "speed": "non mesuré ici",
        "license": "celles des deux maillons",
    },
    "bs_roformer_sw": {
        "label": "BS-RoFormer SW (6 pistes)",
        "stems": ["vocals", "drums", "bass", "other", "guitar", "piano"],
        "runner": "asep", "asep_model": "BS-Roformer-SW.ckpt",
        "files": ["ComfyUI/models/audio/RoFormer/BS-Roformer-SW.ckpt",
                  "ComfyUI/models/audio/RoFormer/BS-Roformer-SW.yaml"],
        "measures": [
            {"set": MULTISONG, "sdr": {"bass": 14.62, "drums": 14.11, "other": 8.72, "vocals": 11.30,
                                       "instrumental": 17.51},
             "note": "entrée 8374 « BS Roformer SW (6 stems) » ; guitare et piano non notés", "source": MVSEP},
        ],
        "download": {"files": [{"name": "BS-Roformer-SW.ckpt", "bytes": 699412152},
                               {"name": "BS-Roformer-SW.yaml", "bytes": 4653}],
                     "source": "github.com/nomadkaraoke/python-audio-separator/releases/download/model-configs/",
                     "into": "ComfyUI/models/audio/RoFormer/ (les deux DGX, par tools/mirror_stems.sh)"},
        "speed": "non mesuré ici",
        "license": "non précisée par sa source (« BS Roformer SW by jarredou », models.json d'audio-separator)",
    },
    "htdemucs_6s": {
        "label": "Demucs v4 6 sources (htdemucs_6s)",
        "stems": ["vocals", "drums", "bass", "other", "guitar", "piano"],
        "runner": "comfy", "comfy_model": "Hybrid Transformer 6 sources",
        "files": ["ComfyUI/models/audio/Demucs/htdemucs_6s.safetensors"],
        "measures": [
            {"set": MULTISONG, "sdr": {"bass": 11.22, "drums": 10.22, "vocals": 8.05},
             "note": "autre, guitare et piano non notés", "source": ZFT},
            {"set": "MUSDB18, n=12", "sdr": {"vocals": 9.57, "drums": 8.47, "bass": 10.10}, "source": ASEP_SCORES},
        ],
        "download": {"files": [{"name": "htdemucs_6s.safetensors", "bytes": 54890960}],
                     "source": "huggingface.co/set-soft/audio_separation (Demucs/, MIT)",
                     "into": "ComfyUI/models/audio/Demucs/ (les deux DGX)"},
        "speed": "non mesuré ici",
        "license": "MIT",
    },
}
DEFAULT_MODEL = "htdemucs_ft"
RECOMMENDED = ("bs_roformer_sw", "roformer_htdemucs_ft", "htdemucs_ft")   # le premier prêt
# les noms qu'audio-separator met entre parenthèses dans ses fichiers
ASEP_NAMES = {"vocals": "vocals", "instrumental": "instrumental", "drums": "drums", "bass": "bass",
              "other": "other", "guitar": "guitar", "piano": "piano"}
# mode essai : des filtres ffmpeg (documentation ffmpeg-filters), pas une séparation
TEST_FILTERS = {"vocals": "highpass=f=300,lowpass=f=3400", "drums": "highpass=f=4000", "bass": "lowpass=f=160",
                "other": "highpass=f=160,lowpass=f=4000", "guitar": "bandpass=f=1200:width_type=q:w=1",
                "piano": "bandpass=f=600:width_type=q:w=1", "instrumental": "bandreject=f=1850:width_type=h:w=3100"}


def mode() -> str:
    return "reel" if config.get("music_stems") is True else "factice"


# l'interrupteur, déclaré pour la page Admin → Câblage
config.declare_switch("music_stems", [False, True], label="Musique · séparation (stems)", default=False,
                      doc="server/tools/music_stems.py, mode() : factice (filtres ffmpeg) ou Demucs par ComfyUI et RoFormer par audio-separator")


def asep_bin() -> Path:
    return Path(config.get("stems_asep_bin") or HOME / "audio-studio/.venv/bin/audio-separator").expanduser()


def model_dir() -> Path:
    return Path(config.get("stems_model_dir") or HOME / "ComfyUI/models/audio/RoFormer").expanduser()


# ── les réglages ────────────────────────────────────────────
def stems_params(d: dict) -> dict:
    if not isinstance(d, dict):
        raise ValueError("les réglages sont un objet")
    src = d.get("src") or d.get("item") or ""           # « item » : l'ancien contrat de music.py
    it = library.get(src) if isinstance(src, str) and src else None
    if not it or it.get("kind") != "audio":
        raise ValueError("choisis un son de la bibliothèque à séparer")
    model = d.get("model") or DEFAULT_MODEL
    if model not in MODELS:
        raise ValueError(f"modèle inconnu : {model} (voir /api/music/stems/options)")
    have = MODELS[model]["stems"]
    stems = d.get("stems") or list(have)
    if not isinstance(stems, list) or not all(isinstance(s, str) for s in stems):
        raise ValueError("stems : une liste de noms de pistes")
    bad = [s for s in stems if s not in have]
    if bad:
        raise ValueError(f"{MODELS[model]['label']} ne sort pas : {', '.join(bad)} (il sort : {', '.join(have)})")
    if len(set(stems)) != len(stems):
        raise ValueError("une piste demandée deux fois")
    return {"src": it["id"], "model": model, "stems": [s for s in have if s in stems]}


# ── le calage : décoder une fois, ramener chaque piste au même compte ──
def _ffmpeg(args: list[str], what: str, timeout: int = 1800) -> None:
    r = subprocess.run(["ffmpeg", "-v", "error", "-y", *args], capture_output=True, text=True, timeout=timeout)
    if r.returncode != 0:
        raise RuntimeError(f"ffmpeg ({what}) : {r.stderr.strip()[:400]}")


def decode_source(it: dict, workdir: Path) -> tuple[Path, int, int]:
    """La source en WAV 24 bits stéréo à sa propre fréquence : (chemin,
    fréquence, nombre d'échantillons). Un seul décodage, par ffmpeg, pour
    que le séparateur et ODIO partent du même premier échantillon."""
    src = library.path_of(it)
    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=sample_rate",
                        "-of", "json", str(src)], capture_output=True, text=True, timeout=120)
    try:
        sr = int(json.loads(r.stdout)["streams"][0]["sample_rate"])
    except (ValueError, KeyError, IndexError) as e:
        raise RuntimeError(f"ffprobe ne lit pas la source : {r.stderr.strip()[:300]}") from e
    mix = workdir / "mix.wav"
    _ffmpeg(["-i", str(src), "-map", "0:a:0", "-ac", "2", "-ar", str(sr), "-c:a", "pcm_s24le", str(mix)], "décodage")
    with wave.open(str(mix)) as w:
        n = w.getnframes()
    if n <= 0:
        raise RuntimeError("la source ne contient aucun échantillon")
    return mix, sr, n


def samples_of(path: Path) -> int:
    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=duration_ts",
                        "-of", "json", str(path)], capture_output=True, text=True, timeout=120)
    try:
        return int(json.loads(r.stdout)["streams"][0]["duration_ts"])
    except (ValueError, KeyError, IndexError, TypeError):
        return -1


def conform(src: Path, dest: Path, sr: int, n: int, pre: str = "") -> Path:
    """Une piste ramenée à `sr` Hz et exactement `n` échantillons, stéréo ;
    FLAC 24 bits (ou WAV 24 bits si `dest` finit en .wav)."""
    chain = (pre + "," if pre else "") + f"aresample={sr},apad=whole_len={n},atrim=end_sample={n}"
    codec = ["-c:a", "pcm_s24le"] if dest.suffix == ".wav" else ["-c:a", "flac", "-sample_fmt", "s32"]
    _ffmpeg(["-i", str(src), "-af", chain, "-ac", "2", "-ar", str(sr), *codec, str(dest)], "calage")
    if dest.suffix == ".wav":
        with wave.open(str(dest)) as w:
            got = w.getnframes()
    else:
        got = samples_of(dest)
    if got != n:
        raise RuntimeError(f"{dest.name} : {got} échantillons au lieu de {n}")
    return dest


# ── Demucs par ComfyUI ──────────────────────────────────────
def pick_on_disk(options: list[str], name: str) -> str:
    """L'option du modèle marquée 💾 ; jamais une « ⬇️ » (un téléchargement)."""
    for o in options:
        if o.startswith(ON_DISK) and o.endswith(name):
            return o
    raise ValueError(f"le modèle Demucs « {name} » n'est pas sur disque (models/audio/Demucs) : "
                     "le télécharger demande l'accord de Cal")


def demucs_options(c: Comfy) -> list[str]:
    conf = c.object_info("AudioSeparateDemucs")["AudioSeparateDemucs"]["input"]["required"]["model"]
    return conf[0] if isinstance(conf[0], list) else conf[1].get("options", [])


def build_demucs_graph(audio_name: str, model_option: str, stems: list[str]) -> dict:
    """Réglages du nœud AudioSeparateDemucs tels que l'exemple « 04_Demucs » du
    paquet (et music.py le 28/09) : shifts 0, overlap 0,25, segment du modèle."""
    g = {"1": {"class_type": "LoadAudio", "_meta": {"title": "mélange"}, "inputs": {"audio": audio_name}},
         "2": {"class_type": "AudioSeparateDemucs", "_meta": {"title": "Demucs"},
               "inputs": {"input_sound": ["1", 0], "model": model_option, "shifts": 0, "overlap": 0.25,
                          "custom_segment": False, "segment": 44, "target_device": "cuda"}}}
    for stem in stems:
        g[str(10 + DEMUCS_OUTS.index(stem))] = {
            "class_type": "SaveAudioAdvanced", "_meta": {"title": f"OUT {stem}"},
            "inputs": {"audio": ["2", DEMUCS_OUTS.index(stem)], "filename_prefix": f"showrunner/stem_{stem}",
                       "format": "flac"}}
    return g


def demucs_comfy(ctx, wav: Path, model_name: str, stems: list[str]) -> dict[str, Path]:
    ctx.progress(message="envoie le son à ComfyUI")
    name = ctx.comfy.upload(wav)
    graph = build_demucs_graph(name, pick_on_disk(demucs_options(ctx.comfy), model_name), stems)
    problems = check_graph(graph, fetch_info(ctx.comfy, [n["class_type"] for n in graph.values()]))
    if problems:
        raise ComfyError("graphe Demucs refusé avant l'envoi : " + " ; ".join(problems[:6]))
    ctx.check()
    pid = ctx.comfy.queue(graph)
    entry = ctx.comfy.wait(pid, cancelled=ctx.cancelled, report=ctx.comfy_report("Demucs"), timeout=TIMEOUT)
    out = {}
    for f in Comfy.outputs(entry, graph):
        stem = graph[f["node"]]["_meta"]["title"].split(" ", 1)[1]
        out[stem] = ctx.comfy.download(f, ctx.workdir / f"demucs_{stem}{Path(f['filename']).suffix or '.flac'}")
    miss = [s for s in stems if s not in out]
    if miss:
        raise ComfyError(f"Demucs n'a pas rendu : {', '.join(miss)}")
    return out


# ── RoFormer par audio-separator ────────────────────────────
def asep_command(wav: Path, model_file: str, out_dir: Path) -> list[str]:
    """--normalization 1.0 : audio-separator ne baisse alors que ce qui dépasse
    0 dBFS (spec_utils.normalize) — au défaut 0,9 il changerait le niveau des
    pistes, qui ne redonneraient plus le mélange."""
    return [str(asep_bin()), str(wav), "-m", model_file, "--model_file_dir", str(model_dir()),
            "--output_dir", str(out_dir), "--output_format", "FLAC", "--normalization", "1.0",
            "--log_level", "warning"]


def asep_outputs(files: list[Path]) -> dict[str, Path]:
    """audio-separator nomme ses fichiers « <entrée>_(Vocals)_<modèle>.flac »."""
    out = {}
    for f in files:
        m = re.search(r"_\(([^)]+)\)", f.name)
        if m and m.group(1).lower() in ASEP_NAMES:
            out[ASEP_NAMES[m.group(1).lower()]] = f
    return out


def asep_run(ctx, wav: Path, model_file: str, stems: list[str], tag: str = "roformer") -> dict[str, Path]:
    out_dir = ctx.workdir / f"asep_{tag}"
    out_dir.mkdir(parents=True, exist_ok=True)
    ctx.progress(message=f"{model_file} (audio-separator, sur {socket.gethostname()})")
    proc = subprocess.Popen(asep_command(wav, model_file, out_dir), stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, text=True, cwd=str(out_dir))
    t0 = time.time()
    lines: list[str] = []
    try:
        while True:
            try:
                o, _ = proc.communicate(timeout=1.0)
                lines.append(o or "")
                break
            except subprocess.TimeoutExpired:
                if ctx.cancelled():
                    raise Cancelled("arrêté")
                if time.time() - t0 > TIMEOUT:
                    raise RuntimeError(f"audio-separator trop long (> {TIMEOUT} s)")
    finally:
        if proc.poll() is None:            # arrêt par son PID, jamais par motif
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()
    if proc.returncode != 0:
        raise RuntimeError(f"audio-separator a échoué : {''.join(lines).strip()[-600:]}")
    got = asep_outputs(sorted(out_dir.glob("*.flac")))
    miss = [s for s in stems if s not in got]
    if miss:
        raise RuntimeError(f"audio-separator n'a pas rendu : {', '.join(miss)} (fichiers : "
                           f"{', '.join(p.name for p in out_dir.iterdir())[:300]})")
    return {s: got[s] for s in stems}


# ── ce que les machines savent faire ────────────────────────
_ready_cache: dict = {"t": 0.0, "v": None}


def _local_audio_endpoint() -> str | None:
    for ep in config.get("lanes", {}).get("audio", []):
        if ep != "local" and ("127.0.0.1" in ep or "localhost" in ep):
            return ep
    return None


def _comfy_state() -> list[dict]:
    """Pour chaque ComfyUI de la voie audio : les modèles Demucs sur disque."""
    out = []
    for ep in [e for e in config.get("lanes", {}).get("audio", []) if e != "local"]:
        m = {"machine": jobs.machine_of(ep), "endpoint": ep, "on_disk": [], "why": ""}
        ok, why = jobs.endpoint_alive(ep)
        if not ok:
            m["why"] = f"ComfyUI ne répond pas ({why})"[:300]
        else:
            try:
                m["on_disk"] = [o[len(ON_DISK):].strip() for o in demucs_options(Comfy(ep, timeout=20))
                                if o.startswith(ON_DISK)]
            except (ComfyError, KeyError, IndexError) as e:
                m["why"] = f"nœud AudioSeparateDemucs absent ({e})"[:300]
        out.append(m)
    return out


def _asep_state(model: dict) -> tuple[bool, str]:
    b = asep_bin()
    if not b.exists():
        return False, f"audio-separator absent ({b})"
    d = model_dir()
    stem = Path(model["asep_model"]).stem
    miss = [f for f in (model["asep_model"], stem + ".yaml", "download_checks.json") if not (d / f).exists()]
    if miss:
        return False, f"absent de {d} : {', '.join(miss)}" + (" — téléchargement proposé" if model.get("download") else "")
    return True, ""


def readiness(max_age: float = 60.0) -> dict:
    """{modèle: {ready, why, machine}} pour le moteur réel."""
    if _ready_cache["v"] is not None and time.time() - _ready_cache["t"] < max_age:
        return _ready_cache["v"]
    comfy = _comfy_state()
    _ready_cache["comfy"] = comfy
    here = socket.gethostname()

    def comfy_ok(name):
        for m in comfy:
            if name in m["on_disk"]:
                return True, "", m["machine"]
        why = "; ".join(f"{m['machine']} : {m['why'] or 'pas sur disque'}" for m in comfy) or \
            "aucune voie « audio » dans la configuration du portail"
        return False, why, ""

    out = {}
    for mid, m in MODELS.items():
        if m["runner"] == "comfy":
            ok, why, mach = comfy_ok(m["comfy_model"])
            if not ok and m.get("download"):
                why += " — téléchargement proposé"
        elif m["runner"] == "asep":
            ok, why = _asep_state(m)
            mach = here if ok else ""
        else:
            ok1, why1 = _asep_state(MODELS["bs_roformer_viperx"])
            ok2, why2, mach2 = comfy_ok(MODELS["htdemucs_ft"]["comfy_model"])
            ok, why, mach = ok1 and ok2, " ; ".join(w for w in (why1, why2) if w), (here if ok1 and ok2 else "")
        out[mid] = {"ready": ok, "why": why, "machine": mach}
    _ready_cache.update(t=time.time(), v=out)
    return out


def options(req=None) -> dict:
    fake = mode() == "factice"
    ff = bool(shutil.which("ffmpeg") and shutil.which("ffprobe"))
    cpu = bool(config.get("lanes", {}).get("cpu"))
    real = readiness()
    models = []
    for mid, m in MODELS.items():
        r = real[mid]
        if fake:
            ready, why = cpu and ff, ("" if cpu and ff else "ffmpeg ou la voie « cpu » manque à la machine du portail")
        else:
            ready, why = r["ready"] and ff, (r["why"] or ("" if ff else "ffmpeg manque à la machine du portail"))
        models.append({"id": mid, "label": m["label"], "stems": m["stems"],
                       "stems_fr": {s: STEM_FR[s] for s in m["stems"]}, "runner": m["runner"],
                       "ready": ready, "why": why, "real": r, "measures": m["measures"],
                       "note": m.get("note", ""), "download": m.get("download"), "speed": m["speed"],
                       "license": m["license"], "default": mid == DEFAULT_MODEL})
    recommended = next((mid for mid in RECOMMENDED if real[mid]["ready"]), DEFAULT_MODEL)
    return {
        "engine": mode(),
        "ready": any(x["ready"] for x in models),
        "switch": "\"music_stems\": true dans showrunner.local.json, puis tools/portail.sh restart",
        "job": {"kind": "music.stems", "lane": "cpu" if fake else "audio",
                "submit": "POST /api/music/stems/separate (ou POST /api/jobs {kind: \"music.stems\", params})",
                "params": {"src": "id d'un son de la bibliothèque (alias : item)",
                           "model": f"id d'un modèle (défaut : {DEFAULT_MODEL})",
                           "stems": "sous-liste des pistes du modèle (défaut : toutes)"},
                "dry_run": "POST /api/music/stems/plan : le graphe ou la commande, jugés à vide"},
        "default": DEFAULT_MODEL, "recommended": recommended,
        "stems": STEM_FR,
        "models": models,
        "output": {"format": "flac", "bits": 24, "channels": 2, "sample_rate": "celle de la source",
                   "samples": "exactement ceux de la source (params.samples)", "parents": "[src]",
                   "folder": "Musique"},
        "machines": _ready_cache.get("comfy") or [],
        "portal_host": socket.gethostname(),
        "sources": [ZFT, MVSEP, ASEP_SCORES],
    }


def api_options(req):
    return options(req)


def _plan(p: dict) -> dict:
    m = MODELS[p["model"]]
    plan: dict = {"params": p, "runner": m["runner"]}
    if m["runner"] in ("asep", "chain"):
        mf = m.get("asep_model") or MODELS["bs_roformer_viperx"]["asep_model"]
        plan["command"] = asep_command(Path("<mix.wav>"), mf, Path("<travail>"))
    if m["runner"] in ("comfy", "chain"):
        name = m.get("comfy_model") or MODELS["htdemucs_ft"]["comfy_model"]
        dstems = [s for s in p["stems"] if s in DEMUCS_OUTS and s != "vocals"] if m["runner"] == "chain" else p["stems"]
        checks = {}
        g = build_demucs_graph("<mélange>", ON_DISK + " " + name, dstems or ["drums"])
        for ep in [e for e in config.get("lanes", {}).get("audio", []) if e != "local"]:
            mach = jobs.machine_of(ep)
            if not jobs.endpoint_alive(ep)[0]:
                checks[mach] = ["ComfyUI ne répond pas"]
                continue
            c = Comfy(ep, timeout=20)
            try:
                g = build_demucs_graph("<mélange>", pick_on_disk(demucs_options(c), name), dstems or ["drums"])
                checks[mach] = check_graph(g, fetch_info(c, [n["class_type"] for n in g.values()]))
            except (ValueError, ComfyError, KeyError, IndexError) as e:
                checks[mach] = [str(e)[:300]]
        plan.update(graph=g, checks=checks)
    plan["ready"] = readiness(0)[p["model"]]
    return plan


def api_plan(req):
    try:
        p = stems_params(req.json())
    except (ValueError, TypeError) as e:
        raise HttpError(400, str(e)) from e
    return _plan(p)


def submit(p: dict, tool: str = "music") -> dict:
    """Met en file une séparation déjà jugée (stems_params) ; partagé par ODIO
    et par l'app Musique (server/tools/chanson.py, `tool` = « chanson »)."""
    it = library.get(p["src"])
    pin = None
    if mode() == "reel" and MODELS[p["model"]]["runner"] in ("asep", "chain"):
        pin = _local_audio_endpoint()      # le sous-processus et Demucs sur la même machine
    return jobs.submit("music.stems", p, title=f"Séparer · {it.get('title') or it['id']}"[:90], tool=tool, pin=pin)


def api_separate(req):
    try:
        p = stems_params(req.json())
    except (ValueError, TypeError) as e:
        raise HttpError(400, str(e)) from e
    return jobs.public(submit(p))


# ── les deux moteurs ────────────────────────────────────────
def _store(ctx, it: dict, p: dict, raw: dict[str, Path], sr: int, n: int, engine: str, secs: float,
           pre: dict | None = None) -> dict:
    out = {}
    m = MODELS[p["model"]]
    essai = engine == "factice"
    for k, stem in enumerate(p["stems"]):
        ctx.check()
        ctx.progress(0.9 + 0.1 * k / len(p["stems"]), f"cale {STEM_FR[stem]}")
        dest = conform(raw[stem], ctx.workdir / f"{stem}.flac", sr, n, (pre or {}).get(stem, ""))
        got = ctx.add(dest, kind="audio",
                      title=f"{it.get('title') or it['id']} · {STEM_FR[stem]}" + (" (essai)" if essai else ""),
                      prompt=it.get("prompt", ""), parents=[it["id"]],
                      params={"stem": stem, "src": it["id"], "model": p["model"], "engine": engine,
                              "sample_rate": sr, "samples": n, "render_seconds": secs,
                              **({"filter": TEST_FILTERS[stem]} if essai else {})},
                      origin={"model": "factice" if essai else p["model"]},
                      tags=["musique", "essai" if essai else "piste séparée"], folder="Musique")
        out[stem] = got["id"]
    label = "filtres, moteur factice" if essai else m["label"]
    return {"note": f"{len(out)} pistes en {secs:g} s ({label})", "stems": out, "render_seconds": secs,
            "sample_rate": sr, "samples": n}


def run_test(ctx):
    p = stems_params(ctx.params)
    it = library.get(p["src"])
    ctx.progress(0.05, "décode la source")
    mix, sr, n = decode_source(it, ctx.workdir)
    t0 = time.time()
    raw = {s: mix for s in p["stems"]}
    return _store(ctx, it, p, raw, sr, n, "factice", round(time.time() - t0, 1),
                  pre={s: TEST_FILTERS[s] for s in p["stems"]})


def run_real(ctx):
    p = stems_params(ctx.params)
    it = library.get(p["src"])
    m = MODELS[p["model"]]
    ctx.progress(0.02, "décode la source")
    mix, sr, n = decode_source(it, ctx.workdir)
    t0 = time.time()
    if m["runner"] == "comfy":
        if not ctx.comfy:
            raise RuntimeError("ce travail n'a pas d'instance ComfyUI")
        raw = demucs_comfy(ctx, mix, m["comfy_model"], p["stems"])
    elif m["runner"] == "asep":
        raw = asep_run(ctx, mix, m["asep_model"], p["stems"])
    else:
        first = asep_run(ctx, mix, MODELS["bs_roformer_viperx"]["asep_model"], ["vocals", "instrumental"])
        raw = {"vocals": first["vocals"]} if "vocals" in p["stems"] else {}
        rest = [s for s in p["stems"] if s != "vocals"]
        if rest:
            if not ctx.comfy:
                raise RuntimeError("ce travail n'a pas d'instance ComfyUI")
            inst = conform(first["instrumental"], ctx.workdir / "instrumental.wav", sr, n)
            raw.update(demucs_comfy(ctx, inst, MODELS["htdemucs_ft"]["comfy_model"], rest))
    return _store(ctx, it, p, raw, sr, n, m["runner"], round(time.time() - t0, 1))


def register(app) -> None:
    # « music.stems » était déclaré par music.py : ce module est chargé après
    # lui (ordre alphabétique) et le remplace, en gardant son paramètre « item »
    if mode() == "reel":
        jobs.register("music.stems", run_real, lane="audio", title="Séparer un son", cost="gpu")
    else:
        jobs.register("music.stems", run_test, lane="cpu", title="Séparer un son (essai)", cost="cpu")
    app.route("GET", "/api/music/stems/options", api_options)
    app.route("POST", "/api/music/stems/plan", api_plan)
    app.route("POST", "/api/music/stems/separate", api_separate)


# ── le contrôle sans GPU (tools/check.py) ───────────────────
FAKE_INFO = {
    "LoadAudio": {"input": {"required": {"audio": ["COMBO", {"options": [], "audio_upload": True}]}}, "output": ["AUDIO"]},
    "AudioSeparateDemucs": {"input": {"required": {
        "input_sound": ["AUDIO"], "model": [[ON_DISK + " Hybrid Transformer fine-tuned", "⬇️  Hybrid Transformer 6 sources"]],
        "shifts": ["INT", {"min": 0, "max": 16}], "overlap": ["FLOAT", {"min": 0.0, "max": 0.99}],
        "custom_segment": ["BOOLEAN", {}], "segment": ["INT", {"min": 10, "max": 120}],
        "target_device": [["cpu", "cuda", "cuda:0"]]}},
        "output": ["AUDIO"] * 6},
    "SaveAudioAdvanced": {"input": {"required": {
        "audio": ["AUDIO", {}], "filename_prefix": ["STRING", {}],
        "format": ["COMFY_DYNAMICCOMBO_V3", {"options": [{"key": "flac"}, {"key": "mp3"}, {"key": "opus"}]}]}},
        "output": []},
}


def _tiny_wav(path: Path, sr: int = 44100, secs: float = 1.5) -> int:
    import math
    from array import array
    n = int(sr * secs)
    pcm = array("h", (int(8000 * math.sin(2 * math.pi * (110 + 330 * (i % 3)) * i / sr)) for i in range(n) for _ in (0, 1)))
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())
    return n


def selftest(call, ok) -> None:
    import tempfile
    st, o = call("GET", "/api/music/stems/options")
    ids = [m["id"] for m in o.get("models", [])] if st == 200 else []
    ok(st == 200 and o.get("engine") == "factice" and o.get("default") == "htdemucs_ft"
       and set(ids) == set(MODELS), f"options des stems ({st} {ids})")
    sw = next((m for m in o.get("models", []) if m["id"] == "bs_roformer_sw"), {})
    ok(sw.get("download", {}).get("files", [{}])[0].get("bytes") == 699412152 and sw["measures"][0]["sdr"]["drums"] == 14.11,
       "BS-RoFormer SW : téléchargement proposé et mesure MVSep")
    ok(all(m["measures"] or m["runner"] == "chain" for m in o.get("models", [])), "chaque modèle porte ses mesures publiées")

    g = build_demucs_graph("mix.wav", ON_DISK + " Hybrid Transformer fine-tuned", ["vocals", "drums", "bass", "other"])
    outs = {v["_meta"]["title"]: v["inputs"]["audio"][1] for v in g.values() if v["_meta"]["title"].startswith("OUT")}
    ok(outs == {"OUT vocals": 0, "OUT drums": 1, "OUT bass": 2, "OUT other": 3}, "quatre sorties Demucs dans l'ordre du nœud")
    ok(check_graph(g, FAKE_INFO) == [], f"graphe Demucs jugé bon ({check_graph(g, FAKE_INFO)})")
    g6 = build_demucs_graph("mix.wav", ON_DISK + " Hybrid Transformer 6 sources", ["guitar", "piano"])
    ok(any("n'est pas sur cette machine" in x for x in check_graph(g6, FAKE_INFO)), "un modèle absent du disque est refusé à vide")
    ok(pick_on_disk(["⬇️  Hybrid Transformer fine-tuned", ON_DISK + " Hybrid Transformer fine-tuned"],
                    "Hybrid Transformer fine-tuned").startswith(ON_DISK), "le modèle sur disque est choisi")
    try:
        pick_on_disk(["⬇️  Hybrid Transformer 6 sources"], "Hybrid Transformer 6 sources")
        ok(False, "un modèle absent est refusé")
    except ValueError:
        ok(True, "un modèle absent est refusé")
    cmd = asep_command(Path("/t/mix.wav"), "model_bs_roformer_ep_317_sdr_12.9755.ckpt", Path("/t/o"))
    ok(cmd[cmd.index("--normalization") + 1] == "1.0" and cmd[cmd.index("--model_file_dir") + 1] == str(model_dir()),
       "audio-separator : niveau gardé, modèles du portail")
    got = asep_outputs([Path("mix_(Vocals)_model_bs_roformer_ep_317_sdr_12.flac"),
                        Path("mix_(Instrumental)_model_bs_roformer_ep_317_sdr_12.flac"), Path("autre.flac")])
    ok(set(got) == {"vocals", "instrumental"}, "les fichiers d'audio-separator reconnus")

    st, r = call("POST", "/api/music/stems/separate", {"src": "aud-nexiste-pas"})
    ok(st == 400, "séparer un son absent est refusé")
    if not (shutil.which("ffmpeg") and shutil.which("ffprobe")):
        ok(True, "ffmpeg absent : essais de calage sautés")
        return
    tmp = Path(tempfile.mkdtemp(prefix="sr_stems_"))
    n = _tiny_wav(tmp / "src.wav")
    st, src = call("PUT", "/api/library/upload?name=source.wav&title=Source", raw=(tmp / "src.wav").read_bytes())
    ok(st == 200 and src.get("kind") == "audio", f"une source déposée ({st})")
    sid = src.get("id", "")
    for bad, why in (({"src": sid, "model": "spleeter"}, "modèle inconnu"),
                     ({"src": sid, "model": "bs_roformer_viperx", "stems": ["drums"]}, "piste que le modèle ne sort pas"),
                     ({"src": sid, "stems": ["bass", "bass"]}, "piste en double")):
        st, r = call("POST", "/api/music/stems/separate", bad)
        ok(st == 400 and r.get("error"), f"refusé : {why}")
    st, pl = call("POST", "/api/music/stems/plan", {"src": sid, "model": "roformer_htdemucs_ft"})
    ok(st == 200 and pl.get("runner") == "chain" and "--normalization" in pl.get("command", []), f"le plan à vide ({st})")

    def wait(jid):
        jj = {}
        for _ in range(300):
            _, jj = call("GET", f"/api/jobs/{jid}")
            if jj.get("state") in ("done", "error", "cancelled"):
                return jj
            time.sleep(0.2)
        return jj

    st, j = call("POST", "/api/music/stems/separate", {"src": sid, "model": "htdemucs_ft"})
    j = wait(j["id"]) if st == 200 else {}
    items = j.get("items") or []
    ok(j.get("state") == "done" and [i["params"]["stem"] for i in items] == ["vocals", "drums", "bass", "other"]
       and all(i["parents"] == [sid] and i["params"]["samples"] == n and i["params"]["sample_rate"] == 44100
               and abs((i.get("duration") or 0) - n / 44100) < 0.002 for i in items),
       f"quatre pistes d'essai calées sur la source ({j.get('state')} {j.get('message')})")
    st, j = call("POST", "/api/jobs", {"kind": "music.stems", "params": {"src": sid, "model": "bs_roformer_sw",
                                                                         "stems": ["piano", "guitar"]}})
    j = wait(j["id"]) if st == 200 else {}
    ok(j.get("state") == "done" and set((j.get("result") or {}).get("stems", {})) == {"guitar", "piano"},
       f"guitare et piano d'essai ({j.get('state')} {j.get('message')})")
    shutil.rmtree(tmp, ignore_errors=True)
