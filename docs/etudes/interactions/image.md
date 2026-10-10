# Image et son atelier — dix propositions d'interaction (09/10/2026)

Cal, 09/10 : « on veut des interactions simples, rapides, et on élimine des clics pour que tout soit fluide ». Ce
fichier est l'étude pour **Image** : la page Créer (le fil, la barre de création) et l'**atelier** d'édition
(`image/atelier/`). Pas de code : des propositions, chacune avec le geste d'aujourd'hui compté, le geste proposé,
le principe et sa source, le coût.

## 1. Ce qui a été mesuré

Le même portail d'essai et le même pilote que pour Asset (`asset.md` § 1 ; `sr_a/parcours.mjs`, captures
`sr_a/shots/image_*.png`, `atelier_*.png`, le tableau `sr_a/shots/parcours.txt`). Moteur factice : des mires, mais
les mêmes gestes. Un double-clic compte deux clics ; les attentes sont à part.

| parcours (aujourd'hui) | gestes | détail |
|---|---|---|
| générer deux images | **2** + 1 attente | le prompt, « Générer » |
| une variante d'une image du fil | **2** (ou 1) | « Réutiliser », « Générer » ; « Recréer » au survol fait une nouvelle graine en 1 clic |
| changer le modèle et le format | **4** | puce, choix, puce, choix |
| poser une référence depuis le panneau | **5** | Ctrl+Espace, chercher, double-clic, Ctrl+Espace |
| poser un personnage de Character Factory | **5** + 1 attente | Ctrl+Espace, la section, double-clic (l'import), fermer |
| éditer une image et garder l'essai | **6** + 1 attente | ouvrir, « Éditer » (une autre page), la consigne, « Essayer », « Valider » ; revenir à Créer : une page de plus |
| agrandir une image du fil | **5** + 1 attente | « ⋯ », « Agrandir dans Upscale » (une autre page), « Upscaler » ; revenir : une page |
| animer une image | **3** | « ⋯ », « Animer », la page Vidéo |

Ce qui est déjà bien, et qu'on garde : la barre flottante et ses puces (chacune montre sa valeur) ; « Réutiliser »
qui remplit la barre, graine vidée ; « Recréer » au survol ; la visionneuse plein écran où la molette passe d'une
image à l'autre ; la règle des places `@image1` ; un seul orange ; le temps mesuré sur « Générer » ; l'atelier où
l'image reste en grand et les essais à droite (décision de Cal du 30/09).

Les frictions vues :
- **« Décrivez l'image, en anglais »** : Cal écrit en français partout ailleurs ; le prompt demande une traduction
  de tête (capture annotée `sr_a/shots/annote_panneau_vues.png`, repère 3).
- **L'édition change de page**, et revenir à Créer en demande une autre ; l'image éditée n'est plus dans le fil
  sous les yeux.
- **Agrandir change de page** (Upscale) pour un geste que l'on fait souvent « tel quel » (précis ×2).
- **Explorer une pastille** (quatre objectifs, trois lumières) = changer la pastille, générer, recommencer :
  4 gestes par valeur, et les résultats arrivent mêlés aux autres.
- **Le fil ne se choisit pas à plusieurs** : pour faire un personnage de trois images du fil, il faut aller dans
  Asset (une page, puis 6 gestes).
- **Le « + » des références ouvre une autre bibliothèque** que le panneau (voir `asset.md`, proposition 3).
- **La visionneuse n'a que les flèches et Échap** : aucune touche pour réutiliser, éditer, agrandir, animer.

## 2. Les dix propositions

### 1. L'atelier par-dessus le fil — rapide

- **Aujourd'hui** : visionneuse, « Éditer », une autre page, la consigne, « Essayer », « Valider », puis une page
  pour revenir : 6 gestes et 2 pages.
- **Proposé** : « Éditer » (ou la touche E dans la visionneuse) ouvre l'atelier **par-dessus** le fil, sans
  recharger : la même disposition (l'image en grand, les essais à droite, la consigne en bas) ; Échap ramène au fil,
  à la même image, l'essai validé posé à côté d'elle. 5 gestes, 0 page.
- **Ce que ça change pour Cal** : on passe de créer à retoucher et retour sans perdre le fil de ce qu'on regardait.
- **Principe** : l'édition sur place, la manipulation directe (Shneiderman 1983 [1]) ; garder le contexte plutôt que
  d'ouvrir un autre lieu. La décision du 30/09 (« l'édition est un atelier en soi ») est gardée : c'est le même
  atelier, monté autrement.
- **Coût** : moyen (l'atelier est une page, `image/atelier/atelier.js` ; sa session vit au serveur,
  `image_atelier.py` : le monter dans un calque demande de séparer la page de son montage). **Dépend de** : rien.

### 2. Écrire en français — rapide

- **Aujourd'hui** : le prompt « en anglais » ; Cal traduit de tête, ou écrit en français sans savoir ce que le
  modèle en fait (non documenté pour nos trois modèles).
- **Proposé** : on écrit dans sa langue ; avant l'envoi, le modèle de langue local le met en anglais, en gardant
  les mentions `@image1` et les pastilles ; « Paramètres avancés » montre le prompt envoyé (il le montre déjà). 0
  effort de traduction.
- **Ce que ça change pour Cal** : il décrit une image comme il la pense, dans la langue de tout le portail.
- **Principe** : faire le travail à la place de la personne quand la machine sait le faire (les défauts
  intelligents) ; la mise en forme des invites de Vidéo par le modèle local le fait déjà (`movie.invite`).
- **Coût** : moyen (un passage par le modèle local avant `compose`, mis en cache par texte). **Dépend de** : le
  modèle de langue sur les DGX (Ollama), son temps (non mesuré ici) ; un interrupteur pour écrire en anglais tel quel.

### 3. La planche de variations — géniale

- **Aujourd'hui** : comparer quatre objectifs = pour chacun, « Prise de vue », l'onglet, la pastille, « Générer » :
  16 gestes, des graines différentes, les images mêlées dans le fil.
- **Proposé** : Alt+clic sur plusieurs pastilles d'un même groupe (ou « Essayer chacune » au clic droit du groupe) ;
  « Générer » fait une image par valeur, **avec la même graine**, rangées côte à côte dans le fil sous une étiquette
  (« objectif : 24 mm · 50 mm · 85 mm · 135 mm ») ; un clic sur la meilleure la met dans la barre. 6 gestes au lieu
  de 16, et une vraie comparaison (une seule chose change).
- **Ce que ça change pour Cal** : il explore une idée en largeur, comme une planche contact, au lieu de la tâtonner
  image par image.
- **Principe** : les « Permutation Prompts » de Midjourney (`{a, b, c}` dans un prompt lance une image par valeur)
  [2] ; en photo, le bracketing ; la comparaison à une seule variable.
- **Coût** : moyen (N rendus d'une même recette, la graine fixée, un groupe dans le fil). **Dépend de** : la file
  (N rendus en attente) ; rien d'autre.

### 4. Les touches de la visionneuse — rapide

- **Aujourd'hui** : dans la visionneuse, chaque action est un bouton ou un menu « ⋯ » (2 clics).
- **Proposé** : R réutiliser, V une variante (nouvelle graine), Maj+V quatre variantes, E éditer, U agrandir, A
  animer, F aimer, Suppr à la corbeille (Ctrl+Z la rend), les flèches et la molette pour passer ; les touches sont
  écrites au survol des boutons. 1 touche au lieu de 1 à 2 clics, sans quitter l'image des yeux.
- **Ce que ça change pour Cal** : trier et relancer une série devient une suite de touches.
- **Principe** : les raccourcis à une touche des outils de tri photo (Lightroom Classic : P, X, 0-5, avec l'avance
  automatique [3]) ; les mêmes touches partout (voir `transverse-a.md`, proposition 9).
- **Coût** : petit (`commun/fil.js`, la visionneuse ; les actions existent). **Dépend de** : rien.

### 5. Varier un peu, varier beaucoup — rapide

- **Aujourd'hui** : une variante proche = « Éditer », l'outil Affiner, son débruitage (panneau), « Essayer » : 5
  gestes et une page ; une variante lointaine = « Recréer » (1 clic).
- **Proposé** : au survol et dans la visionneuse, deux boutons : **Un peu** (repartir de l'image avec un faible
  débruitage, à sa taille : la même composition, d'autres détails) et **Beaucoup** (nouvelle graine, la même
  recette, ce que fait « Recréer »). 1 clic chacun.
- **Ce que ça change pour Cal** : la variante, son geste le plus fréquent (« on est souvent en train de faire des
  variantes », 29/09), a ses deux intensités sous la main.
- **Principe** : « Vary (Subtle) » et « Vary (Strong) » de Midjourney, deux boutons sous chaque image [4].
- **Coût** : petit pour « Beaucoup » (`image/redo` existe) ; moyen pour « Un peu » : Affiner (`refine`) agrandit ×2,
  il faut un graphe image-à-image à la taille d'origine. **Dépend de** : un essai réel du débruitage qui garde la
  composition (non documenté pour Krea 2 et Qwen-Image 2.1).

### 6. Les puces à la molette — rapide

- **Aujourd'hui** : changer le format, la taille ou le modèle = la puce, puis le choix dans son menu (2 clics) ; le
  nombre d'images, des clics sur − et +.
- **Proposé** : la molette sur une puce fait défiler ses valeurs (16:9 → 3:2 → 1:1…), la valeur s'écrit sur la puce
  à mesure ; le clic ouvre toujours le menu. 1 geste au lieu de 2.
- **Ce que ça change pour Cal** : essayer trois formats se fait sans ouvrir un seul menu.
- **Principe** : la valeur réglée sur place, sans dialogue (les champs à curseur caché de Photoshop, qu'on règle
  en glissant sur leur étiquette ; les valeurs qu'on règle à la molette dans Ableton Live).
- **Coût** : petit (`paintChips` d'`image/image.js`). **Dépend de** : rien.

### 7. Le fil se choisit à plusieurs — rapide

- **Aujourd'hui** : le fil ne choisit qu'une image ; pour un personnage de trois images, ou en agrandir trois,
  aller dans Asset (une page), les retrouver, 6 gestes.
- **Proposé** : Ctrl+clic et Maj+clic choisissent dans le fil comme dans Asset ; une barre de quatre boutons
  apparaît : **Faire un personnage**, **Agrandir**, **Animer** (le premier en première image), **Aimer**. 4 gestes,
  0 page.
- **Ce que ça change pour Cal** : la série qu'il vient de générer devient un élément là où elle est née.
- **Principe** : la même sélection partout (Nielsen, heuristique 4, cohérence [5]) ; la barre de sélection d'Asset,
  réduite (voir `asset.md`, proposition 10).
- **Coût** : petit à moyen (`commun/fil.js` : la sélection ; les actions existent dans Asset). **Dépend de** : rien.

### 8. L'esquisse en direct — géniale

- **Aujourd'hui** : écrire, « Générer », attendre, regarder, retoucher le prompt, recommencer.
- **Proposé** : un interrupteur **Esquisse** dans la barre : à chaque pause dans la frappe (ou une pastille
  changée), une petite image rapide se refait sous la barre, avec une graine fixe ; « Générer » fait la vraie, à la
  même graine. On voit l'effet d'un mot avant de lancer.
- **Ce que ça change pour Cal** : le prompt se règle à l'œil, comme un curseur, au lieu de se deviner.
- **Principe** : Krea Realtime — la toile est une entrée vivante, le résultat se refait à chaque changement, « sans
  file, sans attente, sans bouton de rendu » [6].
- **Coût** : gros (un rendu court à basse définition, annulé dès qu'un nouveau part ; la voie image réservée tant
  que l'esquisse est allumée). **Dépend de** : le temps d'un rendu Z-Image Turbo à 512 px sur les DGX (non mesuré) ;
  le partage du GPU avec la file.

### 9. Glisser une référence dans le texte — rapide

- **Aujourd'hui** : nommer une référence = taper « @ », choisir dans la liste (2 à 3 gestes).
- **Proposé** : glisser la vignette d'une référence (ligne 1 de la barre) dans le texte écrit son jeton
  (`@element1`) à l'endroit où on la lâche. 1 glisser.
- **Ce que ça change pour Cal** : on écrit « @element1 assis dans @image1 » en montrant au lieu de taper.
- **Principe** : la manipulation directe (Shneiderman 1983 [1]) ; la règle des places `@image1` reste la seule
  grammaire (un jeton désigne une place, pas une image).
- **Coût** : petit (`insertTok` existe dans `image/image.js`). **Dépend de** : rien.

### 10. Mes réglages en une puce — rapide

- **Aujourd'hui** : retrouver un rendu qu'on aime (« polaroïd de nuit », Krea 2, 3:4, trois pastilles) = chercher
  une ancienne image et « Réutiliser », puis changer le prompt ; ou tout reposer (8 à 10 gestes).
- **Proposé** : « Garder ces réglages » (dans « ⋯ » de la barre) donne un nom à l'état de la barre sans le prompt
  (modèle, format, taille, pastilles, LoRA) ; il devient une puce « Mes réglages » ; un clic les remet. 1 clic au
  lieu de 8.
- **Ce que ça change pour Cal** : ses « looks » maison se rappellent d'un geste, dans Image et dans les cartes
  Générer d'Idéation.
- **Principe** : les préréglages de développement de Lightroom (un nom, un clic, tous les curseurs) ; rien à
  « enregistrer » d'autre que ce nom.
- **Coût** : petit (l'état de la barre est déjà sérialisé pour l'annulation : `barState`). **Dépend de** : rien ;
  rangé par personne dans les préférences.

## 3. Le top 3 d'Image

1. **L'atelier par-dessus le fil (1)** : la retouche cesse de faire changer de page, la décision du 30/09 est gardée.
2. **Écrire en français (2)** : une friction de chaque prompt, levée par un modèle déjà sur les DGX.
3. **La planche de variations (3)** : la « géniale » — explorer en largeur, une seule chose qui change, la même
   graine.

## 4. Sources

1. B. Shneiderman, « Direct Manipulation: A Step Beyond Programming Languages », IEEE Computer, 1983.
2. Midjourney, « Permutation Prompts » (documentation officielle de Midjourney, docs.midjourney.com).
3. Lightroom Classic, l'avance automatique (menu Photo → Avance automatique ; Verr. Maj l'allume) — relevé sur des
   guides et le forum d'Adobe (https://lightroomkillertips.com/faster-culling-images/), page officielle non relue.
4. Midjourney, « Variations » (Vary Subtle, Vary Strong) : https://docs.midjourney.com/docs/variations
5. J. Nielsen, « 10 Usability Heuristics for User Interface Design », 1994.
6. Krea, « Realtime » : https://www.krea.ai/docs/user-guide/features/realtime
