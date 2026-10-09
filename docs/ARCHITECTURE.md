# Architecture — le contrat entre les outils

Tout outil du portail suit ce contrat. Il est court exprès : un outil
qui le tient se branche sur la bibliothèque, la file et l'en-tête sans
rien demander aux autres.

## 1. Le dépôt

```
index.html, accueil.js      l'accueil du portail (cartes des outils, compte, machines)
commun/                     tokens.css, base.css, shell.css, shell.js, porte.js/.css (la porte), fonts/ ;
                            theme.js, prefs.js/.css/.json, theme.html (l'éditeur de thème), undo.js,
                            proxies.js, menu.js/.css, fil.js/.css, wire.js/.css, entrees.js/.css, split.js,
                            refs.js, molette.js, fenetre.js/.html/.css, pleinecran.js, tete.js/.css,
                            lecteur.js/.css, dock.js/.css, documents.js/.css, telephone.js/.css, apercu.js (§ 4)
asset/ image/ movie/ …      une page par outil : index.html + <outil>.js + <outil>.css
admin/                      la page de Cal (§ 9) ; sa vue d'ensemble, le tableau de bord de chacun (tableau.js, § 11)
media/                      l'image et la vidéo des grandes cartes de l'accueil
porte/                      le Worker de l'adresse publique, sa configuration, son essai (§ 8)
ecoute/                     le lecteur du lien d'écoute (celui d'AGOSTA généralisé) : le gabarit de chaque paquet (§ 7)
server/showrunner.py        le serveur (stdlib) : pages, /api, /library/<id>/<fichier>
server/core/                config, http, auth, library, jobs, machines, comfy — le socle
server/tools/<outil>.py     les routes et les travaux d'un outil : register(app)
server/workflows/           les graphes ComfyUI au format API propres au portail
tools/check.py              le contrôle sans GPU (socle + selftest de chaque outil)
tools/faux_comfy.py         un faux ComfyUI pour essayer la file sans rien calculer
tools/faux_ollama.py        un faux Ollama (l'agent Showrunner d'Idéation, sans modèle) : outils scénarisés, sorties JSON
tools/portail_essai.py      un portail d'essai jetable (session cloud, agent) : sans porte, moteurs factices (§ 6)
tools/pilote_telephone.mjs  le pilote du téléphone (§ 4, « Le téléphone ») : les pages au doigt, sur un portail d'essai
tools/presentation_export.mjs  l'impression d'une présentation d'Idéation par Chromium sans affichage (PDF, PNG : § 7) ; sa vidéo MP4 (06/10)
docs/                       REPRISE, ARCHITECTURE, études
```

## 2. La bibliothèque (« Asset »)

Un objet = un dossier `<data_dir>/library/<id>/` avec `item.json`, son
fichier et sa vignette. Huit sortes (`library.KINDS`) : `image`, `video`,
`audio`, `element`, depuis le 29/09 `midi` et `sequence`, depuis le 05/10
`document` et `playlist` :

- `midi` (id `mid-…`) : un clip de notes, un fichier MIDI standard (`.mid`,
  format 0) écrit et lu par le serveur seulement (`server/tools/music_midi.py`,
  une seule vérité) — rangé par ODIO (un motif, une extraction) ou déposé ;
  `params` : `bpm`, `sig`, `notes`, `bars`, `lo`, `hi`, `channels`, `drums`,
  `method`, `engine`. ODIO les range dans le dossier « MIDI ». Ses notes, en
  noires : `GET /api/music/midi/<id>/notes`. Dans Asset : sa portée, sa fiche
  (les notes dessinées, une écoute par un synthé de la page, le clip à
  glisser dans l'arrangement d'ODIO) ;
- `playlist` (id `pla-…`, 05/10) : une playlist de Musique, `playlist: {artist, year, description,
  cover, tracks: [{item, title?, credits?, lyrics?, lrc?}], transition: {mode: gapless | crossfade |
  single, crossfade_s}, download}` dans `item.json` ; son outil : wip2/playlists ; son lien
  d'écoute : `server/tools/ecoute.py` (§ 7) ;
- `sequence` (id `seq-…`) : une séquence du Montage, sa timeline dans
  `sequence.json` (`server/tools/montage.py`) ; `item.json` suit la timeline
  (titre, taille, cadence, durée, `params.clips`, `params.format`, lignée =
  les plans employés, vignette = le premier plan qui se voit). Elle se range,
  se renomme, part à la corbeille comme les autres ; le Montage l'ouvre par
  `montage/#<id>` (la fiche d'Asset y mène) ;
- `document` (id `doc-…`, 05/10, `server/tools/documents.py`) : tout ce qui n'est
  ni une image, ni une vidéo, ni un son, ni un clip MIDI — un PDF, un DOCX, un
  texte, un tableur, un fichier inconnu —, rangé tel quel (`main.<ext>`) ; son texte
  page par page (`text.json`), une couverture toujours (la première page, la
  vignette du fichier, sinon une carte dessinée) ; `doc: {format, label, pages,
  unit, words, has_text, title, via, needs_page, why}`, et dans l'objet public
  `text_url` et `doc.page_urls` (les pages rendues par poppler). Un PDF que le
  serveur ne sait pas lire (poppler absent : `needs_page`) est lu par la page
  (`commun/documents.js`, pdf.js) qui lui dépose texte et couverture. Servi sans
  risque (`library.serve_policy`) : ce qui pourrait s'exécuter part en pièce jointe.
  Une image d'un format que les outils ne lisent pas (TIFF, GIF, BMP, PSD… :
  `EXOTIC`) devient une `image` en PNG si PIL la lit, l'original gardé à côté
  (`source.<ext>`) ; sinon un document.
- `playlist` (id `pla-…`, 05/10) : une suite de sons de Musique
  (`server/tools/playlist.py`, étude `musique_spaces_playlists.md` § 3), un objet
  qu'on réécrit en place, sans fichier ; tout est dans `item.json`, champ
  `playlist` : `{artist, year, description, cover: <id d'image> | null, tracks:
  [{item: <id audio>, title?, credits?, lyrics?, lrc?}], transition: {mode:
  gapless | crossfade | single, crossfade_s: 0..6}, download}` (le contrat que lisent
  le lecteur d'écoute et les paroles calées), plus `music_space` (le Space où elle
  est née, null : « Mon Space »), `rev`, `duration` (les morceaux présents), lignée
  = ses sons, vignette = celle de sa pochette (sans pochette : la mosaïque de ses
  premiers morceaux, peinte par la page, `commun/pochette.js`). Routes :
  `GET /api/playlist/options`, `GET|POST /api/playlist`, `GET|POST /api/playlist/<id>`
  (`base_rev`, 409), `POST /api/playlist/<id>/ordre` (« Proposer un ordre », rien
  n'est écrit). Musique l'ouvre dans son volet par `chanson/?playlist=<id>` ; le volet la partage
  (« Exporter en .zip », « Publier le lien » : les routes du lien d'écoute, § 7).

```jsonc
{
  "id": "ima-20260928-212233-a1b2",
  "kind": "image",                 // image | video | audio | element | midi | sequence | document
  "title": "…", "created": "iso", "updated": "iso",
  "file": "main.png", "thumb": "thumb.jpg",
  "width": 1024, "height": 1024, "duration": 5.04, "fps": 24,   // selon la sorte
  "origin": {"tool": "image", "job": "job-…", "machine": "DGX2", "model": "krea2"},
  "prompt": "…", "params": {…},    // de quoi refaire l'objet
  "parents": ["id", …],            // la lignée : l'image éditée, la première image d'une vidéo…
  "tags": [], "folder": "", "fav": false
}
```

Un **élément** est une entité réutilisable faite de références nommées :

```jsonc
{
  "kind": "element",
  "element": {
    "type": "character",           // character | object | place | style | other
    "description": "prose lue par les modèles",
    "refs": [{"file": "ref-01.png", "role": "face", "label": "visage", "item": "ima-…"}, …],
    "source": {"tool": "character-factory", "slug": "mj-survet", "open": "http://…"}
  }
}
```

Rôles de référence en usage : `face`, `full body`, `expression`, `outfit`,
`view`, `detail`, `style`, `sheet` (09/10 : la planche d'un objet pour H3). Un
outil qui prend des références accepte indifféremment une image ou un élément
(`library.ref_paths(item, roles)` rend les fichiers dans l'ordre).

Un **objet** d'Object Creator (`type: object`, 09/10, `server/tools/objet_vues.py`,
`docs/etudes/objet_scenes_3d.md`) porte en plus : ses vues gardées en références
`view` avec leur angle (`az` : l'azimut depuis la face, vers la GAUCHE de l'objet —
90° voit son côté gauche, la convention de Pixal3D ; `el` : 0, 30, 60, 90) ; sa
planche en référence `sheet` ; `meshes[]` (les GLB) et, par mesh, `rendus[]` (ses
rendus : `{file, az, el, label, thumb}`) ; `vues` (le plan : l'image choisie et son
angle, les passes, une place par vue — `{id, az, el, pass, state, job, items, ref,
pick, from, seed, why}` —, la face du modèle 3D), **déduit à chaque lecture** de
l'élément et de la file (une vue n'est gardée que si sa référence est là) ; `classe`
(ce que montre l'image : objet, bâtiment, décor, intérieur, personnage, dite ou
proposée par le modèle qui voit). Vidéo envoie à H3 sa planche puis ses vues, quatre
images au plus (`movie.object_parts`).

La page reçoit chaque objet par `library.public()` : avec `url`,
`thumb_url` (relatives à la racine du portail), et pour un élément
`element.refs[].url`. Une image (et l'affiche d'une vidéo) a aussi ses
**copies d'affichage** (29/09, `docs/etudes/ideation_fluidite.md`) : des WebP
de 256, 512, 1024 et 2048 px de grand côté, jamais plus grandes que
l'original, faites au rangement (et rattrapées au démarrage par le travail
`library.views`, priorité basse) ; l'objet public dit lesquelles existent :
`views: [256, 512, …]` et `view_urls: {"256": "library/<id>/view-256.webp?v=…"}`
(adresses versionnées, gardées un an par le navigateur). Une page ne pose
jamais une vignette à la main : `commun/proxies.js` choisit la copie qui
suffit (§ 4).

Deux copies de plus, faites au rangement par une accroche d'une ligne de
`library.add_file` (sinon à la première demande de la page : le rattrapage),
emportées par la corbeille avec l'objet :

- un **son** a son visuel (30/09, `server/tools/apercu_son.py`) : sa forme
  d'onde, un masque PNG de 1200 × 160 (`wave.v1.png`, une voix d'élément :
  `<fichier>.wave.v1.png`) calculé une fois — ffmpeg décode le son, le serveur
  prend le pic de chaque colonne et normalise sur le plus grand, PIL dessine ;
  la page le peint avec un jeton (`mask-image`), dans les deux thèmes, sans
  couleur en dur. Les pics eux-mêmes (`GET /api/son/pics/<id>`) servent l'onde
  d'attente. Et son **onde précise** (06/10, `docs/etudes/onde_spectre.md`) : le
  son décodé une fois à sa fréquence, une pyramide de paires (min, max) exactes
  (`onde.v2.bin`) et une copie mono sans perte (`onde.v2.flac`, ≈ 1,5 Mo par
  minute) d'où se lisent les échantillons ; faite à la mise en bibliothèque (une
  file, `nice`), sinon à la première demande ; la piste son d'une vidéo aussi ;
- une **vidéo** a sa copie de défilement (30/09, `server/tools/defilement.py`) :
  H.264 960 px au plus, une image clé toutes les 6 images, sans images B ni son,
  les temps de l'originale (`defil.v1.mp4`, une copie à la fois, au
  processeur ; rien au-delà de 30 min). Le lecteur commun la montre pendant
  qu'on déplace la tête (un saut ne décode jamais plus de 6 images : 8 à 11 ms
  au lieu de 156 à 850, mesuré le 30/09 dans Chromium), puis repasse sur
  l'originale (§ 4).

Un **son** peut porter ses **paroles calées** (05/10, `server/tools/paroles.py`) : `lrc`, un
texte LRC (`[mm:ss.cc]ligne`, 100 000 signes au plus), changé par `library.update` comme un
titre (refusé sur une autre sorte) ; la route des paroles le relit et le remet au format.

Un **élément versionné** (30/09, `server/tools/elements.py`,
`docs/etudes/apps_studio_elements.md`) relie une SOURCE vivante (un projet
ODIO `mus-…`, une séquence `seq-…`, une planche d'Idéation `ide-…`, ou la
recette d'un objet) à ses VERSIONS : des objets ordinaires, immuables, marqués
`version: {of, n}` ; l'élément porte `element.source`, `versions` et `media`
(l'objet public y ajoute `head`, la dernière version prête et présente), et ses
sortes s'ajoutent à celles des planches (`library.VERSIONED_TYPES` : `music`,
`sound`, `sequence`, `picture`). Un USAGE (un plan, un clip d'ODIO, un
nœud d'Idéation) pose l'identifiant d'une version : il est épinglé par
construction, et les usages se lisent dans les documents eux-mêmes. Une version
posée ne part pas à la corbeille (le garde de `library.trash` nomme ses usages) ;
un document qui se poserait dans sa propre descendance est refusé, la chaîne
nommée (`check-use` pour la page, `check_doc` à l'enregistrement). Chaque geste
s'écrit au **journal numéroté** (`<data_dir>/elements/journal.jsonl` : `el.created`,
`el.published`, `el.withdrawn`, `el.ready`…), chaque ligne portant son Workspace :
une page ne lit que ceux du sien.

### Routes

| | |
|---|---|
| `GET /api/library?kind=image,element&q=&folder=&sort=new&limit=&offset=&fav=1&tool=` | `{items, total, counts, folders}` |
| `POST /api/library/batch {ids: […]}` | les fiches de 2000 objets au plus en une requête, dans l'ordre : `{items, missing}` (absent ou invisible, sans dire lequel) |
| `GET /api/library/<id>/view?w=256…2048` | la copie d'affichage de cette taille, ou la plus proche au-dessus, ou l'original (ETag, 304) |
| `POST /api/library/views {ids?, force?}` | relancer le rattrapage des copies (admin) : le travail `library.views` |
| `GET /api/library/<id>` | l'objet |
| `GET /api/library/<id>/texte` · `POST {pages: [{n, text}], thumb?, count?}` | le texte d'un document page par page (`{format, title, text, pages, truncated, has_text, via, why}`) ; ce que la page a lu d'un document sans texte (un PDF que le serveur n'a pas su lire), par qui peut écrire l'objet (`server/tools/documents.py`) |
| `PUT /api/library/upload?name=a.png&title=&folder=&tool=` (corps = le fichier) | l'objet créé |
| `POST /api/library/<id>` `{title, tags, folder, fav, element:{type, description, refs}}` | mise à jour |
| `POST /api/library/<id>/delete` · `/restore` | corbeille, retour |
| `POST /api/elements` `{title, type, description, refs:[{item, role, label}]}` | un élément |
| `POST /api/elements/<id>/refs` `{item, role, label}` | ajoute une référence |
| `POST /api/elements/<id>/part {file}` | une partie d'un élément (une image de sa planche) en objet de la bibliothèque, pour la poser seule (Idéation, 05/10) : l'image d'où venait la référence, sinon une image neuve, fille de l'élément, que la référence retient (`server/tools/core_api.py`, `el_part`) |
| `POST /api/elements {title, type, source: {tool, doc}}` ou `{from_item, note}` | un élément versionné, sans version (d'une source) ou dont l'objet devient la v1 sans être recopié |
| `GET /api/elements?source=<doc>` · `GET /api/elements/<id>` | les éléments (d'une source) avec leur état ; l'élément, sa pile, sa source, ses usages |
| `POST /api/elements/<id>/versions {item, rev?, note?}` · `…/versions/<n> {state?, note?}` | publier (l'objet devient la v n+1) ; retirer (`withdrawn`), remettre (`ready`), annoter |
| `POST /api/elements/status {items}` · `GET /api/elements/uses?doc=` · `POST /api/elements/check-use {el \| item, doc}` | pour une page : la version et la dernière de chaque objet ; les usages d'un document et leur pastille ; poser ici ferait-il une boucle (`{ok, why, chain}`) |
| `GET /api/elements/changes?since=<seq>` | le journal numéroté après `seq`, celui du Workspace : `{seq, events}` |
| `GET /api/son/apercu/<id>[?voix=k][&v=1]` · `GET /api/son/pics/<id>` | le masque de l'onde (PNG, gardé un an avec `v=1`) ; les pics `{bps, n, b64}` (l'onde d'attente depuis le 06/10) — jugés par l'objet (qui le voit voit son onde) |
| `GET /api/son/onde/<id>[?voix=k][&v=2]` · `…&niveau=k&de=i&n=m` | l'onde précise (06/10, `docs/etudes/onde_spectre.md`) d'un son, d'une voix d'élément ou du son d'une vidéo : l'en-tête `{pret, sr, n, peak, b0, f, niveaux}` (pas prête : `{pret: false, attente}`, le calcul passe en tête de sa file) ; les paires (min, max) `i` à `i+m` du palier `k` (64 × 4^k échantillons), en octets (int16 petit-boutiste, 65 536 paires au plus) — jugées par l'objet, gardées un an avec `v=2` |
| `GET /api/son/echantillons/<id>?de=i&n=m[&voix=k][&v=2]` | les échantillons `i` à `i+m` (mono, int16, à la fréquence du son ; 262 144 au plus), lus dans la copie sans perte : les mêmes que la pyramide, à l'échantillon près |
| `GET /api/defil/<id>` | la copie de défilement : `{ready, url, pending, why}` ; pas prête, la demande passe en tête de sa file et la page redemande |
| `GET /api/defil/<id>/son` | le son de défilement (06/10) : le son seul d'une vidéo ou d'un son, mono, 22 050 Hz (11 025 au-delà de 10 min), FLAC (`defil-son.v1.flac`), fait à la première demande : `{ready, url, sr, why}` — les grains de `commun/scrub.js` |
| `GET /api/cf/characters` · `POST /api/cf/import {slug}` | Character Factory → élément |

## 3. La file des rendus

Un outil déclare ses travaux dans `register(app)` :

```python
from core import jobs, library

def run(ctx):                      # tourne dans un ouvrier de la voie
    ctx.progress(0.1, "prépare")
    ref = ctx.comfy.upload(path)   # l'instance ComfyUI de l'ouvrier
    outs = ctx.run_graph(graph, label="Krea 2")   # attend, s'arrête si Cal arrête
    for p in outs:
        ctx.add(p, kind="image", title="…", prompt="…", params=ctx.params,
                parents=[…], origin={"model": "krea2"})   # → bibliothèque + résultat du travail
    return {"note": "…"}           # fusionné dans job.result

def register(app):
    # family : la famille de modèles (les noms de FAMILY_GB, Character_Factory/factory/memory.py),
    # ou une fonction(params) ; gpu : s'il passe vraiment par ComfyUI (False pour un moteur factice) ;
    # cost : ce qu'il consomme — gpu | api | cpu | none, ou une fonction(params) — la garde du calcul (§ 10)
    jobs.register("image.generate", run, lane="image", title="Image",
                  family=lambda p: p["model"], gpu=lambda p: backend() == "comfyui",
                  cost=lambda p: "gpu" if backend() == "comfyui" else "cpu")
    app.route("GET", "/api/image/models", lambda req: {...})
```

Voies (`showrunner.local.json` → `lanes`) : `image` (ComfyUI :8188 de
DGX2 et de DGX1), `h3` (la recette de Cal sur les ComfyUI :8188 des deux DGX
depuis le 30/09 ; le défaut du code reste ComfyUI-H3TEST :8189, arrêté au
repos, démarré à la demande), `audio`, `cpu` (ffmpeg…, `ctx.comfy` vaut
`None`). Un ouvrier par instance ; une instance qui ne répond pas ne prend
rien.

**L'ordonnanceur** (`core/jobs.py`, `core/machines.py`) : qui part, et où,
ne se décide qu'à un endroit (`_choose`, sous le verrou de la file) :

1. l'ordre : épinglés en tête (Cal), priorité (haute, normale, basse),
   puis le tourniquet — le n-ième travail en file d'une personne se range
   après le dernier n-ième des autres ; Cal glisse un travail où il veut ;
2. qui peut partir : ni la file ni la machine en pause ou en vidange,
   l'instance épinglée (`pin`), pas plus de travaux simultanés que le
   quota de la personne ;
3. le modèle : une instance qui a déjà la famille chargée prend d'abord un
   travail de cette famille parmi les `group_window` (4) premiers ; un
   travail n'est pas doublé plus de `max_overtake` (3) fois ; un travail
   qu'une autre instance libre, qui a son modèle, prendrait tout de suite
   lui est laissé ;
4. le GPU : un seul travail GPU du portail par machine
   (`gpu_jobs_per_machine`) ; rien tant qu'un rendu qui n'est pas du
   portail tourne sur une instance de la machine — le `client_id` rendu par
   `/queue` de ComfyUI dit à qui il est (`showrunner-…` le portail,
   `usine-…` le studio) ; juste avant de partir : l'instance est vidée
   (`/free`) si elle garde une autre famille (ou si on ne sait pas), la
   mémoire libre est lue ; il en manque : on vide les autres instances de
   la machine dont la file est vide, puis on attend en le disant (règles
   de `Character_Factory/factory/memory.py`). Un travail plus gros que la
   machine échoue en le disant.

Quotas (par personne : simultanés, en file, par jour ; un total en file) :
429 au-delà, avec la raison. Les durées mesurées (sorte, famille, taille)
font l'estimation (`durations.json`) et le départ estimé de chacun.

| | |
|---|---|
| `POST /api/jobs {kind, params, title, tool}` | le travail, `state: queued` (429 : quota) |
| `GET /api/jobs?active=1&tool=` · `GET /api/jobs/<id>` | l'état (`queued running done error cancelled interrupted`), `progress`, `message`, `result.items`, `items` (objets complets), `owner`, `owner_name`, `mine`, `can`, `position`, `ahead`, `eta_s`, `est_s`, `family` ; la liste porte aussi `ev_seq`, le dernier numéro du journal des éléments dans le Workspace de la requête (§ 2, `elements.seq_here`) |
| `GET /api/queue` | la file de tous : `running`, `queued` (dans l'ordre), `done` (les miens), `paused`, `machines` |
| `POST /api/jobs/<id>/cancel` · `/retry` · `/forget` | arrêter, relancer, retirer — le sien, ou Cal (403 sinon) |

Une chaîne de travaux de plusieurs outils (05/10, les paroles calées) : `jobs.AFTER`, une
fonction(travail) appelée quand un travail sort d'un ouvrier (fini, en échec, arrêté), hors du
verrou ; la suite part au nom du travail. Un travail retiré de la file avant de partir n'y passe
pas : l'outil le relit dans la file quand on le lui demande.

Côté page : `jobs.submit(kind, params, {title, tool})`, `jobs.wait(id, onTick)`,
`jobs.watch(cb)` ; l'événement `sr:job` part quand un travail se termine, et
`sr:elements` (`{seq, since}`) quand `ev_seq` grandit : une page qui suit des
versions relit alors `GET /api/elements/changes`, sans connexion de plus que le
relevé de la file (`apps_studio_elements.md` § 2.11).

**Le relevé** (06/10, `docs/etudes/cloudflare.md`, « Le compte des requêtes du Worker » : derrière
la porte, chaque requête de `/api/*` compte dans les 100 000 par jour du Worker) : `GET
/api/jobs?limit=60` toutes les 1,5 s quand un travail est en file ou en cours, 6 s pendant les
deux minutes qui suivent un mouvement, 30 s au repos ; tout de suite après un geste qui touche
la file (`jobs.submit`, `cancel`, `retry`, `forget`, et toute écriture dont la réponse porte un
travail : `api()` le voit). **Onglet caché, rien** (Page Visibility) ; relu dès son retour. **Un
seul relevé par navigateur** : les onglets visibles d'un même Workspace élisent un meneur
(Web Locks) qui relève et diffuse la liste aux autres (BroadcastChannel) ; sans ces API,
chaque onglet relève. `jobs.wait` lit la liste tant que le travail tourne, sa fiche une fois
fini. Une page qui relève autre chose passe par `releve(fn, ms)` (ou `ongletCache()` et
`auRetour(cb)`), jamais par un `setInterval` nu. Le compteur : `tools/compte_requetes.mjs`.
`jobRow(j)` dit la place (« 2 devant toi · départ ≈ 4 min ») ; sa vignette
est la copie d'affichage de l'objet du travail (`jobItemsFor(liste)` les lit
d'un coup par `/api/library/batch`).

## 4. Une page d'outil

```html
<link rel="stylesheet" href="../commun/tokens.css">
<link rel="stylesheet" href="../commun/base.css">
<link rel="stylesheet" href="../commun/shell.css">
<link rel="stylesheet" href="./image.css">
<script type="module" src="./image.js"></script>
```

```js
import { mountHeader, api, jobs, pick, refBoard, thumb, uploadFile, toast, el } from '../commun/shell.js';
mountHeader('image');   // en-tête commune : logo → accueil, outils, machines, file
```

Le gabarit commun : `.studio` (réglages `.rail` | scène `.stage` |
historique `.side-r`), `.viewer` pour l'image ou la vidéo en grand,
`.opts/.opt` pour les pastilles de choix, `.grid/.thumb` pour les
vignettes, `.refs/.ref-chip` pour la planche de références.

**Le fil** (`commun/fil.js` + `fil.css`, depuis le 29/09, Image et Vidéo) :
ce qu'un outil a fabriqué, en grille ou en liste, les rendus en file et en
cours en tête, une visionneuse plein écran (la molette passe d'un objet à
l'autre), au survol aimer · réutiliser · recréer · télécharger et le menu ⋯
(`commun/menu.js`, le même au clic droit). L'outil donne sa requête de
bibliothèque, ses travaux, et ce que valent Réutiliser, Recréer et ses
entrées de menu propres ; le fil fait le reste (aimer = `fav`, dossiers,
copier, télécharger, corbeille avec confirmation) :

```js
import { createFil } from '../commun/fil.js';
const fil = createFil($('#fil'), { id: 'image', layout: 'grid', query: () => 'library?kind=image&tool=image',
  jobs: () => liveJobs, onJob: { cancel, retry, forget }, reuse: { run, why }, recreate: { run, why, more },
  menu: (it) => [entrées], details: (it) => [[clé, valeur]], link: (it) => href('image/#' + it.id), undo: U });
fil.add(items) · fil.open(id) · fil.paintJobs()
```

Avec `undo: U` (la pile de la page, `commun/undo.js`), aimer, ranger et
jeter se rangent avec leur contraire (`libPatch`, `libTrash`) ; la page
repeint le fil dans le `onapply` de sa pile (`items` : les objets rendus,
`{id, gone: true}` pour un objet reparti à la corbeille).

### Les modules communs

| module | ce qu'il fait | l'API |
|---|---|---|
| `shell.js` | l'en-tête (avec le bouton plein écran), `api`, la file (`jobs`, `jobRow`), les relevés (`releve`, `ongletCache`, `auRetour`, `quandVisible` : rien onglet caché, § 3), `pick`, `thumb`, `dropZone`, `dragItem`, `uploadFile` (`onprogress` : la progression, par XMLHttpRequest) ; `entrerEspace(id)` : l'onglet dans un Workspace sans recharger la page (« Commencer un projet ») ; **le gardien du clic droit** (ci-dessous) ; `kindMark` : la pastille de la sorte au coin d'une vignette, avec une icône pour les sortes qu'on confondrait à l'image (séquence ≠ clip vidéo, MIDI ≠ son, élément ≠ image), la séquence pleine | `mountHeader(outil)` pose aussi `data-sr-tool` sur `<html>` ; `kindMark(it, {compact})` (posée par `thumb`, reprise par Asset et le chutier du Montage) ; ré-exporte `refBoard` et la règle de `refs.js` |
| `refs.js` | **la règle des références** (Image, Vidéo, les cartes Générer d'Idéation) : un carrousel ordonné ; `@image1` désigne une **place**, jamais un visuel (réordonner change qui est `@image1`, le prompt ne bouge pas) ; le modèle envoie les N premières places, les suivantes restent **grisées**, non envoyées, la raison au survol ; changer de modèle ne retire rien ; le « + » s'éteint à la limite et dit pourquoi. Le serveur tient la même règle : il reçoit le carrousel entier, `split_refs(refs, send)` (`server/tools/image.py`) n'envoie que les N premières et garde les autres sous `refs_held` ; N vient d'un seul endroit (`refs` de `/api/image/models`) | `sentCount`, `isHeld`, `sentLabel`, `heldTitle`, `moveItem`, `sortable(box, {item, onmove, stop})` (glisser, Alt + ← →), `refBoard` ; les états sont des classes (`held`, `dragging`, `drop-before`, `drop-after`) |
| `molette.js` | **la molette de toutes les timelines** (Montage, ODIO, Movie Analysis) : molette = défiler les pistes, Maj = le temps, Alt (ou pincer) = zoom du temps sous le curseur, Ctrl = la hauteur de toutes les pistes (sur un en-tête `data-piste` : la sienne) ; Ctrl + molette ne zoome jamais la page ; `deltaMode` converti | `brancher(zone, {zoom, hauteur, defilerX, defilerY, scroller, piste})` rend de quoi débrancher ; `lire(ev, el)`, `REGLE`, `AIDE` (le texte d'aide) |
| `fenetre.js` + `fenetre.html`, `fenetre.css` | **les panneaux détachés** (un 2ᵉ écran : Montage, le nodal d'ODIO) : une page, un état, un moteur. `fenetre.html` est une page vide qui se présente à la page qui l'a ouverte (`window.opener.SR_FENETRES`) ; la page y **déplace** le nœud du panneau : écouteurs, annulation, son, données restent ceux de la page. Styles, thème, ancêtres du panneau, clavier et glisser suivent ; fermer la fenêtre rattache le panneau ; sa place est retenue par visiteur (`docs/etudes/fenetres.md`) | `fenetres(outil, {onchange})` puis `F.panneau(id, {node, title})`, `detacher`, `rattacher`, `bouton(id)`, `entree(id)`, `pastilles()` ; `$`, `$$`, `winOf`, `partout`, `suivreTaille`, `fenetreDuGeste` pour un code qui doit voir aussi les fenêtres |
| `pleinecran.js` | le plein écran de la page entière (`<html>` : menus et bulles restent visibles), Ctrl+Maj+F, Échap pour sortir ; là où il est refusé (l'iPhone), le bouton le dit | `boutonPleinEcran(doc, el)`, `basculer(doc)`, `raccourci(doc)` ; posé par `mountHeader` et par chaque fenêtre détachée |
| `apercu.js` | **l'aperçu au survol du nom** (09/10) : une bulle de valeurs sous le nom — par machine la mémoire utilisée / totale (une barre fine) et le GPU ou « non mesuré » (`GET /api/machines/apercu`, § 5), les travaux en cours (titre, machine, pourcentage ou étape) et le compte en file ; Cal voit toute la file, les autres leurs travaux. Chargé par `mountHeader` à la première approche du nom (souris, stylet, focus clavier ; au doigt, rien) ; la file : la liste déjà relevée, aucune requête ; les machines : une requête par ouverture, resservie 5 s ; on peut la survoler (WCAG 1.4.13), Échap et le clic la ferment ; styles `.sr-apercu` dans `shell.css` ; essai : `commun/pilote_apercu.mjs` | `brancher(btn, {liste, moi}, ev)`, `liste()` (une liste de la file reçue : la bulle ouverte se repeint) |
| `theme.js` | pose le thème (sombre, clair, « le mien »), la taille de l'interface (`zoom`, `--ui-zoom`) et les animations avant que la page ne se dessine | importé par `shell.js` ; `reducedMotion()`, `scrollBehavior()` |
| `prefs.js` | les préférences, générales et par outil, rangées par personne (`/api/prefs`, § 7), miroir dans ce navigateur ; le panneau (roue de l'en-tête, Ctrl+,) | `prefs.get/set/on`, `openPrefs(outil)` ; schéma : `<outil>/prefs.json` |
| `undo.js` | l'annulation : une pile par page, des commandes et leur contraire ou des instantanés, Ctrl+Z / Ctrl+Maj+Z / Ctrl+Y lus par `e.key` (juste en AZERTY), ↶ ↷ et le journal ; la bibliothèque (`libPatch`, `libTrash`, `libBoard`), le contraire lu sur le serveur | `createUndo`, `U.run/record/group/snapshots`, `U.buttons()` ; se déclare dans `window.SR_UNDO` (le menu de repli) — `docs/etudes/preferences.md` § 4 |
| `proxies.js` | les copies d'affichage : la plus petite qui couvre la taille vue × densité de l'écran | `pickView(it, px)`, `needOf`, `bind(img, it, {fit, box})` (suit la taille réelle, près de l'écran), `swap` |
| `menu.js` | le menu commun (clic droit, « ⋯ », sous-menus, clavier), le menu de repli | `menu`, `contextMenu(node, build)`, `kebab`, `pageMenu(build)`, `commonItems()`, `fallbackMenu`, `copy` |
| `fil.js` | le fil d'un outil (ci-dessus) | `createFil`, `copyText`, `ask` |
| `wire.js` | les fils d'un canvas nodal (ceux d'ODIO, repris par Idéation) | `wire`, `wireD`, `wireAt`, `tempWire` ; couleurs = noms de jetons |
| `entrees.js` | les entrées d'un plan par place (`@image1`… verts ou rouges) | `createEntrees` (Vidéo) |
| `split.js` | les panneaux redimensionnables | `split(box, parts, {axis, key})` |
| `tete.js` + `tete.css` | **la tête de lecture et la règle des temps de toutes les timelines** (Cal, 30/09 : « la même cue partout, celle du montage vidéo est bien »), extraites du Montage : un trait orange de 2 px et son onglet, cachés sous les en-têtes collés, qui suivent la lecture ; une règle en timecode `HH:MM:SS:FF` (une étiquette tous les 84 px au moins) qui ne peint que ce qui se voit ; cliquer, glisser sur la règle déplace la tête (capture du pointeur). Le Montage, ODIO (l'arrangement, le piano roll, l'éditeur audio), le lecteur et la minuterie de motion d'Idéation (06/10) s'en servent | `tete({z})`, `poser(ph, x, {decal, sous})`, `suivre(scroller, x)`, `peindreRegle(ticks, {pps, fps})`, `brancherRegle(zone, {temps, aller})`, `sauter(media, t)` (un saut ne s'empile jamais sur un saut en cours), `cible`, `glisser`, `tc(images, fps)` |
| `lecteur.js` + `lecteur.css` | **LE lecteur du portail** (30/09) : une vidéo ou un son dans le thème, jamais les contrôles du navigateur ; la vidéo remplit son cadre ; la frise = la règle et la tête de `tete.js`, la bande des images ou l'onde du son (`onde.js`, 06/10 : juste à tout zoom, jusqu'à 192 000 px/s bornés par la largeur que le navigateur pose ; vue onde, spectre ou les deux, un bouton de la barre ; `onde: true` : l'onde du son d'une vidéo aussi, Transcrire), et les pistes de la page ; la molette commune, le clavier du Montage (Espace, J K L, K tenue + J ou L, ← →, Début, Fin), la boucle, le son retenu, le plein écran ; le son au défilement (`scrub.js` : glisser, pas à pas, rebours). En glissant, il montre la copie de défilement (`/api/defil`, § 2) et repasse sur l'originale quand elle montre la même image (`requestVideoFrameCallback`). Asset (la fiche), le fil (Image, Vidéo), Transcrire, Movie Analysis et Idéation s'en servent | `lecteur(it, {clavier, sur, onTemps, defilement, onde})` → `L.el`, `seek`, `play`, `pause`, `toggle`, `step`, `piste(nœud)`, `t`, `duree`, `etat()`, `detruire()` ; `petitLecteur(url, {duree, titre})` (un son dans une liste, un seul à la fois) ; `survolSon(video)` (la lecture au survol d'une vignette, avec le son du lecteur) ; `ICON` (les icônes de sa barre) |
| `onde.js` | **l'onde d'un son, juste à tout zoom** (01/10, refaite le 06/10 : `docs/etudes/onde_spectre.md`) : pour chaque colonne de pixels d'écran (devicePixelRatio compris), le palier de la pyramide (min, max exacts de 64, 256… échantillons, `/api/son/onde`) qui tient sous elle, ou les échantillons eux-mêmes (`/api/son/echantillons`) : des barres min-max, puis un trait par les échantillons, puis un point sur chacun ; tuiles du visible seulement, cache commun (LRU, 96 Mo) ; un palier plus grossier tient la place d'une tuile en route, les pics de 01/10 celle d'une pyramide qui se calcule ; la couleur : `color` du canvas (un jeton). La vue (onde, spectre, les deux) et l'échelle du spectre (mel, log) : des préférences de ce navigateur (`sr:vue-son`). Le lecteur commun, le Montage (plans son, son des plans vidéo, écran Source) | `source(id, {voix})`, `dessiner(canvas, S, {t0, t1, vue, alpha, part})`, `pics(id)` (l'entrée de 01/10), `vueSon()`, `poserVueSon(v)`, `echelleSon()`, `poserEchelleSon(e)`, `boutonVue()`, `etatOnde()` |
| `spectre.js` + `spectre.worker.js` | **le spectre d'un son** (06/10) : la STFT des échantillons (Hann, 75 % de recouvrement ; une colonne large fait la moyenne de toutes ses fenêtres), la fenêtre suit le zoom (512 à 4096 échantillons à 48 kHz) et 85 ms pour les basses, échelle mel ou log de 20 Hz à 20 kHz, dB sous le plus fort sur 90 dB, aux jetons `--spec-0…4` ; calculée dans un Worker, par tuiles de 128 colonnes au zoom exact ; 2^23 échantillons à l'écran au plus (2 min 55 s à 48 kHz), au-delà la vue dit de zoomer. Chargé à la première vue « spectre » | `peindreSpectre(g, S, {t0, t1, y, w, h, dpr, cv})` (appelé par `onde.js`), `mesureSpectre`, `SPAN_MAX` |
| `scrub.js` | **le son au défilement** (06/10, Cal : « entendre le son quand on fait glisser la tête […] pour caler un cut ») : pendant qu'on glisse une tête, un grain de 60 ms (fenêtre de Hann) à sa place chaque fois qu'elle a bougé, un toutes les 30 ms au plus, à la vitesse du geste (0,5 à 2) ; silence quand elle s'arrête, rien au clic. Le pas à pas au clavier (← →, K tenue + J ou L) : un grain par image (`coup`) ; la lecture à rebours (J) : un geste. La page dit ce qui sonne (`sons(t)`) et ce qui commence sous la tête (`notes`, facultatif). Le Montage (règle, barres des moniteurs : le son de défilement du serveur), le lecteur commun (sa frise : le même son), ODIO (règle et onglet de la tête de l'arrangement : ses sons décodés, par la piste ; les clips de notes, joués courts par l'instrument de la piste quand la tête passe sur leur début) ; préférence Général → « Son au défilement » ; essai : `commun/pilote_scrub.mjs` | `scrub({contexte, sons, notes, sortie})` → `debut()`, `aller(t)`, `fin()`, `coup(t)`, `grains`, `notes` ; `sonDefil(it)`, `chargerSon(it)`, `aSon(it)`, `actif()`, `contexteCommun()` |
| `documents.js` + `documents.css` | **les documents** (05/10) : `extraireDocument(it, {file})` lit un PDF que le serveur n'a pas lu (pdf.js 4.10.38, chargé de cdnjs à la première lecture ; ses `cmaps/` et `standard_fonts/` de jsdelivr, que cdnjs n'a pas) et le dépose — `uploadFile` l'appelle seul (`lireSiBesoin`) ; **LA liseuse** : les pages en vignettes (rendues par poppler, sinon pdf.js, sinon leurs premières lignes), le texte page par page, les pages d'un PDF telles qu'elles sont (« Pages ») ; Asset (la fiche) et Idéation (au double-clic) | `liseuse(it, {page, onitem, deposer, telecharger})` → `{el, aller, detruire}` ; `lirePdf(source)`, `deposerLecture(it, lu)`, `rendrePage(pdf, n, px)`, `docLigne(it)`, `nomDe(it)` |
| `lrc.js` + `lrc.css` | **l'éditeur de paroles calées** (05/10) : le lecteur commun, une marque par ligne sur sa frise, la ligne entendue ; toucher une ligne à l'écoute la pose à l'instant (Entrée : la ligne choisie), à l'arrêt elle y mène la lecture ; ± 0,1 s, décaler tout, corriger le texte, sa pile d'annulation, « Caler automatiquement » ; tout s'enregistre seul | `ouvrirEditeurLrc({item, lrc, lyrics, onSave, enregistrer, caler})` → `{el, fermer}` (`enregistrer(lrc)` : ailleurs que le champ `lrc` du son, une playlist) ; `lireLrc`, `ecrireLrc`, `tempsLrc` |
| `dock.js` + `dock.css` | **le panneau Asset** (30/09, `docs/etudes/panneau_asset.md`) : la bibliothèque à gauche de chaque outil, montée par `mountHeader`, fermée à l'arrivée ; Ctrl+Espace (ou ², Préférences → Général), ou sa languette verte au bord. Un visualiseur : chercher, trier, filtrer (les sortes en pastilles ; cinq sections en accordéon : ce Workspace, récents, favoris, autres Workspaces, Character Factory), poser — rien ne s'y range ni ne s'y jette (« Gérer dans Asset ↗ »). Il pousse la page (`html.sr-dock-on`, `@container sr-page`) ; une grille fenêtrée, par pages de 120 (`GET /api/asset/dock`) ; un objet d'un autre Workspace est rapatrié (une copie) avant d'être posé | la façade `dock` de `shell.js` : `dock.configure({place(items, {how}), clickPlaces, placeLabel, menu, kinds, label, dockMin, fiche, hint, rapatrie})` (`rapatrie: false` : l'outil reçoit l'original d'un autre Workspace et en fait la copie lui-même, plus tard — « Commencer un projet »), `dock.contexte({kinds, label, why})`, `declareZone(node, {kinds, label})`, `dock.open/close/toggle/isOpen/reload/recent` ; l'événement `sr:dock` (`{open, w}`) |
| `telephone.js` + `telephone.css` | **le téléphone** (06/10, REPRISE § 2.E) : chargé par `mountHeader` sur un téléphone seulement (`data-appareil="mobile"`, posé avant le premier dessin par `theme-tot.js` ; la tablette n'en est pas un). Les outils à grand écran (`GRAND_ECRAN` de `shell.js` : ODIO, le Montage, Image, Vidéo) y montrent un écran propre — « se fait sur ordinateur ou tablette », leurs calculs (`jobs.watch`), ce qu'ils ont rendu (un son s'écoute sur place, le reste mène à sa fiche d'Asset), la file, « Ouvrir quand même » pour l'onglet (`sessionStorage sr-tel-ouvert-<outil>`) ; la page de l'outil est cachée dès la barre posée (`html.sr-tel-lourd`, `shell.css`) | `monter(outil, {lourd})` (appelé par `mountHeader`) ; l'accueil lit `GRAND_ECRAN` (« ordinateur » sur leurs cartes) |

**Le clic droit** (Cal, 29/09 : « ne plus avoir de clic droit du navigateur
partout dans nos outils ; on a un menu contextuel dédié à où on se trouve au
survol ») : `shell.js` empêche le menu du navigateur sur toute page, à la
capture, sauf dans un champ de texte (copier, coller natifs) ou sous
`[data-native-menu]`. Une zone donne son menu par `contextMenu(node, build)`
(`build(e)` rend les entrées, ou `null` : le repli) ou par son propre
gestionnaire qui appelle `preventDefault` ; sinon s'ouvre le **menu de
repli** : le lien, la sélection, l'image ou la vidéo survolés, les entrées de
la page (`pageMenu`), puis Annuler / Rétablir / le journal de la pile active,
Préférences, copier le lien de la page.

**Une hauteur d'écran** s'écrit `calc(100 * var(--vh))` (et une largeur
`calc(94 * var(--vw))`) : sous la taille de l'interface (`zoom`), `100vh`
dépasse la fenêtre (`commun/tokens.css`).

**Le téléphone** (06/10, REPRISE § 2.E) : `data-appareil="mobile"` (`commun/theme-tot.js`) porte ce qui ne vaut
qu'au doigt — dans chaque feuille, un bloc final « le téléphone » sous `html[data-appareil="mobile"]` ; la
mise en page qui dépend de la place reste aux requêtes de conteneur (`@container sr-page`). La règle commune
(`base.css`, « LE TÉLÉPHONE ») : toute cible de 44 × 44 px au moins (WCAG 2.2, 2.5.5 ; Apple HIG) — un petit
dessin garde sa taille, un `::after` élargit sa cible —, les champs en 16 px (Safari d'iOS n'agrandit plus la
page), les bords sûrs (`env(safe-area-inset-*)`, la page étant en `viewport-fit=cover`) ; `--vh` y est en `svh`
(`tokens.css` : la hauteur sous la barre d'adresse). La barre commune garde son ordre et ses x, en compact,
dans les deux orientations ; le panneau Asset n'y est pas. Idéation y a son module (`ideation/telephone.js`,
chargé par `plugins.js` : lire la planche au doigt, Plan, Photo, Note). Le contrôle : `tools/pilote_telephone.mjs`.

## 5. Les machines

| | DGX2 (192.168.10.247) | DGX1 (192.168.10.205) |
|---|---|---|
| portail | **:8790**, `~/showrunner-data` | miroir du code |
| ComfyUI | :8188 (`~/comfyui-env`) | :8188 (`~/ComfyUI/venv`), joint par 169.254.110.6 |
| H3 | la recette sur :8188 (voie `h3`) ; :8189 `comfyui-h3test` arrêté | idem ; SHOWRUNNER_SANDBOX :8015 |
| Character Factory | relais :8765 → DGX1 | studio :8765 |

**L'aperçu des machines** (09/10, `server/tools/machines_apercu.py`) : `GET /api/machines/apercu` →
`{machines: [{name, up, used_gb, total_gb, mem_src, gpu, gpu_why}], age_s}`, lu à l'ouverture de la bulle
du nom (`commun/apercu.js`), jamais en boucle. Une commande par machine, sur place (`sh`) ou par le câble
(`ssh -o BatchMode=yes`, l'hôte d'une de ses instances ComfyUI) : la mémoire `MemTotal − MemAvailable` de
`/proc/meminfo` (mémoire unifiée du GB10 ; `mem_src: meminfo`), sinon le relevé de la file (`comfyui`,
borné par la cgroup du service) ; le GPU par `nvidia-smi --query-gpu=utilization.gpu` (`null` : non
mesuré). Gardé 5 s, une lecture à la fois, 4 s au plus par machine ; `gpu_why` (la raison d'une mesure
qui manque) aux admins seulement ; un membre la lit (comme `GET /api/system`), l'invité non. Ce qui est
mesuré et ses sources : `docs/etudes/orchestration.md`, « Fait le 09/10 ».

Les graphes Krea 2 et Qwen-Image 2.1 viennent de
`~/Character_Factory/factory/krea2.py` et `qwen21.py` (réglage `cf_repo`),
importés, jamais recopiés.

## 6. Essayer sans gêner les autres

Chaque chantier tourne sa propre instance, sur son port et ses données :

```sh
scp -r /c/SHOWRUNNER_TOOLS/. dgx2:/tmp/sr_<outil>/
ssh dgx2 'cd /tmp/sr_<outil> && SHOWRUNNER_PORT=87xx SHOWRUNNER_DATA=/tmp/sr_<outil>_data \
  setsid nohup python3 server/showrunner.py > /tmp/sr_<outil>.log 2>&1 < /dev/null &'
```

Ports réservés aux essais : image 8791, movie 8792, montage 8793,
musique 8794, analyse 8795, objet 8796, asset 8797, admin et file 8786
(ses faux ComfyUI : 8771, 8772).

Hors des DGX (une session cloud, un agent dans sa copie) : `tools/portail_essai.py
[port] [données]` (8795 et `/tmp/sr_essai/data` par défaut) lance le même serveur
avec `auth: false` (on entre en Cal), l'écoute sur 127.0.0.1 et les seules voies
`cpu` et `image` sur la machine même — donc les moteurs factices des réglages par
défaut ; `SR_LORA_MANIFEST` pose un faux manifeste d'entraîneurs, `SR_FAUX_R2=1` un faux
R2 (le faux S3 du selftest d'`ecoute.py` et un jeton d'essai : le lien d'écoute se publie
pour de faux, `chanson/pilote_lien.mjs`), `SR_FAUX_MACHINES=1` deux faux ComfyUI nommés DGX2 et DGX1, hors des voies,
et la mesure de l'aperçu remplacée (`commun/pilote_apercu.mjs`). Il s'arrête par
son PID (jamais `pkill -f`). Jamais sur les DGX : c'est le portail de la maison
qui y tourne. L'agent d'Idéation s'y essaie contre `tools/faux_ollama.py`.

## 7. Les outils : routes, travaux, interrupteurs

Chaque outil tourne d'abord sur un **moteur factice** (images, vidéos,
sons d'essai) : l'interface se mène de bout en bout sans GPU. Le câblage
réel est écrit, vérifié à vide, et s'allume par un réglage de
`showrunner.local.json` (sur DGX2), puis `tools/portail.sh restart`.

| outil | routes | travaux | interrupteur |
|---|---|---|---|
| Asset | `/api/asset/view`, `move`, `folders/rename`, `lineage/<id>`, `trash` (GET : la corbeille ; POST `{ids}` : y mettre), `restore {ids}`, `trash/<id>/thumb`, `refs/<id>`, `bulk {ids, fav, tags_add, tags_remove}` (rend `before`, que `{restore}` repose), `zip {ids}`, `zip/<jeton>/<nom>`, `cf/refresh` ; `dock?kind=&etype=&media=&q=&folder=&fav=1&space=&spaces=*&limit=&offset=` (le panneau Asset commun : une page d'objets, les comptes de ses pastilles ; le Workspace courant par défaut), `espaces` (les Workspaces que la personne voit) | — | — |
| Préférences | `GET /api/prefs` (les miennes, avec les schémas), `POST /api/prefs {patch}` (fusion ; `null` retire une clé ; 400 hors schéma, 413 au-delà de 32 Ko), `GET /api/prefs/schemas` — `server/tools/prefs.py`, un fichier `<data_dir>/prefs/<id>.json` par personne | — | — |
| Image | `/api/image/models`, `compose` (le prompt envoyé), `generate`, `edit`, `redo` | `image.generate`, `image.edit` (voie image) | `"image_backend": "comfyui"` |
| Vidéo (`movie/`) | `/api/movie/options`, `plan` (le graphe H3), `loras`, `element-image`, `redo` (recréer), `frame` (première / dernière image), `assist`, `h3`, `h3/start`, `h3/stop` | `movie.t2v`, `movie.i2v`, `movie.r2v` (voie h3) | `"movie_engine": "h3"` ; `h3_idle_minutes`, `h3_min_free_gb` |
| Montage | `/api/montage/meta`, `projects` (GET la liste des séquences, POST `{name, settings}` ou `{from_item}`), `projects/<id>` (lire, enregistrer), `projects/<id>/rename`, `duplicate`, `delete`, `plan` (un id `mon-…` d'avant le 29/09 mène à sa séquence `seq-…`), `wave/<id>`, `luts` (GET, PUT un .cube), `luts/<id>` (POST), `luts/<id>/cube`, `mini`, `delete` | `montage.export` (voie cpu, ffmpeg) | — |
| ODIO (`musique/`) | `/api/music/projects…` (lire, enregistrer, `delete`), `engines`, `generate` ; `gen/engines`, `gen/generate` (`music_gen.py` : les modèles génératifs du schéma `musique/generatif_modeles.json` ; depuis le 06/10 la demande dit aussi `libre` — tempo, tonique, mode, mesure changés pour cette génération —, `quoi` et `voie` — la réponse du panneau « Générer » (`musique/generatif_panneau.js`) et sa voie, `intentions` du schéma —, `garder` — l'instrument dont la voie « chanson puis stem » garde le stem) ; `midi` (ranger un clip de notes), `midi/options`, `midi/extract`, `midi/<id>/notes` (`music_midi.py`) ; `stems/options`, `stems/plan`, `stems/separate` (depuis le 06/10, `gen/generate`, `midi`, `midi/extract` et `stems/separate` disent le projet, `project` : ce qui en naît va dans son Space de Musique, `music_space`, que le projet porte — `chanson.project_space`) ; `yue/options`, `yue/plan`, `yue/generate`, `yue/abc`, `yue/abc/check` (la faute en français et sa ligne, `error_fr`, `ligne` ; `corriger` : la partition coupée remise au dialecte — `music_yue.abc_normalise`). Les jouets (`music_jouets.py`) n'ont pas de route : leurs câbles `notes` et `mod` sont jugés dans l'enregistrement du projet (`music.validate`, sans boucle) | `music.generate`, `music.gen.<modèle>`, `music.midi`, `music.midi.abc`, `music.stems`, `music.yue`, `music.yue.abc` | `"music_engine": "ace-step"`, `"music_yue"`, `"music_stems"`, `"music_midi": true` |
| Idéation (`ideation/`) | `/api/ideation/meta`, `boards` (GET la liste, POST une planche), `boards/<id>` (lire, enregistrer), `boards/<id>/rename`, `duplicate`, `delete`, `export` (le travail, rangé dans la bibliothèque), `png` (`{frame?}` : la planche ou un cadre en PNG, rendu tout de suite et renvoyé tel quel — la page l'enregistre sur l'ordinateur et le copie dans le presse-papier, rien ne va dans la bibliothèque ; 05/10), `palette/<id>`, `lot` (les cartes Générer : des lots d'images ou de vidéos, lancés par les sortes d'Image et de Vidéo) ; `collab/<id>/…` (`ideation_collab.py` : opérations, flux, présence, accès, invitations, fil, visio) ; `web/apercu`, `web/img/<empreinte>` (`web_apercu.py` : l'objet Web — YouTube, Vimeo, un site dans un cadre s'il l'accepte, sinon une carte lien lue par le serveur, sans adresse locale ni privée) | `ideation.export` (voie cpu) | `"ideation_ice_servers"` |
| LoRA (les moodboards d'Idéation) | `GET /api/lora/models` (les modèles cibles et s'ils sont prêts), `GET /api/lora/<planche>/<objet>` (l'état d'un moodboard : versions, plan, travail), `POST …/train {items, model, when: "now" \| "HH:MM", name}` (lancer ou planifier la nuit ; la garde du calcul d'abord), `POST …/cancel`, `GET /api/lora[?model=]` (les LoRA entraînés qu'on voit ; `render` : ceux qu'un rendu peut poser, avec le modèle qui les a produits et les machines qui les ont — la carte Générer, la page Image, la page Vidéo pour H3 ; `image.generate` et `movie.*` les reçoivent en `lora` / `loras`, posés par `LoraLoaderModelOnly` après l'`UNETLoader`, le mot déclencheur en tête du prompt), `GET /api/lora/file/<planche>/<objet>/<v>` — `server/tools/lora.py` ; l'état d'un LoRA dans `<data_dir>/lora/<planche>-<objet>.json`, ses fichiers dans `lora/files/` | `lora.train` (voie image, épinglé à la ComfyUI de la machine du portail, une seule chose de GPU pendant ce temps), `lora.train_factice` (voie cpu, l'essai sans GPU, pour Cal) | le manifeste `~/trainers/sr_lora.json` (réglage `lora_manifest`) : un modèle n'est proposé que marqué `ok` après un essai réel à l'installation (`docs/INSTALL_LORA.md`) ; `comfy_loras`, `lora_peer` |
| Agent Showrunner (Idéation) | `POST /api/ideation/agent {board, messages: [{role, content, items}], intent: '' \| 'ingest' \| 'plan' \| 'etape', brief_items?, questions_turn?, answers?, plan_turn?, etape?}` (un tour ; `ingest` rend aussi la réception et les `paliers`), `GET /api/ideation/agent/<planche>` (la conversation, les paliers, le carnet `decisions`, le moteur), `POST …/turns/<tour> {claim} \| {applied, ids, results} \| {undone} \| {plan: 'refuse'}`, `POST …/decisions {texte} \| {retirer}`, `POST …/paliers/<p> {stop}`, `POST …/clear` — `server/tools/ideation_agent.py` ; la page : `ideation/agent.js` (le panneau, `app.agent = {open, send, busy}` ; les gestes posés en un `app.mutate`) ; la conversation dans `<data_dir>/ideation_agent/<planche>.json` (`docs/etudes/agent_showrunner.md`, § 7 pour l'entrée d'un projet) | `ideation.agent` et `ideation.palier` (voie audio, épinglés sur la machine de leur Ollama ; cpu sans voie audio) ; les sons par `transcrire.transcribe` | `ideation_agent_url`, `ideation_agent_modele` (sinon `llm_url`, `llm_model`), `ideation_agent_ctx`, `ideation_agent_vision_url`, `ideation_agent_vision_modele`, `ideation_agent_vision_gb`, `ideation_agent_sons` (`auto`, `toujours`, `jamais`) ; le diagnostic `agent` d'Admin (`tools/diag_agent.py`) |
| Présentation · PDF (Idéation, 06/10, `server/tools/presentation_pdf.py`) | `GET /api/ideation/presentation/pdf` (la machine sait-elle imprimer : `{ok, why, node, playwright, version, chromium, refused_fonts}`), `POST /api/ideation/boards/<id>/pdf {pdf, png}` (le travail ; 409 sans diapositive) — Chromium sans affichage (`tools/presentation_export.mjs`) imprime LA page de lecture (`lecture.html?print`, `scene.js`) : chaque diapositive à son état final, une page nommée par taille de scène (16:9 = 1440 × 810 pt), `page.pdf` (vectoriel) et une capture PNG par page en option ; les données de la page viennent du travail (lues au nom de la personne, servies par `page.route`), ni session ni jeton. Le PDF : un `document` (dossier « Idéation », sans poppler son texte et sa couverture par la page : `documents.deposer`) ; les images : des `image`. Une police dont la licence refuse le PDF (`FONTS`, `pdf`) le refuse. Ce qui ne s'imprime pas (vidéo, Web, son) : son image fixe et un pied discret. La page : `ideation/presentation/export.js` (le bouton du mode, `jobs.watch`) ; le pilote : `ideation/pilote_pdf.mjs` | `presentation.pdf` (voie cpu, `cost` cpu) | `presentation_node`, `presentation_playwright` (défaut `~/Character_Sheet`, celui de `tools/shot.mjs`), `presentation_chromium` ; le diagnostic `presentation` d'Admin |
| Présentation · vidéo (Idéation, 06/10, `server/tools/presentation_video.py`, `docs/etudes/presentations_motion.md` § 10) | `POST /api/ideation/boards/<id>/video {slide?, fps?, scale?, hold?}` (le travail ; 409 sans diapositive ; `GET /api/ideation/presentation/pdf` dit aussi `ffmpeg`) — Chromium sans affichage ouvre LA page de lecture en rendu (`lecture.html?video`, `programme.js` : la présentation, ou une diapositive, bout à bout comme le lecteur la joue) ; pour chaque image, `SR_RENDU.seek(k / fps)` la pose à son instant exact (la frise, la transition, la sortie, les vidéos ; l'image figée : le même instant, les mêmes pixels), une capture PNG donnée à ffmpeg (libx264, yuv420p, CRF 16, BT.709, +faststart) ; 1080p, ou 2160p (`scale: 2`). La vidéo : une `video` (dossier « Idéation »). Une police dont la licence refuse le PDF refuse aussi la vidéo. Les images clés par propriété et les courbes libres du motion : `ideation/presentation/courbes.js` ; le pilote : `ideation/pilote_motion.mjs` | `presentation.video` (voie cpu, `cost` cpu) | ceux de Présentation · PDF, et ffmpeg dans le PATH |
| Paroles calées (`commun/lrc.js`) | `GET /api/paroles/<id>` (le LRC, les paroles connues, l'état du calage, ce qu'on peut faire), `POST /api/paroles/<id> {lrc}` (à la main : relu, trié), `POST /api/paroles/<id>/caler {paroles?, langue?, voix?}` (la chaîne : `music.stems` la voix seule, `transcrire.transcribe` complet, puis le calage ; l'état dans `<data_dir>/paroles/<id>.json`) — `server/tools/paroles.py` ; la mesure sur des LRC calés à la main : `tools/paroles_mesure.py` | `paroles.caler` (voie cpu : l'alignement) | ceux de la séparation et de Transcrire |
| Object Creator | `/api/objet/state` (les instances ComfyUI de la voie `image` seulement : une entrée `local` n'en est pas une ; `vues` : le générateur, les angles, les passes, les classes, le modèle qui voit), `objects` ; les vues (09/10, `objet_vues.py`) : `GET /api/objet/{eid}/vues` (le plan, ses images, `go`, `pass_open`), `POST …/vues/source {az, el, file?}`, `…/vues/plan {pass: 2} \| {az, el}`, `…/vues/generer {slots?, seed?}` (un travail par vue ; la garde du calcul avant tout), `…/vues/{sid} {action: garder \| poser \| rejeter \| rouvrir \| retirer, item?}`, `…/classe {value}`, `…/classer`, `…/face {face}`, `…/rendus`, `…/planche` | `objet.mesh` (TRELLIS.2), `objet.mesh_factice` ; `objet.vue` (voie image : Qwen-Edit 2511 · angles, AnyAngle), `objet.vue_factice`, `objet.rendus` (voie image : Render Mesh natif), `objet.rendus_factice`, `objet.planche` (cpu, PIL), `objet.classer` (le modèle qui voit : voie audio épinglée, cpu sans elle) | `"objet_trellis": true` ; `"objet_vues": "factice" \| "qwen-edit-2511" \| "qwen21-anyangle"` ; `"objet_rendus": true` |
| Movie Analysis | `/api/analyse/list`, `projets` (GET la liste fusionnée : nos films, les analyses d'ici, les projets du portail et du dépôt partagé ; POST `{nom}` un projet), `projets/<id>` (POST `{nom}` renommer, `{supprime}` retirer ou restaurer), `corrections/<film>` (GET, PUT : les corrections des voix et du casting, gardées dans le portail), `diarisation`, `chaine`, `nom/<nom>`, `run`, `diar/etat`, `diar/fichiers`, `diar/travaux`, `diar/travail/<id>` (GET, DELETE), `diar/analyse` (relais vers DGX1 :10002) | `analyse.run` (voie analyse, une à la fois) | — |
| Upscale | `/api/upscale/models`, `plan`, `run` | `upscale.image`, `upscale.video` (voie image ; cpu en factice) | `"upscale_backend": "comfyui"` |
| Character Factory | `/character/api/*`, `/character/files/*`, `/character/v1/*` : relais en flux vers le studio de DGX1 | (la file du studio, sur DGX1) | — |
| Musique, l'app (`chanson/`, `server/tools/chanson.py`) | `/api/chanson/options`, `list` (mes chansons), `create`, `variant` (la recette, une autre graine), `paroles` (« Écris-les pour moi »), `plan` (la partition seule, à relire avant de chanter), `plan/lire` (une partition retouchée : son résumé, son jugement), `stems`, `odio` (un projet ODIO, une piste par stem, dans le Space de la chanson), `studio/demande`, `onde/<id>` ; les Spaces (`docs/etudes/musique_spaces_playlists.md` § 2) : `spaces` (GET, POST), `spaces/move` (des objets et des projets ODIO), `spaces/contenu` (ce que range un Space : la rubrique « Space » d'ODIO), `import` ; `list` rend aussi les projets ODIO du Space ; Séparer et Ouvrir dans ODIO demandent le Studio | `chanson.ace` (Rapide : ACE-Step), `chanson.yue` (Soigné et Reprendre : YuE2), `chanson.plan`, `chanson.paroles` (voie audio, cpu en factice) | ceux d'ODIO (`music_engine`, `music_yue`, `music_stems`) et `"chanson_paroles": true` (le modèle de langue d'ACE-Step 1.5) |
| Transcrire (`transcrire/`, `server/tools/transcrire.py`) | `/api/transcrire/options`, `docs` (les transcriptions), `run {item, mode: rapide \| complet, to?, notes?}`, `docs/<id>` (lire ; POST : enregistrer, `rev`), `…/translate {to, all}`, `…/export?format=srt\|vtt\|txt\|json\|md&which=&stamps=1`, `…/asset` (409 tant que la sorte `subtitle` manque au socle), `…/delete`, `…/voix` (la probabilité de parole de chaque voix), `…/notes {kinds} \| {question}` (le carnet), `…/qa/<q>/delete` ; un document `<data_dir>/transcrire/trn-….json` par transcription, né dans le Workspace du son | `transcrire.transcribe`, `transcrire.translate`, `transcrire.notes` (voie audio ; cpu en factice) | `"transcrire_moteur": "local"` (Whisper turbo ou Parakeet sur DGX2, les voix par Nemotron de DGX1, traduction et carnet par Ollama) |
| L'agent Showrunner (Idéation, `server/tools/ideation_agent.py`, `docs/etudes/agent_showrunner.md`) | `POST /api/ideation/agent {board, messages, intent: "" \| "ingest" \| "plan" \| "etape"}` (un tour en file ; 4 000 signes et 24 objets cités au plus, 400 pour l'entrée d'un projet), `GET /api/ideation/agent/<planche>` (la conversation, les paliers, le carnet, l'état du modèle : prêt, vision), `POST …/turns/<t> {claim \| applied \| undone \| plan: "refuse"}`, `POST …/decisions`, `POST …/paliers/<p>`, `POST …/clear` (la conversation archivée) | `ideation.agent` : voie audio épinglée sur l'instance de la machine de l'Ollama (famille `ollama-agent`, 31 Go, modèle déchargé en fin de tour), cpu sans voie audio ; `ideation.palier` (les images de l'entrée, priorité basse) : épinglé sur la machine du modèle qui voit | `ideation_agent_url` (sinon `llm_url`), `ideation_agent_modele` (sinon `llm_model`, `qwen3-vl-32b-32k`), `ideation_agent_ctx` (32768), `ideation_agent_vision_url`, `ideation_agent_vision_modele`, `ideation_agent_sons` |
| Le kit de Cal (`server/tools/strategie.py`) | `/strategie/…` : `<data_dir>/strategie/` (jamais dans le dépôt, qui est public), au compte de Cal seul (403 à tout autre, la porte sans session) ; chaque page HTML y est servie avec `<script src="/commun/kit_nav.js">` ; `GET /api/strategie/moi`, `GET /api/strategie/plan` (les pages, ou l'ordre de `plan.json`) | — | — |
| Lien d'écoute (`ecoute/`, `server/tools/ecoute.py`, 05/10, `docs/etudes/musique_spaces_playlists.md` § 4) | `GET /api/ecoute/<playlist>` (le lien, ses réglages, ses écoutes avec `?ecoutes=1`, si l'on peut publier, sinon pourquoi), `POST …/zip {adresse?}` (le paquet zippé : servi par `api/asset/zip/…`), `POST …/publier {code?, fin?}`, `POST …/retirer` (Cloudflare : R2 sous `ecoute/<jeton>/`, porte/r2_recopie.py ; 409 tant que le jeton R2 manque). Le paquet : le lecteur, `playlist.json`, les MP3 256 kbit/s ramenés à −14 LUFS (loudnorm deux passes, linéaire quand un gain suffit), les LRC, les pochettes, l'aperçu Open Graph ; gapless, ou un fichier continu (fondu enchaîné, bout à bout) fabriqué à la publication. Droits : `espaces.can_publish` | `ecoute.zip`, `ecoute.publier` (voie cpu, ffmpeg) | — (Cloudflare : `~/.config/showrunner/r2.json`, le geste 9 de `cloudflare.md`) |

**Idéation, les objets du 05/10** (un module par objet sous `ideation/objets/`, un
par réglage de diapositive sous `ideation/diapo/`) :

- `objets/moodboard.js` — `{type: 'moodboard', items, open, wc, hc}` : une carte à
  taille fixe (une mosaïque de neuf), que le double-clic ouvre sur tous ses
  visuels. Y entrent une image de la planche lâchée dessus, une image du panneau
  Asset ou un fichier du disque ; un moodboard de sons (la première sorte qui
  entre décide) vise ACE-Step. Son LoRA (`server/tools/lora.py`) : à jour si les
  objets de la dernière version sont ceux du moodboard, sinon périmé — la
  version d'avant reste utilisable ; le lancer, le planifier la nuit, ses
  versions. L'entraînement réel est dans `server/tools/lora_trainers.py` :
  ai-toolkit (Krea 2, Qwen-Image 2.1, Z-Image, H3) et l'entraîneur officiel
  d'ACE-Step 1.5, avec les réglages qui ont marché à l'installation (le
  manifeste) ; le LoRA est copié dans `ComfyUI/models/loras/showrunner/` des
  deux DGX (`docs/etudes/lora_entrainement.md`) ;
- `objets/modele3d.js` — `{type: 'model3d', item, mesh, light, chan}` : le GLB
  d'un élément (`element.meshes`) dans la visionneuse du portail
  (`character/viewer.html?embed=1`, un cadre de la même origine) ; une carte
  légère d'abord, « Interagir » ou un double-clic charge la visionneuse ;
  l'éclairage (studio, jour, intérieur, contre-jour, plat) et le canal (rendu,
  albedo, métal, rugosité, normales, filaire) se règlent par la barre de
  l'objet et passent au cadre par message, sans le recharger ;
- `diapo/libre.js` — le style « Aucun » d'un titre ou d'une note (le défaut d'un
  texte neuf) : ses propres police, taille, couleur et fond (des jetons), et
  justification, par une petite barre au-dessus du texte, comme dans Miro ; un
  style nommé les met en sommeil ;
- un **document** sur la planche (05/10) : un objet `media` de sorte `document`
  (`MEDIA_KINDS`, dit à la page par `media_kinds` de `/api/ideation/meta`) — une page
  debout, sa couverture, sa ligne (« PDF · 12 pages ») et son titre ; le double-clic
  ouvre la liseuse commune (`app.liseuse(n)`) ; l'export PNG dessine sa couverture.

**Idéation, l'entrée d'un projet et l'agent (05/10)** :

- `ideation/projet.js` (`docs/etudes/mode_showrunner.md`) — « Commencer un
  projet », le bouton orange de l'accueil (`ideation/?projet=nouveau` ;
  `app.projet()`) : une fenêtre par-dessus Idéation, un champ qui grandit (le
  brief) où tout se lâche, se colle, se prend au trombone ou par dossier, se
  glisse du panneau Asset ; une vignette par fichier au-dessus du champ ; le nom
  du projet (= la Team), du Workspace (« Général »), des personnes (`GET
  /api/equipes/personnes`). Rien ne part avant « Commencer » : la Team, son
  Workspace, les membres, l'onglet passé dans le Workspace sans recharger
  (`entrerEspace` de `shell.js`), la planche, les fichiers (trois à la fois, la
  progression d'`uploadFile` sur chaque vignette ; ce qui vient d'Asset est
  rapatrié), le brief (une note, et `brief.md` s'il est tapé), des cadres de
  départ (Brief, Documents, Images, Vidéos, Sons, Autres), puis l'agent
  (`app.agent.send(brief, {items, intent: 'ingest'})`) s'il est là ;
- l'agent (`server/tools/ideation_agent.py`) : une conversation par planche
  (`<data_dir>/ideation_agent/<planche>.json`). Ses outils de lecture
  (`lire_planche`, `lire_document`, `decrire_image`, `chercher_bibliotheque`),
  le serveur les exécute dans sa boucle ; ses outils d'écriture (poser un texte,
  un cadre, un asset, une carte Générer ou Vidéo, un composeur, ranger, grouper,
  relier, déplacer, renommer la planche) sont validés puis rendus en actions
  `{tool, args, why}` que la page applique d'un seul `app.mutate` — un pas
  d'annulation par tour ; une écriture refusée revient au modèle avec sa raison.
  Une carte Générer est posée prête, son prompt et ses références branchés : son
  `lancer` n'est vrai que si la personne a demandé le rendu. `intent: "ingest"` : chaque document
  lu par parties, chaque image regardée, en sorties structurées, puis la planche
  organisée. Rien n'a tourné sur le vrai modèle : le contrôle passe par
  `tools/faux_ollama.py`.
- la suite (09/10, étude seulement, rien n'est codé) : `docs/etudes/agent_autonome.md` — l'accusé par le code, un
  routeur, une politique de conversation en code, des skills, le registre des capacités (`agent/`, `GET /api/agent/registre`).

**ODIO, « Détecter le tempo » (05/10)** : le calcul est dans la page
(`musique/tempo.js`, un module pur, appelé par `musique/bpm.js` sur le son que
le moteur a déjà décodé : flux spectral, autocorrélation, temps suivis par
programmation dynamique) — ni travail en file ni GPU. `server/tools/music_tempo.py`
n'en est que l'essai : son `selftest` écrit des clics à tempo connu (module
`wave`) et les fait lire par le module de la page sous node (sans node, il le dit
et ne compte rien).

**Le kit de Cal** (`server/tools/strategie.py`, `commun/kit_nav.js`) : le
positionnement, le deck, les discours, servis depuis `<data_dir>/strategie/`
à Cal seul, `Cache-Control: no-store`, `noindex`, sans jamais sortir du dossier.
`kit_nav.js`, ajouté à chaque page HTML du kit sans toucher au fichier : une barre
fine d'accès direct aux pages (le plan), dans un shadow DOM aux jetons du thème,
discrète tant que la souris n'approche pas du haut et absente en plein écran ;
Échap ramène à la page de positionnement (l'index) ; Alt+← / Alt+→ : la page
d'avant, d'après.

**Déposer un asset** : tout bloc qui attend un asset passe par `dropZone()`
de `commun/shell.js` (fichier du disque → bibliothèque avec `tool: upload`,
`via: <outil>` ; ou vignette glissée, type `application/x-sr-item`). Les
vignettes se glissent par `dragItem()`. Ce qu'un outil fabrique garde son
nom d'outil ; seul ce que quelqu'un dépose est « Upload ». Une zone (ou `pick`)
qui prend `document` prend tout fichier ; une autre refuse ce qui n'est pas de ses
sortes, et dit ce qui, rangé, n'y est pas pris (la sorte est celle du portail).

## 8. L'adresse publique : le Worker de Cloudflare

**https://showrunner.luxigone.workers.dev** (en place le 29/09,
`docs/etudes/cloudflare.md`) : le Worker `showrunner` (`porte/worker.js`,
`porte/wrangler.jsonc`). Ses assets statiques sont le dépôt moins
`.assetsignore` (ni `server/`, ni `tools/`, ni `docs/`, ni `porte/`) : les
pages n'ont que des chemins relatifs, Cloudflare les sert sans DGX2. Ce qui
doit calculer ou juger passe par le Worker (`run_worker_first`) : `/api/*`,
`/library/*`, les relais du studio, `/analyse/runs/*`, `/invitation` — relayé
à DGX2 par Workers VPC (tunnel sortant `dgx2` → `127.0.0.1:9790`, la porte du
§ 9), signé HMAC (`x-porte-*`, secret `PORTE_CLE`).

Variable **`PORTE_MODE`** du Worker (et `porte.mode` du portail, les deux
ensemble) :

- `code` (en service) : pas de Cloudflare Access ; le Worker signe le rôle
  `code` et l'adresse du visiteur (`Cf-Connecting-IP`), ne transmet que les
  cookies du portail (`sr_session`, `sr_invitation`) ; sans l'un d'eux, il
  répond 401 lui-même (seuls `/api/auth/…`, `/api/porte/…` et `/invitation`
  passent) ; les essais de code et de pseudo sont bornés par adresse
  (`ESSAIS`, 10 par minute). Le portail juge le reste (§ 9, `porte.invitation`).
- `access` : le jeton Cloudflare Access (RS256) revérifié par le Worker et
  par le portail ; admin selon le secret `ADMINS`.

Les **médias** des assets (`/media/*`, `*.mp4`, `*.webm`, `*.mp3`…) passent
aussi par le Worker, sans identité (ce sont des assets publics) : il y
ajoute les requêtes partielles (`Range` → 206, `Content-Range`,
`Accept-Ranges`), que les assets statiques ne font pas et sans lesquelles
Safari ne lit pas une vidéo. Déployer : `bash tools/porte.sh deploie` sur
DGX2 ; l'essai sans Cloudflare : `node porte/essai.mjs`.

**Les liens d'écoute** (05/10, non déployés : le jeton R2 manque) : `GET /ecoute/<jeton>/…`
(`run_worker_first`), HORS de la porte à code — le paquet d'une playlist lu dans R2 sous
`ecoute/<jeton>/` seulement (liste blanche des fichiers d'un paquet, plages), jeton de 128 bits ;
`_lien.json` (jamais servi) porte le code facultatif (empreinte salée ; `POST …/_code` pose un
cookie scellé par `PORTE_CLE`), la date de fin (410 au-delà), le compteur (`POST …/_ecoute`, un
objet vide par écoute sous `_ecoutes/`). L'essai sans Cloudflare : `node porte/essai_ecoute.mjs`.

## 9. La porte du portail et la page de Cal

`server/core/auth.py`, posée par le socle devant chaque requête
(`app.gate`, `app.after` dans `core/http.py`) : **un outil n'a rien à
changer**. Un compte = un pseudo (décision de Cal du 29/09 : ni code ni
mot de passe) ; une connexion = un jeton aléatoire en cookie `sr_session`
(`HttpOnly; SameSite=Lax`), dont le serveur ne garde que l'empreinte
(`<data_dir>/auth.json`, relu s'il change : `showrunner.py --admin
<pseudo>` l'écrit). Le compte de Cal : pseudo `nico007`, id `cal`, admin,
créé au démarrage. Un pseudo admin n'entre que depuis le réseau de Cal
(`admin_lan_only`, `auth.ADMIN_NETS`), jugé à chaque requête.

| sans session | avec |
|---|---|
| les pages se servent et montrent la porte (`commun/porte.js`, chargée par `mountHeader` ou un 401) | tout |
| `/api/…` (sauf `/api/auth/…`), les relais (`/character/…`), `/library/…` : **401** | selon le rôle : `/api/admin/…` et `POST /api/movie/h3/stop` aux admins (403) ; un admin hors du réseau de Cal : 403 |

- Toute écriture dont `Sec-Fetch-Site` n'est ni `same-origin` ni `none`,
  ou dont `Origin` n'est pas l'hôte de la requête : 403 ; un corps JSON en
  `text/plain`, `x-www-form-urlencoded` ou `multipart/form-data` : 415
  (audit du 28/09, H3). Chaque écriture est journalisée
  (`<data_dir>/journal.jsonl` : qui, méthode, chemin, code).
- Propriétaire : chaque travail porte `owner` (la personne de la requête,
  ou du travail qui le lance) ; chaque objet `origin.user` (posé par
  `library.add_file` / `create_element`) — l'auteur. Qui voit, modifie, met à
  la corbeille : le rôle de la personne dans le Workspace de l'objet (§ 10 ;
  tout éditeur modifie, la corbeille reste à l'auteur et aux admins du
  Workspace) ; un travail : seul son auteur (ou Cal) l'arrête, le relance —
  `PermissionError` → 403. `visibility: own` resserre encore la lecture à ce
  qui est à soi ou `shared`.
- `"auth": false` (`showrunner.local.json`) coupe la porte : tout se passe
  comme si Cal était connecté (`tools/check.py` ; la porte s'y essaie à
  part, allumée : `server/tools/compte.py`, `admin.py`).

**La porte publique** (29/09, `docs/etudes/cloudflare.md`, « Prêt à
déployer ») : derrière un tunnel Cloudflare tout arrive de 127.0.0.1, et « le
réseau de Cal » ne protégerait plus rien. Les tunnels visent donc un second
point d'écoute, **`127.0.0.1:<port + 1000>`** (9790 pour 8790), ouvert par
`server/showrunner.py` (`serve_door`) : les mêmes routes, relais et dossiers
que la maison, mais une App marquée `door` — c'est elle, et non une adresse
ou un en-tête, qui dit d'où vient la requête. Là, rien n'est du réseau de
Cal et `"auth": false` n'y vaut rien. Réglage **`porte.mode`** de
`showrunner.local.json` :

| `porte.mode` | ce qui ouvre |
|---|---|
| `demo` (défaut) | un tunnel rapide (trycloudflare) : un code d'invitation d'abord (`/invitation/`, cookie `sr_invitation`), puis le pseudo ; un compte admin n'entre qu'avec le code admin, distinct ; codes dans `<data_dir>/porte-demo.json` (`tools/demo.sh`, `showrunner.py --porte-codes`, `--porte-codes-nouveaux` ferme les sessions de la porte, `--porte-url`) |
| `access` | la vraie porte (`porte/worker.js`) : la signature HMAC du Worker (`x-porte-*`, clé `~/.config/showrunner/porte.key`) et le jeton Cloudflare Access (`Cf-Access-Jwt-Assertion`, RS256), au même e-mail ; admin seulement si le Worker le signe et si l'e-mail mène à un compte admin (`porte.emails`) |
| `code` (en service depuis le 29/09) | la vraie porte à l'adresse fixe (`porte.url`), sans e-mail ni Access : la signature du Worker (rôle `code`, l'adresse du visiteur) — seul le Worker entre —, puis la mécanique de la démo : le code d'invitation, puis le pseudo ; un pseudo créé d'avance par Cal (Admin, ou `showrunner.py --ami <pseudo>`) entre aussitôt, un pseudo neuf attend Cal ; un compte admin n'entre qu'avec le code admin. **`porte.invitation`** (vrai par défaut) : `false` (la phase d'essai, en place) ôte le code d'invitation — on tape le pseudo qu'on a reçu, un pseudo inconnu est refusé (`auth.open_door`) ; le code admin reste exigé pour un admin. `tools/porte.sh code`, `invitation on\|off`, `lien`, `ami <pseudo>`, `nouveaux-codes` (ferme toutes les sessions de la porte) |
| `off` | pas de seconde écoute |

La porte n'écoute jamais ailleurs que sur le loopback (`showrunner.py
--porte-adresse` : « hôte port mode »). Sur l'écoute de la maison, une requête
qui porte les en-têtes du bord de Cloudflare (`Cf-Ray`, `Cf-Connecting-IP`…)
est refusée : un tunnel pointé par erreur sur 8790 n'ouvre rien. Le contrôle :
`server/tools/porte_publique.py` (sur des ports libres, comme le ferait un tunnel).

| Routes de la porte (`server/tools/compte.py`) | |
|---|---|
| `GET /api/auth/me` | `{auth, state: anonymous pending active refused suspended offnet, user}` ; un invité qui attend Cal : `invited {by_name, at}` (aussi dans la réponse d'`enter`) |
| `POST /api/auth/enter {name}` · `/cancel` | entrer par son pseudo (un pseudo inconnu : une demande), annuler sa demande |
| `POST /api/auth/logout` · `GET /api/auth/devices` · `POST /api/auth/devices/<id>/revoke` | se déconnecter, ses connexions |

| Routes de Cal (`server/tools/admin.py`, page `admin/`) | |
|---|---|
| `GET /api/admin/state` | demandes, personnes (quotas, compte du jour, derniers travaux), réglages, la file entière |
| `POST /api/admin/requests/<id>/accept` · `/refuse` | les demandes : un pseudo tapé à la porte, ou un invité qui attend Cal (§ 10 ; accepter : le compte et ses places, refuser : les deux) |
| `GET /api/admin/alertes` · `POST …/alertes/jeton {token}` · `…/chercher` · `…/essai` · `…/actif {actif}` | les alertes de Cal sur Telegram (`core/alertes.py`, `server/tools/alertes.py`) : l'état (jamais le jeton), le jeton écrit en 600 dans `~/.config/showrunner/telegram.json`, « Trouver mon chat » (un code à envoyer au bot), un essai, couper ou rallumer |
| `POST /api/admin/users/<id> {role, state, quotas}` · `GET …/devices` · `POST …/devices/<sid>/revoke` | le rôle admin (jamais le dernier), suspendre (ses travaux en file s'en vont ; pas un admin), quotas, connexions |
| `POST /api/admin/settings {visibility, admin_first, admin_lan_only, quotas, total_queued}` | les réglages |
| `POST /api/admin/queue/<job> {before | to_end | priority | top}` | glisser, priorité, épingler |
| `POST /api/admin/pause {machine?, mode: active paused draining}` | pause, reprise, vidange |
| `GET /api/admin/machines` · `POST /api/admin/instances/free {url}` · `POST /api/admin/ollama/unload` | instances, mémoire, familles chargées, ce que chacune prendrait, H3, le studio, le relais |
| `GET · POST /api/admin/switches` | les interrupteurs déclarés (`config.declare_switch`), écrits dans `showrunner.local.json`, pris au redémarrage |
| `GET /api/admin/storage` · `POST /api/admin/trash/empty` · `GET /api/admin/journal` | stockage, corbeille, journal |
| `GET /api/admin/detruits` · `POST /api/admin/detruits/<e>/rendre {vers?}` | les Workspaces détruits, les rendre (§ 10 ; `server/tools/equipes.py`) |
| `GET · POST /api/admin/menage` | le grand ménage (§ 10 ; `server/tools/equipes.py`) |

La page a en tête la section **« 0 · Vue d'ensemble »** (09/10, `admin/tableau.js`, § 11) : toutes les Teams,
leurs Workspaces, qui y crée quoi. Un compte qui n'est pas admin du portail n'a que deux sections : son
**« Tableau de bord »** (ses Teams), puis **Teams** (les accès : membres, rôles, invitations, Workspaces) ;
l'entrée « Tableau de bord » du menu du compte (`commun/shell.js`) mène à `admin/#tableau`.

Essayer la file sans rien calculer : `tools/faux_comfy.py` (un faux
ComfyUI réglable : mémoire, rendu d'un « autre »), `"file_simulation": true`
(les travaux factices suivent les règles du GPU) et `"machine_names"`
(nommer les faux ComfyUI « DGX1 », « DGX2 »), dans le
`showrunner.local.json` d'une copie d'essai seulement.

## 10. Teams et Workspaces

L'étude et les décisions de Cal (30/09) : `docs/etudes/equipes_espaces.md` ; le socle
`server/core/espaces.py` (`<data_dir>/teams.json`), les routes `server/tools/equipes.py`,
Admin → Teams.

- **Le modèle.** Une Team (`tea-…`) décide et paie : une offre (`apps` | `studio`), l'API
  payante (coupée par défaut), un budget ; des membres `owner | admin | member | guest`
  (un guest est `viewer` ou `acteur`, réglé dans Admin → Personnes). Un Workspace
  (`esp-…`) est un lieu de travail d'une Team : un rôle par défaut, des rôles par membre
  (`admin | editor | commenter | viewer`) ; un membre voit **tous** les Workspaces de sa
  Team (09/10 : plus de `none`, un `none` d'avant vaut `viewer`) ; un guest, ceux où on le met.
- **My Team** (décisions de Cal du 09/10 : « on ne travaille pas en dehors d'une Team ») :
  chaque compte a sa Team personnelle (`tea-perso-<id>`, Workspace « Général » ; « Chez
  moi » / « Perso » avant — le ménage renomme ce qui porte encore le nom de naissance, jamais
  un nom choisi : `renamed`). Un compte neuf n'a qu'elle : il n'entre plus d'office dans
  Nirvalab. Elle invite si son propriétaire a le Studio (un compte Apps la garde seul, la
  phrase mène à « Demander le Studio ») ; elle ne se détruit, ne s'archive ni ne se quitte.
  Le nom d'une Team pour la personne : `label` (`espaces.label_of` : la My Team d'un autre
  dit à qui elle est) — l'en-tête, Asset, Admin, la pastille GPU l'affichent.
- **Détruire** — `POST /api/espaces/<e>/detruire {nom}` (qui gère sa Team, ou Cal ; jamais
  Général ni le dernier Workspace ouvert d'une Team) et `POST /api/equipes/<t>/detruire {nom}`
  (son propriétaire, ou Cal ; jamais une My Team ni Nirvalab : ses Workspaces, ses membres,
  ses liens, son budget ; ses invités qui n'attendaient Cal que pour elle sont refusés, leur
  alerte le dit) ; `nom` : le nom tapé. Rien n'est réécrit : la fiche passe dans
  `destroyed_spaces` (`destroyed_teams`) et tout ce qui porte cet identifiant n'est plus à
  personne, Cal compris (`espaces.gone` dans les juges d'`auth`, `library.check_create`, le
  lien d'une planche) ; les objets vont à la corbeille (`library.bury`), les travaux en cours
  s'arrêtent, qui l'avait pour dernier retombe sur sa My Team, les outils qui tiennent des
  connexions les ferment (`espaces.QUAND_DETRUIT`). Cal le rend (Admin → Stockage,
  `restore_space`) : le même identifiant, dans la My Team de son auteur principal (sinon la
  sienne). Ce qu'un Workspace tient, magasin par magasin : `espaces.content_of`
  (`CONTENT_DOCS`) ; `check.py isolement` fait échouer un magasin « champ » neuf qui n'y est pas.
- **Le grand ménage** (« fresh start », Cal) — `GET /api/admin/menage` : l'aperçu (les
  comptes créés par une Team — ceux qui attendent Cal compris —, les Teams partagées et leur contenu, les appartenances à
  retirer, les Teams personnelles à renommer) ; `POST {comptes, teams, retirer_membres,
  renommer, confirme: "MENAGE"}` : tout est jugé avant le premier geste, puis les Teams
  détruites, les comptes supprimés (`admin.supprimer_compte`, le chemin d'Admin → Personnes ; un
  invité qui attend Cal : `auth.refuse`), chaque Team restante réduite à son propriétaire, les
  noms ; jamais Cal ni un admin.
- **Cal valide les invités** (09/10, l'étude, « Fait le 09/10 ») : un pseudo neuf mis dans une Team
  par un autre que Cal (un admin du portail compte comme Cal) — `add_member`, ou le lien d'une Team
  fait par un non-Cal — naît `pending` avec `invited {by, team, role, guest?, spaces?, at}` ; sa
  place est écrite, mais `core/espaces.py` ne voit qu'un compte actif (`_profile`, `team_role`,
  `teams_of`, `can_manage`) : rien ne compte tant qu'il attend. Admin → Demandes l'accepte
  (`auth.accept_request`) ou le refuse (`auth.refuse` : ses places d'abord, `drop_memberships`). Un
  compte actif entre directement. Chaque demande (invité, porte, Studio) et chaque compte existant
  mis dans une Team par un non-Cal est annoncé à Cal sur Telegram (`core/alertes.py` : une file et
  un fil, jamais dans la requête ; les boutons par `getUpdates`, du seul chat réglé, appellent les
  mêmes fonctions qu'Admin) ; essais : `tools/faux_telegram.py`, `SR_TELEGRAM_URL`.
- **La matrice** (`espaces.MATRIX`, profils × actions) est la seule vérité :
  `espaces.judge(u, espace, action)` rend (oui, pourquoi pas) ; `auth.can_view`,
  `can_edit`, `can_compute`, `can_publish`… la reprennent. Un guest ne calcule jamais,
  `cpu` compris.
- **Le Workspace d'une requête** : l'en-tête `X-SR-Espace` (posé par `api()` de
  `commun/shell.js`), sinon `?e=` (un flux, une balise, un lien), sinon le dernier de la
  personne ; la porte le pose (`auth.current_space()`), la file le pose le temps du `run`
  d'un travail (celui du travail). Un Workspace qu'on ne voit pas : 403.
- **Ce qui est à un Workspace.** Chaque objet et document porte `space`, posé à sa
  naissance par le socle (`library.new_space` : le document source, sinon le travail,
  sinon la requête), jamais par la page ; un document d'outil le reçoit par
  `library.stamp` et le garde à chaque réécriture (`library.keep`). Un outil n'atteint
  que son Workspace : `library.get`, `readable`, `query` sont bornés ; montrer (Asset,
  une vignette) passe par `see` et `query(spaces="*")`. Ce qu'un document pose est de son
  Workspace (`elements.check_doc` / `check_space`, la table `ID_FIELDS`). **L'inventaire**
  de ce que chaque outil écrit sous `<data_dir>` et d'où son Workspace lui vient :
  `STORES` de `tools/check.py` — une entrée neuve non déclarée fait échouer le contrôle.
- **La garde du calcul** : `jobs.register(…, cost=)` (§ 3) ; `jobs.submit`, par où passent
  toutes les routes, la route commune, `retry` et les travaux lancés par un travail, juge
  la personne, le Workspace et le coût (`auth.compute_refusal`, puis le Studio) ; les trois
  calculs hors file sont dans `auth.COMPUTE_ROUTES`. Le budget de la Team : la
  réservation dans `submit`, la mesure à la fin, `<data_dir>/conso.jsonl`.
- **La file est commune** aux Teams (les machines le sont) : un travail d'un Workspace
  qu'on ne voit pas y garde sa place, masqué — ni sa recette, ni son résultat, ni qui
  l'a lancé (`core_api.job_out`) ; sa fiche répond 404.
- **Rapatrier** — `POST /api/espaces/<B>/rapatrier {items, folder?, versions?, avec_source?}`,
  `library.rapatrier`, tout ou rien, jamais un lien vivant :
  - un objet : une copie neuve dans B (id et `uid` neufs, `origin.from = {space, item,
    uid, at}`), `main.*` en lien dur, le reste copié ;
  - un élément versionné : un élément NEUF dont la v1 est sa version figée (`versions:
    {élément: n}`, sinon la dernière prête) ; sa source reste où elle est, non suivie ;
    `avec_source` (le Studio) : sa source est copiée aussi et l'élément vit dessus ;
  - une séquence, une playlist (et la source d'un élément : un projet ODIO, une planche) :
    avec ce qu'elles posent — la fermeture d'`ID_FIELDS` rapatriée d'abord, puis la copie
    écrite par son outil, chaque identifiant remplacé par celui de sa copie
    (`server/tools/elements.py`, inscrit dans `library.DOC_IMPORT`, `SOURCE_IMPORT`).
  Asset (la fiche d'un objet d'ailleurs : la version à figer, « avec sa source »), le
  panneau Asset et les dépôts (`rapatrier` de `shell.js`) passent par là.
- **Les pages** (`commun/shell.js`) : le Workspace de l'onglet (`espace()`,
  `avecEspace(url)`, `enTeteEspace()`) ; le sélecteur « TEAM / WORKSPACE » de l'en-tête
  (ses Teams — les partagées, sa My Team, puis celles des autres, par leur `label` — et leurs Workspaces,
  « + Nouveau Workspace », « Réglages de la Team ») ;
  `surEspace(cb)` : l'outil suit un changement sans recharger (sinon la page se
  recharge) ; `entrerEspace(id)` ; `espaceDocument(espace, id, {outil})` : un document
  ouvert reste dans le sien — l'en-tête le dit, toute requête qui le nomme y part (une
  page rechargée le rouvre où il est) ; `outil: true`, tout ce que l'outil demande y part
  (Idéation : la planche), ce qui liste pour l'onglet passe `espace: espace()` ; `ici()` :
  là où l'outil travaille, où un objet d'ailleurs posé est rapatrié.
- **Les contrôles** : `check.py garde` (chaque sorte, pour chaque profil de la matrice ;
  la route de chaque outil rejouée par un guest), `check.py isolement` (l'inventaire ; chaque
  magasin à documents est dans l'inventaire de qui a créé quoi, § 11 ; un membre d'une autre
  Team rejoue chaque lecture des selftests et n'y voit rien d'ailleurs), `droits.py`,
  `asset.py` (rapatrier), `tableau.py` (§ 11).

## 11. Qui a créé quoi, où

Cal, 09/10 : un ami avait lancé des transcriptions, et Cal ne voyait pas où — « je dois moi avoir
un dashboard qui me permette de voir toutes les teams, workspaces et assets créés par les gens ».
Le contrat : **chaque création porte son auteur et son Workspace, posés par le serveur, et son
outil l'énumère** pour l'inventaire (`server/core/inventaire.py`), que lisent les tableaux de bord
(`server/tools/tableau.py`, Admin → « Vue d'ensemble » ; « Tableau de bord » pour chacun).

- **Déclarer** (dans `register(app)` de l'outil, qui seul connaît son format ; l'inventaire ne lit
  le dossier d'aucun outil) : `inventaire.declare(sorte, label=, plural=, tool=, store=, lister=)`.
  `lister()` rend une fiche par création : `id`, `title`, `owner` (l'auteur tel que le document le
  porte), `job` (le travail qui l'a fait, s'il le dit), `space`, `created`, `updated`, `open`
  (l'adresse dans son outil, relative à la racine, sans `?e=` : l'inventaire le pose, `with_e`),
  `sub`, `thumb` (une adresse, ou une fonction : calculée pour la page montrée seulement). Les
  fichiers se lisent par `inventaire.json_docs(chemins, fiche)` : seule la fiche de chaque fichier est
  gardée en mémoire, jamais le document, et un fichier n'est relu que s'il a changé ; ce qui dépend d'un
  autre document (l'auteur d'une planche, le titre d'une image source) se lit à chaque relevé.
- **Rattacher** un magasin à documents qui n'est pas une création en soi : `inventaire.attach(store,
  pourquoi)`. `check.py isolement` échoue si un magasin « champ » de `STORES` n'est ni l'un ni l'autre.
- **L'auteur d'un document qui ne le porte pas** (un objet d'avant la porte, une planche d'avant le
  30/09, une LUT importée en ligne de commande) : le travail qui l'a fait (son `owner`, la file garde
  les 400 derniers), sinon le premier qui l'a écrit d'après `journal.jsonl` (et `journal.1.jsonl`),
  sinon « auteur inconnu » ; chaque fiche dit d'où (`via` : `doc` | `travail` | `journal` | null).
- **Les droits** : une fiche n'est rendue qu'à qui la verrait dans une liste d'Asset
  (`auth.item_reader` : le rôle dans son Workspace) — jamais celle d'un Workspace où l'on n'entre
  pas ; Cal entre partout, en lecture. Le pseudo d'un compte (ce qu'on tape à la porte) n'est montré
  et cherché que par Cal ; les autres voient et cherchent le nom. La Team personnelle d'un autre se
  nomme « <son nom> · <la personne> ».

| sorte (`kind`) | magasin, sous `<data_dir>` | outil | auteur | Workspace | titre · dates | s'ouvre (`open`, puis `?e=<sid>`) |
|---|---|---|---|---|---|---|
| `image` `video` `audio` `midi` `document` `element` `sequence` `playlist` | `library/<id>/item.json` (une version d'élément reste sous son élément, comme dans Asset) | le socle (Asset) ; ce qui l'a fait : `origin.tool` | `origin.user` (`library._owned` : la personne de la requête ou du travail) ; sinon `origin.job` | `space` (`library.new_space`) | `title` · `created`, `updated` | `asset/#<id>` ; une séquence `montage/#<id>` ; une playlist `chanson/?playlist=<id>` |
| `planche` | `ideation/ide-*.json` | Idéation | `ideation_collab/<id>.access.json` → `owner` (`ideation_collab.created` ; porte allumée seulement) | `space` (`ideation._write`) | `name` · `created`, `updated` | `ideation/#<id>` |
| `odio` | `musique/mus-*.json` | ODIO | `owner` (`library.stamp`) | `space` | `name` · `created`, `updated` | `musique/?p=<id>` |
| `transcription` | `transcrire/trn-*.json` (pas `*.voix.json`, le spectre des voix) | Transcrire | `owner` (`library.stamp` : qui l'a lancée) ; `job` | `space` : celui du son | `title` (celui du son) · `created`, `updated` | `transcrire/#<id>` |
| `lut` | `luts/lut-*.json` (et son `.cube`) | Montage | `owner` (`store_lut`) | `space` | `title` · `created` | `montage/` (l'étagère des LUT) |
| `atelier` | `image_atelier/atl-*.json` | Image (l'atelier) | `owner` (`library.stamp` : qui l'a ouverte) | `space` : celui de l'image source | « Atelier · » et le titre de la source · `created`, `updated` | `image/atelier/?s=<id>` |
| `analyse` | `analyse/projets.json` → `projets[]` créés ici (ni `depot`, ni `supprime`) | Movie Analysis | `auteur` (`par` n'est que le dernier geste) | `space` | `nom` · `cree`, `maj` | `analyse/?projet=<id>` |
| `space` | `chanson/spaces.json` → `{<esp>: {<msp>: fiche}}` (sans `deleted`) | Musique (l'app) | `owner` | la clé de sa table | `name` · `created` | `chanson/` |
| `lora` | `lora/<planche>-<objet>.json` (une version, un plan ou un travail) | Idéation (un moodboard) | `versions[0].by` (09/10), sinon `versions[0].job`, sinon `plan.owner` | celui de sa planche (`ideation.board_space`) | `name` · `versions[0].at`, `versions[-1].at` | `ideation/#<planche>` |

Rattachés : `paroles/` (l'état du calage des paroles d'un son ; les paroles sont dans le son, `lrc`),
`elements/journal.jsonl` (des gestes : publier, retirer), `trash/` (la corbeille d'Asset). Ni
créations ni documents (`STORES` dit d'où vient leur Workspace) : le Projet du Montage
(`montage/projet/<esp>.json`, il nomme des objets), les dossiers d'Asset, les liens d'écoute (ceux
d'une playlist), l'accès et le fil d'une planche, la conversation de l'agent, les dépouillements de
Movie Analysis (ceux de leur projet), les corbeilles des outils (`*/corbeille/`). Ce qui se range
ailleurs que là où on l'attendrait : une **présentation** est une planche qui a des diapositives (ses
exports PDF, PNG, MP4 sont des objets, outil `ideation`) ; le **carnet** est dans sa transcription
(`notes`, `qa`) ; une **chanson** de l'app Musique est un son (`origin.tool = chanson`) ; un
**personnage** de Character Factory n'est ici qu'importé (un élément, `element.source.tool =
character-factory` ; les autres vivent dans le studio, sur DGX1) ; un **objet** d'Object Creator est
un élément `type: object` (ses GLB dans `element.meshes`) ; un **sous-titre** n'est pas encore un
objet (la sorte `subtitle` manque : Transcrire l'exporte).

| Routes (`server/tools/tableau.py`) | |
|---|---|
| `GET /api/tableau[?toutes=1]` | les Teams que la personne voit (Cal, `toutes` : toutes, les Teams personnelles de chacun comprises, et `orphans` : ce qui reste d'un Workspace qui n'existe plus) → par Team, par Workspace : `total`, `counts` (par sorte), `authors` (par auteur), `last` (la dernière activité) ; `people` (qui a créé combien, où, quand pour la dernière fois) ; `kinds` |
| `GET /api/tableau/espace/<sid>?kind=a,b&q=&author=&limit=&offset=` | les objets d'un Workspace, du plus récent : sorte, titre, auteur (`via`), dates, `open` (avec `?e=<sid>`), vignette ; 404 d'un Workspace qu'on ne voit pas, comme d'un Workspace qui n'existe pas |
| `GET /api/tableau/personne/<uid>?kind=&limit=&offset=` | tout ce que cette personne a créé, partout, avec son Workspace et sa Team (`spaces` : où, combien, quand) — Cal, ou soi-même (403) ; `inconnu` : ce dont on ne sait pas l'auteur |
| `GET /api/tableau/cherche?q=&toutes=1` | les personnes (le nom ; Cal : aussi le pseudo, l'identifiant) et les objets (titre, nom de l'auteur) qui répondent à `q`, sans casse ni accents ; Cal (`toutes`) : tous les comptes, même ceux qui n'ont rien créé |
