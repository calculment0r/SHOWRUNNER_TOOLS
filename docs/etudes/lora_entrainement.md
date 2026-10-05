# Étude — entraîner des LoRA image, vidéo et son sur les deux DGX Spark (05/10/2026)

Demande de Cal (05/10) : « installer tout pour pouvoir faire des LoRA pour nos modèles image,
vidéo et son », lancés depuis le portail (le moodboard d'Idéation, `server/tools/lora.py`),
souvent la nuit. Recherche faite en lecture seule (dépôts clonés et lus ; le proxy bloquait
les forums NVIDIA, huggingface.co et krea.ai : ce qui en vient n'est qu'un extrait de moteur
de recherche). **[doc]** lu dans le code ou le README · **[recherche]** extrait de recherche
seulement · **[supposition]** raisonnement.

Versions lues : ostris/ai-toolkit `ecee894` (v0.13.23, 27/09/2026) · kohya-ss/musubi-tuner
`f8a1b03` (v0.3.6) · tdrussell/diffusion-pipe `334106c` · bghira/SimpleTuner `d6b5939` ·
ace-step/ACE-Step-1.5 `ca1e85f` · Lightricks/LTX-2 `9ec55f9` · ComfyUI v0.37.2 (`830232b`, celui
des DGX) · Starnodes2024/ComfyUI-YuE2-Trainer `4578039` · NVIDIA/dgx-spark-playbooks `c3c7324`.

## 1. En bref

- **Un seul outil couvre nos sept modèles : ostris/ai-toolkit** [doc, README § Supported Models] —
  Krea 2 (Raw ; Turbo avec un adaptateur de dé-distillation), Qwen-Image 2.1, Z-Image Turbo et
  Base, MiniMax-H3 (FL2VA, Ref2V), LTX-2.5, ACE-Step 1.5 / 1.5 XL, YuE2.
- **Il est fait pour ces machines** : « These steps also work on ARM64 Linux, including DGX
  Spark / DGX OS » (README) ; torch 2.13.0+cu130 pour Linux aarch64 (`manager/spec.py`) ;
  `toolkit/util/unified_memory.py` reconnaît le GB10 et neutralise les déchargements vers le
  processeur (« extremely slow (~100MB/s on GB10) »).
- **Il relit nos fichiers ComfyUI** avec `MODELS_PATH=~/ComfyUI/models` [doc,
  `toolkit/paths.py`, `toolkit/models/v2/resolver.py`] : H3, Qwen 2.1, YuE2, le DiT de Z-Image ;
  seuls des adaptateurs, des configurations et quelques encodeurs se téléchargent.
- **Ses LoRA se chargent tels quels** (`LoraLoaderModelOnly`) : écrits au préfixe
  `diffusion_model.` de ComfyUI, que v0.37.2 sait lire pour Krea 2, Qwen 2.1, Z-Image (Lumina2),
  ACE-Step 1.5 et MiniMax-H3 [doc, `comfy/lora.py`]. Exception : un LoRA YuE2 d'ai-toolkit
  porte aussi la partie AR sous `text_encoders.*` (il faudrait `LoraLoader`) [supposition].
- **Pour le son, deux compléments** : l'entraîneur **officiel d'ACE-Step 1.5** (LoRA PEFT ou
  LoKr, XL compris, aarch64 cu130 prévu dans son `pyproject.toml`) et le nœud
  **ComfyUI-YuE2-Trainer**, déjà installé (étage NAR : timbre et style).
- **Durées** : une seule mesure publiée sur GB10 pour nos modèles — Z-Image avec ai-toolkit,
  5,3 s/pas, 34,4 Go [recherche, forum NVIDIA]. Le reste (§ 4) est estimé.

## 2. Qui entraîne quoi

| modèle | ai-toolkit | musubi-tuner | autre |
|---|---|---|---|
| Krea 2 | ✅ Raw ; Turbo + `ostris/krea2_turbo_training_adapter_v1` | ✅ Raw seulement | diffusion-pipe, SimpleTuner ; rien d'officiel chez Krea |
| Qwen-Image 2.1 | ✅ `qwen_image_2` (édition si images de contrôle) | ❌ | diffusion-pipe (T2I), SimpleTuner |
| Z-Image | ✅ `zimage:turbo` (adaptateur v2), `zimage`, `zimage:deturbo` | ✅ (Base conseillée) | diffusion-pipe, SimpleTuner |
| MiniMax-H3 | ✅ fl2va / ref2va, adaptateur v3, images ou vidéos | ✅ expérimental (guidance loss) | rien d'officiel chez MiniMax |
| LTX-2.5 (repli) | ✅ | ❌ | `ltx-trainer` officiel (« 80GB+ VRAM recommended », torch cu132) |
| ACE-Step 1.5 XL | ✅ (fichier « AIO » d'ostris à télécharger) | ❌ | **officiel** : `train.py fixed --model-variant xl_base`, LoRA ou LoKr |
| YuE2 | ✅ AR + NAR, expérimental | ❌ | **ComfyUI-YuE2-Trainer** (NAR), déjà là |

Écartés : kohya sd-scripts (FLUX.1, SD3, SDXL… rien de nos modèles ; c'est lui que prend le seul
playbook NVIDIA d'entraînement, `nvidia/flux-finetuning`) ; le nœud natif `TrainLoraNode` de
ComfyUI (générique, expérimental, sans adaptateur de dé-distillation : inadapté aux modèles
distillés [supposition]) ; diffusion-pipe (exige deepspeed, sans roue aarch64).

## 3. aarch64, GB10 (sm_121), CUDA 13

- **PyTorch** : ai-toolkit épingle `torch==2.13.0 torchvision==0.28.0 torchaudio==2.11.0` (index
  cu130, roues aarch64) ; ACE-Step épingle `torch==2.10.0+cu130` « (e.g. NVIDIA DGX Spark) » ;
  ComfyUI tourne en 2.11.0+cu130 → **un venv par outil**.
- **triton** : livré avec torch en aarch64. **flash-attn** : roue aarch64 précompilée (mjun0812,
  facultative ; SDPA suffit). **bitsandbytes 0.50.2** : roue aarch64 avec `libbitsandbytes_cuda130.so`
  (sm_121 non essayé). **optimum-quanto, torchao** : roues universelles. **xformers** : x86 seulement,
  inutile. **deepspeed** : sources seulement.
- **Mémoire unifiée** : le playbook NVIDIA vide les caches avant d'entraîner
  (`sync; echo 3 > /proc/sys/vm/drop_caches`) ; `MemoryMax` et le tueur OOM ne voient pas la
  mémoire CUDA sur GB10 (`orchestration.md` § 3.3) — la sentinelle `nvidia-smi` reste le garde-fou.
- [supposition] Sur Spark : pas de `blocks_to_swap` / `layer_offloading` / `low_vram` (la même
  mémoire, par le chemin lent) ; garder le bf16 quand il tient (musubi a mesuré fp8 plus lent que
  bf16 pour Krea 2).

## 4. Mémoire et durée (LoRA de style, 20 à 50 images, rang 16 à 32)

| travail | mémoire | s/pas | 2000 pas | statut |
|---|---|---|---|---|
| Z-Image Turbo | **34,4 Go** | **5,3** | ≈ 3 h | [recherche] mesuré, forum NVIDIA |
| Krea 2 bf16, 1024 | 40–50 Go | 6–10 | 3,5–5,5 h | estimé |
| Qwen-Image 2.1 INT8, 1024 | 25–40 Go | 4–8 | 2,5–4,5 h | estimé |
| H3 sur images, 768 | 40–60 Go | 4–9 | 2–5 h | estimé |
| H3 sur vidéo 768², 39 images | 60–90 Go | 25–60 | 1000 pas : 7–17 h | estimé |
| ACE-Step XL (officiel) | 17–24 Go | — | LoRA 1–3 h ; LoKr 10–30 min | estimé |
| YuE2 NAR (nœud) | ≈ 24 Go | 3–10 | 3000 pas : 2,5–8 h | estimé |

Ancrage des estimations : FLUX.1-dev 12B sur Spark (playbook NVIDIA) ≈ 6 s par image à 1024 ;
mis à l'échelle par la taille du DiT ; H3 vidéo depuis nos temps de rendu mesurés. Tous les LoRA
d'image tiennent dans une nuit ; H3 sur vidéo, pas toujours.

## 5. Par modèle — ce qu'il faut retenir

- **Krea 2** : entraîner sur Raw et rendre sur Turbo (guides RunComfy, Krea [recherche]), ou Turbo
  + adaptateur pour des entraînements courts (« styles, concepts, and characters »). À
  télécharger : `Qwen/Qwen3-VL-4B-Instruct` (≈ 9 Go), la VAE de `Qwen/Qwen-Image`, l'adaptateur ;
  modèle à accès restreint (jeton HF, licence Krea 2 Community). Notre DiT Turbo bf16 devrait se
  relire [supposition, à vérifier au premier lancement].
- **Qwen-Image 2.1** : ai-toolkit relit nos fichiers Comfy-Org INT8 convrot (DiT 7,3 Go, encodeur
  9,4 Go, VAE) ; seuls des configs de `Qwen/Qwen-Image-2.1`. Licence non commerciale. L'empilement
  « LoRA de style + Viggle turbo » est à essayer [supposition].
- **Z-Image** : **le meilleur premier essai** (petit, seule mesure Spark). Encodeur Qwen3-4B et VAE
  depuis `Tongyi-MAI/Z-Image-Turbo` (≈ 8 Go).
- **H3** (« CFG-distilled » : un entraînement simple le casse en ≈ 50 pas [doc, musubi]) : ai-toolkit
  + `ostris/minimax_h3_training_adapter` v3 (ref2va : v2) relit exactement nos fichiers pruned INT8,
  l'encodeur nvfp4 et les VAE. **Un moodboard d'images convient** (« Image datasets train as single
  latent frames »). Nommer la sortie `h3-<nom>-fl2v.safetensors` : la page Vidéo ne liste qu'un nom
  contenant `h3` et en déduit le mode (`movie.py` l. 1484-1510). Licence : autorisation requise
  dans l'UE.
- **ACE-Step 1.5 XL** : l'entraîneur officiel, en **clone séparé** (`~/ACE-Step-1.5` sert l'API
  d'AUDIOLAB sur DGX1) ; à télécharger : `acestep-v15-xl-base` (≈ 10 Go) ; jeu de données
  `chanson.mp3` + `.lyrics.txt` + `.json` (caption, bpm, tonalité…) ; sortie
  `final/adapter_model.safetensors` (PEFT) → `LoraLoaderModelOnly`. Des sons courts (boucles) :
  non documenté.
- **YuE2** : le nœud déjà installé (NAR, bf16 obligatoire, 3000–5000 pas, « 24 GB VRAM
  recommended » ; retours mitigés). Rien à installer.

## 6. Recommandation

1. **ai-toolkit** sur DGX1 et DGX2, un venv à part, épinglé `ecee894`, lancé en ligne de commande
   (`run.py job.yaml`, pas le « manager », qui se met à jour seul) avec
   `MODELS_PATH=~/ComfyUI/models HF_HUB_OFFLINE=1` une fois les téléchargements faits.
2. **L'entraîneur officiel d'ACE-Step 1.5**, en clone séparé, épinglé `ca1e85f`.
3. **YuE2** : le nœud en place.
4. Plan B, non installé : musubi-tuner (la seule voie H3 sans adaptateur sur un fichier INT8).

Premier essai de validation : **Z-Image Turbo, 20 images, 500 pas** (moins d'une heure).

L'installation pas à pas, pour une session Claude Code du PC (qui a `ssh dgx1` / `ssh dgx2`) :
`docs/INSTALL_LORA.md`. Le portail lit ce que l'installation a vérifié dans `~/trainers/sr_lora.json`
(`server/tools/lora_trainers.py`).

## 7. Ce qui n'a pas de solution aujourd'hui

1. Aucun entraîneur officiel de Krea ni de MiniMax (tout est communautaire ; H3 « experimental »
   chez musubi).
2. Entraîner sur nos piles distillées telles quelles (Qwen 2.1 + Viggle, H3 + Turbo v4, H3
   Singularity) : non documenté — on entraîne sur la base ou avec un adaptateur.
3. YuE2 : pas d'encodeur audio→jetons officiel ; l'AR mémorise vite ; pas de clonage de voix.
4. LoRA d'ACE-Step sur des sons courts : non documenté.
5. Durées sur GB10 : à remplacer par nos mesures.

## Sources

Lues dans le code : [ai-toolkit](https://github.com/ostris/ai-toolkit) (README, `manager/spec.py`,
`toolkit/util/unified_memory.py`, `toolkit/models/v2/resolver.py`, `extensions_built_in/*`) ·
[musubi-tuner](https://github.com/kohya-ss/musubi-tuner) (`docs/krea2.md`, `docs/zimage.md`,
`docs/minimax_h3*.md`) · [diffusion-pipe](https://github.com/tdrussell/diffusion-pipe) ·
[SimpleTuner](https://github.com/bghira/SimpleTuner) · [sd-scripts](https://github.com/kohya-ss/sd-scripts) ·
[ACE-Step-1.5](https://github.com/ace-step/ACE-Step-1.5) (`docs/en/LoRA_Training_Tutorial.md`,
`acestep/training_v2/cli/args.py`, [issue #994](https://github.com/ace-step/ACE-Step-1.5/issues/994)) ·
[ComfyUI-YuE2-Trainer](https://github.com/Starnodes2024/ComfyUI-YuE2-Trainer) ·
[ComfyUI](https://github.com/comfyanonymous/ComfyUI) v0.37.2 (`comfy/lora.py`, `comfy_extras/nodes_train.py`) ·
[ComfyUI-AIToolkit-MiniMaxH3](https://github.com/ostris/ComfyUI-AIToolkit-MiniMaxH3) ·
[LTX-2](https://github.com/Lightricks/LTX-2) · [dgx-spark-playbooks](https://github.com/NVIDIA/dgx-spark-playbooks)
(`nvidia/flux-finetuning`).
Par extrait de recherche : [forum NVIDIA, ai-toolkit sur Spark](https://forums.developer.nvidia.com/t/ostris-ai-toolkit-on-dgx-spark/355277) ·
[forum NVIDIA, ai-toolkit sur Spark (2)](https://forums.developer.nvidia.com/t/has-anyone-been-able-to-get-ostris-ai-toolkit-running-on-dgx-spark/349815) ·
[forum NVIDIA, ACE-Step sur Spark](https://forums.developer.nvidia.com/t/ace-step-v1-5-on-dgx-spark-install-recipe-measured-numbers-and-the-scheduling-finding-id-have-wanted-before-i-started/378352) ·
[Classmethod, FLUX.1 sur Spark](https://dev.classmethod.jp/en/articles/dgx-spark-flux1-dreambooth-lora/) ·
[adaptateur Krea 2](https://huggingface.co/ostris/krea2_turbo_training_adapter) ·
[RunComfy, Krea 2](https://www.runcomfy.com/trainer/ai-toolkit/krea-2-lora-training) ·
[RunComfy, H3](https://www.runcomfy.com/trainer/ai-toolkit/minimax-h3-lora-training) ·
[comfyui-wiki, YuE2](https://comfyui-wiki.com/en/news/2026-09-19-yue2-lora-trainer).
