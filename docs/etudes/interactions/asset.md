# Asset et son panneau — dix propositions d'interaction (09/10/2026)

Cal, 09/10 : « on veut des interactions simples, rapides, et on élimine des clics pour que tout soit fluide […] je
veux des features géniales, comme quand on travaille avec un zoom sémantique ; notre bibliothèque en accordéon est
aussi un truc génial ». Ce fichier est l'étude pour **Asset** : la page de la bibliothèque et son **panneau en
accordéon** (Ctrl+Espace) dans chaque outil. Pas de code : des propositions, chacune avec le geste d'aujourd'hui
compté, le geste proposé, le principe et sa source, le coût.

Les mots sont ceux du lexique commun : un élément, une référence, un rendu, un Workspace.

## 1. Ce qui a été mesuré

Un portail d'essai neuf (`tools/portail_essai.py 9031`, moteurs factices, un faux studio Character Factory),
Chromium sans affichage, un pilote qui fait les parcours et compte chaque geste : un clic, un champ rempli, une
touche, un glisser, un changement de page. Les attentes (un rendu, un import) sont à part. Un double-clic compte
deux clics. Le pilote, ses données et ses captures (sombre et clair) sont dans le scratchpad de la session :
`sr_a/parcours.mjs`, `sr_a/parcours_asset.mjs`, `sr_a/shots/*.png`, le tableau complet `sr_a/shots/parcours.txt`.

| parcours (aujourd'hui) | gestes | détail |
|---|---|---|
| retrouver une image (« plage ») et l'animer dans Vidéo | **6** | chercher, double-clic, « Animer », 2 pages |
| voir le modèle 3D d'un objet | **5** | double-clic, « Ouvrir dans Object Creator », 2 pages — la fiche d'Asset n'a qu'une ligne de texte |
| faire un personnage de deux images | **6**, puis **2** | clic, Ctrl+clic, « Faire un élément », le nom, « Créer » ; les deux images arrivent en « visage » : corriger le rôle de la seconde |
| ranger trois images dans un dossier neuf | **6** | clic, Maj+clic, « Créer un dossier », le nom, Entrée |
| ranger une carte dans un dossier existant | **1** | un glisser sur le dossier de l'arbre |
| importer un personnage de Character Factory | **3** + 1 attente | « ⋯ », « Importer de Character Factory… », « Importer » |
| poser une référence depuis le panneau (dans Image) | **5** | Ctrl+Espace, chercher, double-clic, Ctrl+Espace |

Ce qui est déjà bien, et qu'on garde : le glisser sur un dossier ou un Workspace de l'arbre (un geste) ; la
sélection de la grille (clic, Ctrl, Maj, la zone tirée sur le fond) ; l'annulation de tout ; le panneau qui pousse
la page au lieu de la couvrir ; ses filtres qui suivent la zone active de l'outil ; un double-clic qui pose ; un
glisser du panneau sur l'outil ; la vidéo qui joue en muet au survol d'une carte de la page.

Les frictions vues (captures annotées : `sr_a/shots/annote_asset_objet.png`, `annote_asset_selection.png`,
`annote_panneau_vues.png`) :
- **Un objet 3D ne se voit pas dans Asset** : la fiche montre l'image, une ligne « mesh-001.glb · 12 faces », et un
  bouton vers Object Creator — 5 gestes et 2 pages pour voir le modèle. C'est la friction citée par Cal.
- **Deux bibliothèques** : le « + » d'Image, de Vidéo, d'Upscale, d'Object Creator et de la fiche d'un élément
  ouvre une **autre** fenêtre de choix (`pick` de `commun/shell.js`, 15 appels), avec ses propres filtres
  (« Tout, Images, Uploads »), au lieu du panneau.
- **Le bruit des brouillons** : les vues proposées d'un objet (« Valise · droite · 270° », « Valise · dos ·
  180° »…) arrivent comme des images de la bibliothèque, dans la page et dans le panneau, gardées ou non.
- **La fenêtre « élément » donne un seul rôle à toutes les images** : un visage et un plein pied arrivent tous deux
  en « visage ».
- **La barre de sélection a 11 boutons**, et son orange est « Télécharger », rarement le geste suivant.
- **Le panneau n'a aucun aperçu au survol** : ni vidéo qui joue, ni son, ni 3D ; il faut poser pour voir.
- **La taille des vignettes ne change que la taille** : de loin comme de près, la carte dit la même chose.

## 2. Les dix propositions

« Géniale » : ça change la façon de travailler. « Rapide » : ça enlève des clics tout de suite.

### 1. Le zoom sémantique de la bibliothèque — géniale

- **Aujourd'hui** : le curseur « taille » agrandit les cartes, rien de plus ; pour savoir d'où vient une image,
  ses références ou ses variantes, on ouvre sa fiche (double-clic, une page, Échap : 3 gestes par objet).
- **Proposé** : ce que montre une carte dépend du zoom (Ctrl+molette ou pincer, le curseur aussi). **De loin** :
  une mosaïque serrée, rangée par jour et par projet, la sorte en pastille de couleur, rien d'écrit. **À mi-chemin** :
  les cartes d'aujourd'hui. **De près** : la carte devient une petite fiche — le prompt, les références en vignettes,
  les variantes de la même demande en éventail, la vidéo qu'on fait défiler au survol, le modèle 3D qui tourne, la
  voix d'un personnage à un clic. 0 geste pour lire ce qu'il fallait ouvrir.
- **Ce que ça change pour Cal** : on survole toute la bibliothèque d'un coup d'œil, puis on « plonge » dans un coin
  sans jamais changer de page.
- **Principe** : le zoom sémantique — un objet change de représentation selon l'échelle, pas seulement de taille
  (Pad, Perlin et Fox 1993 [1] ; Pad++, Bederson et Hollan 1994 [2]) ; « une vue d'ensemble d'abord, zoomer et
  filtrer, le détail à la demande » (Shneiderman 1996 [3]). Le nodal d'ODIO le fait déjà pour ses tuiles.
- **Coût** : moyen (la grille de `asset/asset.js` et sa carte ; les données sont déjà dans l'objet public).
  **Dépend de** : la proposition 2 pour la 3D au survol.

### 2. La 3D, la voix et la vidéo se voient sur place — rapide

- **Aujourd'hui** : voir le modèle d'un objet = 5 gestes, 2 pages (la fiche, puis Object Creator) ; entendre la
  voix d'un personnage = ouvrir sa fiche ; dans le panneau, rien ne se voit avant d'être posé.
- **Proposé** : la fiche d'un objet montre son modèle en grand, qu'on tourne à la souris (la visionneuse existe :
  `character/viewer.html?embed=1`, déjà prise par l'objet 3D d'Idéation). Au survol d'une carte, dans la page et dans
  le panneau : la vidéo défile sous la souris (gauche = début, droite = fin), un son joue, un objet tourne lentement.
  Voir la 3D : 2 gestes (double-clic) au lieu de 5, 0 au survol.
- **Ce que ça change pour Cal** : on reconnaît un objet, un plan, une voix sans l'ouvrir ; l'objet 3D cesse d'être
  « un fichier GLB ».
- **Principe** : l'aperçu au survol des vignettes vidéo de Premiere (« Hover Scrub », Icon view, depuis CS6 [4]) ;
  Coup d'œil de macOS pour le reste (proposition 6).
- **Coût** : petit pour la fiche (la visionneuse existe) ; moyen pour le survol 3D du panneau (une seule
  visionneuse partagée, posée sous la souris, pour ne pas en monter cent). **Dépend de** : three.js chargé par la
  visionneuse (il l'est sur les DGX ; le conteneur cloud ne l'atteint pas).

### 3. Un seul choix d'asset : le panneau — rapide

- **Aujourd'hui** : le « + » d'une barre ou d'une fiche ouvre une seconde bibliothèque en fenêtre (4 gestes :
  « + », chercher ou défiler, cliquer, « Prendre »), avec d'autres filtres que ceux du panneau.
- **Proposé** : tout « + » qui attend un asset ouvre le panneau, filtré pour cette place (« une image pour la
  référence 2 ») ; un double-clic pose, Échap referme. 2 gestes (« + », double-clic) au lieu de 4, une seule façon
  de chercher dans tout le portail.
- **Ce que ça change pour Cal** : une seule bibliothèque à connaître ; ses favoris, ses récents, Character Factory
  sont là partout.
- **Principe** : la cohérence (« le même geste, la même chose », Nielsen, heuristique 4 [5]) ; le navigateur unique
  d'Ableton Live, qui sert aussi à remplacer un appareil (proposition 4).
- **Coût** : petit à moyen (`pick` devient une façade du panneau : `dock.open` + `dock.contexte`, une promesse
  résolue au double-clic ; 15 appels). **Dépend de** : rien.

### 4. Remplacer sur place (« hot-swap ») — rapide

- **Aujourd'hui** : changer une référence d'Image ou de Vidéo = la retirer (2 clics), en poser une autre (panneau :
  4 à 5 gestes), la remettre à sa place (glisser).
- **Proposé** : un clic sur une référence (ou une place `@image2`) met le panneau en **remplacement** : il s'ouvre
  filtré sur sa sorte, le fil de la place clignote ; un double-clic remplace, la place et son jeton ne bougent pas ;
  on peut en essayer plusieurs à la suite, Échap garde la dernière. 2 gestes au lieu de 7.
- **Ce que ça change pour Cal** : essayer trois décors pour la même image devient un geste répété, sans rien
  défaire.
- **Principe** : le « Hot-Swap » d'Ableton Live : le navigateur se met en mode remplacement pour l'appareil choisi,
  chaque double-clic remplace, on écoute, on garde [6].
- **Coût** : petit (la règle des places de `commun/refs.js` existe ; un mode du panneau). **Dépend de** : la
  proposition 3.

### 5. Le panneau s'ouvre tout seul quand il sert — rapide

- **Aujourd'hui** : Ctrl+Espace pour l'ouvrir, puis pour le fermer (2 touches à chaque pose) ; glisser un fichier du
  bureau vers une zone ne l'ouvre pas.
- **Proposé** : quand on glisse quelque chose vers le bord gauche, le panneau s'ouvre sous le pointeur, et ses
  sections s'ouvrent au survol (comme un dossier qui s'ouvre quand on le survole avec un fichier) ; quand une place
  vide reçoit le focus, la languette verte dit « choisir ici » ; il se replie seul après une pose si on l'avait ouvert
  pour elle. 0 touche au lieu de 2.
- **Ce que ça change pour Cal** : le panneau est là au moment du geste, jamais entre lui et la page.
- **Principe** : les dossiers « à ressort » du Finder (survoler un dossier pendant un glisser l'ouvre) [7] ; la
  divulgation progressive.
- **Coût** : petit (`commun/dock.js` : un `dragenter` sur la languette ; le contexte des zones existe).
  **Dépend de** : rien.

### 6. Espace : voir en grand sans ouvrir — rapide

- **Aujourd'hui** : regarder une image en grand = double-clic, la fiche (une page), Échap : 3 gestes ; dans le
  panneau, impossible.
- **Proposé** : Espace sur la carte survolée ou choisie (page, panneau, fil) montre l'objet en grand par-dessus
  la page ; ← → passent au suivant ; Espace referme. Une vidéo joue, un son joue, un objet tourne, un document
  montre sa première page. 1 touche au lieu de 3 gestes.
- **Ce que ça change pour Cal** : choisir entre dix images proches se fait au clavier, en une seconde chacune.
- **Principe** : Coup d'œil (Quick Look) du Finder : Espace prévisualise l'élément choisi sans l'ouvrir, les flèches
  passent aux suivants [7].
- **Coût** : petit (la visionneuse du fil, `commun/fil.js`, et le lecteur commun existent). **Dépend de** : la
  proposition 2 pour la 3D. Espace sert aujourd'hui à « choisir » une carte au clavier : la sélection passe à
  Ctrl+Espace… qui ouvre le panneau. À trancher : X pour choisir (comme Gmail).

### 7. Les piles : une demande, une carte — géniale

- **Aujourd'hui** : quatre images d'une même demande, les vues candidates d'un objet, les essais refaits arrivent
  chacun en carte ; le dossier « Objets » se remplit de « Voiture rouge · gauche · 90° » que personne n'a gardées.
- **Proposé** : les objets d'une même lignée se rangent en **pile** : une carte (la meilleure, ou la plus récente),
  un chiffre « 4 », un clic sur le chiffre les déplie en éventail sur place, un autre les replie. Les vues candidates
  et les essais non gardés restent dans leur outil (des brouillons, comme les essais de l'atelier d'Image) et
  n'entrent pas dans la bibliothèque. La grille montre trois à quatre fois moins de cartes.
- **Ce que ça change pour Cal** : la bibliothèque montre ce qu'il a fait, pas tout ce que la machine a essayé.
- **Principe** : les piles de Lightroom Classic (photos regroupées, la première en couverture) et les rafales de
  Photos d'Apple ; les essais qui ne sont pas des objets tant qu'on ne les valide pas (l'atelier d'Image, déjà).
- **Coût** : moyen (la lignée `parents` existe ; les vues d'objet en brouillons demandent une retouche de
  `server/tools/objet_vues.py`). **Dépend de** : l'accord de Cal sur « ce qui n'est pas gardé n'est pas dans Asset ».

### 8. Le personnage juste du premier coup — rapide

- **Aujourd'hui** : « Faire un élément » donne le même rôle à toutes les images (un visage, un plein pied : deux
  « visage ») ; corriger = 2 clics par image, dans la fiche.
- **Proposé** : chaque image reçoit son rôle d'elle-même : la forme (portrait serré → visage, en pied → plein pied),
  puis le modèle qui voit, s'il est là (il classe déjà les images d'Object Creator) ; la fenêtre montre les rôles
  proposés en pastilles qu'un clic change. La sorte (personnage, objet, lieu) est proposée de même. 6 gestes au lieu
  de 8, sans correction après coup.
- **Ce que ça change pour Cal** : la planche est dans le bon ordre pour les modèles sans qu'il y pense.
- **Principe** : les défauts intelligents — l'outil propose, la personne corrige d'un clic (l'« Autopilot » de Topaz
  analyse l'image et choisit les réglages, signalés par une pastille, qu'on peut reprendre [8]).
- **Coût** : petit pour la forme (le rapport largeur / hauteur) ; moyen pour le modèle qui voit (le travail
  `objet.classer` existe, avec ses classes à adapter). **Dépend de** : le modèle qui voit sur DGX1, sinon la forme seule.

### 9. Les dossiers qui se remplissent seuls — rapide

- **Aujourd'hui** : retrouver « les personnages sans voix » ou « les images aimées de cette semaine » = poser trois
  filtres à chaque fois (3 à 4 clics), qui se perdent au changement de lieu.
- **Proposé** : « Garder cette recherche » transforme les filtres et la recherche du moment en dossier de l'arbre,
  avec une pastille ; il se remplit seul (un objet qui gagne une voix en sort). 1 clic au lieu de 4, chaque fois.
- **Ce que ça change pour Cal** : ses tris de travail (« à animer », « à refaire ») existent sans rien ranger à la main.
- **Principe** : les « Smart Bins » de DaVinci Resolve : des chutiers définis par des règles sur les métadonnées, qui
  se remettent à jour quand les métadonnées changent [9].
- **Coût** : petit à moyen (les filtres de `GET /api/library` existent ; un dossier = une requête rangée par
  personne, dans les préférences). **Dépend de** : rien.

### 10. La barre de sélection qui devine — rapide

- **Aujourd'hui** : 11 boutons à lire (Tout, Télécharger, Créer un dossier, Déplacer, Favori, Tags, Faire un
  élément, Agrandir, Ajouter au montage, Corbeille, ×), l'orange sur « Télécharger ».
- **Proposé** : quatre boutons selon ce qui est choisi, le plus probable en orange — deux images ou plus :
  **Faire un élément** ; une image : **Animer** ; une vidéo : **Ajouter au montage** ; un son : **Donner comme
  voix** — puis « Ranger ▾ » et « ⋯ » (le reste, avec leurs touches) ; chaque bouton suit la sorte. Lire 4 boutons au
  lieu de 11.
- **Ce que ça change pour Cal** : la barre dit la suite logique au lieu de tout dire ; la règle « un seul orange =
  l'action » y retrouve son sens.
- **Principe** : la loi de Hick-Hyman — le temps de choix croît avec le nombre d'options [10] ; la divulgation
  progressive.
- **Coût** : petit (`paintSelBar` de `asset/asset.js`). **Dépend de** : rien.

## 3. Le top 3 d'Asset

1. **La 3D, la voix et la vidéo se voient sur place (2)** : la friction citée par Cal disparaît, pour un coût
   petit (la visionneuse existe) ; c'est aussi la base du zoom sémantique.
2. **Un seul choix d'asset : le panneau (3)**, avec **le remplacement sur place (4)** : une seule bibliothèque dans
   tout le portail, 2 gestes au lieu de 4 à 7.
3. **Le zoom sémantique de la bibliothèque (1)** : la proposition « géniale », celle qui change la façon de
   chercher ; à faire après 2 et 7 (les piles), qui lui donnent quoi montrer de près.

## 4. Sources

1. K. Perlin, D. Fox, « Pad: An Alternative Approach to the Computer Interface », SIGGRAPH 1993.
2. B. Bederson, J. Hollan, « Pad++: A Zooming Graphical Interface for Exploring Alternate Interface Physics »,
   UIST 1994.
3. B. Shneiderman, « The Eyes Have It: A Task by Data Type Taxonomy for Information Visualizations », IEEE
   Symposium on Visual Languages, 1996.
4. Adobe, « Customize the Icon View in Project panel » (Hover Scrub, Maj+H) :
   https://helpx.adobe.com/premiere/desktop/get-started/customize-the-project-panel/customize-icon-view-in-project-panel.html
5. J. Nielsen, « 10 Usability Heuristics for User Interface Design », Nielsen Norman Group, 1994 (4 : cohérence et
   standards).
6. Ableton Live, le mode Hot-Swap du navigateur (manuel de Live, « Hot-Swapping Presets » ; décrit aussi par Sound
   on Sound : https://www.soundonsound.com/techniques/presets) — page officielle du manuel non relue ici.
7. Apple, « Afficher des fichiers et des dossiers avec Coup d'œil sur Mac » :
   https://support.apple.com/guide/mac-help/mh14119/mac ; les dossiers à ressort : Préférences du Finder.
8. Topaz Labs, « Autopilot & Configuration » : https://docs.topazlabs.com/topaz-photo/functions/autopilot-and-configuration
9. Blackmagic Design, manuel de DaVinci Resolve, « Automated organization using Smart Bins » (lu sur un miroir du
   manuel 18.6 : https://www.steakunderwater.com/VFXPedia/__man/Resolve18-6/DaVinciResolve18_Manual_files/part507.htm).
10. W. E. Hick, « On the rate of gain of information », Quarterly Journal of Experimental Psychology, 1952 ;
    R. Hyman, « Stimulus information as a determinant of reaction time », 1953.
