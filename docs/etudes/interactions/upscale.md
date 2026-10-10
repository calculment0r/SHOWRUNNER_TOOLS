# Upscale — dix propositions d'interaction (09/10/2026)

Cal, 09/10 : « on veut des interactions simples, rapides, et on élimine des clics ». Ce fichier est l'étude pour
**Upscale** (`upscale/`) : agrandir une image ou une vidéo, essai après essai, et comparer. Pas de code : des
propositions, chacune avec le geste d'aujourd'hui compté, le geste proposé, le principe et sa source, le coût.

## 1. Ce qui a été mesuré

Le même portail d'essai et le même pilote que pour Asset (`asset.md` § 1 ; `sr_a/parcours.mjs`, captures
`sr_a/shots/upscale_*.png`, `x_upscale_.png`). Moteur factice (un agrandissement simple au processeur), les mêmes
gestes que le vrai. Ce qui n'a pas été joué par le pilote est lu dans le code (`upscale/upscale.js`) et marqué « lu ».

| parcours (aujourd'hui) | gestes | détail |
|---|---|---|
| agrandir une image du fil d'Image | **5** + 1 attente | « ⋯ », « Agrandir dans Upscale », une page, « Upscaler », revenir : une page |
| agrandir une image depuis la page Upscale | **4** + 1 attente | « Bibliothèque », une image, « Prendre », « Upscaler » (lu) |
| agrandir dix images | **≈ 20** | « Upscaler » ne lance que le média montré : choisir chaque vignette, puis « Upscaler » (lu : `launch(body([S.cur]))`) |
| comparer la source et l'essai | **0 à 1** | le rideau d'office ; 1 2 3 4 : rideau, côte à côte, A, B ; S échange (lu) |
| garder le meilleur essai, retirer les autres | **2 par essai** | « ⋯ » de l'essai, « Retirer » (lu) |

Ce qui est déjà bien, et qu'on garde : le média choisit seul le chemin (image ou vidéo) ; trois préréglages en mots
simples et les avancés repliés ; la pile par média avec les réglages de chaque essai ; le moniteur (rideau, côte à
côte, A, B), la molette qui zoome sous le curseur, le même zoom pour A et B ; les touches 1 à 4 et S ; la taille
finale et le temps écrits sous « Upscaler » avant l'envoi.

Les frictions vues :
- **Agrandir oblige à quitter l'outil où l'on est** (Image, Asset, Vidéo), pour le cas le plus courant : « précis ×2 »,
  sans rien régler.
- **Un seul média par envoi**, alors que le serveur prend une liste (`POST /api/upscale/run {items}`).
- **Le choix du préréglage est laissé à la personne**, même quand la source le dit (une photo de 512 px, un visage,
  une vidéo).
- **Trier les essais** : chacun se retire à part ; aucun « garder celui-ci ».
- **Une vidéo s'essaie en entier** : pour juger un réglage, on attend tout le rendu.
- « Upscaler » : un mot anglais sur l'orange ; le reste de la page dit « agrandir ».

## 2. Les dix propositions

### 1. Agrandir sans quitter l'outil — rapide

- **Aujourd'hui** : 5 gestes et 2 pages depuis le fil d'Image (« ⋯ », « Agrandir dans Upscale », la page,
  « Upscaler », le retour).
- **Proposé** : dans le fil d'Image et de Vidéo, dans Asset, dans le panneau : « Agrandir ×2 » (et la touche U)
  lance tout de suite l'essai par défaut (« précis ×2 ») ; le rendu arrive à côté de l'original, en pile
  (« ×2 »). « Agrandir… » (avec les points) mène à Upscale pour régler et comparer. 1 geste, 0 page.
- **Ce que ça change pour Cal** : agrandir devient un geste du fil, comme aimer ; la page Upscale reste l'atelier
  des cas difficiles.
- **Principe** : « une intention, un geste » ; les défauts intelligents (le préréglage qui convient le plus souvent).
- **Coût** : petit (la route `upscale/run` existe ; une entrée de menu commune, `commun/fil.js` et `commun/menu.js`).
  **Dépend de** : la pile d'Asset (`asset.md`, proposition 7) pour ranger le rendu sous l'original.

### 2. La taille finale dès la création — géniale

- **Aujourd'hui** : générer, puis pour chaque image retenue : agrandir (5 gestes, 2 pages, une attente de plus).
- **Proposé** : une puce **Finale** dans la barre d'Image et de Vidéo (« telle quelle », « 2K », « 4K ») ; avec
  « 4K », chaque rendu fini part seul à l'agrandissement (le préréglage choisi par la proposition 4), et le fil montre
  la version finale, l'originale dans sa pile. 0 geste après le choix de la puce.
- **Ce que ça change pour Cal** : il dit une fois ce qu'il veut à la fin ; la chaîne fait la suite pendant qu'il
  travaille.
- **Principe** : « une intention → tout le pipeline » (la chaîne de travaux qui continue seule, comme les étages de
  Character Factory) ; les « hires fix » des interfaces de diffusion, où l'agrandissement est une étape de la recette.
- **Coût** : moyen (un travail qui en lance un autre à sa fin, dans `server/core/jobs` ; la recette garde la taille
  finale pour Recréer). **Dépend de** : la proposition 4 pour le choix du préréglage ; la place en file (un travail
  GPU de plus par image).

### 3. Tout agrandir d'un coup — rapide

- **Aujourd'hui** : dix images = choisir chaque vignette, « Upscaler » : ≈ 20 gestes (lu).
- **Proposé** : quand plusieurs médias sont ouverts, l'orange dit « Agrandir les 10 » (les mêmes réglages pour
  tous) ; un clic sur une vignette avec Alt l'exclut. Déposer dix fichiers, puis 1 clic.
- **Ce que ça change pour Cal** : une série (les plans d'une séquence, les images d'une planche) s'agrandit en une fois.
- **Principe** : le traitement par lot des outils d'agrandissement (Topaz : une file d'images aux mêmes réglages).
- **Coût** : petit (le serveur prend déjà une liste `items` ; la page envoie `[S.cur]`). **Dépend de** : rien.

### 4. Le réglage choisi par l'outil — rapide

- **Aujourd'hui** : « Upscale précis ×2 » d'office, quelle que soit la source ; à Cal de savoir qu'une petite image
  gagne au créatif ×4, qu'une vidéo veut SeedVR2.
- **Proposé** : à l'ouverture, l'outil choisit le préréglage et la taille d'après la source — sa définition (moins de
  1 Mpx : ×4 ; déjà 2K : ×2), sa sorte (vidéo, image), et, si le modèle qui voit est là, ce qu'elle montre (un visage,
  du texte, une illustration) ; une pastille « choisi pour toi » sur le préréglage, un clic pour en prendre un autre.
- **Ce que ça change pour Cal** : il n'a plus à connaître les modèles pour bien agrandir ; il juge le résultat.
- **Principe** : l'« Autopilot » de Topaz Photo : l'image est analysée à l'import (bruit, flou, visages,
  définition), les réglages choisis sont marqués d'une pastille, un clic revient à eux [1].
- **Coût** : petit pour la définition et la sorte (`server/tools/upscale.py`, `PRESETS`) ; moyen pour ce que montre
  l'image (le travail du modèle qui voit, comme `objet.classer`). **Dépend de** : des essais réels pour fixer les
  seuils (non mesurés ici).

### 5. Garder celui-ci — rapide

- **Aujourd'hui** : retirer chaque essai raté : « ⋯ », « Retirer » (2 clics par essai) ; rien ne dit lequel on a gardé.
- **Proposé** : sur l'essai montré en B, **Garder** : il est marqué, les autres essais de la pile partent à la
  corbeille (Ctrl+Z les rend), la pile se replie sur la source et l'essai gardé. 1 clic au lieu de 2 par essai.
- **Ce que ça change pour Cal** : la pile finit propre, et Asset ne garde que le bon.
- **Principe** : l'annulation plutôt que la confirmation (Raskin, « Never Use a Warning When you Mean Undo » [2]) ;
  le tri par élimination des outils photo.
- **Coût** : petit (`libTrash` et la pile existent). **Dépend de** : rien.

### 6. Tenir une touche pour comparer — rapide

- **Aujourd'hui** : passer de A à B = touches 3 et 4 (ou les boutons) ; le rideau demande de glisser.
- **Proposé** : en vue B, **maintenir** une touche (la touche A) montre A, la relâcher remet B ; l'œil voit la
  différence au même endroit, sans bouger la souris. 1 touche tenue.
- **Ce que ça change pour Cal** : juger un détail (une peau, un texte) se fait en clignant, comme sur une table
  lumineuse.
- **Principe** : l'avant / après de Lightroom à une touche (« \ », qui passe de l'image développée à l'originale)
  [3] ; le comparateur à clignotement des astronomes. La barre oblique inverse est AltGr+8 en AZERTY : une lettre.
- **Coût** : petit (le clavier d'`upscale/upscale.js`). **Dépend de** : rien.

### 7. La loupe sous la souris — rapide

- **Aujourd'hui** : voir un détail à 100 % = molette pour zoomer, bouton du milieu pour se déplacer, double-clic pour
  revenir : 3 gestes ou plus, à refaire pour chaque endroit.
- **Proposé** : maintenir Alt montre, sous la souris, un rond à 100 % (ou 200 %) de A et de B côte à côte, au même
  endroit ; on promène la loupe, on relâche. 1 touche tenue.
- **Ce que ça change pour Cal** : il inspecte toute l'image en la survolant, sans perdre le cadrage d'ensemble.
- **Principe** : la loupe des visionneuses photo (Lightroom, mode Loupe, Z pour 1:1) ; « focus + contexte » (le
  détail sans perdre la vue d'ensemble).
- **Coût** : petit (le moniteur sait déjà dessiner A et B au même zoom). **Dépend de** : rien.

### 8. Essayer sur une zone — géniale

- **Aujourd'hui** : un essai agrandit toute l'image, ou toute la vidéo ; pour comparer trois réglages, trois rendus
  entiers.
- **Proposé** : tracer un rectangle sur le moniteur (ou, pour une vidéo, « Essayer 2 s » à la tête de lecture) :
  seule cette zone, ou ces deux secondes, passe par les trois préréglages, en quelques secondes ; les trois
  résultats s'affichent côte à côte ; un clic sur le meilleur lance le rendu entier avec lui.
- **Ce que ça change pour Cal** : choisir un réglage coûte des secondes, plus des minutes ; on compare trois
  façons au lieu d'en essayer une.
- **Principe** : le « Render Preview » de Topaz Video : un aperçu de 2 s (jusqu'à 30 s) rendu là où est la tête de
  lecture [4] ; le principe d'essayer petit avant de faire grand.
- **Coût** : moyen (un recadrage avant le graphe, ou un extrait de vidéo, puis le même travail). **Dépend de** :
  SeedVR2 et Z-Image · Affiner acceptent une petite entrée (non vérifié sur les DGX) ; un essai de la fidélité d'une
  zone rendue seule par rapport à l'image entière.

### 9. Remplacer l'original là où il sert — rapide

- **Aujourd'hui** : une image agrandie ne remplace rien ; dans chaque élément où l'originale est une référence, il
  faut retirer l'ancienne et poser la nouvelle (≈ 6 gestes par élément), et dans les plans de même.
- **Proposé** : après « Garder », l'essai propose « Mettre à la place dans 2 éléments » (la lignée dit où l'originale
  sert) ; un clic fait les remplacements, Ctrl+Z les défait. 1 clic au lieu de 6 par usage.
- **Ce que ça change pour Cal** : un personnage profite tout de suite de son visage agrandi, partout.
- **Principe** : la lignée et les usages des éléments versionnés (`apps_studio_elements.md`) : on sait où une
  version est posée.
- **Coût** : moyen (les références d'un élément sont des copies : il faut une route qui remplace une référence par
  une autre image, avec son contraire). **Dépend de** : l'accord de Cal sur ce remplacement ; les usages lus par
  `elements.py`.

### 10. Le verbe dit le résultat — rapide

- **Aujourd'hui** : l'orange dit « Upscaler » (un mot anglais), la taille finale est écrite dessous en petit.
- **Proposé** : l'orange dit ce qu'il fait : « Agrandir en 1760 × 2368 » (ou « Agrandir en 4K », « Agrandir les
  10 ») ; le temps estimé au survol. 0 geste, une ligne de moins.
- **Ce que ça change pour Cal** : un seul endroit à lire avant de lancer.
- **Principe** : les règles de rédaction de Cal (09/10 : un bouton = un verbe, une information une seule fois) ;
  le bouton qui nomme son résultat.
- **Coût** : petit (`paintAct`). **Dépend de** : rien.

## 3. Le top 3 d'Upscale

1. **Agrandir sans quitter l'outil (1)** : le cas le plus courant passe de 5 gestes et 2 pages à 1 geste.
2. **La taille finale dès la création (2)** : la « géniale » — on ne pense plus à agrandir, la chaîne le fait.
3. **Essayer sur une zone (8)** : comparer trois réglages en secondes, pour les cas où l'on vient vraiment dans
   Upscale.

## 4. Sources

1. Topaz Labs, « Autopilot & Configuration » : https://docs.topazlabs.com/topaz-photo/functions/autopilot-and-configuration
2. A. Raskin, « Never Use a Warning When you Mean Undo », A List Apart n° 241, juillet 2007 :
   https://alistapart.com/article/neveruseawarning
3. Lightroom Classic, la touche « \ » (avant / après) et Y (côte à côte) — relevé sur des guides
   (https://lightroomkillertips.com/lightroom-for-beginners-3-before-after-tips/), page officielle non relue.
4. Topaz Labs, « Quick Start » (Render Preview, 2 s par défaut, jusqu'à 30 s, à la tête de lecture) :
   https://docs.topazlabs.com/topaz-video/quick-start
