# Installer l'entraînement des LoRA sur les DGX — brief pour une session Claude Code du PC

**Fait le 05/10/2026 sur DGX2 et DGX1** : le compte rendu, ce qui a changé par rapport à ce brief
et le manifeste final sont au **§ 6**. Le brief reste tel qu'il a été donné ; ses trois écarts
avec ce qui marche sont signalés en place (HF_HUB_OFFLINE, les commandes d'ACE-Step, le manifeste).

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
venu (taille, chemin), puis toujours avec `HF_HUB_OFFLINE=1` ensuite. **Corrigé le 05/10 : jamais
`HF_HUB_OFFLINE=1`** — hors ligne, Z-Image, Qwen-Image 2.1 et H3 échouent (§ 6) ; ai-toolkit lit
déjà le cache d'abord. Attendu d'après l'étude :

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
le prétraitement puis 20 époques, d'après `docs/en/LoRA_Training_Tutorial.md` du dépôt cloné
(**ces deux commandes ne marchent pas telles quelles** : celles qui marchent sont dans le manifeste
du § 6 — `--model-variant acestep-v15-xl-base`, `--plain --yes`, `--dataset-dir` et
`--output-dir` même au prétraitement, `uv run --directory`) :

```sh
ssh dgx2 'cd ~/trainers/ace-train && ~/.local/bin/uv run train.py fixed --checkpoint-dir ./checkpoints --model-variant xl_base --preprocess --audio-dir ~/trainers/essai_sons --dataset-json ~/trainers/essai_sons/ds.json --tensor-output ~/trainers/essai_sons_t'
ssh dgx2 'cd ~/trainers/ace-train && ~/.local/bin/uv run train.py fixed --checkpoint-dir ./checkpoints --model-variant xl_base --dataset-dir ~/trainers/essai_sons_t --output-dir ~/trainers/runs/ace_essai --adapter-type lora --rank 16 --alpha 32 --epochs 20 --save-every 20'
```

## 5. Le manifeste que le portail lit : `~/trainers/sr_lora.json` (sur DGX2)

Le portail (`server/tools/lora_trainers.py`) ne propose un modèle que s'il y est marqué `ok`
**après un essai réussi du § 4** (entraînement ET chargement dans ComfyUI). Le bloc `model` est
celui qui a marché, tel quel ; `s_per_step` la vitesse relevée pendant l'essai. (Le gabarit
ci-dessous était celui du brief ; le manifeste réel du 05/10 est au § 6.)

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
    "ace": {"ok": true, "trainer": "ace", "checked": "2026-10-06",
            "preprocess": ["/home/<utilisateur>/.local/bin/uv", "run", "train.py", "fixed", "--checkpoint-dir", "./checkpoints",
                           "--model-variant", "xl_base", "--preprocess", "--audio-dir", "{audio}", "--tensor-output", "{tensors}"],
            "cmd": ["/home/<utilisateur>/.local/bin/uv", "run", "train.py", "fixed", "--checkpoint-dir", "./checkpoints",
                    "--model-variant", "xl_base", "--dataset-dir", "{tensors}", "--output-dir", "{out}",
                    "--adapter-type", "lora", "--rank", "32", "--alpha", "64", "--epochs", "800", "--save-every", "50"]},
    "yue2": {"ok": false, "note": "le nœud ComfyUI-YuE2-Trainer (workflow 06) : pas encore branché au portail"}
  }
}
```

Facultatif par modèle : `"network": {…}`, `"train": {…}` (surcharges du gabarit, `steps` compris),
`"resolution": [768, 1024]`.

**ACE-Step** : `preprocess` et `cmd` sont **les commandes exactes qui ont marché à l'essai**
(chemins absolus), où le portail remplace `{audio}` (le dossier des sons : `000.wav`,
`000.caption.txt`, `000.lyrics.txt`…), `{tensors}` et `{out}` ; si le prétraitement veut un
`--dataset-json`, l'écrire dans la commande et le dire dans le compte rendu (le portail l'écrira).
Le portail cherche ensuite `adapter_model.safetensors` sous `{out}`.

Le portail copie chaque LoRA produit dans `~/ComfyUI/models/loras/showrunner/` (DGX2), puis par le
câble vers DGX1 (`rsync` vers `169.254.110.6:ComfyUI/models/loras/showrunner/`) : vérifier que
`ssh -o BatchMode=yes 169.254.110.6 true` marche depuis DGX2.

Une fois le manifeste écrit : Admin → Diagnostics → « LoRA » le relit et dit ce que le portail
propose (rien à redémarrer : le portail relit le manifeste à chaque demande).

Le même manifeste peut exister sur DGX1 (le portail n'entraîne aujourd'hui que sur DGX2, la
machine du portail ; DGX1 sert de deuxième machine plus tard).

## 6. Le compte rendu — fait, le 05/10

(Ce que le brief demandait : pour chaque machine et chaque modèle, installé ou non, ce qui a été
téléchargé, le résultat de l'essai, le contenu final de `~/trainers/sr_lora.json`, et ce qui a
échoué.) Session du PC du 05/10, d'après ce brief. Rien n'a été redémarré, rien installé dans le
venv de ComfyUI ni dans `~/ACE-Step-1.5` ; chaque essai sous `flock /tmp/sr_gpu_dgxN.lock`, file
ComfyUI vide, après `/free`.

**Installé sur les deux DGX** (32 Go par machine sous `~/trainers/`) :
- ai-toolkit `ecee894` (`~/trainers/ai-toolkit`, venv 6,0 Go) : torch `2.13.0+cu130 12 1 True`,
  `requirements.txt` et torchcodec 0.15.0 sans erreur en aarch64 (bitsandbytes 0.50.2, diffusers
  0.39.0.dev0, transformers 5.5.3) ; flash-attn non installé (SDPA).
- L'entraîneur d'ACE-Step 1.5 `ca1e85f` (`~/trainers/ace-train`, venv 5,3 Go, torch
  `2.10.0+cu130`) ; `acestep-v15-xl-base` dans `checkpoints/` ; la VAE et Qwen3-Embedding-0.6B
  sont des liens vers `~/ACE-Step-1.5/checkpoints`.

**Téléchargé** (identique sur les deux machines ; rien d'autre n'est arrivé dans `~/ComfyUI/models` :
les DiT, encodeurs et VAE sont relus depuis nos fichiers ComfyUI) :

| quoi | taille | où |
|---|---|---|
| `Tongyi-MAI/Z-Image-Turbo` (encodeur Qwen3-4B, VAE, tokenizer) | 7,7 Go | cache HF |
| `ostris/zimage_turbo_training_adapter` v2 | 325 Mo | cache HF |
| `Qwen/Qwen-Image-2.1` (configs, processeur) | 16 Mo | cache HF |
| `Qwen/Qwen3-VL-4B-Instruct` | 8,3 Go | cache HF |
| `Qwen/Qwen-Image` (VAE) | 243 Mo | cache HF |
| `ostris/krea2_turbo_training_adapter` v1 | 219 Mo | cache HF |
| `MiniMaxAI/MiniMax-H3` (tokenizer, processeur, config) | 12 Mo | cache HF |
| `ostris/minimax_h3_training_adapter` v3 | 296 Mo | `~/ComfyUI/models/loras/training_adapters/` |
| `ACE-Step/acestep-v15-xl-base` | **19 Go** | `~/trainers/ace-train/checkpoints/` |
| torchcodec `0.10.0+cu130` | quelques Mo | venv d'ACE-Step (accord de Cal) |

**Essais** (6 photos d'archives de Paris de la bibliothèque, 20 pas, rang 16, 768/1024 ; ACE : 3
morceaux). Chaque LoRA copié dans `loras/showrunner/`, rendu par le graphe du portail plus
`LoraLoaderModelOnly`, même graine à force 1 puis 0 : aucune ligne `lora key not loaded`, des
poids patchés, des pixels qui changent. Les copies d'essai ont été retirées ensuite.

| modèle | s/pas DGX2 · DGX1 | mémoire du processus (pic) | chargé par ComfyUI |
|---|---|---|---|
| Z-Image Turbo | 6,35 · 6,2 | 20,8 Go | oui — 180 poids patchés, 23 % des pixels changent |
| Qwen-Image 2.1 | 6,6 · 6,7 | 17,3 Go | oui — empilé sur Viggle turbo (montage Character Factory), 192 |
| Krea 2 Turbo bf16 + adaptateur | 9,6 · 9,7 | 33 Go | oui — 256, 38 à 47 % |
| H3 fl2va_pruned (images) + adaptateur v3 | 4,55 · 4,4 | 42 à 44 Go | oui — recette de Cal en i2v, écart ≈ 2/255 par image, 258 patches (les couches de People et DY) ; 0 entre deux rendus à force 0 |
| ACE-Step 1.5 XL base (LoRA PEFT) | 5,6 s par époque pour 3 morceaux | ≈ 11 Go | oui (256 patches), **sur le ComfyUI de DGX2** : celui de DGX1 n'a aucun modèle ACE-Step 1.5 |

ACE-Step : prétraitement de 3 morceaux en 75 à 88 s ; au rang 32, un point de sauvegarde pèse
≈ 240 Mo (`--epochs 800 --save-every 50` en laisse 16, ≈ 3,9 Go, plus `final/`). Le câble :
`ssh -o BatchMode=yes 169.254.110.6 true` marche depuis DGX2, le `rsync` de `publish()` passe,
`loras/showrunner/` existe sur DGX1.

**Ce qui a changé par rapport au brief**
1. **`HF_HUB_OFFLINE=1` casse Z-Image, Qwen-Image 2.1 et H3** : hors ligne, transformers 5.5.3
   réclame `<dépôt>/<sous-dossier tokenizer>/config.json`, qui n'existe pas sur le Hub
   (`OSError: We couldn't connect to 'https://huggingface.co'…`) ; seul Krea 2 passe. Pour H3, le
   dépôt du tokenizer est écrit en dur dans ai-toolkit. Tous les essais validés ont tourné sans ;
   ai-toolkit lit déjà le cache d'abord. → le portail ne la pose plus (`run_aitk`).
2. **Krea 2 plantait avant le premier pas** avec `cache_text_embeddings` : le gabarit `sample` sans
   `neg` (défaut d'ai-toolkit : `False`) → `TypeError: can only concatenate str (not "bool") to
   str`. → le portail écrit `neg: ""` et `train.disable_sampling: true` pour tous (les deux images
   d'échantillon du début et de la fin coûtent 20 à 50 s chacune, que `sample_every` n'empêche pas).
3. **ACE-Step, quatre obstacles** : torchcodec absent en aarch64 (installé à part : un `uv sync`
   le retire — à refaire après une mise à jour) ; `--model-variant xl_base` refusé à
   l'entraînement → le nom du dossier, `acestep-v15-xl-base` ; `--dataset-dir` et `--output-dir`
   exigés même au prétraitement ; sans `--plain --yes`, en ssh, la confirmation reçoit EOF et sort
   en 0 sans rien faire.
4. **ACE-Step, la racine « sûre »** : tenseurs et sortie doivent être sous le répertoire courant
   (`Path escapes safe root`) → `uv run --directory /home/dgx --project ~/trainers/ace-train`
   (effet de bord : `sidestep.log` s'écrit dans `~/`). → le portail vérifie avant de lancer que
   `{tensors}` et `{out}` sont sous ce `--directory`, et le dit sinon.
5. **ACE-Step ignore `000.caption.txt` / `000.lyrics.txt`** en ligne de commande : sans
   `{audio}/ds.json`, la légende est « 000 ». → le portail l'écrit (`lora_trainers.ace_dataset` :
   le mot déclencheur en `custom_tag`, légende, paroles, et tempo, tonalité, mesure quand la recette
   du son les donne).
6. **ACE-Step rend 0 même en échec** (prétraitement 0/3, modèle introuvable, chemin refusé,
   confirmation interrompue). → le portail compte les `.pt` après le prétraitement (aucun : il
   s'arrête), cherche `final/adapter_model.safetensors`, et son erreur cite la fin utile du journal.
7. `acestep-v15-xl-base` pèse 19 Go, pas ≈ 10. Krea 2 : aucun jeton à saisir (celui de la machine a
   suffi). L'adaptateur d'entraînement d'H3 est arrivé dans `loras/training_adapters/` comme prévu
   → la page Vidéo ne le liste plus (ce n'est pas un LoRA de rendu).
8. DGX1, Qwen 2.1, un premier essai bloqué 22 min sur l'image de référence avec des latents
   **copiés de DGX2** ; relancé avec des caches neufs : normal. Cause non trouvée, sans effet pour
   le portail (il recrée son dossier à chaque travail).

**Le manifeste final** (`~/trainers/sr_lora.json` de DGX2) est copié tel quel dans
`tools/lora_manifeste_0510.json` : l'essai de `lora_trainers` vérifie qu'il propose Z-Image,
Qwen 2.1, Krea 2, H3 et ACE-Step, et pas YuE2. Ses points clés : les quatre modèles d'ai-toolkit
`ok` avec le bloc `model` essayé (Krea 2 et H3 avec `train.disable_sampling`, H3 avec son réseau
`ignore_if_contains: [adaln_proj]` et `timestep_type: shift`) ; ACE-Step `ok` avec ses deux
commandes exactes (`--dataset-json {audio}/ds.json`) ; YuE2 `ok: false` (le nœud n'est pas
branché). Le même manifeste existe sur DGX1, avec ses vitesses.

**Reste sur les machines** : `~/trainers/` (les outils, les essais, `runs/`), les images d'essai
dans `~/ComfyUI/output/sr_lora_essai/`, `~/sidestep.log`, et l'adaptateur d'H3 dans
`loras/training_adapters/` (nécessaire).

**Au rendu** (branché le 05/10, `docs/etudes/lora_entrainement.md` § 8) : un LoRA entraîné se
choisit, avec sa force (0 à 1,5), dans une carte Générer d'Idéation et la page Image pour le modèle
qui l'a produit, et dans la page Vidéo (et la carte vidéo) pour H3 ; il entre dans le graphe par
`LoraLoaderModelOnly`, la forme de ces essais.
