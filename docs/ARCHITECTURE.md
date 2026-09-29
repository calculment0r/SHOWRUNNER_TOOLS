# Architecture — le contrat entre les outils

Tout outil du portail suit ce contrat. Il est court exprès : un outil
qui le tient se branche sur la bibliothèque, la file et l'en-tête sans
rien demander aux autres.

## 1. Le dépôt

```
index.html, accueil.js      l'accueil du portail (cartes des outils, compte, machines)
commun/                     tokens.css, base.css, shell.css, shell.js, porte.js/.css (la porte), fonts/
asset/ image/ movie/ …      une page par outil : index.html + <outil>.js + <outil>.css
admin/                      la page de Cal (§ 9)
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
fichier et sa vignette. Quatre sortes : `image`, `video`, `audio`,
`element`.

```jsonc
{
  "id": "ima-20260928-212233-a1b2",
  "kind": "image",                 // image | video | audio | element
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
`element.refs[].url`.

### Routes

| | |
|---|---|
| `GET /api/library?kind=image,element&q=&folder=&sort=new&limit=&offset=&fav=1&tool=` | `{items, total, counts, folders}` |
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
`jobRow(j)` dit la place (« 2 devant toi · départ ≈ 4 min »).

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
| Asset | `/api/asset/view`, `move`, `folders/rename`, `lineage/<id>`, `trash`, `trash/<id>/thumb`, `refs/<id>`, `cf/refresh` | — | — |
| Image | `/api/image/models`, `compose` (le prompt envoyé), `generate`, `edit`, `redo` | `image.generate`, `image.edit` (voie image) | `"image_backend": "comfyui"` |
| Movie Creator | `/api/movie/options`, `plan` (le graphe H3), `loras`, `element-image`, `assist`, `h3`, `h3/start`, `h3/stop` | `movie.t2v`, `movie.i2v`, `movie.r2v` (voie h3) | `"movie_engine": "h3"` ; `h3_idle_minutes`, `h3_min_free_gb` |
| Montage | `/api/montage/meta`, `projects…` (créer, enregistrer, renommer, dupliquer, supprimer, `plan`), `wave/<id>` | `montage.export` (voie cpu, ffmpeg) | — |
| Musique | `/api/music/projects…`, `engines`, `generate`, `stems` | `music.generate`, `music.stems` | `"music_engine": "ace-step"` |
| Object Creator | `/api/objet/state`, `objects` | `objet.mesh` (TRELLIS.2), `objet.mesh_factice` | `"objet_trellis": true` |
| Movie Analysis | `/api/analyse/list`, `projets`, `diarisation`, `chaine`, `nom/<nom>`, `run`, `diar/*` (relais vers DGX1 :10002) | `analyse.run` (voie analyse, une à la fois) | — |
| Upscale | `/api/upscale/models`, `plan`, `run` | `upscale.image`, `upscale.video` (voie image ; cpu en factice) | `"upscale_backend": "comfyui"` |
| Character Factory | `/character/api/*`, `/character/files/*`, `/character/v1/*` : relais en flux vers le studio de DGX1 | (la file du studio, sur DGX1) | — |

**Déposer un asset** : tout bloc qui attend un asset passe par `dropZone()`
de `commun/shell.js` (fichier du disque → bibliothèque avec `tool: upload`,
`via: <outil>` ; ou vignette glissée, type `application/x-sr-item`). Les
vignettes se glissent par `dragItem()`. Ce qu'un outil fabrique garde son
nom d'outil ; seul ce que quelqu'un dépose est « Upload ».

## 8. Plus tard : la porte Cloudflare

Les pages n'ont que des chemins relatifs et une base d'API réglable
(`window.SR_API`) : elles pourront être servies par Cloudflare (Pages ou
Workers, sous *.workers.dev — Cal n'a pas de domaine) pendant que l'API
reste sur DGX2 derrière un tunnel sortant. Rien n'est ouvert sur internet
tant que l'audit de sécurité n'est pas soldé (`docs/etudes/cloudflare.md`,
squelette de Worker non déployé dans `porte/`).

## 9. La porte du portail et la page de Cal

`server/core/auth.py`, posée par le socle devant chaque requête
(`app.gate`, `app.after` dans `core/http.py`) : **un outil n'a rien à
changer**. Un compte = un nom ; un appareil = un jeton aléatoire en cookie
`sr_session` (`HttpOnly; SameSite=Lax`), dont le serveur ne garde que
l'empreinte (`<data_dir>/auth.json`).

| sans session | avec |
|---|---|
| les pages se servent et montrent la porte (`commun/porte.js`, chargée par `mountHeader` ou un 401) | tout |
| `/api/…` (sauf `/api/auth/…`), les relais (`/character/…`), `/library/…` : **401** | selon le rôle : `/api/admin/…` et `POST /api/movie/h3/stop` à Cal seul (403) |

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

| Routes de la porte (`server/tools/compte.py`) | |
|---|---|
| `GET /api/auth/me` | `{auth, state: anonymous pending active refused suspended, user}` |
| `POST /api/auth/request {name}` · `/cancel` | demander l'accès (le cookie lie ce navigateur), annuler |
| `POST /api/auth/code {name, code}` | entrer par le code de Cal (`<data_dir>/admin-code.txt`) ou un code de liaison |
| `POST /api/auth/link` · `GET /api/auth/devices` · `POST /api/auth/devices/<id>/revoke` · `POST /api/auth/logout` | ses appareils |

| Routes de Cal (`server/tools/admin.py`, page `admin/`) | |
|---|---|
| `GET /api/admin/state` | demandes, personnes (quotas, compte du jour, derniers travaux), réglages, la file entière |
| `POST /api/admin/requests/<id>/accept` · `/refuse` | les demandes |
| `POST /api/admin/users/<id> {state, quotas}` · `GET …/devices` · `POST …/devices/<sid>/revoke` | suspendre (ses travaux en file s'en vont), quotas, appareils |
| `POST /api/admin/settings {visibility, admin_first, quotas, total_queued}` | les réglages |
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
