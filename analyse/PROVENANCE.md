# Movie Analysis — d'où vient ce dossier

Rapatrié le 28/09/2026 (nuit) dans le portail, à la demande de Cal : « on a aussi le movie
analysis qu'on va rapatrier dans ce même projet, Diarisation ». Le banc NL n'est pas ici : il
devient une fonction de Movie Creator.

## La source

| | |
|---|---|
| dépôt | `calculment0r/MOVIE_ANALYSE` (clone du poste : `C:\claude\MOVIE_ANALYSE`) — **privé depuis le 19/09** |
| branche | `claude/new-session-forpe9` (celle que sert son GitHub Pages) |
| commit | `fa8d9d9` — 28/09 19:01, « Passation : videos sur R2 … » |
| arbre de travail | identique au commit (`git diff` vide ; les `skill/*` marqués « modifiés » ne le sont que par les fins de ligne, comme le dit son `HANDOFF-MOVIE-ANALYSIS.md`) |

Une autre session travaille dans `MOVIE_ANALYSE` : rien n'y a été modifié, tout a été **copié**.
Ses documents de reprise y restent et font foi pour l'histoire et les décisions :
`HANDOFF-MOVIE-ANALYSIS.md` (état au 28/09), `README.md`, `HANDOFF.md`, `HANDOFF-DIARISATION.md`,
`REPRISE.md` (§8 à §10 : diarisation, projets, voix).

## Ce qui a été copié

| ici | là-bas | |
|---|---|---|
| `analyses/getaround/`, `analyses/wall/` | `analyses/<film>/` | les pages publiées (Studio `index.html`, `depouillement.html`, autonomes : images et polices en base64) et leurs données (`shots.json`, `corrections.json`, `diarisation.json`, `mots.json`, `son.json`, `sceneflow.json`, doublages, `vignette.jpg`). **Depuis le 29/09 les pages sont re-rendues dans la forme du portail** (voir plus bas) : les données et les images sont celles-là, inchangées |
| `diarisation/index.html` | `outils/diarisation/index.html` | le labo Nemotron |
| `chaine/` | `skill/` | toute la chaîne (`analyse.sh`, `studio.mjs`, `voix.js`…, 51 fichiers) |
| `outils/banc/`, `outils/casting.mjs`, `outils/controle.mjs`, `outils/ressors.mjs` | `outils/…` | le banc d'essai du Studio, le recollage du casting, les contrôles, la ressortie des images d'une page |
| `outils/partage/worker.js`, `wrangler.jsonc`, `videos.mjs` | `outils/partage/` | le Worker du dépôt partagé et l'envoi des vidéos vers R2 — **pour mémoire** (voir plus bas) |
| `commun/projets.js` | `commun/projets.js` | lu par la page de diarisation (noms des projets) |

Ajouté ici : `index.html`, `accueil.js` (ex-`analyse.js` : la liste EasyPrivacy bloque tout chemin en `/analyse.js`), `analyse.css` (l'accueil de l'outil, dans le thème du
portail), `film/film.css` et `film/film.js` (le cadre de la page d'un film, 29/09),
`outils/rendre-films.sh` (re-rendre nos films), `analyses/<film>/portail.json` (titre accentué et genre, repris de `DU_DEPOT` dans
`commun/projets.js`), `diarisation/portail.css` (l'en-tête du portail sur la page),
`outils/faux/analyse.sh` (la chaîne factice des essais), ce fichier. Le serveur :
`server/tools/analyse.py`.

## Ce qui a été laissé

- **Les vidéos** : `getaround.mp4`, `getaround-zh.mp4`, `getaround-en.mp4`, `wall.mp4` — 37,0 Mo
  (le plus gros : 15,8 Mo). **Les pistes son** `analyses/getaround/son/{vo,zh,en}/*.m4a` — 19
  fichiers, 3,1 Mo. Elles sont toutes sur Cloudflare R2 et ce ne sont pas nos droits. Les pages les
  lisent sur R2 (`https://movie-analysis-partage.luxigone.workers.dev/video/<film>/<chemin>`) ;
  leur repli, le fichier posé à côté de la page, manque donc ici : si R2 ne répond pas, le Studio
  le dit et propose de charger le fichier depuis le disque (scénario, timeline, plans et
  silhouettes marchent sans).
- `index.html`, `projet/`, `commun/verdant.css` de MOVIE_ANALYSE : l'accueil de l'outil du
  portail les remplace ; les pages copiées embarquent leur propre feuille.
- `outils/partage/.wrangler/` (l'état local de `wrangler dev`, non versionné là-bas non plus),
  `.nojekyll`, `.gitignore`.
- Rien n'est au-dessus de 4 Mo : le plus gros fichier copié est `analyses/wall/index.html`
  (3,7 Mo). Taille du dossier : 9,7 Mo, 89 fichiers.

## Ce qui a été retouché dans les copies (et seulement ça)

- `analyses/getaround/index.html`, `analyses/wall/index.html` : le lien du labo
  `"labo":"../../outils/diarisation/?projet=…"` → `"../../diarisation/?projet=…"`.
- `chaine/studio.mjs` : la même adresse du labo, pour les pages rendues d'ici.
- `diarisation/index.html` : chemins (`../commun/projets.js`, `../analyses/…`), retour vers
  l'accueil de l'outil (`../`), l'en-tête du portail (`tokens.css`, `shell.css`, `portail.css`,
  `mountHeader`), une machine de plus, **« Portail · relais »** (choisie par défaut), et le direct
  refusé sur ce relais avec la raison.
- `outils/casting.mjs` (`../chaine/casting-parts.mjs`), `outils/banc/banc.mjs`
  (`chaine/serve.mjs`), `outils/controle.mjs` (à lancer depuis `analyse/` : les analyses et
  `diarisation/index.html` ; plus l'accueil ni `.nojekyll`).

### Le 29/09 : nos films dans le portail (Cal : « tu as gardé l'ancienne page »)

Le Studio n'est plus une page autonome : `chaine/studio.mjs` n'écrit plus que **la page du portail**
(thème et en-tête communs, `film/film.css` et `film/film.js`, Studio · Casting · Dépouillement dans une
page, Voix vers le labo) — l'autonome reste celle de MOVIE_ANALYSE, qui la publie de son côté. Le
pourquoi et les preuves : `docs/etudes/analyse.md` §6. Retouché :

- `chaine/studio.mjs` : le gabarit (plus de `<style>`, de polices embarquées, de barre X—VERSE, de
  bascule de thème, d'iframe), le Dépouillement enrichi de ce que montrait le rapport (chiffres, bande de
  rythme, répartitions, portes qualité par `validate` de `video-shots.mjs`), `?vue=`, les teintes lues
  dans les jetons ; le script du Studio est le même ;
- `chaine/voix.js`, `chaine/son.js` : les couleurs du canvas et des pastilles lues dans les jetons
  (`VXC`, `PALETTE('--pv-', 8)`) au lieu d'être écrites ;
- `analyses/getaround/index.html`, `analyses/wall/index.html` : re-rendues par `outils/rendre-films.sh`
  (mêmes données, mêmes images, vérifié bloc par bloc) ; `depouillement.html` ne fait plus que renvoyer
  à `./?vue=depouillement` ; `affiche.jpg` ajoutée (l'image clé de la vignette, en 1280 px) ;
  `portail.json` : `forme: portail` ;
- `outils/banc/banc.mjs` : `--base <url du portail>` et `PLAYWRIGHT=<package.json>` (le Chromium de DGX2) ;
  `outils/controle.mjs` : une page de film du portail peut charger les feuilles communes et les deux
  polices Google, pas de `<style>` ; `outils/casting.mjs` : ignore le renvoi `depouillement.html` ;
  `outils/faux/analyse.sh` : rend sa page par le vrai `studio.mjs` quand node est là.

`chaine/voix.css` n'est plus lu (ses styles sont dans `film/film.css`) ; `chaine/report.js`,
`report.css` restent pour `video-shots.mjs render` (le rapport-liste de la chaîne, que le portail ne
publie plus).

Fins de ligne : le clone du poste est en CRLF ; le `.gitattributes` du portail range tout en LF.
`video-shots.mjs` était gardé en CRLF dans MOVIE_ANALYSE pour que le rendu y reproduise les pages
publiées au bit près : ce n'est plus vrai pour la copie d'ici.

## Le dépôt partagé (Worker Cloudflare) reste celui de MOVIE_ANALYSE

`https://movie-analysis-partage.luxigone.workers.dev` (Worker `movie-analysis-partage`, KV
`PARTAGE`, bucket R2 `movie-analysis-videos`) : corrections de chaque film, liste des projets,
vidéos. Il se déploie **depuis MOVIE_ANALYSE** (`cd outils/partage && npx wrangler deploy`, session
Cloudflare de Cal). La copie de `outils/partage/` ici n'est que pour mémoire : la déployer d'ici
écraserait le même Worker.

Lecture : ouverte à tous (vidéos, corrections, `projets.json`) — le Studio et l'accueil de
l'outil les lisent depuis le portail (vérifié : « corrections partagées : lues », vidéo R2 lue et
sautée).

Écriture (`PUT /corrections/…`, `POST /publier/…`) : seulement si l'en-tête `Origin` est
`https://calculment0r.github.io` ou `http://127.0.0.1|localhost(:port)`. Depuis le portail
(`http://192.168.10.247:8790`, `http://100.108.108.65:8790`) le Worker répond **403** : une
correction faite dans un Studio du portail n'atteint pas le dépôt partagé, la page garde ce qui
n'est pas parti dans le navigateur (son bandeau « Les partager / Les oublier »).

Pour que le portail écrive, **à décider par Cal** :

1. ajouter ses origines à `ORIGINES` dans `MOVIE_ANALYSE/outils/partage/worker.js`
   (`/^http:\/\/(192\.168\.10\.247|100\.108\.108\.65):8790$/`) et redéployer ; ou ouvrir le
   portail par un tunnel sur `http://127.0.0.1:8790`, déjà autorisé ;
2. savoir que ce filtre n'est pas une authentification : l'en-tête `Origin` se forge hors d'un
   navigateur. C'est l'état actuel du Worker, pas une nouveauté du portail ; la porte Cloudflare
   du portail (`docs/etudes/cloudflare.md`) devra le traiter.

## La diarisation

Le service Nemotron tourne sur **dgx1** (`diarisation.service`, `127.0.0.1:8448`, publié dans le
tailnet sur `https://dgx1.tail6c4306.ts.net:10002/diarisation`). Vérifié depuis DGX2 le 28/09 :
`/etat` → prêt, `nvidia/Nemotron-3-Diarization`, NVIDIA GB10, 8 voix, flex_attention compilé,
transcription possible. Le portail n'y touche pas : il le lit et le relaie
(`/api/analyse/diar/…` : état, fichiers, analyse, travaux) — le poste n'a pas besoin de
Tailscale. Le relais ne porte ni le **direct** (un WebSocket) ni la **lecture** d'un fichier pris
sur la machine (`/media`) : pour eux, dgx1 en direct (Tailscale sur le poste) ou le tunnel
`ssh -N -L 8448:127.0.0.1:8448 dgx@192.168.10.205` puis « Poste · tunnel ».

## La chaîne depuis le portail

« Nouvelle analyse » lance `chaine/analyse.sh` (la copie d'ici, réglage `analyse_skill`) sur DGX2
dans `~/reelbench/runs/<nom>/` — voir `server/tools/analyse.py` et `docs/etudes/analyse.md`.
`~/reelbench/skill` sur DGX2 date du 18-19/09 : `analyse.sh` y est identique, mais 9 scripts
diffèrent (`studio.mjs`, `reid-face.py`, `video-shots.mjs`…) et 19 manquent (`voix.js`, `son.js`,
`teintes.py`…). C'est pourquoi le portail prend sa propre copie, à jour, et ne touche pas à
`~/reelbench/skill`.
