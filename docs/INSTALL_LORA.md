# Installer l'entraînement des LoRA sur les DGX — brief pour une session Claude Code du PC

**À donner tel quel à une session Claude Code ouverte sur le PC de Cal** (dans le dossier du
dépôt). L'étude qui fonde chaque choix : `docs/etudes/lora_entrainement.md` (à lire d'abord).

## Règles (celles de `CLAUDE.md`, à respecter à la lettre)

- **Chaque commande commence par `ssh dgx1 `, `ssh dgx2 ` ou `scp `.** Sur le PC : Read, Write,
  Edit, Glob, Grep seulement.
- **Ne rien redémarrer** (ComfyUI, le portail, H3TEST) ; **ne rien installer dans le venv de
  ComfyUI** ni dans `~/ACE-Step-1.5` (il sert AUDIOLAB sur DGX1) : tout va dans `~/trainers/`.
- **Un rendu en cours passe avant** : avant chaque essai d'entraînement, vérifier que la file
  ComfyUI de la machine est vide (`curl -s 127.0.0.1:8188/queue`) et que le portail n'a pas de
  travail GPU en cours (`~/showrunner-data/jobs.json`) ; prendre le verrou de la machine
  (`flock /tmp/sr_gpu_dgx2.lock …`, `flock /tmp/sr_gpu_dgx1.lock …`).
- Cal a demandé l'installation (05/10 : « il faut installer tout pour pouvoir faire des LoRA pour
  nos modèles image, vidéo et son ») : les téléchargements listés ici sont autorisés ; **tout
  autre téléchargement, lui demander**. Deux modèles sont à accès restreint sur Hugging Face
  (Krea 2, LTX-2.5) : il faut le jeton HF de Cal et qu'il accepte leur licence — lui demander, ne
  jamais écrire le jeton dans un fichier du dépôt.
- Jamais `pkill -f` par motif : par PID.

## 1. ai-toolkit (DGX2 d'abord, puis DGX1)

```sh
ssh dgx2 'mkdir -p ~/trainers && cd ~/trainers && git clone https://github.com/ostris/ai-toolkit.git && cd ai-toolkit && git checkout ecee894'
ssh dgx2 'cd ~/trainers/ai-toolkit && python3 -m venv venv && venv/bin/pip install --no-cache-dir torch==2.13.0 torchvision==0.28.0 torchaudio==2.11.0 --index-url https://download.pytorch.org/whl/cu130'
ssh dgx2 'cd ~/trainers/ai-toolkit && venv/bin/pip install -r requirements.txt && venv/bin/pip install --upgrade torchcodec==0.15.0'
ssh dgx2 'cd ~/trainers/ai-toolkit && venv/bin/python -c "import torch;p=torch.cuda.get_device_properties(0);print(torch.__version__,p.major,p.minor,p.is_integrated)"'
```

Attendu : `2.13.0+cu130 12 1 True`. Une dépendance qui refuse de s'installer en aarch64 : le
noter, chercher la cause (README, issues d'ai-toolkit), ne pas forcer une autre version de torch.
flash-attn est facultatif (SDPA suffit) : ne l'installer que si tout le reste marche.

Puis la même chose sur DGX1 (`ssh dgx1 …`).

## 2. L'entraîneur officiel d'ACE-Step 1.5 (DGX2, puis DGX1)

```sh
ssh dgx2 'cd ~/trainers && git clone https://github.com/ace-step/ACE-Step-1.5.git ace-train && cd ace-train && git checkout ca1e85f'
ssh dgx2 'cd ~/trainers/ace-train && ~/.local/bin/uv sync'      # ou uv dans le PATH ; torch 2.10.0+cu130 aarch64 (pyproject)
ssh dgx2 'cd ~/trainers/ace-train && ~/.local/bin/uv run acestep-download --model acestep-v15-xl-base --skip-main --dir ./checkpoints'   # ≈ 10 Go
```

La VAE et Qwen3-Embedding : des liens vers ceux de `~/ACE-Step-1.5/checkpoints` s'ils y sont (ne
pas les retélécharger). `uv` absent : le dire à Cal plutôt que de l'installer d'office.

## 3. Les téléchargements des modèles d'image et de vidéo (DGX2, puis DGX1)

Avec `MODELS_PATH=$HOME/ComfyUI/models`, ai-toolkit relit nos fichiers ComfyUI ; il ne manque que
des adaptateurs, des configurations et quelques encodeurs. Le plus sûr : lancer chaque essai du
§ 4 **sans** `HF_HUB_OFFLINE` la première fois (il télécharge ce qui manque), noter ce qui est
venu (taille, chemin), puis toujours avec `HF_HUB_OFFLINE=1` ensuite. Attendu d'après l'étude :

| modèle | à télécharger | taille |
|---|---|---|
| Z-Image Turbo | encodeur Qwen3-4B et VAE de `Tongyi-MAI/Z-Image-Turbo`, `ostris/zimage_turbo_training_adapter` v2 | ≈ 8 Go |
| Qwen-Image 2.1 | configs et processeur de `Qwen/Qwen-Image-2.1` | quelques Mo |
| Krea 2 (jeton HF) | `Qwen/Qwen3-VL-4B-Instruct`, VAE de `Qwen/Qwen-Image`, `ostris/krea2_turbo_training_adapter` v1 | ≈ 10 Go |
| H3 | `ostris/minimax_h3_training_adapter` (v3 fl2va ; ref2va v2), configs | petit |

Attention : sans `HF_HUB_OFFLINE`, un fichier manquant se télécharge **dans** `~/ComfyUI/models`
(c'est voulu, mais le dire dans le compte rendu).

## 4. Vérifier chaque modèle : un essai court, puis le manifeste

Pour chaque modèle (Z-Image d'abord), sur DGX2 : un jeu de 4 à 8 images (n'importe lesquelles de
`~/showrunner-data/library/ima-*/main.*`, avec un `.txt` d'une ligne à côté de chacune), un YAML
d'après le gabarit de l'étude (§ 5 du rapport complet, repris ci-dessous), **20 pas**, sans
échantillons (`sample_every` plus grand que `steps`). Il doit écrire un `.safetensors`. Puis
vérifier que ComfyUI le charge : un graphe du modèle avec `LoraLoaderModelOnly` (le fichier copié
dans `~/ComfyUI/models/loras/showrunner/`), une image rendue.

```yaml
job: extension
config:
  name: "sr_essai_zimage"
  process:
    - type: sd_trainer
      training_folder: "/home/<utilisateur>/trainers/runs"
      device: cuda:0
      trigger_word: "srstyle"
      network: {type: lora, linear: 16, linear_alpha: 16}
      save: {dtype: bf16, save_every: 20, max_step_saves_to_keep: 1}
      datasets:
        - {folder_path: "/home/<utilisateur>/trainers/essai_images", caption_ext: txt, caption_dropout_rate: 0.05,
           cache_latents_to_disk: true, resolution: [768, 1024]}
      train: {batch_size: 1, steps: 20, gradient_checkpointing: true, noise_scheduler: flowmatch,
              timestep_type: linear, optimizer: adamw8bit, lr: 1e-4, dtype: bf16, cache_text_embeddings: true}
      model: {arch: "zimage:turbo", name_or_path: "Tongyi-MAI/Z-Image-Turbo",
              assistant_lora_path: "ostris/zimage_turbo_training_adapter/zimage_turbo_training_adapter_v2.safetensors"}
      sample: {sampler: flowmatch, sample_every: 100000, width: 1024, height: 1024, sample_steps: 8, prompts: ["srstyle"]}
```

Lancement (un rendu en cours passe avant ; vider les caches comme le playbook NVIDIA) :

```sh
ssh dgx2 'curl -s -X POST 127.0.0.1:8188/free -H "Content-Type: application/json" -d "{\"unload_models\":true,\"free_memory\":true}"'
ssh dgx2 'cd ~/trainers/ai-toolkit && flock /tmp/sr_gpu_dgx2.lock env MODELS_PATH=$HOME/ComfyUI/models venv/bin/python run.py ~/trainers/essai_zimage.yaml 2>&1 | tail -40'
```

Les blocs `model:` des autres modèles (valeurs de l'interface d'ai-toolkit, `ui.tsx`) :

- Qwen-Image 2.1 : `{arch: qwen_image_2, name_or_path: "Comfy-Org/Qwen-Image-2.1", quantize: true, qtype: convrot8, quantize_te: true, qtype_te: convrot8}`
- Krea 2 : `{arch: "krea2:turbo", name_or_path: "<chemin de notre DiT Krea 2 Turbo bf16 sous ~/ComfyUI/models/diffusion_models>", assistant_lora_path: "ostris/krea2_turbo_training_adapter/krea2_turbo_training_adapter_v1.safetensors", quantize: false, low_vram: false}`
- H3 (sur images) : `{arch: minimax_h3, name_or_path: "Comfy-Org/MiniMax-H3", model_kwargs: {partition: fl2va_pruned}, quantize: true, qtype: convrot8, quantize_te: true, qtype_te: nvfp4, assistant_lora_path: "ostris/minimax_h3_training_adapter/minimax_h3_training_adapter_v3.safetensors"}`, avec `network: {type: lora, linear: 16, linear_alpha: 16, network_kwargs: {ignore_if_contains: [adaln_proj]}}` et `train.timestep_type: shift`.

ACE-Step (officiel) : 2 à 4 morceaux de la bibliothèque (`~/showrunner-data/library/aud-*/main.*`),
le prétraitement puis 20 époques, d'après `docs/en/LoRA_Training_Tutorial.md` du dépôt cloné :

```sh
ssh dgx2 'cd ~/trainers/ace-train && ~/.local/bin/uv run train.py fixed --checkpoint-dir ./checkpoints --model-variant xl_base --preprocess --audio-dir ~/trainers/essai_sons --dataset-json ~/trainers/essai_sons/ds.json --tensor-output ~/trainers/essai_sons_t'
ssh dgx2 'cd ~/trainers/ace-train && ~/.local/bin/uv run train.py fixed --checkpoint-dir ./checkpoints --model-variant xl_base --dataset-dir ~/trainers/essai_sons_t --output-dir ~/trainers/runs/ace_essai --adapter-type lora --rank 16 --alpha 32 --epochs 20 --save-every 20'
```

## 5. Le manifeste que le portail lit : `~/trainers/sr_lora.json` (sur DGX2)

Le portail (`server/tools/lora_trainers.py`) ne propose un modèle que s'il y est marqué `ok`
**après un essai réussi du § 4** (entraînement ET chargement dans ComfyUI). Le bloc `model` est
celui qui a marché, tel quel ; `s_per_step` la vitesse relevée pendant l'essai.

```json
{
  "v": 1,
  "aitk": "/home/<utilisateur>/trainers/ai-toolkit",
  "ace": "/home/<utilisateur>/trainers/ace-train",
  "models": {
    "zimage": {"ok": true, "trainer": "aitk", "s_per_step": 5.3, "checked": "2026-10-06",
               "model": {"arch": "zimage:turbo", "name_or_path": "Tongyi-MAI/Z-Image-Turbo",
                         "assistant_lora_path": "ostris/zimage_turbo_training_adapter/zimage_turbo_training_adapter_v2.safetensors"}},
    "qwen21": {"ok": false, "note": "pourquoi, s'il ne marche pas"},
    "krea2": {"ok": false, "note": "…"},
    "h3": {"ok": false, "note": "…"},
    "ace": {"ok": true, "trainer": "ace", "variant": "xl_base", "s_per_step": null, "checked": "2026-10-06"},
    "yue2": {"ok": false, "note": "le nœud ComfyUI-YuE2-Trainer (workflow 06) : pas encore branché au portail"}
  }
}
```

Facultatif par modèle : `"network": {…}`, `"train": {…}` (surcharges du gabarit), `"resolution": [768, 1024]`.

Le même manifeste peut exister sur DGX1 (le portail n'entraîne aujourd'hui que sur DGX2, la
machine du portail ; DGX1 sert de deuxième machine plus tard).

## 6. Le compte rendu à rapporter à Cal (qui le colle dans la session cloud)

Pour chaque machine et chaque modèle : installé ou non, ce qui a été téléchargé (taille, chemin),
le résultat de l'essai (s/pas, mémoire vue par `nvidia-smi`, le LoRA chargé par ComfyUI : oui ou
non, avec l'image), et le contenu final de `~/trainers/sr_lora.json`. Ce qui a échoué : le message
d'erreur exact et ce qui a été essayé.
