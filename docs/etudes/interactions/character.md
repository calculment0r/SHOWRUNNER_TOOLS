# Character Factory — dix propositions d'interaction (09/10/2026)

Cal, 09/10 : « on veut des interactions simples, rapides, et on élimine des clics ». Ce fichier est l'étude pour
**Character Factory** dans le portail (`character/` : le casting, la fiche, ses étapes ; le studio sur DGX1) et
pour le passage d'un personnage vers les autres outils (le panneau Asset, sa section Character Factory). Pas de
code : des propositions, chacune avec le geste d'aujourd'hui compté, le geste proposé, le principe et sa source, le
coût.

## 1. Ce qui a été mesuré

Le même portail d'essai que pour Asset (`asset.md` § 1), relié à un **faux studio** (`sr_a/faux_cf.py` : Nora,
habillée ; Ilan, quatre visages à choisir), et le même pilote (`sr_a/parcours.mjs`, captures
`sr_a/shots/character_*.png`, `x_character_*.png`). Le faux studio ne calcule rien : les parcours longs (naître,
habiller, la voix, la planche) sont lus dans le code (`character/js/studio.js`, `nextDecision`) et marqués « lu ».

| parcours (aujourd'hui) | gestes | détail |
|---|---|---|
| choisir le visage d'un personnage en audition | **5** | l'affiche, un visage, « Choisir ce visage », « Oui » (une fenêtre), une page |
| poser Nora en référence dans Image | **5** + 1 attente | Ctrl+Espace, la section Character Factory, double-clic (l'import, ≈ 2 s), fermer |
| importer un personnage depuis Asset | **3** + 1 attente | « ⋯ », « Importer de Character Factory… », « Importer » |
| un personnage, du nom à sa planche | **≈ 18** + 4 attentes (lu) | le nom, « Créer », sa phrase, « Le faire naître », un visage, « Choisir », « Oui », « L'habiller », sa tenue en mots, « L'habiller », un plein pied, « Choisir », « Choisir sa voix », « Quatre voix », une voix, la garder, « Composer sa planche », « Oui » |
| le rendre utilisable ailleurs | **+ 3** | l'importer (ci-dessus) ; le remettre à jour : « Mettre à jour depuis le studio » sur sa fiche d'Asset |

Ce qui est déjà bien, et qu'on garde : le casting en affiches et « Ce qui attend » ; une phrase pour naître ; la
fiche où tout est sous les yeux, un seul orange — la prochaine décision de goût ; les crans visage · tenue ·
expressions · voix · 3D ; l'atelier qui calcule en arrière-plan ; un personnage glissé du panneau importé au dépôt.

Les frictions vues :
- **Choisir un visage demande trois gestes et une fenêtre** (un clic sur le visage, l'orange, « Oui ») ; la fenêtre
  revient à la planche.
- **Chaque étape attend Cal** : après le visage, « L'habiller » ; après la tenue, « Choisir sa voix », « Quatre
  voix » ; puis « Composer sa planche » — alors que la phrase de naissance dit souvent déjà la tenue et la voix.
- **Un personnage n'est pas un élément tant qu'on ne l'importe pas**, et l'élément ne suit pas le studio : il faut
  penser à « Mettre à jour depuis le studio ».
- **Les directions du visage** (plus âgé, plus jeune, plus dur, autre coiffure…) sont dans le « Plein cadre », pas
  sur la fiche.
- **Une tenue part d'un fichier du disque** (« + une photo de vêtement ») ; une image de la bibliothèque n'y va pas.
- **Faire naître depuis une image** du fil ou d'Asset : aller au casting, nommer, puis chercher la photo sur le disque.

## 2. Les dix propositions

### 1. Naître d'une image, depuis partout — rapide

- **Aujourd'hui** : Character Factory (une page), le nom, « Créer », la photo de départ (un fichier du disque), la
  phrase, « Le faire naître » : 6 gestes ; une image du fil d'Image doit d'abord être téléchargée.
- **Proposé** : « Faire un personnage » au clic droit d'une image (fil, Asset, panneau, planche d'Idéation) : la
  naissance s'ouvre avec la photo posée et le nom proposé ; on écrit la phrase, « Le faire naître ». 3 gestes.
- **Ce que ça change pour Cal** : une tête trouvée en générant des images devient un personnage sans détour.
- **Principe** : « une intention → tout le pipeline » ; l'action portée par l'objet (le menu commun).
- **Coût** : petit à moyen (le studio prend une photo de départ ; il faut qu'il la reçoive depuis la bibliothèque :
  le portail l'envoie comme un dépôt, `/character/api/uploads`). **Dépend de** : la route de dépôt du studio (DGX1).

### 2. Choisir d'un double-clic, l'annulation au lieu de la fenêtre — rapide

- **Aujourd'hui** : un clic sur le visage, « Choisir ce visage », « Oui » : 3 gestes, une fenêtre qui avertit que
  le visage « ne changera plus ».
- **Proposé** : un double-clic sur un visage le choisit ; un bandeau « Visage gardé · annuler » reste 10 secondes,
  et c'est seulement après qu'il part au studio (le verrou, puis la suite). 1 geste. Le même pour le plein pied.
- **Ce que ça change pour Cal** : il choisit vite, sans lire un avertissement qu'il connaît par cœur — et peut se
  rattraper.
- **Principe** : « Never Use a Warning When you Mean Undo » — l'habitude fait cliquer « Oui » sans lire ; mieux vaut
  laisser défaire (Raskin 2007, l'exemple de l'annulation de Gmail) [1].
- **Coût** : petit (le verrou `face_lock` est envoyé en différé par la page ; rien ne change au studio).
  **Dépend de** : rien.

### 3. Le personnage est un élément dès sa naissance — géniale

- **Aujourd'hui** : l'importer (3 à 5 gestes), puis penser à « Mettre à jour depuis le studio » à chaque changement.
- **Proposé** : chaque personnage du studio est un élément d'Asset, sans import : son visage gardé, son plein pied,
  sa planche, sa voix ; chaque nouvelle décision au studio publie une nouvelle version de l'élément, et les plans qui
  l'utilisent gardent la leur (épinglée) avec « une version plus récente existe ». 0 geste.
- **Ce que ça change pour Cal** : il fait un personnage au studio et le trouve aussitôt dans Image, Vidéo, Idéation,
  toujours à jour.
- **Principe** : les éléments versionnés du portail (`apps_studio_elements.md` : une source vivante, des versions
  immuables, des usages épinglés) ; un lien vivant plutôt qu'une copie qu'on rafraîchit.
- **Coût** : moyen (une source « character-factory » pour `elements.py` ; un relevé du studio, ou un signal de
  sa part, pour publier). **Dépend de** : le studio de DGX1 joignable (le relais existe) ; l'accord de Cal (les
  personnages pas finis apparaîtraient-ils ? proposé : dès le visage gardé).

### 4. L'atelier fait la suite tout seul — géniale

- **Aujourd'hui** : après le visage : « L'habiller », la tenue en mots, « L'habiller » ; après la tenue : « Choisir
  sa voix », « Quatre voix » ; puis « Composer sa planche », « Oui » : 8 gestes, chacun après une attente.
- **Proposé** : dès le visage gardé, l'atelier lance seul trois pleins pieds d'après la phrase de naissance (la tenue
  qu'elle décrit) et quatre voix d'après sa façon de parler (déjà écrite dans sa fiche) ; la tenue gardée, la planche
  se compose seule. La fiche ne montre que des choix : « sa tenue », « sa voix ». 3 gestes (deux choix et la planche
  validée), au lieu de 8.
- **Ce que ça change pour Cal** : il ne fait que choisir, comme pour le visage ; un personnage complet sort en une
  séance.
- **Principe** : ne demander à la personne que les décisions de goût, la machine fait le reste (« le reste se fait
  tout seul, pendant que tu travailles », casting) ; « une intention → tout le pipeline ».
- **Coût** : moyen (un enchaînement au studio, ou piloté par la page du portail selon `nextDecision`). **Dépend de** :
  le studio de DGX1 (sa file) ; la voix possible (`voice_design`) ; l'accord de Cal sur le calcul lancé sans lui.

### 5. L'audition au clavier — rapide

- **Aujourd'hui** : viser un visage parmi quatre, puis l'orange ; pour voir en grand, le clic ouvre la loupe.
- **Proposé** : 1, 2, 3, 4 prennent un visage en grand ; ← → passent ; Espace l'agrandit plein écran (et le
  referme) ; Entrée le garde (avec l'annulation de la proposition 2). Le même pour les pleins pieds et les voix (Espace
  écoute).
- **Ce que ça change pour Cal** : comparer quatre visages se fait l'œil sur eux, sans viser.
- **Principe** : Coup d'œil (Espace) du Finder [2] ; le tri à une touche des outils photo.
- **Coût** : petit (le clavier de `character/js/studio.js`). **Dépend de** : rien.

### 6. Les directions sur la fiche — rapide

- **Aujourd'hui** : « plus âgé », « plus jeune », « plus dur », « autre coiffure »… sont dans le Plein cadre :
  « Plein cadre ⤢ » (une vue de plus), puis la direction : 2 gestes et un aller-retour.
- **Proposé** : sous l'audition de la fiche, les six directions en puces ; un clic relance quatre visages dans cette
  direction. 1 geste, 0 vue.
- **Ce que ça change pour Cal** : orienter un casting se fait là où l'on regarde les candidats.
- **Principe** : les variations guidées (les « Vary » de Midjourney, à côté de l'image [3]) ; une information à
  l'endroit où l'on s'en sert (règles de rédaction du 09/10, règle 3).
- **Coût** : petit (`DIRECTIONS` et l'action `face` existent). **Dépend de** : rien.

### 7. Une tenue en glissant une image — rapide

- **Aujourd'hui** : « + une photo de vêtement » ouvre la fenêtre de fichiers du système ; une image d'Asset doit
  d'abord être téléchargée ; puis la tenue en mots, « L'habiller » : 4 gestes et plus.
- **Proposé** : glisser une image (du panneau, du fil, du disque) sur le cadre du plein pied crée la tenue avec
  cette image en référence ; la phrase est proposée par le modèle qui voit (« veste en cuir noire »), modifiable ;
  « L'habiller » part. 2 gestes.
- **Ce que ça change pour Cal** : habiller un personnage d'après une image trouvée devient un glisser.
- **Principe** : le glisser-déposer partout (voir `transverse-a.md`, proposition 1) ; la manipulation directe.
- **Coût** : petit à moyen (le relais des dépôts existe ; une image de la bibliothèque à envoyer au studio).
  **Dépend de** : le modèle qui voit pour la phrase (sinon, champ vide).

### 8. Le casting en zoom sémantique — géniale

- **Aujourd'hui** : le casting en affiches ; ouvrir un personnage change de vue, revenir aussi (Échap).
- **Proposé** : de loin, une grille de visages avec une pastille d'état (ambre : une décision attend ; vert : prêt) ;
  à mi-chemin, les affiches d'aujourd'hui ; de près, une affiche s'ouvre **en place** en sa fiche (les autres se
  poussent), on dézoome pour revenir à la troupe. 0 changement de vue.
- **Ce que ça change pour Cal** : il voit sa distribution d'un coup d'œil et passe d'un personnage à l'autre sans
  quitter le casting.
- **Principe** : le zoom sémantique (Pad++, Bederson et Hollan 1994 [4]) ; « une vue d'ensemble d'abord, le détail
  à la demande » (Shneiderman 1996 [5]).
- **Coût** : gros (la fiche se dessine aujourd'hui seule dans la page ; la monter dans la grille). **Dépend de** :
  rien d'externe.

### 9. Essayer le personnage en scène — rapide

- **Aujourd'hui** : l'importer (3), aller dans Image (une page), le poser depuis le panneau (3 à 5), écrire un
  prompt, « Générer » : ≈ 10 gestes et une page pour voir s'il tient dans une image.
- **Proposé** : « Essayer en scène » sur la fiche : trois images faites dans Image avec lui (`@element1`) dans trois
  situations simples (un portrait en lumière du jour, un plan moyen en intérieur, un plan large en extérieur) ; elles
  arrivent dans le fil d'Image, prêtes à réutiliser. 1 geste.
- **Ce que ça change pour Cal** : il vérifie la cohérence du personnage avant de l'engager dans un plan.
- **Principe** : « Parler » le fait déjà pour la voix (la Scène) ; le même essai pour l'image.
- **Coût** : petit à moyen (un lot de la route d'Image avec l'élément). **Dépend de** : la proposition 3 (l'élément
  existe sans import).

### 10. Décider à la suite — rapide

- **Aujourd'hui** : « Ce qui attend » liste les décisions (le visage d'Ilan, la tenue de Nora) ; chacune : un clic,
  la fiche, la décision, revenir au casting : 3 à 4 gestes par décision.
- **Proposé** : « Décider à la suite » : les décisions en attente défilent une à une, en grand, au clavier (les
  propositions 2 et 5) ; chaque choix passe à la suivante ; une décision qu'on saute reste dans la liste. 1 à 2
  gestes par décision.
- **Ce que ça change pour Cal** : le matin, il vide en une minute tout ce que l'atelier a préparé dans la nuit.
- **Principe** : l'avance automatique de Gmail (après un message traité, le suivant s'ouvre, réglage
  « Auto-advance ») et de Lightroom après une note [6].
- **Coût** : petit (la liste `waitsOnCasting` existe ; un parcours de ces fiches). **Dépend de** : rien.

## 3. Le top 3 de Character Factory

1. **Le personnage est un élément dès sa naissance (3)** : plus d'import, plus de mise à jour à la main ; le pont
  entre le studio et tous les outils.
2. **L'atelier fait la suite tout seul (4)** : Cal ne fait que choisir — le visage, la tenue, la voix.
3. **Choisir d'un double-clic, l'annulation au lieu de la fenêtre (2)** : le geste le plus répété du studio passe de
  3 à 1.

## 4. Sources

1. A. Raskin, « Never Use a Warning When you Mean Undo », A List Apart n° 241, 2007 :
   https://alistapart.com/article/neveruseawarning
2. Apple, « Coup d'œil sur Mac » : https://support.apple.com/guide/mac-help/mh14119/mac
3. Midjourney, « Variations » : https://docs.midjourney.com/docs/variations
4. B. Bederson, J. Hollan, « Pad++ », UIST 1994.
5. B. Shneiderman, « The Eyes Have It », 1996.
6. Gmail, réglage « Avance automatique » (Paramètres → Avancés) ; Lightroom Classic, Photo → Avance automatique
   (relevé sur des guides : https://lightroomkillertips.com/faster-culling-images/).
