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

from core import config, library
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


def trigger_of(p: dict) -> str:
    """Le mot déclencheur d'un moodboard : « mb » et la fin de l'id de son objet (un mot qui n'existe pas,
    stable d'une version à l'autre). ai-toolkit le met en tête de chaque légende (toolkit/prompt_utils.py,
    inject_trigger_into_prompt : « trigger + ' ' + légende ») ; ACE-Step, en `custom_tag` (prepend)."""
    return "mb" + re.sub(r"[^a-z0-9]", "", (p.get("node") or "").lower())[-6:]


# ── ai-toolkit : image et vidéo ──────────────────────────────
def run_aitk(ctx, data: Path, out: Path, p: dict, e: dict, v: int) -> dict:
    mid = p["model"]
    trigger = trigger_of(p)
    steps = int((e.get("train") or {}).get("steps") or e.get("steps") or 2000)
    name = f"sr_{mid}_{_slug(p.get('name'))}_v{v:03d}"
    runs = ctx.workdir / "runs"
    cfg = {"job": "extension", "config": {"name": name, "process": [{
        "type": "sd_trainer", "training_folder": str(runs), "device": "cuda:0", "trigger_word": trigger,
        "network": {"type": "lora", "linear": 32, "linear_alpha": 32, **(e.get("network") or {})},
        "save": {"dtype": "bf16", "save_every": 250, "max_step_saves_to_keep": 4},
        "datasets": [{"folder_path": str(data), "caption_ext": "txt", "caption_dropout_rate": 0.05,
                      "cache_latents_to_disk": True, "resolution": e.get("resolution") or [768, 1024]}],
        # disable_sampling : ni l'image d'échantillon du début ni celle de la fin (20 à 50 s chacune, que
        # sample_every n'empêche pas — compte rendu de l'installation du 05/10) ; le LoRA s'essaie
        # ensuite dans une carte Générer. Le manifeste peut le rallumer (`train`).
        "train": {"batch_size": 1, "steps": steps, "gradient_checkpointing": True, "noise_scheduler": "flowmatch",
                  "timestep_type": "linear", "optimizer": "adamw8bit", "lr": 1e-4, "dtype": "bf16",
                  "cache_text_embeddings": True, "disable_sampling": True, **(e.get("train") or {}), "steps": steps},
        "model": dict(e["model"]),
        # neg "" : le défaut d'ai-toolkit (False) fait planter Krea 2 avec cache_text_embeddings avant le
        # premier pas (« can only concatenate str (not "bool") to str », krea2/src/text_encoder.py, 05/10)
        "sample": {"sampler": "flowmatch", "sample_every": steps * 10, "width": 1024, "height": 1024, "sample_steps": 8,
                   "neg": "", "prompts": [trigger]},
    }]}}
    job = ctx.workdir / "job.yaml"
    job.write_text(json.dumps(cfg, ensure_ascii=False, indent=1), encoding="utf-8")   # du JSON : un YAML valide
    root = e["_root"]
    py = str(Path(root) / "venv" / "bin" / "python")
    _free_comfy(ctx)
    ctx.progress(0.03, f"ai-toolkit · {steps} pas")
    # MODELS_PATH : ai-toolkit relit nos fichiers ComfyUI. SANS HF_HUB_OFFLINE : hors ligne, transformers 5.5.3
    # (épinglé par ai-toolkit) réclame <dépôt>/<sous-dossier tokenizer>/config.json, absent du Hub — Z-Image,
    # Qwen-Image 2.1 et H3 échouent ainsi (essai du 05/10 sur DGX2) ; ai-toolkit lit déjà le cache d'abord
    # (local_files_only, puis en ligne seulement s'il manque quelque chose)
    _run(ctx, [py, "run.py", str(job)], root,
         {"MODELS_PATH": str(Path.home() / "ComfyUI" / "models"), "PYTHONUNBUFFERED": "1"}, steps, "ai-toolkit")
    found = sorted((runs / name).glob("*.safetensors"), key=lambda f: f.stat().st_mtime)
    final = [f for f in found if f.name == f"{name}.safetensors"] or found
    if not final:
        raise RuntimeError(f"ai-toolkit n'a pas laissé de LoRA dans {runs / name}")
    shutil.copyfile(final[-1], out)
    return {"trigger": trigger, "steps": steps}


# ── ACE-Step 1.5 (l'entraîneur officiel) : son ───────────────
def ace_dataset(data: Path, items: list, trigger: str) -> Path:
    """`{audio}/ds.json`, au format que lit le prétraitement en ligne de commande
    (acestep/training_v2/preprocess_discovery.py, `ca1e85f`) : il IGNORE `000.caption.txt` et
    `000.lyrics.txt` — sans ce fichier, il scanne le dossier et prend la légende « 000 », les
    paroles « [Instrumental] » (compte rendu de l'installation, 05/10). Le mot déclencheur en
    `custom_tag`, mis en tête de chaque légende (`tag_position: prepend`)."""
    from tools import lora
    samples = []
    for k, iid in enumerate(items):
        it = library.get(iid)
        if not it or it["kind"] != "audio":
            continue
        f = data / lora.sample_name(k, it)
        if f.is_file():
            samples.append({"filename": f.name, "audio_path": str(f.resolve()), **lora.audio_meta(it)})
    doc = {"metadata": {"custom_tag": trigger, "tag_position": "prepend", "genre_ratio": 0}, "samples": samples}
    out = data / "ds.json"
    out.write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")
    return out


def safe_root(argv: list, cwd: str) -> Path:
    """La racine « sûre » d'ACE-Step : il refuse des tenseurs ou une sortie hors du répertoire courant
    (« Path escapes safe root ») ; `uv run --directory D` fait de D ce répertoire, sinon c'est `cwd`."""
    for k, a in enumerate(argv):
        a = str(a)
        if a == "--directory" and k + 1 < len(argv):
            return Path(str(argv[k + 1])).expanduser()
        if a.startswith("--directory="):
            return Path(a.split("=", 1)[1]).expanduser()
    return Path(cwd)


def _useful(tail: list[str], n: int = 6) -> str:
    """Les dernières lignes utiles d'un journal : sans les barres de progression ni les doublons."""
    keep: list[str] = []
    for line in tail:
        if _STEP.search(line) or re.search(r"\d+%\|", line) or (keep and keep[-1] == line):
            continue
        keep.append(line)
    return " | ".join(keep[-n:])[-900:] or "(journal vide)"


def run_ace(ctx, data: Path, out: Path, p: dict, e: dict, v: int) -> dict:
    """Les commandes sont celles qui ont marché à l'installation (`preprocess`, `cmd` du manifeste),
    avec {audio}, {tensors}, {out} remplacés : le portail ne devine pas l'interface de l'entraîneur.
    ACE-Step rend 0 même en échec (prétraitement 0/3, modèle introuvable, chemin refusé, confirmation
    interrompue) : ce qu'il laisse fait foi — des tenseurs `.pt` après le prétraitement, puis
    `adapter_model.safetensors` ; sinon l'erreur cite la fin de son journal."""
    if not isinstance(e.get("preprocess"), list) or not isinstance(e.get("cmd"), list):
        raise RuntimeError("le manifeste ne donne pas les commandes d'ACE-Step (preprocess, cmd) : docs/INSTALL_LORA.md § 5")
    tens, outd = ctx.workdir / "tensors", ctx.workdir / "ace_out"
    root = e["_root"]
    for argv in (e["preprocess"], e["cmd"]):
        safe = safe_root(argv, root).resolve()
        for tok, d, what in (("{tensors}", tens, "les tenseurs"), ("{out}", outd, "la sortie")):
            if any(tok in str(a) for a in argv) and not d.resolve().is_relative_to(safe):
                raise RuntimeError(f"ACE-Step refuse {what} hors de sa racine sûre {safe} (« Path escapes safe root ») : "
                                   f"le travail écrit dans {d.parent} — dans le manifeste ({manifest_path()}), `--directory` "
                                   f"doit être un dossier qui contient les données du portail ({config.data_dir()})")
    sub = lambda argv: [str(a).replace("{audio}", str(data)).replace("{tensors}", str(tens)).replace("{out}", str(outd)) for a in argv]
    trigger = trigger_of(p)
    ds = ace_dataset(data, list(p.get("items") or []), trigger)
    n_audio = len(json.loads(ds.read_text(encoding="utf-8"))["samples"])
    _free_comfy(ctx)
    ctx.progress(0.03, "ACE-Step · prépare les sons")
    log = _run(ctx, sub(e["preprocess"]), root, {"PYTHONUNBUFFERED": "1"}, None, "ACE-Step · préparation")
    n_pt = len(list(tens.rglob("*.pt"))) if tens.is_dir() else 0
    if not n_pt:
        raise RuntimeError(f"ACE-Step : le prétraitement n'a produit aucun tenseur .pt (0 sur {n_audio} son{'s' if n_audio > 1 else ''}) — "
                           + _useful(log))
    log = _run(ctx, sub(e["cmd"]), root, {"PYTHONUNBUFFERED": "1"}, None, "ACE-Step")
    # sous {out} : checkpoints/epoch_…/ et final/ (05/10) ; final/ d'abord, sinon le plus récent
    final = outd / "final" / "adapter_model.safetensors"
    found = [final] if final.is_file() else sorted(outd.rglob("adapter_model.safetensors"), key=lambda f: f.stat().st_mtime) if outd.is_dir() else []
    if not found:
        raise RuntimeError(f"ACE-Step n'a pas laissé de LoRA (adapter_model.safetensors) dans {outd} ; le prétraitement avait "
                           f"produit {n_pt} tenseur{'s' if n_pt > 1 else ''} .pt sur {n_audio} son{'s' if n_audio > 1 else ''} — " + _useful(log))
    shutil.copyfile(found[-1], out)
    return {"trigger": trigger}


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


def _hours(mid: str):
    """La durée annoncée avant de lancer, tirée de la vitesse mesurée à l'installation (`s_per_step`) et
    du nombre de pas de run_aitk ; None sans mesure (l'ordre de grandeur de lora.MODELS reste)."""
    def f():
        e, _ = entry(mid)
        if not e or e.get("trainer") != "aitk" or not e.get("s_per_step"):
            return None
        steps = int((e.get("train") or {}).get("steps") or e.get("steps") or 2000)
        h = float(e["s_per_step"]) * steps / 3600
        return f"{h:.1f} h".replace(".", ",") + f" ({steps} pas à {e['s_per_step']:g} s, mesuré le {e.get('checked') or '?'})".replace(".", ",", 1)
    return f


def install() -> None:
    from tools import lora
    for mid in lora.MODELS:
        if mid != "factice":
            lora.TRAINERS[mid] = {"ready": _ready(mid), "run": run, "hours": _hours(mid)}


def register(app) -> None:
    install()


class _EssaiCtx:
    """Un travail d'essai pour les entraîneurs (sans file ni GPU)."""
    def __init__(self, workdir: Path, params: dict) -> None:
        self.workdir, self.params, self.endpoint = workdir, params, ""
        self.job = {"id": "essai-lora", "progress": 0.0}
        workdir.mkdir(parents=True, exist_ok=True)

    def progress(self, frac=None, message=None):
        pass

    def cancelled(self) -> bool:
        return False

    def check(self) -> None:
        pass


# un faux ai-toolkit : son « python » garde son environnement et le travail, et laisse un LoRA là où le vrai
_FAUX_AITK = """#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
here = Path(__file__).resolve().parents[2]
(here / "env.json").write_text(json.dumps(dict(os.environ)))
job = json.loads(Path(sys.argv[2]).read_text())
proc = job["config"]["process"][0]
d = Path(proc["training_folder"]) / job["config"]["name"]
d.mkdir(parents=True, exist_ok=True)
print("  5/%d [00:01<00:00]" % proc["train"]["steps"], flush=True)
(d / (job["config"]["name"] + ".safetensors")).write_bytes(b"lora")
"""
# un faux ACE-Step : il rend 0 même en échec, comme le vrai (compte rendu du 05/10)
_FAUX_ACE = """#!/usr/bin/env python3
import json, sys
from pathlib import Path
a = sys.argv[1:]
def arg(k):
    return a[a.index(k) + 1]
Path(arg("--marque")).write_text(" ".join(a))
mode = arg("--faux")
if "--preprocess" in a:
    ds = json.loads(Path(arg("--dataset-json")).read_text())
    t = Path(arg("--tensor-output")); t.mkdir(parents=True, exist_ok=True)
    print("[Side-Step] Resolved %d audio files from dataset JSON" % len(ds["samples"]))
    if mode == "0pt":
        print("Pass 1 FAIL 000.flac: TorchCodec is required for load_with_torchcodec")
    else:
        for s in ds["samples"]:
            (t / (s["filename"] + ".pt")).write_bytes(b"t")
else:
    if mode == "rien":
        print("  3/20 [00:01<00:02]")
        print("Model directory not found: checkpoints/xl_base")
    else:
        f = Path(arg("--output-dir")) / "final"; f.mkdir(parents=True, exist_ok=True)
        (f / "adapter_model.safetensors").write_bytes(b"ace")
"""


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

        # le manifeste final de l'installation du 05/10 (tools/lora_manifeste_0510.json, le § 5 du compte
        # rendu), tel quel — seuls les dossiers des deux entraîneurs pointent ici
        man = json.loads((config.REPO / "tools" / "lora_manifeste_0510.json").read_text(encoding="utf-8"))
        ace_root = config.data_dir() / "ace_essai"
        ace_root.mkdir(exist_ok=True)
        tmp.write_text(json.dumps({**man, "aitk": str(root), "ace": str(ace_root)}), encoding="utf-8")
        ready = [k for k in lora.MODELS if k != "factice" and lora.model_state(k)["ready"]]
        ok(ready == ["krea2", "qwen21", "zimage", "h3", "ace"] and "pas encore branché" in lora.model_state("yue2")["why"],
           f"lora : le manifeste du 05/10 propose Z-Image, Qwen 2.1, Krea 2, H3, ACE-Step, et pas YuE2 ({ready})")
        zh = lora.model_state("zimage")["hours"]
        ok(zh.startswith("3,6 h (2000 pas à 6,4 s") and lora.model_state("ace")["hours"] == lora.MODELS["ace"]["hours"],
           f"lora : la durée annoncée vient de la vitesse mesurée à l'installation ({zh})")

        # ai-toolkit (un faux) : sans HF_HUB_OFFLINE, ni échantillons ni neg booléen, le bloc du manifeste tel quel
        py = root / "venv" / "bin" / "python"
        py.parent.mkdir(parents=True, exist_ok=True)
        py.write_text(_FAUX_AITK, encoding="utf-8")
        py.chmod(0o755)
        for mid in ("zimage", "krea2", "h3"):
            e, _ = entry(mid)
            ctx = _EssaiCtx(config.data_dir() / "work" / f"essai-aitk-{mid}", {"model": mid, "node": "n_ab12cd", "name": "Paris 1900"})
            out = ctx.workdir / "lora.safetensors"
            extra = run_aitk(ctx, ctx.workdir / "dataset", out, ctx.params, e, 1)
            env = json.loads((root / "env.json").read_text())
            job = json.loads((ctx.workdir / "job.yaml").read_text())["config"]["process"][0]
            ok(out.read_bytes() == b"lora" and extra["trigger"] == "mbab12cd" and "HF_HUB_OFFLINE" not in env
               and env.get("MODELS_PATH", "").endswith("ComfyUI/models"),
               f"lora : ai-toolkit {mid} lancé sans HF_HUB_OFFLINE, avec MODELS_PATH ({env.get('HF_HUB_OFFLINE')})")
            ok(job["train"]["disable_sampling"] is True and job["sample"]["neg"] == "" and job["model"] == man["models"][mid]["model"],
               f"lora : ai-toolkit {mid} — disable_sampling, neg \"\", le bloc model du manifeste ({job['train'].get('disable_sampling')} {job['sample'].get('neg')!r})")
            if mid == "h3":
                ok(job["network"]["linear"] == 16 and job["network"]["network_kwargs"] == {"ignore_if_contains": ["adaln_proj"]}
                   and job["train"]["timestep_type"] == "shift", "lora : H3 — le réseau et le pas du manifeste")

        # ACE-Step (un faux) : ds.json, la racine sûre, et ce qu'il laisse fait foi
        import wave
        ids = []
        for k, (params, prompt) in enumerate(((({"tags": "synthwave", "bpm": 140, "keyscale": "A minor", "timesignature": "4",
                                                  "lyrics": "[Instrumental]", "instrumental": True}), "synthwave, basse analogique"),
                                               ({"chanson": {"prompt": "folk", "vocal": True, "lyrics": "[verse]\nla la", "bpm": 96,
                                                             "key": "D major"}}, "folk"))):
            w = config.data_dir() / f"essai_son{k}.wav"
            with wave.open(str(w), "wb") as f:
                f.setnchannels(1)
                f.setsampwidth(2)
                f.setframerate(8000)
                f.writeframes(b"\0\0" * 800)
            ids.append(library.add_file(w, kind="audio", title=f"son {k}", prompt=prompt, params=params,
                                        origin={"tool": "music"})["id"])
        fake = ace_root / "faux_ace.py"
        fake.write_text(_FAUX_ACE, encoding="utf-8")
        fake.chmod(0o755)
        e, _ = entry("ace")
        base = config.data_dir()

        def ace(mode, safe=str(base), label=""):
            ctx = _EssaiCtx(base / "work" / f"essai-ace-{label or mode}", {"model": "ace", "node": "n_zz99yy", "name": "Sons", "items": ids})
            mark = ctx.workdir / "marque.txt"
            argv = lambda extra: [str(fake), "--directory", safe, "--faux", mode, "--marque", str(mark)] + extra
            ee = {**e, "preprocess": argv(["--preprocess", "--audio-dir", "{audio}", "--dataset-json", "{audio}/ds.json",
                                           "--tensor-output", "{tensors}", "--dataset-dir", "{tensors}", "--output-dir", "{out}"]),
                  "cmd": argv(["--dataset-dir", "{tensors}", "--output-dir", "{out}"])}
            data = lora._dataset(ctx, ids, "audio")
            out = ctx.workdir / "lora.safetensors"
            try:
                return run_ace(ctx, data, out, ctx.params, ee, 1), out, data, mark, ""
            except RuntimeError as err:
                return None, out, data, mark, str(err)

        extra, out, data, mark, err = ace("ok")
        ds = json.loads((data / "ds.json").read_text(encoding="utf-8"))
        s0, s1 = ds["samples"]
        ok(not err and out.read_bytes() == b"ace" and extra == {"trigger": "mbzz99yy"}, f"lora : ACE-Step laisse final/adapter_model ({err})")
        ok(ds["metadata"] == {"custom_tag": "mbzz99yy", "tag_position": "prepend", "genre_ratio": 0}
           and s0["filename"] == "000.wav" and s0["audio_path"] == str((data / "000.wav").resolve())
           and s0["caption"] == "synthwave, basse analogique" and s0["is_instrumental"] is True and s0["lyrics"] == "[Instrumental]"
           and (s0["bpm"], s0["keyscale"], s0["timesignature"]) == (140, "A minor", "4"),
           f"lora : ds.json d'ACE-Step — le mot déclencheur en custom_tag, la recette d'une prise ({s0})")
        ok(s1["is_instrumental"] is False and s1["lyrics"] == "[verse]\nla la" and (s1["bpm"], s1["keyscale"]) == (96, "D major"),
           f"lora : ds.json — les paroles, le tempo et la tonalité d'une chanson ({s1})")
        _, _, _, _, err = ace("rien")
        ok("n'a pas laissé de LoRA" in err and "2 tenseurs .pt sur 2 sons" in err and "Model directory not found" in err
           and "3/20" not in err, f"lora : ACE-Step sans LoRA — la vraie cause et le nombre de tenseurs ({err[:200]})")
        _, _, _, _, err = ace("0pt")
        ok("aucun tenseur .pt (0 sur 2 sons)" in err and "TorchCodec" in err, f"lora : ACE-Step, prétraitement vide — arrêté avant d'entraîner ({err[:200]})")
        _, _, _, mark, err = ace("ok", safe="/var/empty/racine", label="hors-racine")
        ok("racine sûre" in err and "/var/empty/racine" in err and "--directory" in err and not mark.exists(),
           f"lora : ACE-Step, des données hors de la racine sûre — dit avant de lancer ({err[:200]})")
    finally:
        config.CFG["lora_manifest"] = old
        tmp.unlink(missing_ok=True)
