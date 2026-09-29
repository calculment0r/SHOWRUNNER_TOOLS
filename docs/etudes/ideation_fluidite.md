# Étude — une planche de mille images qui reste fluide (29/09/2026)

Demande de Cal (29/09) : « MIRO gère super bien un grand nombre d'images car
je crois qu'ils font des proxys avec plusieurs résolutions... mets un agent
sur cette étude de fluidité. »

L'UX des groupes et des cadres est dans `docs/etudes/ideation_miro.md` ; le
canvas lui-même dans `docs/etudes/ideation.md`.

## En bref

Mesuré sur DGX2, planche de 1000 images, avant → prototype (§ 3) :

- **ouvrir** : 14,7 s → 0,8 s ; 2004 → 1246 requêtes, dont 1004 → 6 à l'API ;
- **déplacer** à 100 % : 43 → 60 images/s ; **zoomer** jusqu'à 200 % : 29 → 60
  images/s ;
- **zoomer à 200 %** télécharge 1583 Mo (779 originaux, pour 9 images vues)
  → 0,7 Mo ;
- **rouvrir** : 1592 Mo → 1,2 Mo ;
- **mémoire** du navigateur : 3,1 Go → 1,0 Go.

Le premier coupable n'est pas l'image : le serveur du portail attend 41 ms à
chaque requête sur une connexion gardée ouverte (l'algorithme de Nagle). Une
ligne le corrige (§ 4.1), pour tous les outils du portail.

## 1. Comment font les autres

| outil | rendu | résolutions | hors de la vue | limite |
|---|---|---|---|---|
| **Figma** | moteur à tuiles, WebGL (2015), WebGPU (2025) : « a highly-optimized tile-based engine » [1][2] | une basse et une haute résolution par image ; « High-resolution images are images larger than 512 by 512 pixels » [3] | « Figma only downloads high quality versions of images in your current viewport » ; ailleurs, la basse [3] | une image importée est ramenée à 4096 px de grand côté [4] |
| **tldraw** | DOM (HTML, SVG) | la page demande l'image à la taille vue : `steppedScreenScale`, « screenScale rounded up to the next power of 2, useful for tiered caching », × `dpr` [5] ; « A 4000px-wide photo zoomed out to take up 200px on screen […] you'd serve a 250px-wide image » [6] | « hides off-screen shapes by setting `display: none` », index spatial ; le choisi n'est jamais caché [6] | 4000 formes par page par défaut ; zoom « efficace » stable pendant le mouvement au-delà de 500 formes [6] |
| **Miro** | non documenté publiquement | basse résolution de loin, pleine en zoomant — dit par des utilisateurs (2021) et un modérateur bénévole : « only render objects like images and PDFs until you zoom in on them » [7][8] ; pas de page officielle trouvée | — | l'aide conseille moins de 5000 objets, une gêne possible dès 1000, 100 000 au plus ; les images en haute définition ralentissent (moteur) [9] |
| **Excalidraw** | canvas 2D | une seule : l'image est ramenée à 1440 px de grand côté et 2 Mo à l'insertion, « Performance is the biggest one » (mainteneur, 22/11/2021) [10] | seuls les éléments dans la vue sont dessinés (`getVisibleCanvasElements` → `isElementInViewport`) [11] | — |
| **PureRef** | application native | « Zoom quality » haute ou basse (plus propre de loin, mais plus de mémoire), « Auto downscale images » à l'ajout [12] ; « Optimize images » réduit pour de bon [13] | « PureRef will hold all loaded images in memory uncompressed » (2020) [14] | la mémoire |
| **Milanote** | web | rien d'officiel trouvé sur son rendu | — | — |

Côté navigateur, ce qui compte ici :

- **six connexions** par origine en HTTP/1.1, au-delà la requête attend
  (« Queueing ») [15] : 1000 requêtes passent par six tuyaux ;
- `img.decode()` décode une image avant qu'on la montre : « prevents the
  rendering of the next frame after adding the image to the DOM from causing a
  delay » [16] ;
- `content-visibility: auto` saute le style, la mise en page et la peinture de
  ce qui est hors de l'écran (×7 sur l'exemple de web.dev) [17] — une variante
  du culling, non mesurée ici ;
- `createImageBitmap` sert aux moteurs en canvas / WebGL (décoder hors du fil
  principal vers une texture) ; pas à une planche en DOM.

**Ce qu'on en tire.** Tous font deux choses : l'image est **servie à la taille
où elle est vue** (Figma à deux niveaux, tldraw par puissances de deux), et
**ce qui est hors de la vue ne coûte rien** (tldraw `display: none`, Excalidraw
ne dessine pas, Figma ne charge pas la haute). Aucun ne découpe les images en
tuiles : les tuiles servent une image plus grande que l'écran (une carte,
une lame de microscope) ; une planche montre beaucoup d'images petites.

## 2. Ce que coûte notre canvas (lu dans le code, puis mesuré)

1. **Le serveur attend 41 ms par requête.** `server/core/http.py` envoie
   l'en-tête puis le corps en deux écritures, sur une connexion gardée ouverte
   (HTTP/1.1) ; avec l'algorithme de Nagle, la seconde attend l'accusé de
   réception, que le client retarde (40 ms sous Linux). Mesuré au curl sur
   DGX2 : 100 vignettes sur une connexion en 4 120 ms, 100 fiches JSON en
   4 086 ms ; avec `disable_nagle_algorithm = True` (le réglage de
   `socketserver.StreamRequestHandler`, dans le code de Python 3.12 : « Disable
   nagle algorithm for this socket, if True »), 34 ms. Sous Windows, le PC de
   Cal, l'accusé retardé peut atteindre ~200 ms [18] : **non mesuré depuis le
   PC** (aucune commande n'y tourne), à vérifier.
2. **Une requête par image pour ouvrir.** `ensureItems` (`ideation.js`) lit
   `GET /api/library/<id>` pour chaque objet, huit à la fois : 1004 requêtes
   pour 1000 images, 9,4 s avant que la planche ait ses images.
3. **Le panneau de la bibliothèque** charge 240 vignettes à l'ouverture (en
   `background-image`, jamais différées), sur les mêmes six connexions.
4. **Rien ne se garde en cache.** Les fichiers partent en `Cache-Control:
   no-cache` sans `ETag` ni `Last-Modified` : le navigateur ne peut pas
   demander « a-t-il changé ? » ; il retélécharge tout à chaque ouverture.
5. **Deux résolutions, appliquées à toute la planche.** `pickSrc`
   (`canvas.js`) : la vignette 384 px (JPEG, `library.THUMB`) ou l'original,
   selon `n.w × z × dpr > 400`, et `swapRes` le fait pour **tous** les objets,
   pas ceux qu'on voit. À 200 % (écran ordinaire) ou dès 100 % (écran de
   densité 2), chaque original de la planche part : 1,58 Go pour 9 images
   vues.
6. **Le premier rendu se fait avant l'ajustement** (`openBoard` : `render()`
   puis `fit()`) : il choisit les images au zoom 1. Sur un écran de densité 2,
   c'est 1,2 Go d'originaux à l'ouverture.
7. **Le style de toute la planche se recalcule à chaque image d'un geste.**
   `applyView` pose `--gx`, `--gy`, `--gs` (la trame) et `--z` sur `.cv` ; une
   variable CSS est héritée par chaque descendant, et les ~7900 éléments de la
   planche se restylent : 20 ms de style par image pendant un déplacement,
   25 ms (style + mise en page) pendant un zoom, à 1000 images
   (`RecalcStyleDuration`, mesuré). Au-delà de 16 ms, l'image saute.
8. **Tout est peint**, même hors de la vue : aucun objet n'est jamais écarté.

## 3. La mesure

### 3.1 Le banc

- **Copie jetable** : `dgx2:/tmp/sr_ide_perf`, clone de `~/SHOWRUNNER_TOOLS`
  au commit `1f64157`, sans `origin` (rien ne peut partir), port **8804**,
  données à part `/tmp/sr_ide_perf_data`, porte coupée (`"auth": false`), voies
  de calcul vers une adresse morte. Relance : `/tmp/sr_ide_perf_run.sh`.
- **Les images** (`/tmp/perf_seed.py`, PIL) : 1000 images fabriquées — un
  champ de couleurs lisse, des formes floutées, du grain à trois échelles
  (pour que la vignette pèse comme celle d'une photo). Tailles tirées au sort
  parmi celles que Cal pose : sorties de modèles en PNG 1024², 832×1216,
  1216×832, 768×1344, 1344×768, 1536×1024, 2048², photos en JPEG (q90)
  1920×1080, 4032×3024, 3024×4032, 2400×1600. Originaux : 1,95 Mo en moyenne
  (1954 Mo en tout) ; vignettes 384 du socle : 20 ko. Trois planches en grille
  (200, 500, 1000 images, 280 px de grand côté comme `app.sizeFor`).
- **Le navigateur** : Chromium sans affichage de Playwright (celui de
  `~/Character_Sheet`), 1600 × 1000, sur le GPU de DGX2 (NVIDIA GB10 par
  ANGLE / Vulkan) ; en contre-épreuve, le rendu logiciel (SwiftShader), comme
  un poste sans accélération.
- **Le scénario** (`/tmp/perf_measure.mjs`), un navigateur neuf par planche
  (cache vide, pas de vue gardée : la planche s'ouvre ajustée) : ouvrir ;
  3 s de va-et-vient à la vue ajustée ; 2 s de zoom continu jusqu'à 100 % ;
  3 s de va-et-vient à 100 % (1800 px de chaque côté) ; 1,5 s de zoom jusqu'à
  200 % ; recharger la page. Les mouvements suivent l'horloge (chaque essai
  finit au même endroit) et passent par les fonctions de l'app
  (`applyView`, `zoomBy`), une fois par `requestAnimationFrame`.
- **Ce qu'on compte** : « images/s » = les images réellement présentées à
  l'écran (trace Chromium, `PipelineReporter`, états `PRESENTED_*`), entre
  parenthèses les rappels rAF (le fil principal suit-il ?) ; images perdues
  (`STATE_DROPPED` qui comptent pour la fluidité) ; ms de style et de mise en
  page par image (`Performance.getMetrics`) ; octets et requêtes (protocole
  DevTools) ; mémoire = RSS des processus du navigateur ; nœuds DOM.
- **Ce que le banc ne dit pas** : serveur et navigateur sont sur la même
  machine (le réseau est au mieux) ; le Wi-Fi est simulé (25 Mo/s, +3 ms par
  requête : une hypothèse pour le 5 GHz du PC vers DGX2, non mesurée) ; DGX2
  travaillait pour d'autres sessions (charge 17 à 23) : les chiffres du rendu
  logiciel varient de ±20 % d'une passe à l'autre, ceux du GPU non. Le GPU et
  le système du PC de Cal ne sont pas ceux-là : ce sont les écarts qui
  comptent.

### 3.2 Les résultats

« Nagle seul » = le code d'aujourd'hui plus la seule ligne du § 4.1.

#### A. GPU, densité 1, réseau local

| mesure | 200 · avant | 200 · Nagle seul | 200 · prototype | 500 · avant | 500 · Nagle seul | 500 · prototype | 1000 · avant | 1000 · Nagle seul | 1000 · prototype |
|---|---|---|---|---|---|---|---|---|---|
| ouvrir : planche posée | 2,7 s | 0,4 s | 0,7 s | 5,5 s | 0,5 s | 0,5 s | 9,4 s | 0,8 s | 0,7 s |
| ouvrir : images visibles chargées | 4,7 s | 0,5 s | 1,0 s | 9,0 s | 0,7 s | 0,5 s | 14,7 s | 1,2 s | 0,8 s |
| ouvrir : requêtes (dont fiches API) | 644 (204) | 644 (204) | 445 (5) | 1244 (504) | 1244 (504) | 745 (5) | 2004 (1004) | 2004 (1004) | 1246 (6) |
| ouvrir : Mo téléchargés | 9,3 | 9,3 | 7,1 | 15,7 | 15,7 | 9,7 | 21,5 | 21,5 | 14,1 |
| nœuds DOM | 3088 | 3088 | 3088 | 4888 | 4888 | 4888 | 7888 | 7888 | 7888 |
| pan, vue ajustée : images/s (rAF) | 59,7 (59,7) | 60 (60) | 60 (60) | 59,7 (59,7) | 60 (60) | 59,7 (60) | 56 (37,6) | 56 (39,6) | 60 (60) |
| pan, vue ajustée : style ms/image | 4,9 | 4,1 | 0,1 | 8,3 | 7,5 | 0,2 | 20,8 | 19,9 | 0,2 |
| zoom → 100 % : images/s (rAF) | 58,5 (58) | 56,5 (57) | 58 (59) | 57 (54,5) | 55 (53,6) | 50,5 (50,6) | 27,5 (22,1) | 29 (22,8) | 46 (41,7) |
| zoom → 100 % : style + mise en page ms/image | 5,8 | 4,2 | 0,3 | 9,6 | 9,5 | 0,5 | 24,6 | 23,9 | 1,3 |
| pan à 100 % : images/s (rAF) | 59,7 (60) | 59,7 (60) | 60,3 (60) | 59,7 (59,7) | 59,3 (59,7) | 60 (60) | 42,7 (37,8) | 42 (37,6) | 60 (60) |
| pan à 100 % : images perdues / 180 | 0 | 0 | 0 | 1 | 1 | 0 | 52 | 54 | 0 |
| zoom → 200 % : images/s (rAF) | 60,7 (60) | 60 (60) | 60 (60) | 59,3 (58,7) | 58,7 (57,4) | 60 (60) | 28,7 (25,4) | 28,7 (27,4) | 60 (60) |
| après zoom 200 % : Mo (originaux) | 293 (151) | 293 (151) | 0,7 (0) | 771 (387) | 771 (387) | 0,7 (0) | 1583 (779) | 1583 (779) | 0,7 (0) |
| après zoom 200 % : visibles nettes | 0,4 s | 0,5 s | 0,3 s | 1,0 s | 1,0 s | 0,3 s | 1,9 s | 2,2 s | 0,3 s |
| mémoire du navigateur (RSS, Mo) | 1392 | 1391 | 844 | 2230 | 2214 | 901 | 3124 | 3121 | 1018 |
| rouvrir : Mo téléchargés | 299 | 299 | 0,4 | 778 | 778 | 0,7 | 1592 | 1592 | 1,2 |
| rouvrir : images visibles | 3,7 s | 0,7 s | 0,2 s | 6,5 s | 1,3 s | 0,4 s | 11,5 s | 3,0 s | 0,8 s |

#### B. Wi-Fi simulé (25 Mo/s, +3 ms par requête), 1000 images

| mesure | avant | prototype |
|---|---|---|
| ouvrir : images visibles chargées | 15,0 s | 2,1 s |
| pan à 100 % : images/s | 42,7 | 60 |
| après zoom 200 % : Mo (originaux) | 1430 (714), pas fini en 30 s | 0,7 (0), nettes en 0,3 s |
| rouvrir : Mo · images visibles | 1543 Mo · 44,0 s | 1,2 Mo · 0,9 s |
| mémoire (RSS, Mo) | 3006 | 1016 |

#### C. Écran de densité 2 (Retina, 4K à 200 %), 1000 images

| mesure | avant | prototype |
|---|---|---|
| ouvrir : Mo · images visibles | 1202 Mo (779 originaux, § 2.6) · 18,5 s | 15,1 Mo · 0,8 s |
| pan, vue ajustée : images/s | 2 (le fil principal pris 3,5 s) | 60 |
| pan à 100 % : images/s | 42,7 | 59,3 |
| zoom → 200 % : images/s · Mo après | 30 · 371 Mo | 60 · 9,3 Mo (5 originaux : vues à leur taille) |
| mémoire (RSS, Mo) | 3721 | 1074 |
| rouvrir : Mo | 1961 | 1,2 |

#### D. Rendu logiciel (SwiftShader), 1000 images

| mesure | avant | prototype |
|---|---|---|
| ouvrir : images visibles chargées | 14,7 s | 1,5 s |
| pan, vue ajustée : images/s | 39,3 | 41 |
| zoom → 100 % : images/s | 15 | 17,5 |
| **pan à 100 % : images/s** | **38,7** | **16,7** |
| zoom → 200 % : images/s | 14,7 | 15,3 |
| après zoom 200 % : Mo | 1583 | 0,7 |
| mémoire (RSS, Mo) | 3378 | 2055 |

**Le recul du rendu logiciel** (pan à 100 % : 38,7 → 16,7), reproduit en
alternant avant / prototype deux fois (34-41 contre 17-18). Le fil principal
du prototype ne travaille plus que 5 à 10 ms par image (30 ms avant) : c'est le
raster logiciel qui ne suit pas. Écarté par la mesure : le culling (`?cull=off`
: 19,7), sa marge (`?cull=1` : 20,3), le format (copies JPEG `?ext=jpg` :
20,3), la taille (vignette 384 à la place de la copie 512, `?t384=1` : 15,7),
`@property` (la trame posée sur le fond : 19,3). Mettre la planche sur son
propre calque pendant le geste (`will-change: transform`, `?wc=1`) le relève
(pan à 100 % : 52,7 ; zoom 200 % : 40), mais divise par deux la vue ajustée
où les 1000 images sont à l'écran (19 en logiciel, 31 sur GPU) : pas retenu.
**Non expliqué**, et sans effet sur GPU (60 images/s partout). À mesurer sur
le PC de Cal avant de conclure (les interrupteurs `?wc=1`, `?cull=` restent
dans le prototype pour ça).

Reste aussi, sur GPU : le zoom continu de la vue ajustée à 100 % perd encore
13 à 31 images sur 120 à 1000 objets (une image de 166 ms au moment où ~980
objets sortent de la vue d'un coup) ; étaler le culling sur quelques images
(par exemple 200 objets par image) est la piste.

### 3.3 Les copies d'affichage, mesurées

Sur les 1000 images (WebP q82 ; en regard, les mêmes en JPEG q84) :

| copie | images | moyenne WebP | moyenne JPEG | en tout (WebP) |
|---|---|---|---|---|
| 256 | 1000 | 7,5 ko | 10,2 ko | 7,5 Mo |
| 512 | 1000 | 19,5 ko | 31,1 ko | 19,5 Mo |
| 1024 | 1000 | 69,1 ko | 106 ko | 69,1 Mo |
| 2048 | 230 (les images plus grandes) | 258 ko | 419 ko | 59,3 Mo |
| (vignette 384 du socle) | 1000 | — | 20,1 ko | 20,1 Mo |
| (original) | 1000 | — | — | 1954 Mo |

Les quatre copies : 155 Mo pour 1954 Mo d'originaux (**+8 %** sur le disque).
Les fabriquer : 143 ms par image sur un cœur (un seul décodage de l'original,
chaque copie tirée de la précédente), 1000 images en 14 s sur 16 cœurs.

## 4. Le plan

### 4.1 Le serveur (pour tout le portail)

1. **Nagle** : `disable_nagle_algorithm = True` dans le `Handler` de
   `server/core/http.py`. **Une ligne**, à faire d'abord : l'ouverture de 1000
   images passe de 14,7 s à 1,2 s à elle seule (tableau A, « Nagle seul »), et
   chaque page du portail (Asset, Montage…) en profite.
2. **Des validateurs** : un `ETag` sur chaque fichier servi, et `304` quand il
   n'a pas changé ; les copies d'affichage en `private, max-age=31536000,
   immutable` (leur nom dit ce qu'elles sont, elles ne changent jamais) ;
   `mount(…, cache=)` pour que le dossier de la bibliothèque choisisse
   fichier par fichier. Rouvrir : 1592 Mo → 1,2 Mo.
3. **Les fiches par lot** : `POST /api/library/batch {ids}` (2000 au plus),
   déclaré avant `POST /api/library/{item_id}` ; la page en demande 500 à la
   fois. 1004 requêtes → 6.
4. **Les copies d'affichage** `p256.webp`, `p512.webp`, `p1024.webp`,
   `p2048.webp` dans le dossier de l'objet, faites **à l'entrée** d'une image
   dans la bibliothèque (`library.add_file`) et, pour les images déjà là, par
   un travail de rattrapage sur la voie `cpu` (1000 images : 2,4 min sur un
   cœur). L'objet liste celles qui existent (`proxies`) : la page ne demande
   jamais une copie absente — juste par construction, pas de 404 à rattraper.

**Pourquoi 256 / 512 / 1024 / 2048** (et pas 256 / 1024 / original) — ce qu'il
faut, c'est `max(w, h) × zoom × densité`, pour un objet posé à 280 px :

| zoom | densité 1 | densité 2 | copie choisie (d1 · d2) |
|---|---|---|---|
| 0,1 (1000 images ajustées) | 28 px | 56 px | 256 · 256 |
| 0,3 | 84 px | 168 px | 256 · 256 |
| 0,5 | 140 px | 280 px | 256 · 512 |
| 1 (le travail) | 280 px | 560 px | 512 · 1024 |
| 2 | 560 px | 1120 px | 1024 · 2048 |
| 4 (le maximum, `ZMAX`) | 1120 px | 2240 px | 2048 · original |

- **Le pas de deux** (celui de tldraw [5]) garantit qu'on ne charge jamais plus
  de deux fois le côté nécessaire (quatre fois les pixels). Avec 256 puis
  1024, le cas le plus fréquent (100 %, densité 1 : 280 px) chargerait la
  1024 : 69 ko au lieu de 19,5 ko, et 2,9 Mo décodés en mémoire au lieu de
  0,7 Mo, par image. Pour 20 images à l'écran : 14 Mo contre 57 Mo.
- **256 en bas** : Figma coupe à 512 px entre basse et haute résolution [3] ;
  à 256, une planche de 1000 images ajustée tient en 7,5 Mo, et une image
  sortie de la vue garde de quoi s'afficher aussitôt qu'elle revient.
- **2048 en haut** : au-delà, seul un zoom de 400 % sur un écran de densité 2
  en a besoin ; Figma s'arrête à 4096 à l'import [4], Excalidraw à 1440 [10].
- **L'original seulement quand l'image est vue à sa taille ou plus** (on
  regarde ses pixels : sans perte). Une image de 1024 a sa copie 1024 (69 ko
  contre 1,7 Mo pour le PNG).
- **WebP** : 26 à 38 % plus léger que le JPEG à qualité voisine (§ 3.3), et il
  garde l'alpha d'une image détourée (la vignette JPEG d'aujourd'hui le perd :
  `make_thumb` passe en RVB). Le décodage n'est pas en cause (§ 3.2 D). AVIF :
  non disponible dans le PIL de DGX2.
- **Pas de tuiles** (§ 1) : aucune de nos images ne dépasse l'écran de
  beaucoup ; des tuiles seraient une usine à gaz pour rien.

### 4.2 La page

5. **Choisir la copie** : la plus petite dont le côté couvre `max(w, h) × z ×
   devicePixelRatio`, au-delà de 2048 l'original ; seulement pour ce qui est
   dans la vue ; 220 ms après le geste (jamais pendant) ; une image qu'on
   regarde ne redescend pas (pas de va-et-vient au seuil) ; une image qui sort
   de la vue retombe à 256 (la mémoire suit ce qu'on voit) ; la nouvelle copie
   est décodée (`img.decode()` [16]) avant de remplacer l'ancienne : pas de
   trou, pas de clignotement.
6. **Écarter ce qui est hors de la vue** : `display: none` au-delà d'une marge
   d'un quart d'écran (tldraw [6]) ; un objet où l'on écrit reste affiché. Le
   DOM garde ses 7888 nœuds : ce ne sont pas eux qui coûtent, c'est le style
   et la peinture (tableau A). Pas de virtualisation plus poussée.
7. **Ne plus restyler la planche pendant un geste** : la trame se pose sur le
   fond de `.cv` (`background-size`, `background-position`), pas par des
   variables héritées ; `--z` (dont dépendent les filets et poignées en 1/z)
   se pose 150 ms après le dernier mouvement — le zoom « efficace » de tldraw
   [6]. Style par image : 20 ms → 0,2 ms.
8. **Ajuster avant le premier rendu** à l'ouverture (§ 2.6) — pas fait dans le
   prototype, où la règle du point 5 limite déjà le dégât (≈16 images en 1024
   au lieu de 256).
9. **Le panneau de la bibliothèque** : des `<img loading="lazy">` sur la copie
   256 au lieu de 240 `background-image` — pas fait dans le prototype.
10. Plus tard, si le besoin se mesure : la liste « Plan » de l'inspecteur (une
    ligne par objet, 1000 lignes) ; les copies pour les références des
    éléments et les affiches des vidéos ; `MAX_NODES` (3000,
    `server/tools/ideation.py`) reste la borne, de l'ordre des 4000 de tldraw.

**DOM, canvas 2D ou WebGL ?** On reste en DOM, comme tldraw : avec les points
5 à 7, 1000 images tiennent 60 images/s sur GPU (tableau A) ; un moteur en
canvas ou en WebGL (Figma, « a browser inside a browser » [1]) obligerait à
refaire l'écriture des notes, la carte Générer, la vidéo, le son. Ce serait
l'usine à gaz que Cal veut éviter.

### 4.3 Dans quel ordre

1. Nagle (une ligne, tout le portail) ; `ETag` / 304 ; fiches par lot.
2. Les copies à l'entrée + le rattrapage ; `proxies` dans l'objet ; cache
   immuable.
3. La page : copie choisie, culling, trame et zoom efficace, ajuster avant le
   premier rendu.
4. Mesurer sur le PC de Cal (Windows, son GPU, le vrai Wi-Fi) avec le même
   scénario ; trancher `will-change` et le culling étalé.

Chaque étape passe par `tools/check.py` (le prototype : 613 passés, 0 en
échec) et le `selftest` d'`ideation.py` gagne : copies présentes après un
dépôt, `304` sur un `If-None-Match`, fiches par lot (présentes, absentes,
invisibles).

## 5. Le prototype jetable (DGX2, pas dans le dépôt)

- **Copie** : `dgx2:/tmp/sr_ide_perf`, branches locales `main` (l'avant),
  `perf-nagle` (Nagle seul), `perf-proto` (le prototype) ; pas d'`origin`.
  Données : `/tmp/sr_ide_perf_data` ; réglages : `/tmp/sr_ide_perf/showrunner.local.json`.
- **Lancer** : `ssh dgx2 /tmp/sr_ide_perf_run.sh` (port 8804, PID dans
  `/tmp/sr_ide_perf.pid`) ; ouvrir `http://192.168.10.247:8804/ideation/#ide-20260929-001000-0000`
  (planches `…-000200-0000`, `…-000500-0000`, `…-001000-0000`).
- **Semer** : `/tmp/perf_seed.py` ; les copies ont été faites par
  `library.make_proxies` (le rattrapage, en parallèle).
- **Mesurer** : `node /tmp/perf_measure.mjs http://127.0.0.1:8804 <étiquette> '[200,500,1000]' '{"dpr":1,"net":"local","gpu":"nvidia"}'`
  (`net` : `local` | `wifi` ; `gpu` : `nvidia` | `swiftshader` ; `q` : une
  requête d'essai, `cull=off`, `wc=1`…) ; la campagne entière :
  `/tmp/sr_ide_perf_campagne.sh` puis `/tmp/sr_ide_perf_campagne2.sh` ; les
  tableaux : `python3 /tmp/perf_table.py`. Résultats bruts :
  `/tmp/sr_ide_perf_<branche>_<réseau>_dpr<n>_<gpu>.json`.
- **Captures** du prototype (ajustée, 100 %, 200 %, 400 %, en plein geste) :
  `/tmp/sr_ide_perf_shots/apres/` (`/tmp/perf_shots.mjs`) — les images sont
  là en plein déplacement, aucune ne manque.
- **Contrôle** : `python3 tools/check.py` sur `perf-proto` : 613 passés, 0 en
  échec.

Le diff (`git diff main perf-proto`, 218 lignes ajoutées, 19 retirées ; les
lignes `essai :` sont les interrupteurs du § 3.2, inertes sans leur
paramètre) :

```diff
diff --git a/ideation/canvas.js b/ideation/canvas.js
--- a/ideation/canvas.js
+++ b/ideation/canvas.js
@@ -101,25 +101,74 @@ export function createCanvas(app) {
   // ── la vue ────────────────────────────────────────────────
-  let viewT = 0, resT = 0;
+  let viewT = 0, resT = 0, zT = 0, zShown = null;
+  // PROTO fluidité : --z est hérité par chaque objet (filets, poignées en 1/z) ;
+  // le changer à chaque image du zoom recalcule le style de toute la planche
+  // (20 ms par image à 1000 images, mesuré). Pendant le geste, la planche
+  // garde le zoom « efficace » d'avant ; il se pose 150 ms après (l'idée de
+  // getEfficientZoomLevel chez tldraw). La trame ne passe plus par --gs,
+  // --gx, --gy : elle se pose sur le fond de .cv, qui seul se restyle.
+  function showZ(z) {
+    zShown = z;
+    cv.style.setProperty('--z', z);
+    cv.classList.toggle('far', z < 0.42);
+  }
   function applyView() {
     const v = V();
     world.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.z})`;
-    cv.style.setProperty('--z', v.z);
+    moving();
+    if (zShown === null) showZ(v.z);
+    else if (v.z !== zShown) { clearTimeout(zT); zT = setTimeout(() => showZ(V().z), 150); }
     const g = GRID * v.z * (v.z < 0.3 ? 4 : v.z < 0.6 ? 2 : 1);
-    cv.style.setProperty('--gs', `${g}px`);
-    cv.style.setProperty('--gx', `${v.x}px`);
-    cv.style.setProperty('--gy', `${v.y}px`);
+    // PROTO fluidité : la trame posée sur le fond lui-même, sans variable héritée
+    // par les objets (mesuré : 20 ms de style par image à 1000 objets)
+    cv.style.backgroundSize = `${g}px ${g}px`;
+    cv.style.backgroundPosition = `${v.x}px ${v.y}px`;
     cv.classList.toggle('nogrid', !S.grid);
     gridB.classList.toggle('on', !!S.grid);
-    cv.classList.toggle('far', v.z < 0.42);
     pct.textContent = `${Math.round(v.z * 100)} %`;
     paintMini();
+    scheduleCull();
     clearTimeout(viewT);
     viewT = setTimeout(() => { if (S.board) app.LS('view-' + S.board.id, S.view); }, 400);
     clearTimeout(resT);
     resT = setTimeout(swapRes, 220);
   }
+  // PROTO fluidité : hors de la vue (plus une marge d'un quart d'écran), un
+  // objet n'est ni stylé ni peint (display: none, comme le « culling » de
+  // tldraw) ; un objet où l'on écrit reste affiché
+  let cullF = 0;
+  // essai : ?cull=off (jamais caché), ?cull=1 (marge d'un écran entier) ; défaut 0,25
+  const CULL = new URLSearchParams(location.search).get('cull');
+  const CM = CULL === 'off' ? 1e6 : CULL ? +CULL : 0.25;
+  // essai : ?wc=1 — la planche sur son propre calque pendant un geste (le compositeur la déplace sans la repeindre)
+  const WC = new URLSearchParams(location.search).get('wc');
+  let wcT = 0;
+  function moving() {
+    if (!WC) return;
+    world.style.willChange = 'transform';
+    clearTimeout(wcT);
+    wcT = setTimeout(() => { world.style.willChange = ''; }, 200);
+  }
+  function scheduleCull() { if (!cullF) cullF = requestAnimationFrame(() => { cullF = 0; cull(); }); }
+  function cullRect() {
+    const r = viewRect(), mx = r.w * CM, my = r.h * CM;
+    return { x: r.x - mx, y: r.y - my, w: r.w + 2 * mx, h: r.h + 2 * my };
+  }
+  function cull() {
+    const q = cullRect();
+    for (const n of S.board?.nodes || []) {
+      const d = dom.get(n.id);
+      if (!d) continue;
+      // le nom d'un cadre est posé au-dessus de lui : la marge le couvre
+      const off = !hits(n, q) && !d.el.contains(document.activeElement);
+      if (d.off !== off) {
+        d.off = off;
+        d.el.style.display = off ? 'none' : '';
+        if (off) lowRes(n, d.el);
+      }
+    }
+  }
   const rect = () => cv.getBoundingClientRect();
@@ -147,18 +196,54 @@ export function createCanvas(app) {
-  // une image posée en grand se lit en pleine définition, de loin sa vignette
+  // PROTO fluidité : la copie d'affichage à la taille où l'image est vue —
+  // la plus petite dont le grand côté couvre max(w, h) × zoom × densité de
+  // pixels ; au-delà de la plus grande, l'original. Seulement pour ce qui
+  // est dans la vue, et jamais pendant le geste (220 ms après) ; une image
+  // qu'on regarde ne redescend pas (pas de va-et-vient), une image qui sort
+  // de la vue retombe à la plus petite (la mémoire suit ce qu'on voit).
   function swapRes() {
     for (const n of S.board?.nodes || []) {
       if (n.type !== 'media' || n.kind !== 'image') continue;
-      const img = dom.get(n.id)?.el.querySelector('img');
+      const d = dom.get(n.id);
+      if (!d || d.off) continue;
+      const img = d.el.querySelector('img');
       const it = S.items.get(n.item);
       if (!img || !it || it.missing) continue;
-      const want = href(pickSrc(n, it));
-      if (img.src !== want) img.src = want;
+      const want = pickSrc(n, it);
+      if (!it.proxies) { setSrc(img, href(want.url)); continue; }
+      if (want.size > (+img.dataset.size || 0)) setSrc(img, href(want.url), want.size);
     }
   }
-  const pickSrc = (n, it) => (n.w * V().z * (devicePixelRatio || 1) > 400 && it.url ? it.url : it.thumb_url || it.url);
+  const ORIG = 1e9;
+  // essai : ?ext=jpg — les mêmes copies en JPEG (comparer le décodage WebP / JPEG)
+  const EXT = new URLSearchParams(location.search).get('ext');
+  const pu = (p) => (p && EXT ? { ...p, url: p.url.replace(/\.webp$/, '.' + EXT) } : p);
+  // essai : ?t384=1 — la vignette JPEG 384 du socle à la place de la copie 512
+  const T384 = new URLSearchParams(location.search).get('t384');
+  function pickSrc(n, it, z = V().z) {
+    const need = Math.max(n.w, n.h) * z * (devicePixelRatio || 1);
+    if (!it.proxies) return { url: n.w * z * (devicePixelRatio || 1) > 400 && it.url ? it.url : it.thumb_url || it.url, size: 0 };
+    const list = T384 ? it.proxies.map((x) => (x.size === 512 ? { size: 384, url: it.thumb_url } : x)) : it.proxies;
+    const p = list.find((x) => x.size >= need);
+    return pu(p) || { url: it.url, size: ORIG };
+  }
+  function lowRes(n, e) {
+    const it = n.type === 'media' && n.kind === 'image' ? S.items.get(n.item) : null;
+    const img = it?.proxies && e.querySelector('img');
+    if (img && +img.dataset.size > it.proxies[0].size) setSrc(img, href(pu(it.proxies[0]).url), it.proxies[0].size);
+  }
+  // décodée avant d'être montrée : l'image ne clignote pas, le fil principal ne décode pas
+  function setSrc(img, url, size) {
+    if (img.dataset.want === url) return;
+    img.dataset.want = url;
+    const done = () => { if (img.dataset.want === url) { img.src = url; if (size) img.dataset.size = size; } };
+    if (!img.getAttribute('src')) { done(); return; }
+    const pre = new Image();
+    pre.decoding = 'async';
+    pre.src = url;
+    pre.decode().then(done, done);
+  }
@@ -220,7 +305,11 @@ export function createCanvas(app) {
     const cap = el('span', { class: 'cap' }, it.title || it.id);
-    if (n.kind === 'image') return [el('img', { src: href(pickSrc(n, it)), alt: it.title || '', draggable: 'false' }), cap];
+    if (n.kind === 'image') {
+      // PROTO fluidité : posée hors de la vue, la plus petite copie ; dans la vue, celle de sa taille à l'écran
+      const p = it.proxies && !hits(n, cullRect()) ? pu(it.proxies[0]) : pickSrc(n, it);
+      return [el('img', { src: href(p.url), 'data-want': href(p.url), 'data-size': p.size || null, decoding: 'async', alt: it.title || '', draggable: 'false' }), cap];
+    }
@@ -266,6 +355,7 @@ export function createCanvas(app) {
     for (const [id, d] of dom) if (!seen.has(id)) { d.el.remove(); dom.delete(id); }
+    cull();
     measure();
diff --git a/ideation/ideation.css b/ideation/ideation.css
--- a/ideation/ideation.css
+++ b/ideation/ideation.css
@@ -81,6 +81,9 @@ body.nolib .lib { visibility: hidden; }
 /* ── la planche ────────────────────────────────────────── */
+/* PROTO fluidité : la trame bouge à chaque image d'un déplacement ; la page
+   pose background-size / background-position sur .cv même (canvas.js) : des
+   variables héritées feraient recalculer le style de tous les objets */
 .cv {
diff --git a/ideation/ideation.js b/ideation/ideation.js
--- a/ideation/ideation.js
+++ b/ideation/ideation.js
@@ -488,9 +488,14 @@ app.boardsModal = async () => {
 async function ensureItems(ids) {
   const want = [...new Set(ids)].filter((id) => !S.items.has(id));
-  for (let i = 0; i < want.length; i += 8) {
-    await Promise.all(want.slice(i, i + 8).map((id) => api('library/' + id)
-      .then((it) => S.items.set(id, it)).catch(() => S.items.set(id, { id, missing: true }))));
+  // PROTO fluidité : les fiches par paquets de 500, en une requête chacun (au lieu d'une par objet)
+  for (let i = 0; i < want.length; i += 500) {
+    const chunk = want.slice(i, i + 500);
+    try {
+      const r = await api('library/batch', { method: 'POST', body: { ids: chunk } });
+      for (const it of r.items) S.items.set(it.id, it);
+      for (const id of r.missing) S.items.set(id, { id, missing: true });
+    } catch { for (const id of chunk) S.items.set(id, { id, missing: true }); }
   }
 }
diff --git a/server/core/http.py b/server/core/http.py
--- a/server/core/http.py
+++ b/server/core/http.py
@@ -167,15 +167,19 @@ class App:
         self.mount_checks: dict[str, callable] = {}
+        self.mount_cache: dict[str, callable] = {}
 
-    def mount(self, prefix: str, folder: Path, check=None) -> None:
+    def mount(self, prefix: str, folder: Path, check=None, cache=None) -> None:
         self.mounts[prefix.strip("/") + "/"] = folder.resolve()
         if check:
             self.mount_checks[prefix.strip("/") + "/"] = check
+        # PROTO fluidité : la politique de cache d'un dossier monté, fichier par fichier
+        if cache:
+            self.mount_cache[prefix.strip("/") + "/"] = cache
@@ -216,7 +220,11 @@ class App:
                 if check and not check(rel[len(prefix):]):
                     raise HttpError(404, "introuvable")
-                return self._file(folder, rel[len(prefix):])
+                f = self._file(folder, rel[len(prefix):])
+                pol = self.mount_cache.get(prefix)
+                if pol:
+                    f.cache = pol(rel[len(prefix):])
+                return f
@@ -239,6 +247,11 @@ class App:
         class Handler(BaseHTTPRequestHandler):
             protocol_version = "HTTP/1.1"
             server_version = "Showrunner/1"
+            # PROTO fluidité : l'en-tête et le corps partent en deux écritures ;
+            # avec Nagle, la seconde attend l'accusé de réception que le client
+            # retarde (40 ms sous Linux) : 41 ms par requête sur une connexion
+            # gardée ouverte, mesuré (curl, 100 requêtes : 4,1 s)
+            disable_nagle_algorithm = True
@@ -301,7 +314,17 @@ class App:
             def _send_file(self, f: FileResponse, head: bool) -> None:
-                size = f.path.stat().st_size
+                st = f.path.stat()
+                size = st.st_size
+                # PROTO fluidité : un validateur, pour qu'une relecture réponde 304 sans corps
+                etag = f'W/"{size:x}-{st.st_mtime_ns:x}"'
+                if self.headers.get("If-None-Match") == etag:
+                    self.send_response(304)
+                    self.send_header("ETag", etag)
+                    self.send_header("Cache-Control", f.cache)
+                    self.send_header("Content-Length", "0")
+                    self.end_headers()
+                    return
                 start, end, status = 0, size - 1, 200
@@ -325,6 +348,7 @@ class App:
                 self.send_header("Cache-Control", f.cache)
+                self.send_header("ETag", etag)
                 if status == 206:
diff --git a/server/core/library.py b/server/core/library.py
--- a/server/core/library.py
+++ b/server/core/library.py
@@ -161,6 +161,45 @@ def probe(path: Path) -> dict:
+# PROTO fluidité : les copies d'affichage d'une image (grand côté en px),
+# en WebP (l'alpha d'une image détourée reste). Seules les tailles qui ne
+# dépassent pas l'image existent ; au-delà, la page prend l'original.
+PROXY_SIZES = (256, 512, 1024, 2048)
+PROXY_RE = re.compile(r"^[a-z]{3}-\d{8}-\d{6}-[0-9a-f]{4}/p\d+\.webp$")
+
+
+def make_proxies(src: Path, d: Path) -> list[int]:
+    """`p256.webp` … `p2048.webp` dans le dossier de l'objet, chacune tirée
+    de la précédente (plus grande) : un seul décodage de l'original."""
+    from PIL import Image
+    made = []
+    try:
+        with Image.open(src) as im:
+            native = max(im.size)
+            # une image de 1024 a sa copie 1024 (WebP : 69 ko en moyenne, 1,7 Mo pour le PNG) ;
+            # l'original ne sert qu'au-delà de la plus grande copie
+            sizes = [s for s in PROXY_SIZES if s <= native]
+            if not sizes:
+                return []
+            im.draft("RGB", (sizes[-1], sizes[-1]))   # un JPEG se décode réduit, directement
+            alpha = "A" in im.getbands() or "transparency" in im.info
+            cur = im.convert("RGBA" if alpha else "RGB")
+        for s in reversed(sizes):
+            cur = cur.copy()
+            cur.thumbnail((s, s), Image.LANCZOS)
+            cur.save(d / f"p{s}.webp", "WEBP", quality=82, method=4)
+            made.append(s)
+    except Exception:
+        return sorted(made)
+    return sorted(made)
+
+
+def cache_policy(rel: str) -> str:
+    """Une copie d'affichage ne change jamais (son nom dit sa taille) : gardée
+    un an ; le reste se revalide (ETag → 304)."""
+    return "private, max-age=31536000, immutable" if PROXY_RE.match(rel) else "no-cache"
+
+
 def make_thumb(src: Path, dest: Path, kind: str) -> bool:
@@ -205,12 +244,30 @@ def add_file(src: Path, *, kind: str | None = None, title: str = "", origin: dic
     if make_thumb(d / name, d / "thumb.jpg", kind):
         it["thumb"] = "thumb.jpg"
+    if kind == "image":
+        it["proxies"] = make_proxies(d / name, d)
     with _lock:
         _items[iid] = it
         _save(it)
     return it
 
 
+def backfill_proxies(limit: int | None = None) -> int:
+    """Les copies d'affichage des images rangées avant elles (un travail cpu en vrai)."""
+    _load()
+    n = 0
+    for it in list(_items.values()):
+        if it["kind"] != "image" or "proxies" in it:
+            continue
+        it["proxies"] = make_proxies(path_of(it), folder_of(it["id"]))
+        with _lock:
+            _save(it)
+        n += 1
+        if limit and n >= limit:
+            break
+    return n
+
+
@@ -409,6 +466,9 @@ def public(it: dict) -> dict:
     out["thumb_url"] = base + it["thumb"] if it.get("thumb") else (out.get("url") if it["kind"] == "image" else None)
+    if it.get("proxies"):
+        # PROTO fluidité : les copies d'affichage, de la plus petite à la plus grande
+        out["proxies"] = [{"size": s, "url": f"{base}p{s}.webp"} for s in it["proxies"]]
diff --git a/server/showrunner.py b/server/showrunner.py
--- a/server/showrunner.py
+++ b/server/showrunner.py
@@ -29,7 +29,7 @@ from core.http import App  # noqa: E402
-    app.mount("library", library.root(), check=library.readable_path)
+    app.mount("library", library.root(), check=library.readable_path, cache=library.cache_policy)
diff --git a/server/tools/core_api.py b/server/tools/core_api.py
--- a/server/tools/core_api.py
+++ b/server/tools/core_api.py
@@ -38,6 +38,22 @@ def lib_get(req, item_id):
+def lib_batch(req):
+    """PROTO fluidité : POST /api/library/batch {ids: […]} — les fiches de
+    plusieurs objets en une requête (une planche de 1000 images en lisait 1000)."""
+    ids = req.json().get("ids") or []
+    if not isinstance(ids, list) or len(ids) > 2000:
+        raise HttpError(400, "ids : une liste de 2000 identifiants au plus")
+    items, missing = [], []
+    for i in dict.fromkeys(str(x) for x in ids):
+        it = library.get(i)
+        if it and library.readable(it):
+            items.append(library.public(it))
+        else:
+            missing.append(i)
+    return {"items": items, "missing": missing}
+
+
@@ -382,6 +398,7 @@ def _hostname() -> str:
     app.route("PUT", "/api/library/upload", lib_upload)
+    app.route("POST", "/api/library/batch", lib_batch)   # avant /api/library/{item_id} (POST = modifier)
     app.route("GET", "/api/library/{item_id}", lib_get)
```

(Le diff complet, lignes de contexte comprises : `ssh dgx2 'cd /tmp/sr_ide_perf && git diff main perf-proto'`.)

## 6. Fait — le serveur et le commun, pour tout le portail (29/09)

Les points 1 à 4 du § 4.1, et le point 5 du § 4.2 pour les pages communes
(le fil d'Image et de Vidéo, sa visionneuse, `thumb()`). La planche
d'Idéation se branche sur le même contrat (les points 5 à 9, dans
`ideation/`).

### 6.1 Ce qui est en place

- **Le cache** (`server/core/http.py`) : chaque fichier servi (dépôt,
  bibliothèque) porte un `ETag` faible (`W/"taille-date"`, date à la
  nanoseconde) et répond **304** sans corps à un `If-None-Match` qui le
  reconnaît (plusieurs validateurs, `*` compris). Le reste de l'en-tête ne
  change pas (`no-cache` : le navigateur redemande, le serveur dit « pas
  changé »). Un dossier monté choisit sa politique fichier par fichier
  (`mount(…, cache=fonction(chemin, req))`) ; `app.on_start(fonction)` est
  appelée une fois, quand le serveur écoute.
- **Les copies d'affichage** (`server/core/library.py`) : `view-256.webp`,
  `view-512.webp`, `view-1024.webp`, `view-2048.webp` dans le dossier de
  l'objet, WebP q82, jamais plus grandes que l'original (une image de
  1024 a sa copie 1024 ; moins de 256 : aucune), chacune tirée de la
  précédente (un décodage ; un JPEG se décode déjà réduit), tournées selon
  l'EXIF comme le navigateur montre l'original, l'alpha gardé. Une vidéo
  les a pour son affiche (une image à sa taille, prise à 0,5 s comme la
  vignette). Faites **à l'entrée** (`add_file`) ; celles des objets rangés
  avant, par le travail **`library.views`** (voie `cpu`, priorité basse,
  4 fils) que le portail **lance seul au démarrage** s'il en manque — juste
  par construction : un déploiement n'a rien à lancer à la main.
- **Le cache d'un an** : `private, max-age=31536000, immutable` sur une
  copie demandée à son adresse versionnée (`?v=`, qui change quand on la
  refait) ; sans `?v=`, revalidée comme le reste. `private` et non
  `public` : chacun ne voit que ce que `visibility` lui ouvre, et un cache
  partagé (la porte Cloudflare, `server/showrunner.py`) servirait l'image
  de l'un à l'autre sans passer par le juge de `/library/`.
- **La page** (`commun/proxies.js`, nouveau) : `pickView`, `needOf`,
  `swap` (décodée avant l'échange ; une image qu'on regarde ne redescend
  pas), `bind` (la taille réelle suivie par `ResizeObserver`, la montée de
  copie seulement près de l'écran, `IntersectionObserver`). Branché dans :
  - **le fil** (`commun/fil.js`) : grille et liste prennent la copie de
    leur case (le curseur de taille compris) au lieu de la vignette 384 ou
    de l'original ; l'affiche d'une vidéo, la copie de sa taille ; les
    références (40 px), la copie 256 ;
  - **la visionneuse** : sa taille posée d'avance (l'image ne saute pas),
    d'abord ce que la carte montre déjà, puis la copie qui couvre la scène,
    puis **l'original quand on s'arrête 400 ms** (feuilleter ne télécharge
    pas d'originaux) ; les voisins préparés en copie décodée, plus en
    original ;
  - **`thumb()`** (`commun/shell.js`) : la copie de la case, suivie ensuite.

### 6.2 Le contrat

| | |
|---|---|
| objet public (`library.public`, toutes les routes qui rendent un objet) | `views: [256, 512, 1024, 2048]` — les tailles (grand côté, px) qui existent, de la plus petite à la plus grande ; `[]` : aucune (trop petite, un son, un élément, pas encore rattrapée) · `view_urls: {"256": "library/<id>/view-256.webp?v=…", …}` — leurs adresses versionnées, relatives à la racine comme `url` |
| `GET /api/library/<id>/view?w=256\|512\|1024\|2048` | le fichier : la copie de cette taille, sinon la plus proche au-dessus, sinon l'original (une vidéo : la plus grande copie de son affiche, sinon sa vignette) ; `w` quelconque > 0 accepté ; 400 sans `w`, 404 si l'objet est absent ou invisible ; revalidé (ETag, 304) |
| `POST /api/library/batch {ids: [...]}` | `{items: [objets publics], missing: [ids]}` — dans l'ordre demandé, sans doublon ; 2000 ids au plus (400 au-delà) ; absent et invisible sont dans `missing`, sans dire lequel |
| `POST /api/library/views {ids?, force?}` | admin : relance le rattrapage (`force` refait les copies, et leur `?v=`) ; le travail `library.views` |

Côté page : `import { pickView, needOf, swap, bind } from '../commun/proxies.js'`
— `pickView(it, cssPx)` rend `{url, w}` (URL absolue ; `w = ORIGINAL` pour
l'original) : la plus petite copie dont le grand côté couvre `cssPx ×
devicePixelRatio`, sinon l'original ; sans copie, la vignette tant
qu'elle suffit (384 px).

### 6.3 Mesuré (DGX2, copie d'essai `/tmp/sr_perf2`, port 8821)

Le fil d'Image avec les 14 images « Essais » de Cal en tête (1567 × 661 à
6336 × 2688, 1,3 à 17 Mo, 79 Mo en tout) puis les 1000 du banc (§ 3.1) ;
Chromium sans affichage sur le GPU, 1600 × 1000, un navigateur neuf
(`/tmp/sr_perf2_fil.mjs`) : ouvrir, curseur de taille au maximum (480 px),
quatre pages de plus, la liste, recharger ; puis, cache vide, la
visionneuse sur la première image et 10 fois « suivant » (une image compte
quand `img.decode()` a résolu ; « nette » : assez de pixels pour sa taille
à l'écran × densité), puis 10 « suivant » à 100 ms d'écart. « Avant » : le
code du commit 0782335 (Nagle déjà coupé).

| mesure | avant · local | après · local | avant · Wi-Fi | après · Wi-Fi | avant · densité 2 | après · densité 2 |
|---|---|---|---|---|---|---|
| ouvrir : images visibles · Mo | 1,21 s · 1,2 Mo | 0,82 s · 1,1 Mo | 1,12 s · 0,9 Mo | 0,86 s · 0,9 Mo | 0,87 s · 1,2 Mo | 0,87 s · 4,7 Mo |
| curseur à 480 px : Mo (originaux) | 0 (0) — la vignette 384 étirée, floue | 4,1 (1) | 0 (0), floue | 4,1 (1) | 0 (0), floue | 79,2 (16) |
| quatre pages de plus : Mo (originaux) | 221,2 (113) | 10,9 (2) | 117,2 (64) | 9,1 (2) | 221,2 (113) | 123,9 (68) |
| la liste : Mo (originaux) | 306,5 (136) | 0,2 (0) | 398,8 (181) | 0,1 (0) | 306,5 (136) | 0,8 (0) |
| recharger : Mo · images visibles | 178,9 · 0,18 s | 0,05 · 0,08 s | 178,9 · 2,05 s | 0,05 · 0,10 s | 178,9 · 0,24 s | 0,05 · 0,10 s |
| mémoire après la liste (RSS) | 1622 Mo | 870 Mo | 1347 Mo | 837 Mo | 1456 Mo | 1322 Mo |
| visionneuse : ouvrir, nette · originale | 107 · 107 ms | 58 · 526 ms | 561 · 561 ms | 63 · 896 ms | 127 · 127 ms | 157 · 157 ms |
| visionneuse : « suivant », nette (moyenne · pire) | 71 · 165 ms | 20 · 46 ms | 243 · 1129 ms | 20 · 33 ms | 71 · 180 ms | 59 · 202 ms |
| feuilleter 10 images à 100 ms : Mo (originaux) | 32,2 (10) | 3,1 (2) | 32,2 (10) | 3,1 (2) | 32,2 (10) | 24,3 (7) |
| mémoire après la visionneuse (RSS) | 1468 Mo | 1143 Mo | 1492 Mo | 1123 Mo | 1398 Mo | 1514 Mo |

- **Densité 2** : une image vue plus grande que sa plus grande copie prend
  l'original (la règle du § 4.1 : on regarde ses pixels) ; les sorties de
  modèles entre 1024 et 2048 px (1216 × 832, 1344 × 768, 1567 × 661…) le
  font dès 480 px de haut, et la visionneuse prend l'original d'emblée
  (une scène de 1136 px × 2 dépasse 2048). Le gain y est moindre (quatre
  pages : 221 → 124 Mo) ; une copie à la taille native de ces images
  (WebP, ~10 fois plus légère que leur PNG) le relèverait — non fait, les
  tailles sont celles de l'étude.
- **Ouvrir** ne change guère : la première page (60 vignettes de 20 ko)
  était déjà légère ; le temps va ailleurs que dans les images.

La planche d'Idéation de 1000 images (`/tmp/perf_measure.mjs`, la page
d'aujourd'hui, seul le serveur change) : **rouvrir 1592 → 1,75 Mo**, images
visibles 2,7 → 1,0 s (les 304) ; ouvrir, zoomer à 200 % ne changent pas
tant que `ideation/` ne prend pas les copies et les fiches par lot.

Les fiches : 1000 lues une à une, 183 à 194 ms et 1000 requêtes sur une
connexion gardée ouverte ; par lots de 500, **6 à 11 ms, 2 requêtes**
(`/tmp/sr_perf2_batch.py`).

Les copies : le rattrapage des 1021 objets de l'essai (images et vidéos)
en **46 s** (4 fils) ; 158,6 Mo de copies pour ~2 Go d'originaux (+8 %).
Les Essais de Cal : 290 ms par image en moyenne sur un cœur, 630 ms au
plus (le PNG de 5376 × 3072, 15,6 Mo), 339 ms par vidéo (ffmpeg compris) ;
3,3 Mo de copies en tout. Un dépôt attend d'autant plus longtemps sa
réponse.

`python3 tools/check.py` : 755 passés, 0 en échec ; le `selftest` de
`server/tools/core_api.py` essaie les copies (tailles, WebP, alpha, EXIF,
une vidéo), la route `view`, l'ETag et le 304, le cache d'un an seulement
à l'adresse versionnée, les fiches par lot (ordre, doublons, absents,
bornes) et le rattrapage par le travail `cpu`.

### 6.4 Au déploiement

Le rattrapage des données en ligne part seul au redémarrage (travail
« Copies d'affichage · N objets », voie `cpu`, priorité basse) :

```sh
ssh dgx2 'cd ~/SHOWRUNNER_TOOLS && tools/portail.sh restart'
# vérifier, une minute après : aucune ligne avant le compte des copies
# (29 images et vidéos en ligne le 29/09 à 13 h 45, 21 d'entre elles dans « Essais »)
ssh dgx2 'cd ~/showrunner-data/library && grep -L "\"views\"" $(grep -lE "\"kind\": \"(image|video)\"" */item.json); ls */view-*.webp | wc -l'
```

Le relancer (un admin, dans la console du navigateur ouvert sur le
portail) : `fetch('/api/library/views', {method: 'POST', headers:
{'Content-Type': 'application/json'}, body: '{}'})` ; `'{"force": true}'`
refait toutes les copies.

### 6.5 Ce qui reste

- `ideation/` : prendre les fiches par lot et les copies (§ 4.2, points 5
  à 9), l'agent des groupes y branche ce contrat.
- Les autres pages qui posent encore `thumb_url` ou `url` à la main (Asset
  et ses cases de 88 px, le sélecteur de `refBoard`, `jobRow`) : les
  passer par `pickView`.
- Une copie à la taille native des images entre 1024 et 2048 px (voir
  densité 2) ; les références des éléments (`element.refs`) n'ont pas de
  copies.
- Mesurer sur le PC de Cal (Windows, son GPU, le vrai Wi-Fi) : l'accusé
  retardé de Windows (§ 2.1) n'est toujours pas mesuré.

## Sources

1. Evan Wallace, « Building a professional design tool on the web », Figma Blog (07/12/2015), https://www.figma.com/blog/building-a-professional-design-tool-on-the-web/
2. « Figma rendering: Powered by WebGPU », Figma Blog (2025), https://www.figma.com/blog/figma-rendering-powered-by-webgpu/
3. Figma Help, « Image loading and performance », https://help.figma.com/hc/en-us/articles/360052988373-Image-loading-and-performance
4. Figma Help, « Add images and videos to designs » (limite 4096, lu dans le moteur de recherche), https://help.figma.com/hc/en-us/articles/360040028034-Add-images-and-videos-to-designs
5. tldraw, « Assets » (`TLAssetContext`, exemple de `resolve`), https://tldraw.dev/sdk-features/assets
6. tldraw, « Performance » (culling, LOD des images, `getEfficientZoomLevel`, 4000 formes), https://tldraw.dev/sdk-features/performance
7. Miro Community, « Blurry images » (Hans Mickelson, 13/04/2021), https://community.miro.com/ask-the-community-45/blurry-images-1794
8. Miro Community, « Resolution about the uploaded PDF » (Robert Johnson, modérateur bénévole, 01/07/2021), https://community.miro.com/ask-the-community-45/resolution-about-the-uploaded-pdf-5222
9. Miro Help, « Board performance and loading issues » (page refusée au robot, lue dans le moteur de recherche), https://help.miro.com/hc/en-us/articles/360013588560-Board-performance-and-loading-issues
10. Excalidraw, discussion #4302 (dwelle, 22/11/2021), https://github.com/excalidraw/excalidraw/discussions/4302
11. Excalidraw, `packages/excalidraw/scene/Renderer.ts`, https://raw.githubusercontent.com/excalidraw/excalidraw/master/packages/excalidraw/scene/Renderer.ts
12. PureRef Handbook 1.11, « Settings », https://www.pureref.com/handbook/1.11/settings/
13. PureRef Handbook 2.1, « Images », https://www.pureref.com/handbook/2.1/images/
14. PureRef Forum, « Performance and memory usage of pureref » (admin, 09/06/2020), https://www.pureref.com/forum/read.php?2,1947
15. Chrome DevTools, « Network features reference » (Queueing), https://developer.chrome.com/docs/devtools/network/reference
16. MDN, « HTMLImageElement: decode() », https://developer.mozilla.org/en-US/docs/Web/API/HTMLImageElement/decode
17. web.dev, « content-visibility: the new CSS property that boosts your rendering performance », https://web.dev/articles/content-visibility
18. Microsoft Learn, « TCP/IP-specific Issues » (Winsock : accusé retardé, ~200 ms), https://learn.microsoft.com/en-us/windows/win32/winsock/tcp-ip-specific-issues-2
19. Python 3.12, `Lib/socketserver.py` (`StreamRequestHandler.disable_nagle_algorithm`), lu sur DGX2 (`inspect.getsource`).
