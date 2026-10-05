# L'onde précise et le spectre (06/10/2026)

Cal, 06/10 : « L'onde audio est super mal définie (sur une capture zoomée de Transcrire : des
blocs en escalier) — on n'avait pas changé ça ? Quand on est dans Transcrire, on peut afficher
un spectre de bonne qualité […] ; et idem dans le banc de Montage, car on va avoir besoin de
couper ou d'ajuster de façon ultra précise dans le segment. »

Le code : `server/tools/apercu_son.py` (« l'onde précise »), `commun/onde.js`,
`commun/spectre.js` + `commun/spectre.worker.js`, `commun/lecteur.js`, `montage/timeline.js`.

## 1. Pourquoi l'onde était en escalier

Trois dessins, trois causes (lues dans le code, vues sur les captures « avant », § 5) :

- **Le lecteur commun** (Transcrire, Asset, Movie Analysis, Idéation) étirait le masque PNG de
  l'aperçu (`wave.v1.png`, 1200 × 160, fait pour les vignettes) sur toute la frise, qui fait
  durée × zoom. Pour un son de 2 min 25 à 800 px/s (le zoom le plus fort), 116 000 px pour
  1200 colonnes : 97 px d'écran par colonne, que le navigateur étire et adoucit — les blocs en
  escalier de la capture. Juste seulement tant que la frise ne dépasse pas 1200 pixels d'écran.
- **Le Montage** (01/10, b52df13, « l'onde dessinée à la résolution de l'écran ») dessinait bien
  colonne par colonne, mais d'après les pics de `/api/son/pics` : un pic tous les 1/200 s, donc
  juste tant qu'un pixel d'écran couvre au moins un pic — **jusqu'à 200 px/s** (100 px/s sur un
  écran HiDPI ×2), soit 500 % dans le Montage, qui zoomait jusqu'à 800 px/s (2000 %). Au-delà,
  `dessiner` interpolait entre deux pics : une enveloppe lisse, pas le son. Et ces pics sont
  pauvres : un octet (256 niveaux après normalisation), le seul |pic| (l'onde est dessinée
  symétrique), d'un son décodé à 8 kHz — le filtre du rééchantillonnage ôte tout au-dessus de
  4 kHz, les crêtes des « s » et des « ch » ; au-delà de 16 min 40, la fréquence de décodage
  descend encore (8 000 000 d'échantillons au plus : 2 h sont décodées à 1111 Hz, rien
  au-dessus de 555 Hz).
- **L'écran Source du Montage** : les mêmes pics, sur toute la durée.

## 2. Ce qui est fait

### Le serveur : la pyramide et la copie sans perte

Le principe des outils qui montrent une onde juste à tout zoom :
- BBC audiowaveform (le format de données de peaks.js) : « pairs of minimum and maximum values
  that each represent a range of samples », calculées sur des groupes de N échantillons
  ([DataFormat.md](https://github.com/bbc/audiowaveform/blob/master/doc/DataFormat.md)) ;
- Audacity : des résumés min, max, RMS de 256 échantillons, puis de 65 536 (256 résumés de 256),
  pour dessiner chaque colonne de pixels d'une barre du min au max (`BlockFile.h`, le forum
  d'Audacity, « Efficient rendering of waveforms »).

`apercu_son.py` décode le son **une fois**, à sa fréquence (ffprobe ; aucun rééchantillonnage),
en mono 16 bits, aux temps de l'originale comme le son de défilement
(`aresample=<sr>:async=1:first_pts=0`, `defilement.py`) ; `asplit` en fait deux sorties
identiques :
- `onde.v2.bin` : une **pyramide** de paires (min, max) exactes, en 16 bits signés — le palier 0
  résume 64 échantillons, chaque palier 4 fois plus (64, 256, 1024… jusqu'au son entier) ; un
  en-tête (fréquence, nombre d'échantillons, le plus fort, les paliers) ;
- `onde.v2.flac` : la **copie d'analyse**, mono, sans perte, d'où `GET /api/son/echantillons`
  lit les échantillons. Pourquoi une copie : ffmpeg ne saute pas à l'échantillon près dans un
  fichier à trames. Essayé le 06/10 (`-ss` avant l'entrée, puis `atrim`, comparé au décodage
  entier) : WAV et FLAC exacts ; MP3 décalé de −17 à +200 échantillons, AAC (M4A, MP4) et Opus
  faux au début ou au milieu. Dans le FLAC, exact partout (contrôlé par `check.py`).

Une file (un calcul à la fois, `nice`), lancée dès la mise en bibliothèque (`soon`), sinon à la
première demande ; la page redemande l'en-tête tant qu'il n'est pas prêt et dessine en attendant
les pics de 01/10.

### La page : `commun/onde.js`

Pour chaque colonne de pixels d'écran (devicePixelRatio compris, plafonné à 3) de la seule
partie visible :
- au moins 64 échantillons par pixel : le palier le plus fin qui tient sous la colonne (entre 1 et
  4 paires) ; une barre du min au max, la colonne prenant aussi la première valeur de la suivante
  (le trait ne se coupe jamais) ;
- moins de 64 : les échantillons eux-mêmes, en barres min-max ;
- moins de 1,5 échantillon par pixel : les échantillons reliés par un trait ;
- un échantillon tous les 6 pixels ou plus : un point sur chacun — le « Connect dots »
  d'Audacity (manuel, Tracks Preferences, « Display samples » : « only affects the appearance […]
  when you are zoomed in far enough to see the individual sample dots » ; son défaut, « Stem
  plot », tire en plus un trait du centre à chaque point).

Les données viennent par tuiles (8192 paires d'un palier, 32 Ko ; 262 144 échantillons, 512 Ko),
gardées dans un cache commun à toutes les ondes de la page (LRU, 96 Mo). Une tuile en route est
remplacée par un palier plus grossier déjà là (plus large que le son, jamais plus étroit), puis
par la vraie. La couleur est `color` du canvas en CSS (un jeton). Aucun lissage : ce qui est
dessiné vient des données, exactes à la colonne près (± un bloc du palier, toujours sous un
pixel d'écran).

Pourquoi pas `decodeAudioData` dans la page (la piste de la demande) : `BaseAudioContext` est
`[Exposed=Window]` — pas de `decodeAudioData` dans un Worker (spécification Web Audio ; le
décodage se fait déjà « on another thread », le « decoding thread ») ; il rend un `AudioBuffer`
en flottants de 32 bits par canal, à la fréquence du contexte (2 h en stéréo à 48 kHz : 5,5 Go) ;
et le son d'une vidéo du Montage ferait télécharger la vidéo entière. Le serveur décode déjà ; la
page ne reçoit que ce qu'elle montre.

### Le spectre : `commun/spectre.js`, `commun/spectre.worker.js`

- La STFT des **échantillons** (ceux de l'onde), fenêtre de Hann « periodic » (Harris, 1978,
  « On the use of windows for harmonic analysis with the discrete Fourier transform », Proc.
  IEEE 66-1), 75 % de recouvrement ; une colonne plus large qu'un pas fait la **moyenne** des
  puissances de toutes ses fenêtres (Welch, 1967) : aucun échantillon sauté ; une colonne plus
  étroite prend la fenêtre centrée sur elle.
- La taille de la fenêtre suit le zoom (iZotope RX, « Auto-adjustable STFT automatically adjusts
  FFT size […] according to the zoom level ») : 16 colonnes, entre 512 et 4096 échantillons à
  48 kHz (10,7 à 85 ms) ; les lignes plus fines qu'une case de cette fenêtre (les basses) gardent
  la fenêtre de 85 ms (RX, « Multi-resolution […] better frequency resolution at low frequencies
  and better time resolution at high frequencies »).
- Les fréquences de 20 Hz à 20 kHz (ou la moitié de la fréquence du son) sur l'échelle **mel**
  (par défaut ; m = 2595 log10(1 + f/700), O'Shaughnessy) ou **logarithmique** — deux des
  échelles de RX (« Linear, Logarithmic, Mel, Bark ») et d'Audition ; chaque ligne fait la moyenne
  des cases de sa bande, ou interpole les deux cases voisines si elle est plus fine.
- Le niveau : en dB sous le plus fort du son (l'amplitude d'un sinus vaut 4|X|/N avec une fenêtre
  de Hann), sur 90 dB (Audition : « Decibel range »).
- Les couleurs : les jetons `--spec-0` (le silence) à `--spec-4` (le plus fort), déclarés dans
  les deux blocs de `commun/tokens.css`, mélangés en 256 teintes ; la luminance change dans le
  même sens à chaque pas, le plus fort tient 16:1 sur le silence, le milieu 3,6 à 3,8:1 (WCAG
  1.4.11 : 3:1). Un changement de thème recolore sans recalculer.
- Le calcul : un Worker, par tuiles de 128 colonnes calculées au zoom exact (rien d'étiré) ;
  tant qu'elles manquent, la dernière image complète du même canvas, remise à l'échelle, tient la
  place, puis les vraies la remplacent.
- « Les deux » : l'onde au-dessus (40 %), le spectre dessous — la disposition d'Audition (« Below
  the panel's default waveform display […] you can view audio in the spectral display »,
  helpx.adobe.com, « Display audio in the Waveform Editor »).

### Branché

- **Le lecteur commun** (Transcrire, Asset, Movie Analysis, Idéation) : deux canvas dans un cadre
  posé sur la partie visible de la bande (le fond, et le joué découpé à la tête) ; le cadre
  remplit la bande à toute hauteur (`--sr-lect-bande-h`, Transcrire replié : 12 px) ; un bouton
  de la barre choisit la vue (onde, spectre, les deux) et l'échelle ; `onde: true` ajoute le son
  d'une vidéo sous ses images (Transcrire le demande, hauteur `--sr-lect-son-h`, 72 px).
- **Le Montage** : les plans son, et le son d'un plan vidéo qui le porte (`c.audio`), dans le bas
  du plan, sur un voile ; l'écran Source (l'entrée `pics()` gardée) ; la vue : un bouton dans
  l'en-tête de la règle.
- **Le zoom** : 192 000 px/s dans le lecteur (4 px par échantillon à 48 kHz), 96 000 dans le
  Montage (2 px par échantillon, une image à 25 i/s sur 3840 px), bornés par la largeur qu'un
  navigateur sait poser — la frise fait durée × zoom : Chromium plafonne une boîte à
  33 554 428 px (mesuré, Chromium 141), Firefox à 17 895 697 px (`nscoord_MAX` = 2^30 − 1 unités,
  60 par pixel CSS, `gfx/src/nsCoord.h`) ; on borne à 16 millions de px. D'où : l'échantillon
  près pour un son de moins de 5 à 6 min dans le lecteur (2 min 25 : 110 000 px/s) ; 8 900 px/s
  pour 30 min, 2 200 px/s pour 2 h (une vingtaine d'échantillons par pixel).

## 3. Les bornes

- Le spectre se calcule pour **2^23 échantillons à l'écran au plus** (2 min 55 à 48 kHz, 16 Mo
  d'échantillons lus) ; au-delà, la vue dit de zoomer. Un spectre d'ensemble d'un son long
  demanderait une STFT de tout le son côté serveur ; en Python seul (sans numpy, règle du
  portail), elle prendrait des dizaines de minutes pour 2 h — à décider (§ 6).
- Le mono : l'onde et le spectre sont ceux du mélange mono (`aformat=channel_layouts=mono`,
  ffmpeg) ; une stéréo en opposition de phase s'y annule.
- La place : la copie d'analyse fait ≈ 1,5 Mo par minute (2 h : 182 Mo), la pyramide 0,24 Mo par
  minute à 48 kHz (2 h : 29 Mo).
- Les requêtes (le Worker de Cloudflare compte chacune, `cloudflare.md`) : une session de mesure
  complète (ouvrir, zoomer jusqu'au bout et revenir, défiler à deux zooms, le spectre) fait 21 à
  46 requêtes de l'onde (5 à 8 Mo) ; le spectre de 2 min 25 entières : 28 requêtes. Gardées un an
  par le navigateur (`v=2`).

## 4. Le contrôle

`python3 tools/check.py apercu_son` : l'en-tête (48 kHz, le nombre exact d'échantillons, le plus
fort, le dernier palier = le son entier), les paliers 0, 1 et 2 égaux aux min et max calculés
sur le son (un son dissymétrique, des crêtes positives seules), une tranche à sa place, les
échantillons exacts au milieu et à la fin, les bornes (400), une image et un objet absent (404),
calculé une fois, la voix d'un élément, le son d'une vidéo (pyramide et échantillons d'accord).

## 5. Mesures (06/10, conteneur de la session cloud : 4 cœurs, Chromium 141 sans affichage ni GPU)

Le serveur, un calcul (le son décodé, la pyramide, la copie) :

| son | durée | CPU Python / ffmpeg | mémoire Python / ffmpeg | pyramide | copie FLAC |
|---|---|---|---|---|---|
| 2 min 25, WAV 48 kHz | 0,7 s | 0,3 / 0,3 s | 25 / 56 Mo | 0,6 Mo | 3,5 Mo |
| 30 min, AAC 128 kbit/s | 11,0 s | 3,6 / 4,8 s | 46 / 59 Mo | 7,2 Mo | 45 Mo |
| 2 h, AAC 128 kbit/s | 46,8 s | 14,2 / 17,2 s | 118 / 65 Mo | 28,8 Mo | 182 Mo |

Lire 262 144 échantillons dans la copie de 2 h : 52 à 87 ms.

La page (Transcrire, fenêtre de 1600 × 900) : la première onde précise (l'en-tête, la tuile de
la vue d'ensemble, dessinée) ; le zoom (un cran de molette Alt par image d'écran, 1,5 s en avant
puis 1,5 s en arrière, de la vue d'ensemble au zoom le plus fort) ; défiler (25 px par image) ;
le tas JS ; le cache de l'onde après la session ; le spectre d'un écran à ≈ 2000 px/s :

| son | écran | 1re onde | zoom (i/s, p95) | défiler 2000 px/s | défiler au plus fort | tas | cache | spectre (écran, Worker/tuile) |
|---|---|---|---|---|---|---|---|---|
| 2 min | ×1 | 0,59 s | 59, 17 ms | 60, 17 ms | 59, 17 ms | 3 Mo | 3,9 Mo | 0,37 s, 42 ms |
| 30 min | ×1 | 0,58 s | 60, 17 ms | 60, 17 ms | 59, 17 ms | 3 Mo | 6,0 Mo | 0,46 s, 53 ms |
| 2 h | ×1 | 0,71 s | 59, 17 ms | 60, 17 ms | 60, 17 ms | 3 Mo | 5,6 Mo | 0,46 s, 54 ms |
| 2 min | ×2 | 0,59 s | 60, 17 ms | 60, 17 ms | 60, 17 ms | 3 Mo | 4,0 Mo | 0,76 s, 52 ms |
| 30 min | ×2 | 0,72 s | 57, 17 ms | 60, 17 ms | 60, 17 ms | 3 Mo | 7,2 Mo | 0,66 s, 44 ms |
| 2 h | ×2 | 0,60 s | 60, 17 ms | 60, 17 ms | 60, 17 ms | 3 Mo | 6,3 Mo | 0,81 s, 56 ms |

(Le dessin garde ses tuiles le temps d'un dessin : avant cela, à ×2, le zoom tombait à 45-56 images
par seconde, p95 33 ms.)

Le spectre des 2 min 25 entières (la vue d'ensemble) : 3,3 s (écran ×1, 7 tuiles, 1,9 s de
Worker) et 3,6 s (×2, 13 tuiles). Le Montage (la séquence de 2 min 25, onde, spectre, les deux) :
zoomer de 1 % au plus fort et retour, défiler à 2000 et 40 000 px/s : 57 à 60 images par seconde,
p95 17 ms, à ×1 comme à ×2. Aucune erreur dans la console.

Captures (avant / après, mêmes zooms, deux thèmes) : dans le compte rendu de la session.

## 6. Questions pour Cal

1. **Couper à l'échantillon près dans le Montage** : on voit maintenant chaque échantillon, mais
   une coupe tombe sur une image (le modèle compte en images). Premiere le fait par « Show Audio
   Time Units » (le temps des plans son en échantillons). Le veut-on pour les plans son ?
2. **Le spectre d'un son long en vue d'ensemble** (au-delà de 3 min à l'écran) : le calculer sur
   le serveur, une fois, par paliers comme l'onde, demande une FFT rapide (numpy, ou ffmpeg
   `showspectrum`, dont la sortie est une image colorée, pas des valeurs) — à décider.
3. **La stéréo** : une onde par canal (comme Premiere pour un plan stéréo), ou le mélange mono
   (aujourd'hui) ?
