# Étude — YuE2 dans le portail, et son miroir sur les deux DGX (29/09/2026)

Demande de Cal (29/09) : « on devra rajouter aussi la partie music générative
avec YuE qui est installé sur un des dgx il faudra donc faire un mirror de
l'install sur l'autre ». Consigne toujours valable : l'interface d'abord,
**aucune génération** ; le câblage réel est écrit, vérifié à vide, et
s'allume par un réglage. La séparation de sources (même chantier, ajoutée le
même jour) a son étude : `docs/etudes/stems.md`.

## 1. Ce qu'il y avait (inventaire du 29/09, 08:25)

YuE2 n'était pas « installé sur un des DGX » : il l'était **en deux moitiés**,
une par machine.

| | DGX1 | DGX2 |
|---|---|---|
| dépôt autonome `~/YuE` | commit `92a73cc` (10/09, multimodal-art-projection/YuE), `.venv` Python 3.12 : yue2-infer 0.1.6, torch 2.11.0+cu130 ; `webui.py` de Cal (:7870, arrêtée) | absent |
| cache HF `m-a-p/YuE2-3B` (snapshot `1a96eca6`, 7,26 Go) et `m-a-p/YuE2-Vae` (`95535e72`, 0,53 Go) | présents | absents |
| ComfyUI :8188 | v0.37.2 (`830232b8`), nœuds YuE2 **du cœur** (`comfy_extras/nodes_yue2.py`) | idem |
| poids ComfyUI (Comfy-Org/YuE2, commit `8e6fcf0f`) : `checkpoints/yue2_3b_bf16.safetensors` 7,80 Go, `yue2_3b_int8_convrot.safetensors` 3,96 Go, `audio_encoders/sheetsage2_bf16.safetensors` 1,39 Go | absents | présents |
| nœuds `o-l-l-i_ComfyUI-Olm-YuE2` (`ded9d97`, 11/09) et `ComfyUI-YuE2-Trainer` (`4578039`, 14/09) | absents | présents |
| workflows de Cal `user/default/workflows/AUDIO/01, 02, 06, 07_YuE2_*.json` | absents | présents |

Aussi sur DGX2, hors installation : `~/yue2-candidates` (six dépôts de nœuds
comparés le 15/09, aucun installé), `~/yue2_test.py` et ses journaux.

### Quelle voie marchait, d'après les journaux

- **Dépôt autonome, DGX1** (`~/yue2-test.log`, `~/YuE/out/song/result.json`) :
  60 s de chanson en **162,6 s** de bout en bout, bf16, après 311 s de
  téléchargement des poids au premier appel. Détail : plan ABC 12,7 s
  (42 jetons/s), jetons musicaux 34,6 s, NAR 7,3 s, **VAE 66,8 s** (chargement
  compris). Trois rendus de la webui : 60 s → 164 s, 74,6 s → 191 s,
  341 s → 504 s (partition tronquée à 4096 jetons). Même graine, même
  machine : deux fois le même fichier (sha256 `10a75780…`).
  L'installation avait signalé un conflit : yue2-infer 0.1.6 exige
  torch==2.10.0, le venv a 2.11.0 (`~/install-yue2.log`) ; les rendus sont
  passés quand même.
- **ComfyUI, nœuds du cœur, DGX2** (`~/yue2_test.py`, 15/09) : 30 s de
  chanson, `success` relevé à **40 s** en bf16 et **20 s** en int8 (relevé
  toutes les 10 s : borne haute).
- **Olm-YuE2** : chargés dans ComfyUI mais **sans modèle** (« No models found —
  configure yue2 paths ») : ils veulent `models/yue2/` et `models/yue2_vae/`,
  absents des deux machines. Jamais rendu.
- La webui de DGX1 (`~/yue2-webui.log`) : seulement des « Broken pipe » au
  téléchargement des FLAC ; elle n'écoute plus.

## 2. Le miroir (fait le 29/09, 08:33-08:37)

`tools/mirror_yue.sh`, lancé depuis une DGX (jamais depuis le PC), socle
commun `tools/mirror_lib.sh` : rsync de machine à machine **par le câble**
(169.254.110.6 ↔ 169.254.42.193), chaque élément depuis sa machine de
référence, jamais `--delete`, rendus et `__pycache__` exclus. `--check`
vérifie sans copier.

Copié : DGX2 → DGX1 les poids ComfyUI, leurs `.metadata`, les deux nœuds, les
quatre workflows YuE2 ; DGX1 → DGX2 `~/YuE` (avec son `.venv` : 4,65 Go,
20 199 fichiers hors `.git`) et les deux caches HF. Durée : 1 min 16 s de copie.

Preuves (`--check` rejoué à 09:08 : « miroir identique ») :

- **tailles et sha256 identiques des deux côtés** pour chaque élément ; les
  trois poids ComfyUI **conformes à l'empreinte LFS** de Comfy-Org/YuE2
  (`33765adb…` bf16, `96fe1993…` int8, `5fd960ce…` SheetSage2) ; blobs du
  cache HF conformes à leur nom (1/1 et 1/1) ;
- **import** : `~/YuE/.venv` → `import yue2 ok · yue2-infer 0.1.6 · torch
  2.11.0+cu130 · CUDA True` sur les deux ; nœuds Olm (14) et Trainer (3)
  importables dans les deux venvs ComfyUI ;
- **/object_info** : 21 nœuds YuE2/SheetSage2 sur chaque ComfyUI (4 du cœur,
  14 Olm, 3 Trainer), `CheckpointLoaderSimple` voit les deux poids YuE2,
  `AudioEncoderLoader` voit SheetSage2, sur DGX1 comme sur DGX2.

**Redémarrage de ComfyUI DGX1** : file vérifiée vide juste avant
(`{"queue_running": [], "queue_pending": []}`), `sudo systemctl restart
comfyui` à **08:37:29**, de nouveau en ligne à **08:37:46**, les nœuds Olm et
Trainer chargés. Les poids, eux, étaient déjà vus sans redémarrage.

Écarts qui restent (environnements, pas fichiers) :

- **tiktoken manque au venv ComfyUI de DGX1** (`~/ComfyUI/venv`) : Olm-YuE2
  se charge (il n'importe ses dépendances qu'à l'exécution) mais ne pourrait
  pas tourner. Le portail n'utilise pas Olm. Proposé, pas fait : voir § 6.
- ComfyUI-Manager (lancé avec DGX1) écrit `.git/.cnr-id` dans le nœud
  Trainer : le contrôle compte un dépôt par son commit et ses fichiers, pas
  par l'intérieur de `.git`.
- Les deux venvs ComfyUI diffèrent déjà (numpy, transformers…) : mêmes
  modèles et nœuds, pas des environnements identiques au bit près (mémoire
  `character-factory-machines`).

## 3. La voie retenue : les nœuds YuE2 du cœur de ComfyUI

| | ComfyUI, nœuds du cœur | dépôt autonome `~/YuE` | Olm-YuE2 |
|---|---|---|---|
| présent sur les deux DGX | oui (v0.37.2) | oui depuis le miroir | oui depuis le miroir |
| a rendu | DGX2, 15/09 | DGX1, 10-15/09 | jamais (pas de modèle) |
| mémoire GPU | gérée par ComfyUI, comme les autres rendus du portail | un second processus qui charge ses 7 Go à côté de ComfyUI | ComfyUI |
| reprise d'un morceau | SheetSage2 du cœur (`SheetSage2AudioToABC`) | SheetSage2 à part (autre venv, pas installé) | non |
| jugé à vide | oui, contre /object_info | non | — |

Le portail passe donc par la **voie `audio`** (ComfyUI :8188) comme le reste
de ses rendus. Le dépôt autonome reste la voie de secours documentée :

```sh
~/YuE/.venv/bin/yue2 generate --style "…" --lyrics-file paroles.txt --cot full \
  --seed 42 --output ~/YuE/out/<id> --offline
```

(`yue2 generate --help` : `--model`, `--vae standard|legacy`, `--cot`,
`--abc-file`, `--cfg-scale`, `--stage plan|audio`, `--offload-ar`,
`--quantization none|fp8` ; pas de durée : c'est la partition qui la fixe.)

## 4. Le moteur : `server/tools/music_yue.py`

Contrat (appelé par la page d'ODIO, qu'un autre agent refait) :

| | |
|---|---|
| `GET /api/music/yue/options` | moteur (`factice` / `comfyui`), prêt ou pourquoi, champs et bornes, modes, précisions, guide du style et des paroles, voix, temps mesurés, machines prêtes (`text`, `ref`, précisions, dans la voie ou non) |
| `POST /api/music/yue/plan` | le graphe que donnerait ce réglage, **jugé contre /object_info** de chaque machine qui répond — rien en file |
| `POST /api/music/yue/generate` | le travail `music.yue` (ou `POST /api/jobs {kind: "music.yue", params}`) |

Paramètres, adaptés à ce que YuE2 prend vraiment :

| champ | valeur | source |
|---|---|---|
| `tags` (alias `style`) | texte, requis ; langue + genre + voix + tempo + instruments + caractère | gabarit officiel ; « `tags` is an alias for `style` » (skill yue2-music) |
| `lyrics` | paroles par sections `[Verse]`, `[Chorus]`, `[Bridge]`, `[Outro]` ; vide = instrumental | gabarit ; infobulle d'Olm YuE2 Request (« Leave empty for instrumental music ») — non essayé |
| `duration_s` | 10 à 900, défaut 60 ; **un maximum** : YuE2 la réduit d'office si le prompt est long, la chanson peut finir avant | `max_duration` 0,04-900 (/object_info) ; 200 jetons minimum = 8 s (`comfy/text_encoders/yue2.py`) ; 60 s « pour itérer vite » (workflow 01 de Cal) |
| `seed` | 0 à 2^64-1, -1 = au hasard ; la même graine partout (plan, musique, KSampler) | nœuds ; SeedNode du gabarit |
| `mode` | `full` (mélodie + accords, défaut), `melody`, `off` | docs/generation.md |
| `precision` | `bf16` (défaut, qualité, celle des LoRA) ou `int8` (celle du gabarit, plus rapide) | workflow 01 de Cal ; README du Trainer |
| `ref` | un son de la bibliothèque → **reprise** : SheetSage2 en tire la partition, YuE2 la rechante (`melody` par défaut) | workflow 02 de Cal ; docs/covers.md |
| `abc` | ta partition (voix `Vocal` et `Ins`) ; exclut `ref`, demande `full` ou `melody` | docs/generation.md |

**Pas d'ICL** : YuE2 n'a aucune entrée « son de référence » (« There is no
request field for `reference_audio`, `phonemes`, `bpm`, `negative_prompt`…
or a reference singer », skill yue2-music). Le `ref` demandé passe donc par
la partition. La voix se décrit dans le style.

Réglages fixes, ceux du gabarit officiel : plan ABC 8192 jetons, température
0,7, top-p 0,9, top-k 30, pénalité 1,005 sur 100 ; musique température 1,0,
top-p 0,95, top-k 100, pénalité 1,2, `cfg_scale` laissé au nœud (1,0 avec
partition, 1,01 sans) ; KSampler 32 pas, cfg 1, `dpm_2` / `sgm_uniform`.
Sortie : `SaveAudioAdvanced` FLAC 48 kHz stéréo → bibliothèque (`kind:
audio`, dossier Musique), recette complète dans `params`, **la partition ABC
dans `params.score`** (lue sur la sortie `text` du nœud PreviewAny « ABC » —
à vérifier au premier rendu), la référence en `parents`.

Moteur **factice par défaut** (voie `cpu`) : une mélodie d'essai (voix en
sinus vibré sur une nappe, clic par temps ; tempo lu dans le style,
« 120 BPM ») à la durée et à la graine demandées, WAV 48 kHz, titre
« (essai) », `params.engine: "factice"`, avec une partition ABC d'essai.

Vérifié le 29/09 (DGX2, sans rien mettre en file) :

- `tools/check.py` : 401 passés ; 1 échec **hors de ce chantier**
  (`upscale : graphe zimage-refine`, présent aussi sans `music_yue.py` ni
  `music_stems.py`). Le selftest YuE couvre bornes, refus, graphes des quatre
  cas (full, off, partition, reprise), le juge de graphe (poids absent, borne,
  sortie inexistante, type de lien, nœud absent, entrée manquante), et deux
  travaux factices jusqu'à la bibliothèque ;
- portail d'essai :8785 : options → **DGX2 et DGX1 prêtes** (texte et
  reprise, bf16 et int8 ; DGX1 hors de la voie audio) ; `plan` des cas full
  60 s, reprise int8, off 900 s → **aucun problème** contre l'/object_info des
  deux ComfyUI ;
- en mode réel (dans le processus, sans serveur) : `music.yue → run_real`,
  voie `audio`, prêt, reprise prête.

## 5. Mémoire et temps

- « Linux · Python 3.12 · NVIDIA GPU with BF16 support and **24 GB VRAM** »
  (README YuE2) ; tableau d'Olm : 24 Go « more room for longer songs ». Les
  GB10 ont 128 Go unifiés. Non mesuré ici.
- Temps : § 1 ; l'estimation affichée par la page peut prendre ~2,7 × la
  durée en bf16 par le dépôt autonome (VAE rechargé à chaque fois),
  moins par ComfyUI qui garde les modèles.
- Délai du travail : 3600 s.

## 6. Ce qui attend Cal

1. **Brancher** : `"music_yue": true` dans `showrunner.local.json` de DGX2,
   puis `tools/portail.sh restart`. Pour deux rendus à la fois, ajouter
   `"http://169.254.110.6:8188"` à `lanes.audio` (DGX1 a tout, miroir fait).
2. **Premier rendu** (quand Cal le dit) : 60 s bf16 `full`, puis int8 ;
   vérifier la partition rendue par PreviewAny, la fin avant `max_duration`,
   le niveau ; écouter.
3. **Proposé, pas fait** : `tiktoken` 0.12.0 dans `~/ComfyUI/venv` de DGX1
   (pour Olm seulement) — soit `~/ComfyUI/venv/bin/pip install --no-deps
   tiktoken==0.12.0` (PyPI, roue aarch64 1 129 008 o ; regex et requests
   déjà là), soit copie par le câble du paquet déjà installé dans
   `~/comfyui-env` de DGX2 ; puis redémarrage de ComfyUI DGX1 file vide.
4. **Olm-YuE2** (partition éditable entre les étapes) : ses dossiers
   `models/yue2/` et `models/yue2_vae/` peuvent pointer vers les snapshots HF
   déjà présents sur les deux machines (aucun téléchargement) ; non fait, le
   portail n'en a pas besoin.
5. **Plus tard** : LoRA (workflow 07, `LoraLoaderModelOnly` sur le bf16 —
   aucun LoRA YuE2 sur les disques), décodeur `YuE2-Vae-legacy` (celui des
   mesures publiées, absent), partition éditable dans ODIO (le champ `abc`
   l'accepte déjà).

Poids YuE2 : **CC BY-NC 4.0** (non commercial) ; code Apache 2.0.

## Sources

- `~/YuE` : README, `docs/generation.md`, `docs/covers.md`,
  `skills/yue2-music/references/generation-and-covers.md` et
  `models-and-setup.md`, `examples/song.json` ; `yue2 generate --help`.
- ComfyUI v0.37.2 : `comfy_extras/nodes_yue2.py`, `comfy/text_encoders/yue2.py`,
  `/object_info` des deux DGX (29/09).
- Gabarit `audio_yue2_text2music.json` (comfyui_workflow_templates_json 0.1.95)
  et sa note ; workflows AUDIO 01, 02, 06, 07 de Cal.
- README d'Olm-YuE2 et de ComfyUI-YuE2-Trainer ; `.metadata` de hf download.
- Journaux : `~/install-yue2.log`, `~/yue2-test.log`, `~/yue2-webui.log` (DGX1),
  `~/yue2_bf16_run.log`, `~/yue2_test_run.log` (DGX2) ; `result.json` des rendus.
