# Vidéo — dix propositions d'interaction (10/10/2026)

Cal, 09/10 : « on veut des interactions simples, rapides, et on élimine des clics pour que tout soit fluide
[…] je veux des features géniales, comme quand on travaille avec un zoom sémantique ». Ce fichier est
l'étude pour Vidéo (H3 : la barre de création, le Multishot, le fil, le banc « Comparer »). Pas de code : des
propositions, chacune avec le geste d'aujourd'hui compté, le geste proposé, le principe et sa source, le coût.

La page de départ est **celle refaite le 09/10** (`movie/`, `docs/etudes/movie.md` § 10) : le fil sur toute la
largeur, la barre en bas, le Multishot dans la barre, les éléments glissés partout. Les mots sont ceux du lexique
(`docs/etudes/redaction.md`) : un plan, une référence, un prompt, un rendu, un calcul, la résolution (Esquisse,
Léger, Brouillon, Qualité), le fil.

## 1. Ce qui a été mesuré

Un portail d'essai neuf (`tools/portail_essai.py 9041`, moteurs factices), Chromium sans affichage, un pilote qui
fait les parcours et compte chaque geste : un clic, un champ rempli, une touche, un glisser ; à part, les
attentes et les changements de page. Le pilote et ses captures sont dans le scratchpad de la session :
`ib2/p_video.mjs`, `ib2/p_video-dark.txt` (le relevé), `ib2/shots/vd-*.png`, et la capture annotée
`ib2/annotees/video-barre.png`.

| parcours (aujourd'hui) | clics | champs | touches | glisser | gestes |
|---|---|---|---|---|---|
| un plan en Texte : le prompt, « Générer » (ou Ctrl+Entrée) | 1 | 1 | | | **2** |
| un plan en Images : le mode, « + » du début, une image du sélecteur, le prompt, « Générer » | 4 | 1 | | | **5** + 1 attente |
| un personnage en image de début : la vignette, « Changer d'image… », Marc, **« Quelle image de Marc ? »**, le plein pied | 4 | | | | **4** + une 2e fenêtre |
| deux éléments en références : le mode, Ctrl+Espace, Marc glissé, Léa glissée, Ctrl+Espace, le prompt avec `@element1`, `@element2` | 1 | 1 | 2 | 2 | **6** |
| un Multishot de trois plans : le prompt, « Multishot », le plan 3, « + réplique », ce qui est dit, une coupe à la poignée | 3 | 2 | | 1 | **6** |
| continuer un plan du fil : « ⋯ » (17 entrées), « Continuer le plan », la suite, « Générer » | 3 | 1 | | | **4** + 1 attente |
| comparer deux vidéos : « Comparer », la place A, une vidéo, la place B, une vidéo | 5 | | | | **5** + un changement de vue |

Ce qui est déjà bien, et qu'on garde : un plan simple tient en deux gestes ; tout ce qui change le rendu se lit sur
les puces (format, résolution et son temps, durée) ; un élément glissé du panneau Asset arrive avec sa vignette, son
jeton et son nom, et fait passer en Références tout seul ; le Multishot découpe le prompt en plans d'après ses
phrases et réécrit le prompt à chaque geste ; le fil glisse (chaque vidéo porte l'asset : `dragItem`,
`commun/fil.js`) ; un seul bouton orange.

Les frictions vues :
- **Un rendu coûte cher, donc on hésite** : en Brouillon, un plan de 5,2 s se calcule en 4 à 5 min ; en Qualité, 7 à
  10 min (`/api/movie/options`, temps extrapolés du rendu de Cal, `movie.md` § 9.4). L'Esquisse fait le même plan en
  1 min 10 à 1 min 40, mais rien ne la relie ensuite au plan « pour de vrai » : il faut tout refaire à la main
  (Réutiliser, la puce de résolution, Qualité, Échap, Générer : 5 gestes).
- **Le personnage en image de début ouvre une seconde fenêtre** (« Quelle image de Marc ? ») alors que la page
  classe déjà ses images, le plein pied d'abord (`fromElement`, `movie/movie.js`).
- **Les noms ne servent à rien** : écrire « Marc » dans le prompt ne fait rien, alors que Marc est un élément du
  Workspace ; il faut ouvrir le panneau, le trouver, le glisser, refermer, écrire `@element1`. Dans le Multishot, la
  réplique de « She turns to him » est donnée par défaut à `@element1 · Marc` (le premier de la liste).
- **Le menu ⋯ d'une vidéo a 17 entrées** : les quatre gestes qui font avancer un film (continuer, comparer, prendre
  en référence, envoyer au Montage) sont au même rang que « Copier le lien ». Après « Continuer le plan », le prompt
  d'avant reste (ici le Multishot entier) : il faut l'effacer.
- **Comparer fait changer de page** : le banc remplace le fil et la barre ; ses deux places se remplissent par un
  sélecteur (2 clics chacune), alors que les deux vidéos à comparer sont là, dans le fil.
- **Une vignette de la barre ne se glisse pas dans le texte** (`movie.md` § 10.6) : on insère son jeton par son
  menu ou par « @ ».

## 2. Les dix propositions

« Géniale » : ça change la façon de travailler. « Rapide » : ça enlève des clics tout de suite.

### 1. Quatre esquisses, puis la bonne en qualité — géniale

- **Aujourd'hui** : un essai en Brouillon (4 à 5 min) ; s'il ne va pas, on corrige et on relance. Pour passer une
  Esquisse en Qualité : Réutiliser, la puce de résolution, Qualité, Échap, Générer (5 gestes), et la graine se
  vide (« Générer fait une variante »).
- **Proposé** : une puce **« × 4 »** à côté de la durée : « Générer » lance quatre Esquisses (graines différentes)
  qui arrivent ensemble dans **une seule rangée** du fil. Au survol de la bonne : **« En qualité »** (1 clic) relance
  ce plan, même prompt, mêmes références, même graine, à la résolution choisie. Les trois autres se replient.
  1 clic pour explorer, 1 clic pour finir.
- **Ce que ça change pour Cal** : on choisit en regardant au lieu de deviner ; quatre Esquisses (≈ 5 à 7 min en
  tout) coûtent moins qu'une seule Qualité (7 à 10 min). On ne paie la Qualité que pour le plan retenu.
- **Principe** : explorer à bas prix, puis s'engager — la grille de quatre essais de Midjourney et ses boutons
  « Upscale » / « Variation » sous chaque image [1] ; la puce « nombre » de notre page Image fait déjà le premier
  temps.
- **Coût** : moyen (`movie/movie.js` : la puce, quatre calculs, la rangée groupée dans le fil ; le bouton « En
  qualité » réutilise `reuse()` + la résolution). **Dépend de** : **à vérifier** — qu'une même graine donne la même
  composition à une autre taille de toile n'est **pas documenté** pour H3 ; à essayer sur DGX1 avant d'en faire la
  promesse. Piste plus sûre, par construction : le code dit que **l'Esquisse est le premier étage du Brouillon**
  (`server/tools/movie.py`, `METHODS`) ; garder son résultat latent permettrait de ne lancer que le second étage
  (l'agrandisseur latent) — à vérifier dans le graphe.

### 2. Le storyboard par le zoom — géniale

- **Aujourd'hui** : le fil est une liste ou une grille de vidéos, rangées par date ; les variantes d'un même plan,
  ses suites (« Continuer le plan ») et ses reprises sont mêlées aux autres. Pour retrouver la bonne prise d'une
  scène : faire défiler, survoler une à une.
- **Proposé** : le curseur de taille du fil devient un **zoom sémantique** à trois paliers. De loin : **une carte par
  plan** (les variantes empilées, la préférée dessus, le nombre en coin), rangées dans l'ordre des suites — la scène
  se lit comme un storyboard. Au milieu : les variantes côte à côte, en lecture au survol. De près : la bande des
  images du plan, qu'on parcourt à la souris. 0 clic : on zoome, on lit.
- **Ce que ça change pour Cal** : le fil devient la planche de la scène ; le choix d'une prise se fait à l'endroit
  où l'on voit l'enchaînement.
- **Principe** : Pad++ — « la taille apparente d'un objet décide du détail qu'il montre » [2] ; le storyboard de
  Sora, des cartes posées le long du temps [3] ; la bibliothèque en accordéon (Asset) range déjà par paquets.
- **Coût** : gros (`commun/fil.js` : les paliers ; le serveur doit relier une variante, une suite, une reprise à
  son plan d'origine — une image extraite garde déjà sa vidéo (`from_video`, `r_frame`), mais une variante
  (`r_redo`) ne garde que son titre « Recréer · … » : le lien est à ajouter aux réglages d'envoi). **Dépend de** :
  ce lien.

### 3. Les noms deviennent des références — rapide

- **Aujourd'hui** : Marc est un élément ; l'écrire dans le prompt ne fait rien. Pour qu'il compte : Ctrl+Espace, le
  trouver, le glisser, Ctrl+Espace, écrire `@element1` (5 gestes).
- **Proposé** : en écrivant, un nom d'élément du Workspace se souligne en pointillé ; **Tab** l'accepte : l'élément
  entre dans les références et le mot devient son jeton (1 touche). Dans le Multishot, une réplique va par défaut au
  personnage nommé dans le plan (« Léa turns to him » → Léa), pas au premier de la liste.
- **Ce que ça change pour Cal** : on écrit la scène comme un scénario ; les personnages suivent.
- **Principe** : les défauts intelligents (la valeur proposée est celle que presque tout le monde garde) [4] ; la
  complétion déjà là pour « @ » (`commun/entrees.js`).
- **Coût** : petit (la liste des éléments est chargée par le panneau ; le jeton s'écrit par `insertToken`).
  **Dépend de** : rien. Un nom courant (« Rose ») peut tomber à tort : c'est une suggestion, jamais une écriture.

### 4. Glisser une vidéo du fil sur la barre — rapide

- **Aujourd'hui** : continuer un plan, c'est « ⋯ », « Continuer le plan » (2 clics, puis effacer l'ancien prompt) ;
  une vidéo glissée sur l'image de début est refusée (la place ne prend que des images et des éléments).
- **Proposé** : une vidéo du fil lâchée sur **le début** y pose **sa dernière image** (la suite du plan) ; sur **la
  fin**, **sa première image** (un plan qui y mène) ; sur la rangée des références, elle entre en `@video` comme
  aujourd'hui. Le prompt d'avant est vidé (gardé par l'annulation). 1 glisser.
- **Ce que ça change pour Cal** : enchaîner des plans se fait d'un geste, dans les deux sens.
- **Principe** : la manipulation directe — l'objet visé reçoit l'action, l'effet se voit tout de suite et
  s'annule [5].
- **Coût** : petit (`dropZone` du début et de la fin : accepter `video`, appeler `movie/frame` comme
  `continueFrom`). **Dépend de** : rien.

### 5. Comparer depuis le fil — rapide

- **Aujourd'hui** : « Comparer », la place A, une vidéo, la place B, une vidéo (5 clics) ; le fil et la barre
  disparaissent.
- **Proposé** : choisir deux vidéos dans le fil (clic, Ctrl+clic) et taper **C** (ou le bouton qui paraît en haut
  du fil) : le banc s'ouvre **par-dessus** le fil, A et B remplis, Échap le referme. Sans sélection, C compare les
  deux derniers rendus du même prompt. 3 gestes, ou 1.
- **Ce que ça change pour Cal** : comparer devient un coup d'œil entre deux rendus, pas une page à remplir.
- **Principe** : les défauts intelligents [4] (les deux dernières variantes sont presque toujours celles qu'on veut
  comparer). Le fil n'a pas encore de sélection multiple (`commun/fil.js`) : elle servira aussi aux dossiers.
- **Coût** : petit à moyen (le banc existe : `toBench`, `assign` ; l'ouvrir en couche au lieu de `setView` ; la
  sélection multiple du fil est neuve).
  **Dépend de** : rien.

### 6. Le personnage en image de début, sans fenêtre — rapide

- **Aujourd'hui** : choisir Marc en image de début ouvre « Quelle image de Marc ? » (1 clic de plus, une attente).
- **Proposé** : le plein pied est pris d'office (c'est déjà le premier du classement) ; la vignette du début montre
  deux petites flèches ‹ › pour passer à son visage ou à une autre image de l'élément, sur place. 4 → 3 gestes, et
  plus de seconde fenêtre.
- **Ce que ça change pour Cal** : un personnage se pose comme une image.
- **Principe** : les défauts intelligents [4] ; l'édition sur place plutôt qu'une fenêtre [5].
- **Coût** : petit (`fromElement` : prendre le premier ; `paintSlot` : les flèches). **Dépend de** : rien.

### 7. Une vignette glissée dans le texte — rapide

- **Aujourd'hui** : pour citer une référence dans le prompt ou dans un plan du Multishot : un clic sur sa vignette,
  « Insérer @element1 » (2 clics), et le jeton tombe là où était le curseur.
- **Proposé** : la vignette se glisse **dans le texte** (le jeton s'écrit au point de chute) ou **sur un plan de la
  frise** (il s'écrit dans ce plan). 1 glisser. Le réordonnancement des vignettes entre elles reste.
- **Ce que ça change pour Cal** : on écrit avec les images sous la main.
- **Principe** : le glisser-déposer partout, le même geste pour la même idée (le panneau Asset sur un plan le fait
  déjà) [5].
- **Coût** : petit (`commun/entrees.js` : distinguer un lâcher hors de la rangée ; `commun/multishot.js` reçoit
  déjà un asset). **Dépend de** : rien.

### 8. Les quatre gestes du plan, en un menu à la souris — moyen

- **Aujourd'hui** : « ⋯ » ouvre 17 entrées ; « Continuer le plan » est la cinquième, sous un séparateur.
- **Proposé** : sur une vidéo du fil, **clic droit tenu et un mouvement** : → continuer, ← comparer, ↑ prendre en
  référence, ↓ envoyer au Montage. Relâcher sans bouger ouvre le menu complet, comme aujourd'hui. 1 geste au lieu
  de 2, et la main apprend le sens.
- **Ce que ça change pour Cal** : les quatre gestes qui font avancer un film deviennent des réflexes.
- **Principe** : les « marking menus » — on apprend le menu en le voyant, puis on le fait sans le regarder, d'un
  trait [6].
- **Coût** : moyen (`commun/menu.js` : un menu radial, partagé ensuite par Image et le Montage). **Dépend de** :
  rien.

### 9. Une scène entière à partir d'un texte — géniale

- **Aujourd'hui** : un plan à la fois ; une scène de cinq plans, c'est cinq prompts, cinq jeux de références, cinq
  « Générer », puis l'envoi un à un au Montage (≈ 30 gestes).
- **Proposé** : coller un passage de scénario dans la barre et choisir **« Découper en plans »** : la mise en forme
  (`/api/movie/invite`, le modèle de texte local) le coupe en plans, chacun avec son prompt, ses personnages déjà en
  références (n° 3), sa durée ; ils arrivent en **cartes-brouillons** dans le fil, dans l'ordre. « Tout lancer en
  Esquisse » (1 clic), puis la bonne prise de chaque plan en Qualité (n° 1), puis « Envoyer la scène au Montage »
  (1 clic : une séquence, les plans dans l'ordre). ≈ 30 → 4 gestes.
- **Ce que ça change pour Cal** : on part d'une intention (la scène), l'outil fait la suite ; on garde la main à
  chaque carte.
- **Principe** : « une intention → tout le pipeline » ; le générateur de storyboard de LTX Studio, qui découpe un
  script en scènes et en plans et sort les personnages en éléments réutilisables [7].
- **Coût** : gros (le découpage dans `movie_invite`, les cartes-brouillons dans le fil, l'envoi groupé :
  `montage/?add=` prend un seul id aujourd'hui). **Dépend de** : le modèle de texte sur les DGX (Ollama) ; sans lui,
  le découpage phrase à phrase du Multishot sert de repli.

### 10. La caméra au geste — géniale

- **Aujourd'hui** : un mouvement de caméra, c'est « Aides », l'onglet Caméra, une pastille (« avancer »), puis
  l'amplitude et la vitesse (3 à 5 clics), et la phrase s'écrit en anglais dans le prompt.
- **Proposé** : sur l'image de début (mode Images) ou la vignette de la première référence, **tirer à la souris**
  dessine le mouvement : une flèche = un travelling dans ce sens, la molette = avancer ou reculer, un arc = tourner
  autour ; la longueur du trait donne l'amplitude. La phrase s'écrit seule dans le prompt (la même que les
  pastilles d'aujourd'hui). 1 glisser.
- **Ce que ça change pour Cal** : on montre le mouvement au lieu de le nommer.
- **Principe** : la manipulation directe [5] ; les commandes de caméra de Runway, où l'on choisit le sens et
  l'intensité du mouvement sur l'image avant de générer [8].
- **Coût** : moyen (un calque de geste sur la vignette, la table des mouvements existe : `paintCamera`).
  **Dépend de** : H3 ne lit qu'un texte, pas de trajectoire : le geste écrit la phrase du guide, rien de plus.

## 3. Le top 3

1. **Quatre esquisses, puis la bonne en qualité** (n° 1) : le geste qui change le plus la manière de travailler
   quand un rendu coûte des minutes ; moyen, à essayer d'abord sur DGX1 (la même graine à une autre taille).
2. **Les noms deviennent des références** (n° 3) : 5 gestes → 1 touche, à chaque plan ; petit.
3. **Glisser une vidéo du fil sur la barre** (n° 4) : enchaîner les plans d'un geste, dans les deux sens ; petit.

Puis, petits chacun : comparer depuis le fil (5), le personnage sans fenêtre (6), la vignette dans le texte (7).

**Le Multishot**, en particulier : ce que Cal demandait le 09/10 (y glisser des éléments, tirer ses poignées, ne plus
l'avoir en fenêtre) est fait (`movie.md` § 10.4). Ce qui reste le concerne dans trois propositions : la réplique
donnée au personnage nommé dans le plan (n° 3), la vignette glissée sur un plan (n° 7), la scène découpée en plans
d'après un texte (n° 9). Ouvert, il prend 400 px des 900 de l'écran (mesuré) : le fil au-dessus se réduit à une
bande, ce qui plaide pour les cartes du storyboard (n° 2) plutôt que pour une frise plus haute.

## Sources

1. Midjourney, documentation Discord (la grille d'essais à basse résolution, les boutons de variation et
   d'agrandissement sous chaque image) — https://docs.midjourney.com/midjourney-discord (extrait du moteur de
   recherche, 10/10/2026).
2. Bederson, B. B. & Hollan, J. D., « Pad++: A Zooming Graphical Interface for Exploring Alternate Interface
   Physics », UIST '94, p. 17-26 —
   https://www.lri.fr/~mbl/Teach/SituatedComputing/2017/papers/ZUI/pad++-uis94-p17-bederson.pdf
3. Le storyboard de Sora (des cartes de texte ou d'image posées le long du temps), décrit par la presse au
   lancement — https://www.hongkiat.com/blog/sora-openai-video-generator/ (extrait ; la documentation d'OpenAI n'a
   pas été lue).
4. Nielsen, J., « The Power of Defaults », Nielsen Norman Group, 2005 (extrait du moteur de recherche ; la page
   n'est pas lisible depuis le conteneur).
5. Shneiderman, B., « Direct Manipulation: A Step Beyond Programming Languages », *Computer* 16(8), 1983,
   p. 57-69 (DOI 10.1109/MC.1983.1654471).
6. Kurtenbach, G. & Buxton, W., « User Learning and Performance with Marking Menus », CHI '94, p. 258-264 —
   https://research.autodesk.com/app/uploads/2023/03/user-learning-and-performance.pdf_recFBbPwmG7SW9uDe.pdf
7. LTX Studio, « LTX Storyboard Generator Update: From Script to Storyboard, Faster » (le script coupé en scènes et
   en plans, les personnages en éléments) — https://ltx.studio/blog/ltx-storyboard-generator-update (extrait).
8. Runway, centre d'aide, « Camera Control » (Gen-3 Alpha Turbo : le sens et l'intensité du mouvement, sur une
   image) — https://help.runwayml.com/hc/en-us/articles/34926468947347 (extrait ; l'article est marqué ancien par
   Runway).
