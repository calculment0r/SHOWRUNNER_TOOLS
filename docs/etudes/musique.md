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
| planification sur `AudioContext.currentTime`, réveil toutes les 25 ms, 120 ms d'avance, minuteur dans un Worker | MDN, *Advanced techniques: Creating and sequencing audio* ; *A Tale of Two Clocks* (Chris Wilson) |
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
  couleurs des lanes sont des jetons voisins de celles d'ODIO_01 ; les vraies
  demanderaient cinq jetons dans `commun/tokens.css`.
- Un segment de 40 px ne montre qu'une ligne d'opérateur (comme dans
  ODIO_01) ; zoomer le banc en montre plus.
- La touche « c » bascule les têtes dans le nodal (ODIO_01) : là, elle ne
  règle plus la vélocité du clavier.
