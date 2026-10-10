# Object Creator — dix propositions d'interaction (09/10/2026)

Cal, 09/10 : « on veut des interactions simples, rapides […] un objet 3D cliqué dans Asset ouvre un visualiseur
vide, puis il faut encore cliquer pour Object Creator ». Ce fichier est l'étude pour **Object Creator**
(`objet/`) : une image → ses vues proposées → la 3D → ses rendus → la planche pour une vidéo. Pas de code : des
propositions, chacune avec le geste d'aujourd'hui compté, le geste proposé, le principe et sa source, le coût. La
friction d'Asset (voir l'objet 3D) est traitée dans `asset.md`, proposition 2.

## 1. Ce qui a été mesuré

Le même portail d'essai et le même pilote que pour Asset (`asset.md` § 1 ; `sr_a/parcours.mjs`, captures
`sr_a/shots/objet_*.png`, `x_objet_*.png`). Générateurs factices (des mires qui disent l'angle), les mêmes gestes.

| parcours (aujourd'hui) | gestes | détail |
|---|---|---|
| un objet neuf, d'une image de la bibliothèque, jusqu'à la planche | **12** + 3 attentes | « Nouvel objet », « Dans la bibliothèque », l'image, « Prendre », « Créer l'objet », « Générer 3 vues », « Garder » ×3, « Tirer la 3D », « Faire les rendus », « Faire la planche » |
| la même chose quand l'image n'existe pas encore | **+ 6** et 2 pages | « La créer dans Image ↗ », le prompt, « Générer », attendre, revenir, la choisir |
| voir le modèle 3D depuis Asset | **5** | double-clic, « Ouvrir dans Object Creator », 2 pages |
| dire d'où l'image voit l'objet | **2** | un des 8 points de la boussole, une des 4 hauteurs |

Ce qui est déjà bien, et qu'on garde : le plan des vues prêt dès l'arrivée de l'image ; « une image déposée
n'importe où sur la page » fait un objet ; une image déposée sur une place la remplit ; chaque vue se garde, se
refait, se rejette, avec son contraire (Ctrl+Z) ; l'affinage depuis la vue gardée la plus proche ; un seul orange,
celui de l'étape suivante ; les repères image · vues · 3D · rendus · planche en haut de la fiche ; les factices
étiquetés qui montrent tout le parcours.

Les frictions vues :
- **Chaque étape attend un clic** : les vues ne partent pas seules, la 3D attend qu'on revienne, les rendus et la
  planche aussi ; 3 attentes que Cal doit surveiller.
- **Garder une vue = viser trois petits boutons** sous chaque carte (Garder, Refaire, Rejeter), une carte à la fois.
- **Les vues candidates entrent dans la bibliothèque** (le dossier « Objets » d'Asset, le panneau de chaque outil :
  « Valise · droite · 270° », gardées ou non — capture annotée `sr_a/shots/annote_panneau_vues.png`, repère 1).
- **L'image de départ se fait ailleurs** : « La créer dans Image ↗ » quitte l'outil, il faut revenir et la choisir.
- **La boussole et la 3D sont séparées** : les vues sont des cartes en liste, l'angle un point sur un petit cercle,
  le modèle dans un autre bloc ; on ne voit pas d'un coup quels côtés manquent.
- **« Refaire » refait à l'aveugle** : on ne peut pas dire ce qui ne va pas dans une vue.
- **Le « + » de l'image ouvre une autre bibliothèque** que le panneau (`asset.md`, proposition 3).

## 2. Les dix propositions

### 1. Un objet 3D d'un geste, depuis n'importe quelle image — rapide

- **Aujourd'hui** : depuis la page : 5 gestes avant que les vues soient prêtes à partir (« Nouvel objet », « Dans la
  bibliothèque », l'image, « Prendre », « Créer ») ; depuis le fil d'Image ou Asset : pas d'entrée directe (« Créer
  un élément › objet » fait l'élément, sans ses vues).
- **Proposé** : « Faire un objet 3D » au clic droit de toute image (fil, Asset, panneau, planche d'Idéation) : l'objet
  est créé, nommé d'après l'image, ses vues partent ; une bulle « Valise : vues en cours · ouvrir » mène à sa fiche.
  1 geste au lieu de 5 à 7, sans quitter l'outil.
- **Ce que ça change pour Cal** : l'idée « j'en veux un objet » se dit là où l'on regarde l'image.
- **Principe** : « une intention → tout le pipeline » ; les actions contextuelles portées par l'objet (le menu commun
  de `commun/menu.js`).
- **Coût** : petit (`POST /api/objet/objects` puis `…/vues/generer` existent). **Dépend de** : la proposition 2.

### 2. Les vues partent seules à l'arrivée — rapide

- **Aujourd'hui** : le plan est prêt, mais il faut cliquer « Générer 3 vues » et rester pour voir.
- **Proposé** : à la création, les quatre vues principales partent seules (préférence de l'outil, allumée
  d'office) ; la fiche montre leurs places en cours. 1 clic de moins, et l'attente commence sans Cal.
- **Ce que ça change pour Cal** : il revient à un objet dont les vues attendent son œil.
- **Principe** : les défauts intelligents ; Character Factory fait déjà naître ses quatre visages sans demander.
- **Coût** : petit (un appel de plus à la création ; la garde du calcul juge déjà la place). **Dépend de** : la file
  (quatre travaux GPU) ; la préférence pour l'éteindre.

### 3. Garder au clavier, ou tout garder — rapide

- **Aujourd'hui** : « Garder » ×3 (ou ×4), chacun sous sa carte, un petit bouton à viser.
- **Proposé** : la vue choisie est en grand ; G garde, X rejette, R refait, et la suivante vient seule ; « Tout
  garder » garde les vues proposées d'un clic (Ctrl+Z défait). 3 touches, ou 1 clic.
- **Ce que ça change pour Cal** : valider un objet prend dix secondes, l'œil sur l'image, pas sur les boutons.
- **Principe** : le tri à une touche avec avance automatique de Lightroom Classic (P, X, puis l'image suivante) [1] ;
  la loi de Fitts — un grand objet proche se vise plus vite qu'un petit bouton [2].
- **Coût** : petit (`slotAction` existe ; le clavier et une vue en grand). **Dépend de** : rien.

### 4. La chaîne qui continue seule — géniale

- **Aujourd'hui** : après les vues gardées : « Tirer la 3D », attendre, « Faire les rendus », attendre, « Faire la
  planche », attendre — 3 clics, 3 attentes surveillées.
- **Proposé** : dès que les vues principales sont décidées, la chaîne fait la suite : la 3D, ses rendus, la planche ;
  chaque étape finie s'allume dans les repères du haut ; une étape qu'il faut regarder (une 3D ratée) arrête la
  chaîne et le dit. « Pas la 3D » au clic droit des repères pour s'arrêter avant. 0 clic après les vues.
- **Ce que ça change pour Cal** : Object Creator devient « une image entre, un objet prêt pour la vidéo sort » ; il
  ne décide que ce que lui seul peut décider (les vues).
- **Principe** : « une intention → tout le pipeline » ; l'« atelier » de Character Factory, qui fait le reste tout
  seul pendant qu'on travaille (« le reste se fait tout seul », casting) ; ne demander à la personne que les
  décisions de goût.
- **Coût** : moyen (un enchaînement de travaux côté serveur, rejoué à la lecture du plan, comme `objet_vues.normalize`
  déduit déjà l'état de la file). **Dépend de** : la place GPU (TRELLIS.2 ≈ 2 min 20 sur DGX2) ; l'accord de Cal sur
  la 3D lancée sans lui.

### 5. La fiche en orbite — géniale

- **Aujourd'hui** : l'image à gauche, les vues en cartes dans une liste, la boussole en petit (8 points, 4 hauteurs),
  la 3D dans un autre bloc ; « + une vue » par un menu d'angles.
- **Proposé** : le modèle (ou l'image, tant qu'il n'existe pas) au centre ; autour, un cercle : chaque vue posée à
  son angle (la face en bas, le côté gauche à droite, comme la boussole d'aujourd'hui), le dessus au-dessus ; une place
  vide est un « + » à son angle ; un clic sur un « + » génère cette vue ; une image glissée sur le cercle devient la
  vue de l'angle où on la lâche. Zoomer sur une vue l'agrandit sur place (ses gestes Garder · Refaire · Rejeter) ;
  dézoomer montre tout l'objet d'un coup.
- **Ce que ça change pour Cal** : on voit d'un regard quels côtés manquent, et on les demande en montrant l'endroit.
- **Principe** : la manipulation directe — l'objet et ses vues ont la forme de ce qu'ils représentent (Shneiderman
  1983 [3]) ; le zoom sémantique (Bederson et Hollan, Pad++ 1994 [4]) ; les vues de face, de côté, de dos des logiciels
  3D (le cube de vue de Blender ou de Fusion).
- **Coût** : moyen (la page `objet/objet.js` ; les angles `az` et `el` de chaque place existent). **Dépend de** :
  la visionneuse 3D (three.js) pour le centre ; sans elle, l'image.

### 6. Tourner le modèle pour dire sa face — rapide

- **Aujourd'hui** : la face du modèle 3D se choisit dans une liste (0°, 90°, 180°, 270°), sans voir le modèle tourner.
- **Proposé** : dans la visionneuse, on tourne le modèle à la souris jusqu'à le voir de face, puis « C'est la face »
  (1 clic) ; la planche et les rendus suivent.
- **Ce que ça change pour Cal** : il corrige la face en la regardant, pas en devinant un angle.
- **Principe** : la manipulation directe [3] ; régler par le résultat plutôt que par un nombre.
- **Coût** : petit (la visionneuse existe ; `POST …/face` existe). **Dépend de** : three.js chargé (sur les DGX).

### 7. Les vues candidates restent dans l'outil — rapide

- **Aujourd'hui** : chaque vue proposée devient une image de la bibliothèque (dossier « Objets ») et apparaît dans le
  panneau de tous les outils, gardée ou non.
- **Proposé** : une vue proposée est un brouillon de l'objet (comme un essai de l'atelier d'Image) ; seule une vue
  gardée entre dans la bibliothèque, comme référence de l'élément. 0 geste, une bibliothèque sans bruit.
- **Ce que ça change pour Cal** : le panneau montre ses images, pas les mires et les vues ratées.
- **Principe** : un essai n'est pas un objet tant qu'on ne le valide pas (la règle de l'atelier d'Image : « Valider
  en fait UN ») ; la bibliothèque comme lieu de ce qu'on garde.
- **Coût** : moyen (`server/tools/objet_vues.py` : les images des vues hors de `library`, puis copiées à la garde ;
  les selftests à suivre). **Dépend de** : la décision de Cal (la même que `asset.md`, proposition 7).

### 8. L'image de départ faite dans la fenêtre — rapide

- **Aujourd'hui** : pas d'image : « La créer dans Image ↗ » (une page), le prompt, « Générer », attendre, revenir
  (une page), « Nouvel objet », la choisir : ≈ 10 gestes, 2 pages.
- **Proposé** : la fenêtre « Nouvel objet » a un champ « décris-le » ; « Proposer » fait quatre images (Krea 2,
  l'objet entier sur fond simple : ce que la chaîne attend) ; un clic sur une image la prend, le nom vient de la
  phrase. 4 gestes, 0 page.
- **Ce que ça change pour Cal** : « une valise de cuir usée » devient un objet sans passer par un autre outil.
- **Principe** : « une intention → tout le pipeline » ; la naissance d'un personnage dans Character Factory (une
  phrase, puis quatre visages).
- **Coût** : moyen (un lot d'images d'Image avec une consigne fixe ; la fenêtre suit le travail). **Dépend de** : la
  voie image libre ; le choix de Krea 2 pour l'image de départ (déjà conseillé par la chaîne, étape 01).

### 9. Refaire en disant ce qui ne va pas — rapide

- **Aujourd'hui** : « Refaire » relance la vue avec une autre graine, sans rien savoir du défaut.
- **Proposé** : « Refaire… » ouvre une ligne sous la vue : « la poignée est du mauvais côté » ; la phrase part avec
  la vue (le modèle d'édition prend une consigne). 2 gestes au lieu d'une série de « Refaire » au hasard.
- **Ce que ça change pour Cal** : il corrige une vue comme il le dirait à quelqu'un.
- **Principe** : la consigne en langage courant des modèles d'édition (Qwen-Image-Edit, déjà utilisé pour les vues).
- **Coût** : petit à moyen (la consigne ajoutée au graphe d'angle). **Dépend de** : l'effet réel d'une consigne sur
  le LoRA d'angles (non mesuré) ; la génération depuis un rendu du modèle (AnyAngle) la prendrait de même.

### 10. Une variante de l'objet en une phrase — géniale

- **Aujourd'hui** : la même valise en rouge = tout refaire : une image dans Image, un objet neuf, ses vues, la 3D
  (≈ 18 gestes, 2 pages, 4 attentes).
- **Proposé** : « Variante… » sur la fiche : « en cuir rouge » ; l'image choisie et les vues gardées passent par la
  même consigne (même graine), puis la chaîne (proposition 4) refait la 3D, les rendus, la planche ; l'objet neuf est
  rangé à côté de l'autre, en pile. 2 gestes.
- **Ce que ça change pour Cal** : une gamme d'accessoires (trois couleurs, deux usures) se fait comme on décline une
  image.
- **Principe** : les variantes d'un composant (Figma : les « variants » d'un composant, une propriété qui change) ;
  le bracketing appliqué à un objet.
- **Coût** : gros (une édition cohérente de toutes les vues, puis la chaîne). **Dépend de** : la cohérence d'une même
  consigne sur des vues différentes (non mesurée ; c'est le point à essayer d'abord sur deux vues).

## 3. Le top 3 d'Object Creator

1. **La chaîne qui continue seule (4)**, avec **les vues qui partent seules (2)** : Cal ne décide plus que les vues ;
   l'objet est prêt pour la vidéo quand il revient.
2. **Garder au clavier, ou tout garder (3)** : le seul vrai geste de la chaîne devient rapide.
3. **La fiche en orbite (5)** : la « géniale » — l'objet et ses côtés vus d'un coup, demander une vue en montrant
   son angle.

## 4. Sources

1. Lightroom Classic, l'avance automatique après un drapeau ou une note (menu Photo → Avance automatique) — relevé
   sur des guides et le forum d'Adobe (https://lightroomkillertips.com/faster-culling-images/), page officielle non
   relue.
2. P. M. Fitts, « The information capacity of the human motor system in controlling the amplitude of movement »,
   Journal of Experimental Psychology, 1954.
3. B. Shneiderman, « Direct Manipulation: A Step Beyond Programming Languages », IEEE Computer, 1983.
4. B. Bederson, J. Hollan, « Pad++: A Zooming Graphical Interface for Exploring Alternate Interface Physics »,
   UIST 1994.
