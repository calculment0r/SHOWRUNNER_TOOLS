# Montage — l'étude

Le banc de montage du portail (`montage/`, `server/tools/montage.py`) :
chutier (la bibliothèque, rangée en dossiers), moniteurs source et
programme, timeline multipiste (3 + 3 pistes au départ, jusqu'à 20 de
chaque sorte), les outils de Premiere Pro, des LUT, export MP4 par ffmpeg.
Ce qui suit dit d'où vient chaque choix : la documentation, et les essais
faits sur DGX2 (ffmpeg 6.1.1, Chromium sans affichage de playwright) les
28 et 29/09/2026. La partie « Le 29/09 » répond à la demande de Cal du
29/09 (panneaux, dossiers, clic droit, timecode, LUT, outils).

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

## Le 29/09 : panneaux, dossiers, clic droit, timecode, outils, LUT

### Les sources Premiere Pro

`helpx.adobe.com` répond 403 aux robots (Akamai, essayé depuis DGX2 en curl
et en Chromium) : les pages sont lues par leurs instantanés
`web.archive.org` (date entre parenthèses).

| page | ce qu'on y a pris |
|---|---|
| « Default keyboard shortcuts », helpx.adobe.com/premiere/desktop/get-started/keyboard-shortcuts/default-keyboard-shortcuts.html (13/02/2026 ; FR 16/06/2026) | tous les raccourcis de commandes ci-dessous |
| « Default keyboard shortcuts in Adobe Premiere Pro CC », helpx.adobe.com/premiere-pro/using/default-keyboard-shortcuts-cc.html (22/10/2018 ; FR /fr/… 16/04/2019) | le tableau « Tools » : V A B N R C Y U P H Z (la page de 2026 n'a plus ce tableau : les lettres sont dans les infobulles) |
| « Tools panel in Premiere », …/get-started/tour-the-workspace/tools-panel-and-options-panel.html (7 janv. 2026 ; FR 21 janv. 2026) | ce que fait chaque outil ; « orient it vertically or horizontally » |
| …/edit-projects/trim-clips/perform-ripple-edits.html (23 mars 2026), perform-rolling-edits (22 août 2025), perform-slip-edits (22 août 2025), perform-slide-edits (22 août 2025), cut-clips (22 août 2025) ; …/change-clip-speed/change-clip-speed-and-duration-using-the-rate-stretch-tool.html (7 janv. 2026) ; et les mêmes en /fr/ | B, N, Y, U, R confirmés en 2025-2026, le sens du slip, les noms français |

Les noms français viennent des pages françaises d'Adobe de 2025-2026 ;
Adobe n'est pas constant (le tableau français de 2019 disait « Modification
compensée » pour N, « Allongement compensé » pour R, « Déplacer dessus »
pour U). Les noms proposés dans la demande (« Modification par
déplacement », « Glissement », « Coulissement », « Rasoir ») n'apparaissent
pas tels quels dans ces pages, sauf « Rasoir » (page Cutter, 2025) : on a
pris ceux d'Adobe, l'anglais dans l'infobulle.

### Les outils (barre horizontale dans la barre de la timeline)

| lettre | outil (Adobe FR · EN) | ici |
|---|---|---|
| V | Sélection · Selection | choisir, déplacer, rogner les bords ; maj/ctrl + clic ajoute ; **alt + glisser copie** |
| A | Sélection de piste (en avant) · Track Select (Forward) | le plan cliqué et tout ce qui commence après sur sa piste ; maj : toutes les pistes (Adobe : « Shift-click … in all tracks ») ; puis glisser |
| B | Montage par propagation · Ripple Edit | tirer un bord : la suite de la piste suit, pas de vide (`M.rippleTrim`) ; la tête rognée garde sa place |
| N | Déplacement de la coupe · Rolling Edit | la coupe entre deux plans collés bouge ; A s'allonge, B commence plus loin dans sa source (`M.roll`) ; sans voisin collé, rogne comme V |
| R | Modification de la vitesse · Rate Stretch | tirer un bord : durée et vitesse changent, la matière reste (`M.stretch`) ; 10 à 1000 % |
| C | Cutter (Rasoir) · Razor | couper au clic ; maj : toutes les pistes |
| Y | Déplacer dessous · **Slip** | le contenu glisse dans le plan, place et durée fixes (`M.slip`) ; « tiré vers la gauche, les points d'entrée et de sortie source avancent » (Adobe) ; le moniteur montre la première image du plan pendant le geste |
| U | Déplacer le plan · **Slide** | le plan glisse entre ses voisins, dont la sortie et l'entrée s'ajustent ; sa matière ne change pas (`M.slide`) |
| H | Main · Hand | glisser fait défiler |
| Z | Zoom · Zoom | clic : zoomer ; alt + clic : dézoomer |

Ce que Cal appelle « roll pour déplacer un footage dans son segment » est le
**Slip** (Y) ; le **Rolling** de Premiere (N) déplace la coupe entre deux
plans ; les deux sont faits. Le pinceau (P) n'est pas repris (les images
clés se posent dans l'inspecteur, 06/10). Propagation, coupe, vitesse, slip et slide se voient en direct
dans le programme : chaque mouvement repart des plans d'avant le geste
(`gesture` de montage.js) et le lâcher fait une seule annulation. Chaque
outil a son curseur, dessiné à l'exécution avec les couleurs des jetons
(`--ink`, `--bg`) : aucune couleur écrite.

Les raccourcis de commandes, tous du tableau Adobe de 2026 : ctrl+K
« Ajouter une coupe », ctrl+maj+K « à toutes les pistes », Suppr
« Effacer », maj+Suppr « Supprimer et raccorder », ctrl+C/V, ctrl+maj+V
« Coller et insérer », ctrl+R « Vitesse/Durée… », maj+E « Activer »,
ctrl+L « Lier » (ici : dissocier le son — un aller simple, on ne relie
pas), F « Concordance des images », virgule/point « Insérer/Remplacer »,
; « Prélever », ' « Extraire », I/O, maj+I/O « Atteindre l'entrée/la
sortie », ctrl+maj+I/O/X « Effacer … », M « Ajouter une marque », maj+M,
ctrl+maj+M marque suivante/précédente, ctrl+alt+M, ctrl+alt+maj+M effacer
la marque / toutes, ctrl+A, ctrl+maj+A tout / rien, ctrl+B « Nouveau
chutier », ctrl+I « Importer », ctrl+M « Exporter le média », alt+←/→
(maj : cinq) décaler, alt+virgule/point déplacer le plan (slide),
ctrl+alt+←/→ déplacer dessous (slip). Adobe se contredit sur le slip d'une
image (page slip : alt+maj+←, tableau : ctrl+alt+←) : on suit le tableau.
Sur un clavier AZERTY, les touches de ponctuation sont celles du caractère
(point = maj + ;) — non réglé.

### La carte des menus du clic droit (commun/menu.js)

Toutes les entrées marchent ; une entrée impossible reste lisible, grisée,
et dit pourquoi au clic (`disabled` + `why`). « Réf. » : la commande de
Premiere du même nom (tableau Adobe) ; « usage » : le menu contextuel de
Premiere, non vérifié dans la documentation lue.

| zone | entrées | réf. |
|---|---|---|
| tête de piste | ajouter une piste vidéo/son au-dessus, au-dessous ; ajouter une piste de l'autre sorte ; renommer la piste ; en faire la piste cible ; choisir tous ses plans ; appliquer une LUT à tous ses plans (vidéo) ; verrouiller, masquer (vidéo), muette, solo ; supprimer la piste (demande si elle porte des plans ; jamais la dernière de sa sorte) | usage (menu de la tête de piste) |
| zone vide d'une piste | supprimer le vide et raccorder ; coller ici ; coller et insérer ici ; couper toutes les pistes ici ; placer la tête de lecture ; ajouter une piste ▸ ; tout choisir | Ripple Delete, Paste, Paste Insert, Select All |
| plan | couper ici ; ajouter une coupe à la tête de lecture ; copier ; coller à la tête ; dupliquer à la suite (insère) ; effacer ; supprimer et raccorder ; vitesse/durée… ; LUT ▸ (aucune, chaque LUT, importer…) ; activer ; fondu enchaîné à l'entrée ; dissocier le son ; ouvrir dans le moniteur source ; concordance des images ; renommer le plan ; révéler dans le chutier ; révéler dans Asset ↗ | Add Edit, Copy, Clear, Ripple Delete, Speed/Duration, Enable, Apply Video Transition (ctrl+D), Link, Match Frame ; « Reveal in Project » : usage |
| règle | ajouter une marque ici ; nommer / effacer la marque ; point d'entrée ici ; point de sortie ici ; effacer l'entrée et la sortie ; prélever, extraire (entrée → sortie) ; marque précédente, suivante ; effacer toutes les marques | Add Marker, Mark In/Out, Clear In and Out, Lift, Extract, Go to Next/Previous Marker, Clear All Markers |
| marque (sur la règle) | y aller ; nommer… ; effacer | Clear Selected Marker |
| Projet (fond) | nouvelle séquence… ; nouveau dossier avec la sélection ; importer… ; tout choisir ; trier par (date, nom, durée, sorte) ; afficher (tout, séquences, vidéos, images, sons) ; ouvrir Asset ↗ | New Bin (ctrl+B, ctrl+/), Import, Select All |
| onglet du panneau | renommer le dossier ; fermer l'onglet ; fermer les autres | « Open and close bins » |
| dossier | ouvrir dans un onglet (double-clic) ; renommer (F2, double-clic sur le nom) ; nouvelle séquence dans ce dossier ; révéler dans Asset ↗ ; défaire le dossier (le contenu revient à la racine) | « Add and delete bins », « Open and close bins » |
| objet du Projet | ouvrir dans le moniteur source (une séquence : dans la timeline) ; **nouvelle séquence à partir de l'élément** ; insérer, écraser à la tête de lecture ; ajouter au bout de la piste cible (plusieurs : dans l'ordre) ; dupliquer (séquence) ; renommer (F2) ; ranger dans ▸ ; sortir du dossier ; nouveau dossier avec la sélection ; révéler dans Asset ↗ ; mettre à la corbeille (Suppr) | New Sequence From Clip, Insert, Overwrite, Clear |
| onglet de séquence (au-dessus de la timeline) | y passer ; renommer… ; dupliquer ; révéler dans le projet ; fermer l'onglet ; fermer les autres | « Navigate sequences in the timeline » |
| moniteur source | lecture/pause ; marquer l'entrée, la sortie ; effacer l'entrée et la sortie ; insérer ; écraser ; ajouter au bout de la piste cible ; révéler dans le chutier ; dans Asset | Mark In/Out, Clear In and Out, Insert, Overwrite |
| moniteur programme | lecture/pause ; début, fin ; entrée, sortie à la tête de lecture ; effacer ; ajouter une marque ; concordance des images ; ajouter une coupe à toutes les pistes ; zones de sécurité (90 % et 80 %) ; exporter… | Mark In/Out, Add Marker, Match Frame, Add Edit to All Tracks, Export Media ; zones de sécurité : usage |
| vignette de LUT (inspecteur) | renommer ; l'image qu'elle attend ▸ ; sa grille et son fichier ; supprimer de la bibliothèque | — |

### Les panneaux

`commun/split.js` : une poignée entre deux panneaux voisins d'une boîte
flex ; glisser, double-clic (toute la rangée reprend ses tailles par
défaut), flèches au clavier. Les tailles tiennent par visiteur
(localStorage, dans un try/catch). Un panneau fixe (chutier 236 px,
inspecteur 286 px) garde ses px, un souple (source, programme ; le haut et
la timeline) sa part. Piège mesuré : un panneau souple ne descend pas sous
sa marge intérieure (flex-basis 0 en border-box), la part se donne au-delà ;
sans la retirer, la poignée partait de 127 px pour 120 px de souris —
corrigé (`pad`), vérifié à 120,0.

### Le Projet redevient propre au montage (30/09)

Cal, le 30/09 : « quand je supprime un fichier dans le projet du montage, on ne le
détruit pas complètement ? il est encore dans nos assets généraux et il est détruit
uniquement pour le montage vidéo ». Or « supprimer » appelait `/asset/trash`
(`montage/projet.js`, ancienne ligne 173) : l'objet partait à la corbeille d'Asset,
donc de partout. Le Projet est désormais un ensemble du montage, un par Workspace
(`<data>/montage/projet/<workspace>.json`, `server/tools/montage_projet.py`) :
« Retirer du projet · reste dans Asset » ne jette rien ; ses dossiers ne touchent plus
ceux d'Asset. Au premier passage, il reprend la bibliothèque du Workspace et ses
dossiers : rien ne disparaît à l'écran. Y entrent seuls : une séquence neuve ou
dupliquée, un export, un import, un objet posé pour la première fois sur une timeline.
Ce qui suit (29/09) est remplacé.

### Le panneau Projet, c'est Asset (29/09 au soir)

Décision de Cal : « le chutier devient asset, comme dans Premiere Pro ». Le
chutier à dossiers propres au montage (29/09 midi, champ `bins` du projet,
imbriqués) est remplacé par la bibliothèque commune et ses dossiers : le
champ `folder` de chaque objet, un seul niveau, un dossier n'existe que par
ce qu'il contient (`server/tools/asset.py`, et la maquette du 28/09). Aucun
montage enregistré ne portait de `bins` (vérifié sur les données de DGX2) :
rien à migrer ; `normalize` ne les lit plus. Les gestes (`montage/projet.js`)
passent par l'API d'Asset (`POST /api/asset/move`, `/asset/folders/rename`,
`/asset/trash`, `/asset/restore`) : ce qui se range ici se voit dans Asset, et
l'inverse (vérifié : la page Asset montre le dossier et ses séquences).

- **Un objet lâché sur un autre** (à la racine) : une fenêtre au centre
  demande le nom d'un dossier neuf qui les prend tous les deux — le geste
  d'Asset (`asset.js`, « drop-merge » → `askFolderName`).
- **Une sélection au cadre** (glisser sur le fond de la liste ; maj ou
  ctrl : ajouter), glissée sur l'icône « nouveau dossier » : la même fenêtre.
  Premiere : « New Bin » ctrl+B (tableau des raccourcis) ou ctrl+/ (page
  « Add and delete bins », 22 août 2025) ; ici avec la sélection, un dossier
  vide n'existant pas dans Asset.
- **Double-clic sur le nom** d'un dossier : le renommer sur place ; **sur le
  dossier** : il s'ouvre dans un onglet du panneau — Adobe, « Open and close
  bins » (7 janv. 2026) : « Double-click to open a bin in its own dockable
  panel ». L'onglet « Projet » (la racine) reçoit un dépôt : les objets sortent
  de leur dossier ; l'onglet d'un dossier : ils y entrent.
- Suppr met à la corbeille d'Asset (en revient par ctrl+Z ou Asset) ; sur un
  dossier : « défaire le dossier » (son contenu revient à la racine — Asset
  n'a pas de dossier vide).
- Ranger, renommer, jeter s'annulent par ctrl+Z comme les gestes de la
  timeline : l'entrée porte ses deux fonctions (`pushLibUndo`).

### Les séquences : des objets d'Asset, en onglets

Une séquence est un objet de la bibliothèque de sorte **`sequence`** (id
`seq-…`, `server/core/library.py` : une ligne, la sorte ajoutée à `KINDS`) :
sa timeline dans `library/<id>/sequence.json`, et dans son `item.json` son
titre, sa taille, sa cadence, sa durée, sa lignée (les plans employés), sa
vignette (celle du premier plan qui se voit). Elle se range, se renomme, va
à la corbeille et en revient comme les autres objets. Les montages d'avant
(`montage/mon-*.json`) deviennent des séquences au démarrage du portail
(`migrate`), le fichier d'origine gardé dans `montage/migres/`, son
identifiant dans `legacy` (l'ancienne adresse `#mon-…` et ses exports y
mènent). Vérifié sans l'écrire sur le seul montage du portail (« Montage du
29/09 », 4 plans).

- **Nouvelle séquence à partir de l'élément** (clic droit sur un clip, ou
  un clip lâché sur l'icône « nouvelle séquence ») : la taille, la cadence, le
  nom et la durée du clip, le clip entier posé en V1 (son son attaché).
  Adobe, « How to arrange clips into sequences » (helpx.adobe.com/
  premiere-pro/how-to/arranging-clips-to-sequence.html) : « right-click a
  representative clip … and choose New Sequence From Clip … This ensures that
  the sequence settings match those of your footage. The new sequence will
  adopt the clip's name too » ; « Create a sequence » (7 janv. 2026) : « drag a
  clip from the Project panel to the New Item icon ». Une taille hors des
  préréglages devient un format « sur mesure » (pair, 16 à 8192 px) ; la
  cadence est la plus proche de 16, 24, 25, 30, 50, 60 (le modèle compte en
  images entières : 23,976 devient 24, et la séquence le dit). Essai : un clip
  704×896 à 24 i/s de 5,2 s → séquence 704×896, 24 i/s, 124 images.
- **Onglets au-dessus de la timeline** : Adobe, « Navigate sequences in the
  timeline » (7 janv. 2026) : « Each sequence appears as a tab within that
  timeline » ; « double-click the sequence in the Project panel. The sequence
  opens in a new tab ». Chaque onglet garde sa tête de lecture et son zoom
  (`montage-view-<id>`, par visiteur) et ses annulations (en mémoire, le temps
  de la page) ; fermer un onglet ne supprime rien.
- Pas encore : une séquence posée dans une autre (imbrication) ; la page
  Asset les montre avec l'étiquette brute « sequence » et sa fiche ne sait pas
  les ouvrir (asset/, à reprendre par qui la tient).

### Les pistes

Nommées par leur place, comme dans Premiere (V1 en bas, A1 en haut) :
ajouter ou retirer une piste renumérote (`renumber`), les plans suivent leur
piste. Un nom libre s'ajoute (sous l'étiquette, dans la tête de piste). Le
serveur accepte jusqu'à 20 pistes de chaque sorte et renomme par leur place
des pistes qui ne le seraient pas.

### Le timecode qui ne bouge plus

Tout nombre qui défile est en Azeret Mono (`--f-mono`), chiffres tabulaires,
dans une boîte de largeur fixe en `ch` : timecode HH:MM:SS:II (11 ch, format
inchangé), durée de la source, état du programme (7 signes), pastilles
d'enregistrement et d'export, zoom (7 ch), bouton Lecture (104 px). Vérifié
dans Chromium : 25 relevés pendant 2,5 s de lecture, aucun élément de la
barre ne bouge ; le zoom passe de 100 % à 2000 % sans déplacer « + ».

### Vitesse, activer, marques, entrée et sortie

- `speed` par plan : source lue = (t − début) × vitesse. Export :
  `setpts=(PTS-STARTPTS)/v` avant `fps`, et `atempo` (0,5 à 100 dans
  ffmpeg 6.1, `-h filter=atempo` ; en dessous, enchaîné : 20 % =
  0,5 × 0,5 × 0,8). Aperçu : `playbackRate` = vitesse (mesuré dans le
  Chromium de DGX2 : 1/16 et 16 acceptés, 0,05 et 16,5 refusés par
  NotSupportedError ; la page borne donc là), le son garde sa hauteur
  (`preservesPitch`, MDN) comme atempo.
  Essai : un plan à ×2 d'une source rouge/vert/bleu d'une seconde chacun
  montre rouge puis vert dès la moitié du plan.
- `enabled` : un plan désactivé ne se voit, ne s'entend ni ne s'exporte, et
  ne fond avec personne (`windows`, JS et Python).
- `markers` (id, image, nom) et `range` (entrée, sortie de séquence) : l'export
  peut se borner à la plage (`export_range` ; les passes d'image vont de
  l'entrée à la sortie, le son est mêlé sur tout le montage puis coupé par
  `atrim=start_sample:end_sample`). Essai : 25 → 100 donne 75 images.

### La couleur de l'export : la matrice du navigateur

Mesuré le 29/09 dans le Chromium de DGX2 (huit pastilles connues, H.264
sans étiquette puis étiqueté) : une vidéo **sans étiquette** est décodée en
**BT.601 sous 720 lignes, en BT.709 à partir de 720** (320×180, 1024×576,
1280×704 → 601 ; 960×720, 1280×720, 704×896, 720×1280 → 709) ; une vidéo
étiquetée l'est selon son étiquette ; WebGL (texImage2D) voit les mêmes
valeurs que le canevas 2D. ffmpeg, lui, convertit RVB ↔ YUV en BT.601 par
défaut. Avant ce jour, l'export HD sans étiquette passait les images PNG et
les filtres RVB en 601 et Chromium le relisait en 709 : un rouge (220,40,40)
se montrait (236,58,37). Désormais chaque plan passe en RVB avec la matrice
que le navigateur emploie pour sa source (`_video_color` : l'étiquette, sinon
la règle mesurée), et la sortie est écrite **et annoncée** BT.709
(`-colorspace bt709 …`). Cette règle est celle du Chromium de DGX2 ; un
autre navigateur, ou un décodage matériel sous Windows, peut en suivre une
autre pour une source sans étiquette : non documenté.

Une image entre deux images de la source : une entrée à 0,5 s en 25 i/s
tombe au milieu de l'image 12. Le navigateur montre l'image qui contient
l'instant (la 12), `-ss` exact garde la première qui commence après (la 13).
Mesuré sur une mire animée : 4,9 d'écart moyen entre l'aperçu et l'export,
avec ou sans LUT. L'export reculait donc au début de l'image qui contient
l'instant (moins un quart d'image) : 0,9 après. Depuis le 06/10, il prend
l'image qui contient l'instant sur les horodatages de la source elle-même,
quelle que soit sa cadence (`_open_video`, voir « Les poignées » plus bas) ;
le son reste à l'échantillon.

### Les LUT

**Lecture.** Adobe « Cube LUT Specification 1.0 » : TITLE, LUT_3D_SIZE ou
LUT_1D_SIZE, DOMAIN_MIN/MAX, les valeurs rouge le plus rapide ; plus les
LUT_3D_INPUT_RANGE / LUT_1D_INPUT_RANGE de Resolve. Le serveur
(`parse_cube`) refuse en disant pourquoi : un compte de lignes faux, un
domaine autre que 0..1 (ffmpeg 6.1, `vf_lut3d.c` `parse_cube`, ne garde que
`1/(max − min)` et ignore min : il lirait autrement que la page), 1D et 3D
dans le même fichier, plus de 65 points (3D) ou 4096 entrées (1D). Une
HaldCLUT PNG (L³ × L³ pixels, L² points, l'ordre de `update_clut_packed`)
devient une LUT 3D. Chaque LUT est réécrite sous une forme unique (six
décimales) dans `<data_dir>/luts/` — hors du dépôt public — et la page comme
ffmpeg lisent ce même fichier.

**Calcul.** Export : `format=gbrpf32le,lut3d=file=…:interp=trilinear` (ou
`lut1d … interp=linear`) après l'étalonnage ; `lut3d`, `lut1d`, `haldclut`
et `atempo` sont dans le ffmpeg 6.1.1 de DGX1 et de DGX2 (`ffmpeg -filters`). Trois points lus dans le code de
ffmpeg 6.1.1 (`libavfilter/vf_lut3d.c`) : l'interpolation par défaut est
tétraédrique (`-h filter=lut3d`) — on demande trilinéaire, comme le
shader ; le chemin 8 bits tronque (`av_clip_uint8` d'un flottant) — on passe
en flottants ; `interp_trilinear` : entrée bornée à 0..1 × (N − 1), voisins
`(int)x` et `min((int)x + 1, N − 1)`, mélanges sur r puis g puis b.
Aperçu (`montage/lut.js`) : WebGL2, la LUT dans une texture 3D RGB32F lue
par `texelFetch` et l'interpolation écrite dans le shader, ligne pour ligne
celle de ffmpeg (le filtrage linéaire des GPU ne garde que quelques bits de
poids). Un plan à LUT se dessine dans un canevas posé à la place de son
élément ; l'étalonnage (les filtres CSS de l'aperçu, mêmes formules que la
spécification Filter Effects) passe avant la LUT, comme à l'export.
**Intensité** : l'aperçu mêle l'image et l'image passée par la LUT ;
l'export lit une LUT réécrite (1 − k)·identité + k·LUT — même résultat,
l'interpolation étant linéaire en ses valeurs et exacte sur l'identité
(essai du contrôle : l'inversion à 50 % donne un gris moyen partout).

**Mesure** (29/09, `lutmesure.py` + `lutmesure.mjs`, sur DGX2). La mire
1280×720 (huit pastilles, rampes grises et R, V, B) :

| LUT | aperçu WebGL2 contre ffmpeg (0..255) |
|---|---|
| sarcelle-orange 3D 33, 100 % | moyen 0,064 · max 1 · 93,6 % identiques |
| la même à 50 % | moyen 0,021 · max 1 |
| noir et blanc 709, 3D 17 | moyen 0,004 · max 1 |
| chaud, 3D 33 | moyen 0,048 · max 1 |
| inversion, 3D 17 | moyen 0,708 · max 1 (sorties entières : l'arrondi de ffmpeg vers rgb24) |
| courbe en S, 1D 1024 | moyen 0,094 · max 1 |

De bout en bout (le montage exporté par le vrai travail, décodé par
Chromium, contre le canevas de l'aperçu, 1280×720, écart moyen) : mire PNG
0,94 avec LUT / 0,76 sans ; vidéo 720p sans étiquette 0,95 / 0,92 ; vidéo
360p sans étiquette 0,55 / 0,47 ; vidéo générée 704×896 BT.709 1,28 / 1,29 —
la LUT n'ajoute rien de mesurable à l'erreur de l'encodage H.264 4:2:0 (les
maxima, sur les bords francs, sont ceux du sous-échantillonnage de la
chrominance et des mises à l'échelle).

**La bibliothèque.** Importer un .cube ou une HaldCLUT (inspecteur, menu
LUT d'un plan) en disant l'image qu'elle attend (Rec.709, F-Log, F-Log2,
F-Log2 C, autre log, non documenté) ; l'étagère de l'inspecteur montre
chaque LUT sur l'image courante du plan choisi ; poser une LUT faite pour
du log sur nos vidéos Rec.709 est signalé. Rien n'est téléchargé : la
« mini bibliothèque » attend le choix de Cal (ci-dessous).

**Les LUT proposées** (recherche du 29/09 ; rien téléchargé, tailles par
requête HEAD) :

| nom | adresse | taille | licence | entrée | pour nos vidéos |
|---|---|---|---|---|---|
| Fujifilm GFX ETERNA 55 3D LUT v1.10 (16/04/2026) : ETERNA, PROVIA, Velvia, ASTIA, CLASSIC CHROME, REALA ACE, PRO Neg. Std, CLASSIC Neg., ETERNA BLEACH BYPASS, ACROS, + Neutral, Natural | dl.fujifilm-x.com/support/lut/gfx-eterna-55-3d-lut-v110.zip (page fujifilm-x.com/global/support/download/lut/) | 45,8 Mo | non dite sur la page ; conditions du site : usage personnel non commercial, pas de modification | F-Log2 / F-Log2 C | avec conversion 709 → F-Log2, approchée (et la licence interdit de modifier) |
| Fujifilm, LUT par boîtier (X-H2S, X-T5…) | même page | 0,87 à 3,3 Mo | idem | F-Log / F-Log2 | avec conversion |
| RawTherapee Film Simulation Collection (Pat David) | rawtherapee.com/shared/HaldCLUT.zip | 421,6 Mo | CC BY-SA 4.0 | sRGB (HaldCLUT PNG) | **oui** (l'import HaldCLUT est fait pour elle) |
| RocketStock 35 Free LUTs | pbblogassets.s3.amazonaws.com/uploads/freebies/RS-35-Free-LUTs.zip | 10,5 Mo | ni revente ni redistribution | sRGB / Rec.709 | **oui** |
| IWLTBAP Aspen (et Sedona, Kodachrome) | luts.iwltbap.com/free/… | 80,3 Mo | pas de redistribution ; « cannot be included in an application » | Rec.709 et LOG | oui, sous réserve de la clause |
| Juan Melara, émulations de tirage (Kodak 2383, Fuji 3510…) | juanmelara.com.au/s/Print-Film-Emulation-LUTs.zip | 1,16 Mo | non documentée | log (Cineon) | avec conversion |
| ARRI Look Library (LogC4 / LogC3) | arri.com, look-files | 189,8 / 31,3 Mo | gratuite ; licence non documentée | LogC | double conversion |

**Le choix de Cal (29/09 au soir)** : Fujifilm ETERNA (le kit GFX ETERNA 55)
et RawTherapee Film Simulation ; « on fait du dev donc les licences on s'en
fout pour l'instant ». Les archives iront dans `~/showrunner-refs/luts/` sur
DGX2 (hors du dépôt, qui est public), importées dans `<data_dir>/luts/`.

**Importer un pack** (côté serveur, `python3 -m tools.montage luts
rawtherapee|fujifilm <archive.zip>` depuis `server/`, avec
`SHOWRUNNER_DATA` ; `import_rawtherapee`, `import_fujifilm`,
`set_favourites`) : le portail en marche voit les LUT à la requête suivante,
sans redémarrer ; un pack réimporté n'ajoute rien (même `source`).

- **RawTherapee** : des HaldCLUT PNG sRGB. Une HaldCLUT de niveau 12 (144
  points) passe les 65 points que la page et le cube tiennent bien : elle est
  rééchantillonnée à 33³ (trilinéaire, comme ffmpeg la lirait ; lue dans les
  octets de l'image, sans 9 millions de flottants Python). Famille = la marque
  (premier mot du fichier, sinon le dossier) ; « · N&B » si elle vient d'un
  dossier noir et blanc.
- **Fujifilm** : chaque cube de sortie BT.709 est gardé tel quel (« entrée
  F-Log2 » ou « F-Log2 C », famille « d'origine »), et une version
  **« entrée Rec.709 »** est cuite par simulation (une seule, depuis F-Log2 si
  le kit l'a, sinon F-Log2 C) : la conversion Rec.709 → F-Log2 puis la LUT de
  Fujifilm, en un seul cube. Les sorties HDR (BT.2100) ne sont pas prises.
- **La conversion** (`bake_rec709`) : (1) la valeur Rec.709 → lumière de
  scène : l'inverse de l'OETF de l'UIT-R BT.709-6 (§ 1.2), le blanc (1,0)
  valant une réflexion de 100 % ; (2) BT.709 → F-Gamut ou F-Gamut C, D65 :
  la matrice calculée depuis les primaires des fiches (SMPTE RP 177 ; le
  contrôle vérifie qu'elle redonne la matrice de l'UIT-R BT.2087 à 6·10⁻⁴
  près, F-Gamut ayant les primaires de BT.2020) ; (3) la courbe F-Log2 :
  **« F-Log2 Data Sheet Ver.1.1 »** et **« F-Log2 C Data Sheet Ver.1.0 »** de
  Fujifilm (dl.fujifilm-x.com/technical-data/F-Log2_DataSheet_E_Ver.1.1.pdf,
  …/F-Log2C_DataSheet_E_Ver.1.0.pdf, § 2-3 ; la même courbe pour les deux) :
  `out = c·log10(a·in + b) + d` si in ≥ cut1, `e·in + f` sinon, a = 5,555556,
  b = 0,064829, c = 0,245281, d = 0,384316, e = 8,799461, f = 0,092864,
  cut1 = 0,000889 ; 0 ≤ out ≤ 1 est la valeur de code (0 % → 95/1023, 18 % →
  400, 90 % → 570 : le contrôle les retrouve). Primaires F-Gamut C (§ 3 de sa
  fiche) : R (0,7347 ; 0,2653), G (0,0263 ; 0,9737), B (0,1173 ; −0,0224).
  **Ce qui est supposé, non documenté** : une vidéo Rec.709 « scène »
  (inverse de l'OETF, pas de BT.1886), son blanc à 100 % (code 581/1023 : les
  hautes lumières du look au-delà ne servent pas, les blancs ressortent comme
  Fujifilm rend un papier blanc, pas un ciel brûlé), la LUT lisant la valeur
  de code pleine échelle. Une approximation : l'original « entrée F-Log2 »
  reste à côté.
- **La grille de la cuite : 65³, pas 33³.** Mesuré (29/09, `bake_err.py`,
  3 000 couleurs au hasard, une « Neutral » F-Log2 → 709 exacte de 33³ ou 65³
  en guise de LUT Fujifilm) : la chaîne sans LUT revient à l'image à
  0,06/255 près ; la cuite **33³** s'écarte de la chaîne exacte (709 → F-Log2
  → la LUT lue trilinéaire) de **0,19 en moyenne mais jusqu'à 5,3/255** (près
  du noir, où la courbe log est raide) ; la **65³** de 0,06 en moyenne et
  **1,1 au plus**. Le cube pèse 7,4 Mo en texte, la texture de l'aperçu 3,3 Mo :
  on prend 65³ (`FUJI_BAKE`, un réglage).
- **L'étagère pour des centaines de LUT** : une recherche (titre, famille,
  pack, espace d'entrée ; sans accents), les **favoris** d'abord (rang
  `fav`, dans l'ordre ; clic droit sur une vignette : favori oui/non), puis
  les familles repliables (les cuites Rec.709 de Fujifilm en tête, les
  « d'origine » en log à la fin ; l'état par visiteur). Les vignettes lisent
  une version **17³ sur 8 bits** de chaque LUT (route `/mini`, 14 739 octets,
  mise en cache) et ne se dessinent que quand elles se voient
  (IntersectionObserver) ; un plan lit toujours le cube entier. Le menu LUT
  d'un plan (clic droit) : favoris, puis une entrée par famille.
- **Les favoris** (`FAVS`, le premier titre qui correspond, les cuites avant
  les d'origine ; une liste de secours remplace un motif sans correspondant) :
  ETERNA, CLASSIC CHROME, REALA ACE, ETERNA BLEACH BYPASS, CLASSIC Neg.,
  ACROS (Fujifilm, entrée Rec.709) ; Kodak Portra 400, Kodak Ektar 100,
  Kodak Kodachrome 64, Fuji Velvia 50, Polaroid 669, Ilford HP5
  (RawTherapee) ; de secours : PROVIA, Portra 160, Superia 400, Tri-X,
  Astia 100F, Agfa Vista 200, 400H, Velvia 100. Les noms exacts des fichiers ne
  se liront qu'une fois les archives là.
- **Éprouvé sur des packs d'essai** (fabriqués, rien de téléchargé :
  `fakepacks.py`, la même arborescence et des noms à la manière du kit) :
  11 HaldCLUT et 6 simulations × F-Log2 / F-Log2 C, grilles 33 et 65, une
  sortie HLG → 35 LUT, 12 favoris, la HLG sautée, la grille la plus fine
  gardée ; aperçu contre export (une LUT de chaque famille sur la vidéo
  générée 704×896, `packmesure.py`) : écart moyen 0,95 à 1,41/255 par
  famille, 1,27 sans LUT — la LUT n'ajoute rien à l'erreur de l'encodage.
  La mesure sur les vrais packs se refera dès les archives là.

## Le 29/09 au soir : effets, calques d'effet, groupes de pistes, fondus à poignées

Réponse à la demande de Cal du 29/09, 18 h 10. Essais sur DGX2 (copie
`/tmp/sr_montage`, portail d'essai sur le port 8851, données d'essai à part,
les 342 LUT du portail copiées), Chromium sans affichage de playwright ;
les pilotes sont dans `/tmp/sr_mtg_scripts`.

### L'export : ffmpeg, sur DGX2, voie `cpu`

Le bouton Exporter lance le travail `montage.export` de la file, voie
`cpu` : deux ouvriers « local » (`server/core/config.py`, `lanes.cpu`), donc
sur la machine du portail, **DGX2** ; ffmpeg **6.1.1** d'Ubuntu
(`6.1.1-3ubuntu5+esm7`), `libx264` et l'encodeur AAC de ffmpeg, pas de GPU.
Essai de bout en bout (`exporte.py`) : trois plans (une LUT, un fondu
d'entrée de 12 images, un fondu de sortie de 25, du son) → MP4 lu par
ffprobe : H.264 1280×720 yuv420p BT.709, 25 i/s, **150 images, 6,00 s**,
AAC 48 kHz stéréo de 6,00 s ; rendu en 4 s (une passe), 4,5 s de la demande
au fichier rangé. Le travail rangé dit sa machine (`machine: DGX2`) : la
bulle de fin d'export la nomme.

### Le modèle : des listes d'effets

Un **effet** est `{id, type, on, …}` : `grade` (exposure, contrast,
saturation, temperature — les filtres d'avant) ou `lut` (`lut`, `mix`).
Ce sont les seuls que l'export sait rendre **et** que l'aperçu calcule
pareil ; rien d'autre n'est proposé. Une liste d'effets s'applique dans
l'ordre ; elle est portée par un plan (`clip.fx`), une piste vidéo
(`track.fx`), un groupe de pistes (`group.fx`) ou un calque d'effet. La
chaîne d'un plan (`chainOf`, `model.js` ; `chain_of`, `montage.py`, ligne
pour ligne) : ses effets, puis ceux de sa piste, puis ceux du groupe de sa
piste — les effets désactivés et les étalonnages neutres ne comptent pas.
Un plan d'avant (champs `grade` et `lut`) se relit sans perte : son
étalonnage puis sa LUT deviennent deux effets (`normalize`, `normClip`).

Les effets de piste et de groupe s'appliquent **plan par plan** (dans la
passe de chaque plan, comme ses propres effets), pas à l'image composée de
la piste : c'est la même chose tant que les plans d'une piste ne se
recouvrent pas ; pendant un fondu enchaîné, chaque plan est passé par
l'effet avant d'être mêlé (non documenté pour Premiere ; choisi parce que
l'aperçu et l'export le font de la même façon).

**Aperçu** : une chaîne passe par `lut.js` (`drawChain`) — un étalonnage
et la LUT qui le suit en une passe (le shader d'avant), plusieurs passes
sinon, d'image intermédiaire en image intermédiaire (demi-flottants si
`EXT_color_buffer_float` le permet, MDN ; 8 bits sinon). **Export** : les
filtres de chaque effet, dans l'ordre (`_fx_filters`). Lu dans ffmpeg
(`-v verbose`, DGX2) : `eq` n'accepte pas le RVB ; ffmpeg insère lui-même
une conversion vers yuv444p avant lui et revient en RVB après (matrice par
défaut dans les deux sens : l'aller-retour se compense) — c'était déjà le
cas avant ce soir, ce n'est pas nouveau.

### La LUT qui repassait par « sans LUT »

Cause (lue dans `player.js` d'avant) : à chaque image, le plan demandait sa
LUT (`getLut`) ; une LUT pas encore chargée rendait `null`, le canevas de
la LUT était **retiré** et la vidéo brute se montrait le temps du
chargement du `.cube` (7 Mo de texte pour une cuite Fujifilm 65³).
Désormais chaque plan garde sa dernière chaîne **prête** (`chainReady`) :
tant qu'une LUT de la nouvelle chaîne se charge, l'ancienne reste dessinée,
puis l'image bascule d'un coup.

Mesure (`p1_lut_flash.mjs`, à l'arrêt sur le plan c2, sa LUT « Sarcelle
orange » remplacée par la cuite ETERNA 65³, jamais chargée ; un
enregistreur à chaque image d'affichage, `requestAnimationFrame`, lit ce
qui se voit et le pixel du centre) :

| | ce qui se voit |
|---|---|
| origin/main (port 8852) | Sarcelle (229,173,148) jusqu'à 158 ms · **vidéo brute (220,172,152) de 186 à 490 ms** · ETERNA (216,200,189) |
| ce soir (8851) | Sarcelle (229,173,148) jusqu'à 440 ms · ETERNA (216,200,189) dès 440 ms · **aucune image sans LUT** (210 images enregistrées) |

Captures pendant le changement : `p1-avant-0…5.png`, `p1-neuf-0…5.png`.

### Le panneau Effets (un onglet du panneau Source)

Le panneau Source a deux onglets, **Effets** (au départ) et **Source**.
Un clic sur un clip du Projet le charge dans la source sans quitter les
effets ; un **double-clic** bascule sur Source (comme « Ouvrir dans le
moniteur source », la concordance des images, « Voir » un export).
La bibliothèque (`effets.js`) : Transitions (Fondu, Fondu enchaîné),
Couleur (l'étalonnage et sept préréglages : noir et blanc, désaturer,
réchauffer 4800 K, refroidir 8500 K, contraste +25, ±½ IL — des réglages de
l'effet `grade`, rien d'autre), les LUT favorites, puis une famille par
dossier repliable (Fujifilm cuites Rec.709, marques de pellicules
RawTherapee, importées, les « d'origine » en log à la fin). Une recherche
sans accents ; une vignette par effet (l'image du plan choisi ou du
programme passée par l'effet — la LUT par sa version 17³), dessinée
seulement quand elle se voit. Une famille repliée ne fabrique pas ses
lignes. Premiere a le même panneau (« Effects ») ; le double-clic sur un
effet l'applique à ce qui est choisi.

L'étagère de LUT de l'inspecteur et le sous-menu LUT de chaque plan sont
retirés : un plan montre **ses** effets, pas la bibliothèque.

**Glisser un effet** (`bindEffectDrops`) : sur un plan, il s'ajoute à ses
effets — une LUT **remplace** la LUT du plan (changer de look), Maj
l'ajoute en plus ; sur l'en-tête d'une piste vidéo : aux effets de la piste
; sur l'en-tête d'un groupe : aux effets du groupe ; sur la **règle**,
au-dessus de la première piste : un **calque d'effet** ; sur une piste de
calques : un calque de plus à cet endroit. Un fondu lâché sur un plan se
pose au bord le plus proche. Pendant le glisser, la cible s'éclaire et une
étiquette dit ce qui va se passer.

### Le calque d'effet

Une piste de sorte `fx` (identifiants **X1, X2…**, comptés du bas comme
V) parmi les pistes de l'image, qui ne porte que des plans `adjust` (sans
objet, `item: ""`) : leurs effets s'appliquent à **tout ce qui est dessous**
sur leur durée ; ils s'étirent, se déplacent, se coupent, fondent comme des
plans. Le lâcher sur la règle crée la piste tout en haut, nommée
« FX <effet> » (renommable : double-clic sur son nom, clic droit), et un
calque de l'image lâchée à la fin de la séquence (5 s s'il n'y a rien
après). L'œil de la piste coupe ses calques.

- **Export** (`plan_video`) : en montant les pistes (V1 d'abord), un calque
  actif dédouble l'image composée jusque-là (`split`) ; une branche, coupée à
  sa fenêtre (`trim=start_frame:end_frame`), passe en RVB BT.709, traverse
  les effets, revient en YUV, fond en transparence (`fade … alpha=1`) et se
  pose sur l'autre (`overlay=eof_action=pass`) — le même motif que les plans.
- **Aperçu** (`Program.compose`) : un calque actif fait composer tout le
  programme dans un canevas à la taille de la séquence (1920 px au plus), sur
  du noir opaque (0,0,0 — celui de `color=c=black`), plans cadrés comme
  l'export (contenus, centrés), chacun avec son opacité ; le calque applique
  sa chaîne à ce qui est déjà posé, mêlé selon son fondu ; les éléments
  restent dessous comme sources. Sans calque actif, rien ne change.
- **Mesure** (`p3_calque.mjs` + `cmp_calque.py`) : un calque « Inversion »
  au-dessus de trois pistes (dont une image à LUT 60 % en V2), image 60 :
  le canevas de l'aperçu contre l'image 60 du MP4 exporté (décodée en
  BT.709) : **écart moyen 1,20/255**, 96,3 % des pixels à ±3, maximum 83 sur
  les bords francs (le 4:2:0 de la sortie — la branche du calque repasse par
  le yuv420p de l'image composée) ; l'aperçu inversé contre l'export :
  126/255, donc c'est bien la même image, pas une ressemblance. Le contrôle
  (`check.py`) exporte un calque d'inversion sur des images 10 à 30 : rouge
  avant et après, (35,215,215) dedans.
- La lecture passe dans le calque (essai : 2,5 s de lecture, composée).

### Les groupes de pistes

Comme dans ODIO (`musique/projet.js` : `rangerGroupes`, `deplacerPistes`,
`grouperPistes`) : `track.grp` + `project.groups = [{id, name, fx}]`.
Glisser l'en-tête d'une piste (`pistes.js`) : le tiers haut ou bas d'une
autre piste = entre les pistes (un trait d'insertion, elle ira là) ; son
cœur = elle-même (elle s'entoure : lâchée, un groupe naît, « Groupe n ») ;
l'en-tête d'un groupe (une ligne fine au-dessus de ses membres) se glisse :
le groupe entier bouge ; lâcher sur lui fait entrer. Entre deux membres on
entre dans le groupe, à son bord on y reste, ailleurs on en sort ; **un
groupe d'une seule piste se défait**. Une piste reste dans sa famille
(l'image en haut, le son en bas : une piste son lâchée sur une vidéo ne fait
rien). Les pistes se renumérotent par leur place (V1 en bas), les plans et
la hauteur de chaque piste (molette commune) suivent leur piste. Un clic sur
un en-tête choisit la piste ou le groupe : l'inspecteur montre ses effets.
Chaque geste est une entrée d'annulation (essais : `p4_groupes.mjs`, 14 sur 14).

### Les effets dans l'inspecteur

La liste d'effets d'un plan, d'un calque, d'une piste ou d'un groupe :
clic = choisir (Maj : jusqu'à lui, Ctrl : ajouter ou retirer), l'effet seul
choisi ouvre ses réglages sous lui (l'intensité d'une LUT, les quatre
curseurs de l'étalonnage) ; la poignée ⋮ se glisse pour réordonner ;
l'interrupteur désactive (l'effet reste, barré) ; × ou Suppr retire ;
Ctrl+C copie les effets choisis (tous s'il n'y en a pas), Ctrl+V les colle
sur la liste qui a le clavier — ou, les effets ayant été copiés en dernier,
sur la piste, le groupe ou les plans choisis ; **Ctrl+Alt+V** colle
toujours les effets sur ce qui est choisi (Premiere : « Coller les
attributs » ; raccourci non revérifié ce soir dans la page d'Adobe, qui
répond 403 aux robots). Essais : `p5_copier.mjs`, 18 sur 18.

### Les fondus à poignées

Chaque plan (vidéo, image, son, calque) a deux poignées dans ses coins hauts
(Premiere et Resolve les mettent là) : tirées vers l'intérieur, elles
allongent le fondu d'entrée ou de sortie, image par image, vu en direct au
programme, la durée écrite pendant le geste, une seule annulation. Entrée +
sortie ≤ durée (`fitFades`). Le fondu se dessine sur le plan : la courbe, et
au-dessus la part assombrie. L'ancien réglage (« fondu au noir » qui
descendait aussi le plan d'avant, des boutons à trois choix) est remplacé par
la carte **Fondus** de l'inspecteur (entrée, sortie, le fondu enchaîné avec
le plan d'avant s'il y en a un, collé).

**Les courbes** : `fade` (l'image) n'a pas de courbe dans ffmpeg 6.1
(`ffmpeg -h filter=fade` : type, start_frame, nb_frames, alpha, start_time,
duration, color) : l'image fond toujours en ligne droite. `afade` (le son) a
`curve` ; on en propose dix (tri, qsin, hsin, esin, log, exp, par, ipar,
qua, squ), leurs formules lues dans `libavfilter/af_afade.c` de la 6.1.1
(`fade_gain`) et recopiées dans `curveGain` (`model.js`) pour l'aperçu ;
la sortie lit la courbe sur ce qui reste du fondu (`start_sample +
nb_samples − cur_sample`), comme `gainAt`. Mesure (`mesure_courbe.py`) :
une sinusoïde fondue en « exp » (entrée) et « qsin » (sortie), exportée par
le vrai travail ; le gain mesuré dans le MP4 (RMS par image) contre la
formule : **écart maximal 0,006** (le bruit de l'AAC). Le gain de l'aperçu
à 20, 50 et 80 % du fondu = sin(x·π/2) à 10⁻¹⁶ près.

### Moins de texte

Les aides répétées sont retirées : la ligne d'aide du Projet, « aperçu
fidèle · étalonnage approché », les notes des cartes de l'inspecteur, la
bulle à chaque changement d'outil, les infobulles-phrases (il reste le
raccourci). Les gestes sont dans la boîte des raccourcis (?), qui a ses
sections Effets, Pistes, et la molette commune (`REGLE`).

## Le 06/10 : rogner, le moniteur pendant un geste, le son au défilement

Trois demandes de Cal du 06/10.

### Rogner tronque (outil Sélection, V)

« Quand on change la taille d'un segment, ça pousse le contenu au lieu de le
tronquer, comme dans Premiere Pro. » Le comportement de Premiere (guides tiers, par
les résultats de recherche ; helpx.adobe.com ne s'ouvre pas d'ici : agitraining.com, « Trimming clips on the
Timeline in Premiere Pro » ; gotranscript.com, « Cut Faster in Premiere Pro with
Purposeful Trims ») : tirer un bord avec la Sélection change le point d'entrée
(ou de sortie) dans la source ; le plan raccourcit et laisse un vide, les plans
suivants ne bougent pas ; la propagation (B) est l'autre outil.

Le modèle faisait déjà cela (`M.trimClip` : à gauche, `start` et `in` avancent
ensemble, la matière reste calée dans le temps ; à droite, seule la durée
change ; `M.trimLimits` : la source, les voisins, une image fixe sans borne).
Ce qui se voyait, c'était le geste : seul le cadre du plan bougeait jusqu'au
lâcher, l'onde et les vignettes collées à son bord gauche — la matière semblait
poussée. Rogner passe désormais par le geste vu en direct (comme B, N, R) : à
chaque mouvement le modèle rejoue le rognage et la timeline se redessine, l'onde
reste en place ; les vignettes d'un plan vidéo sont calées sur le début de la
source (`background-position`) ; l'infobulle dit la source (entrée → sortie /
durée). Le selftest du Montage mène `model.js` par node (entrée et sortie,
bornes, vitesse × 2, image fixe).

### Le moniteur pendant un geste

« L'image du moniteur ne se met à jour qu'au lâcher. » Le programme peut
montrer un aperçu (`pv`, montage/player.js) sans toucher au montage de la page :

- **déplacer** (ou copier) des plans : l'image sous la tête de lecture, du
  montage tel qu'il serait si l'on lâchait maintenant (`M.moveClips` sur une
  copie, une fois par image d'écran) ;
- **rogner** (V), propager (B), déplacer la coupe (N), changer la vitesse (R) :
  depuis le 06/10 au soir, l'image sous la tête de lecture, le montage tel qu'il
  serait au lâcher (voir « Les poignées » plus bas) ; **Alt maintenu**, l'image du
  bord qu'on tire, le plan seul et plein (Premiere montre le bord rogné au
  moniteur — en deux images, sortante et entrante, en mode Trim : helpx « Edit in
  Trim mode », par les résultats de recherche ; ici une seule, celle du bord pris).
  Rien pour un son ou un calque d'effet.

Fluide : la copie de défilement est devant pendant le geste, l'originale se
cale au lâcher ; un plan neuf du même média (le morceau d'un plan coupé, une
copie) reprend l'élément d'un plan qui n'est plus dans le montage. Mesuré
(Chromium sans affichage, 70 mouvements, A glissé au milieu de B sous la tête) :
2 `<video>` créées (A et sa copie), aucune ensuite, l'image passe de B à A
pendant le geste ; l'aperçu coûte 0,1 ms par image d'écran (médiane), 2,5 ms au
plus.

### Le son au défilement (commun/scrub.js)

« Entendre le son quand on fait glisser la tête de lecture, hyper important
pour caler un cut. » Premiere : Préférences → Audio, « Play audio while
scrubbing » (guides tiers, par les résultats de recherche : premiumbeat.com,
4kshooters.net, motionarray.com ; non vérifié chez Adobe) ; Live rejoue un morceau de l'arrangement sous la souris dans sa zone
de défilement (manuel de Live 12, « Arrangement View », Scrub Area, par les
résultats de recherche : ableton.com ne s'ouvre pas d'ici).

Une mécanique commune, pour le Montage et ODIO : chaque fois que la tête a
bougé pendant un geste, un grain de 60 ms part à sa place, un toutes les 30 ms
au plus ; fenêtre de Hann (setValueCurveAtTime) : ni claquement, ni bosse (deux
fenêtres décalées de moitié somment à 1) ; la vitesse du grain suit celle du
geste (0,5 à 2 : la hauteur suit, comme une bande poussée à la main) ; à
rebours, les grains se lisent à l'endroit et reculent ; silence quand la tête
s'arrête ; rien au simple clic. Préférence Général → « Son au défilement ».

Le son vient d'une copie faite pour cela (`GET /api/defil/<id>/son`,
server/tools/defilement.py) : mono, 22 050 Hz, FLAC — un codeur à trames (AAC,
MP3) ajoute un délai au départ qui décalerait les grains —, aux temps de
l'originale. Le Montage fait entendre, comme la lecture, les plans des pistes
son et le son des vidéos (muet, solo, fondus, volume, vitesse) ; la barre de la
source, l'objet ouvert. Essayé en espionnant `AudioBufferSourceNode.start` :
61 grains pour 50 images glissées sur deux sons, aucun au clic, aucun la tête
arrêtée, aucun préférence coupée.

Non fait : deux images au moniteur pendant un rognage (le mode Trim de Premiere).

### Le son au défilement partout, et le pas à pas (06/10, suite)

La même mécanique (commun/scrub.js), étendue :

- **le lecteur commun** (commun/lecteur.js : la fiche d'Asset, le fil d'Image et
  de Vidéo, Transcrire, Idéation, les paroles calées, la playlist, la
  visionneuse de Movie Analysis) : glisser la frise fait entendre le son de
  défilement de l'objet, aux mêmes grains, au volume et au « muet » du lecteur ;
  le contexte audio est celui des pages sans moteur de son (`contexteCommun`,
  créé dans le geste). Movie Analysis : seule une analyse lancée d'ici, qui
  dit la vidéo de la bibliothèque qu'elle a dépouillée (`item`, un lien dur du
  même fichier) ; nos films sont sur R2 et durent plus de 30 min ;
- **le pas à pas** : ← →, et J ou L la touche K tenue (Premiere : « hold K and
  tap J or L ») avancent d'une image et font entendre un grain, un seul, à la
  nouvelle place, à la vitesse du son. Premiere fait de même : « Play audio
  while scrubbing » vaut pour la tête glissée, les flèches et J K L (fils du
  forum d'Adobe « Sound when going frame by frame in Premiere Pro » et « Audio
  preview frame by frame », lus par les résultats de recherche ;
  community.adobe.com et helpx.adobe.com ne s'ouvrent pas d'ici). La lecture à
  rebours (J), qui n'a pas de son à elle, est un geste comme un autre ; la
  lecture en avant a le sien : aucun grain. Dans le Montage, au programme
  comme à la source ;
- **ODIO, les clips de notes** : la tête de l'arrangement qui passe sur le
  début d'une note la fait jouer par l'instrument de la piste (Logic Pro rejoue
  de même les régions MIDI qu'on parcourt : Logic Pro User Guide, « Scrub a
  project in Logic Pro for Mac », par les résultats de recherche). Courte (la
  durée de la note à la vitesse du geste, 150 ms au plus) ; par piste,
  l'attaque la plus proche de la tête seule (un accord reste un accord), huit
  notes par pas au plus, et la source se tait avant de rejouer : rien ne
  s'empile. Les notes sont celles de la lecture (Graph.notes : le motif
  bouclé, l'arpège, les voix de la boîte à rythmes).

Essayé (commun/pilote_scrub.mjs, Chromium sans affichage, une vidéo VP9/Opus et
un son WAV de ffmpeg, en sombre et en clair) : 40 grains pour 40 mouvements sur
la frise du lecteur, aucun au clic ; un grain par image pour ← →, K + J ou L,
au lecteur, au programme et à la source du Montage ; 18 à 21 grains pour 0,6 s
de J ; aucun en lecture ni préférence coupée ; ODIO : 147 notes en 43 pas en
glissant sur 43 noires du projet de démonstration, 7 au plus par pas, aucune au
clic ni préférence coupée.

### Les poignées : rogner le début (06/10, suite)

Cal : « la poignée d'un segment sur la timeline à l'avant ne fonctionne pas pareil que
celle de fin. Les poignées sont des in/out sans changer la position des frames dans la
timeline, basta. »

**Reproduit à la souris** dans le vrai Montage (portail d'essai, Chromium sans affichage),
sur des sources VP9 dont chaque image porte son numéro (incrusté, et codé dans la couleur
d'un coin : rouge = n mod 16, vert = n div 16, par pas de 16), lu au moniteur dans
l'élément qui se voit, à un instant T fixe avant, pendant et après le geste :

| outil, bord | modèle (début, durée, entrée) | à T, au moniteur | timeline |
|---|---|---|---|
| V, début +20 (25 i/s) | 50, 100, 1,0 → 70, 80, 1,8 | 95 → 95 (pendant : 45, l'image du bord) | vignettes à leur place (l'origine de la bande ne bouge pas à 0,01 px près), voisins immobiles |
| V, début +10 à ×2 | 50, 50, 1,0 → 60, 40, 1,8 | 85 → 85 | idem |
| V, fin −10 à ×2 | 60, 40, 1,8 → 60, 30, 1,8 | 85 → 85 (pendant : 103, la dernière image) | idem |
| V, début +20 d'un son | 50, 100, 0,5 → 70, 80, 1,3 | — | l'onde : 442 colonnes d'écran sur 443 identiques (la dernière : le bord) |
| V, début +10 d'une image fixe | 200, 50 → 210, 40 | — | — |
| B (propagation), début +20 | 50, 100, 1,0 → 50, 80, 1,8 ; la suite recule de 20 | 95 → 115 | la tête garde sa place, la matière change : c'est la propagation de Premiere |
| N (sans voisin collé) | comme V | 95 → 95 | — |
| R (vitesse), début +20 | 70, 80, ×1,25 | 95 → 87 | la matière est la même, plus vite |

Le modèle, le moniteur, l'onde et les vignettes tenaient donc déjà la règle avec V. **Ce
qui ne la tenait pas : l'export d'une source d'une autre cadence que la séquence**
(24 ou 16 i/s, celle des vidéos générées, dans une séquence à 25). La chaîne
(`-ss`, `setpts=PTS-STARTPTS`, `fps`) jetait l'écart entre l'image où `-ss` arrive et
l'instant voulu, et `fps` arrondissait au plus proche ; l'image exportée à T dépendait
donc de l'entrée du plan. Mesuré (24 i/s, entrée 1 s) : à T = 80, 53 avant le rognage,
52 après, 52 au moniteur ; à T = 100, 72 puis 71, 72 au moniteur. Le bord de fin ne
change pas l'entrée : il ne le montrait pas.

**À la racine** (`_open_video`) : chaque image de la source prend pour horodatage l'instant
de la timeline où elle commence à se voir, (t_source − entrée − 1 ms) / vitesse, et
`fps=…:start_time=0:round=up` garde pour chaque image de sortie la dernière image
commencée (doc ffmpeg-filters, fps : « round », « start_time … padding/trimming at the
start of stream ») — la règle du moniteur (`sync` : l'image qui contient l'instant, + 1 ms).
`-copyts` garde les horodatages de la source : sans lui, ffmpeg y retranche le point de
recherche arrondi à la base de temps du fichier (1 ms en WebM), et il restait 4 écarts sur
2880 images aux bords ; avec, 0. Essai (ffmpeg seul) : 4 sources (25, 24, 16 i/s ; WebM,
MP4), 8 entrées (dont une négative, la tête d'un fondu enchaîné, et une au-delà de la fin),
3 vitesses (0,5 ; 1 ; 2), 30 images chacune : **0 image sur 2880** ne suit pas la règle,
contre 595 avec la chaîne d'avant. De bout en bout (le vrai travail d'export contre le
moniteur de la page, une source 24 i/s, chaque image de 63 à 149 après un rognage de
début de 13) : **87 images sur 87 identiques**, et à 16 i/s ×1,5 les mêmes avant et après.

**La vraie cause, trouvée par Cal** (06/10 au soir, une photo de son écran : un plan
« vidéo avec son » sur la piste du haut, une voiture dessous, un zoom très fort, la tête
quelques images après le bord gauche) : « dans la frame, on ne lit plus sous la cue, mais ça
affiche le nouveau in… C'est pour ça que mon footage en dessous disparaît. C'est pas si mal,
mais je préfère avoir les fonctions de in et out comme je t'ai dit. » Pendant le geste, le
moniteur montrait l'image du bord tiré (ci-dessus, « Le moniteur pendant un geste ») : à
la place de l'image sous la tête, une image qui défile quand on tire — on croit voir la
matière glisser sous la tête, alors que le modèle tronque bien.

Désormais (`live`, montage/timeline.js) : **pendant un rognage (V, B, N, R), le moniteur
montre l'image sous la tête de lecture**, le montage tel qu'il serait si l'on lâchait
maintenant (le projet de la page est rejoué à chaque mouvement, le programme se redessine) ;
tant que le bord ne passe pas la tête, l'image ne change pas ; quand il la passe, ce qui est
dessous apparaît (la piste inférieure, ou le noir). **Alt maintenu** — on peut le prendre et
le lâcher pendant le geste — montre l'image du bord tiré, le plan seul, comme avant (une
touche plutôt qu'une préférence : c'est le plus simple, et on passe d'une vue à l'autre sans
lâcher le bord ; Alt n'a pas d'autre sens sur un bord). Le déplacement d'un plan montrait déjà
l'image sous la tête.

Le pilote `montage/pilote_poignees.mjs` (Playwright, portail d'essai ; 41 essais, sombre et
clair, aucune erreur de console ; aussi avec la copie de défilement à l'œuvre, faite en VP9
pour le Chromium du conteneur) : pendant un rognage lent (40 pas d'un demi-pixel, moins
d'une image chacun : 13 débuts différents), la scène du moniteur est **la même au pixel
près** (capture comparée à celle d'avant) et le modèle reste juste à chaque pas ; rapide,
l'image 95 jusqu'à ce que le bord passe la tête, puis l'image fixe de la piste du dessous ;
Alt : l'image du bord (100), lâché : de nouveau dessous ; le bord de fin pareil. Puis, à T
fixe avant et après : une vidéo avec son, un son seul (l'onde : les attaques des bips au même
x d'écran, au pixel près), les deux ensemble (un son dissocié n'est lié à rien : chacun se
rogne par sa poignée), un zoom fort (32 px par image, +3 images = 96 px), l'aimant (le bord
se colle à la tête, l'entrée suit), rogner puis re-tirer vers la gauche (jusqu'au début de la
source), ×1,5, une image fixe (sans borne de source), B, N, R, et chaque Ctrl+Z.

Le contrôle : `model.js` mené par node (l'invariant : après un rognage de début de +10,
−25, +49 à ×1, de +7 et −5 à ×2, de +13 à ×0,5, ×1,5 et ×3, chaque instant restant montre
le même temps de la source, la fin et les autres plans ne bougent pas) ; l'export de deux
sources numérotées (24 i/s, et 16 i/s à ×1,5) avant et après un rognage de début, chaque
image comparée à la règle du moniteur.

## Le 06/10 : la trajectoire — déplacer, mettre à l'échelle, tourner, recadrer

Cal, 06/10 : « Dans le banc de montage, il faut pouvoir déplacer les éléments
dans la frame, pour pouvoir composer des montages avec des grilles vidéo, et
même le zoom aussi. Regarde dans Premiere : le panneau de droite doit avoir ces
options, comme celui des effets par clip dans Premiere. »

### Ce que fait Premiere (les sources)

`helpx.adobe.com` et `web.archive.org` sont fermés depuis le conteneur de la
session cloud (le proxy refuse) : ce qui suit vient des **résultats de
recherche** sur les pages d'Adobe et de guides, pas d'une lecture des pages.

- « Apply Motion effect to clips » (helpx …/premiere-pro/using/motion-position-scale-rotate-clip.html,
  et …/premiere/desktop/add-video-effects/commonly-used-effects/apply-motion-effect.html) :
  l'effet fixe **Trajectoire** (Motion) a Position, Scale, Scale Width (« Uniform
  Scale »), Rotation, Anchor Point, Anti-flicker Filter ; on glisse l'image au
  moniteur pour la position, les poignées pour l'échelle ; « the anchor point is
  the place where all the other fixed effects will work from. If you rotate your
  clip it will rotate around the anchor point » ; la rotation : « hover slightly
  above and outside of any of the corner handles until you see the rotation icon ».
- Le double-clic au moniteur (guides, Larry Jordan « Premiere Pro CS6: Moving
  Images and Effect Controls », Creative COW) : « Double-clicking a clip inside
  the Program Monitor selects it and displays a bounding box around the clip with
  a centered anchor-point cross hair and handles ».
- « Types of effects in Premiere » (helpx …/premiere-pro/using/effects.html) : les
  effets fixes (Trajectoire, Opacité, Remappage temporel, Volume) se rendent
  **après** les effets standard ; pour changer l'ordre, l'effet standard
  **Transform** remplace la Trajectoire.
- L'effet **Crop** (guides PremiumBeat, Boris FX) : Left, Top, Right, Bottom en
  pour cent de l'image ; Edge Feather ; Zoom.
- « Snap objects to guides » (helpx …/premiere/desktop/get-started/source-and-program-monitor-adjustments/snap-objects-to-guides.html) :
  « Snap in Program Monitor », aux bords et au centre de l'écran (« within 2
  pixels »).

### Le modèle (`motion`, model.js et montage.py)

Un plan vidéo ou image d'une piste V porte `motion` ; sans lui, rien ne change
(un montage d'avant se relit tel quel : `normalize` ne l'écrit pas quand il vaut
le défaut ; le contrôle le vérifie).

| champ | sens | défaut |
|---|---|---|
| `x`, `y` | la place du point d'ancrage, en **fraction du cadre** | 0,5 ; 0,5 |
| `scale` | l'échelle ; la hauteur si `uniform` est faux | 1 |
| `scaleW`, `uniform` | la largeur, l'échelle uniforme | 1, vrai |
| `rot` | degrés, sens horaire | 0 |
| `ax`, `ay` | le point d'ancrage, en fraction de l'image source | 0,5 ; 0,5 |
| `op` | l'opacité, multipliée par les fondus | 1 |
| `cl`, `ct`, `cr`, `cb` | le recadrage : la fraction retirée de chaque côté, qui devient transparente (l'image ne bouge pas) | 0 |

- **La position en fraction, pas en pixels** : une grille reste juste si le format
  de la séquence change (1080p → 4K), les cases tombent juste (¼, ¾) ; le panneau
  l'affiche en pixels de la séquence, comme Premiere, et l'ancrage en pixels de
  l'image.
- **L'échelle 100 % = l'image tient dans le cadre** (la mise en place d'avant,
  contenue, centrée ; Premiere : « Ajuster à la taille de l'image ») : rien ne
  bouge pour un montage d'avant, et 50 % fait une case de grille 2 × 2 pour une
  image aux proportions du cadre.
- **L'ordre** : les effets du plan (étalonnage, LUT, ceux de sa piste et de son
  groupe) agissent sur l'image du plan, puis viennent le recadrage, l'échelle, la
  rotation, la position, l'opacité — l'ordre de Premiere.
- `cadre(m, W, H, sw, sh)` dit où se pose l'image : l'échelle qui la fait tenir
  (k0), les pixels du cadre par pixel de la source (kx, ky), la part gardée de la
  source, son centre dans le cadre et sa taille avant la rotation. Il existe deux
  fois, ligne pour ligne (model.js, montage.py), comme `windows` ; le contrôle les
  compare sur sept cas (mêmes nombres à 10⁻⁹ près), ainsi que `cleanMotion` /
  `_motion` (bornes, un vrai/faux ou un texte vide ignorés).

### L'export (`_placement`, ffmpeg 6.1.1)

Sans trajectoire, la chaîne d'avant, inchangée (`scale … force_original_aspect_ratio
=decrease`, `pad` centré). Avec : `pre` passe la source en RVB à sa taille dans le
cadre, les effets s'appliquent, puis `post` :
`crop` (le recadrage) → `format=gbrap` → `colorchannelmixer=aa=` (l'opacité) →
`rotate=a=…:ow=…:oh=…:c=black@0` → `crop` + `pad=W:H:x:y:color=black@0` (la part
qui tombe dans le cadre, posée dans une image transparente) → YUV BT.709 →
`tpad`, `trim`, les fondus et `overlay` comme les autres plans.

- **Seule la part visible est mise à l'échelle** : le cadre ramené dans la source
  par ses quatre coins, croisé avec le recadrage, un pixel de marge. Un zoom à
  1000 % d'une image 1080p ne fabrique pas une image de 19 200 px.
- **Des pixels entiers** : tailles et positions arrondies (au plus proche, la
  moitié vers le haut, comme `Math.round`) ; `rotate` tourne autour du centre de
  son entrée et le pose au centre de sa sortie (vf_rotate.c) : sa sortie a la
  parité de l'image, le centre reste sur un pixel entier. D'où « à un pixel près ».
- En RVB (gbrp, gbrap) : `crop` et `pad` n'y arrondissent pas les positions à la
  grille de la chrominance, comme ils le font en yuv420p. `c=none` de `rotate`
  laisse le fond non peint : on prend `black@0`.
- La taille décodée d'une vidéo (`_video_color`) tient compte de sa rotation
  (`side_data_list`, `rotation` ; ffmpeg et le navigateur tournent l'image, essayé
  sur une vidéo à `-display_rotation 90` : 320 × 180 lue 180 × 320).
- **Contrôle** (`_selftest_trajectoire_export`, le vrai travail de la file, 720p) :
  grille 2 × 2 de quatre sources de couleur sur V1 à V4, chaque quart de sa
  couleur, et les cases qui se touchent au milieu au pixel près (16 px de part et
  d'autre) ; un plan 320 × 180 tourné de 90° debout au centre (noir à côté) ; un
  plan déplacé en bas à droite à 50 % d'opacité (vert à moitié sur le noir) ; un
  plan recadré de moitié à gauche (la moitié droite reste à sa place).

### Le moniteur (player.js) : le même calcul

Chaque élément (vidéo, image, sa copie de défilement, son canevas d'effets) est
posé dans la scène par `left`, `top`, `width`, `height` en pour cent du cadre
(l'image source entière à son échelle), `rotate` autour du centre de la part
gardée, `clip-path: inset` pour le recadrage (dans les coordonnées de l'élément :
il tourne avec lui), l'opacité multipliée par celle des fondus. Le programme
composé (un calque d'effet actif) dessine la même géométrie dans son canevas
(`translate`, `rotate`, la part gardée en `drawImage`). Les plans se superposent
dans l'ordre des pistes, la piste du haut au-dessus, chacun avec son opacité.

**Mesure** (`exact.js`, Chromium sans affichage, capture de la scène ×2, 1004 ×
564, contre l'image 10 de l'export du vrai travail ramenée à cette taille ; quatre
plans : une rotation de 30° recadrée, une de −12° à 60 % d'opacité autour d'un
ancrage décentré, une échelle non uniforme recadrée en bas, un fond plein cadre) :

| | écart moyen (0..255) | pixels à ± 12 |
|---|---|---|
| éléments posés en CSS | 3,7 · 2,8 · 3,2 | 89,9 % |
| programme composé (un calque d'effet, saturation −40) | 6,6 · 6,3 · 6,2 | 87,2 % |
| témoin : désaturé contre non désaturé | 39,5 · 12,5 · 28,0 | — |

L'image d'écart (×4) ne montre que les bords et les filets fins de la mire (le
rééchantillonnage, le 4:2:0 de la sortie) : aucun décalage de géométrie. Le
surplus du programme composé est l'étalonnage approché (`eq` contre `saturate`),
déjà connu.

### Les gestes au moniteur (cadre.js)

Le plan choisi (un seul, visible sous la tête, piste non verrouillée) montre son
cadre, ses poignées de coin et la croix de son point d'ancrage ; plusieurs plans
choisis, leurs cadres en pointillé. Un **double-clic** dans l'image choisit le
plan le plus haut qui s'y voit (sa part gardée).

- glisser dans le cadre : la position ; maj : un seul axe ;
- un coin : l'échelle autour du point d'ancrage, **proportions gardées ; maj les
  libère** (largeur et hauteur séparées, l'échelle n'est plus uniforme) — la
  demande de Cal ; Premiere fait l'inverse quand « Échelle uniforme » est décochée
  (« to scale proportionally, shift-drag a corner handle ») ;
- juste hors d'un coin (22 px) : tourner autour du point d'ancrage ; maj : par 15° ;
  les tours s'additionnent (un geste peut faire plus d'un demi-tour) ;
- **alt** + glisser la croix de l'ancrage : le déplacer sans bouger l'image (la
  position suit). Sans alt, la croix se prend comme le reste du cadre : on prend un
  plan par son milieu, où est l'ancrage — essayé, la croix seule volait le geste ;
- l'aimant (le même que la timeline, S ; ctrl le suspend le temps du geste) : les
  bords et le centre de l'image (sa boîte) aux bords et au centre du cadre, le coin
  d'une image droite aux bords du cadre, la rotation aux angles droits (à 3°),
  l'ancrage au centre de l'image ; 6 px d'écran ; un repère pointillé se dessine.

L'image du moniteur suit à chaque mouvement (le plan de la page change, le
programme se redessine à l'image d'écran suivante) ; le lâcher fait **une seule
annulation**. Le moniteur garde 14 px de marge autour du cadre (les poignées d'un
plan plein cadre, et l'anneau où l'on tourne, restent dans l'écran), et isole ses
couches (`isolation: isolate`) : le programme composé et la trajectoire passaient
par-dessus les menus. Le cadre marche dans le programme détaché sur un 2ᵉ écran
(essayé : le geste, puis la fenêtre redimensionnée, le cadre suit).

### L'inspecteur : la carte Trajectoire

Pour le plan choisi, avant ses Effets (l'ordre du panneau Options d'effet de
Premiere) : les grilles, position x et y (px de la séquence), échelle (ou hauteur
et largeur), échelle uniforme, rotation, ancrage x et y (px de l'image), opacité,
recadrage gauche, droite, haut, bas ; « Réinit. » remet tout par défaut. Chaque
réglage : le curseur du thème (commun/curseur.css) sur une plage courante, et un
champ pour la valeur exacte, qui va au-delà (une position hors du cadre, 1000 %) ;
glisser ou taper fait une annulation.

**Les grilles en un clic** (`GRILLES`, `dansCase`) : plein cadre, deux côte à
côte, deux l'un au-dessus de l'autre, 2 × 2, 3 × 3, l'image dans l'image aux
quatre coins (un tiers du cadre, 0,3, dans la zone d'action à 5 % des bords — les
90 % des zones de sécurité du moniteur). Chaque grille est dessinée aux
proportions de la séquence, ses cases sont des boutons : une case reçoit le plan
choisi ; plusieurs plans choisis (carte « Trajectoire · N plans », ou le menu du
moniteur) s'y répartissent à partir d'elle, la piste du haut d'abord, puis le
temps. L'image tient dans sa case, centrée (la part gardée si elle est
recadrée) ; l'ancrage revient au centre, la rotation à 0 ; l'opacité et le
recadrage restent.

**Essais** (`gestes.js`, Chromium sans affichage, 20 sur 20) : un clic sur la
timeline choisit le plan ; le glisser au moniteur change le modèle et l'image
pendant le geste (`left` 20 %), une annulation au lâcher ; l'aimant le ramène au
centre exact (deux repères) ; le coin à 50 %, maj libère (70 % × 50 %) ; hors du
coin, 30° ; alt + l'ancrage le déplace, l'image reste ; Ctrl+Z défait chaque
geste ; grille 2 × 2 sur les quatre plans ; Réinit. puis Ctrl+Z ; double-clic :
le plan sous le pointeur ; l'opacité tapée. Les deux thèmes, aucune erreur.

### Les images clés (06/10, suite)

Cal : « on avance avec les images clés ». Ses décisions déjà prises restent : l'ancrage se
déplace par Alt + glisser ; dans une grille, l'image tient dans sa case sans être coupée.

**Ce que fait Premiere** (aide d'Adobe, « Add, navigate, and set keyframes » et « Keyframe
interpolation », par les résultats de recherche ; helpx.adobe.com ne s'ouvre pas d'ici) :
dans Options d'effet, un chronomètre par propriété ; l'activer pose une image clé à
l'indicateur de temps ; changer la valeur ailleurs en pose une là ; « Aller à l'image clé
précédente / suivante », « Ajouter/supprimer une image clé » ; une petite timeline des clés
à droite du panneau ; l'interpolation temporelle (linéaire, Bézier, maintien, lissage
d'entrée et de sortie). Désactiver le chronomètre retire les clés de la propriété.

**Le modèle** (`montage/model.js`, et `server/tools/montage.py` ligne pour ligne) :
`motion.keys = {groupe: [[k, [valeurs]], [k, [valeurs], 1], …]}`. Un groupe = une
propriété de Premiere : `pos` (x, y), `ech` (hauteur, largeur), `rot`, `anc` (ancrage x,
y), `op`, `rec` (les quatre côtés du recadrage, un seul chronomètre). k : l'image, comptée
depuis le début du plan ; le 3ᵉ élément 1 : le segment qui part de cette clé est lissé
(smoothstep, u²(3 − 2u) : l'« accélérer, ralentir » le plus simple) ; sinon linéaire.
Avant la première clé, sa valeur ; après la dernière, la sienne. `motionAt(c, image)` /
`motion_at` : la trajectoire à une image ; un groupe qui a des clés ignore sa valeur fixe.

- **Les clés suivent la matière.** Un plan déplacé emporte les siennes (temps relatifs au
  plan). Rogner le début, couper (le morceau de droite), la propagation (B), la coupe (N), le
  slide (U, pour le voisin dont l'entrée change) les décalent d'autant que la tête bouge
  (`shiftKeys`) : elles gardent leur place dans la timeline, comme les images. La vitesse (R,
  Ctrl+R) les étire avec la matière (`scaleKeys`) ; changer de cadence les arrondit à la
  nouvelle grille comme les bords. Le slip (Y) les laisse sur le plan (on fait glisser le
  contenu, pas l'animation ; ce que fait Premiere là : non vérifié). Une clé qui tombe hors du
  plan rogné reste et compte pour l'interpolation, comme dans Premiere.
- **Le panneau** (la carte Trajectoire) : pour chaque propriété, le chronomètre (allumé : une
  clé à la tête de lecture ; éteint : plus de clé, la valeur qui se voit reste — sans demander,
  Ctrl+Z la rend), son nom, la petite piste de ses clés sur la durée du plan (losanges ; un
  rond pour une clé lissée ; le trait de la tête ; clic : y aller ; clic droit : lissée ou
  linéaire, supprimer), ‹ ◆ › (précédente, poser ou retirer à la tête, suivante ; éteints, ils
  disent pourquoi). Les valeurs affichées sont celles de l'image sous la tête (ramenée dans le
  plan si la tête est ailleurs) et suivent la lecture. Changer une valeur (curseur, champ, un
  geste au moniteur, une grille) pose une clé à la tête si le chronomètre de sa propriété est
  allumé, change la valeur fixe sinon (`setMotionAt`). Sur le plan, dans la timeline : un
  losange par image clé. Tout se défait par Ctrl+Z.
- **Le moniteur** pose chaque image à sa trajectoire du moment (`program.geometry(c, p, image)`),
  à l'arrêt, pendant la lecture et pendant les gestes.

**L'export** (`_placement_anim`) — ce qui a été pesé :

- `scale` à `eval=frame`, `rotate` en expression, `overlay` à `eval=frame` : un `scale` ou un
  `crop` animés changent la taille des images d'une image à l'autre, ce que les filtres qui
  suivent ne suivent pas (leurs liens ont une taille fixe) ; écarté sans le monter.
- Le rendu par segments (un plan d'une image par image, à sa trajectoire fixe) : juste, mais un
  graphe qui grandit avec la durée animée. Il sert de **vérité** pour la mesure.
- **Retenu** : une toile de taille fixe, sur laquelle tout s'anime image par image.
  1. La source passe en RVB à la plus grande échelle de l'animation sur la passe (bornée à
     deux fois le cadre), puis les effets.
  2. L'opacité (`colorchannelmixer aa`) et le recadrage (quatre bandes rendues transparentes,
     `drawbox` replace=1) sont réglés image par image par `sendcmd` (doc ffmpeg-filters :
     ces options portent le drapeau T, « runtime commands » ; un fichier de commandes par plan
     et par passe, écrit à côté).
  3. En yuva444p BT.709, pour que `drawbox` et `perspective` travaillent sans conversion
     cachée (mesuré : en gbrap, ffmpeg insérait trois `auto_scale`), la toile reçoit un bord
     transparent de 2 px.
  4. `perspective` (sense=destination, eval=frame) envoie ses quatre coins là où `cadre()` les
     pose. Ses huit expressions calculent position, échelle, rotation et ancrage de l'image
     `in` comme `motion_at`, par morceaux, linéaires ou lissés (`_kexpr`). Hors de la toile,
     le bord transparent ; elle est ensuite ramenée au cadre.
  5. Une trajectoire qui ne change pas sur la passe garde le chemin fixe d'avant (`_placement`).
- **Mesures** (1280 × 720, 60 images ; le rendu animé contre la vérité image par image,
  écart moyen sur 0..255) :

  | animation | écart moyen | pire image | pixels à ± 12 |
  |---|---|---|---|
  | tout (position, échelle lissée 0,3 → 0,6, rotation 0 → 90°, opacité 1 → 0,4, recadrage) | 0,37 | 0,61 | 98,8 % |
  | échelle 0,15 → 1 sur une mire fine | 0,44 | 1,34 | 98,8 % |
  | position seule, lissée | 0,22 | 0,36 | 99,4 % |
  | ancrage 0 → 1 et rotation de 720° | 0,84 | 1,85 | 98,4 % |

  Ce qui reste, ce sont les bords et les détails fins : le rééchantillonnage bilinéaire de
  `perspective` contre celui de `scale` et `rotate`. Le rendu animé prend 1,6 s, la vérité
  image par image 10 s.
- Un piège mesuré : la variable `in` de `perspective` compte les images à partir de 1. Sans le
  −1, l'animation avait une image d'avance (l'écart tombait de 4,8 à 0,4 avec l'image suivante).

**Les contrôles.**
- `check.py montage` :
  - la page contre le serveur, sur 50 images de cinq trajectoires (linéaire, lissée, hors des
    clés, non uniforme, clés illisibles) : écart 0 ;
  - rogner (+15, −10), couper, déplacer : chaque image restante garde sa trajectoire ;
  - la vitesse ×2 resserre les clés ; poser une clé, le chronomètre, basculer une clé ;
  - un carré rouge animé (un segment lissé puis linéaire, opacité 1 → 0,4) exporté par le
    vrai travail sur deux passes : à sa place à 0,2 px près à dix images, son rouge à 2 près.
- Le pilote `montage/pilote_images_cles.mjs` (Playwright, 20 essais, sombre et clair) :
  - chronomètre, valeur tapée ailleurs, le moniteur à l'image 35 (centre à 0,625 près) ;
  - ‹ › ; lissée par le clic droit ; la lecture ; un geste au moniteur qui pose une clé ;
  - rogner et déplacer ; éteindre le chronomètre ; l'opacité animée en clair ;
  - Ctrl+Z à chaque pas.

### La suite (non fait)

- Les images clés : faire glisser un losange dans le temps ; les autres interpolations de
  Premiere (Bézier réglable, maintien) ; une trajectoire courbe (le chemin de la position)
  dessinée au moniteur ; des clés sur les effets (étalonnage, LUT) et le volume.
- « Coller les attributs » (Ctrl+Alt+V) colle les effets, pas encore la
  trajectoire.
- Les poignées de côté (une seule dimension), les flèches qui poussent la
  position, le filtre anti-scintillement, les modes de fusion de l'Opacité, le
  contour adouci du Recadrage, son « Zoom ».
- Une image dont l'EXIF dit une orientation : le navigateur la tourne, ffmpeg
  non (non vérifié sur nos images) — un JPEG de téléphone pourrait se poser
  autrement à l'export.
- Les titres : le banc n'en a pas encore ; ils prendront la même trajectoire.

## Les limites connues

- L'aperçu de l'étalonnage est approché ; l'export fait foi (la LUT, elle,
  est le même calcul).
- Le son d'une vidéo est attaché à son plan tant qu'on ne le dissocie pas
  (« Dissocier le son » le pose sur la piste son cible ; on ne relie pas).
- Un calque d'effet compose l'aperçu dans un canevas : plus lourd à la
  lecture (chaque image est dessinée deux fois). Les effets de piste et de
  groupe agissent plan par plan (voir plus haut).
- L'image fond en ligne droite seulement (ffmpeg 6.1, `fade`).
- Vitesse : pas de vitesse négative, pas de remappage temporel. (Une source
  d'une autre cadence que le projet — 24 ou 16 i/s dans un projet à 25 — montre
  depuis le 06/10 à l'export l'image même du moniteur : « Les poignées ».)
- Pas de titres, de scopes, de roues chromatiques ; les images clés ne portent que sur la trajectoire.
- Une passe finale lit tous les sons à la fois : un montage de centaines de
  plans sonores ouvre autant d'entrées (léger, mais non borné).
- La matrice d'une source sans étiquette suit la règle du Chromium de DGX2
  (voir plus haut).
