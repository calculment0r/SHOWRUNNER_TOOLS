# Étude — Movie Analysis dans le portail (28/09/2026)

D'où vient le code et ce qui a été laissé : `analyse/PROVENANCE.md`. Ici : les choix faits pour
lancer la chaîne depuis le portail, leur source, et ce qui est vérifié ou non.

## 1. Quelle chaîne lancer

Comparé sur DGX2 (contenus, fins de ligne ignorées) : `analyse.sh` est identique dans
`~/reelbench/skill` et dans le dépôt MOVIE_ANALYSE (`fa8d9d9`) ; 9 scripts diffèrent
(`cast-name.mjs`, `casting-parts.mjs`, `qui-parle.py`, `reid-face.py`, `report.css`, `report.js`,
`serve.mjs`, `studio.mjs`, `video-shots.mjs`), 19 manquent à `~/reelbench/skill` (dont `voix.js`,
`voix.css`, `son.js`, que le `studio.mjs` actuel embarque). Le README de MOVIE_ANALYSE (REPRISE §0)
prévenait déjà que `~/reelbench/skill` était en retard.

Choix : le travail prend **la copie du portail** (`analyse/chaine`, réglage `analyse_skill`), qui
est celle du dépôt, et ne touche pas à `~/reelbench/skill` (une autre session s'en sert). Épreuve :
le `studio.mjs` de la copie rend une page à partir du run existant `~/reelbench/runs/getaround`
(copié dans `/tmp`), code 0, 1417 Ko ; celui de `~/reelbench/skill` aussi (1226 Ko, l'ancienne page).

Limite, dite dans la page : `analyse.sh` est la chaîne « en un appel » du 18/09. Les étapes
ajoutées depuis à la main (REPRISE §3 : `qui-parle.py --out-tracks`, `teintes.py`, `portes.mjs`,
`cartons.mjs`, `corriger.mjs`, la diarisation Nemotron et `mots.json`, les vidéos sur R2,
`--corrections-url`) n'y sont pas. Une analyse lancée du portail donne donc un premier Studio
(vidéo à côté de la page, corrections locales, voix de la chaîne) ; la recette de publication de
MOVIE_ANALYSE reste la voie vers une page du niveau de Getaround et Wall.

## 2. La commande

Ce que le travail lancerait sur DGX2 (relevé dans `portail.log` de l'essai, chaîne factice
remplacée par la vraie) :

```sh
cd ~/reelbench/runs/<nom>
SKILL=~/SHOWRUNNER_TOOLS/analyse/chaine \
systemd-run --user --scope -q -p MemoryMax=64G nice -n 10 \
  bash ~/SHOWRUNNER_TOOLS/analyse/chaine/analyse.sh ~/reelbench/runs/<nom>/<nom>.mp4 "<titre>" --lang fr [--sceneflow]
# YouTube : … analyse.sh "<url>" "<titre>" --lang fr --youtube-id <id>   (dossier ~/reelbench/runs/<id>)
```

- **Le dossier** : `analyse.sh` range le travail dans `$HOME/reelbench/runs/<nom du fichier sans
  extension>` (ou `<id YouTube>`), en dur. La vidéo de la bibliothèque (`…/library/<id>/main.mp4`)
  est donc posée sous `runs/<nom>/<nom>.mp4` par un **lien dur** (même disque, pas de copie) ; un
  lien symbolique ne marcherait pas : le script prend le `realpath` et nommerait le travail `main`.
- **Le nom** : tiré du titre ; refusé s'il existe déjà un `runs/<nom>/` qui n'a pas été lancé du
  portail (repéré par `portail.log`) — les runs de MOVIE_ANALYSE (`getaround`, `wall`…) ne sont
  jamais repris ni réécrits. Un run lancé d'ici se reprend (case « reprendre », ou « Relancer »
  après un échec) : chaque étape saute ce qui est déjà sur le disque.
- **L'environnement** : les défauts du script — `~/comfyui-env/bin/python`,
  `~/.venvs/ytdlp/bin/yt-dlp`, Ollama `127.0.0.1:11434` et `mistral-vlm-16k`. Tous présents sur DGX2
  le 28/09 (route `GET /api/analyse/chaine`, section « La chaîne » de la page), ainsi que SAM 3
  (`~/reelbench/models/sam3/sam3.pt`) et le jeton Hugging Face (seulement sa présence : il n'est
  jamais lu). Arguments relus dans les scripts de la copie : `reid-face.py --face-threshold
  --face-merge --portraits`, `cast-name.mjs --portraits --api --model`, `video-shots.mjs
  seed/frames/sheet/validate/render`.
- **Une à la fois** : voie `analyse` à un ouvrier (`server/core/config.py`).
- **Machine libre d'abord** : la règle de MOVIE_ANALYSE (`HANDOFF-MOVIE-ANALYSIS.md` §1) — le
  travail attend que `chaine/gpu-libre.sh` dise libre (GPU < 20 % sur 5 s, files ComfyUI 8188/8189
  vides, ≥ 40 Go disponibles), et le dit dans son message. Même règle : `nice` et une limite de
  mémoire sous `systemd-run --user --scope` (vérifié : marche depuis le processus du portail).
  **La valeur 64 Go n'est pas mesurée** : c'est un garde-fou réglable (`analyse_memoire_max`),
  pris sous les 121 Go de DGX2 moins ce que ComfyUI prend (40 à 65 Go selon MOVIE_ANALYSE).
  La règle « si ComfyUI démarre pendant notre calcul, arrêter le nôtre » n'est pas automatisée :
  le portail lance lui-même des rendus sur :8188, ils tueraient l'analyse ; à décider.
- **Langue** : `fr` ou `en`. Les consignes du modèle existent en zh, en, fr (`shots-vlm.mjs`,
  `LANGS`) ; zh n'est pas proposé (décision de MOVIE_ANALYSE : aucun caractère chinois dans la
  sortie française). La transcription détecte seule la langue du film.

## 3. La progression

Pas de durée devinée. Le travail lit ce que le script annonce avant chaque étape
(`── N. libellé`, dans `runs/<nom>/portail.log`) : « étape k/N · libellé », barre = k/N ; et il
ajoute les sorties que le script teste lui-même pour sauter une étape (`shots.json` + `frames/` +
`sheets/sheet-a01.jpg`, `whisper.json`, `tracks.json`, `cast.done`, `masks.json`, `vlm.done`,
`adherence.json`). Seuls `cast.done` et `vlm.done` sont de vrais marqueurs `*.done` ; les autres
étapes n'en laissent pas (répliques, qui parle, portes, rapport) et n'apparaissent que par
l'annonce.

À la fin, la page Studio que le script dit avoir écrite (`→ <slug>.html`), le dépouillement, la
vidéo (lien dur), `shots.json` et une vignette (image du plan le plus long) vont dans
`<data_dir>/analyses/<nom>/`, servis sous `analyse/runs/<nom>/`.

## 4. Vérifié

- `python3 tools/check.py` sur DGX2 : le selftest de `server/tools/analyse.py` passe (chiffres de
  Getaround et Wall, pages servies, refus avant lancement, analyse factice de bout en bout,
  progression par étapes, vidéo lue par morceaux à côté de la page).
- Instance d'essai `:8795`, Chromium sur DGX2 : l'accueil de l'outil ; le Studio Getaround
  (vidéo sur R2, readyState 4, saut à 12 s puis lecture, timeline, « corrections partagées :
  lues », aucune erreur de console) ; le Studio Wall (idem, 139 s) ; le parcours « Nouvelle
  analyse » dans la page (sélecteur de la bibliothèque, titre, lancement, carte « étape 2/11 »,
  carte finie) sur la chaîne factice avec `FAUX_DEPUIS=~/reelbench/runs/getaround` — les étapes 9
  et 9b y sont les vraies (`video-shots.mjs render`, `inline-frames.mjs`, `studio.mjs`) — et le
  Studio produit (vidéo locale, saut, lecture) ; la diarisation (en-tête du portail, « Portail ·
  relais · prêt », fichiers de dgx1 listés, démo Getaround chargée).

## 5. Pas vérifié

- La vraie chaîne lancée du portail (consigne : pas cette nuit ; elle est lourde).
- Une analyse Nemotron envoyée par le relais (l'état et la liste des fichiers passent ; l'envoi
  d'un fichier n'a pas été fait, pour ne pas occuper dgx1).
- L'écriture des corrections depuis le portail : le Worker la refuse (voir PROVENANCE).
