#!/usr/bin/env bash
# Installe le service de diarisation Nemotron sur un DGX — une fois, puis à chaque montée de NeMo.
#
#   bash ~/reelbench/skill/diarisation-installe.sh
#
# Ce qu'il fait, dans l'ordre, et il s'arrête au premier échec :
#   1. un environnement à part, ~/reelbench/nemo-env, raccordé par un .pth au torch CUDA de
#      ~/comfyui-env — on n'installe RIEN dans comfyui-env (HANDOFF §2) ;
#   2. NeMo depuis sa branche principale, épinglée : Nemotron 3 Diarization (encodeur
#      Transformer à RoPE, sorties à 10 ms) demande NeMo 3.1, pas encore sur PyPI ;
#      torch est tenu par une contrainte : pip échoue plutôt que d'installer un torch CPU ;
#   3. les vérifications : torch voit le GPU, NeMo importe le Sortformer, ffmpeg est là ;
#   4. le modèle, téléchargé une fois (jeton Hugging Face de ~/.cache/huggingface/token),
#      puis une passe sur quelques secondes de bruit, qui compile flex_attention ;
#   5. l'unité systemd, écrite pour cet utilisateur.
#
# Variables : NEMO_REF (commit ou branche de NeMo), MODELE (identifiant ou .nemo), BASE (l'env à torch CUDA).
set -euo pipefail

R="$HOME/reelbench"
ENV="$R/nemo-env"
BASE="${BASE:-$HOME/comfyui-env}"
NEMO_REF="${NEMO_REF:-cf724ac337d1ebc7d0dda1e23fb80916f52927a5}"
MODELE="${MODELE:-nvidia/Nemotron-3-Diarization}"
ok() { printf '✓ %s\n' "$*"; }
ko() { printf '✗ %s\n' "$*" >&2; exit 1; }

# ── 1. l'environnement ────────────────────────────────────────────────────────
[ -x "$BASE/bin/python" ] || ko "pas de $BASE/bin/python — BASE=<env qui a torch CUDA> bash $0"
"$BASE/bin/python" -c "import torch, sys; sys.exit(0 if torch.cuda.is_available() else 1)" \
  || ko "le torch de $BASE ne voit pas le GPU : à réparer avant tout (HANDOFF §5)"
PYV="$("$BASE/bin/python" -c 'import sys; print(f"{sys.version_info[0]}.{sys.version_info[1]}")')"
SITE="$("$BASE/bin/python" -c 'import site; print(site.getsitepackages()[0])')"
if [ ! -x "$ENV/bin/python" ]; then
  "$BASE/bin/python" -m venv "$ENV"
  ok "environnement créé : $ENV (Python $PYV)"
fi
# comfyui-env est lui-même un venv : --system-site-packages pointerait le Python système,
# qui n'a pas torch. Le raccord se fait par un .pth (REPRISE §2).
echo "$SITE" > "$ENV/lib/python$PYV/site-packages/comfyui-env.pth"
"$ENV/bin/python" -c "import torch; assert torch.cuda.is_available()" || ko "le raccord à $SITE ne donne pas le torch CUDA"
TORCH="$("$ENV/bin/python" -c 'import torch; print(torch.__version__)')"
ok "torch $TORCH (CUDA) vu depuis $ENV"

# ── 2. NeMo ───────────────────────────────────────────────────────────────────
CONTRAINTES="$(mktemp)"
trap 'rm -f "$CONTRAINTES"' EXIT
echo "torch==$TORCH" > "$CONTRAINTES"
for p in torchaudio torchvision; do
  v="$("$ENV/bin/python" -c "import importlib.metadata as m; print(m.version('$p'))" 2>/dev/null || true)"
  [ -n "$v" ] && echo "$p==$v" >> "$CONTRAINTES"
done
"$ENV/bin/python" -m pip install -q --upgrade pip
"$ENV/bin/python" -m pip install -c "$CONTRAINTES" \
  "nemo_toolkit[asr] @ git+https://github.com/NVIDIA-NeMo/NeMo.git@$NEMO_REF" aiohttp \
  || ko "pip a refusé — si c'est à cause de torch, NeMo en veut un autre que $TORCH : ne pas forcer, lire le message ; si c'est une compilation (Python.h, gcc) : sudo apt install -y build-essential python$PYV-dev, puis relancer ce script"
# Whisper sert à « transcrire ». Sur dgx2 il vient de comfyui-env ; sur dgx1, s'il n'est que dans
# ~/reelbench/env, nemo-env ne le voit pas : on le pose alors dans nemo-env, sous la même contrainte sur torch.
if ! "$ENV/bin/python" -c "import whisper" 2>/dev/null; then
  "$ENV/bin/python" -m pip install -q -c "$CONTRAINTES" openai-whisper \
    || echo "⚠ openai-whisper ne s'installe pas dans $ENV : la diarisation marchera, « transcrire » restera grisé"
fi

# ── 3. les vérifications ──────────────────────────────────────────────────────
# pip peut quand même avoir posé un torch dans nemo-env, qui masquerait celui du DGX (REPRISE §2).
if ! "$ENV/bin/python" -c "import torch, sys; sys.exit(0 if torch.cuda.is_available() else 1)"; then
  "$ENV/bin/python" -m pip uninstall -y torch torchaudio torchvision || true
  "$ENV/bin/python" -c "import torch; assert torch.cuda.is_available()" || ko "torch ne voit plus le GPU depuis $ENV"
  ok "un torch CPU s'était glissé dans $ENV : retiré"
fi
"$ENV/bin/python" - <<'PY' || ko "NeMo n'importe pas le Sortformer"
import nemo
from nemo.collections.asr.models import SortformerEncLabelModel
from nemo.collections.asr.modules.transformer_encoder import TransformerEncoder
print(f"✓ NeMo {nemo.__version__} : SortformerEncLabelModel et l'encodeur Transformer importent")
PY
if "$ENV/bin/python" -c "import whisper" 2>/dev/null; then ok "Whisper importable : l'option « transcrire » marchera"
else echo "⚠ Whisper n'importe pas depuis $ENV : la diarisation marche, l'option « transcrire » sera grisée"; fi
command -v ffmpeg >/dev/null || ko "ffmpeg manque : sudo apt install ffmpeg"
ok "ffmpeg : $(command -v ffmpeg)"
"$BASE/bin/python" -c "import torch; print('comfyui-env intact : torch', torch.__version__, 'CUDA', torch.cuda.is_available())"

# ── 4. le modèle ──────────────────────────────────────────────────────────────
MODELE="$MODELE" "$ENV/bin/python" - <<'PY' || ko "le modèle ne se charge pas — s'il est verrouillé : ouvrir sa page sur huggingface.co avec le compte du jeton et accepter les conditions ; jeton : ~/reelbench/skill/jeton.sh"
import os, time, numpy as np, torch
from nemo.collections.asr.models import SortformerEncLabelModel as M
nom = os.environ["MODELE"]
t = time.time()
m = M.restore_from(nom, map_location="cuda") if os.path.isfile(nom) else M.from_pretrained(nom, map_location="cuda")
m.eval()
sm = m.sortformer_modules
print(f"✓ {nom} : {sum(p.numel() for p in m.parameters()) / 1e6:.1f} M paramètres, {sm.n_spk} voix, "
      f"en flux : {getattr(m, 'streaming_mode', False)}, chargé en {time.time() - t:.0f} s")
print("  réglages du point de contrôle :", {k: getattr(sm, k) for k in ("chunk_len", "chunk_right_context", "chunk_left_context", "fifo_len", "spkcache_len", "spkcache_update_period")})
x = (np.random.default_rng(0).standard_normal(16000 * 5) * 0.01).astype(np.float32)
for essai in (1, 2):   # la première passe compile flex_attention ; la seconde mesure
    t = time.time()
    try:
        m.diarize(audio=[x], sample_rate=16000, batch_size=1, include_tensor_outputs=True, num_workers=0, verbose=False)
    except Exception as e:
        print(f"  ⚠ la passe compilée a échoué ({type(e).__name__}: {str(e)[:200]}) — le service repassera en immédiat tout seul")
        break
    torch.cuda.synchronize()
    print(f"  passe {essai} sur 5 s de bruit : {time.time() - t:.2f} s")
PY

# ── 5. le service ─────────────────────────────────────────────────────────────
UNITE="$R/skill/diarisation.service"
cat > "$UNITE" <<UNIT
[Unit]
Description=Diarisation Nemotron — le service de la page outils/diarisation
After=network-online.target
Wants=network-online.target

[Service]
User=$USER
WorkingDirectory=$R
ExecStart=$ENV/bin/python $R/skill/diarisation-serveur.py --port 8448 --modele $MODELE
Environment=PYTHONUNBUFFERED=1
Restart=always
RestartSec=5
# Le DGX fait tourner ComfyUI en même temps (40 à 60 Go) : ce service reste petit (2 Go de RAM,
# 1,2 Go de GPU mesurés) et, si la mémoire manque, c'est lui que le noyau tue d'abord.
Nice=5
OOMScoreAdjust=1000
MemoryHigh=10G
MemoryMax=12G
MemorySwapMax=1G

[Install]
WantedBy=multi-user.target
UNIT
ok "unité systemd écrite pour $USER : $UNITE"

cat <<FIN

Prochaines étapes :
  à la main, pour voir :   $ENV/bin/python $R/skill/diarisation-serveur.py
  en service permanent :   sudo cp $UNITE /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now diarisation
  dans le tailnet :        sudo tailscale serve --bg --https=10002 --set-path=/diarisation http://127.0.0.1:8448
                           (ni 443 ni 8443 : sur dgx1 ils sont en Funnel, donc publics ; 10002 ne peut pas l'être)
  l'essai du vrai modèle : $ENV/bin/python $R/skill/diarisation-essai.py <un film.mp4>
FIN
