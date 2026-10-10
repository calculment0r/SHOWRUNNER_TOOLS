# Le temps — dix propositions communes aux timelines (10/10/2026)

Cal, 09/10 : « on veut des interactions simples, rapides, et on élimine des clics pour que tout soit fluide
[…] je veux des features géniales, comme quand on travaille avec un zoom sémantique ». Ce fichier rassemble ce
qui vaut pour **toutes les frises du temps** : la timeline du Montage, la frise du Multishot et le banc
« Comparer » de Vidéo, l'onde et les répliques de Transcrire, la timeline du Studio et la bande de rythme de Movie
Analysis, l'arrangement d'ODIO. Les propositions propres à chaque outil sont dans `video.md`, `montage.md`,
`transcrire.md`, `analyse.md` (et `odio.md` du lot C) ; ici, ce qui doit être **le même partout** : les têtes de
lecture, le zoom, le survol, les plages, l'aimant, les repères, l'affichage du temps.

## 1. Ce qui existe déjà, et ce qui diffère

Relevé dans le code de l'intégration (10/10) et sur le portail d'essai (`ib2/`, captures `shots/`).

Déjà commun, et c'est une bonne base (Cal, 29/09 : « il faut qu'on ait les mêmes raccourcis dans toutes nos
timelines ») :
- **la molette** (`commun/molette.js`) : seule = défiler les pistes, Maj = le temps, Alt = zoom sous le curseur,
  Ctrl = la hauteur des pistes, pincer = zoom ; branchée sur le Montage, Transcrire, le Studio de Movie Analysis,
  ODIO, Idéation ;
- **la tête de lecture** (`commun/tete.js`) et **le lecteur** (`commun/lecteur.js`) : Espace, J K L (×2, ×4, ×8 ;
  K tenue + J ou L : une image), ← → une image (Maj : une seconde), Début, Fin ; **le son au défilement**
  (`commun/scrub.js`) ; **la copie de défilement** de chaque vidéo, faite pour être parcourue image par image
  (`server/tools/defilement.py`, 10 à 17 ms par image).

Ce qui diffère encore :

| geste | Montage | Transcrire | Studio (Movie Analysis) | banc « Comparer » (Vidéo) | ODIO |
|---|---|---|---|---|---|
| J, L | reculer, avancer (navette) | idem (lecteur commun) | **plan d'avant, d'après** | — (L : **boucle**) | (le clavier de l’ordinateur peut jouer des notes) |
| ← → | une image | une image | **plan d'avant, d'après** | une image | — |
| ↑ ↓ | coupe d'avant, d'après | réplique d'avant, d'après | — | — | — |
| voir tout | \ (bouton « tout ») | — | — | — | W |
| zoomer sur la sélection, revenir | — (Z : l'outil Zoom) | — | — | — | Z, X |
| boucler | — | bouton | — | L | Ctrl+L |
| le temps affiché | 00:00:19:18 (images) | 00:00:00:00 et 00:03 | 00:00.00, 00:02.24 | 00:00.00 | mesures |
| vue d'ensemble | non | non | non (la bande de rythme est dans une autre vue) | non | non |

## 2. Les dix propositions

« Géniale » : ça change la façon de travailler. « Rapide » : ça enlève des clics tout de suite.

### 1. Une seule grammaire du temps — rapide

- **Aujourd'hui** : passer du Montage au Studio de Movie Analysis change le sens de J, L, ← et → ; dans le banc,
  L boucle au lieu d'avancer ; « voir tout » est \ ici, W là, rien ailleurs.
- **Proposé** : un **socle commun**, partout où il y a du temps : Espace, J K L, ← → (une image ; Maj : une seconde),
  **↑ ↓ = l'élément d'avant, d'après** (la coupe, la réplique, le plan, le clip), Début, Fin, I O, **W = tout voir,
  Z = zoomer sur la sélection, X = le zoom d'avant**, Ctrl+L = boucler la sélection (sauf le Montage, où Ctrl+L
  reste « Lier » de Premiere). Le Studio passe ses plans sur ↑ ↓, le banc sa boucle sur Ctrl+L ; le Montage gagne W
  et X (libres), Z restant l'outil Zoom. Les commandes de montage gardent leur logiciel de référence (Premiere pour
  le Montage, Live pour ODIO). Le « ? » de chaque outil montre la même table, ses ajouts en dessous.
- **Ce que ça change pour Cal** : la main ne réapprend pas en changeant d'outil.
- **Principe** : la cohérence — le même geste fait la même chose partout ; la règle 7 de la rédaction (le même mot
  pour la même chose) appliquée aux touches ; les raccourcis de zoom d'Ableton (Z, X, W) [1].
- **Coût** : petit (trois tables de touches à aligner : `analyse/chaine/studio.mjs`, `movie/movie.js` (le banc),
  `montage/montage.js` ; une table commune dans `commun/` pour le « ? »). **Dépend de** : rien.

### 2. Le zoom temporel sémantique — géniale

- **Aujourd'hui** : zoomer ne fait que grossir ; pour voir le détail, on ouvre une autre vue (le moniteur Source, la
  vue de détail d'ODIO, l'onglet plan par plan de Movie Analysis).
- **Proposé** : un composant commun de frise à **trois paliers**, chaque outil disant ce qu'il montre à chacun :

  | outil | de loin | au travail | de près |
  |---|---|---|---|
  | Montage | la planche (une carte par plan) | les plans et leur nom | chaque image, numérotée |
  | Transcrire | les chapitres | les répliques | les mots et leurs silences |
  | Movie Analysis | le film en bande de rythme | une vignette par plan | les images du plan, ses répliques |
  | ODIO | les sections | les clips | les notes, modifiables |

  La règle du temps suit : de loin, elle nomme les sections (chapitres, scènes) ; de près, elle compte les images.
- **Ce que ça change pour Cal** : le principe qu'il aime dans le nodal, partout où il y a du temps.
- **Principe** : Pad++ — la taille apparente décide du détail montré [2] ; tldraw dessine chaque forme selon le
  zoom [3].
- **Coût** : gros (un palier de dessin par outil ; le zoom commun existe). **Dépend de** : rien ; à faire outil par
  outil (le Montage et ODIO d'abord, `montage.md` n° 2, `odio.md` n° 2).

### 3. La vue d'ensemble au-dessus de chaque frise — rapide

- **Aujourd'hui** : zoomé, on perd où l'on est ; revenir demande « tout », puis rezoomer (2 à 3 gestes).
- **Proposé** : une **bande fine** au-dessus de chaque timeline, qui montre tout le média (ses plans, son onde, ses
  sections) avec le cadre de ce qu'on voit : **glisser à l'horizontale se déplace, à la verticale zoome,
  double-clic = tout**. 1 glisser.
- **Ce que ça change pour Cal** : on se promène dans un long montage sans se perdre.
- **Principe** : la vue d'ensemble d'Ableton Live (« Overview ») [1].
- **Coût** : petit à moyen (un composant commun, branché sur le zoom de `commun/molette.js`). **Dépend de** : rien.

### 4. Le survol montre le temps — rapide

- **Aujourd'hui** : survoler une vidéo du fil la joue depuis le début (`hoverPlay`, `commun/fil.js`) ; survoler la
  timeline ne montre rien ; pour voir une image précise, on pose la tête.
- **Proposé** : partout, **la position de la souris est un temps** : sur une vignette (le fil, Asset, le Projet du
  Montage, l'accueil de Movie Analysis), gauche = début, droite = fin ; sur une timeline, le moniteur montre l'image
  sous la souris (un trait fin, distinct de la tête). Le son suit si la préférence « Son au défilement » est allumée.
  0 clic pour voir.
- **Ce que ça change pour Cal** : on trouve une image en passant la souris.
- **Principe** : le « skimming » de Final Cut Pro [4] ; le « Hover Scrub » de Premiere [5].
- **Coût** : petit (la copie de défilement existe pour chaque vidéo). **Dépend de** : rien ; une préférence pour
  l'éteindre.

### 5. Une plage est un objet — géniale

- **Aujourd'hui** : une plage de temps n'existe qu'au Montage (I, O) et dans ODIO (la sélection, Ctrl+L) ; dans
  Transcrire, Movie Analysis et la frise du Multishot, on ne peut pas dire « ce passage-là ».
- **Proposé** : **glisser sur la règle** choisit une plage, partout ; la plage a **le même petit menu** dans tous
  les outils : Écouter en boucle, Zoomer dessus (Z), Extraire (un média coupé, rangé dans Asset), Envoyer au
  Montage, Transcrire ce passage, Générer ici (le lot montage-selection), Laisser un commentaire. Les entrées qui
  n'ont pas de sens dans l'outil sont absentes, pas grisées.
- **Ce que ça change pour Cal** : un passage se désigne et s'emporte de la même façon, quel que soit l'outil.
- **Principe** : l'outil Plage de Final Cut Pro (une partie d'un plan, ou de plusieurs) [6] ; la sélection de temps
  d'Ableton ; le commentaire sur une plage de Frame.io, qui se tire sur la barre de lecture [7].
- **Coût** : moyen (la plage dans `commun/tete.js`, le menu commun ; chaque entrée appelle une route qui existe ou
  qu'un autre lot fait). **Dépend de** : le lot montage-selection (générer dans une plage), `transcrire.md` n° 3
  (extraire).

### 6. L'aimant qui sait où couper — rapide

- **Aujourd'hui** : l'aimant du Montage prend les bords des plans et la tête ; la frise du Multishot s'aimante à la
  grille d'H3 ; les autres frises n'ont pas d'aimant.
- **Proposé** : chaque frise aimante à **ce qui a un sens chez elle**, et le montre pendant le geste par une marque
  de sa sorte : les coupes et la tête (Montage), **les mots et les silences** (Transcrire), **les temps et les
  mesures** (ODIO, et le Montage quand une musique est marquée : `montage.md` n° 10), **la grille d'H3** (tout ce qui
  se génère), **les limites des plans** (Movie Analysis). Alt pendant le geste : pas d'aimant.
- **Ce que ça change pour Cal** : une coupe tombe juste sans zoomer pour viser.
- **Principe** : l'aimant de Premiere (S) et la grille d'Ableton, étendus à des cibles qui ont un sens ; la
  manipulation directe [8].
- **Coût** : petit par frise (les cibles sont déjà calculées : les mots dans Transcrire, la grille dans
  `server/tools/movie.py`, les temps dans `musique/tempo.js`). **Dépend de** : rien.

### 7. Les repères voyagent avec le média — moyen

- **Aujourd'hui** : ce qu'un outil sait du temps d'un média reste chez lui : les plans d'une analyse, les chapitres
  d'une transcription, les coupes d'un Multishot (`[Shot 2] At 00:01.708`), les sections d'un morceau d'ODIO.
- **Proposé** : un champ **repères** sur l'asset (un temps, un nom, une sorte) ; chaque outil y écrit ce qu'il sait,
  chaque frise les montre sur sa règle. Un rendu Multishot posé dans le Montage arrive avec ses coupes en marques
  (ou déjà coupé, au choix) ; un morceau d'ODIO arrive avec ses sections ; une vidéo analysée, avec ses plans.
- **Ce que ça change pour Cal** : le travail fait dans un outil sert dans tous les autres, sans le refaire.
- **Principe** : les commentaires de Frame.io, qui arrivent en marques sur la timeline de Premiere [7] ; une seule
  vérité (l'asset de la bibliothèque).
- **Coût** : moyen (un champ dans `server/core/library.py`, l'écriture par chaque outil, la lecture par
  `commun/tete.js`). **Dépend de** : l'accord sur le contrat (`docs/ARCHITECTURE.md`).

### 8. Le même affichage du temps — rapide

- **Aujourd'hui** : 00:00:19:18 dans le Montage, 00:00:00:00 et 00:03 dans Transcrire, 00:00.00 et 00:02.24 dans
  Movie Analysis, 00:00.00 dans le banc, 00:01.708 dans le prompt d'un Multishot, « 5,2 s » sur les puces de Vidéo.
- **Proposé** : **une règle** : en secondes avec virgule pour une durée (« 5,2 s ») ; en minutes:secondes,virgule
  pour un instant (« 01:02,24 ») ; avec les images (« 00:01:02:06 ») seulement là où l'on coupe à l'image (le
  Montage, le lecteur), et **un clic sur n'importe quel temps passe d'une écriture à l'autre** (gardé par visiteur).
  Le prompt envoyé à H3 garde sa grammaire, mais la frise montre la règle commune.
- **Ce que ça change pour Cal** : un temps lu dans un outil se retrouve tel quel dans un autre.
- **Principe** : la règle 7 de la rédaction (le même mot pour la même chose) ; la virgule décimale du français.
- **Coût** : petit (une fonction commune de mise en forme, remplaçant `tcode`, `clock`, `mmss`, `M.tc`…).
  **Dépend de** : rien.

### 9. Lire autour de la tête — rapide

- **Aujourd'hui** : pour juger un raccord : reculer (J ou ←, plusieurs fois), Espace, Espace (3 à 5 gestes), et la
  tête n'est plus où elle était.
- **Proposé** : **Maj+Espace** lit de 3 s avant la tête à 2 s après (ou la plage choisie, si elle existe), puis la
  tête **revient** où elle était. 1 touche, partout (Montage, Transcrire, le Studio, ODIO, le banc).
- **Ce que ça change pour Cal** : on vérifie une coupe sans perdre sa place.
- **Principe** : Premiere, « Play Around » (Maj+K : un temps avant et après la tête, réglé dans les préférences de
  lecture ; 3 s et 2 s par défaut) [9].
- **Coût** : petit (le lecteur commun sait lire une plage ; la boucle existe). **Dépend de** : rien.

### 10. Remonter le temps du travail en glissant — rapide

- **Aujourd'hui** : le journal des gestes (le troisième bouton à côté de ↶ ↷) liste les états ; un clic y revient
  (`U.goTo`, `commun/undo.js`) : ouvrir, lire les libellés, cliquer, regarder, recommencer (2 gestes par essai).
- **Proposé** : **glisser** le long du journal (ou tenir Ctrl+Z) montre chaque état **pendant le glisser** — la
  timeline, le texte, l'arrangement changent sous les yeux ; relâcher garde l'état choisi, Échap revient au présent.
  1 glisser pour retrouver « le montage d'il y a dix minutes ».
- **Ce que ça change pour Cal** : on revient en arrière en regardant, pas en lisant des libellés.
- **Principe** : le panneau Historique d'Adobe — choisir un état ramène l'image à ce moment [10] ; la manipulation
  directe, réversible [8].
- **Coût** : petit à moyen (`commun/undo.js` sait déjà aller à un état ; il faut que chaque pas soit assez rapide
  pour être montré pendant le glisser : le Montage et ODIO le sont, par instantanés). **Dépend de** : rien.

## 3. Le top 3

1. **Une seule grammaire du temps** (n° 1) : trois tables de touches à aligner ; petit, et tout le reste s'appuie
   dessus.
2. **Le survol montre le temps** (n° 4) : 0 clic pour voir une image, partout ; petit, la copie de défilement
   existe.
3. **Le zoom temporel sémantique** (n° 2) : le principe que Cal aime, dans toutes les frises ; gros, à faire outil par
   outil.

Puis, petits chacun : la vue d'ensemble (3), lire autour de la tête (9), le même affichage du temps (8).

## Sources

1. Ableton, manuel de Live 12, « Arrangement View » (la vue d'ensemble ; Z : zoomer sur la sélection ; X : revenir ;
   W : tout le morceau ; H : la hauteur) — https://www.ableton.com/en/live-manual/12/arrangement-view (extrait du
   moteur de recherche, 10/10/2026 ; le site est bloqué depuis le conteneur). ODIO applique déjà Z, X, W, H
   (`musique/timeline.js`).
2. Bederson, B. B. & Hollan, J. D., « Pad++: A Zooming Graphical Interface for Exploring Alternate Interface
   Physics », UIST '94, p. 17-26 —
   https://www.lri.fr/~mbl/Teach/SituatedComputing/2017/papers/ZUI/pad++-uis94-p17-bederson.pdf
3. tldraw, « Performance » (le niveau de détail des formes selon le zoom) — https://tldraw.dev/sdk-features/performance
   (cité par `docs/etudes/ideation_fluidite.md`).
4. Apple, *Final Cut Pro User Guide*, « Skim media » — https://support.apple.com/guide/final-cut-pro/vere9ba3609/mac
   (extrait).
5. Adobe, « Customize the Icon View in Project panel » (Hover Scrub) —
   https://helpx.adobe.com/dk/premiere/desktop/get-started/customize-the-project-panel/customize-icon-view-in-project-panel.html
   (extrait).
6. Apple, *Final Cut Pro for iPad*, « Select items in the timeline » (l'outil Plage) —
   https://support.apple.com/guide/final-cut-pro-ipad/devcdf7f0dfc/ipados (extrait).
7. Frame.io, « Commenting on your media » (le commentaire sur une plage, tiré sur la barre de lecture ; les
   commentaires en marques dans Premiere) — https://help.frame.io/en/articles/9105251-commenting-on-your-media
   (extrait).
8. Shneiderman, B., « Direct Manipulation: A Step Beyond Programming Languages », *Computer* 16(8), 1983,
   p. 57-69 (DOI 10.1109/MC.1983.1654471).
9. Adobe, « Playing assets » (Play Around, la lecture avant et après la tête, réglée dans les préférences de
   lecture) — https://helpx.adobe.com/premiere-pro/using/playing-assets.html (extrait).
10. Adobe, « Undo, redo, and cancel actions » (le panneau Historique : choisir un état ramène l'image à ce moment) —
    https://helpx.adobe.com/photoshop-elements/mac-app-store/workspace-and-environment/undo-redo-cancel-actions.html
    (extrait ; la page de Photoshop même n'a pas été trouvée).
