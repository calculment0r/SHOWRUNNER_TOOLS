# Étude — séparer un son en pistes (stems) pour ODIO (29/09/2026)

Demande de Cal (29/09) : « on doit pouvoir faire une musique avec YuE et faire
une séparation de stems de super qualité pour l'importer dans le studio »
(ODIO, le studio musique du portail). Règles du chantier : ssh/scp seulement,
**aucun rendu**, aucun téléchargement (on propose), miroir exact des deux DGX
par le câble. YuE2 : `docs/etudes/yue.md`.

## 1. Les meilleurs séparateurs à date, mesurés

La mesure commune est le **SDR** (dB, plus haut = mieux) par piste. Le banc
public le plus fourni est le classement **Multisong de MVSep** (mêmes 100
chansons pour tous), relevé le **29/09/2026**
(mvsep.com/quality_checker/multisong_leaderboard, triés par piste).

| entrée MVSep (id) | basse | batterie | autre | voix | instrumental | disponible ici ? |
|---|---:|---:|---:|---:|---:|---|
| MVSep Ensemble (vocals, instrum, bass, drums, other), 30/06/2025 (8504) | **14,85** | **14,33** | **9,01** | 11,93 | 18,24 | non : ensemble du service en ligne MVSep |
| BS Roformer 124 bands, MVSep.com, 10/07/2026 (10197) | — | — | — | **12,33** | **18,64** | non : modèle du service MVSep |
| **BS Roformer SW (6 stems)** (8374) | 14,62 | 14,11 | 8,72 | 11,30 | 17,51 | **à télécharger** (§ 5) — meilleur modèle unique public à 4+ pistes |
| BS Roformer viperx edition, 28/03/2024 (6176) | — | — | — | 10,87 | 17,18 | **oui**, les deux DGX |
| « output_bs-r_only_htdemucs_ft » (6855) : BS-RoFormer puis htdemucs_ft, d'après son nom | 12,47 | 11,86 | 7,13 | 11,01 | 17,32 | **oui** (notre chaîne, § 4) |
| Demucs4 HT (htdemucs_ft) (262) | 12,05 | 11,24 | 5,74 | 8,33 | 14,64 | **oui**, les deux DGX |
| idem, shifts=10, overlap 0,95 (435) | 12,25 | 11,41 | 5,85 | 8,43 | 14,74 | oui (dix fois le calcul) |

Autres sources publiées :

- **ZFTurbo/Music-Source-Separation-Training** (`docs/pretrained_models.md`,
  Multisong) : BS Roformer viperx voix **10,87** ; MelBand Roformer
  KimberleyJensen voix 10,98 ; HTDemucs4 affinés un par piste (ce sont les
  quatre modèles de `htdemucs_ft`, poids identité dans
  `demucs/remote/htdemucs_ft.yaml`) : batterie 11,13, basse 11,96, autre
  5,85, voix 8,38 ; HTDemucs4 6 pistes : basse 11,22, batterie 10,22, voix
  8,05 (autre, guitare, piano non notés). Sur MUSDB18-HQ test (modèles
  entraînés sur MUSDB seul) : SCNet XL IHF moy. 10,08 (voix 11,42, batterie
  11,81, basse 9,23, autre 7,88), BS Roformer 9,65.
- **python-audio-separator 0.44.2** (`models-scores.json`, installé ; médiane
  sur 13 à 40 pistes de MUSDB18, que certains modèles ont pu voir à
  l'entraînement) : BS-RoFormer viperx 1297 voix 11,77 / instrumental 16,45 ;
  htdemucs_ft voix 10,79, batterie 10,02, basse 12,02 ; MelBand Roformer Kim
  FT (unwa) voix 12,44 ; MelBand Roformer big beta 4 voix 12,52.

Lecture : pour la **voix**, les RoFormer dépassent Demucs de 2,5 à 3 dB ;
pour **batterie / basse / autre**, BS-RoFormer SW gagne ~2 dB sur
htdemucs_ft ; les ensembles de MVSep ne font que +0,2 à +0,6 dB de plus.

## 2. Ce qui est installé (29/09)

| | DGX1 | DGX2 |
|---|---|---|
| nœuds ComfyUI `AudioSeparation` (set-soft, `621bd27`, v1.1.3, GPLv3 : Demucs et MDX-Net, modèles en safetensors, jamais d'ONNX) | absent → copié | présent |
| nœuds `audio-separation-nodes-comfyui` (christian-byrne, `ac33956`, MIT : Demucs de torchaudio, recoller, tempo) | absent → copié | présent |
| `models/audio/Demucs/htdemucs_ft.safetensors` (336 125 008 o, sha256 = oid LFS de set-soft/audio_separation, MIT) | absent → copié | présent |
| BS-RoFormer viperx 1297 `model_bs_roformer_ep_317_sdr_12.9755.ckpt` (639 331 213 o, sha256 `5b84f37e…`) | `~/Maestro/app/ckpts/roformer/` | `~/reelbench/models/audio-separator/` |
| audio-separator 0.44.2 + demucs 4.0.1, venv `~/audio-studio/.venv` (celui d'AUDIOLAB, service de Cal, DGX1 seulement) | marche | **cassé** : il manquait les 9 125 fichiers rangés sous un dossier nommé `data` ou `io` (dont `torch/utils/data`) — une copie qui avait exclu ces noms |
| cache torch hub de Demucs (htdemucs `955717e8`, htdemucs_6s `5c90dfd2`) | présent | absent → copié |

Vu marcher : htdemucs_ft par ComfyUI sur DGX2 le 28/09 (**8 s pour 30 s**,
`docs/etudes/musique.md`) ; BS-RoFormer par audio-separator dans la chaîne
doublage de Movie Analysis (DGX2, 25/09) et dans AUDIOLAB (DGX1, juin).
Aucun nœud ComfyUI RoFormer sur les disques.

## 3. Le miroir (fait le 29/09, 08:48-08:50)

`tools/mirror_stems.sh` (socle `tools/mirror_lib.sh`, comme YuE) :

- DGX2 → DGX1 : les deux paquets de nœuds, `htdemucs_ft.safetensors` et son
  `.catalog.csv`, `models/audio/MDX/` (vide), et **`models/audio/RoFormer/`**,
  le dossier du portail pour les RoFormer, amorcé sur DGX2 depuis
  `~/reelbench/models/audio-separator` (ckpt, yaml, `download_checks.json` :
  audio-separator reste hors ligne) ;
- DGX1 → DGX2 : le venv `~/audio-studio/.venv` (seuls les fichiers manquants
  arrivent, rien n'est effacé ; le venv de DGX1 est lu, jamais écrit) et le
  cache torch hub de Demucs.

Preuves (`--check` rejoué à 09:08 : « miroir identique ») : tailles et sha256
identiques des deux côtés, élément par élément (le venv : 5 455 824 098 o,
34 291 fichiers) ; `htdemucs_ft` conforme à l'oid de Hugging Face ; les `.th`
conformes au préfixe de sha256 de leur nom ; le RoFormer du portail égal
**octet pour octet** à celui de Maestro (DGX1) et de reelbench (DGX2) ;
`import audio_separator` (0.44.2) et `demucs` (4.0.1) réussis sur les deux ;
nœuds `audio-separation-nodes-comfyui` importables sur les deux.

Restent, **proposés, pas faits** :

- `seconohe` 1.0.6 manque au venv ComfyUI de DGX1 : `AudioSeparation` ne s'y
  importe pas. `~/ComfyUI/venv/bin/pip install --no-deps seconohe==1.0.6`
  (PyPI, roue 63 269 o, dépend seulement de tqdm, présent) — ou copie par le
  câble du paquet de `~/comfyui-env` de DGX2.
- Puis **un** redémarrage de ComfyUI DGX1, file vide (avec `tiktoken` pour
  Olm-YuE2, `docs/etudes/yue.md` § 6) : les nœuds de séparation copiés ne sont
  pas encore chargés (file vide à 08:50, redémarrage volontairement remis pour
  n'en faire qu'un).

## 4. Ce qu'on retient pour « super qualité »

| modèle (`model`) | pistes | lanceur | aujourd'hui |
|---|---|---|---|
| `roformer_htdemucs_ft` — **recommandé tant que SW manque** | voix, batterie, basse, autre | voix par BS-RoFormer viperx (audio-separator), puis htdemucs_ft (ComfyUI) sur l'instrumental | prêt sur DGX2 |
| `htdemucs_ft` — défaut du contrat | voix, batterie, basse, autre | ComfyUI, AudioSeparateDemucs | prêt sur DGX2 (DGX1 après seconohe) |
| `bs_roformer_viperx` | voix, instrumental | audio-separator | prêt |
| `bs_roformer_sw` — **la cible** | voix, batterie, basse, autre, guitare, piano | audio-separator (qui le connaît déjà : « BS Roformer SW by jarredou », `models.json`) | à télécharger |
| `htdemucs_6s` | les mêmes six | ComfyUI | à télécharger ; piano « approximatif » (README d'AUDIOLAB), autre/guitare/piano non notés |

Gains mesurés (MVSep) de la chaîne sur htdemucs_ft seul : voix **+2,7 dB**,
autre +1,4, batterie +0,6, basse +0,4. De BS-RoFormer SW sur la chaîne :
batterie **+2,3**, basse +2,2, autre +1,6, voix +0,3, et deux pistes de plus.
Pas de MDX-Net (UVR) : sous les RoFormer à tous les bancs ci-dessus.

## 5. À télécharger (proposé, rien de fait)

| fichier | taille | source | pour |
|---|---:|---|---|
| `BS-Roformer-SW.ckpt` | 699 412 152 o | github.com/nomadkaraoke/python-audio-separator/releases/download/model-configs/ | `bs_roformer_sw` |
| `BS-Roformer-SW.yaml` | 4 653 o | idem | idem |
| `htdemucs_6s.safetensors` | 54 890 960 o | huggingface.co/set-soft/audio_separation, `Demucs/` (MIT) | `htdemucs_6s` |
| (voix seule, option) `mel_band_roformer_kim_ft_unwa.ckpt` | 913 100 690 o | releases model-configs d'audio-separator | voix 12,44 (médiane audio-separator) |

Tailles lues par requêtes HEAD / API, sans rien télécharger. Les deux RoFormer
vont dans `~/ComfyUI/models/audio/RoFormer/` d'une DGX, htdemucs_6s dans
`~/ComfyUI/models/audio/Demucs/`, puis `bash tools/mirror_stems.sh` (ajouter
leurs chemins à `ITEMS`) ; le portail les voit seul (`/api/music/stems/options`).
Licence des poids SW : non précisée par sa source.

## 6. Le moteur : `server/tools/music_stems.py`

Contrat (la page d'ODIO l'appelle ; `music.stems` quitte `music.py`) :

| | |
|---|---|
| `GET /api/music/stems/options` | modèles, leurs pistes, prêts ou pourquoi (moteur courant et moteur réel), mesures publiées, téléchargements proposés, machines, défaut (`htdemucs_ft`) et recommandé (le premier prêt de SW → chaîne → htdemucs_ft) |
| `POST /api/music/stems/plan` | la commande audio-separator et le graphe Demucs jugé contre /object_info — rien en file |
| `POST /api/music/stems/separate` | le travail `music.stems` (ou `POST /api/jobs {kind: "music.stems", params}`) |

Paramètres : `{"src": id d'un son (alias « item », l'ancien contrat), "model":
id, "stems": sous-liste}`. Sorties : un objet audio par piste, `params.stem`,
`parents: [src]`, dossier Musique.

**Le calage** (« même durée et même départ ») : la source est décodée une seule
fois par ffmpeg en WAV 24 bits stéréo à sa fréquence ; le séparateur reçoit ce
WAV ; chaque piste est ramenée par ffmpeg à cette fréquence et à ce nombre
exact d'échantillons (`aresample`, `apad=whole_len`, `atrim=end_sample`), FLAC
24 bits, et le compte est vérifié (`params.samples`, `params.sample_rate`).
Essai sur DGX2 : 3 s à 48 kHz → quatre pistes de 144 000 échantillons, 24 bits.
audio-separator tourne avec `--normalization 1.0` : au défaut (0,9) il
baisserait le niveau (`spec_utils.normalize`) et les pistes ne redonneraient
plus le mélange.

Moteurs : **factice par défaut** (voie `cpu`, filtres ffmpeg, titres
« (essai) ») ; réel derrière `"music_stems": true` (voie `audio`) :
Demucs par ComfyUI (modèle pris seulement s'il est 💾 sur disque), RoFormer
par audio-separator en sous-processus **sur la machine du portail** (arrêt par
son PID) — un travail RoFormer ou chaîne est épinglé au ComfyUI local de la
voie audio pour que tout tourne sur la même DGX. Réglages `stems_asep_bin` et
`stems_model_dir` pour changer de lanceur ou de dossier.

Vérifié le 29/09, sans rendu : `tools/check.py` (401 passés, l'échec
`upscale` n'est pas de ce chantier) ; portail d'essai :8785 : options (réel :
htdemucs_ft, viperx, chaîne prêts sur DGX2 ; SW et 6s « téléchargement
proposé »), plan de la chaîne sans problème contre l'/object_info de DGX2,
travail factice de bout en bout ; en mode réel dans le processus :
`music.stems → run_real`, voie `audio`.

## 7. Ce qui reste à essayer quand Cal câblera

1. `"music_stems": true` sur DGX2, `tools/portail.sh restart`.
2. Premier rendu de chaque lanceur sur une chanson de 30 s : temps, niveau,
   somme des pistes contre le mélange, calage dans ODIO ; ComfyUI écrit son
   FLAC depuis un cadre flottant (`comfy_api/latest/_ui.py`) — la profondeur
   réelle est à relever au premier rendu (le calage réécrit en 24 bits).
3. Après accord : télécharger SW (et 6s), relancer le miroir.
4. DGX1 dans la voie audio une fois seconohe posé et ComfyUI redémarré.
5. `shifts` de Demucs : +0,1 à +0,2 dB pour dix fois le calcul (MVSep 435) —
   à n'essayer que si l'oreille de Cal le demande.

## Sources

- MVSep, classement Multisong (29/09/2026), entrées 8504, 10197, 8374, 6176,
  6855, 262, 435.
- ZFTurbo/Music-Source-Separation-Training, `docs/pretrained_models.md`.
- python-audio-separator 0.44.2 (installé) : `models.json`,
  `models-scores.json`, `separator/separator.py`, `uvr_lib_v5/spec_utils.py` ;
  licence MIT. demucs 4.0.1 : `remote/htdemucs_ft.yaml` ; licence MIT.
- README et `models/uvr_model_data.json` d'AudioSeparation ; API Hugging Face
  de set-soft/audio_separation (tailles, oid, licence MIT).
- `~/audio-studio/README.md` et `backend/app.py` (AUDIOLAB, lecture seule).
