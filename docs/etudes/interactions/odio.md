# ODIO — dix propositions d'interaction (09-10/10/2026)

Cal, 09/10 : « on veut des interactions simples, rapides, et on élimine des clics pour que tout soit fluide
[…] je veux des features géniales, comme quand on travaille avec un zoom sémantique ». Ce fichier est
l'étude pour ODIO (l'arrangement, la Session, le nodal, le panneau Générer). Pas de code : des propositions,
chacune avec le geste d'aujourd'hui compté, le geste proposé, le principe et sa source, le coût.

Les mots sont ceux du lexique du lot rédaction (`docs/etudes/redaction.md`, à venir) (un clip, une piste, un rendu, un brouillon, les
voix et instruments séparés…).

## 1. Ce qui a été mesuré

Un portail d'essai neuf (`tools/portail_essai.py 9051`, moteurs factices, `SR_FAUX_MACHINES=1`), Chromium
sans affichage, un pilote qui fait les parcours et compte chaque geste : un clic, un champ rempli, une touche,
un changement de page, une attente (un rendu, une ouverture), un glisser. Passé le 09/10 sur la copie du lot,
puis le 10/10 sur l'intégration (`23a0fbb` : la page Vidéo refaite, les attracteurs et les moteurs d'ODIO) :
les mêmes comptes. Le pilote et ses captures (sombre et clair) sont dans le scratchpad de la session :
`sr_c/parcours2.mjs`, `sr_c/shots2/odio_*.png`, `sr_c/shots2/parcours.txt` (le tableau complet).

| parcours (aujourd'hui) | clics | champs | touches | attentes | gestes |
|---|---|---|---|---|---|
| l'accueil → ODIO (la carte) | 1 | | | | **1** + une page |
| un nouveau projet (« ··· » → Nouveau projet → le nom → Créer) | 3 | 1 | | 1 | **5** |
| une piste de plus (« + Piste » → la sorte) | 2 | | | | **2** (Ctrl+T : 1 touche, mais voir plus bas) |
| un son du navigateur sur l'arrangement (un clic : la piste choisie, la tête) | 1 | | | | **1** |
| un son du panneau Asset (Ctrl+Espace, chercher, double-clic, fermer) | 1 | 1 | 2 | | **4** |
| ouvrir le panneau Générer, le lire, le fermer | 1 | | 1 | | **2** — mais 4 tuiles, 15 champs, 63 boutons, 2 200 signes |
| séparer un clip (clic droit → « Séparer en stems » → le rendu) | 2 | | | 1 | **3** |
| exporter le mixage (Exporter → Exporter → le rendu → Fermer) | 3 | | | 1 | **4** (11 s de rendu dans la page) |
| la Session (Tab), une voie (« + Voie » → la sorte), le Nodal (Tab), retour (Tab) | 2 | | 3 | | **5** |

Ce qui est déjà bien, et qu'on garde : un clic du navigateur pose ; Tab fait le tour des trois vues ; la barre
de titre d'un clip est l'objet et son corps est le temps (Live) ; le menu de chaque zone au clic droit ; les
stems se posent sous l'original, alignées, l'original muet ; l'annulation de tout ; le nodal dans sa fenêtre ;
le zoom sémantique des tuiles du nodal (ODIO_01).

Les frictions vues :
- **Deux fenêtres pour rien** : un projet neuf demande un nom et un départ (3 clics, 1 champ) ; l'export
  demande une étendue, une queue et un titre (2 clics) alors que les défauts sont presque toujours les bons.
  La fenêtre du projet a « Fermer » en haut et « Annuler » en bas : deux boutons pour le même geste.
- **Le panneau Générer fait lire avant de faire** : 4 tuiles pour dire ce qu'on veut, puis 15 champs et
  63 boutons sur trois colonnes, dont la partition de YuE2 — Cal n'a pas compris « relire la partition avant
  de chanter ». Le panneau sait pourtant beaucoup de choses d'avance : la plage choisie, la piste, le clip.
- **Le menu « + Piste » a 12 entrées** (deux batteries, cinq synthés, l'échantillonneur, l'audio, le bus, le
  génératif, la piste générative) : on lit avant de choisir (la loi de Hick [11]).
- **Un son posé ne règle rien** : son tempo et sa tonalité se détectent par le clic droit (« Détecter le
  tempo »), le projet reste à 112 BPM.
- **Écouter une plage** demande trois gestes : Ctrl+L (la boucle), Espace, Espace.
- **Les versions d'une région** sont des cartes dans le panneau ; en changer dans le morceau demande d'ouvrir
  le panneau, trouver la carte, « mettre dans le segment ».
- **Un clic pose ici, un double-clic ailleurs** : dans ODIO (et dans Idéation), un clic sur une vignette du
  panneau Asset la pose (`clickPlaces`, `musique/panneau.js`) ; dans les autres outils, c'est le double-clic
  (`commun/dock.js`). Le double-clic, pris par habitude, fait donc deux clics : il a posé **deux** clips
  (13 → 15) le 09/10, un seul le 10/10 — selon le temps entre les deux clics. Le même geste doit faire la même
  chose partout (règle 7 de la rédaction) : à régler avec le lot transverse A.
- **Ctrl+T** (une piste audio) : hors plein écran, Chrome garde Ctrl+T pour ouvrir un onglet ; le pilote
  l'envoie à la page, Cal ne le peut pas. L'API Keyboard Lock ne prend ces touches qu'en plein écran [14].

## 2. Les dix propositions

« Géniale » : ça change la façon de travailler. « Rapide » : ça enlève des clics tout de suite.

### 1. Une piste qui joue seule — géniale

- **Aujourd'hui** : une basse qui suit le morceau, c'est une piste (2 clics), un clip par section (double-clic,
  puis les notes au piano roll, ou un modèle du navigateur par section : ≈ 4 gestes par section), soit
  20 gestes pour un morceau de quatre sections, et rien ne suit l'arc d'énergie.
- **Proposé** : dans « + Piste », trois pistes de plus — **Basse qui suit**, **Batterie qui suit**, **Nappe
  qui suit** (1 clic). La piste n'a pas de clips à poser : elle joue d'elle-même la tonalité, la mesure et les
  sections du projet (nos modèles de motifs savent déjà le faire : `NOTE_MODELS.make(P.key, P.sig)`,
  `DRUM_MODELS`), plus dense au refrain qu'au couplet, et l'arc d'énergie la pilote (les attracteurs du banc
  agissent déjà sur les réglages). Une molette « complexité », une autre « variation ». « Figer » la change en
  clips ordinaires qu'on retouche. 1 clic au lieu de 20, et le morceau tourne dès la première minute.
- **Ce que ça change pour Cal** : on commence par entendre un morceau entier, puis on le sculpte, au lieu de
  poser des briques en silence.
- **Principe** : les Session Players de Logic Pro 11 (Drummer, Bass Player, Keyboard Player) suivent la
  piste d'accords et se règlent par quelques curseurs [5] ; chez nous la tonalité, les sections et l'arc
  existent déjà, c'est la même idée sans modèle d'IA.
- **Coût** : moyen (du code : un générateur de notes par section, dans `generatif_region.js` ou un module
  neuf ; pas de modèle). **Dépend de** : rien d'externe.

### 2. Le zoom sémantique de l'arrangement — géniale

- **Aujourd'hui** : le zoom (Ctrl+molette) ne change que la taille ; pour lire les notes d'un clip il faut la
  vue de détail en bas (Maj+Tab, ou double-clic : 1 à 2 gestes, et le panneau prend un tiers de l'écran).
- **Proposé** : ce que montre une piste dépend du zoom, comme les tuiles du nodal le font déjà. De loin :
  les sections en grand, une bande par piste avec son nom et sa forme d'onde résumée, les clips sans titre.
  Au travail : les clips, leurs titres, les notes en traits. De près : les notes avec leur vélocité, les
  accents, les marqueurs d'un son, **modifiables sur place** (tirer une note, peindre une vélocité) sans ouvrir
  le panneau du bas. 0 clic pour lire, 0 pour éditer une note.
- **Ce que ça change pour Cal** : le zoom sémantique qu'il aime dans le nodal, dans l'arrangement ; le panneau
  du bas ne sert plus qu'aux instruments.
- **Principe** : Pad++ — « the apparent size of an object determines the amount of detail it presents » [1][2] ;
  tldraw dessine chaque forme selon le zoom et cache ce qui est hors de la vue [4] ; le portage d'ODIO_01
  (`docs/etudes/musique_odio01.md`, n° 35-36 : « quand rien ne rentre, le réglage exposé en grand »).
- **Coût** : gros (`timeline.js` : trois niveaux de dessin, l'édition des notes dans la voie). **Dépend de** :
  la molette commune (`commun/molette.js`) qui donne déjà le zoom sous le curseur.

### 3. Entendre avant de lancer — géniale

- **Aujourd'hui** : on remplit le panneau, on lance (1 clic), on attend la chanson entière (minutes), on
  écoute, on recommence.
- **Proposé** : pendant qu'on tape le style, le panneau fait sonner **quatre mesures** de la plage (ACE-Step
  « repaint » sur la plage, au tempo et dans la tonalité du projet), relancées à chaque pause de la frappe ;
  on règle à l'oreille, et « Générer » ne part que quand ça sonne juste. 0 clic pour l'aperçu.
- **Ce que ça change pour Cal** : le brouillon devient audible ; moins de rendus jetés.
- **Principe** : Krea Realtime — « as you draw, type, or adjust elements, the output updates immediately,
  there is no queue, no waiting, and no render button » [6] ; Suno Studio génère une partie dans une plage
  choisie [7].
- **Coût** : gros. **Dépend de** : ACE-Step branché en réel (décision 1 de `musique_generatif.md` § 8.7) et
  d'une tâche courte qui tient en quelques secondes sur un DGX (à mesurer : `repaint` sur 4 mesures).

### 4. Le panneau Générer ouvert sur la bonne réponse — rapide

- **Aujourd'hui** : « Générer » (1 clic) → « Que veux-tu générer ? » (4 tuiles à lire, 1 clic) → trois colonnes
  (15 champs, 63 boutons) → l'orange. Soit 3 clics et beaucoup de lecture, même quand la plage et la piste
  sont déjà choisies.
- **Proposé** : ce qui est choisi répond à la question. Une plage vide sur une piste audio → « un instrument
  seul » ; un clip choisi → « une variation » ; une région → « la suite » ; rien → « une chanson ». Le panneau
  s'ouvre déjà répondu, les tuiles rangées en une ligne de pastilles (on peut changer). Et **la touche G** sur
  une plage ou un clip ouvre le panneau pré-rempli (comme « Générer ici… » du clic droit, sans le menu). Le
  premier écran ne montre que trois choses : **quoi**, **où**, **le style** — et l'orange ; le reste (modèle,
  inspiration, guide MIDI, partition, réglages) se déplie. 3 clics → 1 touche + l'orange.
- **Ce que ça change pour Cal** : on ne répond plus à une question dont l'outil connaît la réponse ; le
  panneau se lit en une seconde.
- **Principe** : les défauts intelligents (Nielsen, « The Power of Defaults » [8] : le défaut est lu comme
  la recommandation) ; la divulgation progressive (NN/g [8b] : les options secondaires à un second niveau) ;
  Suno Studio ouvre la fenêtre de prompt sur la plage qu'on vient de sélectionner [7].
- **Coût** : petit à moyen (`generatif_panneau.js` : la question déduite de `S.sel`, un premier écran court ;
  `musique.js` : la touche G). **Dépend de** : la relecture des mots du panneau par le lot rédaction.

### 5. Exporter en un clic — rapide

- **Aujourd'hui** : Exporter → la fenêtre (étendue, queue, titre, stems) → Exporter → 11 s → Fermer : 4 gestes.
- **Proposé** : « Exporter » rend tout de suite le morceau entier (ou la boucle si elle est allumée), 2 s de
  queue, le titre du projet, dans la bibliothèque ; une pastille de progression dans la barre, puis une bulle
  « rangé · Envoyer au montage · Voir dans Asset ». Les réglages restent, sous « ⋯ » du bouton (ou Alt+clic),
  pour les stems et le titre. 4 → 1.
- **Ce que ça change pour Cal** : exporter devient aussi léger qu'enregistrer.
- **Principe** : les défauts qui conviennent à presque tous [8] ; la divulgation progressive [8b] ; le même
  chemin qu'a déjà pris l'export PNG d'Idéation (05/10 : « sur l'ordinateur et dans le presse-papier », sans
  fenêtre).
- **Coût** : petit (`musique.js`, `openExport` : le chemin direct, la fenêtre derrière « ⋯ »). **Dépend de** :
  rien.

### 6. Un projet neuf sans fenêtre — rapide

- **Aujourd'hui** : « ··· » → Nouveau projet → le nom → le départ → Créer : 3 clics, 1 champ.
- **Proposé** : « Nouveau projet » dans le menu crée « Projet du 09/10 » sur le départ « Session » et l'ouvre
  (1 clic) ; le nom se renomme sur place dans la barre (double-clic sur le nom, comme une piste : la règle
  de Cal du 29/09) ; le départ se change par « ··· → Repartir de : vide, batterie et basse ». Depuis
  l'accueil, la carte ODIO ouvre déjà le dernier projet. 4 → 1.
- **Ce que ça change pour Cal** : un projet se jette et se recommence sans y penser.
- **Principe** : la fenêtre qui demande un nom avant de commencer est une « formalité » que l'édition sur
  place remplace (Shneiderman : des actions rapides, incrémentales, réversibles [13]) ; Live crée un Set vide
  d'une commande.
- **Coût** : petit. **Dépend de** : rien.

### 7. Le son posé règle le projet — rapide

- **Aujourd'hui** : poser un son (1 clic), puis clic droit → « Détecter le tempo » (2 clics), puis régler
  le tempo et la tonalité à la main (2 à 4 gestes) ; le clip se cale par « Caler » dans la vue Clip.
- **Proposé** : dès qu'un son est posé dans un projet qui n'a pas encore de clip, ODIO détecte son tempo et
  sa tonalité (le code existe : `tempo.js`, « Détecter le tempo ») et propose une pastille dans la barre :
  « ce son : 124 BPM, La mineur — **caler le projet dessus** » (1 clic, annulable). Un son posé ensuite se
  cale à la grille du projet (ce que fait « Caler »), sans fenêtre. 5 → 1.
- **Ce que ça change pour Cal** : la session se met au tempo de ce qu'il apporte, pas l'inverse.
- **Principe** : les défauts tirés de ce que la personne vient de donner (les « smart defaults », une devinette
  juste proposée, jamais imposée) [8] ; la règle 7 du thème (ce qui est fait est annulable).
- **Coût** : petit. **Dépend de** : la détection existante (`tempo.js`), qui dit sa confiance.

### 8. Espace tenu = écouter la plage — rapide

- **Aujourd'hui** : choisir une plage, Ctrl+L (la boucle dessus), Espace (lire), Espace (arrêter), puis
  Ctrl+L pour éteindre la boucle : 4 touches.
- **Proposé** : Espace tapé fait ce qu'il fait aujourd'hui (lire, arrêter). Une plage ou un clip choisi, la
  lecture part de son début et boucle dessus ; **Espace tenu** plus d'un tiers de seconde : relâcher arrête et
  remet la tête où elle était. La boucle du projet n'est pas touchée. 4 → 1. (Les deux gestes partent du même
  appui : c'est au relâcher qu'on sait si la touche était tenue, rien n'attend.)
- **Ce que ça change pour Cal** : écouter un passage devient un réflexe, pas une manœuvre.
- **Principe** : le quasimode de Raskin — un mode qui n'existe que tant qu'on tient la touche, donc jamais
  d'état à retenir [9] ; c'est déjà le geste d'ODIO_01 pour tracer au bouton du milieu.
- **Coût** : petit (`musique.js` : l'Espace du transport, l. 1627, garde son `keydown` ; un `keyup` mesure
  la durée et remet la tête).
  **Dépend de** : rien.

### 9. Le menu en étoile — « + Piste » et le vide du nodal

- **Aujourd'hui** : « + Piste » ouvre une liste de 12 entrées (2 clics, de la lecture) ; dans le nodal, le
  double-clic sur le fond ouvre le catalogue (une fenêtre, des rubriques).
- **Proposé** : un **menu en étoile** à huit directions, sous le pointeur, au clic droit du vide d'une piste ou
  du nodal : Batterie, Synthé, Basse, Échantillonneur, Audio, Bus, Génératif, Macro ; un second cercle pour
  la variante (DR-9 / boîte à rythme…). Le débutant lit le cercle ; l'habitué **trace un trait** dans la
  direction sans que le menu s'ouvre : une piste en un geste, les yeux sur l'arrangement. Les sortes les plus
  posées du projet occupent les directions les plus faciles (haut, droite).
- **Ce que ça change pour Cal** : plus de liste à lire ; les gestes s'apprennent par la main.
- **Principe** : les marking menus de Kurtenbach et Buxton — « a mark was about 3.5 times quicker than using
  the menu », et les habitués gardent le menu pour se rappeler la disposition [10] ; huit directions, pas
  douze lignes (la loi de Hick [11]).
- **Coût** : moyen (`commun/menu.js` : une forme radiale et la lecture du trait ; réutilisable par Idéation
  et le Montage). **Dépend de** : rien ; à proposer au lot transverse A (la palette de commandes).

### 10. Les versions sous la main

- **Aujourd'hui** : ouvrir le panneau (1 clic), trouver la carte de la version, « mettre dans le segment »
  (1 clic), fermer (1) : 3 gestes par comparaison ; A/B existe dans le panneau seulement.
- **Proposé** : sur une région choisie, **↑ ↓ (ou la molette)** passe d'une version à l'autre et la fait
  entendre en boucle sur le segment ; la région affiche « 3 / 5 » et une rangée de petites formes d'onde ;
  **glisser** une carte de version sur le segment la pose ; **Tab tenu** = A/B avec la version d'avant. Les
  versions non gardées se rangent d'elles-mêmes dans la bibliothèque du projet. 3 → 1.
- **Ce que ça change pour Cal** : choisir une prise se fait à l'oreille, dans le morceau, sans fenêtre.
- **Principe** : la manipulation directe — l'objet d'intérêt (la région) porte ses états, les actions sont
  rapides et réversibles [13] ; les take lanes de Live et les take folders de Logic, cités dans
  `musique_generatif.md` § 8.6 (« Select Next/Previous Take » pendant la lecture).
- **Coût** : moyen (`timeline.js` : la molette sur une région, le dessin des versions ; `generatif_region.js`).
  **Dépend de** : rien.

## 3. Le top 3

1. **Une piste qui joue seule** (n° 1) : 20 gestes → 1, et un morceau qui tourne dès le départ ; du code
   seulement, sur ce qu'ODIO sait déjà (tonalité, sections, arcs, attracteurs).
2. **Le panneau Générer ouvert sur la bonne réponse, G sur une plage** (n° 4) : la friction que Cal a
   nommée ; petit coût, à faire avec le lot rédaction.
3. **Le zoom sémantique de l'arrangement** (n° 2) : le principe que Cal aime, étendu à la vue principale ;
   gros, mais le nodal montre déjà comment.

Puis, en une demi-journée chacune : exporter en un clic (5), un projet sans fenêtre (6), Espace tenu (8), le
son qui règle le projet (7).

## Sources

1. Bederson, B. B. & Hollan, J. D., « Pad++: A Zooming Graphical Interface for Exploring Alternate Interface
   Physics », UIST '94, p. 17-26 — https://www.lri.fr/~mbl/Teach/SituatedComputing/2017/papers/ZUI/pad++-uis94-p17-bederson.pdf
2. Perlin, K. & Fox, D., « Pad: An Alternative Approach to the Computer Interface », SIGGRAPH '93 (la taille
   apparente d'un objet décide du détail qu'il montre) — https://www.cs.umd.edu/projects/hcil/jazz/learn/papers/siggraph-93-origpad.pdf
3. `docs/etudes/musique_odio01.md` (le zoom sémantique des tuiles, porté d'ODIO_01 ; n° 35-40).
4. tldraw, « Performance » (culling, niveau de détail des formes selon le zoom) — https://tldraw.dev/sdk-features/performance
   (cité par `docs/etudes/ideation_fluidite.md`).
5. Apple, « Logic Pro takes music making to the next level with new AI features » (Session Players : Bass
   Player et Keyboard Player suivent la piste d'accords), 07/05/2024 —
   https://www.businesswire.com/news/home/20240507524533/en/Logic-Pro-takes-music-making-to-the-next-level-with-new-AI-features ;
   Sound On Sound, « Logic Pro: Session Players » — https://www.soundonsound.com/techniques/logic-pro-session-players
   (extraits du moteur de recherche, 09/10/2026).
6. Krea, « Realtime » (documentation) — https://docs.krea.ai/realtime.md (extrait).
7. Suno, « Introduction to Studio » — https://help.suno.com/en/articles/7940161 ; la fenêtre de prompt ouverte
   sur une plage choisie : guide cité dans `docs/etudes/musique_generatif.md` § 8.5.
8. Nielsen, J., « The Power of Defaults », Nielsen Norman Group, 2005 (extrait du moteur de recherche ; la
   page n'est pas lisible depuis le conteneur) ; 8b. Nielsen Norman Group, « Progressive Disclosure » —
   https://www.nngroup.com/videos/progressive-disclosure/ (extrait).
9. Raskin, J., *The Humane Interface*, 2000, les quasimodes — https://www.raskincenter.org/rchi/core-principles
   (extrait).
10. Kurtenbach, G. & Buxton, W., « User Learning and Performance with Marking Menus », CHI '94, p. 258-264 —
    https://research.autodesk.com/app/uploads/2023/03/user-learning-and-performance.pdf_recFBbPwmG7SW9uDe.pdf
11. Interaction Design Foundation, « Hick's Law: Making the choice easier for users » —
    https://ixdf.org/literature/article/hick-s-law-making-the-choice-easier-for-users (extrait).
12. Ableton, manuel de Live 12, « Working with the Browser » (les étiquettes, la recherche de sons semblables) —
    https://www.ableton.com/live-manual/12/working-with-the-browser/ ; « Capture MIDI » —
    https://help.ableton.com/hc/en-us/articles/360000776450-Capture-MIDI (extraits : le site est bloqué depuis
    le conteneur).
13. Shneiderman, B., « Direct Manipulation: A Step Beyond Programming Languages », *Computer* 16(8), 1983,
    p. 57-69 (DOI 10.1109/MC.1983.1654471).
14. Chrome for Developers, « Capture keys with the Keyboard Lock API » (seulement en plein écran lancé par la
    page) — https://developer.chrome.com/docs/capabilities/web-apis/keyboard-lock (extrait).
