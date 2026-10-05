# ODIO — la vue Session (le lanceur de clips de Live) (05/10/2026)

Demande de Cal, mot pour mot : « notre partie CONSOLE de ODIO devient la partie
Scène d'Ableton : un launchpad avec la même logique et les mêmes outils que ceux
d'Ableton ».

**Statut** : codé et essayé dans Chromium (sans affichage, copie
`odio-session`, port 8794, données jetables) : quatre pilotes, 40 contrôles,
captures dans `/tmp/claude-0/odio_session/`. Le serveur valide le format neuf
(`server/tools/music.py`, `_session`, et son essai dans `selftest`).

| | |
|---|---|
| la vue | `musique/session.js`, `musique/session.css` (l'onglet « Session », l'ancien « Console » : même clé de vue, `console`) |
| la console | `musique/console.js` fabrique désormais les tranches (`createMixer`) ; la vue Session les range sous ses colonnes |
| le moteur | `musique/moteur.js` : `Engine.sess`, `lancer`, `echeances`, `retourArrangement`, `finPrise` ; `Graph.scheduleSession`, `Graph.cut`, `Graph.notes` |
| le format | `musique/projet.js` (`scenes`, `slots`, `launch`, `QUANTS` et les gestes de scène) ; `server/tools/music.py` (`_session`) ; `server/tools/elements.py` (`slots[].item` dans `ID_FIELDS`) |
| le branchement | `musique/musique.js` (l'onglet, Entrée, la prise au clavier et en MIDI, les pistes retirées) ; `musique/index.html` (la feuille) |

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
- **Le temps des départs.** Le moteur planifie 120 ms d'avance (MDN, « A Tale of
  Two Clocks ») : un départ demandé juste avant la barre tombe derrière ce qui
  est déjà planifié ; s'il est encore à venir pour l'oreille, il est rattrapé à
  son instant exact (la piste est coupée là, le bout de clip manquant se
  planifie) ; sinon il part à la frontière, en gardant sa phase. Sans
  quantification, un clip part au prochain instant encore libre (≈ 100 ms).
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

## 6. La refonte demandée par Cal (05/10 au soir) — EN COURS

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
- **Tab** : Arrangement → Session → Nodal → …, Maj+Tab à l'envers (F12 garde
  Clip ↔ Instruments).
- **Le design** : la grille centrée (colonnes de largeur fixe, la colonne des
  scènes collée à la grille), des cases plus grandes, un vide accueillant
  (« glisse un clip ici, ou + voie ») ; la console en bas : voies, pistes de
  l'arrangement, retours, sortie, en groupes (les envois des pistes n'ont pas
  d'autre console).

### Fait (commit de ce soir)

Dans `musique/projet.js`, non branché encore (le reste lit toujours
`slots[].track`) : la forme documentée, `migrerSession` (à appeler depuis
`migrate`), `convertirSlots`, `voieDePiste`, `biblioDe`, `retenirSons`,
`usagesDuSon`, `refDeClip`, `motifDeRef`, `champsDeRef`. Vérifié : `node --check`.

### Reste (dans l'ordre)

1. `moteur.js` : `sess` sans `hors` ni `retourArrangement` ; `scheduleSession`,
   `cut`, `mutes` lisent les voies ; `trajets` (projet.js) inclut les voies ;
   l'export sans la Session.
2. `server/tools/music.py` : valider `voies` (comme une piste), `slots[].voie`,
   les motifs et modules d'une voie, `biblio` ; le selftest ; `elements.py` :
   `biblio.clips[].item`, `biblio.sons[].item` dans `ID_FIELDS["mus"]`.
3. `session.js` / `session.css` réécrits sur les voies, centrés ; la console en
   groupes ; le navigateur à gauche.
4. `musique.js` : Tab, `app.voie`, chaîne et effets d'une voie, `dropItem` d'un
   clip du projet, `srcForPlay` en Session, `retenirSons` dans `commit`, les
   origines (import, prise, rendu, génération) ; `timeline.js` : deux entrées de
   menu et le dépôt sur l'onglet Session (petit, groupé) ; `guide.js`.
5. `navigateur.js` + un `biblio.js` : la rubrique « Projet ».
6. Vérifier en vrai (port 8805, Playwright), captures sombre et clair dans
   `/tmp/claude-0/odio_session2/`.
