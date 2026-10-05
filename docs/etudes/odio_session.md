# ODIO — la vue Session (le lanceur de clips de Live) (05/10/2026)

Demande de Cal, mot pour mot : « notre partie CONSOLE de ODIO devient la partie
Scène d'Ableton : un launchpad avec la même logique et les mêmes outils que ceux
d'Ableton ».

**Statut (06/10)** : REFAITE sur la parole de Cal du 05/10 au soir (§ 6) —
une couche vierge par-dessus l'arrangement, ses propres voies, Tab, « Envoyer à
la Session », la bibliothèque du projet. Les § 1 à 5 décrivent la première
version (05/10) : ce qui y parle d'une colonne par PISTE, de la piste qui
quitte l'arrangement et du « Retour à l'arrangement » ne vaut plus (§ 6).
Essayé dans Chromium sans affichage (portail d'essai, données jetables) : deux
pilotes, sombre et clair, sans erreur console (§ 6, « Fait »).

| | |
|---|---|
| la vue | `musique/session.js`, `musique/session.css` (l'onglet « Session », clé de vue `console`) |
| la console | `musique/console.js` fabrique les tranches (`createMixer`) d'une piste, d'un bus ou d'une voie ; la vue Session les range en groupes |
| le moteur | `musique/moteur.js` : `Engine.sess` (voie → clip), `lancer`, `echeances`, `finPrise` ; `Graph.scheduleSession`, `Graph.cut`, `Graph.mutes` sur les voies ; l'export sans la Session |
| le format | `musique/projet.js` (`voies`, `scenes`, `slots`, `launch`, `biblio`, `QUANTS`, les gestes de scène et de voie, la migration) ; `server/tools/music.py` (`_voies`, `_session`, `_biblio`) ; `server/tools/elements.py` (`slots[].item`, `biblio…` dans `ID_FIELDS`) |
| la bibliothèque du projet | `musique/biblio.js` (Envoyer à la Session, les clips du projet en case ou en clip) ; `musique/navigateur.js` (la rubrique « Projet ») |
| le branchement | `musique/musique.js` (Tab, `app.voie`, `app.owner`, `app.versSession`, la prise au clavier et en MIDI, `retenirSons` à chaque geste, les origines des sons) ; `musique/timeline.js` (les menus, l'onglet) ; `musique/guide.js` |

## 1. Les sources

Le manuel de référence de Live 12 : chapitres **7. Session View**
(ableton.com/en/live-manual/12/session-view), **16. Launching Clips**
(ableton.com/en/live-manual/12/launching-clips) et **18. Mixing**
(ableton.com/en/live-manual/12/mixing).

**Le réseau de la session de travail refuse ableton.com** (le proxy répond 403
à la connexion) : les pages n'ont pas pu être lues en entier. Ce qui est sourcé
vient des extraits du manuel que rend la recherche web (cités ci-dessous entre
guillemets), et le reste de ce que je sais de Live 12 — c'est dit à chaque fois.
À relire sur le manuel quand le réseau le permet.

Extraits du manuel (recherche web, 05/10) :

- Session View : « You can click on a square Clip Stop button to stop a running
  clip, either in one of the track's slots, or in the Track Status field below
  the Session grid. »
- Session View : « The Scene Launch buttons are located in the rightmost
  column, which represents the Main track. To launch every clip in a row
  simultaneously, click on the associated Scene Launch button. »
- Session View : « The scene below a launched scene will automatically be
  selected as the next to be launched unless the Select Next Scene on Launch
  option in the Launch Settings is set to "Off." »
- Back to Arrangement : « This button lights up to indicate that one or more
  tracks are currently not playing the Arrangement, but are playing a clip from
  the Session instead. » ; « You can click this button to make all tracks go
  back to playing the Arrangement. » ; chaque piste a aussi le sien dans la vue
  Arrangement.
- Launching Clips, Launch Mode : « Trigger (down starts the clip; up is
  ignored), Gate (down starts the clip; up stops the clip), Toggle (down starts
  the clip; up is ignored, and the clip will stop on the next down), and Repeat
  (as long as the mouse switch/key is held, the clip is triggered repeatedly at
  the clip quantization rate) ».
- Launching Clips : « The Clip Quantization chooser lets you adjust an onset
  timing correction for clip triggering. »
- Mixing : les retours (return tracks) et le Main « cannot play clips » ; ils
  occupent la droite du mixeur de la vue Session ; Solo, Arm, Track Activator
  (muet) par piste.

De mémoire (non relu ici) : la liste des quantifications de Live (None, 8 Bars,
4 Bars, 2 Bars, 1 Bar, 1/2, 1/2T, 1/4, 1/4T, 1/8, 1/8T, 1/16, 1/16T, 1/32 ; 1 Bar
par défaut) ; un set neuf a huit scènes ; un clip qui attend son départ
clignote ; une piste armée montre des boutons de prise dans ses cases vides ;
double-clic sur une case vide d'une piste MIDI = un clip MIDI vide ; une case
vide porte un bouton Stop ; lancer un clip à l'arrêt lance la lecture ; arrêter
la lecture arrête les clips ; le champ d'état d'une piste montre un camembert
pour un clip qui boucle ; « Insert Scene » (Ctrl+I), « Capture and Insert
Scene » (Ctrl+Maj+I) ; une scène peut porter un tempo.

## 2. Le modèle retenu

- **Une grille** : une colonne par piste (batterie, synthé, échantillonneur,
  audio), une ligne par **scène**. Une case tient au plus un clip. Les bus
  (retours) n'ont pas de cases, comme les return tracks de Live.
- **Un clip de Session boucle** sur sa longueur. Il garde tous les champs d'un
  clip de l'arrangement (motif et décalage ; son, départ, gain, transposition,
  sens) — les mêmes lectures dans le moteur (`Graph.notes`, `Graph.audioClip`) :
  chaque tour de boucle est lu comme un clip d'arrangement qui commencerait là.
- **Une piste joue un seul clip à la fois.** Lancer un clip remplace celui qui
  joue sur la piste ; la piste **quitte l'arrangement** (Live) : ses clips
  d'arrangement se taisent jusqu'au **Retour à l'arrangement** (tout de suite,
  toutes les pistes ; ou une piste, par son menu). Arrêter une piste (son bouton
  Stop, ou une case vide d'une scène lancée) la laisse muette, hors de
  l'arrangement — le « (or nothing at all) » de Live.
- **La quantification globale** du lancement (en tête de la vue ; 1 mesure par
  défaut) : un départ, un arrêt, une scène partent au prochain pas de cette
  grille. Elle est **calée sur la tête de lecture** : une mesure de la Session
  est une mesure du morceau. Chaque clip peut avoir la sienne (« Globale » par
  défaut), comme dans Live.
- **Les modes de lancement** de Live, par clip : Déclencher (Trigger, le
  défaut), Porte (Gate), Bascule (Toggle), Répéter (Repeat).
- **Les scènes** : lancer une scène lance chaque clip de sa ligne et arrête les
  pistes dont la case est vide ; la scène d'en dessous est choisie ensuite
  (Select Next Scene on Launch) ; une scène peut poser son **tempo** ; insérer
  (Ctrl+I), dupliquer (Ctrl+D), capturer (les clips qui jouent, dans une scène
  neuve), monter, descendre, retirer ; **Arrêter tous les clips** en bas de la
  colonne.
- **Les états** d'une case : vide (le carré Stop ; le rond de prise si la piste
  est armée), clip arrêté (sa couleur, son nom, sa longueur en mesures), clip
  qui joue (triangle vert, case plus franche, barre de progression), clip qui
  attend son temps (le triangle et le filet clignotent, au temps), prise (rond
  orange qui bat). Sous la grille, l'état de chaque piste : son bouton Stop (il
  clignote quand un arrêt attend), le camembert du clip et ses tours (« ×3 »),
  ou « arr. » quand elle joue l'arrangement.
- **La console** reste, dessous : la tranche de chaque piste sous sa colonne
  (inserts, envois, panoramique, muet, solo, armer, fader, vu-mètre), puis les
  bus et la sortie sous la colonne des scènes (Live, « Mixing »). Elle se cache
  (« Console ») ; à sa place, la **vue Clip** du clip ouvert (double-clic) : le
  piano roll ou les pas d'ODIO (`editeurs.js`, `patternEditor`, sans y
  toucher), ou pour un son sa forme d'onde, son gain, sa transposition, son
  départ ; et pour tout clip sa longueur, son mode, sa quantification, sa
  couleur.
- **Poser** : glisser un son ou un clip MIDI du panneau Asset (ou un fichier du
  disque) sur une case — `dropZone` de `commun/shell.js` : l'import dans la
  bibliothèque, la dernière version d'un élément, le rapatriement d'un autre
  Workspace ; plusieurs objets descendent d'une scène à chaque fois ; sur la
  colonne libre à droite, une piste neuve ; sur l'en-tête d'une piste, sa
  première case libre. Le navigateur d'ODIO (motifs, modèles, sons, MIDI)
  aussi. Glisser un clip d'une case à l'autre le déplace ; avec Ctrl (ou Alt),
  le copie ; vers une autre piste de même sorte, son motif est copié pour elle.
  Double-clic sur une case vide d'une piste MIDI : un clip MIDI vide d'une
  mesure ; d'une piste audio : un son de la bibliothèque.
- **Le clavier** : flèches (choisir une case, ou une scène dans la dernière
  colonne), Entrée (lancer la case ; une case vide arrête sa piste ; dans la
  colonne des scènes, lancer la scène), Suppr, Ctrl+D, Ctrl+R (renommer),
  Ctrl+C / X / V, Ctrl+I (insérer une scène). Espace reste la lecture.
  Capturer et insérer : le bouton « Capturer » ou le menu d'une scène
  (Ctrl+Maj+I est lu aussi, mais Chrome le garde pour ses outils de
  développement).
- **La prise de Session** : sur une piste de notes armée, le rond d'une case
  vide (ou Entrée) lance une prise, quantifiée ; ce qu'on joue au clavier de
  l'ordinateur ou en MIDI s'écrit dans un motif neuf ; presser la prise la finit
  à la fin de la mesure en cours, et le clip boucle sur cette longueur (16
  mesures au plus : un motif tient 256 pas). Une prise vide ne laisse rien.
- **Vers l'arrangement** : copier une scène dans l'arrangement à la tête de
  lecture (au début de sa mesure) — chaque clip y devient autant de clips bout à
  bout qu'il faut pour remplir la scène — ou toutes les scènes à la suite.

## 3. Ce qui est adapté à ODIO

- **Pas de warp.** Live cale un son au tempo ; ODIO ne le fait pas (la
  transposition change la vitesse, comme le mode Re-Pitch). Un son posé en
  Session prend une longueur arrondie à la mesure (au temps sous la mesure) :
  la boucle se ferme sur la grille, le son s'arrête ou laisse un blanc.
- **L'horloge de la Session** (`Engine.play.ab`) : des noires qui suivent la
  tête mais ne reviennent jamais en arrière quand la boucle de l'arrangement
  revient ; les clips de Session y bouclent sans à-coup. Un saut de la tête ou
  un tempo changé garde la phase de chaque clip.
- **Le temps des départs.** Le moteur planifie l'avance du tampon (MDN, « A Tale of
  Two Clocks » ; 300 ms par défaut depuis le 06/10, 120 avant : `TAMPONS`,
  `docs/etudes/musique.md`, « Les craquements ») : un départ demandé juste avant
  la barre tombe derrière ce qui est déjà planifié ; s'il est encore à venir
  pour l'oreille, il est rattrapé à son instant exact (la piste est coupée là,
  le bout de clip manquant se planifie) ; sinon il part tout de suite, en
  gardant sa phase. Sans quantification, un clip part tout de suite par ce
  même rattrapage (au réveil suivant du minuteur, 25 ms au plus, et 10 ms de
  marge), et non plus au prochain instant libre, qui attendrait toute l'avance.
- **Couper une piste** (`Graph.cut`) : les sons lus s'éteignent en 6 ms, les
  notes tenues se relâchent (synthé, échantillonneur) ; les instruments d'ODIO
  reçoivent `allNotesOff` à l'instant voulu ; les coups de batterie, brefs,
  finissent seuls.
- **À l'arrêt**, lancer un clip ou une scène lance la lecture au début de la
  mesure de la tête (Live lance la lecture ; ici la grille reste alignée).
- **La prise audio** (le micro) reste dans l'arrangement (Rec, F9) : la case
  d'une piste audio armée le dit.
- **Ce qui s'annule** : tout geste sur le projet (poser, glisser, renommer,
  dupliquer, retirer, scènes, réglages d'un clip, quantification, prise) passe
  par `app.commit` et la pile commune ; un lancement, un arrêt, le retour à
  l'arrangement n'y sont pas (Live non plus) — c'est l'état de jeu du moteur
  (`Engine.sess`), pas le projet.
- **Ce qu'on exporte** reste l'arrangement (comme Live) : « Vers
  l'arrangement » y met une scène.

## 4. Le format du projet (version 2, champs facultatifs)

```
scenes  [{ id, name, bpm, color }]     les lignes, dans l'ordre ; name vide : le numéro
slots   [{ id, track, scene, len, … }]  un clip de Session (une case) ; len en noires
          + pat, off                    (piste de notes : le motif, de sa piste)
          + item, off, gain, fi, fo, pitch, rev, ls, llen   (piste audio)
          + name, color, mode (trigger|gate|toggle|repeat), q (une QUANTS, ou global)
launch  { q }                            la quantification globale : none, 8, 4, 2, 1,
                                         1/2, 1/2T, 1/4, 1/4T, 1/8, 1/8T, 1/16, 1/16T, 1/32
```

Le serveur refuse : deux clips dans une case, un clip d'un bus, une scène
absente, un motif d'une autre piste, une longueur nulle, un mode ou une
quantification inconnus, une scène en double, un tempo de scène hors de 20-300.
Un projet d'avant reçoit, à l'ouverture, huit scènes vides et la quantification
d'une mesure (`projet.js`, `migrate`). Les sons des clips de Session sont dans
`ID_FIELDS` (`elements.py`) : le garde du Workspace et le paquet les voient.

## 5. Ce qui reste

- Les actions de suite (Follow Actions), le Legato, la vélocité du lancement ;
  une tête de prise dans l'arrangement quand on lance la Session (Arrangement
  Record) ; la prise audio en Session.
- L'arrangement ne grise pas encore les pistes qui jouent la Session, et n'a
  pas son propre « Retour à l'arrangement » (`timeline.js`, à un autre agent).
- Le guide (`guide.js`) ne parle pas encore de la Session ni de ses touches ;
  Tab reste Arrangement ↔ Nodal (choix d'ODIO), Live y bascule Session ↔
  Arrangement.
- Glisser un clip de l'arrangement dans une case ; ranger les scènes à la
  souris ; un clip MIDI de plus de 256 pas n'entre qu'en partie dans une case.
- Relire les trois chapitres sur le manuel (le réseau l'a refusé ici).

## 6. La refonte demandée par Cal (05/10 au soir) — FAITE le 06/10

La parole de Cal, mot pour mot : « il faut que le Tab dans ODIO fasse aussi
passer au mode Session. On doit avoir un design mieux et centré, car tout est à
gauche, c'est nul. Et tu n'as pas compris aussi, car on fait ce mode Session
comme synchro sur ce qui est le temps etc., mais il est vierge et ne veut pas
reproduire les pistes de la partie arrangement. C'est vraiment un truc "marche
on top" pour lancer des trucs EN PLUS de ce qui avance dans la timeline de
l'arrangement. Mais dans la vue arrangement, on doit pouvoir éditer un clip et
en faire un truc qu'on envoie dans le mode Session. On devrait je pense avoir,
comme pour la vidéo, une bibliothèque projet pour ODIO pour pouvoir trouver
facilement tout ce qu'on fait dans cet environnement, non ? Si je prends un clip
et que je le découpe plusieurs fois différemment pour l'envoyer dans le mode
Session, je vais avoir 4/5 clips édités et raccourcis, donc cela va être
infernal d'avoir cela dans les assets généraux je pense. »

Ce qui change, et pourquoi : le modèle de Live (§ 2, une colonne par piste, la
piste qui quitte l'arrangement) n'est PAS ce que Cal veut. La Session devient
une couche par-dessus l'arrangement.

### Le modèle décidé

- **Les voies de Session** (`voies`, projet.js) : les colonnes de la Session, à
  elle, vierges dans un projet neuf (« + voie »). Une voie a la forme d'une piste
  (source : l'instrument pour le MIDI, le lecteur `player` pour le son ; tranche ;
  chaîne lue dans les câbles ; envois vers les bus de l'arrangement ; muet, solo,
  armer), mais vit dans `p.voies`, jamais dans `p.tracks` : l'arrangement, son
  export, ses en-têtes ne la voient pas, sans un seul filtre à écrire (juste par
  construction). Ses modules portent `voie` (pas `track`) ; ses motifs
  `track: <voie>`. `piste` : la piste dont elle est née (« Envoyer à la Session »).
- **Les deux jouent ensemble** : lancer un clip de Session n'arrête rien dans
  l'arrangement (plus de `hors`, plus de « Retour à l'arrangement ») ; chaque
  voie sort par sa tranche vers la sortie, mixée avec les pistes. Même horloge :
  tempo du projet, quantification calée sur la tête (`Engine.play.ab`), à l'arrêt
  lancer démarre le transport. Le solo est global (pistes et voies).
- **L'export reste l'arrangement** : le rendu retirera les voies et leurs modules
  (`sansSession`), pour qu'un solo de voie ne taise pas l'export.
- **Migration** : un projet de la première Session (`slots[].track`) → une voie
  par piste qui avait des clips de Session, copie de sa chaîne (source, effets
  hors jouets, tranche), de ses sorties et de ses envois ; ses motifs joués en
  Session copiés pour la voie ; la piste reste intacte (`convertirSlots`,
  `voieDePiste`, projet.js).
- **Envoyer à la Session** (clic droit sur un clip, ou sur une plage de temps ;
  glisser un clip sur l'onglet « Session ») : non destructif. Un son devient une
  RÉFÉRENCE (`refDeClip` : le même objet de la bibliothèque, son départ avancé,
  sa longueur, son gain, sa transposition) ; des notes, une COPIE du motif
  (consolidatePatterns sur le morceau). Dans la voie née de la piste (ou une
  neuve, ou une voie choisie), à la première case libre ; une plage sur
  plusieurs pistes → un clip par piste (un par morceau de son).
- **La bibliothèque du projet** (`biblio`) : dans le projet lui-même (pas un
  chutier par Workspace comme le Montage, `montage_projet.py`) parce que ses
  clips édités n'existent que dans ce projet et doivent suivre son annulation et
  sa validation. Elle s'ouvrira comme une rubrique « Projet », en tête du
  navigateur d'ODIO, qui sera aussi monté à gauche de la Session (le navigateur
  de Live est commun aux deux vues) : glisser vers la timeline ou vers une case.
  `clips` (les références et copies), `sons` (asset, import, prise, rendu,
  generation : `retenirSons` y fait entrer de lui-même tout son posé, et il y
  reste), `dossiers` (un niveau), « Révéler dans Asset » pour un son.
- **Tab** : Arrangement → Session → Nodal → Arrangement (Cal, 06/10 : « le Tab
  aussi pour passer entre nos trois onglets de travail »). Écrit ici le 05/10 :
  Maj+Tab à l'envers ; finalement **Maj+Tab garde Clip ↔ Instruments** (comme
  Live ; consigne du 06/10 : ne pas casser l'existant) — à confirmer par Cal.
- **Le design** : la grille centrée (colonnes de largeur fixe, la colonne des
  scènes collée à la grille), des cases plus grandes, un vide accueillant
  (« glisse un clip ici, ou + voie ») ; la console en bas : voies, pistes de
  l'arrangement, retours, sortie, en groupes (les envois des pistes n'ont pas
  d'autre console).

### Fait (06/10, branche `wip2/odio-session`)

- **Le moteur** : la Session joue par les voies, en plus de l'arrangement (plus
  de `hors`, plus de Retour à l'arrangement) ; un départ ou un arrêt ne coupe
  que le clip d'avant de la voie ; le solo est commun ; l'export et la forme
  d'onde de la barre se rendent sans la Session (`sansSession`).
- **Le serveur** : `voies`, `slots[].voie`, `slots[].ref`, `biblio` validés ;
  un clip de la Session d'avant (`track`) refusé en le disant ; le selftest
  (19 refus, la relecture, `closure_gaps`) ; `ID_FIELDS` voit la bibliothèque.
- **La vue** : la grille centrée (colonnes de 148 px, la colonne libre, les
  scènes collées, l'état des voies collé dessous), la Session vierge qui dit
  ce qu'elle est, le navigateur à gauche, la console en groupes ou la vue Clip
  (le bas se tire) ; + Voie (les mêmes instruments qu'une piste) ; le menu
  d'une voie (couleur, armer, muet, solo, un effet, sa chaîne dans le nodal,
  retirer) ; « Garder dans le projet » pour un clip de Session ; une scène vers
  l'arrangement va sur la piste d'origine de la voie, sinon sur une piste
  neuve qui joue comme elle (`pisteDeVoie`).
- **Envoyer à la Session** : le menu d'un clip (ou des clips choisis), d'une
  plage, « Envoyer dans une voie » (une neuve, ou une voie de la même sorte),
  un clip glissé sur l'onglet Session (la vue y passe).
- **La bibliothèque du projet** : la rubrique « Projet » en tête du navigateur
  (ses clips, ses sons avec leur origine et leurs usages, ses dossiers) ;
  glisser vers une piste ou une case, un clic pose (dans la case choisie en
  Session) ; « Révéler dans Asset » ; « Retirer du projet » quand plus rien ne
  le pose ; les origines notées à l'import, à la prise micro, au rendu
  (consolider), à la génération et à la séparation.
- **Vérifié** dans Chromium, sombre et clair, sans erreur console : Tab fait le
  tour ; Session vierge, + Voie, un clip MIDI au double-clic ; la grille
  centrée ; Envoyer depuis le menu d'un clip (l'arrangement inchangé), une
  plage sur deux pistes, un son (référence, départ avancé) ; enregistré ;
  lancer un clip lance la lecture, l'arrangement joue avec, la voie sonne
  (crêtes mesurées) ; Stop de la voie, l'arrangement continue ; la vue Clip ;
  l'export ne se tait pas pour le solo d'une voie ; relu ; un clip glissé sur
  l'onglet ; Ctrl+Z et Ctrl+Maj+Z ; un clip du projet glissé dans la colonne
  libre (une voie neuve) et cliqué (la case choisie) ; une scène vers
  l'arrangement ; la prise de Session au clavier ; un projet de la première
  Session converti ; un effet dans la chaîne d'une voie ; retirer une voie ;
  1000 px sans débordement.

### Reste

- La timeline n'a plus à griser les pistes « jouées en Session » (REPRISE
  § 2.F) : par construction, aucune piste n'est prise par la Session.
- ~~Le nodal montre les modules des voies sans leur titre (le nom de la voie sur
  son nœud de départ, comme pour une piste) : `nodal.js`.~~ **Fait (06/10,
  finitions)** : le nœud de départ d'une voie porte son étiquette, à sa
  couleur, marquée « session » (une voie née d'une piste en a souvent le nom) ;
  la pastille la colore, le double-clic la renomme, un clic en fait la voie
  courante (`S.sel.voie`) ; le menu dit « voie de Session », « Voir dans la
  Session ». Suppr sur sa source ou sa tranche retire toute la voie
  (`retirerVoies`, comme une piste) — avant, le module partait seul et la voie
  restait sans source. Essayé dans Chromium, deux thèmes, sans erreur console.
- ~~Le panneau Asset, cliqué depuis la Session, pose encore sur l'arrangement
  (`panneau.js`) ; glisser dans une case marche.~~ **Fait (06/10, finitions)** :
  en Session, un clic du panneau pose dans la case choisie, comme un clic du
  navigateur (`app.session.poser`, session.js) ; sans case de voie choisie (la
  colonne des scènes, la Session vierge), une voie neuve ; un son sur une voie
  de notes : une voie neuve, en le disant. Le clic droit propose « Dans une voie
  neuve » ; l'aide du bas et l'entrée du menu suivent la vue ; en Session, les
  filtres restent ceux d'ODIO (une case s'y choisit d'un simple clic). Essayé
  dans Chromium, deux thèmes, sans erreur console : vierge, case choisie, voie
  de synthé, clip MIDI dans une voie Analog, voie neuve, Ctrl+Z ; l'arrangement
  inchangé (13 clips).
- Follow Actions, Legato, vélocité du lancement ; la prise audio en Session ;
  un clip MIDI de plus de 256 pas n'entre qu'en partie dans une case.
- Relire les trois chapitres sur le manuel (le réseau l'a refusé).

## 7. Les retours à côté de la Sortie (06/10)

Cal : « pourquoi dans le mode Session je n'ai pas mes trucs centrés ?? Réverbe
et RTT-01 doivent être à côté du fader Sortie, à droite, non ?? ».

**Vu avant** (Chromium, 1920, 2000 et 2560 px, panneau Asset ouvert ou non,
0, 2, 8 voies, mesuré par `getBoundingClientRect`) : la grille et la console
étaient bien centrées tant qu'elles tenaient ; mais dès que la console débordait
(8 voies à 1920 ou 2000 px, ou le panneau Asset ouvert), elle se calait à gauche
et la fin partait hors de la vue — à 8 voies et 1920 px, les retours finissaient
à 2150 px et la Sortie à 2310 px pour une zone qui s'arrête à 1906 px.

**Fait** (`session.js` consoleEl, `session.css` `.ss-cdef` / `.ss-cfix`) :
l'ordre d'une console, comme le mixeur de Live (« Mixing » : les retours et le
Main à droite). Deux blocs : à gauche les voies et les pistes ; à droite les
retours collés à la Sortie, `position: sticky; right: 0` sur un fond plein,
un filet à gauche. Quand tout tient, la console entière se centre ; quand elle
déborde, les voies et les pistes défilent sous le bloc de droite, qui reste au
bord de la zone. Mesuré après : à 8 voies et 1920 px, la Sortie finit à 1906 px
(le bord) et les retours la touchent (10 px) ; aux autres largeurs, inchangé
(centré). Captures : `apres_session_<thème>_<n>v_<largeur>[_asset].png`
(/tmp de la session, non gardées).
