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

## 6. Nos films dans le portail (29/09)

Cal : « tu as gardé l'ancienne page… il faut qu'on ait nos films Getaround et le Loup de Wall Street
car on les a déjà faits ». Jusque-là l'accueil de l'outil listait les deux films, mais leur Studio et
leur Dépouillement ouvraient les pages autonomes de MOVIE_ANALYSE : leur propre barre (« ← Accueil ·
MOVIE ANALYSIS »), leur palette Verdant écrite dans la page, leurs polices en base64, et le
dépouillement dans une seconde page (le rapport X—VERSE de `video-shots.mjs render`, clair par défaut).

### Le choix : une sortie « portail » de `studio.mjs`, rien d'autre

| manière | pourquoi non / oui |
|---|---|
| l'ancienne page dans une iframe du portail | refusé par Cal : l'ancienne page resterait, avec sa barre et son thème |
| réécrire le Studio en modules ES qui chargent les JSON | 2 500 lignes éprouvées (`voix.js`, `son.js`, le trombinoscope, la timeline, les corrections partagées) à retaper : c'est ainsi qu'on perd une fonction |
| deux sorties dans `studio.mjs` (autonome et portail) | deux vérités ; l'autonome est celle de MOVIE_ANALYSE, qui la publie de son côté (`C:\claude\MOVIE_ANALYSE`) |
| **`studio.mjs` du portail n'écrit plus que la page du portail** | le même générateur, le même script du Studio, les mêmes données : seul le cadre change |

La page d'un film (`analyse/analyses/<film>/index.html`, ou `analyse/runs/<nom>/` pour une analyse
lancée d'ici — toujours deux dossiers sous `analyse/`, donc les mêmes chemins relatifs) :

- charge `commun/tokens.css`, `base.css`, `shell.css`, puis `analyse/film/film.css`, et
  `analyse/film/film.js` (module : `mountHeader('analyse')`, la barre du film collée sous l'en-tête,
  l'icône). Plus aucun `<style>` dans la page, plus de barre X—VERSE, plus de `data-theme` ni de
  `xverse-theme` : sombre, sans bascule. Le cadre est partagé par tous les films : une retouche du
  thème ou de l'en-tête vaut pour tous sans rien re-rendre ;
- une barre du film dans le gabarit du portail : « ← Les films », le titre, **Studio · Casting ·
  Dépouillement** (trois vues d'une seule page, `?vue=casting|depouillement` dans l'adresse), **Voix ↗**
  (le labo de diarisation du film) ; `#S05` ouvre toujours sur le plan 5 ;
- garde le script du Studio tel quel (vidéo R2 et repli, frise, sous-titre mot à mot, action du plan,
  script qui défile et se corrige, timeline des voix avec glisser d'une piste à l'autre, Ctrl+Z, « Tout
  remettre », son VO/doublages et personnages coupés, paramètres avancés et exports, fiche du plan avec
  portraits et silhouettes, trombinoscope avec fusions, corrections partagées) ; seules les teintes
  changent de source : `voix.js`, `son.js` et le script lisent les jetons à l'exécution
  (`getComputedStyle`) ;
- les teintes d'identité (16 personnages, 8 voix Nemotron sans personnage, 8 rôles de rythme) sont
  **déclarées une fois**, en tête de `film.css` (`--pc-*`, `--pv-*`, `--ry-*`) : un jeton du portail
  quand il a la teinte (`--or`, `--cy`, `--grn`, `--verd-4`), sinon la teinte du kit que le Studio
  portait déjà. Hors de ce bloc, aucune couleur écrite — le `selftest` le vérifie sur `film.css`,
  `voix.js`, `son.js`, `studio.mjs`, `casting-parts.mjs`, et qu'il n'y a pas de `border` ;
- le **Dépouillement** est la table des plans du Studio (filtres, rôle, états cliquables, accordéon,
  CSV) plus ce que montrait le rapport de la chaîne, calculé des mêmes données : les chiffres (plans,
  durée, moyenne, médiane, min/max, coupes/min), la bande de rythme (teinte mesurée de chaque plan,
  clic = le plan dans la table), les répartitions (échelle, catégorie, mouvement, rythme, et la phrase
  de synthèse), les **portes qualité** calculées au rendu par la même fonction (`validate` de
  `video-shots.mjs`, sur le document corrigé, comme `corriger.mjs` + `render`), l'export JSON.
  `depouillement.html` ne fait plus que renvoyer à `./?vue=depouillement` (les liens d'avant) ;
- une seule action orange par vue : la lecture au Studio, « Appliquer » au Casting.

### Le rendu des deux films

`analyse/outils/rendre-films.sh` (node, sans GPU ni réseau, quelques secondes) suit la recette de
MOVIE_ANALYSE (`HANDOFF-MOVIE-ANALYSIS.md` §3) : les images (images clés, silhouettes SAM 3, **portraits
refaits à la main les 27-28/09**) sont ressorties de la page publiée elle-même (`outils/ressors.mjs`),
les données sont celles du dossier du film (`shots.json`, `corrections.json`, `diarisation.json`,
`mots.json`, `son.json`), la vidéo reste sur R2 avec son repli à côté. Les dossiers de calcul de DGX2
(`~/reelbench/runs/getaround`, `wall`) n'ont pas les portraits refaits : ils ne servent qu'à l'affiche
(ci-dessous) et au contrôle (leurs vidéos ont le même md5 que celles de MOVIE_ANALYSE, donc de R2).
Relancer le script sur une page déjà rendue rend la même page.

Comparé, ancienne page contre nouvelle, bloc par bloc (DGX2) : `DATA0`, `FRAMES`, `OVERLAYS`,
`PORTRAITS`, `VOIX` (diarisation, mots, son), `L`, `XV_CORR_URL`, `XV_PUBLIER_URL`, `XV_MEDIA`
**identiques** ; les portes égales au rapport publié (Getaround 12 passées · 2 en échec · 1 sautée ·
1 indice ; Wall 13 · 1 · 1 · 1) ; le script de la page se parse ; 1 536 → 1 364 Ko et 3 649 → 3 477 Ko
(les polices ne sont plus embarquées).

L'**affiche** des cartes « Nos films » : la vignette fait 480 px ; `affiche.jpg` est la même image
clé (S04a de Getaround, S05a de Wall : 15 % du plan, l'instant de `video-shots frames`) tirée en
1280 px par ffmpeg de `~/reelbench/runs/<film>/<film>.mp4` (29 et 48 Ko). Une analyse lancée d'ici a
la sienne (`_affiche`, plan le plus long).

### Une nouvelle analyse a la même forme

`chaine/analyse.sh` n'a pas changé : son étape 9b appelle `studio.mjs`, qui écrit désormais la page du
portail (`--report`, `--css` sont ignorés). `_publie` reconnaît la forme au marqueur que la page porte
en tête (`<meta name="sr-forme" content="portail">`), ne reprend plus le rapport-liste, et range
l'affiche. La chaîne factice rend sa page par le vrai `studio.mjs` quand node est là : le `selftest`
vérifie qu'une analyse lancée d'ici donne la page du portail, `?vue=depouillement` compris.
« Nouvelle analyse » accepte aussi le dépôt d'une vidéo (du disque : elle entre dans la bibliothèque,
catégorie Upload, `via: analyse` ; ou une vignette glissée d'ailleurs dans le portail) — la règle de
Cal du 29/09, `dropZone` de `commun/shell.js`.

### Vérifié (29/09, instance d'essai `:8795` sur une copie propre du dépôt de DGX2, Chromium sans affichage)

Pour chaque film : en-tête du portail (« Movie Analysis » allumé), barre du film collée ; palette lue
(`#e0674a`… : les `var(--…)` se résolvent) ; `#S05` ouvre sur S05 (6,74 s ; 26,34 s) ; vidéo lue sur
R2 (readyState 4, 1,46 s lues en 1,5 s) ; forme d'onde décodée ; zoom alt + molette (×2,44) ; clic dans
la timeline et dans la frise ; silhouettes ; « corrections partagées : lues » ; 8 et 11 pistes ; fiche
du plan avec 3 et 2 portraits et le calque SAM 3 ; Dépouillement (12 et 45 rangées, filtre
« dialogue », recherche, état cliquable, bande → le plan dans la table, portes, répartitions) ;
Casting (7 et 10 fiches, portraits) ; `?vue=depouillement` ; R2 coupé → la vidéo d'à côté se lit sans
message ; ni R2 ni fichier → « La vidéo ne se lit ni sur R2 ni à côté de cette page », script et
timeline intacts ; aucune erreur de console. Le banc de MOVIE_ANALYSE (`outils/banc/banc.mjs --base`,
sur le Chromium de playwright) : voir le rapport de la session du 29/09.

### Ce qui reste

- L'en-tête commun passe sur deux lignes à 1600 px depuis qu'il porte dix outils (« File » tombe
  dessous) : `commun/shell.css`, hors de ce chantier. Et `base.css` donne au corps la hauteur de la
  fenêtre, ce qui décroche une barre collante au-delà du premier écran : `film.css` le corrige pour les
  pages de film seulement (`body.film { height: auto }`).
- La page du labo de diarisation (Voix ↗) garde sa feuille à elle (copiée de MOVIE_ANALYSE), sous
  l'en-tête du portail.

## 7. Refonte du 29/09 (Cal : « pas dans l'interface générale, j'ai pas mes exemples déjà faits »)

### Ce que Cal ne voyait pas — constaté, pas supposé

- Les données sont les mêmes : `C:\claude\MOVIE_ANALYSE` est au commit `fa8d9d9` (copie lue sur DGX2), comme
  la copie du portail ; tous les `analyses/<film>/*.json` et vignettes ont le même md5 des deux côtés.
- Chromium sous `nico007`, 1600 / 1366 / 1100 px : les deux films étaient listés et leurs Studios lisaient la
  vidéo. Mais l'accueil de l'outil n'avait **rien de la grammaire du portail** (une page à sections A–E,
  un « héros »), et sa section « Les projets » affichait **« 0 projet créé — aucun projet »** : chez
  MOVIE_ANALYSE, Getaround et Wall **sont** les projets (`commun/projets.js`, `DU_DEPOT`) ; ici ils étaient
  à part, et la liste des projets disait qu'il n'y en avait pas.
- Le Worker (`movie-analysis-partage.luxigone.workers.dev`), depuis l'origine `http://192.168.10.247:8790`,
  dans un vrai navigateur : `GET /corrections/projets.json` → 200 `{}` (personne n'a créé de projet depuis la
  home de MOVIE_ANALYSE), `GET /corrections/getaround.json` → 200 (5 noms…), `wall.json` → 200 `{}`,
  `GET /videos` → 23 fichiers, `GET /video/getaround/getaround.mp4` en Range → 206. **La lecture passe.**
  L'écriture est refusée par son code : `worker.js` ligne 18 (`ORIGINES` : github.io, 127.0.0.1, localhost),
  ligne 33 (`peutEcrire`), lignes 142 et 148 (403 « origine non autorisée », avant toute écriture). Aucune
  écriture n'a été tentée pour le vérifier.

### Les écrans, et la page locale dont chacun part

| écran du portail | page locale (MOVIE_ANALYSE) |
|---|---|
| l'accueil de l'outil : « Projets », le fil (grille / liste, filtre, recherche, taille), une carte par projet avec son nom, sa ligne et ses étapes **Dépouillement** / **Voix** | `index.html` (`carteDepot`, `carteCreee`, `etape()`) ; la grammaire : `commun/fil.css` (Image, Vidéo) |
| « Nouveau projet » : le nom tout de suite, créé, ouvert | `index.html` (`#modale`, `PROJETS.creer`) |
| la fiche d'un projet, dans la visionneuse (molette, flèches, Échap) : 01 Dépouillement (fait, en cours, à lancer ; la commande à la main), 02 Labo des voix, Renommer, Supprimer (projet créé, pour de bon) ou Retirer / Restaurer (une analyse, fichiers gardés) | `projet/index.html` (textes repris, dont ceux de `confirm`) ; `analyse/projet/?id=` renvoie à `?projet=` |
| « ⋯ » et clic droit sur une carte, sur la barre d'un film, sur une réplique | `commun/menu.js` du portail ; la réplique : le menu de `voix.js` (`vxMenu`), mêmes entrées, plus « Corriger le texte » |
| le Studio, le Casting, le Dépouillement de chaque film | `analyses/<film>/index.html` (déjà rendus dans la forme du portail, §6) |
| le labo des voix | `outils/diarisation/index.html` ; le retour mène à la fiche du projet |

Le projet « à dépouiller » se lance **d'ici** (`POST /api/analyse/run {projet}` : le dossier de travail porte son
nom) — ce que `HANDOFF-MOVIE-ANALYSIS.md` §6.6 notait comme manquant.

### Ce qui s'écrit où (le Worker refusant le portail)

- **Les projets** : `<data_dir>/analyse/projets.json` ; la liste du dépôt partagé est **lue** et fusionnée comme le
  fait `commun/projets.js` (par projet, le plus récent `maj` gagne ; `supprime` gardé ; un masque `depot: true`
  retire une analyse de l'accueil). `GET /api/analyse/projets`, `POST /api/analyse/projets`, `POST
  /api/analyse/projets/<id>`.
- **Les corrections d'un Studio du portail** : `<data_dir>/analyse/corrections/<film>.json`, **seulement ce qui
  diffère** du fichier du film et du dépôt partagé (`PUT /api/analyse/corrections/<film>`) : une correction faite
  sur github.io continue d'arriver. La page lit fichier → dépôt partagé → portail, et dit pourquoi elle n'écrit
  pas là-bas (`XV_PARTAGE_REFUS`). « Publier sur GitHub » dit qu'il faut la page de MOVIE_ANALYSE, et y mène.
- Pour écrire aussi au dépôt partagé : à Cal d'ajouter l'adresse du portail à `ORIGINES` et de redéployer
  (`npx wrangler deploy`) — les corrections gardées ici ne remontent pas seules.

### Écarts dits

- Chez MOVIE_ANALYSE, `DU_DEPOT` marque Wall « Voix » à faire ; son `diarisation.json` existe (160 Ko) : le
  portail lit le fichier et montre « Voix » faite. Les chiffres (7 et 10 personnages) sont comptés sur les
  données, fusions comprises (`DU_DEPOT` écrit 8 et 16 : les fiches avant fusion).

### Vérifié (29/09, `/tmp/sr_ma_refonte`, port 8795, Chromium de DGX2, application locale servie sur 127.0.0.1:8811)

`tools/check.py` : 676 passés, 0 en échec (les nouveaux contrôles de `server/tools/analyse.py` : fusion avec un faux
dépôt partagé, créer / renommer / retirer / restaurer / supprimer, lancer depuis un projet, corrections
différentielles, rien d'écrit au dépôt partagé).
Dans la page : accueil à 1600 / 1366 / 1100 ; survol, clic droit ; fiche de Getaround (vidéo R2, readyState 4),
molette → Wall ; liste ; Nouveau projet → fiche ; « Lancer sur DGX2 » → vidéo de la bibliothèque → carte « en
cours, étape 5/11 » → faite → son Studio (vidéo à côté) ; Studio Getaround et Wall (vidéo R2 lue, S05), réplique
réattribuée par le menu commun → « enregistré dans le portail, pour tous », Ctrl+Z → défait, clic droit, EN ;
Casting (7 et 10 fiches), Dépouillement (12 et 45 plans, portes) ; labo (retour à la fiche, en-tête sur une
ligne). Aucune requête d'écriture vers le Worker (bloquées et comptées : zéro).
