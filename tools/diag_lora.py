"""Admin → Diagnostics → « LoRA » : ce que le portail sait des entraîneurs de LoRA de cette
machine (docs/INSTALL_LORA.md, server/tools/lora_trainers.py). Lecture seule : rien ne
s'installe, rien ne se lance sur le GPU."""
import json
import shutil
import subprocess
from pathlib import Path

HOME = Path.home()
MAN = HOME / "trainers" / "sr_lora.json"


def run(argv, timeout=60):
    try:
        r = subprocess.run(argv, capture_output=True, text=True, timeout=timeout)
        return (r.stdout + r.stderr).strip()
    except (OSError, subprocess.SubprocessError) as e:
        return f"(impossible : {e})"


print(f"manifeste : {MAN}")
if not MAN.exists():
    print("  absent — l'entraînement n'est pas encore installé ici (docs/INSTALL_LORA.md)")
else:
    try:
        m = json.loads(MAN.read_text(encoding="utf-8"))
    except ValueError as e:
        print(f"  illisible : {e}")
        m = {}
    for tool in ("aitk", "ace"):
        root = m.get(tool)
        print(f"{tool} : {root or '—'}" + ("" if not root else ("  (présent)" if Path(root).expanduser().is_dir() else "  (INTROUVABLE)")))
    for mid, e in (m.get("models") or {}).items():
        state = "PRÊT" if e.get("ok") else "non"
        print(f"  {mid:8} {state:4} {e.get('trainer', ''):5} {e.get('checked', '')} {e.get('s_per_step') or ''} {e.get('note', '')}")
    py = Path(m.get("aitk") or "").expanduser() / "venv" / "bin" / "python"
    if py.exists():
        print("torch d'ai-toolkit :", run([str(py), "-c", "import torch;p=torch.cuda.get_device_properties(0);print(torch.__version__,p.major,p.minor,p.is_integrated)"], 120))
loras = HOME / "ComfyUI" / "models" / "loras" / "showrunner"
print(f"LoRA du portail dans ComfyUI : {loras}")
if loras.is_dir():
    for f in sorted(loras.glob("*.safetensors")):
        print(f"  {f.name}  {f.stat().st_size / 1e6:.1f} Mo")
else:
    print("  (aucun encore)")
print("mémoire :", run(["free", "-g"]).splitlines()[1] if shutil.which("free") else "—")
print("GPU :", run(["nvidia-smi", "--query-compute-apps=pid,process_name,used_memory", "--format=csv,noheader"]) or "aucun processus")
print("vers DGX1 (rsync des LoRA) :", run(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=5", "169.254.110.6", "true"]) or "ok")
