# ODIO — un clip en calcul, la structure des paroles, les arcs du projet (06/10/2026)

Les demandes de Cal du 06/10 sur ODIO (branche `wip2/odio-arcs-session`). La
quatrième, la Session (les retours à côté de la Sortie), est dans
`odio_session.md` § 7.

| | |
|---|---|
| en calcul | `musique/calcul.js`, `musique/calcul.css` ; une ligne dans `timeline.js` (clipEl) et `session.js` (cellOf) |
| la structure | `musique/projet.js` (« la structure ») ; `musique.js` (app.commit → suivreStructure) ; `timeline.js` (la règle) ; `musique/arcs.css` |
| les arcs | `musique/arcs.js` (définitions, l'étage du moteur) ; `projet.js` (le format, la migration) ; `moteur.js` (cinq lignes) ; `timeline.js` (le groupe) ; `server/tools/music.py` (validation, selftest) |

## 1. Un clip en calcul

Cal : « Quand un segment est en calcul dans ODIO, on voudrait un retour visuel
qui pulse ou change de couleur, un effet visuel élégant pour dire que ça
calcule ; la piste juste avec des hachures, ce n'est pas suffisant. »

**Avant** : une région générative sans prise se dessinait en hachures sur sa
toile (`generatif_region.js` drawRegion), avec « EN COURS… » en petit quand un
travail l'attendait — lu au moment du dessin, jamais remis à jour. Un clip
qu'on sépare en pistes ou dont on extrait le MIDI ne montrait rien.

**Fait** : `calcul.js` lit les travaux du projet (`P.pending` : `{ job, kind,
clip, … }`) dans le relevé de la file (`jobs.watch`, toutes les 1,5 s : `state`,
`progress`, `message`, `ahead`, `eta_s` — ARCHITECTURE § 3) et pose sur la
boîte du clip visé une couche :

| état | ce qu'on voit |
|---|---|
| en file | une lueur acier qui respire lentement (3,6 s) ; « génère · en file · 2 devant · départ ≈ 4 min » |
| en cours | la lueur plus vive (2,4 s), un balayage lumineux qui traverse le clip, la vraie progression (une barre de 3 px en bas, `scaleX`, glissée en 0,9 s) quand le travail la donne, l'étape (son `message`) ; sans progression, le balayage seul |
| échec | l'ambre (`--amb`, `--line-amb`), fixe ; « échec · sépare en pistes · <la raison> » ; × l'efface (il reste jusque-là, dans la page ; la file garde le travail et sa raison) |
| fini | la couche part, net ; la toile de la région se redessine (« mu:calcul ») |

Le clip visé : la région qui génère (`takes`) ou dont la partition s'écrit
(`abc`), le clip qu'on sépare (`stems` : `pd.clip.clip`) ou dont on extrait le
MIDI (`midi`). En Session, aucun travail ne part d'une case : une case dont le
son est celui qu'on sépare ou transcrit montre le même état. Le tiroir
« Générer » (un morceau entier) n'a pas de clip. Arrêté par la personne : la
couche part (ce n'est pas un échec) ; interrompu (le portail redémarre) : échec.

Le langage est celui du portail pour un rendu en cours (`commun/fil.css`,
`.fl-job` : l'acier qui travaille, l'ambre pour l'échec). Seuls `opacity` et
`transform` s'animent (le compositeur) : aucune repeinte JS par image ; le
texte et la barre changent au relevé. Animations réduites (le système, ou
Préférences → Général) : la lueur fixe, ni souffle ni balayage.

## 2. La structure et les balises des paroles

Cal : « la STRUCTURE en haut de l'arrangement : vérifie qu'elle est juste (les
sections — Intro, Couplet, Refrain… — et leurs mesures), et rends-la
SYNCHRONISÉE avec les balises de structure des paroles ».

**Juste ?** Les sections de la session de la maquette (`music.py`, session) :
Intro 1-4, Couplet 5-8, Refrain 9-12, Final 13-16, en noires 0-16, 16-32… :
justes. Ce qui trompait : l'infobulle et le menu disaient « 01.1 → 05.1 », ce
qui laisse croire à la mesure 5. Ils disent maintenant « mesures 1 à 4 ·
4 mes. » (`timeline.js`, mesuresDe). La règle range ses sections dans l'ordre
du temps.

**LE CONTRAT** (pour le panneau génératif, `generatif*.js` — un autre chantier) :

- les **sections** vivent dans le projet : `p.sections [{ id, name, a, b,
  color, tag }]`, en noires. C'est le plan que la génération envoie déjà
  (`generatif_region.js`, sectionsFor → `[[étiquette, mesures]]`) ;
- les **paroles** d'une région vivent dans `c.gen.v.lyrics` : des blocs ouverts
  par une ligne « [Étiquette] » seule (YuE : « structure labels (e.g., [verse],
  [chorus], [bridge], [outro]) prepended », README ; ACE-Step : « [Verse] ») ;
- le lien est l'**ordre** : le i-ème bloc ↔ la i-ème section que la région
  couvre (tout recouvrement : la règle de `covered`) ;
- **le panneau n'a rien à appeler** : il écrit `c.gen.v.lyrics` puis
  `app.commit`, comme aujourd'hui ; `musique.js` tient la structure à chaque
  geste (`suivreStructure`, avec l'empreinte du geste d'avant). Un autre champ
  de paroles (le tiroir, une partition) appelle `structureDepuisParoles(p, c,
  uid, texte)` et `parolesDepuisStructure(p, c, texte)` (`projet.js`).

Les règles :

- des **paroles qui changent** replacent les sections de la région : autant de
  blocs que de sections couvertes → chacune prend l'étiquette de son bloc (et
  son nom, s'il suivait l'ancienne : « Couplet » devient « Refrain 2 ») ;
  sinon la plage de la région est replanifiée : un bloc, une section, des
  mesures entières, la même durée pour chacun (YuE : « each session is around
  30s », README — une durée par bloc, pas par vers) ; une section qui débordait
  de la région garde sa part au-dehors (coupée des deux côtés s'il le faut) ;
- des **sections qui changent** (étiqueter au menu, renommer, tirer, déplacer,
  retirer) ou une **région qui bouge** (déplacée, collée, dupliquée) récrivent
  les balises de ses paroles ; les vers restent ; une section de plus devient
  un bloc vide à la fin ; des blocs en trop restent tels quels (aucun vers ne
  se perd) ; le style des balises est gardé (bas de casse si toutes le sont) ;
- sans balise dans les paroles, rien ne bouge ;
- une seule annulation rend sections et paroles ensemble (le même instantané) ;
- pendant qu'on tape, seule la règle se refait (`timeline.js` paintRegle) : le
  champ garde la main ;
- une section tenue par des paroles montre son `[étiquette]` dans la règle,
  soulignée de sa couleur.

## 3. Les arcs du projet

Cal : « l'arc d'énergie doit être dans un groupe d'arcs ; on a le volume, mais
il en faut d'autres : réverbe et delay par exemple ; cherche d'autres ; et on en
fait un groupe par défaut qu'on peut replier en accordéon. »

### Le format

- `p.arc { on, to, pts }` reste l'**énergie**, telle quelle : une macro qui tient
  le filtre et le volume de la sortie (réglés par `arc_lo` et `arc_db` de la
  Sortie). Le banc du nodal la lit (lane ÉNERGIE), la console aussi.
- `p.arcs [{ id, k, on, pts }]` : les autres, dans l'ordre du groupe, un par
  sorte (`id` = « a » + la sorte). La Tension n'a pas de `pts` : sa courbe est
  celle du banc (`banc.ten`), une seule vérité.
- `p.ui.arcs { ouvert, peint }` : le groupe déplié, l'arc que sa rangée peint
  (pas un geste).
- Un projet d'avant garde son énergie et reçoit le groupe par défaut, vide
  (`projet.js` migrate) ; un projet neuf l'a du serveur (`music.py` _v2).
  `music.py` refuse une sorte inconnue, deux arcs de la même sorte, un point
  hors de 0..1, un « on » qui n'est pas vrai ou faux.
- Déplacer, dupliquer, échanger, retirer une section emporte les points des
  arcs comme ceux de l'énergie (`projet.js`, curves).

### Les arcs, leurs lois, leurs sources

| arc | défaut | ce qu'il tient | 0 · neutre · 1 |
|---|---|---|---|
| Énergie | oui | la macro d'avant (filtre et/ou volume de la sortie) | coupure basse / volume bas · — · ouvert, plein |
| Volume | oui | un gain de la sortie, −40 dB × (1 − v) | silence · 1 (0 dB) · 0 dB |
| Filtre | oui | un passe-bas de la sortie, 150 Hz → 20 kHz en octaves | 150 Hz · 1 · ouvert |
| Réverbe | oui | ce qui entre dans les retours de réverbération (Réverb, Réverbe ODIO), (2v)² | rien · ½ (l'envoi de la console) · +12 dB |
| Delay | oui | ce qui entre dans les retours de délai (Délai, RTT-01), (2v)² | rien · ½ · +12 dB |
| Largeur | + | la largeur stéréo de la sortie (milieu / côtés) | mono · 1 · stéréo |
| Saturation | + | une saturation douce de la sortie, tanh, sec / saturé | propre · 0 · tanh(4x) |
| Densité | + | rien ne sonne : le génératif la lit | · ½ · |
| Tension | + | la courbe du banc : le génératif la lit | · ½ · |

Les lois sont des choix de réglage (écrits dans `arcs.js`). Les sources du choix
des arcs :

- l'automation de Live : les commandes du mixeur et des appareils, la Sortie
  (Main) et les retours compris, ont leur enveloppe dans l'arrangement (chapitre
  « Automation and Editing Envelopes » — non relu ici, de mémoire) ;
- les Macros de Live : une commande qui en tient plusieurs, chacune entre un
  min et un max (Live 12, « Instrument, Drum and Effect Racks » : « each capable
  of addressing any number of parameters ») : c'est l'arc d'énergie ;
- la largeur : l'Utility de Live, « Width » de 0 (mono) à 100 % (stéréo) ; on
  l'automatise « on the master bus to hold back the full width until a chorus
  hits » (Live 12, « Live Audio Effect Reference ») ;
- la densité : l'« intensité » et la « complexité » des Session Players de
  Logic, automatisables (Apple, « Edit a Session Player performance » ; Sound On
  Sound, « Logic Pro: Session Players ») ; les « energy curves » des outils de
  composition (CMUSE, « Song Arrangement Builder » : « density, roles and
  dynamics » par section) ;
- énergie et tension : le canon d'ODIO_01, les deux courbes du banc ; devant la
  tête elles deviennent les étiquettes et les mots du style d'une région
  (`musique_generatif.md` § 6.3) ;
- **pas de tempo** : le moteur pose les notes à tempo constant (`at(b)`
  linéaire) et la Session se cale sur la tête ; une courbe de tempo demande
  d'intégrer le temps partout. Pas fait, par prudence.

### Le groupe

`timeline.js` (arcsRows) : la rangée du groupe, collée sous la règle (58 px) :
à gauche « Arcs », ▸ / ▾ (replier, déplier), l'arc qu'elle peint (un menu), le
rallumer, « + » ; à droite la toile, qui peint cet arc par-dessus les autres,
pâles. Dépliée : une rangée par arc (46 px, comme l'automation), sa couleur, ce
qu'il tient (« envoi → Réverb »), sa valeur à la tête, Actif / Éteint, son menu
(effacer, à plat au neutre, la rangée du groupe le peint, monter, descendre,
retirer ; l'énergie : ce qu'elle tient, « Suivre les sections », tout à fond ;
un envoi sans retour : « Ajouter un retour »). Chaque geste passe par
`app.commit` : Ctrl+Z le reprend.

### Le moteur

`moteur.js`, cinq lignes (le chantier des performances du moteur est ailleurs) :
l'étage des arcs dans la Sortie (après l'arc d'énergie, avant les analyseurs) ;
un gain à part à l'entrée de chaque retour (`busIn` : `arc`) ; `configurerArcs`
dans `sync`, `planifierArcs` dans `automate`, `poserArcs` dans `settle`. Le
reste est dans `arcs.js` :

- l'étage ne porte que les arcs peints et allumés (un projet sans arc de largeur
  ne paie pas sa matrice) ;
- une tranche qui continue la précédente n'enchaîne que des
  `linearRampToValueAtTime` ; un départ, un saut, la première tranche d'un arc
  neuf partent de la valeur présente (un seul `setValueAtTime`) et rejoignent la
  courbe en 6 ms ; la boucle qui revient : une rampe de 6 ms ; un arc éteint ou
  vidé en lecture rejoint son neutre en 6 ms ; l'export (OfflineAudioContext,
  tranches dans le désordre) pose le départ de chaque tranche ;
- à l'arrêt, chaque réglage glisse (12 ms) vers la valeur de son arc à la tête.

Pour le génératif : `valeursArcs(p, a, b)` (`arcs.js`) rend la moyenne de chaque
arc sur une plage (`{ energie, volume, filtre, reverb, delay, largeur, satur,
densite, tension }`, un arc éteint ou vide valant son neutre).

## 4. Essais (Chromium sans affichage, portail d'essai, deux thèmes, sans erreur console)

- en calcul : la file interceptée (un travail factice) — en file, en cours à 30
  puis 70 %, fini, une séparation sans progression, un échec, la case de Session
  du même son, × qui efface, animations réduites (18 contrôles) ;
- la structure : 13 contrôles unitaires (node) ; les paroles tapées dans le
  champ de YuE2 « Chanson » posent Couplet 5-7, Refrain 8-10, Pont 11-12 ;
  « Final » au menu d'une section récrit `[outro]` ; Ctrl+Z rend les deux ; la
  région déplacée récrit ses balises ; enregistré et relu ;
- les arcs : replier / déplier ; peindre un arc de réverbe, Ctrl+Z et
  Ctrl+Maj+Z ; l'AudioParam de l'envoi du retour Réverb espionné : (2 × 0,974)² =
  3,79 en lecture, 1 `setValueAtTime` puis 49 rampes ; la boucle qui revient :
  une rampe, aucune valeur posée ; l'étage de la sortie (volume, largeur mono) ;
  l'export ; « + » Densité ; un projet d'avant migré, le banc lit toujours
  l'énergie ; `check.py music` : 73 / 0 ;
- la Session : `odio_session.md` § 7.

## 5. Reste, questions pour Cal

- Les lois des arcs (−40 dB, 150 Hz, +12 dB, tanh) sont des choix : à essayer à
  l'oreille.
- La Densité et la Tension ne font pas de son : le panneau génératif doit lire
  `valeursArcs` (le chantier du génératif).
- Un arc d'envoi tient tous les retours de son genre ; viser un retour précis
  (`bus` sur l'arc) n'est pas fait.
- Pas d'arc de tempo (ci-dessus).
- L'échec d'un calcul ne survit pas au rechargement de la page (la file le
  garde).
- Une région dont les paroles ont plus de blocs que de mesures : les blocs en
  trop n'ont pas de section.

## Sources

- YuE, README (« structure labels […] prepended », « each session is around
  30s ») : https://replicate.com/fofr/yue/readme
- Live 12, « Instrument, Drum and Effect Racks » (Macro Controls) :
  https://www.ableton.com/en/manual/instrument-drum-and-effect-racks/
- Live 12, « Live Audio Effect Reference » (Utility, Width) :
  https://www.ableton.com/en/manual/live-audio-effect-reference/
- Logic Pro, « Edit a Session Player performance » :
  https://support.apple.com/en-bh/guide/logicpro/lgcp74b34026/mac ; Sound On
  Sound, « Logic Pro: Session Players » :
  https://www.soundonsound.com/techniques/logic-pro-session-players
- CMUSE, « Song Arrangement Builder » (energy skyline) :
  https://www.cmuse.org/song-arrangement-builder
- MDN, AudioParam (setValueAtTime, linearRampToValueAtTime, setTargetAtTime,
  cancelScheduledValues).
