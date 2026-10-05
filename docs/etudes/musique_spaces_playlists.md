# Musique : les Spaces, les playlists et le lien d'écoute

Étude du 05/10/2026 au soir. RIEN N'EST CODÉ. **Décisions de Cal (05/10, « Cloudflare par défaut plus simple non ? tout
le reste est comme tu proposes ») : S1 partagé, S2, L1 Cloudflare, L2, L3 comme recommandé ci-dessous.**

## La demande de Cal (05/10)

> « dans musique on veut comme suno pouvoir travailler dans un workspace et que tout ce qu'on génère se crée
> dedans. le nom workspace est déjà pris pour l'interface générale donc on va prendre "space" à la place. on veut
> aussi un outil de playlist super cool. l'idéal serait même qu'on puisse exporter une playlist comme un lien
> internet qui est un lecteur comme on a fait pour mon album AGOSTA NIKOSTAKI et qui est sur github. réfléchis à
> cela »

## 1. Ce qui existe déjà

### Chez nous

- **Musique, l'app** (`chanson/`, `server/tools/chanson.py`) :
  - tout ce qu'elle fabrique est un objet de la bibliothèque : `tool: "chanson"`, dossier « Musique » ;
  - sa recette est dans `params.chanson` ; une variante la rejoue avec une autre graine ;
  - les stems ont `params.stem` et `params.src` ;
  - la liste (`GET /api/chanson/list`, `api_list`) montre les chansons de la personne seule (`owner == moi`), sans
    aucun rangement ;
  - la page : un rail à gauche (créer) et une scène (les cartes, avec forme d'onde).
- **Workspaces** (`server/core/espaces.py`) : le champ `space` d'un objet est DÉJÀ pris, c'est l'identifiant du
  Workspace (`esp-…`).
  - **Conséquence pour le code : le Space de Musique ne peut pas s'appeler `space` dans les données.** Nom de
    code proposé : `music_space`, identifiants `msp-…`. Le mot « Space » reste celui de l'interface.
- **ODIO** : la branche `wip/odio-session2` prévoit une « bibliothèque du projet » (`biblio`, la rubrique
  « Projet » du navigateur, `docs/etudes/odio_session.md` § 6). Les clips édités y restent au lieu d'encombrer
  Asset. Le Space se place AU-DESSUS : il range des chansons et des projets ODIO.
- **Transcrire** (`server/tools/transcrire_moteur.py`) rend les mots avec leur temps
  (`words: [[mot, début, fin]…]`, whisper `word_timestamps`). C'est de quoi caler des paroles en LRC sans
  saisie (§ 3.4).
- **La porte Cloudflare** (`porte/worker.js`, `porte/wrangler.jsonc`) :
  - le Worker est en service, en mode `code` ; le bucket R2 `showrunner-bibliotheque` est déjà lié (`BIBLIO`) ;
  - sa lecture partielle (Range, exigée par Safari) est déjà écrite ;
  - la recopie DGX2 → R2 (`porte/r2_recopie.py`, signature SigV4 en bibliothèque standard) est écrite et
    essayée. Elle attend le geste 9 de Cal dans `docs/etudes/cloudflare.md` : le jeton R2 dans
    `~/.config/showrunner/r2.json`.

### AGOSTA (`calculment0r/AGOSTA`, https://calculment0r.github.io/AGOSTA/)

- Un site statique sans build : `index.html`, `js/player.js` (592 lignes), `js/app.js` (425), `css/styles.css`,
  `manifest.webmanifest`, `service-worker.js`.
- Toute la configuration est dans `js/album-data.js` : titre, artiste, année, pochettes 1200/512, liste des
  morceaux (`file`, `lyricsFile` .lrc, `duration`).
- Ce qu'il sait faire :
  - un seul `<audio>` natif, plus la Media Session API : pochette, titre et boutons sur l'écran verrouillé ;
  - la lecture continue écran éteint ;
  - le karaoké LRC (ligne active centrée, toucher une ligne pour y sauter, plein écran) ;
  - PWA installable ;
  - un mode « un seul fichier continu » pour la fiabilité sur iPhone ;
  - la reprise de la position au rechargement.
- Comment il est publié :
  - par GitHub Actions (`.github/workflows/deploy-pages.yml`), à chaque poussée sur la branche ;
  - 14 MP3 dans le dépôt (142 Mo avec l'historique).
- Les temps des paroles ont été calés à la main par alignement forcé (aeneas + espeak), hors de Showrunner.

### Suno (pour la logique, pas pour copier)

- **Workspaces :**
  - on en crée un sous le champ du prompt, ou par le « + » à côté de « Workspaces » ;
  - on génère directement dedans ;
  - un remix va d'office dans le Workspace de l'original ;
  - on déplace d'anciennes chansons par lots (Maj+clic, puis clic droit, puis « déplacer »)
    [jackrighteous.com, « Streamline Your Songs with Suno AI's New Workspaces »].
- **Partage :**
  - une chanson est « Private / Link only » par défaut, et le lien suffit pour l'écouter ;
  - « Public » la met sur le profil et dans les playlists des autres [help.suno.com/en/articles/2565761].
  - Les playlists vivent sur le profil.
- Suno Studio (leur station audio, 25/09/2025) travaille dans les mêmes Workspaces
  [suno.com/release-notes/introducing-suno-studio]. C'est notre couple Musique / ODIO.

## 2. Les Spaces

### Le modèle

- Un **Space** (`msp-…`) est un dossier de travail de Musique, À L'INTÉRIEUR d'un Workspace.
- Il n'a pas de droits propres : il hérite de ceux du Workspace (`espaces.can_*`). La matrice des droits ne
  s'alourdit pas.
- Il a : un nom, une pochette facultative (un objet image), une couleur, une date, un auteur, et `archived`.
- Il est rangé dans `<data_dir>/chanson/spaces.json`, une table par Workspace.
- Un objet porte son Space dans un champ modifiable `music_space` :
  - à ajouter à la liste de `library.patch`, à côté de `folder` et `tags` ;
  - un objet sans ce champ est dans le Space par défaut ; on n'a jamais d'objet « sans Space », comme
    « Général » pour les Workspaces.
- Le Space par défaut de chaque personne dans chaque Workspace : « Mon Space ». Toutes les chansons
  d'aujourd'hui y tombent sans migration.

### Ce qui se crée dedans (le Space courant de la page)

| ce qui naît | son Space |
|---|---|
| une chanson (Rapide, Soigné, Reprendre, S'en inspirer) | le Space courant |
| une variante, une prolongation, une reprise d'une chanson | **celui de la chanson d'origine** (règle de Suno), même si on regarde un autre Space |
| des stems | celui de la chanson |
| un son de référence déposé, un MP3 importé (« Imports ») | le Space courant |
| une partition relue, des paroles écrites | dans la recette, donc avec la chanson |
| un projet ODIO ouvert depuis une chanson | celui de la chanson (ODIO montrera « Space : … » dans son navigateur, étape 2) |

### La page

- En haut du rail, sous le titre : **« Space : Album été ▾ »**, un menu avec les Spaces du Workspace,
  « + Nouveau Space », « Tous les Spaces ». C'est la place que Suno donne au sien, au-dessus du prompt :
  on sait toujours où va ce qu'on crée.
- La scène ne montre que le Space choisi. « Tous » montre tout, avec la pastille du Space sur chaque carte.
- **Déplacer :**
  - Maj+clic ou Ctrl+clic sélectionne plusieurs cartes ; « Déplacer vers… » ;
  - ou glisser des cartes sur un Space du menu ouvert ;
  - les stems suivent leur chanson.
- Le Space choisi est retenu par Workspace (préférence de page, `prefs.json`).

### DÉCIDÉ (Cal, 05/10)

**S1. Un Space est-il partagé avec le Workspace, ou personnel ? → PARTAGÉ (« Mon Space » reste personnel).**
- Aujourd'hui, la liste ne montre que mes chansons.
- Recommandation :
  - « Mon Space » reste personnel ;
  - un Space qu'on crée est **partagé avec le Workspace** : on y voit les chansons de tous ceux qui y ont
    créé. C'est le sens d'une Team qui fait un album ensemble.
- Le seul autre choix sensé : tout personnel, comme Suno.

**S2. Supprimer un Space (DÉCIDÉ) :**
- ses chansons repartent dans « Mon Space » de leur auteur ;
- rien ne va à la corbeille sans qu'on le demande.

### CODÉ (branche `wip2/spaces`, 05/10)

- **Le serveur** (`server/tools/chanson.py`, section « les Spaces ») :
  - `spaces.json` (une table par Workspace) ; `GET /api/chanson/spaces` ; `POST /api/chanson/spaces`
    (`action` : create, update — nom, couleur (un jeton), pochette, `archived` —, delete, restore) ;
    `POST /api/chanson/spaces/move` (`{ids, to}`, ou `{restore}` pour Ctrl+Z) ; `PUT /api/chanson/import`
    (`as=son` : une carte sans recette ; `as=ref` : une référence) ; `GET /api/chanson/list?space=mon|msp-…|*`.
  - **Juste par construction** : le Space d'un objet est son `music_space` s'il nomme un Space vivant de son
    Workspace, sinon « Mon Space » de son auteur (`space_of_item`). Supprimer (S2) ne réécrit aucun objet ; la
    fiche garde `deleted`, et « restore » la rend.
  - Une variante naît dans le Space de sa chanson (`birth_space`), des stems aussi (`music_stems._store`
    recopie le champ de la source) ; « Mon Space » d'un autre ne se vide pas par la route `move` (Cal, si).
  - Les droits : ceux du Workspace (créer : `library.check_create` ; changer : `check_write` ; supprimer :
    l'auteur du Space ou un admin du Workspace, `auth.can_trash_item`).
- **Le socle** : `library.update` accepte `music_space` (`MUSIC_SPACE_RX`, vide = « Mon Space »).
- **La page** : `chanson/spaces.js` (le menu, le « ⋯ », la sélection, glisser, importer) ; le contrat des
  volets voisins : `spaceCourant()` et l'événement `sr:music-space` (en tête du fichier). Pilote :
  `chanson/pilote_spaces.mjs`.
- **Reste** : ODIO dans les Spaces (étape 7) ; un son téléversé depuis le sélecteur commun (`pick`, bouton
  « Disque » de sa fenêtre) naît sans Space (« Mon Space »).

## 3. Les playlists

### Le modèle

- Une playlist est un **objet de la bibliothèque** de sorte `playlist`, un document vivant comme une planche.
  Elle a d'office le Workspace, les droits, la corbeille, Asset et la recherche.
- Elle tient :
  - titre, artiste affiché, année, description, pochette ;
  - les morceaux : un identifiant d'objet audio par morceau, avec sa surcharge de titre, de crédits et de
    paroles (texte ou LRC).
- Elle n'est PAS liée à un Space : elle prend des sons de tous les Spaces du Workspace. Le Space est l'endroit
  où l'on travaille, la playlist ce qu'on écoute et ce qu'on montre.
- Une playlist naît quand même dans le Space courant, pour qu'on la retrouve.
- Elle accepte **tout son de la bibliothèque**, pas seulement ce que Musique a généré : un morceau
  importé, un mix d'ODIO exporté, un stem. L'album AGOSTA doit pouvoir y entrer tel quel (§ 5, premier essai).

### L'outil (ce qui le rend « super cool »)

1. **Glisser des cartes de la scène vers la playlist**, ouverte en volet à droite ; réordonner en glissant.
   - durée totale toujours visible ;
   - « Écouter » joue toute la playlist dans la page, avec la barre de lecture.
2. **La pochette :**
   - une image de la bibliothèque, ou une mosaïque de 4 pochettes faite d'office ;
   - ou « Fais-moi une pochette » : une carte Image avec le titre et l'ambiance en prompt. Le rendu reste un
     geste de la personne.
   - La couleur dominante de la pochette donne la couleur du lecteur publié.
3. **L'ordre suggéré** : on a le tempo (`music_tempo.py`) et la tonalité (la recette, sinon `bpm.js`).
   - « Proposer un ordre » enchaîne par tonalités voisines (cycle des quintes) et par tempo qui monte puis
     redescend ;
   - la personne garde ou annule.
4. **Les paroles calées sans saisie** (le karaoké d'AGOSTA, mais tout seul) :
   - la voix seule (stem `vocals`, déjà fait ou demandé), puis Transcrire en mode mots (`--words 1`) ;
   - puis l'alignement des mots entendus sur les paroles connues (celles de la recette `params.chanson.lyrics`,
     sinon la transcription elle-même) par `difflib.SequenceMatcher` ;
   - on obtient un LRC par ligne, relu et corrigible dans un petit éditeur (toucher une ligne pendant
     l'écoute pour la recaler).
   - Ça remplace aeneas, qui n'est pas sur les DGX.
5. **Le volume égal** : à la publication, chaque morceau est mesuré, puis ramené à −14 LUFS intégrés (le niveau
   des plateformes de streaming) par `ffmpeg loudnorm` en deux passes. Une playlist faite de générations
   inégales sonne alors comme un album. L'original n'est jamais touché.
6. **Les enchaînements** : sans blanc (« gapless »), avec un fondu enchaîné réglable (0 à 6 s), ou en mode
   « un seul fichier continu » (celui d'AGOSTA, le plus sûr sur iPhone écran verrouillé). Ce mode est fabriqué
   au moment de la publication.

### Codé (05/10, branche `wip2/playlists`)

- La sorte `playlist` (`library.KINDS`, id `pla-…`) et ses routes : `server/tools/playlist.py` (selftest).
- Le volet de la page (`chanson/playlist.js`, `.css`) : glisser des cartes, réordonner (Alt + ↑ ↓), la durée
  totale en tête, « Écouter » (la barre du lecteur commun, `chanson/playlist_lecture.js` : sans blanc, fondu à
  puissance égale ; « un seul fichier » s'écoute comme sans blanc dans la page), par morceau titre, crédits,
  paroles.
- La pochette : une image, ou la mosaïque faite d'office (`commun/pochette.js`) ; « Fais-moi une pochette » :
  une carte Image dans le volet (le prompt relu, Générer = le geste de la personne, une image rendue devient la
  pochette d'un clic).
- « Proposer un ordre » : l'arc du tempo (sommet aux deux tiers, notre choix) et les tonalités voisines (la
  distance en quintes, plus 1 si le mode change), par échanges qui baissent le coût ; le tempo d'un son sans
  recette mesuré dans la page (`musique/tempo.js`, confiance ≥ 0,5) ; aucun détecteur de tonalité (non
  documenté) : une tonalité inconnue ne compte ni pour ni contre.
- La fiche d'Asset, « Ouvrir dans Musique » (`chanson/?playlist=<id>`). Le pilote : `chanson/pilote_playlist.mjs`.
- Attendent leurs branches : « Exporter en .zip » (`POST /api/ecoute/<id>/zip`) et « Caler les paroles »
  (`commun/lrc.js`, `ouvrirEditeurLrc`) — éteints, ils disent pourquoi.

## 4. Le lien d'écoute

### Le principe

UN lecteur, celui d'AGOSTA, généralisé, dans ce dépôt (`ecoute/` : `index.html`, `player.js`, `app.js`,
`ecoute.css`, manifeste, service worker). Il lit un `playlist.json` (le `album-data.js` d'AGOSTA, en données).

« Publier le lien » fabrique ce qu'il faut :
- les MP3 à 256 kbit/s, 44,1 kHz, au volume égal ;
- les LRC ;
- les pochettes 1200 et 512 et les icônes ;
- `playlist.json`.

Puis il l'envoie à une destination, et rend une adresse à copier. Republier met à jour **le même lien**.

Ce qu'on ajoute à AGOSTA :
- l'aperçu du lien (balises Open Graph : pochette, titre, artiste dans WhatsApp, iMessage, Slack) ;
- un morceau direct (`#3`) ;
- le bouton « Télécharger » seulement si on l'autorise ;
- la couleur de la pochette.

### Les trois destinations

| | **A. Cloudflare (R2 + Worker)** | **B. GitHub Pages (comme AGOSTA)** | **C. Fichier .zip** |
|---|---|---|---|
| adresse | `showrunner.luxigone.workers.dev/ecoute/<jeton>/` | `calculment0r.github.io/ecoute/<nom>/` | aucune, Cal l'héberge où il veut |
| DGX éteintes | marche | marche | — |
| retirer un lien | immédiat (on efface le préfixe R2) | le dossier disparaît du site au déploiement suivant, mais **reste dans l'historique git** du dépôt | — |
| taille | R2 : 10 Go gratuits, sortie gratuite | site Pages : 1 Go conseillé, 100 Mo par fichier ; un album de 14 morceaux ≈ 110 Mo, donc ≈ 9 albums | — |
| protéger par un code, date de fin | oui (le Worker décide) | non : public pour qui a l'adresse | — |
| compter les écoutes | oui (le Worker voit passer chaque morceau) | non | — |
| aperçu du lien | le Worker écrit les balises par playlist | un `index.html` par dossier | oui |
| ce que Cal doit faire une fois | le jeton R2 (geste 9 de `cloudflare.md`, déjà nécessaire pour la bibliothèque) | créer le dépôt `ecoute` (privé, Pages par Actions) et poser une clé de déploiement en écriture, limitée à ce seul dépôt, sur DGX2 | rien |
| ce qu'on code | une route `/ecoute/*` dans le Worker (GET seul, clés R2 sous `ecoute/<jeton>/` seulement, jeton aléatoire de 128 bits), ajoutée à `run_worker_first`, hors de la porte à code ; un envoi par `r2_recopie` | un `git push` du dossier vers `ecoute` depuis DGX2, plus le même workflow qu'AGOSTA | le même dossier, zippé |

### Recommandation

- **C d'abord** : il n'a besoin de rien, et il fabrique le lecteur que A et B publient. On l'essaie sur
  AGOSTA (§ 5).
- **A ensuite, comme bouton « Publier le lien »**, parce que :
  - on peut retirer un lien pour de bon ;
  - il n'y a pas de limite de taille ;
  - on peut mettre un code ou une date de fin, et compter les écoutes ;
  - l'adresse est celle de Showrunner ;
  - le jeton R2 est de toute façon à faire pour la bibliothèque hors DGX.
- **B en option**, pour qui veut son album sur GitHub comme AGOSTA, avec ses limites : 1 Go, et l'historique
  qui garde tout.

### DÉCIDÉ (Cal, 05/10)

**L1. Destination par défaut : A, Cloudflare.** B (GitHub Pages) reste une option pour plus tard, si Cal la demande.

**L2. Qui peut publier un lien ? (DÉCIDÉ)**
- Recommandation : `espaces.can_publish`, la règle existante. Un guest ne publie jamais.
- Le lien est public pour qui l'a, sauf si on met un code.

**L3. Le lien dit-il « Showrunner » ? (DÉCIDÉ : non)**
- Recommandation : non, le lecteur est à l'artiste.
- Une ligne discrète en pied de page, facultative.

## 5. L'ordre des travaux

1. **Spaces** :
   - `chanson.py` : `spaces.json` ; `music_space` dans `_store`, les stems et les variantes ; `api_list` filtré
     par Space ; les routes `GET/POST /api/chanson/spaces`, `POST …/move` ;
   - `library.patch` : accepter `music_space` ;
   - la page : le menu Space du rail, le filtre de la scène, la sélection multiple, « Déplacer vers… » ;
   - essais dans le `selftest` et Playwright.
2. **Playlists** :
   - la sorte `playlist` (bibliothèque, Asset) ;
   - le volet de la page : glisser, réordonner, durée, écouter, pochette ;
   - l'ordre suggéré.
3. **Le lecteur** `ecoute/` :
   - le code d'AGOSTA repris (même auteur, même portail) ;
   - les jetons de couleur de `commun/tokens.css` pour l'interface, et la couleur de la pochette en accent ;
   - l'export .zip ;
   - **premier essai : l'album AGOSTA** (14 MP3 + 13 LRC du dépôt `calculment0r/AGOSTA`) importé en playlist,
     exporté en .zip, puis comparé au site en ligne sur iPhone et Android avec la liste de contrôle du README
     d'AGOSTA (§ 9).
4. **Les paroles calées** : stems, puis Transcrire en mots, puis l'alignement, puis l'éditeur LRC. Essai sur
   les chansons d'AGOSTA, dont les LRC calés par aeneas servent de vérité : on mesure l'écart ligne par ligne.
5. **Le volume égal et les enchaînements** à la publication.
6. **La destination A** (route Worker, envoi R2, aperçu du lien, code, date de fin, compteur), après le
   jeton R2 de Cal. Puis B si Cal le veut.
7. **ODIO dans les Spaces** (étape 2) : la rubrique « Space » du navigateur d'ODIO, au-dessus de la
   bibliothèque du projet de `wip/odio-session2`.

## Sources

- AGOSTA : `README.md`, `CLAUDE.md`, `js/album-data.js`, `.github/workflows/deploy-pages.yml` du dépôt
  `calculment0r/AGOSTA` (lus le 05/10, commit 9f8c800).
- Suno, Workspaces : https://jackrighteous.com/blogs/guides-using-suno-ai-music-creation/streamline-your-songs-with-suno-ais-new-workspaces
- Suno, partage et visibilité : https://help.suno.com/en/articles/2565761
- Suno Studio : https://suno.com/release-notes/introducing-suno-studio
- Limites de GitHub Pages : https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits
  (site publié ≤ 1 Go, bande passante indicative 100 Go par mois) ; un fichier > 100 Mo est refusé par GitHub.
- R2, offre gratuite : https://developers.cloudflare.com/r2/pricing/ (10 Go-mois de stockage, sortie gratuite).
- Chez nous : `server/tools/chanson.py`, `server/core/espaces.py`, `server/core/library.py` (`patch`,
  `create_living`), `server/tools/transcrire_moteur.py`, `porte/worker.js`, `porte/wrangler.jsonc`,
  `porte/r2_recopie.py`, `docs/etudes/cloudflare.md` (geste 9), `docs/etudes/odio_session.md` § 6
  (branche `odio-session2`).
