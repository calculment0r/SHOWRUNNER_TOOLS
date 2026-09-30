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
                            refs.js, molette.js, fenetre.js/.html/.css, pleinecran.js (§ 4)
asset/ image/ movie/ …      une page par outil : index.html + <outil>.js + <outil>.css
admin/                      la page de Cal (§ 9)
media/                      l'image et la vidéo des grandes cartes de l'accueil
porte/                      le Worker de l'adresse publique, sa configuration, son essai (§ 8)
server/showrunner.py        le serveur (stdlib) : pages, /api, /library/<id>/<fichier>
server/core/                config, http, auth, library, jobs, machines, comfy — le socle
server/tools/<outil>.py     les routes et les travaux d'un outil : register(app)
server/workflows/           les graphes ComfyUI au format API propres au portail
tools/check.py              le contrôle sans GPU (socle + selftest de chaque outil)
tools/faux_comfy.py         un faux ComfyUI pour essayer la file sans rien calculer
docs/                       REPRISE, ARCHITECTURE, études
```

## 2. La bibliothèque (« Asset »)

Un objet = un dossier `<data_dir>/library/<id>/` avec `item.json`, son
fichier et sa vignette. Six sortes (`library.KINDS`) : `image`, `video`,
`audio`, `element`, et depuis le 29/09 :

- `midi` (id `mid-…`) : un clip de notes, un fichier MIDI standard (`.mid`,
  format 0) écrit et lu par le serveur seulement (`server/tools/music_midi.py`,
  une seule vérité) — rangé par ODIO (un motif, une extraction) ou déposé ;
  `params` : `bpm`, `sig`, `notes`, `bars`, `lo`, `hi`, `channels`, `drums`,
  `method`, `engine`. ODIO les range dans le dossier « MIDI ». Ses notes, en
  noires : `GET /api/music/midi/<id>/notes`. Dans Asset : sa portée, sa fiche
  (les notes dessinées, une écoute par un synthé de la page, le clip à
  glisser dans l'arrangement d'ODIO) ;
- `sequence` (id `seq-…`) : une séquence du Montage, sa timeline dans
  `sequence.json` (`server/tools/montage.py`) ; `item.json` suit la timeline
  (titre, taille, cadence, durée, `params.clips`, `params.format`, lignée =
  les plans employés, vignette = le premier plan qui se voit). Elle se range,
  se renomme, part à la corbeille comme les autres ; le Montage l'ouvre par
  `montage/#<id>` (la fiche d'Asset y mène).

```jsonc
{
  "id": "ima-20260928-212233-a1b2",
  "kind": "image",                 // image | video | audio | element | midi | sequence
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
`view`, `detail`, `style`. Un outil qui prend des références accepte
indifféremment une image ou un élément (`library.ref_paths(item, roles)`
rend les fichiers dans l'ordre).

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

### Routes

| | |
|---|---|
| `GET /api/library?kind=image,element&q=&folder=&sort=new&limit=&offset=&fav=1&tool=` | `{items, total, counts, folders}` |
| `POST /api/library/batch {ids: […]}` | les fiches de 2000 objets au plus en une requête, dans l'ordre : `{items, missing}` (absent ou invisible, sans dire lequel) |
| `GET /api/library/<id>/view?w=256…2048` | la copie d'affichage de cette taille, ou la plus proche au-dessus, ou l'original (ETag, 304) |
| `POST /api/library/views {ids?, force?}` | relancer le rattrapage des copies (admin) : le travail `library.views` |
| `GET /api/library/<id>` | l'objet |
| `PUT /api/library/upload?name=a.png&title=&folder=&tool=` (corps = le fichier) | l'objet créé |
| `POST /api/library/<id>` `{title, tags, folder, fav, element:{type, description, refs}}` | mise à jour |
| `POST /api/library/<id>/delete` · `/restore` | corbeille, retour |
| `POST /api/elements` `{title, type, description, refs:[{item, role, label}]}` | un élément |
| `POST /api/elements/<id>/refs` `{item, role, label}` | ajoute une référence |
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
    # ou une fonction(params) ; gpu : s'il passe vraiment par ComfyUI (False pour un moteur factice)
    jobs.register("image.generate", run, lane="image", title="Image",
                  family=lambda p: p["model"], gpu=lambda p: backend() == "comfyui")
    app.route("GET", "/api/image/models", lambda req: {...})
```

Voies (`showrunner.local.json` → `lanes`) : `image` (ComfyUI :8188 de
DGX2 et de DGX1), `h3` (ComfyUI-H3TEST :8189, arrêté au repos), `audio`,
`cpu` (ffmpeg…, `ctx.comfy` vaut `None`). Un ouvrier par instance ; une
instance qui ne répond pas ne prend rien.

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
| `GET /api/jobs?active=1&tool=` · `GET /api/jobs/<id>` | l'état (`queued running done error cancelled interrupted`), `progress`, `message`, `result.items`, `items` (objets complets), `owner`, `owner_name`, `mine`, `can`, `position`, `ahead`, `eta_s`, `est_s`, `family` |
| `GET /api/queue` | la file de tous : `running`, `queued` (dans l'ordre), `done` (les miens), `paused`, `machines` |
| `POST /api/jobs/<id>/cancel` · `/retry` · `/forget` | arrêter, relancer, retirer — le sien, ou Cal (403 sinon) |

Côté page : `jobs.submit(kind, params, {title, tool})`, `jobs.wait(id, onTick)`,
`jobs.watch(cb)` ; l'événement `sr:job` part quand un travail se termine.
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
| `shell.js` | l'en-tête (avec le bouton plein écran), `api`, la file (`jobs`, `jobRow`), `pick`, `thumb`, `dropZone`, `dragItem`, `uploadFile` ; **le gardien du clic droit** (ci-dessous) ; `kindMark` : la pastille de la sorte au coin d'une vignette, avec une icône pour les sortes qu'on confondrait à l'image (séquence ≠ clip vidéo, MIDI ≠ son, élément ≠ image), la séquence pleine | `mountHeader(outil)` pose aussi `data-sr-tool` sur `<html>` ; `kindMark(it, {compact})` (posée par `thumb`, reprise par Asset et le chutier du Montage) ; ré-exporte `refBoard` et la règle de `refs.js` |
| `refs.js` | **la règle des références** (Image, Vidéo, les cartes Générer d'Idéation) : un carrousel ordonné ; `@image1` désigne une **place**, jamais un visuel (réordonner change qui est `@image1`, le prompt ne bouge pas) ; le modèle envoie les N premières places, les suivantes restent **grisées**, non envoyées, la raison au survol ; changer de modèle ne retire rien ; le « + » s'éteint à la limite et dit pourquoi. Le serveur tient la même règle : il reçoit le carrousel entier, `split_refs(refs, send)` (`server/tools/image.py`) n'envoie que les N premières et garde les autres sous `refs_held` ; N vient d'un seul endroit (`refs` de `/api/image/models`) | `sentCount`, `isHeld`, `sentLabel`, `heldTitle`, `moveItem`, `sortable(box, {item, onmove, stop})` (glisser, Alt + ← →), `refBoard` ; les états sont des classes (`held`, `dragging`, `drop-before`, `drop-after`) |
| `molette.js` | **la molette de toutes les timelines** (Montage, ODIO, Movie Analysis) : molette = défiler les pistes, Maj = le temps, Alt (ou pincer) = zoom du temps sous le curseur, Ctrl = la hauteur de toutes les pistes (sur un en-tête `data-piste` : la sienne) ; Ctrl + molette ne zoome jamais la page ; `deltaMode` converti | `brancher(zone, {zoom, hauteur, defilerX, defilerY, scroller, piste})` rend de quoi débrancher ; `lire(ev, el)`, `REGLE`, `AIDE` (le texte d'aide) |
| `fenetre.js` + `fenetre.html`, `fenetre.css` | **les panneaux détachés** (un 2ᵉ écran : Montage, le nodal d'ODIO) : une page, un état, un moteur. `fenetre.html` est une page vide qui se présente à la page qui l'a ouverte (`window.opener.SR_FENETRES`) ; la page y **déplace** le nœud du panneau : écouteurs, annulation, son, données restent ceux de la page. Styles, thème, ancêtres du panneau, clavier et glisser suivent ; fermer la fenêtre rattache le panneau ; sa place est retenue par visiteur (`docs/etudes/fenetres.md`) | `fenetres(outil, {onchange})` puis `F.panneau(id, {node, title})`, `detacher`, `rattacher`, `bouton(id)`, `entree(id)`, `pastilles()` ; `$`, `$$`, `winOf`, `partout`, `suivreTaille`, `fenetreDuGeste` pour un code qui doit voir aussi les fenêtres |
| `pleinecran.js` | le plein écran de la page entière (`<html>` : menus et bulles restent visibles), Ctrl+Maj+F, Échap pour sortir ; là où il est refusé (l'iPhone), le bouton le dit | `boutonPleinEcran(doc, el)`, `basculer(doc)`, `raccourci(doc)` ; posé par `mountHeader` et par chaque fenêtre détachée |
| `theme.js` | pose le thème (sombre, clair, « le mien »), la taille de l'interface (`zoom`, `--ui-zoom`) et les animations avant que la page ne se dessine | importé par `shell.js` ; `reducedMotion()`, `scrollBehavior()` |
| `prefs.js` | les préférences, générales et par outil, rangées par personne (`/api/prefs`, § 7), miroir dans ce navigateur ; le panneau (roue de l'en-tête, Ctrl+,) | `prefs.get/set/on`, `openPrefs(outil)` ; schéma : `<outil>/prefs.json` |
| `undo.js` | l'annulation : une pile par page, des commandes et leur contraire ou des instantanés, Ctrl+Z / Ctrl+Maj+Z / Ctrl+Y lus par `e.key` (juste en AZERTY), ↶ ↷ et le journal ; la bibliothèque (`libPatch`, `libTrash`, `libBoard`), le contraire lu sur le serveur | `createUndo`, `U.run/record/group/snapshots`, `U.buttons()` ; se déclare dans `window.SR_UNDO` (le menu de repli) — `docs/etudes/preferences.md` § 4 |
| `proxies.js` | les copies d'affichage : la plus petite qui couvre la taille vue × densité de l'écran | `pickView(it, px)`, `needOf`, `bind(img, it, {fit, box})` (suit la taille réelle, près de l'écran), `swap` |
| `menu.js` | le menu commun (clic droit, « ⋯ », sous-menus, clavier), le menu de repli | `menu`, `contextMenu(node, build)`, `kebab`, `pageMenu(build)`, `commonItems()`, `fallbackMenu`, `copy` |
| `fil.js` | le fil d'un outil (ci-dessus) | `createFil`, `copyText`, `ask` |
| `wire.js` | les fils d'un canvas nodal (ceux d'ODIO, repris par Idéation) | `wire`, `wireD`, `wireAt`, `tempWire` ; couleurs = noms de jetons |
| `entrees.js` | les entrées d'un plan par place (`@image1`… verts ou rouges) | `createEntrees` (Vidéo) |
| `split.js` | les panneaux redimensionnables | `split(box, parts, {axis, key})` |

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

## 5. Les machines

| | DGX2 (192.168.10.247) | DGX1 (192.168.10.205) |
|---|---|---|
| portail | **:8790**, `~/showrunner-data` | miroir du code |
| ComfyUI | :8188 (`~/comfyui-env`) | :8188 (`~/ComfyUI/venv`), joint par 169.254.110.6 |
| H3 | :8189 `comfyui-h3test` (arrêté au repos) | :8189 idem ; SHOWRUNNER_SANDBOX :8015 |
| Character Factory | relais :8765 → DGX1 | studio :8765 |

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

## 7. Les outils : routes, travaux, interrupteurs

Chaque outil tourne d'abord sur un **moteur factice** (images, vidéos,
sons d'essai) : l'interface se mène de bout en bout sans GPU. Le câblage
réel est écrit, vérifié à vide, et s'allume par un réglage de
`showrunner.local.json` (sur DGX2), puis `tools/portail.sh restart`.

| outil | routes | travaux | interrupteur |
|---|---|---|---|
| Asset | `/api/asset/view`, `move`, `folders/rename`, `lineage/<id>`, `trash` (GET : la corbeille ; POST `{ids}` : y mettre), `restore {ids}`, `trash/<id>/thumb`, `refs/<id>`, `bulk {ids, fav, tags_add, tags_remove}` (rend `before`, que `{restore}` repose), `zip {ids}`, `zip/<jeton>/<nom>`, `cf/refresh` | — | — |
| Préférences | `GET /api/prefs` (les miennes, avec les schémas), `POST /api/prefs {patch}` (fusion ; `null` retire une clé ; 400 hors schéma, 413 au-delà de 32 Ko), `GET /api/prefs/schemas` — `server/tools/prefs.py`, un fichier `<data_dir>/prefs/<id>.json` par personne | — | — |
| Image | `/api/image/models`, `compose` (le prompt envoyé), `generate`, `edit`, `redo` | `image.generate`, `image.edit` (voie image) | `"image_backend": "comfyui"` |
| Vidéo (`movie/`) | `/api/movie/options`, `plan` (le graphe H3), `loras`, `element-image`, `redo` (recréer), `frame` (première / dernière image), `assist`, `h3`, `h3/start`, `h3/stop` | `movie.t2v`, `movie.i2v`, `movie.r2v` (voie h3) | `"movie_engine": "h3"` ; `h3_idle_minutes`, `h3_min_free_gb` |
| Montage | `/api/montage/meta`, `projects` (GET la liste des séquences, POST `{name, settings}` ou `{from_item}`), `projects/<id>` (lire, enregistrer), `projects/<id>/rename`, `duplicate`, `delete`, `plan` (un id `mon-…` d'avant le 29/09 mène à sa séquence `seq-…`), `wave/<id>`, `luts` (GET, PUT un .cube), `luts/<id>` (POST), `luts/<id>/cube`, `mini`, `delete` | `montage.export` (voie cpu, ffmpeg) | — |
| ODIO (`musique/`) | `/api/music/projects…` (lire, enregistrer, `delete`), `engines`, `generate` ; `gen/engines`, `gen/generate` (`music_gen.py` : les modèles génératifs du schéma `musique/generatif_modeles.json`) ; `midi` (ranger un clip de notes), `midi/options`, `midi/extract`, `midi/<id>/notes` (`music_midi.py`) ; `stems/options`, `stems/plan`, `stems/separate` ; `yue/options`, `yue/plan`, `yue/generate`, `yue/abc`, `yue/abc/check`. Les jouets (`music_jouets.py`) n'ont pas de route : leurs câbles `notes` et `mod` sont jugés dans l'enregistrement du projet (`music.validate`, sans boucle) | `music.generate`, `music.gen.<modèle>`, `music.midi`, `music.midi.abc`, `music.stems`, `music.yue`, `music.yue.abc` | `"music_engine": "ace-step"`, `"music_yue"`, `"music_stems"`, `"music_midi": true` |
| Object Creator | `/api/objet/state` (les instances ComfyUI de la voie `image` seulement : une entrée `local` n'en est pas une), `objects` | `objet.mesh` (TRELLIS.2), `objet.mesh_factice` | `"objet_trellis": true` |
| Movie Analysis | `/api/analyse/list`, `projets` (GET la liste fusionnée : nos films, les analyses d'ici, les projets du portail et du dépôt partagé ; POST `{nom}` un projet), `projets/<id>` (POST `{nom}` renommer, `{supprime}` retirer ou restaurer), `corrections/<film>` (GET, PUT : les corrections des voix et du casting, gardées dans le portail), `diarisation`, `chaine`, `nom/<nom>`, `run`, `diar/etat`, `diar/fichiers`, `diar/travaux`, `diar/travail/<id>` (GET, DELETE), `diar/analyse` (relais vers DGX1 :10002) | `analyse.run` (voie analyse, une à la fois) | — |
| Upscale | `/api/upscale/models`, `plan`, `run` | `upscale.image`, `upscale.video` (voie image ; cpu en factice) | `"upscale_backend": "comfyui"` |
| Character Factory | `/character/api/*`, `/character/files/*`, `/character/v1/*` : relais en flux vers le studio de DGX1 | (la file du studio, sur DGX1) | — |

**Déposer un asset** : tout bloc qui attend un asset passe par `dropZone()`
de `commun/shell.js` (fichier du disque → bibliothèque avec `tool: upload`,
`via: <outil>` ; ou vignette glissée, type `application/x-sr-item`). Les
vignettes se glissent par `dragItem()`. Ce qu'un outil fabrique garde son
nom d'outil ; seul ce que quelqu'un dépose est « Upload ».

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
  `library.add_file` / `create_element`). Seul le propriétaire (ou Cal)
  modifie, met à la corbeille, arrête, relance — `PermissionError` → 403.
  Qui voit quoi : réglage `visibility` (`all` par défaut ; `own` = le sien
  et ce qui est `shared`), jugé dans `library.query`, `GET
  /api/library/<id>` et le fichier servi.
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
| `GET /api/auth/me` | `{auth, state: anonymous pending active refused suspended offnet, user}` |
| `POST /api/auth/enter {name}` · `/cancel` | entrer par son pseudo (un pseudo inconnu : une demande), annuler sa demande |
| `POST /api/auth/logout` · `GET /api/auth/devices` · `POST /api/auth/devices/<id>/revoke` | se déconnecter, ses connexions |

| Routes de Cal (`server/tools/admin.py`, page `admin/`) | |
|---|---|
| `GET /api/admin/state` | demandes, personnes (quotas, compte du jour, derniers travaux), réglages, la file entière |
| `POST /api/admin/requests/<id>/accept` · `/refuse` | les demandes |
| `POST /api/admin/users/<id> {role, state, quotas}` · `GET …/devices` · `POST …/devices/<sid>/revoke` | le rôle admin (jamais le dernier), suspendre (ses travaux en file s'en vont ; pas un admin), quotas, connexions |
| `POST /api/admin/settings {visibility, admin_first, admin_lan_only, quotas, total_queued}` | les réglages |
| `POST /api/admin/queue/<job> {before | to_end | priority | top}` | glisser, priorité, épingler |
| `POST /api/admin/pause {machine?, mode: active paused draining}` | pause, reprise, vidange |
| `GET /api/admin/machines` · `POST /api/admin/instances/free {url}` · `POST /api/admin/ollama/unload` | instances, mémoire, familles chargées, ce que chacune prendrait, H3, le studio, le relais |
| `GET · POST /api/admin/switches` | les interrupteurs déclarés (`config.declare_switch`), écrits dans `showrunner.local.json`, pris au redémarrage |
| `GET /api/admin/storage` · `POST /api/admin/trash/empty` · `GET /api/admin/journal` | stockage, corbeille, journal |

Essayer la file sans rien calculer : `tools/faux_comfy.py` (un faux
ComfyUI réglable : mémoire, rendu d'un « autre »), `"file_simulation": true`
(les travaux factices suivent les règles du GPU) et `"machine_names"`
(nommer les faux ComfyUI « DGX1 », « DGX2 »), dans le
`showrunner.local.json` d'une copie d'essai seulement.
