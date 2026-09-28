# Montage — l'étude

Le banc de montage du portail (`montage/`, `server/tools/montage.py`) :
chutier (la bibliothèque), moniteurs source et programme, timeline
3 pistes vidéo + 3 pistes son, export MP4 par ffmpeg. Ce qui suit dit
d'où vient chaque choix : la documentation, et les essais faits sur DGX2
(ffmpeg 6.1.1, Chromium sans affichage de playwright) le 28/09/2026.

## Le modèle : des images entières

Positions, durées et fondus sont en **images** à la cadence du projet
(24, 25 ou 30 i/s) ; seul le point d'entrée dans la source (`in`) est en
secondes, la source ayant sa propre cadence. Une coupe tombe donc toujours
sur une image, en lecture comme à l'export. Changer de cadence arrondit
chaque bord à la nouvelle grille (`convertFps`) : deux plans collés le
restent.

Une piste ne porte jamais deux plans au même instant : poser écrase
(`clearRange` : rogne, coupe en deux ou retire ce qui est dessous), ou
insère (`insertGap` : coupe au point d'insertion et pousse la suite). Le
serveur vérifie quand même (`overlaps`) et l'export refuse en nommant les
plans.

`windows()` existe deux fois, en JavaScript (`montage/model.js`) et en
Python (`server/tools/montage.py`), ligne pour ligne : c'est la fenêtre où
chaque plan se voit et s'entend, avec ses rampes. Le **fondu enchaîné** de
N images entre A et B collés est centré sur la coupe : B commence N//2
images plus tôt et monte de 0 à 1 posé sur A ; A dure N − N//2 images de
plus. S'il n'y a pas de matière au-delà des bords, l'image se fige
(`tpad` clone à l'export ; l'élément <video> reste sur sa première ou
dernière image dans la page). Le **fondu au noir** est un fondu d'opacité :
sur V1 il descend au noir (le fond), sur V2/V3 à la transparence (on voit
dessous) ; posé sur une coupe, le plan d'avant descend sur la même durée.

## L'export

### Le graphe (doc ffmpeg-filters, essais DGX2)

Par plan : `-ss <entrée> -t <durée> -i fichier` (recherche exacte en
transcodage : doc ffmpeg « Main options », `-ss` ; `-accurate_seek` par
défaut), puis `setpts=PTS-STARTPTS, fps, scale=…:force_original_aspect_ratio=decrease,
setsar=1, [exposure, eq, colortemperature], format=yuva420p, pad=…:color=black@0,
tpad=…:stop=-1:stop_mode=clone, trim=end_frame=N, setpts=…, fade=…:alpha=1,
setpts=PTS+début/(fps*TB)` et `overlay=eof_action=pass` sur ce qui est
dessous (V1, puis V2, puis V3).

- **Essai 1** — un plan posé à 2 s sur un fond noir de 6 s (25 i/s) :
  image 49 = le plan d'avant, image 50 = le plan, image 124 = le plan,
  image 125 = noir. `overlay` sans `eof_action=pass` répète la dernière
  image (défaut `repeat`, doc overlay/framesync) : d'où `pass`.
- **Essai 2** — un plan rouge posé à 2 s sur un plan bleu, `fade=t=in:alpha=1`
  sur 25 images : image 50 = bleu pur, 56 = 24 % de rouge, 62 = 47 %,
  74 = 96 %, 75 = rouge. Le mélange est linéaire, comme l'opacité CSS de
  l'aperçu (`opacityAt`, même formule que vf_fade : k/n en entrée,
  (nf − k)/n en sortie).
- `pad` transparent : un plan plus étroit que le cadre laisse voir la
  piste du dessous (vérifié dans le contrôle : bords bleus de V1 autour
  d'une image carrée en V2), du noir sur V1.
- `tpad … stop=-1` puis `trim=end_frame` : chaque plan a exactement son
  nombre d'images, même si la source en a une de moins que prévu.

Son : `atrim`/`apad`, `volume`, `afade` (rampe linéaire, en échantillons),
`adelay=…S:all=1` (décalage en échantillons, doc adelay), `amix` avec
`normalize=0` (doc amix : sinon les entrées sont rééchelonnées ; ici un
plan à 100 % reste à 100 %). Sans aucun son, `anullsrc` : le MP4 a
toujours sa piste AAC.

Sortie : H.264 (`libx264`, `crf 18`, preset `medium`, ou `veryfast` en
brouillon), `yuv420p`, AAC 192 kb/s 48 kHz stéréo, `+faststart`.
Progression : `-progress pipe:1` (doc ffmpeg : lignes clé=valeur,
`out_time_us`, `speed`), rapportée à la durée du montage.

### Par passes : la mémoire bornée

Un seul graphe ouvre un décodeur par plan dès le départ. Mesuré sur un
montage de 91 plans en 1080p (38 s) : **14,2 Go** pour ffmpeg (décodeurs
en fils automatiques), 5,5 Go à `-threads 2` par entrée, 4,7 Go à 1 fil —
la mémoire croît avec le nombre de plans. L'image se rend donc par
**passes de 8 s** (`CHUNK_S`), chacune n'ouvrant que les plans de sa
tranche, puis une dernière passe recolle les tranches **sans ré-encoder**
(démuxeur `concat`, `-c:v copy` ; doc ffmpeg-formats, concat) et mêle le
son. Les fondus sont écrits en temps (`fade=…:st=…:d=…`) avec un
horodatage relatif au début de la fenêtre du plan : un fondu à cheval sur
deux passes reste continu.

- Même montage de 91 plans : **1,8 Go** (brouillon, 38 s) et 2,1 Go
  (finale, 41 s), 5 passes, 960 images sur 960.
- Un montage de 20 s rendu d'un bloc puis en 3 passes : images identiques
  aux coupures de passes (écart moyen 0,02 à l'image 200 ; à l'image 400,
  1,05 contre 9,5 avec les voisines — même image, bruit d'encodage).
- Le contrôle (`tools/check.py`) rend un essai en passes de 2 s dont la
  coupure tombe au milieu d'un fondu enchaîné, et vérifie les couleurs de
  part et d'autre.

## La lecture dans la page

Le programme n'est pas une vidéo : chaque plan actif a son élément
`<video>`, `<img>` ou `<audio>`, empilés dans l'ordre des pistes. Une
horloge (`performance.now`) donne le temps ; à chaque image d'affichage
(`requestAnimationFrame`, MDN) on montre ce qui doit se voir et on recale
les médias :

- les plans qui arrivent dans les 2 s sont chargés et arrêtés sur leur
  première image (`currentTime`, `preload="auto"`, MDN HTMLMediaElement) :
  une coupe n'attend pas le réseau. Mesuré : à la coupure B → C, C part
  avec −1 ms d'écart ;
- un média qui s'écarte de plus d'une demi-image est rattrapé par
  `playbackRate` (±8 %, MDN), au-delà de 0,3 s par un saut — le principe du
  son du Studio de Movie Analysis (`son.js`, recalage au-delà de 60 ms) ;
- au départ, l'horloge attend que les médias jouent vraiment (`play()`
  rend la main avant la première image) puis se cale sur eux. Sans cela,
  mesuré : 150 ms de retard au départ ; avec : 1 à 17 ms ;
- le son passe par Web Audio (`createMediaElementSource` + `GainNode`,
  MDN) : un volume au-delà de 100 % s'entend comme à l'export ;
- l'arrière (J) se fait image par image : essayé dans Chromium,
  `playbackRate = -1` lève « NotSupportedError: The provided playback rate
  (-1) is not in the supported playback range ».

L'**étalonnage** de l'aperçu reprend les filtres de l'export, mesurés :

- `exposure` multiplie les valeurs codées par 2^IL (mesuré : gris 64 →
  128 à +1 IL) : CSS `brightness(2^IL)` ;
- `eq` contraste et saturation : CSS `contrast()`, `saturate()` (pivot à
  mi-gris ; `eq` travaille en YUV, d'où de petits écarts sur les couleurs
  saturées) ;
- `colortemperature` multiplie chaque canal (mesuré sur des gris 64, 128,
  192 : linéaire) ; la table blanc → RVB relevée tous les 500 K de 2000 à
  12 000 K est dans `player.js` (`KLUT`), posée en `feColorMatrix`
  (`color-interpolation-filters="sRGB"` : l'attribut vaut `linearRGB` par
  défaut, MDN). 6500 K n'est pas neutre dans ffmpeg (blanc → 255,254,250) :
  le filtre n'est posé qu'en s'en écartant.
- Comparé sur les barres SMPTE (+0,5 IL, saturation −60, 3500 K) : gris
  (144,109,79) à l'aperçu, (141,109,76) à l'export ; les couleurs vives
  s'écartent davantage. L'interface le dit : « étalonnage approché ».

## Les limites connues

- L'aperçu de l'étalonnage est approché ; l'export fait foi.
- Le son d'une vidéo est attaché à son plan tant qu'on ne le détache pas
  (« Détacher le son » le pose sur la piste son cible).
- Pas de vitesse variable, de titres, de clés, de scopes, de roues
  chromatiques (la maquette de Cal les montre ; pas encore faits).
- Une passe finale lit tous les sons à la fois : un montage de centaines de
  plans sonores ouvre autant d'entrées (léger, mais non borné).
