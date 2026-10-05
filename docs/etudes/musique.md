# Étude — ODIO, le studio musique (29/09/2026)

Demande de Cal (28/09) : « les outils de music qu'on a dans le zip, qu'on va
tous rassembler ensemble (rack, nodal et timeline) en un seul outil ». Puis
(29/09), capture de sa maquette « STUDIO · NL—60 · SESSION » à l'appui : « il
faut repenser toute l'interface en proposant plus d'outils car on a besoin
d'un vrai studio avec une DAW, qui a notre partie nodal […] on devra rajouter
aussi la partie music générative avec YuE ». Précisions du même jour : le
studio s'appelle **ODIO** ; des pistes audio par import et glisser-déposer ;
YuE → séparation de stems → les pistes calées dans ODIO ; les instruments et
effets du prototype ODIO_01 repris.

Consigne tenue : **l'UX et l'UI d'abord, aucune génération par modèle** — la
partie générative a son interface complète et tourne sur les moteurs d'essai
des contrats (YuE2, séparation, ACE-Step).

## 1. Ce qui est fait

`musique/` (page, modules ES, aucune étape de construction), `musique/odio/`
(les pièces reprises du prototype, `musique/PROVENANCE.md`) et
`server/tools/music.py`. Un projet, quatre vues de la même chose :

| vue | ce qu'on y fait |
|---|---|
| **Arrangement** | la règle des **sections** (double-clic : une section ; double-clic dessus : la nommer ; glisser : la déplacer **avec ses clips et ses courbes** — Maj : l'étiquette seule ; bords : la longueur ; clic droit : dupliquer avec ses clips (la copie s'insère, la suite recule), échanger avec la voisine, colorer, étiqueter pour les paroles, boucler dessus, retirer avec ou sans ses clips) ; les mesures, la boucle (bande du haut), les **marqueurs** (M, clic droit sur la règle ; glisser, renommer) ; l'**arc d'énergie** (une piste qu'on peint : il ouvre et ferme le filtre de la sortie, son volume, ou les deux ; Maj : une droite, clic droit : effacer ; « suivre les sections ») ; les pistes (muet, solo, **armer**, **automation**, volume, panoramique, couleur, instrument, monter/descendre) ; sous chaque piste ses **voies d'automation**, peintes de même ; les clips de motifs (leurs notes ou leurs coups dessinés, nommés « SECTION · MOTIF » comme la maquette) et les clips audio (forme d'onde, fondus, boucle) ; aimant (libre, 1/16 … mesure ; Alt : libre), **sélection multiple** (Maj+clic, cadre tiré sur le vide), **copier / couper / coller** à la tête de lecture, dupliquer, **couper** à la tête de lecture, **rogner par les deux bords**, boucler, rendre muet, changer de piste (même sorte ; un motif suit), Ctrl+glisser : copier ; zoom horizontal (Ctrl+molette, « px/mes » comme la maquette) et vertical (S M L) ; en bas l'**éditeur** du clip choisi ; à gauche le **navigateur** |
| **Console** | une tranche par piste : inserts (clic : le rack), **envois vers les bus d'effets** (après le fader), panoramique, M/S/●, **fader**, **vu-mètre** avec maintien de crête ; les **bus** (retours : Réverbération, Réverbe ODIO, Délai, RTT-01, Chorus, vide) ; la **sortie** (vu-mètres gauche et droite, l'arc, sa coupure basse et son volume bas) |
| **Instruments** (depuis le 29/09 : en bas de l'arrangement, § 6) | la chaîne d'une piste (source → effets → tranche) avec ses molettes ; changer d'instrument, préréglages, enregistrer le sien ; DR-9 (8 pads) ou boîte à rythme ODIO (11 pads, 4 réglages par voix, 808 / 909) |
| **Nodal** | tous les modules et leurs câbles ; **les envois de la console sont des câbles en pointillé avec leur niveau** : le même graphe ; en bas, le banc d'ODIO_01 (§ 6) |

**Éditeurs** (le tiroir de l'arrangement, le bas du rack) :
- *piano roll* : notes, longueurs, **vélocités** (voie du bas), grille 1/32 à
  1/4, **quantifier** (Q), la **gamme de la session éclairée** (rangées de la
  gamme, tonique marquée) et **aimant à la gamme**, transposer (↑ ↓, Maj :
  octave, pas de gamme si l'aimant est actif), sélection (Maj+glisser),
  dupliquer (Ctrl+D), modèles tirés de la gamme ; **accent** et **liaison**
  pour la basse acide (les deux gestes de la 303 d'ODIO) ;
- *pas* : une rangée par voix de la source, vélocité par pas (Alt : léger,
  clic droit : fort / moyen / léger), longueur 1 à 16 mesures, modèles de rythmes ;
- *audio* : gain, fondus d'entrée et de sortie, boucle et sa longueur, glisser
  le son dans le clip (le départ), couper à la tête de lecture, **normaliser**
  (crête du clip à −1 dBFS), séparer en pistes.

**Navigateur** : Instruments (sources et effets, à glisser sur une piste ou
sous les pistes), Préréglages, **Sons** de la bibliothèque (écouter ▶,
glisser ; un fichier du disque déposé là entre dans la bibliothèque), Motifs
(ceux du projet, et des modèles).

**Pistes audio** (précision de Cal) : « Importer » ou **glisser des fichiers
du disque** (WAV, MP3, FLAC, M4A, OGG) sur une piste ou sous les pistes ; ils
entrent dans la bibliothèque, **catégorie Upload** (`uploadFile(f, {tool:
'upload', via: 'odio'})`, règle de Cal du 29/09), et se posent à la grille ;
un son glissé depuis une autre page du portail (`ITEM_MIME` de
`commun/shell.js`) se pose de même. Les créations d'ODIO (mixage, stems,
prise micro) gardent `tool: 'music'`.

**Enregistrer** : ● armé + Rec (R) + Lecture : le clavier de l'ordinateur et
le MIDI (menu ··· du projet) deviennent un motif « Prise n » posé en clip
« Nouveau » ; boucle active : la prise dure la boucle et les passages
s'additionnent ; les clips recouverts deviennent muets (rien n'est effacé).
Une piste audio armée prend le **micro** (getUserMedia + MediaRecorder).
Métronome (C), retour au début (Entrée), pause (▶ pendant la lecture) et stop.

**Génératif** (panneau à droite, la session reste jouable) : YuE2 ou
ACE-Step ; style en pastilles (celles que publie YuE2 dans ses options) et
champ libre ; « tempo et tonalité de la session » ajoutés au style ; **plan et
paroles par sections** (« Reprendre les sections » : un bloc par section de
l'arrangement, son étiquette [Verse] [Chorus]…, ses mesures et ses
secondes) ; durée (celle du plan par défaut, bornée par le moteur), graine,
partition et précision de YuE2, **référence audio** (reprise) si le moteur la
prend (`ref_ready`), langue pour ACE-Step ; **« puis séparer en pistes »**
avec le modèle choisi (par défaut celui que recommande `music_stems.py`) :
Lancer → le morceau se pose sur une piste audio au début du plan → la
séparation part d'elle-même → chaque stem se pose **sur sa piste, sous
l'original, au même départ et à la même longueur**, l'original rendu muet.

**GUIDE** (le bouton orange de la maquette) : un panneau à côté de la session :
le parcours en dix étapes (chacune « Montre-moi » éclaire l'endroit), les
raccourcis, l'état des moteurs. Tant qu'un panneau est ouvert, le GUIDE
s'éteint : un seul orange à l'écran.

**Exporter** : le mixage (WAV 24 bits 48 kHz) et, case cochée, **chaque piste
à part** (stems : la piste seule, ses envois aux bus compris) → la
bibliothèque (Musique) ; « Envoyer au montage » ouvre le montage avec le mixage.

**Le projet** s'enregistre seul (600 ms après la dernière retouche, `rev` :
un second onglet reçoit 409 et recharge) ; **annuler / rétablir** (Ctrl+Z,
Ctrl+Y, ↶ ↷) : un instantané du projet après chaque geste terminé, rendu tout
entier — juste par construction, quel que soit le geste (`projet.js`,
150 pas). La **version 2** du format ajoute tonalité, sections, marqueurs,
arc, automation, pistes « bus », envois, gain/fondus/boucle des clips, le
brouillon du génératif ; un projet de version 1 est migré à l'ouverture
(`migrate`) et le serveur accepte les deux. Départs : **Session** (la maquette
NL—60 : 16 mesures, intro / couplet / refrain / final, 112 BPM, fa mineur,
batterie ODIO, basse acide ODIO, nappe de trois scies, lead carré et scie, deux
bus et quatre envois), **Batterie et basse** (l'ancien départ), **Vide**.

**Les instruments et effets d'ODIO** (le prototype de Cal, commit `6d8a7ed`,
`musique/PROVENANCE.md`) : boîte à rythme 808/909 (onze voix synthétisées),
Analog, basse acide (303 : filtre 18 dB, accent, liaison), **Numérique**
(les oscillateurs de Plaits, d'Émilie Gillet, compilés en WebAssembly, dans
un AudioWorklet) ; Réverbe, Chorus, RTT-01, Comp, EQ-3, Filtre drive, Satura,
Crush, Table de mix, Volume. Leurs réglages sont lus sur leurs propres
descripteurs ; un adaptateur (`moteur.js`) les présente comme les modules
d'ici. Non repris : les instruments qui téléchargent leurs échantillons
(`smplr`).

## 2. Les choix Web Audio et leurs sources

| choix | source |
|---|---|
| planification sur `AudioContext.currentTime`, réveil toutes les 25 ms, minuteur dans un Worker ; l'avance suit le tampon (120, 300 ou 500 ms ; 120 jusqu'au 06/10) ; rien ne se pose à moins de 10 ms de l'horloge : une tranche en retard est perdue, ses sons repartent à leur place | MDN, *Advanced techniques: Creating and sequencing audio* ; *A Tale of Two Clocks* (Chris Wilson : « plus d'avance si la page a des mises en page lourdes ») ; spécification Web Audio (`start` dans le passé, temps d'automation « clamped to currentTime ») ; « Les craquements », plus bas |
| **le tampon de la carte son** : `latencyHint` « playback » par défaut (« interactive » jusqu'au 06/10), réglable (préférence `music.tampon`) | spécification Web Audio (`AudioContextLatencyCategory`) ; Chromium, `media/base/audio_latency.cc` ; *Profiling Web Audio apps in Chrome* (web.dev) |
| **automation et arc** : `setValueAtTime` au début de chaque tranche planifiée puis `linearRampToValueAtTime` jusqu'à chaque point et à la fin de la tranche | MDN, AudioParam |
| l'automation tient le réglage pendant la lecture (une molette ne le reprend pas) ; à l'arrêt, `cancelScheduledValues` et la valeur de la courbe à la tête de lecture | MDN, AudioParam ; choix de conception |
| filtre de l'arc : passe-bas Q = 1/√2 (Butterworth), de la coupure basse (350 Hz par défaut) à 20 kHz en échelle logarithmique ; volume : de −12 dB à 0 | Q de Butterworth : définition ; bornes : choix de réglage |
| modules d'ODIO automatisés par `setParameter(id, valeur, instant)`, relevé à chaque croche | leur contrat (odio/effects/types.js) |
| envois : un GainNode entre la tranche (après fader et muet) et l'entrée du bus ; un bus n'est jamais rendu muet par le solo d'une autre piste | convention de console (la table de mix d'ODIO pique son départ après le fader : odio/effects/table.js) |
| retour de délai sans son sec (`Son sec : Couper`) | un retour ne rend que l'effet |
| vu-mètres gauche / droite de la sortie | MDN, ChannelSplitterNode |
| clip audio en boucle | MDN, AudioBufferSourceNode.loop, loopStart, loopEnd |
| fondus de clip : enveloppe linéaire par morceaux (entrée, sortie) + 5 ms aux bords de ce qu'on joue | choix de réglage |
| métronome : sinus 1500 / 1000 Hz, 30 ms, droit aux haut-parleurs (ni dans la sortie ni dans l'export) | choix de réglage |
| micro : `getUserMedia` (sans annulation d'écho, suppression de bruit ni gain automatique) + `MediaRecorder`, décodé puis écrit en WAV ; décalé de `outputLatency + baseLatency` (+ `MediaTrackSettings.latency` si le navigateur la donne) | MDN ; une estimation, pas une mesure |
| clavier par `KeyboardEvent.code` (touche physique : même rangée en QWERTY et AZERTY) | MDN |
| gammes : les sept modes diatoniques, mineure harmonique, pentatoniques, blues | théorie musicale courante (intervalles) |
| ACE-Step ne connaît que majeur et mineur : un mode se ramène à la tierce de sa tonique | liste du nœud `TextEncodeAceStepAudio1.5` |
| étiquettes de paroles : celles que YuE2 publie dans ses options (`[Verse]`, `[Chorus]`, `[Bridge]`, `[Outro]`) et celles relevées dans les nœuds YuE2 de DGX2 (`[Intro]`, `[Pre-Chorus]`, `[Instrumental]`) ; blocs séparés d'une ligne vide ; paroles vides = instrumental | `GET /api/music/yue/options` ; `~/yue2-candidates/*` (README de ScryptHunter, FL-YuE2) |
| le tempo et la tonalité se disent dans le style de YuE2 (« 112 BPM, F minor ») | options de YuE2 (`tags.order`, « YuE2 n'a pas d'entrée tempo ») ; `~/yue2_test.py` de Cal |
| la forme d'onde de la session : le mixage rendu hors temps réel à 44,1 kHz (les filtres d'ODIO montent à 20 kHz) | OfflineAudioContext, MDN |
| les autres choix (DR-9, réverbération, distorsion, WAV 24 bits…) | inchangés depuis le 28/09 : recettes et sources dans `moteur.js` |

**Niveaux mesurés** (29/09, rendu hors temps réel, deux mesures de do-mi-sol
ou d'un rythme à 120 BPM, crête dBFS, avant le « trim » de l'adaptateur réglé
ensuite) : DR-9 −11,2 ; boîte à rythme −10,4 (trim −8) ; synthé −14,3 ;
Analog −19,5 (trim −12 → réglé à −6) ; basse acide −15,4 (trim −12) ; Numérique
−22,8 (trim −12 → réglé à −2, soit ≈ −13). Effets sur l'Analog (crête, sec :
−19,5) : Comp −6,4 et le compresseur −6,9 (le rattrapage de gain automatique
de DynamicsCompressorNode), Satura −0,5 (son réglage d'origine : drive 38 %),
Filtre drive −8,1 (résonance 3,5 à 1,2 kHz), les correcteurs, la table et le
volume au neutre −19,5. La session de départ exportée crête à **−5,8 dBFS**
(−5,5 avec l'arc peint).

## 3. Ce qui a été vu (DGX2, Chromium sans affichage, portail d'essai :8784)

`python3 tools/check.py` sur un clone du dépôt au commit `e697a18` avec ces
fichiers : **566 passés, 0 en échec** (le selftest musique : projets, version,
refus — boucle, sortie câblée, tempo, module inconnu, motif d'une autre piste,
section à l'envers, mode inconnu, arc hors de 0..1, automation sans module,
envoi au-dessus de +6 dB, motif de 18 pas —, v2 acceptée, départs Session et
Vide, graphe ACE-Step, génération d'essai jusqu'à la bibliothèque ;
`music.yue` et `music.stems` ne sont pas tenus ici).

Pilotage de la page (playwright, `drive.mjs`), aucune erreur de console :
- la session de la maquette : 4 sections, 13 clips, les pistes et les bus ;
- une section ajoutée par double-clic ; le refrain **dupliqué avec ses
  clips** (5 sections, 17 clips, le final repoussé à 64-80) ; deux Ctrl+Z :
  retour exact (4 sections, 13 clips) ;
- **l'arc peint** à la souris (65 points) ; Ctrl+Z → 0, Ctrl+Y → 65 ;
- **une prise au clavier** : Lead armé, Rec, lecture depuis la mesure 7, huit
  touches → clip « Nouveau » sur le Lead à la mesure 7 (motif « Prise 1 »,
  8 notes, do5 la4 sol4 fa4…), comme le « NOUVEAU » de la maquette ;
- lecture : 36,59 temps atteints pour 36,68 attendus en 2,5 s, sortie −12 dBFS ;
- une voie d'automation (volume de la basse) peinte : 129 points ;
- la console : le fader de la nappe tiré de −4 à −8 dB, les quatre envois ;
- **import** : un WAV par le bouton → piste « sr_daw_test » à la mesure 5
  (5,6 temps = 3 s à 112 BPM) ; un fichier **déposé** sous les pistes → piste
  neuve à la grille (temps 36) ; les deux dans la bibliothèque `tool: upload`,
  `via: odio` ;
- **génératif** : pastilles de YuE2, « Reprendre les sections », paroles dans
  deux blocs → `[Intro] [Verse]… [Chorus]… [Outro]`, style
  « warm female vocal, 112 BPM, F minor » ; Lancer (moteur d'essai de
  `music_yue.py`) → posé au début → **séparé d'office** (moteur d'essai de
  `music_stems.py`, modèle recommandé « voix BS-RoFormer + Demucs affiné ») →
  **Voix, Batterie, Basse, Autre, chacune sur sa piste, au temps 0, 63,47
  temps**, l'original muet ;
- **export** du mixage et de 10 stems en 22 s ;
- le **micro** (périphérique factice de Chromium) : un clip de 2,5 s posé au
  temps 8,05, décalé de 46 ms de latence ;
- le GUIDE : parcours, « Montre-moi », moteurs.

**L'arc change le son** : la session exportée sans puis avec l'arc peint
(spectrogrammes l'un sur l'autre, `spec_arc_compare.png`) : avec l'arc,
l'intro perd tout au-dessus de 3 à 5 kHz, s'ouvre au couplet, se referme au
creux de la mesure 8 et s'ouvre au refrain ; l'énergie des aigus (filtre
différence du premier ordre) passe de −8,2 à −12,4 dB sur le morceau.

Captures (scratchpad de la session, `daw/`) : session, section dupliquée, arc,
prise, lecture, automation, console, rack (boîte à rythme, basse acide),
nodal, import, génératif, stems alignés, export, guide.

## 4. Les moteurs de génération

| travail | tenu par | moteur par défaut | brancher |
|---|---|---|---|
| `music.generate` (ACE-Step 1.5) | `server/tools/music.py` | essai : un son synthétisé dans la tonalité et au tempo | `"music_engine": "ace-step"` |
| `music.yue` (YuE2) | `server/tools/music_yue.py` | essai : une mélodie d'essai | `"music_yue": true` |
| `music.stems` (séparation) | `server/tools/music_stems.py` | essai : des filtres ffmpeg | `"music_stems": true` |

`GET /api/music/engines` dit, dans `contracts`, si `music.yue` et
`music.stems` sont déclarés ; la page ne lit leurs options que dans ce cas.
Les mesures d'ACE-Step (un essai le 28/09, avant la consigne) et le
branchement : inchangés, voir l'historique de ce fichier et `music.py`.
YuE2 et la séparation : `docs/etudes/yue.md`, `docs/etudes/stems.md`.

## 5. Ce qui manque

- **Rien n'a été écouté** (pas de carte son sur les DGX) : le son est prouvé
  par niveaux et spectrogrammes. Le goût (le grain des machines d'ODIO, la
  balance de la session de départ) est à Cal.
- Web MIDI : écrit, pas essayé (pas de clavier MIDI sur les DGX).
- Micro : la latence est estimée, pas mesurée par un aller-retour.
- Pas de décompte avant la prise, pas de « punch » in/out, pas de quantification
  à l'enregistrement (on quantifie ensuite dans le piano roll).
- Un clip audio n'est pas étiré quand le tempo change (sa longueur en temps
  reste, le son garde sa vitesse) ; « Caler » (§ 6) le recale à la main, en
  Re-Pitch seulement.
- Les notes d'un clip ne se voient que dans l'éditeur (pas d'édition directe
  dans l'arrangement) ; pas de fondu enchaîné entre deux clips audio.
- Le rendu de la forme d'onde de la session refait tout le mixage (au-delà de
  40 minutes de morceau, il s'abstient).
- Des maquettes du kit non reprises : « Spectra », « Polynome », la baie 19",
  la matrice de modulation, les LFO, l'arpégiateur. Les 38 pages du « Kit
  Voix Verdant » (dont STUDIO NL—60) ne sont pas dans le dépôt : seule la
  capture a servi.
- Les deux instruments d'ODIO qui téléchargent leurs échantillons (TR-808
  échantillonnée, soundfonts General MIDI) ne sont pas repris.
- À 1600 px, la barre de transport tient juste ; en dessous de 1280 px, la
  forme d'onde de la session se cache.

## 6. Les remarques de Cal du 29/09 (deuxième tour)

Cal a essayé ODIO ; onze remarques, toutes tenues. Chacune a été pilotée
dans Chromium sans affichage sur DGX2 (portail d'essai :8784, script
`sr_daw_r2.mjs` du scratchpad), une capture par point (`daw/r2_*.png`).

| # | remarque | ce qui est fait | la preuve |
|---|---|---|---|
| 1 | panneau de gauche repliable | le navigateur en accordéon (Instruments, Effets, Préréglages, Sons, Motifs ; plusieurs ouverts), repliable en un rail (‹ ou Ctrl+Alt+B), sa largeur se tire (160 à 420 px, gardée dans le projet) | tiré de 60 px : 214 → 274 px, gardé ; replié : l'arrangement passe de 1290 à 1534 px |
| 2 | aucune sélection de texte ; renommer sur place | `user-select: none` sur la page, les champs seuls restent sélectionnables ; double-clic : piste (arrangement et console), clip (sur son titre), section, marqueur, motif, préréglage à soi — un champ remplace le texte, Entrée valide, Échap annule ; Ctrl+R renomme le clip choisi ou la piste | un glisser à travers la barre et les pistes ne sélectionne rien (`""`) ; piste, clip, section et préréglage renommés au clavier |
| 3 | tap tempo | bouton TAP et Maj+T ; tempo = 60 000 / moyenne des intervalles des dernières frappes (huit au plus), remise à zéro après 2 s de pause, instant pris sur `Event.timeStamp` | frappes à 500 ms → 120,0 bpm ; clics à 400 ms → 150,0 bpm |
| 4 | le compteur ne pousse rien | une case de largeur fixe par signe (le 0 de Venus Rising fait 1,06 em, mesuré ; case de 1,12 em), compteur de 126 px, temps en `mm:ss.d` tronqué ; état d'enregistrement et bouton de lecture de largeur fixe | pendant la lecture, les 33 éléments de la barre n'ont pas bougé d'un pixel (x et largeur relevés 12 fois) |
| 5 | poignées des clips | poignée gauche : rogne le début, la fin reste, le contenu reste calé (`off` avance d'autant de contenu : un motif en temps, un son en secondes × vitesse) ; droite : la fin ; corps : déplacer. Le dessin est refait à chaque pas depuis le nouveau départ | motif rogné de 2 temps : les pixels de la partie restante sont identiques avant, pendant et après le geste (comparaison octet à octet des captures) ; son rogné d'un temps : début + 0,4999 s (= 0,4 s × 1,25) |
| 6 | raccourcis de Live | la table de Live 12 (source ci-dessous) : Tab, Maj+Tab / F12, Ctrl+Alt+B / 3 / 4, Espace, Maj+Espace, Origine, F9, O, Ctrl+L, Ctrl+Z/Y, Ctrl+X/C/V, Ctrl+D, Suppr, Ctrl+R, Ctrl+A, Ctrl+E, Ctrl+J, 0, R, flèches, Ctrl+1/2/4, Ctrl+Alt+T, Ctrl+Maj+M, S/C/A, + / −, Z/X, W/H, Alt+ / Alt−, M (clavier MIDI), Z X C V (octave, vélocité), Ctrl+U (piano roll) ; la table dans le GUIDE, onglet Raccourcis | Ctrl+E, Ctrl+D, Ctrl+J (deux clips de batterie → un clip « Consolidé » de 128 pas), Ctrl+L, 0, Ctrl+C / Ctrl+V, Suppr → Ctrl+Z → Ctrl+Y, R, Ctrl+R, Ctrl+A, F9, O (clavier MIDI éteint) vérifiés |
| 7 | le rack en bas | la vue de détail de Live : onglets Clip et Instruments sous l'arrangement (Maj+Tab) ; Instruments = toute la chaîne de la piste choisie, de gauche à droite ; séparateur tiré (hauteur gardée) ; le panneau défile | 300 → 444 px, gardé ; la boîte à rythme dépasse 300 px et défile |
| 8 | zoom à la molette | Ctrl+molette : zoom horizontal ancré au curseur ; Maj+molette : défiler ; Alt+molette sur une piste : sa hauteur ; + / − ; la règle des temps tirée à la verticale : zoom, à l'horizontale : chercher, double-clic : la sélection ; Z / X : zoomer sur la sélection / revenir ; W : tout le morceau ; H : toutes les pistes ; Ctrl+Alt+glisser : déplacer la vue | le temps sous le curseur reste 32,0 après Ctrl+molette ; Alt+molette 88 → 100 px ; W : 64 temps dans 1290 px |
| 9 | réglages d'un clip audio | la vue Clip d'un son : fanions DÉBUT / FIN, accolade de boucle (position et longueur), gain, transposition (demi-tons et cents), inverser, fondus, normaliser, **Caler** (la région dure N mesures) ; l'onde se zoome (Ctrl+molette) | son de 440 puis 660 Hz : +12 → 880 / 1320 Hz et clip deux fois plus court ; inversé → 1319 / 879 ; en boucle, tiré à 7 temps : le son continue au-delà de sa fin ; calé sur une mesure à 150 bpm : vitesse × 1,2498 (attendu 1,25) |
| 10 | Tab | Arrangement ↔ Nodal | vérifié |
| 11 | le nodal façon ODIO_01 | le banc (`banc.js`) : l'arrangement en petit (sections, pistes et clips) et les lanes d'ODIO_01, leurs segments, les attracteurs tirés au clic milieu d'un segment jusque sur le graphe, anneaux, poignées, loi, teinte, fil, opérateurs, deux têtes (« c ») ; détail et écarts dans `musique/PROVENANCE.md` | segment TIMBRE tracé, attracteur posé sur la basse acide (anneaux matière 260 et brillance 420, 3 modules captés), il parle quand la tête rouge est dans son segment, se tait quand la verte gouverne |

**Source des raccourcis et des gestes** : *Ableton Live 12 Reference
Manual*, chapitres « Live Keyboard Shortcuts »
(ableton.com/en/manual/live-keyboard-shortcuts) et « Arrangement View »
(ableton.com/en/manual/arrangement-view), consultés le 29/09/2026. Écarts :
Live n'a pas de raccourci pour son bouton TAP (Maj+T est à ODIO) ; Maj+M
(un marqueur) est à ODIO ; Chrome garde Ctrl+T et Ctrl+Maj+T pour ses
onglets (réservés : la page ne les reçoit pas) et peut garder F12.

**Ce qui reste, ou n'est pas beau** :
- Le calage au tempo est un Re-Pitch : la hauteur suit la vitesse.
  `AudioBufferSourceNode.playbackRate` change les deux ensemble (MDN) ; un
  étirement qui garde la hauteur (vocodeur de phase, WSOLA) demanderait un
  AudioWorklet de plus.
- Consolider un son rend le clip sans les effets de la piste (comme Live) ;
  le WAV entre dans la bibliothèque, dossier Musique.
- Le banc : les opérateurs se lisent, ils n'agissent pas sur le son — ODIO_01
  non plus ; la table `FACETTES` (ce que chaque réglage a de rythmique,
  d'harmonique, de timbral) est à relire par Cal : nos boîtes à rythme n'ont
  ni swing ni densité, RYTHME ne capte que l'accent de la basse acide. Les
  couleurs des lanes sont, depuis le 29/09 au soir, celles d'ODIO_01 en cinq
  jetons nommés de `musique/nodal.css` (`--nd-ryt`… : sombre et clair, au
  contraste AA) — `docs/etudes/musique_theme.md`.
- Un segment de 40 px ne montre qu'une ligne d'opérateur (comme dans
  ODIO_01) ; zoomer le banc en montre plus.
- La touche « c » bascule les têtes dans le nodal (ODIO_01) : là, elle ne
  règle plus la vélocité du clavier.

## 7. Les jouets du Playground dans le nodal (29/09)

Cal : « aussi pour ODIO on va intégrer ces nodes rigolos dans le canva. on
doit leur mettre des in et out pour pouvoir les relier, on les met dans notre
DA mais on garde le design à l'intérieur des nodes qui est bon. il faut garder
leur code d'interaction qui est cool. et le graphisme doit rester identique
dedans. » La référence : son « ODIO-O1 Playground » (quatorze blocs), et sa
fiche `UI/3_machine/PLAYGROUND.md` dans ODIO_01.

**Porté, pas embarqué** (`musique/jouets/`, détail dans `musique/PROVENANCE.md`).
Le Playground n'est pas un arbre de composants React : c'est une classe
`DCLogic` rendue par le gabarit et le moteur de l'outil de conception qui
l'a produit (`<x-dc>`, `sc-for`, 69 Ko de script à la licence non dite),
sur React 18. React n'y dessine que le cadre — que Cal veut dans notre DA ;
tout l'intérieur est du Canvas 2D. Il est donc repris mot pour mot en modules
ES : aucune étape de construction, aucune dépendance réseau, 143 Ko de code
lisible et commenté (dont 81 Ko de scènes reprises, qu'il faudrait de toute
façon) au lieu de 212 Ko minifiés de React et du moteur DC qui ne
dessineraient que le cadre, et une seule façon d'écrire dans le portail.

| fichier | rôle |
|---|---|
| `jouets/defs.js` | les quatorze jouets et l'horloge : réglages (ceux de `BLOCKS`), taille, ports |
| `jouets/scenes.js` | l'intérieur : physique, dessin, gestes du Playground, jouet par jouet |
| `jouets/son.js` | le son des quatre qu'on traverse (écho à bande, réverbe, filtre, volume) |
| `jouets/index.js` | les jouets posés, **une** boucle d'animation (elle s'arrête sans jouet), ports et câbles typés, notes calées sur le transport, valeurs, mélange de la fontaine |
| `jouets/jouets.css` | les jetons de la palette du Playground (`--jo-*`), IBM Plex Mono, les ports |
| `server/tools/music_jouets.py` | les sortes, les câbles typés, leurs boucles, le chemin de l'aimant ; son selftest |

Points d'accroche, marqués `jouets :` : `modules.js` (3), `moteur.js` (4),
`musique.js` (10 lignes), `nodal.js` (12), `server/tools/music.py` (5).

**Le cadre et l'intérieur.** La carte est celle du nodal (en-tête, point de
couleur, ports, molettes, choix, sélection, menus, panneau de droite) ; son
en-tête dit ce que disait celui du Playground (« 03 · générateur de trigs »),
son pied le geste (« attrape la balle et lâche-la ») et ce qu'elle reçoit et
émet. La scène fait la taille de celle du Playground (bloc − 2 × − 102 px) ;
à 100 % elle est dessinée pixel pour pixel comme lui, au-delà sa définition
suit le zoom (celle de l'écran, DPR plafonné à 2 comme lui).

### Les ports

Trois sortes, trois formes : **son** (le rond du nodal, inchangé), **notes**
(losange, câble en pointillé rond : une note horodatée), **valeur** (carré,
câble tiret-point : un nombre 0..1 qui règle un réglage choisi au
branchement). Dans le projet : `{ a, b }` (son), `{ a, b, t: 'notes' }`,
`{ a, b, t: 'mod', k }`. Chaque réseau est sans boucle (refusé au câblage et
par le serveur). Les instruments ont une entrée notes (les cinq sources
d'ODIO et les trois d'ici, pas le lecteur audio) ; tout module qui a un
réglage pilotable a une entrée valeur (ce qu'`AUTOMATABLE` tient ; pas la
sortie).

| jouet | reçoit | émet | ce qui sonne |
|---|---|---|---|
| Shuffle fountain (00) | notes : un tir · valeur | notes : l'explosion d'une bille armée | ses billes volent au-dessus du nodal et mélangent les réglages des cartes où elles retombent (reviennent exactement) |
| Reel–2 (01) | **son** · valeur | **son** · valeur : la bande (remplissage) | écho à bande : vitesse → temps (800 → 80 ms), feedback, wow = sinus au rythme du brin dessiné ; scruber change la vitesse de bande |
| Alchimie (02) | **son** · valeur | **son** · valeur : le niveau du liquide | le volume = le liquide (amplitude), la viscosité le fait suivre lentement |
| Ping–pong (03) | notes : relance la balle · valeur | notes : chaque rebond au sol (vélocité = l'impact) · valeur : la hauteur | sa Note (do par défaut) |
| Lance–pierre (04) | notes : un tir vers la cible · valeur | notes : l'anneau touché | les trois notes écrites sur la cible (degrés 1, 3, 5 de sa gamme) |
| Ressort (05) | **son** · notes : pincer · valeur | **son** · valeur : l'énergie de la corde | réverbe d'ODIO : decay = decay × 0,06 s (ce que la scène affiche), tension → amorti ; pincer ouvre le mélange |
| Aimant (06) | **son** · valeur | **son** · valeur : x de l'aimant | filtre d'ODIO : coupure 40 Hz × 400^x (la lecture de la scène), y → résonance ; le chemin se rejoue sur le transport, à l'export aussi |
| Ninja (07) | notes : lance une forme · valeur | notes : chaque forme tranchée ; combo : + l'octave | la note écrite dans la forme |
| Secousse (08) | notes : une secousse · valeur | notes : chaque bille qui frappe une paroi · valeur : l'agitation | la note de la bille |
| Pachinko (09) | notes : lâche une bille · valeur | notes : le bac d'arrivée · valeur : le bac | bac − 4 = degré de sa gamme (comme ODIO_01) |
| Grille–pain (10) | notes : baisse le levier · valeur | notes : la tranche qui saute · valeur : la chaleur | la note gravée sur la tranche (le brunissage) |
| Flipper (11) | notes : les deux palettes · valeur | notes : champignons, cibles, couloirs, lance-billes | la, do, sol / ré, si (la fiche du Playground) |
| Navette (12) | notes : un tir (elle joue un instant sans survol) · valeur | notes : chaque forme détruite | sa note |
| Berceau (13) | notes : lève la bille de gauche · valeur | notes : la bille de bout qui repart | do la sol si ré mi fa (`NEWT_PC`) |
| Horloge | — | notes : une par division (1/1 à 1/16) tant que le transport joue | sa Note ; posée à l'instant exact de la division |

**Une note émise** : hauteur 12 × (Octave + 1) + la note du jouet (do4 = 60) ;
une batterie joue la voix de ce rang (modulo son nombre de voix). Instant :
**calé sur la grille du transport** quand il joue (Calage : libre, 1/32,
1/16 par défaut, 1/8, 1/4 ; la fin de boucle est un point de grille), tout
de suite sinon. Durée : Durée × la noire. Une piste armée qui enregistre
garde aussi les notes des jouets (la prise). Les jouets vivent dans toutes
les vues (la boucle ne dessine que dans le nodal, et seulement ce qui est à
l'écran) ; ce qui se lance seul (fontaine, NINJA, PACHINKO, la bobine) suit
le transport, comme le bouton lecture du Playground.

**Une valeur** : relevée à chaque image, envoyée quand elle bouge de plus de
0,002 (ou toutes les 250 ms) ; un AudioParam y glisse (`setTargetAtTime`,
20 ms), un module d'ODIO la prend par `setParameter` ; une voie
d'automation qui joue garde la main. Câble retiré : le réglage reprend sa
valeur.

### Ce qui a été vu (DGX2, portail d'essai :8794, `jouets/*.mjs` du scratchpad)

- **Au pixel près** (`pixels.mjs`) : le Playground de Cal joue (un geste s'il
  en faut un : tirer, verser, tracer, trancher…), on fige son horloge, on lit
  l'état de la scène ; le même état posé dans notre carte, on compare les
  deux canvas : **14 jouets sur 14, 0 pixel différent** (tailles identiques,
  de 378 × 238 à 778 × 438), en rendu logiciel comme sur le GPU. Sur six
  passages, deux fois la SECOUSSE a différé de 8 pixels aux bouts de deux
  filets (et d'une unité sur une rangée) : l'anticrénelage du canvas
  accéléré d'une page à l'autre, pas le dessin — les quatre autres passages,
  même code, 0. Captures côte à côte : `cote_<jouet>.png`.
- **Les gestes** (`gestes.mjs`, à la souris sur nos cartes, notes vers une
  piste Analog sans clip) : Ping–pong lancé → 2 notes ; fontaine → 1
  explosion, un module de réverbe mélangé ; Lance–pierre visé → 3 tirs,
  3 notes ; Secousse → 22 ; Pachinko → 2 billes au bac ; Grille–pain → les
  deux tranches, 1 note ; Berceau → 4 ; Flipper → 10 ; Navette → 4 formes
  détruites, 4 notes ; Ressort pincé → énergie 20. La piste crête entre
  −5 et −12 dBFS.
- **Calé sur le transport** : pendant la lecture, 53 notes (Pachinko relancé
  par l'horloge 35, Flipper 12, Ninja tranché 4, fontaine 2) : **toutes sur
  la double croche** (écart 0), posées au plus tôt 12 ms avant de sonner.
- **Les quatre qu'on traverse** (un la tenu passe dedans) : scruber le REEL
  fait passer l'écho de 277 à 154 ms ; pincer le RESSORT fait monter le
  mélange de 38 à 63 % ; l'AIMANT sur un chemin tracé, transport en marche :
  coupure 393 → 3 714 → 8 788 Hz, résonance 11,1 → 2,8 ; verser l'ALCHIMIE :
  −2,9 → −19,9 dB.
- **Une valeur** : la hauteur du Ping–pong règle la vitesse du REEL (46 au
  repos) : 49, 10, 61, 96, 67, 30 pendant le vol.
- **Bibliothèque, pose, câble** (`menu.mjs`) : double-clic dans le vide → la
  section « jouets · le Playground de Cal » ; la Navette posée, tirée par
  son en-tête, un câble de notes tiré à la souris du losange jusqu'au Lead.
- **Enregistré, rouvert** : 19 jouets, 12 câbles typés, le chemin de
  l'aimant (25 points) reviennent à l'ouverture. **Retirés** (Suppr, puis
  les autres) : plus d'instance, la boucle d'animation s'arrête en 50 ms.
- **Performance** (`perf.mjs`, la session de départ en boucle, 10 s par
  mesure, Chromium sur le GPU de DGX2 — ANGLE, NVIDIA GB10) : sans jouet
  59,9 images/s ; les quatorze animés (une horloge à la croche les relance,
  175 à 221 notes en 10 s), tous à l'écran à 38 % : **60,1 images/s**, image
  la plus longue 16,8 ms, aucune tâche longue ; à 100 % : 60,0 ; en vue
  Arrangement : 60,0. Le planificateur garde toujours au moins 83 ms d'avance
  (aucune tranche en retard sur 400) et l'horloge audio suit la murale
  (0,9996). Le même banc sur SwiftShader (rendu logiciel) tombe à 4 à
  25 images/s — le Playground de Cal lui-même y fait 46 : c'est le rendu
  logiciel, le son n'y prend aucun retard non plus. `playoutStats` (les
  pertes de la carte son) n'existe pas dans ce Chromium : pas de mesure
  directe des craquements.
- `python3 tools/check.py` : **625 passés, 0 en échec** (12 de plus :
  `music_jouets`).

### Ce qui diffère encore du Playground, ou n'est pas beau

- Le cadre n'est plus le sien : titres en Chakra Petch (pas Microgramma),
  nos molettes au lieu de ses trois familles (dial, enc, slider), la
  lecture des valeurs sans unité (« 62 » et non « 62 % »). Depuis le
  rhabillage du 29/09 (`musique_theme.md`), les tuiles du nodal portent le
  même cadre que les jouets : une carte du nodal d'avant ; les ports des
  jouets et leurs câbles gardent leur taille à l'écran.
- Deux défauts du Playground corrigés (voir PROVENANCE) : l'anneau de
  `d_pong` (« TN is not defined » à chaque rebond) et le tir de la NAVETTE
  (`ev.button`, le clic ne tirait jamais).
- À l'export, le son des jouets est ce qui s'écrit : le chemin de l'AIMANT,
  les réglages des trois autres ; ce qui se joue à la main (scruber,
  pincer, verser) et les notes des jouets ne s'exportent que par une prise.
- Le texte des scènes suit le zoom du nodal (le Playground le gardait à
  taille fixe) ; à 100 % tout est identique.
- Les cartes de jouet sont grandes (380 à 780 px) : elles passent devant les
  cartes qu'elles recouvrent (sans quoi les ports de celles-ci traversaient
  leur scène) ; le nodal n'a pas d'autre ordre de profondeur.
- La fontaine ne mélange ni les niveaux (dB) ni la console : choix de
  prudence, à confirmer par Cal ; ODIO_01 mélangeait tout.
- Les nombres qui ne viennent pas du Playground sont des choix de réglage
  (écrits dans `son.js`) : temps d'écho, pleurage de 4 ms, tension →
  amorti, énergie → + 50 points de mélange, résonance de l'aimant.
- Pas encore de jouet dans la vue Instruments (le rack les liste parmi les
  modules libres, sans leur scène).

## 8. Le génératif dans l'arrangeur : pistes génératives, prises, partition, MIDI (29/09)

Cal : « il faut pouvoir ajouter des pistes "génératives" dans l'arrangeur […]
on dessine une sélection sur la zone et dans le panel du bas on a les infos
pour faire de la génération avec les options données par notre modèle […]
pouvoir générer seulement une batterie, ou une guitare avec une tonalité
donnée et qui colle à notre tempo […] YuE2 génère d'abord une partition […]
injecter nos pistes MIDI dedans ? […] clic droit sur nos clips audio pour
extraire le MIDI et donc se faire une bibliothèque de clips MIDI. » L'étude
des modèles : `docs/etudes/musique_generatif.md` (§ 6 pour l'intégration,
§ 6.5 pour les paramètres). **Tout tourne sur des moteurs factices** ; le
câblage réel est écrit derrière des interrupteurs.

### Ce qui est fait

- **La piste générative** : une piste audio qui porte `gen: { model, task }`
  (« + Piste » → Générative · ACE-Step ou YuE2, ou le navigateur,
  Instruments → Génératif). Elle joue, se mixe, s'exporte, se sépare comme
  les autres. Sur sa voie, **tirer sur le vide dessine une région**, aimantée
  à la grille (Alt : la double croche ; Maj ou Ctrl : le cadre de sélection,
  comme ailleurs ; double-clic : quatre mesures).
- **La région** est un clip audio qui porte `gen` (modèle, tâche, réglages,
  contexte, prises) ; sans prise, elle n'a pas de son (hachurée, « à
  générer »). Elle s'ouvre dans le **panneau du bas** (vue de détail, onglet
  Clip), dessiné depuis le schéma : à gauche la région, le modèle, la tâche
  (chacune dit « essai », « réel » ou « pas câblé » et pourquoi), **ce qui
  vient du projet tout seul** (tempo, mesure, tonalité ramenée à majeur ou
  mineur, durée et ce que le modèle en fera, sections couvertes), la case des
  attracteurs ; au milieu les réglages de la tâche (**seulement** : les douze
  pistes d'ACE-Step ; **ce qui joue autour** : les pistes cochées, la marge ;
  **audio de style** ou **son à varier** : un clip glissé depuis
  l'arrangement, le navigateur, la bibliothèque ou le disque ; style,
  paroles, graine, **prises** 1 à 8 ; les réglages avancés repliés), et ce que
  le modèle n'a pas, barré avec la raison ; à droite les **prises** et
  **Générer** (le seul orange ; le GUIDE s'éteint).
- **Le contexte** (une piste, compléter, repeindre, isoler) : les pistes
  cochées sont rendues hors temps réel sur la région ± la marge par le moteur
  de la page (`renderMix`, le même graphe que l'export), rangées dans la
  bibliothèque et envoyées comme `src_audio` ; la région y garde sa place
  (`repainting_start/end`). ACE-Step rend la durée exacte de ce qu'on lui
  envoie (étude § 2.3) : la prise tombe calée par construction (`off` = la
  marge).
- **Les prises** (les « takes » de Live) : N propositions, graine, graine + 1…
  La première joue ; on écoute (▶ depuis la région), on choisit, on retire ;
  « Garder » en fait un clip audio ordinaire ; « En pistes » pose une piste
  muette par prise ; clic droit sur la région : les prises, la suivante.
  **L'empreinte** (étude § 6, canon d'ODIO_01 § 2.9) : une prise dont les
  entrées ont changé (tempo, mesure, tonalité, réglages, longueur, place pour
  un contexte) reste jouable et le dit (« périmée »).
- **YuE2 et sa partition** : « Écrire la partition » (travail `music.yue.abc`,
  YuE2GenerateABC seul, rien n'est chanté) ; l'ABC s'affiche, se modifie, est
  **jugé par abc_tools.py** (celui du dépôt YuE, chargé tel quel) et dessiné
  (chant, thème, accords) ; trois cases **Chant** (voix Vocal), **Thème**
  (Ins), **Accords** reçoivent un clip de notes glissé depuis l'arrangement, un
  motif, un clip MIDI de la bibliothèque, ou le clic droit d'un clip de notes
  (« Comme chant / thème / accords »). Notre sérialiseur
  (`generatif_abc.js`) relit la partition par abc_tools, remplace la voix,
  réécrit le dialecte (la note la plus haute quand deux se chevauchent ; les
  accords reconnus parmi les 15 qualités, basse en barre oblique) ; les prises
  chantent cette partition (`abc`), qui reste rangée avec elles ; « Par nos
  instruments » la joue tout de suite sur des pistes de notes ; « D'une
  prise » reprend celle qu'une prise a chantée.
- **Clic droit sur un clip audio** : « Séparer en stems » (le contrat
  existant), **« Extraire le MIDI »** (notes par basic-pitch, partition par
  SheetSage2, batterie par ADTOF, piano par ByteDance, « séparer d'abord »,
  quantifier ; les réglages de basic-pitch repliés), « Comme audio de style »
  (la case de la région ouverte en bas). Le MIDI se pose en clips de notes sur
  une piste neuve **sous le clip, au même départ** (transposition, vitesse et
  sens du clip suivis), un canal par piste (chant, thème, accords, batterie).
- **La bibliothèque MIDI** : une sorte `midi` ajoutée à la bibliothèque du
  portail (`server/core/library.py`, `.mid`/`.midi` — **un fichier du
  socle**, au plus court) ; le navigateur a sa rubrique **MIDI** (chercher,
  glisser sur une piste d'instrument : ses notes ; ailleurs : une piste par
  canal ; renommer, télécharger le .mid, corbeille ; « + Le clip choisi » ;
  déposer des .mid) ; clic droit sur un clip de notes : « Ranger dans la
  bibliothèque MIDI ». Le fichier s'écrit et se lit côté serveur seulement
  (SMF format 0 ; la batterie en General MIDI au canal 10).
- Le tiroir « Générer » (un morceau entier) renvoie vers les pistes génératives.

### Le schéma des paramètres

`musique/generatif_modeles.json` : **la seule vérité**, lue par la page
(`generatif_modeles.js` dessine le panneau) et par le serveur (`music_gen.py`,
`music_midi.py` valident contre lui : un réglage qui n'est pas celui de la
tâche est refusé, une valeur hors bornes aussi). Chaque paramètre : `label`,
`type`, `min`/`max`/`step`, `defaut`, `projet` (ce qui vient de la session),
`si` (sa condition), `envoi` (le nom du champ chez le modèle), `source`.

| modèle · tâche | paramètres (hors projet) | réel |
|---|---|---|
| ACE · morceau (`text2music`) | style 512, sans voix, paroles 4096, langue (51), graine, prises 1-8, audio de style ; avancés : pas 1-200 (50), guidage 1-15 (6), décalage 1-5 (3), codes LM, température / guidage / top-p du LM | ComfyUI, câblé (`"music_engine": "ace-step"`) ; l'audio de style par ReferenceTimbreAudio, écrit, jamais rendu |
| ACE · une piste (`lego`) | seulement (12 pistes), style, style du morceau entier, contexte + marge 0-8, graine, prises, audio de style, avancés + méthode ode/sde | serveur d'API d'ACE-Step pas câblé ; modèle base à télécharger (acestep-v15-base, 4 791 792 407 o, MIT) |
| ACE · compléter, isoler | ajouter (plusieurs pistes) / seulement, contexte, marge… | idem (base seulement) |
| ACE · repeindre | contexte, conservation (prudente, équilibrée, libre), intensité 0-1 ; zone 3 à 90 s | serveur d'API pas câblé (sft sur disque) |
| ACE · variation (`cover`) | son à varier, fidélité 0-1 (1,0), bruit de départ, style, paroles… | idem |
| YuE2 · chanson | style 2000 (+ « 112 BPM, F minor » ajoutés seuls), paroles 12 000, graine, prises 1-8, partition full / melody / off, la partition (60 000), précision bf16 / int8 | ComfyUI, câblé (`"music_yue": true`) |
| YuE2 · reprise d'un clip | clip à reprendre (SheetSage2), style, paroles… | ComfyUI, câblé |
| YuE2 : absents, avec la raison | seulement une piste, audio de style, ce qui joue autour, tempo et tonalité (écrits dans le style et la partition) | — |
| MIDI · notes (basic-pitch 0.4.0) | séparer d'abord + le stem, seuils d'attaque 0,5 et de tenue 0,3, note la plus courte 127,7 ms, fréquences mini/maxi, melodia, quantifier | `"music_midi": true`, venv d'AUDIOLAB |
| MIDI · partition (SheetSage2) | ce qu'il relève (full / melody), quantifier | ComfyUI (voie audio) |
| MIDI · batterie (ADTOF), piano (ByteDance) | quantifier | à télécharger (ADTOF, taille non relevée, non commercial ; le point de contrôle du piano) |

Ce qui vient du projet, recalculé par le serveur depuis les nombres de la
session : tempo (30-300 pour ACE : 25 est refusé), mesure, tonalité
(`aceKey`), durée de la région (sous 10 s : 10 s demandées, le clip n'en
joue que la région ; au-delà de 600 s : refusé), sections (le plan d'une
partition d'essai). Les interrupteurs `music_yue`, `music_stems`,
`music_midi` sont maintenant déclarés (Admin → Câblage) ; `music_yue` était
attendu par `admin.py`.

### Le serveur

| route | travail | module |
|---|---|---|
| `GET /api/music/gen/engines` · `POST /api/music/gen/generate` | `music.gen.ace`, `music.gen.yue` (les prises d'une région) | `music_gen.py` (neuf) |
| `POST /api/music/yue/abc` · `POST /api/music/yue/abc/check` | `music.yue.abc` (la partition seule) ; le jugement par abc_tools | `music_yue.py` |
| `GET /api/music/midi/options` · `POST /api/music/midi/extract` · `POST /api/music/midi` · `GET /api/music/midi/{id}/notes` | `music.midi` (notes, batterie, piano), `music.midi.abc` (partition) | `music_midi.py` (neuf) |

`music.py` accepte les pistes et les régions génératives (`gen` : modèle
connu, 4 ko sur une piste, 96 ko et 64 prises sur une région ; un clip audio
sans son seulement s'il est une région) et dit les sept contrats.
`music.yue` juge désormais une partition fournie par abc_tools avant le
modèle, et son moteur d'essai chante sa partition (celle d'essai est écrite
dans le dialecte natif). Les moteurs d'essai : une boucle de deux mesures
synthétisée par famille (batterie, basse, pincé, clavier, arpège, nappe,
voix…) dans la gamme du projet ; une variation par un filtre ffmpeg sur le
son source ; la partition jouée en sinus ; le MIDI par l'énergie et les
passages à zéro, ramené à la gamme.

### Ce qui a été vu (DGX2, portail d'essai :8807, `sr_odio_gen_drive.mjs`)

`python3 tools/check.py` sur un clone du dépôt (1f64157) avec ces fichiers :
**692 passés, 0 en échec** (dont les selftests de `music_gen`, `music_midi`,
et ceux de `music_yue` pour la partition). Pilotage dans Chromium sans
affichage, **aucune erreur de console** :

- « + Piste » → Générative · ACE-Step : piste `gen: {ace, lego}` ; une région
  tirée de la mesure 5 à 9 ; le panneau : 112 → « bpm 112 », FA MIN →
  « F minor », 4/4, 8,6 s, « celle du contexte » ; la tâche « une piste »,
  batterie choisie, Batterie, Basse, Nappe, Lead autour ; un seul orange.
- 3 prises (graines n, n + 1, n + 2), chacune **17,14 s = la fenêtre (8
  mesures)**, la région à 4,29 s dedans (2 mesures de marge), parent = le
  contexte rendu ; la 2ᵉ choisie : elle joue (−9 dBFS sur la tranche) ;
  gardée : un clip audio ordinaire.
- Un clip de l'arrangement **glissé dans « audio de style »** d'une autre
  région : la case le prend, le clip ne bouge pas.
- YuE2 par le navigateur ; ses absents dits (seulement une piste, audio de
  style, ce qui joue autour) ; la partition d'essai écrite (Q:1/4=112, K:Fm) ;
  le Lead (mesure 9) en **Chant** : 18 notes ; la Nappe en **Accords** :
  **Fm, Db, Ab/C, Eb** — jugée bonne par abc_tools (4 mesures) ; deux prises
  qui chantent **cette** partition ; « Par nos instruments » : pistes Chant et
  Accords ; le tempo passé à 120 : les deux prises « périmées », revenu à
  112 : plus aucune.
- Clic droit sur un clip audio : Séparer en stems, **Extraire le MIDI** ; la
  modale (quatre méthodes, licences, réglages) ; 26 notes posées sur une
  piste « MIDI · … » **sous le clip, au même départ** ; l'objet `midi` dans la
  bibliothèque, parent = le son.
- La rubrique MIDI du navigateur ; un clip MIDI **glissé sur le Lead** à la
  mesure 3 : un clip de 26 notes, qui **joue** (−20 dBFS sur la tranche du
  Lead, ses autres clips rendus muets). Le glisser se fait par ses
  événements (dragstart, dragover, drop) : `dragTo` de Playwright attend une
  navigation après un glisser de lien et ne finit pas.

Captures (scratchpad de la session, `odio_gen/`) : menu, piste, région en
dessin, panneau, prises, audio de style glissé, partition écrite et nourrie,
prises YuE2, périmées, menu du clip, modale MIDI, MIDI posé, bibliothèque,
clip MIDI qui joue.

### Ce qui n'est pas fait, ou pas beau

- **Rien n'a été rendu par un modèle** ; les moteurs d'essai sont des repères.
  Ce que rend `lego` (la piste seule ou le mélange) : non documenté, à
  relever au premier rendu (étude § 7).
- Le **nodal** : la piste générative y apparaît par son lecteur (le module
  `player`), sans entrées propres. Le module `gen` de l'étude (§ 6.2 : entrées
  contexte, motifs, style ; réglages captables par un attracteur) demande
  `nodal.js` et `FACETTES` de `banc.js`, d'autres chantiers : pas fait.
- **Les attracteurs** : la case liste les segments du banc qui couvrent la
  région ; « ce qu'ils ramènent » attend la fonction que `banc.js` doit
  exposer (cherchée sous `attracteursActifs`, `attracteurs`,
  `activeAttractors`…) : vide, avec la raison.
- Les **étages** de l'étude (intent → plan → proxy → stems → final) ne sont
  pas dessinés ; seule l'empreinte l'est.
- « Séparer d'abord » ne s'enchaîne pas en réel (deux voies : la séparation
  sur `audio`, la transcription sur `cpu`) : refusé avec la raison ; en essai,
  le filtre du stem.
- La mesure 6 s'écrit **M:6/4** dans la partition (une mesure d'ODIO compte
  6 noires sur la grille de 4 doubles croches) ; l'étude proposait 6/8 : à
  trancher par Cal.
- Asset (`asset/`, `commun/shell.js`) ne connaît pas encore la sorte `midi` :
  ses clips s'y listent sans vignette ni libellé traduit.
- Le panneau est dense sous 1400 px (trois colonnes) ; la partition éditée à
  la main n'a pas de coloration, seul abc_tools la juge (à 700 ms de la
  frappe).

## 9. Troisième tour (29/09) : la souris, les menus, les pistes, un seul graphe

Cal, le 29/09 : « pour les canva comme celui de ODIO on doit avoir une
interaction avec bouton milieu souris pour le pan et clic gauche pour des
sélections de node avec les standards en ajout et enlever de la sélection par
clic. on doit d'une façon générale ne plus avoir de clic droit du browser
partout dans nos outils.. on a un menu contextuel dédié à où on se trouve au
survol. il faut qu'on puisse delete des pistes dans l'arrangeur avec la touche
supprime. il faut dans le panel rack en bas en dessous de l'arrangeur qu'on
ait tout sans avoir d'onglet clip et instrument. […] si j'ajoute un délai en
canva mais que je fais passer deux nodes qui appartiennent à deux pistes
différentes il doit rentrer dans la chaîne de l'une et l'autre […] le nom
d'une piste de l'arrangeur est ce qui doit être bien visible […] on doit
pouvoir affecter des couleurs facilement aux pistes ou au node de start dans
le canva […] il faut pouvoir aussi drag and drop les pistes pour les mettre de
haut en bas.. et aussi faire des groupes de pistes si je drag sur une autre
facilement : mets du magnétisme sur « l'entre-piste » et les pistes. »

Et le Ctrl+Z commun du portail (`commun/undo.js`, `docs/etudes/preferences.md`
§ 4) terminé dans tout ODIO.

### Ce qui est fait

| demande | ce qui est fait | où |
|---|---|---|
| Ctrl+Z en AZERTY | la pile commune : un instantané de l'œuvre par geste (tout ce qui passe par `app.commit` : arrangement, console, nodal, attracteurs, jouets, génératif), fondu sur 350 ms ; Ctrl+Z, Ctrl+Maj+Z, Ctrl+Y lus par la LETTRE (`e.key`), les commandes d'ODIO aussi (`ui.js` `letter` ; le clavier MIDI de l'ordinateur reste à la touche physique) ; ↶ ↷ et le journal dans la barre ; un libellé par geste (« retirer la piste « Basse » », « tracer l'ordre de « DÉLAI » : Mix, Ton, Retour »…). Deux fautes trouvées et corrigées en chemin : ce que les vues créent en se dessinant (les tables vides du nodal, la tension plate du banc) comptait comme un geste et effaçait la pile de rétablir (`projet.js` `workOf` les ignore) ; reposer un instantané remplaçait les objets, et une molette de tuile ou de jouet écrivait ensuite dans un module détaché du projet (`musique.js` `fondre` garde chaque objet à id) | `musique.js`, `projet.js`, `ui.js`, `timeline.js`, `editeurs.js`, `nodal.js`, `banc.js` |
| la souris du nodal | bouton du milieu glissé : la vue, partout — sauf sur les réglages d'une tuile, où il TRACE l'ordre d'exposition (le geste d'ODIO_01, `docs/etudes/musique_odio01.md` § 5) ; clic : choisir, Maj+clic : ajouter, Ctrl/⌘+clic : ajouter ou retirer, ⌥ : retirer (ODIO_01) ; un clic sans glisser sur une tuile d'une sélection plus large ne garde qu'elle ; glisser le fond : le cadre (Maj ajoute, Ctrl inverse, ⌥ retire) | `nodal.js` |
| plus aucun menu du navigateur | le menu commun du portail (`commun/menu.js`, par `ui.js` `menu`) partout ; un menu propre à chaque zone : en-tête de piste, voie, clip, règle, sections, arc et automation, panneau du bas (clip, module du rack), fond du nodal, tuile (nœud de départ, effet partagé, section de machine, clavier), étiquette de piste, câble, borne, jouet, segment, lane et attracteur du banc ; ce qui n'a pas le sien (barres, console, navigateur) prend celui de sa vue, sinon celui d'ODIO (annuler, vues, lecture, une piste, générer…). Seul un champ texte garde le menu du navigateur (copier, coller). Là où le bouton droit est déjà un geste (effacer une courbe peinte, la vélocité d'un pas, ôter une note, le FLIPPER et la NAVETTE), rien ne s'ouvre (`data-nomenu`). Un menu ouvert garde le clavier (Échap le ferme, Suppr n'y retire rien) | `musique.js` (le filet), les vues (`zoneMenu`), `rack.js`, `banc.js` |
| Suppr sur une piste | un clic sur l'en-tête la CHOISIT (Ctrl : en ajouter ou retirer, Maj : jusqu'à elle — Live 12, § 42.5 « Select Multiple Items ») ; Suppr retire les pistes choisies sans confirmation (Live 12, § 42.19 « Delete Track from Track Title Bar ») : Ctrl+Z les rend. Un clic dans la voie rend la piste courante sans la choisir : Suppr n'y retire rien | `timeline.js`, `musique.js` `removeTracks` |
| glisser une piste, grouper | l'en-tête se glisse ; magnétisme franc : le tiers haut et le tiers bas d'un en-tête sont l'ENTRE-PISTES (un trait orange se pose sur la limite : la piste ira là), le cœur est la PISTE (elle s'entoure d'orange : lâchée, elles font groupe) ; le fantôme dit « déplacer » ou « grouper ». Un groupe (`p.groups`, `t.grp`, ses membres se suivent) a son en-tête : replier (▾ / ▸ : un rang, les clips des membres en petit), renommer (double-clic), défaire, choisir ses pistes, les colorer ; il se glisse entier ; Ctrl+G groupe les pistes choisies, Ctrl+Maj+G défait (Live 12, § 42.19). Au bord de son groupe, une piste y reste (réordonner dedans) ; ailleurs, elle en sort | `timeline.js`, `projet.js` (`deplacerPistes`, `grouperPistes`, `rangerGroupes`), `server/tools/music.py` (valide `groups`, `grp`) |
| le panneau du bas sans onglets | une colonne qui défile : le clip choisi (notes, pas, son, ou la génération d'une région), puis la chaîne de la piste (le rack) ; « Instruments et effets », Maj+Tab, F12, Ctrl+Alt+3 / 4 font défiler jusqu'à la partie voulue | `editeurs.js` `createDock` |
| un effet dans deux chaînes, lié | la chaîne d'une piste n'est plus rangée : c'est le trajet de sa source à sa tranche dans les câbles (`projet.js` `trajets`), une seule vérité pour le rack, le nodal, le moteur. Un câble tiré, dans le nodal, d'un nœud d'une piste vers un effet qui n'est pas sur sa chaîne l'y fait ENTRER (juste après ce nœud) : le délai de la basse que la batterie traverse est dans les deux chaînes, les deux racks le montrent « lié · Batterie / Basse », une seule instance (un module, ses réglages). Le moteur en joue une VOIX PAR PISTE (`moteur.js` `voixPartagees`) : régler l'effet règle les deux, et le son de chaque piste reste dans sa piste (sa tranche, son muet, son stem). Retirer l'effet recoud chaque chaîne pour elle-même (`recoudre`) ; « sortir de cette chaîne seulement » (menus du rack, de la piste, de la tuile) ; retirer une piste laisse l'effet à l'autre | `projet.js`, `moteur.js`, `musique.js` (`chain`, `removeModule`, `removeFromTrack`, `removeTracks`), `nodal.js` `relier`, `rack.js` |
| arrangement et nodal, deux vues du même graphe | au-delà des chaînes : choisir un nœud d'une piste en fait la piste courante de l'arrangement (et son rack en bas) ; « voir son nœud dans le nodal » / « voir dans l'arrangement » ; la piste courante se cerne de sa couleur dans le nodal | `nodal.js`, `timeline.js` |
| le nom et la couleur des pistes sur le nodal | le nœud de départ d'une piste (sa source ; une machine-instrument : chacune de ses sections) porte la couleur de la piste (bandeau d'en-tête, teinte) ; son nom, dans une étiquette à GAUCHE du nœud, à taille d'écran constante : lisible à tous les reculs ; les fils de sa chaîne ont sa couleur (tiretés quand deux chaînes les empruntent) ; les notes d'un clavier, la couleur de la piste qu'elles jouent. La couleur est UNE valeur (`t.color`) : un geste depuis la piste (sa barre de couleur, la palette) ou depuis le nœud (la pastille de l'étiquette, ou « couleur de la piste » dans son menu) ; la palette : les sept jetons des pistes | `nodal.js`, `nodal.css`, `timeline.js`, `musique.js` `setTrackColor` |

### Ce qui a été vu (DGX2, copie `/tmp/sr_odio3`, portail d'essai :8823, `/tmp/sr_odio3_essai.mjs`, captures `/tmp/sr_odio3_shots/e*.png`)

- **Souris** : clic milieu glissé de (120, 60) sur le fond → la vue bouge de
  (120, 60) ; sur l'en-tête d'une tuile, de (−80, −30) → (−80, −30), zoom
  inchangé. Clic [m1] ; Maj+clic [m1, m3] ; Ctrl+clic [m1] ; Ctrl+clic
  [m1, m3] ; clic [m1] ; cadre tiré dans le vide [m1, m3] ; Ctrl+cadre sur m3
  [m3].
- **Le tracé** : voir `musique_odio01.md` § 5 (ordre [mix, tone, fb], ce que
  garde la tuile à 55, 35, 15 %, Ctrl+Z / Ctrl+Maj+Z).
- **Le délai partagé** (projet « Batterie et basse » ; un câble tiré de la
  sortie de la batterie SUR le délai de la basse, à la souris) : chaînes
  `t1 [m1, m2]`, `t2 [m3, m5, m4]` → `t1 [m1, m5, m2]`, `t2 [m3, m5, m4]` ;
  le rack de la batterie montre le délai « lié · Basse », celui de la basse
  « lié · Batterie ». Le son (rendu hors temps réel, piste seule, énergie de
  la queue entre 0,45 et 2,2 s après la fin, délai mix 1, retour 0,72) :
  | | batterie seule | basse seule |
  |---|---|---|
  | avant le câble | −180 dB (pas d'écho) | −33,9 dB |
  | après le câble | **−35,2 dB** | −33,9 dB |
  | retour tourné à 0,27 dans le rack de la BATTERIE | −62,5 dB | **−50,7 dB** |
  | mix remis à 0 depuis la BASSE | −180 dB | −132,4 dB |
  Les échos de la batterie sont dans SON stem (la tranche de la basse y est
  muette) : la voix par piste est juste ; le réglage fait d'un côté change
  le son des deux.
- **Couleurs** : la barre de la piste Batterie → « corail » : l'étiquette du
  nœud (#e79b7c), la tuile (`--pc: var(--coral-2)`) et les deux fils de sa
  chaîne suivent ; la pastille du nœud → « acier » : la piste et son en-tête
  (`var(--cy)`) suivent ; Ctrl+Z rend « corail ».
- **Pistes** : clic sur l'en-tête de la Basse, Suppr → [t1] ; le délai
  partagé reste à la batterie (`t1 [m1, m5, m2]`) ; Ctrl+Z (AZERTY) → [t1, t2].
  « Voix 1 » glissée dans le tiers bas de la Batterie : trait affiché, rien
  d'entouré, fantôme « déplacer » → [t1, Voix 1, t2]. Glissée au cœur de la
  Basse : pas de trait, la Basse entourée, fantôme « grouper » → « Groupe 1 »
  [t2, Voix 1] ; replié (un seul en-tête de piste visible), Ctrl+Z le déplie ;
  menu du groupe (Replier, Renommer, Choisir ses pistes, Couleur de ses
  pistes, Défaire le groupe, Retirer ses 2 pistes) → défait, Ctrl+Z le refait ;
  Ctrl+Maj+G sur une de ses pistes le défait ; Ctrl+clic sur deux en-têtes
  [t1, t2], Ctrl+G : les deux groupées.
- **Panneau du bas** : zéro onglet ; deux parties, le clip puis la chaîne ;
  « Instruments et effets » défile jusqu'à la chaîne.
- **Clic droit** : 21 zones essayées (en-tête, voie, clip, règle, sections,
  panneau du bas, module du rack, barre, arc, fond du nodal, nœud de départ,
  effet partagé, étiquette, câble, borne, section de machine, jouet, segment,
  attracteur, lane du banc, console) : le menu du navigateur empêché partout,
  un menu d'ODIO partout sauf sur l'arc (le bouton droit y efface, voulu) ;
  dans un champ texte, le menu du navigateur reste.
- **Ctrl+Z en AZERTY** (`key: 'z'`, `code: 'KeyW'`) : une tuile déplacée
  (x 360 → 588 → 360, Ctrl+Y → 588), un attracteur déplacé (rendu à sa
  place), la molette d'un jouet (force 97 → rendue), un clip glissé (16 → 24
  → 16), une région générative (retirée, la piste reste) ; ↷ la rétablit ; le
  journal liste les gestes par leur nom.
- Les pilotes d'avant repassent : `nodal_essai.mjs` (25 tuiles, 107
  contrôles), `sr_odio_gen_drive.mjs` (menus lus sur `.sr-menu`, copie
  `sr_odio3_gen_drive.mjs` : toutes les étapes, aucun message d'erreur),
  `sr_jouets_gestes.mjs` (copie `sr_odio3_jouets_gestes.mjs`, la carte
  choisie par `app.nodal.choisir` : les quatorze jouets, le transport, les
  quatre qu'on traverse, le retour, le retrait par Suppr).
- `python3 tools/check.py` : 1026 passés, 0 en échec.

### Ce qui reste, ou n'est pas beau

- Le tracé sur une tuile ne voit que les réglages rendus : de loin, on ne
  trace que ce qui tient ; se rapprocher pour tracer plus.
- Les rangs du tracé couvrent le début du nom des réglages (comme ODIO_01).
- Les étiquettes de piste gardent leur taille à tous les reculs : sur une
  scène serrée et très dézoomée, elles se chevauchent.
- Les bus de retour sont des pistes : leur entrée porte aussi une étiquette.
- Un jouet que deux pistes traversent n'est pas dédoublé par piste (sa scène
  est un seul son) : un câble vers un jouet déjà dans une chaîne reste un
  câble simple.
- Le banc ne choisit qu'un attracteur à la fois (ODIO_01 aussi).
- Une chaîne à branches parallèles (un effet en dérivation) se lit dans
  l'ordre du trajet ; « ← → » du rack la remettent en série.
- La palette des pistes a sept jetons (`COLORS`, `server/tools/music.py`) ;
  plus de couleurs demanderaient des jetons dans `commun/tokens.css`.

## Détecter le tempo d'un clip audio (05/10/2026)

Cal : « ça serait top d'avoir le BPM detector dans audio sur une piste audio
qu'on a importée ». Clic droit sur un clip audio → **Détecter le tempo** : un
tiroir dit le tempo (et ± son incertitude), la confiance, la première
pulsation, le premier temps fort, dessine la grille sur la forme d'onde,
fait écouter le son avec un clic par temps ; on corrige (÷ 2, × 2, saisie,
le « 1 » avec ‹ ›) ; **Appliquer** règle le tempo du projet sur celui du son
(ou le clip sur celui du projet, Re-Pitch) et/ou cale le clip (son début sur
le temps fort, posé sur la barre de mesure la plus proche ; ce qui précède
reste derrière la poignée gauche). Un seul Ctrl+Z défait tout.

- Calcul **dans la page** (`musique/tempo.js`, module pur ; `bpm.js` le
  tiroir) sur le son que le moteur a déjà décodé, rééchantillonné à 11 025 Hz
  mono par un `OfflineAudioContext` : 30 s en ~0,2-0,3 s, 3 min en ~1,3 s. Le
  serveur (bibliothèque standard) n'a pas de FFT. La méthode et ses sources
  (Percival & Tzanetakis 2014 ; Ellis 2007 et librosa ; Davies & Plumbley
  2006 ; Goto 2001 ; Lerdahl & Jackendoff 1983 pour l'alternance) sont en tête
  de `tempo.js` ; ce qui est « notre règle » y est dit.
- Essais (`server/tools/music_tempo.py`, selftest : clics écrits par `wave`,
  lus par le module de la page sous node) : 90, 120, 128, 174 BPM, droits et
  swing, 60 (l'octave 60/120), 174 en noires seules (87/174), 140 swing dans
  du bruit : tempo à ± 0,01, proposé à l'entier, première pulsation à ± 1 ms,
  temps fort juste, confiance 1,00 ; 3 s et un silence refusés.
- Sur de la musique (exemples de librosa, non versionnés) : « Choice » 68,0
  (librosa : 136 ; la grille à 136 alterne fort / faible, rapport 0,26 — la
  page propose × 2), « Vibe Ace » 65,0 (× 2 « tout aussi plausible »), une
  valse à 150,0, un orchestre au tempo libre et une caisse claire qui
  accélère à confiance ~0,05 et ~0,02.
- Reste : le temps fort est une estimation (la page le dit) ; pas d'étirement
  sans changer la hauteur dans ODIO, donc pas de « warp » ; le résultat n'est
  pas gardé dans le projet (refait en moins d'une seconde).

## Les craquements (06/10/2026)

Cal : « j'ai noté plein de craquements à un moment dans un morceau… les cracks
typiques du buffer pas assez grand, et le logiciel se ralentit et des cracks
sont entendus : corrige ça. »

### Comment on a mesuré

Le banc (scripts hors du dépôt, `/tmp/sr_odio-craquements/essais/`) : le portail
d'essai, le départ « Session » plus quatre pistes audio de deux minutes faites
par ffmpeg (WAV 16 et 24 bits, MP3, FLAC), huit effets dessus (égaliseur,
compresseur, réverbération, délai, distorsion, Filtre drive, Réverbe, Chorus),
une piste Numérique (Plaits, donc un AudioWorklet), l'arrangement triplé
(11 pistes, 55 clips). Chromium 141 sans affichage (rendu logiciel), une machine
de 4 cœurs partagée avec d'autres agents (charge 3 à 6). On joue 30 à 45 s et
on relève :

- les **pertes du rendu** : `AudioContext.playoutStats` (Chromium, derrière
  `--enable-blink-features=AudioContextPlayoutStats` ; `fallbackFramesEvents`
  et `fallbackFramesDuration` : ce que la carte a joué faute de son prêt).
  Vérifié d'abord sur un worklet qu'on surcharge exprès : il les compte ;
- l'**avance de l'ordonnanceur** à chaque réveil (`P.ct − currentTime`), les
  écarts du minuteur du Worker et la livraison de ses messages ;
- le **fil principal** : tâches longues (PerformanceObserver), images,
  profils et traces Chromium (`devtools.timeline`).

Les chiffres bougent avec la charge de la machine : chaque essai alterne
l'avant et l'après, et deux essais contrôlés isolent les mécanismes.

### Les causes

1. **Le tampon de la carte son était le plus petit.** `latencyHint:
   'interactive'` : 10 ms (Chromium, `media/base/audio_latency.cc` : le tampon
   matériel ; 10 ms sous Windows en mode partagé). Avec un AudioWorklet dans le
   graphe, tout le rendu passe sur le « Realtime AudioWorklet thread » : un
   rappel toutes les 10 ms, 3,6 ms de travail en médiane, 6,9 ms au 99ᵉ
   centile, des pointes de 9 à 39 ms quand la machine est occupée. Chaque
   pointe au-delà du tampon est un trou : le craquement. Même code, seul le
   tampon changé : **18, 14 et 0 pertes** en 40 s à 10 ms, **0, 0, 0** à
   23 ms (« playback »). Web.dev (*Profiling Web Audio apps in Chrome*) donne
   le même remède contre un rendu irrégulier : un `latencyHint` plus grand.
2. **L'ordonnanceur posait des notes dans le passé.** 120 ms d'avance, un
   réveil toutes les 25 ms. Sous charge, le minuteur du Worker saute jusqu'à
   96-115 ms, la livraison au fil principal prend jusqu'à 133 ms, et une tâche
   longue (le saut de page de la tête, qui redessine les clips) jusqu'à 240 ms :
   des tranches planifiées jusqu'à **228 ms en retard**. La spécification dit
   ce qui suit : `start(when)` dans le passé part « immediately », et un temps
   d'automation passé est « clamped to currentTime » — l'attaque d'une
   enveloppe devient une marche (un claquement), un son part décalé, et toutes
   les notes en retard arrivent ensemble sur le rendu (une pointe de plus).
3. **Le fil principal travaillait pour rien** : 64 à 68 % occupé pendant une
   simple lecture. À chaque image, les vu-mètres changeaient de largeur (mise
   en page, peinture), la vue Clip relisait la largeur de son onde (une mise en
   page forcée : 1,1 s sur 25 s), la forme d'onde de la barre se refaisait
   entière ; et 1,5 s après chaque retouche, l'aperçu de la barre (un rendu
   hors temps réel du morceau entier, à pleine vitesse, avec ses propres fils
   de convolution et son worklet) tournait pendant la lecture.

Ce qui n'est pas en cause : le graphe lui-même (rendu hors temps réel : 26 à
31 % d'un cœur par tranche de 16 temps, aucun passage plus lourd que les
autres) ; le ramasse-miettes du worklet (141 ramassages mineurs en 57 s,
0,4 ms au plus) ; la lecture des analyseurs (40 ms sur 20 s) ; le décodage
(fait au chargement, jamais pendant la lecture).

### Les corrections (juste par construction)

- **`TAMPONS`** (`moteur.js`) et la préférence ODIO **« Tampon audio »**
  (`musique/prefs.json`, onglet ODIO des préférences), comme le « Buffer Size »
  de Live : *court* (« interactive », avance 120 ms : le réglage d'avant, pour
  jouer au clavier), *moyen* par défaut (« playback », 20 ms ; avance
  300 ms), *long* (50 ms ; avance 500 ms). Le navigateur arrondit (Chromium :
  un multiple du tampon matériel, 8192 images au plus) : la page dit ce
  qu'elle a obtenu (`baseLatency`, `outputLatency`). `latencyHint` ne se donne
  qu'à la création du contexte : en changer le refait (à l'arrêt ; pendant la
  lecture, à l'arrêt suivant), le graphe s'y reconstruit, les vues reprennent
  leurs analyseurs.
- **Rien dans le passé** (`Engine.tick`, `Engine.sauter`) : rien ne se pose à
  moins de 10 ms de l'horloge audio. Une tranche que le retard a dépassée est
  perdue plutôt que jouée en retard ; les sons qui y commençaient partent à
  leur place dans le son (`Graph.resume` avec `depuis` ; `fresh` numérique
  pour la Session), comme après un saut de la tête ; l'heure de chaque temps ne
  bouge pas, la tête reste calée. Un lancement de Session non quantifié passe
  par le rattrapage exact (`lancer`) : il n'attend pas toute l'avance. L'export
  pose ses tranches à la même avance (`engine.avance`) : ce qu'on entend reste
  ce qu'on exporte.
- **Des images légères** : vu-mètres (arrangement, Instruments, console, nodal)
  et tête de lecture (`commun/tete.css`) par `transform` sur leur propre
  calque (`will-change`) ; les vues lisent la mise en page avant que la
  position ne s'écrive ; la vue Clip garde la largeur de son dernier dessin ;
  la forme d'onde de la barre ne se refait que quand la tête change de
  demi-pixel ; l'aperçu de la barre attend l'arrêt de la lecture.
- La basse acide d'ODIO arrête à l'arrêt toutes ses voix planifiées, plus
  seulement la dernière (`PROVENANCE.md`) : avec plus d'avance, une note déjà
  posée aurait sonné après Stop.

### Avant / après (l'intégration du 06/10, 885ee72, contre ce code)

| essai | avant | après |
|---|---|---|
| lecture, arrangement, 45 s (×3) | pertes 1, 28, 12 | pertes 0, 0, 63 ¹ |
| la même, une retouche à 4 s (l'aperçu se refait) (×2) | pertes 3, 15 | 0, 0 |
| fil principal ralenti ×4 (CDP, un PC lent) (×2) | tâches longues 12,3 s et 6,4 s ; 7 et 4 tranches en retard (−72, −92 ms) ; pertes 0, 14 | tâches longues 4,5 s et 2,7 s ; aucune tranche en retard (marge ≥ 44 ms) ; pertes 34 ¹, 0 |
| des pointes sur le fil audio, 200 ms d'écart, 30 s : 8 / 12 / 20 ms | pertes 1 à 11 / 3 / **156** (1,56 s) | 0 / 0 / **0** |
| le fil principal bloqué 400 puis 700 ms pendant la lecture | 19 sons partis dans le passé (le pire −373 ms) | aucun ; 2 tranches rattrapées ; la tête à 0 ms de l'horloge |
| occupation du fil principal (profil, 25 s) | 64 % ; `frame` de la vue Clip 1 126 ms, de l'arrangement 467 ms | 52 % ; 18 ms et 80 ms |
| vue Session, 30 s ; nodal, 30 s | pertes 0 ; 3 | 0 ; 1 |

¹ Deux passages pendant une forte charge de la machine (le minuteur du Worker
sautait à 105-116 ms) : 20 ms ne suffisent pas toujours sur une machine
saturée par d'autres programmes. C'est le cas du réglage *long*.

Après la fusion des arcs du projet (`arcs.js`, l'étage de la Sortie), les mêmes
essais avec **tous les arcs actifs** (saturation, filtre, largeur, volume, les
deux envois, l'énergie ; des courbes sur tout le morceau), l'intégration
d4936ff contre ce code :

| essai, arcs actifs | avant | après |
|---|---|---|
| lecture, arrangement, 45 s (×3) | pertes 0, 4, 4 ; 1 et 2 tranches en retard (−19, −40 ms) | pertes 0, 0, 0 ; aucune tranche en retard |
| la même, une retouche à 4 s (×2) | pertes 3, 0 | 0, 0 |
| fil principal ralenti ×4 (×2) | tâches longues 6,9 s et 7,4 s ; 2 et 2 tranches en retard (−98, −72 ms) ; pertes 0, 2 | tâches longues 3,9 s et 2,6 s ; aucune tranche en retard ; pertes 12 ¹, 0 |
| pointes de 20 ms sur le fil audio | pertes 158 (1,58 s) | 0 |
| le fil principal bloqué 400 puis 700 ms | 19 sons dans le passé (le pire −362 ms) | aucun ; 2 tranches rattrapées |
| une boucle de 4 temps, un clip audio au temps 1, huit blocages de 600 ms | 4 départs du clip dans le passé (jusqu'à −320 ms), chacun du début du son | aucun ; 9 tranches rattrapées ; les 4 départs repris à leur place dans le son, 10 ms devant l'horloge |
| un clip de Session lancé sans quantification, en lecture | il part 120 ms après le geste (l'avance) | 33 ms après (le rattrapage exact), malgré 300 ms d'avance |
| l'export de 8 temps (`renderMix`, tranches à `engine.avance`) | crête −9,6 dBFS | −9,8 dBFS (les caisses sont du bruit tiré au hasard) |

L'étage des arcs ne coûte rien de notable : le réveil de l'ordonnanceur prend
0,6 ms au 95ᵉ centile avec ou sans lui (deux passages chacun, aucune perte), et
le rendu hors temps réel du projet prend 22 à 31 % d'un cœur sans lui, 24 à
31 % avec (deux passages chacun, par tranche de 16 temps). Ses rampes
enchaînées (`arcs.js`, `rampe`) prennent le rattrapage comme un saut : la
tranche qui suit une tranche perdue repart de la valeur présente en 6 ms,
sans rien poser dans le passé.

### Ce qui reste

- Chromium refait la mise en calques (« Layerize ») à chaque image, même quand
  seuls des `transform` changent : 3,6 à 5 ms par image en rendu logiciel,
  chaque toile de clip étant un calque. À voir sur la machine de Cal (rendu
  par la carte graphique).
- Plaits pose ses réglages « maintenant » (`setParameter`, code d'ODIO_01) :
  automatisés, ils arrivent l'avance du tampon plus tôt que leurs notes (l'export
  fait de même : `engine.avance`).
- `playoutStats` n'est pas allumé par défaut dans Chromium : la page ne peut pas
  compter ses pertes chez Cal ; le banc le fait (drapeau).
- Cal : écouter un vrai morceau chargé sur son PC, en *moyen*, puis en *long*
  si un craquement reste.

## Le panneau du bas en deux tailles (06/10/2026)

Cal, avec une capture (≈ 2000 × 1090) : « Les trucs de MIDI piano prennent énormément de place
dans notre interface. Il faut qu'on ait un mode plus petit et qu'on puisse le mettre en grand,
car là c'est juste trop chiant de scroller jusqu'en bas pour voir les racks etc. »

**Avant** (mesuré dans Chromium, un clip d'une note do5 sur une piste Macro, le panneau à sa
hauteur d'office, 300 px) : la colonne du bas (29/09, « tout avec un scroll ») tenait le piano
roll **entier** — 85 rangées de 12 px, **1 020 px** — puis la chaîne ; à 2000, 1920 et 1280 px
de large, **0 px de la chaîne** visible sans défiler. La vue Clip de la Session avait le même
défaut (1 020 px dans une boîte de 330).

### Ce que fait Live 12 (les pages d'Ableton sont bloquées depuis le conteneur : citées par l'extrait du moteur de recherche)

- **Les deux vues ensemble** : « stack Live's Clip and Device Views », la vue Clip au-dessus
  de la vue Appareils, par les bascules à côté des sélecteurs ; Ctrl+Alt+3 et Ctrl+Alt+4
  montrent ou cachent l'une ou l'autre ([nouveautés de Live 12](https://www.ableton.com/en/live/all-new-features/)).
- **Maj+Tab ou F12** : « Toggle Device/Clip View » ; Ctrl+Alt+L montre ou cache le bas
  ([raccourcis de Live 12](https://www.ableton.com/en/manual/live-keyboard-shortcuts/)).
- **En grand** : « Clip View can be toggled to its maximum height using the Ctrl Alt E […]
  or the Expand Clip View entry in the View menu » ; le filet entre la vue et le bas se
  tire ([« Editing MIDI »](https://www.ableton.com/en/live-manual/12/editing-midi/)).
- **Replier** : « Fold to Notes […] immediately hide all key tracks that do not contain MIDI
  notes », par le bouton Fold ou la touche F ; « Fold to Scale » ne garde que les rangées de
  la gamme, et les notes hors gamme restent visibles (même page).
- **Cadrer** : « Fit Content to View Height: H », « Fit Content to View Width: W » ; la
  molette dans la règle des notes change d'octave, Alt+molette la hauteur des rangées (même
  page).

### Ce qui est fait (`editeurs.js`, `musique.css`, `musique.js`, `timeline.js`, `session.js`)

- **Compact, d'office** : le clip et la chaîne dans la hauteur du panneau, chacun défile chez
  lui. **Côte à côte** dès que le panneau a 960 px de large (le clip à gauche, 52 %, au
  moins 440 px ; la chaîne à droite), sinon l'un sous l'autre. Choix d'ODIO : Live empile ;
  Cal veut le clip à gauche et la chaîne à droite (« comme le bas de Live »), ce que nos
  écrans larges permettent.
  - Le piano roll a sa hauteur bornée et défile chez lui ; ses rangées sont plus basses
    (10 px, Ctrl+molette les règle, gardées à part : `ui.ed.rhc`) ; **il se cadre** sur ses
    notes à l'ouverture : des rangées assez basses pour que toutes tiennent avec quatre
    demi-tons de marge (jamais sous 7 px : on défile alors), centrées ; un clip vide :
    une octave autour de la tonique du projet, à l'octave du do central.
  - Les deux barres (le motif, les outils) n'en font qu'une, qui passe à la ligne ; l'aide
    du bas se tait ; la voie des vélocités fait 26 px.
  - La chaîne garde son en-tête en haut ; la rangée des modules défile dans les deux sens.
  - La batterie : des cases de 14 px (les onze voix de la boîte à rythme tiennent). Le clip
    audio : l'onde en tête, sur toute la largeur, ses réglages en rangée dessous.
- **Grand** : « Agrandir » (en-tête du panneau, menu du clic droit) ou **Ctrl+Alt+E**, le
  raccourci de Live : le panneau à sa hauteur maximale, le clip le remplit, la chaîne suit
  dessous (la colonne d'avant). « Réduire » ou Ctrl+Alt+E le remet. L'état est retenu par
  projet (`ui.dockGrand`) ; **chaque taille garde sa hauteur** (`ui.dockH`, `ui.dockHg`) :
  le filet tiré en grand ne change pas le compact.
- **Replier** (Live : Fold) : « non », « gamme » (les rangées de la gamme, plus celles des
  notes hors gamme), « notes » (seulement les hauteurs jouées) ; replié, chaque rangée dit
  sa note, une note se déplace de rangée en rangée et les rangées suivent les notes
  (transposées, ôtées). **Cadrer** (Live : H). Les touches F et H, comme dans Live, quand le
  clavier de l'ordinateur ne joue pas (ses lettres sont alors des notes).
- **La vue d'un motif est retenue** (le défilement et la hauteur des rangées) : un redessin
  (une retouche, « Doubler ») la rend telle quelle ; un autre motif se cadre.
- Maj+Tab, F12, Ctrl+Alt+3 et 4 restent : en compact, aller à la chaîne la ramène à son
  début. Une région générative y montre ses versions en cartes (183 px), la chaîne à côté ;
  « Génération · Son de la prise » reste en tête.
- **La vue Clip de la Session** prend l'éditeur compact : il tient dans sa boîte.

### Après (Chromium, deux thèmes, sans erreur console ; captures `/tmp/odio_compact/`)

| fenêtre | arrangement visible | le clip (piano roll) | la chaîne visible |
|---|---|---|---|
| 2000 × 1090 | 610 px | 264 px (154) | 264 px, trois modules |
| 2000 × 900 | 420 px | 264 px (154) | 264 px |
| 1920 × 1080 | 600 px | 264 px (154) | 264 px |
| 1280 × 1100 | 552 px | 264 px (124) | 264 px |
| 1280 × 900 | 352 px | 264 px (124) | 264 px |

Le clip d'une note s'ouvre centré sur do5 ; replié sur les notes, deux notes donnent deux
rangées (do5, sol5) ; « Doubler » garde le défilement ; en grand, 780 px de panneau à 1080 de
haut ; la vue Clip de la Session : 146 px de piano roll dans sa boîte de 330 (avant : 1 020).

### Reste

- Le panneau d'office fait toujours 300 px : le piano roll compact y a 124 à 154 px
  (Cal parlait de 160 à 240 pour l'éditeur ; le nôtre, barre et vélocités comprises, en fait
  264). Tirer le filet suffit, et la hauteur reste ; changer celle d'office : à Cal.
- Le module Macro fait 1 900 px de large, le Synthé environ 2 800 (`odio_synthes.md` § 6) :
  dans la colonne de la chaîne, on n'en voit que le début.
- Live zoome les rangées en tirant la règle des notes, et cadre la largeur (W) : pas fait.
- Le bas de la Session (la console ou la vue Clip) n'a pas d'« Agrandir ».
