# Transverse (lot a) — dix propositions qui valent pour plusieurs outils (09/10/2026)

Cal, 09/10 : « on veut des interactions simples, rapides, et on élimine des clics pour que tout soit fluide […] je
veux des features géniales ». Ce fichier rassemble ce qui vaut pour **plusieurs outils à la fois** — Asset et son
panneau, Image, Upscale, Object Creator, Character Factory, et au-delà : le glisser-déposer, l'aperçu, la palette de
commandes, les touches, les suites d'un rendu. Chaque proposition dit ce qu'elle remplace dans les fichiers de chaque
outil (`asset.md`, `image.md`, `upscale.md`, `objet.md`, `character.md`). Pas de code.

## 1. Ce qui a été vu, d'un outil à l'autre

Les parcours comptés (`asset.md` § 1 et les autres ; pilote `sr_a/parcours.mjs`, tableau `sr_a/shots/parcours.txt`)
montrent des frictions qui reviennent partout :

- **Changer d'outil avec un objet** coûte 3 à 6 gestes et 1 à 2 pages (« ⋯ », l'entrée, la page ; ou Asset, la
  fiche, un lien) : animer, agrandir, faire un objet 3D, un personnage.
- **Deux façons de choisir un asset** : le panneau (Ctrl+Espace) et la fenêtre `pick` (15 appels dans le code).
- **Des fenêtres « Oui »** là où l'annulation existe : 7 confirmations dans Character Factory, la corbeille du fil
  (alors que Ctrl+Z la rend).
- **Aucune touche commune** sur une vignette : la visionneuse du fil n'a que les flèches et Échap ; Asset a F, T, N,
  Suppr ; Upscale 1-4 et S ; le studio n'en a pas.
- **Rien ne se voit avant d'être ouvert** : pas d'aperçu au survol dans le panneau, pas de 3D dans Asset.
- **Chaque étape d'une chaîne attend un clic** : agrandir après générer, la 3D après les vues, la tenue après le visage.
- **On ne sait pas ce qu'un glisser va faire** avant de lâcher (remplacer ? ajouter ? copier dans ce Workspace ?).

## 2. Les dix propositions

### 1. Le glisser-déposer universel — géniale

- **Aujourd'hui** : une vignette se glisse vers une zone de la même page (et du panneau vers la page) ; pour l'amener
  dans un autre outil : un menu, une page, ou passer par Asset (3 à 6 gestes, 1 à 2 pages). Cal : « le Multishot en
  fenêtre où l'on ne peut rien glisser ».
- **Proposé** : toute vignette du portail (fil, panneau, fiche, pile d'Upscale, affiche du casting, carte d'objet,
  essai de l'atelier) se glisse partout : sur une zone, elle s'y pose ; sur le bouton « Outils » de l'en-tête, le menu
  s'ouvre, et survoler un outil l'ouvre avec l'objet posé dans sa zone principale (l'image en première image de
  Vidéo, la source d'Upscale, l'image d'un objet neuf) ; sur « Asset » de l'en-tête, elle est rangée. Les fenêtres et
  calques du portail (Multishot, atelier) acceptent le dépôt. 1 glisser au lieu de 3 à 6 gestes.
- **Ce que ça change pour Cal** : on prend une chose et on la porte là où elle doit aller, comme sur un bureau.
- **Principe** : la manipulation directe (Shneiderman 1983 [1]) ; les dossiers « à ressort » du Finder (survoler
  pendant un glisser ouvre) [2].
- **Coût** : moyen (le format de glisser existe, `ITEM_MIME`, `dropZone`, `dragItem` de `commun/shell.js` ; un dépôt
  par outil sur son adresse d'entrée : `movie/?start=`, `upscale/?src=`, `objet/`). **Dépend de** : la proposition 10
  (dire ce que fera le dépôt).
- **Remplace** : `asset.md` 5 (en partie), `character.md` 7.

### 2. Espace : le coup d'œil partout — rapide

- **Aujourd'hui** : voir en grand demande d'ouvrir (fiche, visionneuse : 2 à 3 gestes, parfois une page) ; dans le
  panneau, impossible.
- **Proposé** : un seul composant commun : Espace sur la vignette survolée ou choisie, dans tout le portail, la montre
  en grand par-dessus la page (image, vidéo qui joue, son, modèle 3D qui tourne, première page d'un document) ; ← →
  pour les voisines ; Espace referme. Au survol simple : la vidéo défile sous la souris, l'objet tourne. 1 touche.
- **Ce que ça change pour Cal** : regarder ne coûte plus rien, nulle part.
- **Principe** : Coup d'œil (Quick Look) de macOS [2] ; le « Hover Scrub » de Premiere [3].
- **Coût** : petit à moyen (la visionneuse du fil, le lecteur commun, la visionneuse 3D existent : les réunir dans
  un module de `commun/`). **Dépend de** : la décision sur Espace dans Asset (aujourd'hui : choisir une carte).
- **Remplace** : `asset.md` 2 et 6, `character.md` 5 (en partie).

### 3. La palette de commandes — géniale

- **Aujourd'hui** : chaque action se trouve dans un menu « ⋯ », une barre, un bouton d'une autre page ; il faut
  savoir où elle est (2 à 4 gestes, parfois une page).
- **Proposé** : Ctrl+K ouvre une ligne au centre ; on tape ce qu'on veut : « agrandir », « animer », « mara »,
  « 16:9 », « nouvel objet », « préférences » ; elle propose les actions (sur l'objet survolé ou choisi), les outils,
  les assets (le panneau), les réglages, chacun avec sa touche ; Entrée fait. 2 à 3 gestes, quel que soit l'endroit,
  et on apprend les raccourcis en passant.
- **Ce que ça change pour Cal** : il dit ce qu'il veut au lieu de chercher où c'est ; c'est aussi la porte d'entrée
  naturelle de l'agent (« fais-en un objet 3D »).
- **Principe** : la palette de commandes de Visual Studio Code (« toutes les commandes, avec leurs raccourcis »)
  [4], les « Actions » de Figma (Ctrl+/) [5], Raycast ; les menus en commandes nommées existent déjà
  (`commun/menu.js`, le menu de repli, le registre des capacités de l'agent).
- **Coût** : moyen (un index des entrées de menu de chaque page — `pageMenu`, `contextMenu`, les menus du fil — et du
  panneau). **Dépend de** : rien ; l'agent s'y branche plus tard.

### 4. Le menu en étoile sur une vignette — géniale

- **Aujourd'hui** : clic droit, lire le menu (10 à 15 entrées), viser ; ou « ⋯ » au survol, puis l'entrée : 2 gestes
  et une lecture à chaque fois.
- **Proposé** : clic droit **tenu** sur une vignette : huit actions en étoile autour du pointeur, toujours aux mêmes
  places dans tous les outils (haut : réutiliser ; droite : animer ; bas : agrandir ; gauche : éditer ; et en
  diagonale : objet 3D, personnage, au montage, corbeille) ; on glisse vers l'action et on relâche. Le clic droit
  bref garde le menu d'aujourd'hui. Avec l'habitude, un coup de souris sans regarder.
- **Ce que ça change pour Cal** : les gestes qu'il fait cent fois par jour deviennent des mouvements de la main.
- **Principe** : les « marking menus » (Kurtenbach et Buxton) : un menu radial dont l'expert trace la direction sans
  attendre l'affichage ; mesurés jusqu'à plusieurs fois plus rapides qu'un menu linéaire [6].
- **Coût** : moyen (un composant de `commun/menu.js` ; les actions existent). **Dépend de** : la liste des huit
  actions (à fixer avec Cal ; les mêmes partout).

### 5. Un seul choix d'asset dans tout le portail — rapide

- **Aujourd'hui** : le « + » de quinze endroits ouvre la fenêtre `pick` (ses filtres « Tout, Images, Uploads »), pas
  le panneau.
- **Proposé** : `pick` devient le panneau ouvert pour cette place, filtré ; un double-clic pose. 2 gestes au lieu de
  4, une seule bibliothèque. Détail : `asset.md`, proposition 3.
- **Principe** : la cohérence (Nielsen, heuristique 4 [7]).
- **Coût** : petit à moyen. **Dépend de** : rien.

### 6. L'annulation au lieu des fenêtres « Oui » — rapide

- **Aujourd'hui** : 7 confirmations au studio (garder un visage, composer une planche…), la corbeille du fil d'Image
  avec confirmation alors que Ctrl+Z la rend.
- **Proposé** : partout où un geste peut se défaire, pas de fenêtre : le geste se fait, un bandeau « fait · annuler »
  reste quelques secondes ; un geste qu'on ne peut pas défaire (verrouiller un visage au studio) part **après** ce
  délai. 1 geste au lieu de 2 à chaque fois.
- **Ce que ça change pour Cal** : il ne lit plus d'avertissements qu'il connaît, et peut toujours revenir.
- **Principe** : Raskin, « Never Use a Warning When you Mean Undo » [8] ; la pile d'annulation du portail
  (`commun/undo.js`) le permet déjà presque partout.
- **Coût** : petit (retirer des `ask`/`confirm` ; un envoi différé pour le studio). **Dépend de** : rien.
- **Remplace** : `character.md` 2, `upscale.md` 5 (en partie).

### 7. Les mêmes touches sur une vignette, partout — rapide

- **Aujourd'hui** : des touches différentes d'un outil à l'autre, ou aucune.
- **Proposé** : sur la vignette survolée ou choisie, dans tous les outils : **Espace** voir, **F** aimer, **R**
  réutiliser, **V** une variante, **E** éditer, **U** agrandir, **A** animer, **O** faire un objet 3D, **Suppr**
  corbeille (Ctrl+Z), **?** la liste des touches ; les touches s'écrivent dans les menus et au survol des boutons.
  1 touche au lieu de 2 à 4 gestes.
- **Ce que ça change pour Cal** : ce qu'il apprend dans un outil marche dans tous les autres.
- **Principe** : la cohérence [7] ; les raccourcis à une touche des outils de tri (Lightroom, Premiere) ; la
  palette (proposition 3) qui les enseigne.
- **Coût** : petit (un module commun branché par `mountHeader` ; chaque outil dit ce que valent R, E…).
  **Dépend de** : la proposition 2 pour Espace ; ne jamais prendre une touche dans un champ de texte.
- **Remplace** : `image.md` 4.

### 8. « Et ensuite » : les suites d'un rendu — géniale

- **Aujourd'hui** : chaque étape attend qu'on revienne : générer → agrandir → animer ; l'image → ses vues → la 3D ;
  le visage → la tenue → la voix.
- **Proposé** : un rendu porte ses suites. Sur « Générer » (ou au clic droit d'un rendu en cours) : « puis agrandir
  en 4K », « puis animer », « puis en faire un objet 3D » ; chaque suite part quand l'étape d'avant est finie, et
  s'arrête si une étape demande l'œil de Cal (une vue à valider), en le disant. Les chaînes d'Object Creator et de
  Character Factory deviennent des suites par défaut.
- **Ce que ça change pour Cal** : il dit son intention une fois, part travailler ailleurs, et revient au résultat.
- **Principe** : « une intention → tout le pipeline » ; les étages de Character Factory, la file du portail qui sait
  déjà enchaîner des travaux (le rattrapage des copies, les paliers de l'agent).
- **Coût** : moyen à gros (une suite rangée avec le travail, relue au démarrage ; la garde du calcul à chaque étape).
  **Dépend de** : le lot « une intention → tout le pipeline » (`transverse-c.md`, l'agent entre les outils) — les
  suites sont la forme manuelle, sans agent, de la même chose.
- **Remplace** : `upscale.md` 2, `objet.md` 4, `character.md` 4 (leur mécanique commune).

### 9. Le zoom sémantique de toutes les grilles — géniale

- **Aujourd'hui** : le fil d'Image et de Vidéo, la page Asset, le panneau, le casting, la liste des objets ont chacun
  leur taille de vignettes, et rien d'autre ne change avec elle.
- **Proposé** : un même module de grille, un même geste (Ctrl+molette, pincer) et trois niveaux partout : **de
  loin** (mosaïque, pastilles d'état, regroupée par jour ou par projet), **la carte**, **de près** (la carte devient
  une petite fiche : prompt, références, variantes en éventail, 3D qui tourne, voix). Le nodal d'ODIO a déjà ce zoom
  pour ses tuiles ; le lot b le propose pour le temps (`transverse-b.md`).
- **Ce que ça change pour Cal** : un seul geste pour passer de « tout » à « ce détail », dans chaque outil.
- **Principe** : le zoom sémantique (Perlin et Fox 1993 [9] ; Bederson et Hollan 1994 [10]) ; « vue d'ensemble,
  zoom et filtre, détail à la demande » (Shneiderman 1996 [11]).
- **Coût** : gros (un module de grille commun, la grille fenêtrée du panneau et `commun/fil.js` à rapprocher).
  **Dépend de** : les piles (`asset.md` 7) et l'aperçu (proposition 2).
- **Remplace** : `asset.md` 1, `character.md` 8 (leur mécanique commune).

### 10. Le glisser dit ce qu'il va faire — rapide

- **Aujourd'hui** : une zone s'éclaire au survol ; ce qui arrivera au dépôt (remplacer la référence 2 ? l'ajouter ?
  copier l'objet dans ce Workspace ? importer un personnage ?) se découvre après.
- **Proposé** : pendant le glisser, une étiquette courte suit le pointeur et dit l'effet du dépôt à cet endroit :
  « remplace @image2 », « devient la première image », « copie dans Général », « importe Nora », « refusé : Z-Image ne
  prend pas d'image » ; Échap annule. 0 geste de plus, zéro surprise.
- **Ce que ça change pour Cal** : il ose glisser partout, puisqu'il sait avant de lâcher.
- **Principe** : le « feedforward » — montrer ce qu'une action va faire avant qu'on la fasse (Djajadiningrat,
  Overbeeke, Wensveen 2002 [12] ; Vermeulen et al., CHI 2013 [13]).
- **Coût** : petit (`dropZone` et les zones du panneau connaissent déjà leur effet et leurs refus). **Dépend de** :
  rien.

## 3. Le top 3 transverse

1. **Le glisser-déposer universel (1)** avec **le glisser qui dit ce qu'il va faire (10)** : porter une chose d'un
   outil à l'autre en un geste, sans surprise — la réponse directe à « le Multishot où l'on ne peut rien glisser ».
2. **« Et ensuite » : les suites d'un rendu (8)** : la mécanique commune aux trois chaînes (agrandir, l'objet 3D, le
   personnage) ; Cal dit une intention, la file fait la suite.
3. **La palette de commandes (3)** : une porte unique vers toutes les actions, qui accueillera l'agent.

## 4. Sources

1. B. Shneiderman, « Direct Manipulation: A Step Beyond Programming Languages », IEEE Computer, 1983.
2. Apple, « Coup d'œil sur Mac » : https://support.apple.com/guide/mac-help/mh14119/mac ; les dossiers à ressort :
   réglages du Finder.
3. Adobe, « Customize the Icon View in Project panel » (Hover Scrub) :
   https://helpx.adobe.com/premiere/desktop/get-started/customize-the-project-panel/customize-icon-view-in-project-panel.html
4. Visual Studio Code, « User Interface — Command Palette » : https://code.visualstudio.com/docs/getstarted/userinterface
5. Figma, « Actions » (menu des actions rapides, Ctrl+/) : aide de Figma, help.figma.com.
6. G. Kurtenbach, W. Buxton, « The limits of expert performance using hierarchic marking menus », CHI 1993 ;
   « User learning and performance with marking menus », CHI 1994.
7. J. Nielsen, « 10 Usability Heuristics for User Interface Design », 1994.
8. A. Raskin, « Never Use a Warning When you Mean Undo », A List Apart n° 241, 2007 :
   https://alistapart.com/article/neveruseawarning
9. K. Perlin, D. Fox, « Pad: An Alternative Approach to the Computer Interface », SIGGRAPH 1993.
10. B. Bederson, J. Hollan, « Pad++ », UIST 1994.
11. B. Shneiderman, « The Eyes Have It », 1996.
12. T. Djajadiningrat, K. Overbeeke, S. Wensveen, « But how, Donald, tell us how? On the creation of meaning in
    interaction design through feedforward and inherent feedback », DIS 2002.
13. J. Vermeulen, K. Luyten, E. van den Hoven, K. Coninx, « Crossing the bridge over Norman's gulf of execution:
    revealing feedforward's true identity », CHI 2013.
