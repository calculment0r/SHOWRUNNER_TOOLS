"""Les entraîneurs de LoRA réels, branchés sur server/tools/lora.py.

L'étude : docs/etudes/lora_entrainement.md — ostris/ai-toolkit pour l'image et la vidéo (Krea 2,
Qwen-Image 2.1, Z-Image, MiniMax-H3), l'entraîneur officiel d'ACE-Step 1.5 pour le son.
L'installation se fait par une session du PC (docs/INSTALL_LORA.md), qui ESSAIE chaque modèle
puis écrit ce qui a marché dans le manifeste `~/trainers/sr_lora.json` de la machine du portail :

  { "v": 1, "aitk": "<dossier d'ai-toolkit>", "ace": "<dossier de l'entraîneur ACE-Step>",
    "models": { "<modèle>": { "ok": true, "trainer": "aitk" | "ace", "model": {…bloc model d'ai-toolkit…},
                              "network": {…}?, "train": {…}?, "resolution": [..]?, "s_per_step": 5.3?,
                              "preprocess": [argv]?, "cmd": [argv]? (ACE : les commandes qui ont marché) } } }

Juste par construction : un modèle n'est proposé (lora.model_state → ready) que s'il est marqué
`ok` dans ce manifeste, après un essai réel ; le portail n'invente pas les réglages, il reprend le
bloc `model` qui a marché. Le travail tourne sur la machine du portail (DGX2), épinglé à sa
ComfyUI locale : la file n'y met rien d'autre de GPU pendant ce temps (gpu_jobs_per_machine = 1),
et la ComfyUI y est vidée (/free) si sa file est vide.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import signal
import subprocess
import threading
import time
from pathlib import Path

from core import config
from core.comfy import Comfy

_cache: dict = {"t": 0.0, "mtime": None, "v": None}


def manifest_path() -> Path:
    return Path(config.get("lora_manifest") or (Path.home() / "trainers" / "sr_lora.json")).expanduser()


def manifest() -> dict | None:
    p = manifest_path()
    try:
        mt = p.stat().st_mtime
    except OSError:
        return None
    if _cache["mtime"] != mt:
        try:
            _cache.update(mtime=mt, v=json.loads(p.read_text(encoding="utf-8")))
        except (OSError, ValueError):
            _cache.update(mtime=mt, v=None)
    return _cache["v"]


def entry(mid: str) -> tuple[dict | None, str]:
    m = manifest()
    if not m:
        return None, ("l'entraînement n'est pas encore installé sur la machine du portail "
                      "(docs/INSTALL_LORA.md : une session du PC l'installe et l'essaie)")
    e = (m.get("models") or {}).get(mid)
    if not isinstance(e, dict):
        return None, "ce modèle n'a pas encore été essayé à l'installation (~/trainers/sr_lora.json)"
    if not e.get("ok"):
        return None, e.get("note") or "marqué « pas prêt » à l'installation (~/trainers/sr_lora.json)"
    tool = e.get("trainer")
    root = m.get(tool) if tool in ("aitk", "ace") else None
    if not root or not Path(root).expanduser().is_dir():
        return None, f"l'entraîneur « {tool} » est introuvable sur cette machine ({root})"
    return {**e, "_root": str(Path(root).expanduser())}, ""


def _ready(mid: str):
    def f():
        e, why = entry(mid)
        return (e is not None), why
    return f


# ── lancer un entraîneur et suivre ses pas ──────────────────
_STEP = re.compile(r"(\d+)\s*/\s*(\d+)\s*\[")


def _run(ctx, argv: list, cwd: str, env: dict, total_hint: int | None, label: str) -> list[str]:
    """Lance `argv`, suit ses pas (les barres de tqdm : « 900/2000 [ »), l'arrête si on annule.
    Rend les dernières lignes (le message d'une erreur)."""
    tail: list[str] = []
    p = subprocess.Popen(argv, cwd=cwd, env={**os.environ, **env}, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                         start_new_session=True)
    stop = threading.Event()

    def watch():
        while not stop.wait(2):
            if ctx.cancelled():
                try:
                    os.killpg(p.pid, signal.SIGTERM)
                    time.sleep(10)
                    if p.poll() is None:
                        os.killpg(p.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                return
    threading.Thread(target=watch, daemon=True).start()
    buf = b""
    last = 0.0
    try:
        while True:
            chunk = p.stdout.read1(4096) if hasattr(p.stdout, "read1") else p.stdout.read(4096)
            if not chunk:
                break
            buf += chunk
            parts = re.split(rb"[\r\n]", buf)
            buf = parts.pop()
            for raw in parts:
                line = raw.decode("utf-8", "replace").strip()
                if not line:
                    continue
                tail.append(line)
                del tail[:-60]
                m = _STEP.search(line)
                if m and time.time() - last > 3:
                    k, n = int(m.group(1)), int(m.group(2))
                    if total_hint is None or n == total_hint:
                        ctx.progress(0.05 + 0.9 * k / max(1, n), f"{label} · pas {k}/{n}")
                        last = time.time()
        p.wait()
    finally:
        stop.set()
    ctx.check()   # annulé : « arrêté », pas une erreur de l'entraîneur
    if p.returncode != 0:
        raise RuntimeError(f"{label} : l'entraîneur s'est arrêté (code {p.returncode}) — " + " | ".join(tail[-6:])[-900:])
    return tail


def _free_comfy(ctx) -> None:
    """Vider la ComfyUI de la machine, si sa file est vide (règle de Cal : /free seulement alors)."""
    ep = getattr(ctx, "endpoint", "") or ""
    if not ep.startswith("http"):
        return
    try:
        c = Comfy(ep, timeout=10)
        q = c.queue_state()
        if not q.get("queue_running") and not q.get("queue_pending"):
            c.free()
    except Exception:   # la ComfyUI ne répond pas : l'entraînement n'en a pas besoin
        pass


def _slug(s: str) -> str:
    import unicodedata
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode()   # « Années » → « Annees »
    s = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
    return s[:40] or "moodboard"


def comfy_name(mid: str, name: str, v: int) -> str:
    """Le nom du LoRA dans ~/ComfyUI/models/loras/showrunner/. H3 : la page Vidéo ne liste qu'un nom
    contenant « h3 » et en déduit le mode par « fl2v » (server/tools/movie.py, _lora_names)."""
    if mid == "h3":
        return f"h3-{_slug(name)}-v{v:03d}-fl2v.safetensors"
    return f"{mid}-{_slug(name)}-v{v:03d}.safetensors"


def publish(src: Path, fname: str) -> str:
    """Copie le LoRA dans les LoRA de ComfyUI (ici), puis vers l'autre DGX par le câble (rsync,
    best effort) ; rend une note."""
    loras = Path(config.get("comfy_loras") or (Path.home() / "ComfyUI" / "models" / "loras")).expanduser() / "showrunner"
    loras.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(src, loras / fname)
    peer = config.get("lora_peer") or "169.254.110.6"
    try:
        r = subprocess.run(["rsync", "-a", "--mkpath", "-e", "ssh -o BatchMode=yes -o ConnectTimeout=10", str(loras / fname),
                            f"{peer}:ComfyUI/models/loras/showrunner/{fname}"], capture_output=True, text=True, timeout=600)
        return "copié sur les deux DGX" if r.returncode == 0 else f"copié ici ; l'autre DGX : {r.stderr.strip()[:200]}"
    except (OSError, subprocess.SubprocessError) as e:
        return f"copié ici ; l'autre DGX : {e}"


# ── ai-toolkit : image et vidéo ──────────────────────────────
def run_aitk(ctx, data: Path, out: Path, p: dict, e: dict, v: int) -> dict:
    mid = p["model"]
    trigger = "mb" + re.sub(r"[^a-z0-9]", "", (p.get("node") or "").lower())[-6:]
    steps = int((e.get("train") or {}).get("steps") or e.get("steps") or 2000)
    name = f"sr_{mid}_{_slug(p.get('name'))}_v{v:03d}"
    runs = ctx.workdir / "runs"
    cfg = {"job": "extension", "config": {"name": name, "process": [{
        "type": "sd_trainer", "training_folder": str(runs), "device": "cuda:0", "trigger_word": trigger,
        "network": {"type": "lora", "linear": 32, "linear_alpha": 32, **(e.get("network") or {})},
        "save": {"dtype": "bf16", "save_every": 250, "max_step_saves_to_keep": 4},
        "datasets": [{"folder_path": str(data), "caption_ext": "txt", "caption_dropout_rate": 0.05,
                      "cache_latents_to_disk": True, "resolution": e.get("resolution") or [768, 1024]}],
        "train": {"batch_size": 1, "steps": steps, "gradient_checkpointing": True, "noise_scheduler": "flowmatch",
                  "timestep_type": "linear", "optimizer": "adamw8bit", "lr": 1e-4, "dtype": "bf16",
                  "cache_text_embeddings": True, **(e.get("train") or {}), "steps": steps},
        "model": dict(e["model"]),
        # pas d'échantillons pendant la nuit : le LoRA s'essaie ensuite dans une carte Générer
        "sample": {"sampler": "flowmatch", "sample_every": steps * 10, "width": 1024, "height": 1024, "sample_steps": 8,
                   "prompts": [trigger]},
    }]}}
    job = ctx.workdir / "job.yaml"
    job.write_text(json.dumps(cfg, ensure_ascii=False, indent=1), encoding="utf-8")   # du JSON : un YAML valide
    root = e["_root"]
    py = str(Path(root) / "venv" / "bin" / "python")
    _free_comfy(ctx)
    ctx.progress(0.03, f"ai-toolkit · {steps} pas")
    _run(ctx, [py, "run.py", str(job)], root,
         {"MODELS_PATH": str(Path.home() / "ComfyUI" / "models"), "HF_HUB_OFFLINE": "1", "PYTHONUNBUFFERED": "1"}, steps, "ai-toolkit")
    found = sorted((runs / name).glob("*.safetensors"), key=lambda f: f.stat().st_mtime)
    final = [f for f in found if f.name == f"{name}.safetensors"] or found
    if not final:
        raise RuntimeError(f"ai-toolkit n'a pas laissé de LoRA dans {runs / name}")
    shutil.copyfile(final[-1], out)
    return {"trigger": trigger, "steps": steps}


# ── ACE-Step 1.5 (l'entraîneur officiel) : son ───────────────
def run_ace(ctx, data: Path, out: Path, p: dict, e: dict, v: int) -> dict:
    """Les commandes sont celles qui ont marché à l'installation (`preprocess`, `cmd` du manifeste),
    avec {audio}, {tensors}, {out} remplacés : le portail ne devine pas l'interface de l'entraîneur."""
    if not isinstance(e.get("preprocess"), list) or not isinstance(e.get("cmd"), list):
        raise RuntimeError("le manifeste ne donne pas les commandes d'ACE-Step (preprocess, cmd) : docs/INSTALL_LORA.md § 5")
    tens, outd = ctx.workdir / "tensors", ctx.workdir / "ace_out"
    sub = lambda argv: [str(a).replace("{audio}", str(data)).replace("{tensors}", str(tens)).replace("{out}", str(outd)) for a in argv]
    root = e["_root"]
    _free_comfy(ctx)
    ctx.progress(0.03, "ACE-Step · prépare les sons")
    _run(ctx, sub(e["preprocess"]), root, {"PYTHONUNBUFFERED": "1"}, None, "ACE-Step · préparation")
    _run(ctx, sub(e["cmd"]), root, {"PYTHONUNBUFFERED": "1"}, None, "ACE-Step")
    found = sorted(outd.rglob("adapter_model.safetensors"), key=lambda f: f.stat().st_mtime) or sorted(outd.rglob("*.safetensors"), key=lambda f: f.stat().st_mtime)
    if not found:
        raise RuntimeError(f"ACE-Step n'a pas laissé de LoRA dans {outd}")
    shutil.copyfile(found[-1], out)
    return {}


def run(ctx, data: Path, out: Path, p: dict) -> dict:
    from tools import lora
    e, why = entry(p["model"])
    if e is None:
        raise RuntimeError(why)
    v = 1 + max([x["v"] for x in lora.load(p["board"], p["node"]).get("versions") or []] or [0])
    t0 = time.time()
    extra = (run_aitk if e.get("trainer") == "aitk" else run_ace)(ctx, data, out, p, e, v)
    fname = comfy_name(p["model"], p.get("name") or "", v)
    note = publish(out, fname)
    return {**extra, "comfy": f"showrunner/{fname}", "note": note, "minutes": round((time.time() - t0) / 60)}


def install() -> None:
    from tools import lora
    for mid in lora.MODELS:
        if mid != "factice":
            lora.TRAINERS[mid] = {"ready": _ready(mid), "run": run}


def register(app) -> None:
    install()


def selftest(call, ok) -> None:
    from tools import lora
    old = config.CFG.get("lora_manifest")
    tmp = config.data_dir() / "sr_lora_essai.json"
    try:
        config.CFG["lora_manifest"] = str(tmp)
        tmp.unlink(missing_ok=True)
        ok(not lora.model_state("zimage")["ready"] and "INSTALL_LORA" in lora.model_state("zimage")["why"],
           "lora : sans manifeste, un modèle dit d'où vient l'installation")
        root = config.data_dir() / "aitk_essai"
        root.mkdir(exist_ok=True)
        tmp.write_text(json.dumps({"v": 1, "aitk": str(root), "models": {
            "zimage": {"ok": True, "trainer": "aitk", "model": {"arch": "zimage:turbo"}},
            "krea2": {"ok": False, "note": "le DiT ne se relit pas"}}}), encoding="utf-8")
        ok(lora.model_state("zimage")["ready"], "lora : un modèle essayé et marqué ok est prêt")
        ok(not lora.model_state("krea2")["ready"] and lora.model_state("krea2")["why"] == "le DiT ne se relit pas",
           "lora : un modèle marqué non prêt dit pourquoi")
        ok(not lora.model_state("h3")["ready"], "lora : un modèle absent du manifeste n'est pas prêt")
        ok(comfy_name("h3", "Années folles", 2) == "h3-annees-folles-v002-fl2v.safetensors" and comfy_name("zimage", "", 1) == "zimage-moodboard-v001.safetensors",
           f"lora : les noms dans ComfyUI ({comfy_name('h3', 'Années folles', 2)})")
    finally:
        config.CFG["lora_manifest"] = old
        tmp.unlink(missing_ok=True)
