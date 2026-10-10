# Montage — dix propositions d'interaction (10/10/2026)

Cal, 09/10 : « on veut des interactions simples, rapides, et on élimine des clics pour que tout soit fluide
[…] je veux des features géniales, comme quand on travaille avec un zoom sémantique ». Ce fichier est
l'étude pour le Montage (le Projet, les moniteurs, l'inspecteur, la timeline). Pas de code : des propositions,
chacune avec le geste d'aujourd'hui compté, le geste proposé, le principe et sa source, le coût.

Deux lots du 09/10 travaillent le Montage en ce moment et ne sont pas repris ici : **montage-selection** (le
rectangle de sélection sur plusieurs pistes, générer une vidéo ou une musique dans une plage de piste) et
**montage-medias** (le son lié au dépôt, les assets du projet quel que soit le chemin d'arrivée, les vignettes
d'effets au format, les calques d'effet). Plusieurs propositions s'appuient sur eux ; c'est dit à chaque fois.
Les mots sont ceux du lexique (`docs/etudes/redaction.md`) : un plan, une piste, une séquence, la timeline, un
rendu, un calcul.

## 1. Ce qui a été mesuré

Un portail d'essai neuf (`tools/portail_essai.py 9041`, moteurs factices), Chromium sans affichage, un pilote qui
fait les parcours et compte chaque geste. Le pilote et ses captures sont dans le scratchpad de la session :
`ib2/p_montage.mjs`, `ib2/p_montage-dark.txt` (le relevé), `ib2/shots/mt-*.png`, la capture annotée
`ib2/annotees/montage-poser.png`.

| parcours (aujourd'hui) | clics | touches | glisser | gestes |
|---|---|---|---|---|
| une séquence neuve et ses plans : « Nouvelle », la fenêtre « Créer », le filtre Vidéos, la première vidéo, Maj+clic sur la dernière, le paquet glissé sur le Programme, Origine, Espace | 5 | 2 | 1 | **8** |
| un plan, par le moniteur Source : double-clic dans le Projet, (I, O), « Insérer » | 1 + 1 double-clic | 0 à 2 | | **2 à 4** |
| couper un plan à la tête et raccorder : la règle (la tête), le plan, Ctrl+K, le morceau de droite, Maj+Suppr | 3 | 2 | | **5** |
| un fondu enchaîné : le plan, Ctrl+D | 1 | 1 | | **2** |
| exporter : « Exporter », la fenêtre (étendue, qualité), « Lancer l'export » | 2 | | | **2** + une fenêtre |
| changer d'outil pour un geste et revenir (Propagation, puis Sélection) : B, le geste, V | | 2 | 1 | **3** |

Ce qui est déjà bien, et qu'on garde : tout Premiere au clavier (les raccourcis du tableau d'Adobe, J K L, I O,
virgule et point) ; un paquet de plans glissé sur le Programme se pose au bout, dans l'ordre ; le menu du clic
droit partout, avec la raison d'une entrée grise ; la molette commune à toutes les timelines (`commun/molette.js`) ;
l'annulation de chaque geste ; « Nouvelle séquence à partir de l'élément » ; un plan envoyé d'un autre outil
(`montage/?add=`) crée la séquence à ses réglages s'il n'y en a pas.

Les frictions vues :
- **Une fenêtre pour un nom** : une séquence neuve demande son nom (« Séquence du 10/10 » proposé, qu'on garde
  presque toujours) alors que le nom se change déjà sur place, en haut (`#p-name`).
- **Glisser sur la timeline écrase** (Ctrl en glissant : insérer — `montage/timeline.js`) : poser plusieurs plans
  au même endroit remplace ce qui y était. Et après la pose, la timeline reste au zoom d'avant (306 %) : on voit
  10 s d'un montage de 39 s ; il faut « tout » (\\).
- **Couper demande trois visées** : poser la tête, choisir le plan, Ctrl+K — alors que la souris est déjà sur
  l'endroit à couper.
- **Choisir un morceau d'un plan passe par le moniteur Source** : double-clic, I, O, Insérer ; le Projet ne montre
  qu'une image par plan.
- **Dix outils dans une barre** (Sélection, Sélection de piste, Propagation, Déplacement de la coupe, Vitesse,
  Cutter, Slip, Slide, Main, Zoom) : chaque geste spécial demande d'aller et revenir.
- **Cinq panneaux toujours ouverts** (Projet, Effets · Source, Programme, Inspecteur, la timeline) : la timeline
  n'a que 40 % de la hauteur (capture annotée), alors que c'est là qu'on monte.

## 2. Les dix propositions

« Géniale » : ça change la façon de travailler. « Rapide » : ça enlève des clics tout de suite.

### 1. Monter par le texte — géniale

- **Aujourd'hui** : pour enlever une phrase d'une interview, on écoute, on pose la tête au début (clic), Ctrl+K,
  on cherche la fin à l'oreille (J K L), Ctrl+K, on choisit le morceau, Maj+Suppr : ≈ 8 gestes par phrase, et
  autant d'écoutes.
- **Proposé** : un onglet **Texte** à côté d'Effets et de Source : les mots de la séquence, dans l'ordre de la
  timeline (Transcrire, mode Complet : chaque mot à son instant). **Sélectionner une phrase et Suppr** l'enlève de
  la timeline et raccorde ; **glisser une phrase** ailleurs déplace le plan qui la porte. Un clic sur un mot y met
  la tête. 2 gestes par phrase, sans écouter pour viser.
- **Ce que ça change pour Cal** : une interview, un dialogue, une voix off se montent comme on corrige un texte.
- **Principe** : Descript, « Edit like a doc » — effacer le texte efface le média, couper-coller le déplace, rien
  n'est détruit [1] ; Premiere, « Text-Based Editing » — couper ou effacer du texte retire les plans, avec
  propagation [2] ; DaVinci Resolve 20, IntelliScript, qui monte une timeline en rapprochant un script de la
  transcription [3].
- **Coût** : gros (un panneau, le lien mot ↔ plan dans `montage/model.js` ; les gestes de la timeline existent :
  couper, supprimer et raccorder). **Dépend de** : Transcrire en mode Complet sur les DGX (factice ici) ; un plan
  sans parole n'a pas de texte et reste dans la timeline.

### 2. La planche qui devient la séquence — géniale

- **Aujourd'hui** : pour essayer un autre ordre de plans, on les glisse un à un sur la timeline, à la bonne
  hauteur et au bon endroit, en surveillant l'aimant ; dézoomé, les plans ne sont plus que des traits.
- **Proposé** : un **zoom sémantique** de la timeline. Au-delà de « tout », la piste V1 se change en **planche** :
  une carte par plan (son image du milieu, son nom, sa durée), sur des rangées ; on les **glisse pour changer
  l'ordre**, la séquence se recolle sans trou. Zoomer revient à la timeline, au même endroit. De près, l'inverse :
  chaque image du plan, numérotée, pour couper à l'image.
- **Ce que ça change pour Cal** : on pense l'ordre des plans comme sur un mur de post-its, sans quitter la
  séquence.
- **Principe** : Pad++, la taille apparente décide du détail montré [4] ; Premiere, « storyboard edits » — ranger
  les plans en vignettes, puis « Automate to Sequence » les pose dans cet ordre [5].
- **Coût** : gros (`montage/timeline.js` : un palier de dessin et son geste de réordonnancement ; le modèle sait
  déjà raccorder). **Dépend de** : rien ; les pistes du dessus restent accrochées à leur plan (comme le son lié du
  lot montage-medias).

### 3. Prolonger un plan trop court — géniale

- **Aujourd'hui** : un plan qui manque de deux secondes : on retourne dans Vidéo, on retrouve la vidéo, « ⋯ »,
  « Continuer le plan », on écrit la suite, « Générer », on attend, on revient, on pose la suite, on coupe, on
  raccorde (≈ 12 gestes et deux changements de page).
- **Proposé** : tirer la poignée de fin **au-delà de la fin de sa source** : la partie en plus se hachure et
  propose **« Prolonger »** (1 clic). La suite part de la dernière image (le « Continuer le plan » de Vidéo, avec le
  prompt du plan), un plan provisoire montre l'avancement, puis le rendu prend sa place à la bonne longueur.
  1 glisser + 1 clic.
- **Ce que ça change pour Cal** : le manque se répare là où on le voit.
- **Principe** : Premiere, « Generative Extend » — ajouter des images au début ou à la fin d'un plan pour tenir un
  raccord [6].
- **Coût** : moyen (la poignée, l'appel à `movie/frame` puis au mode Images de Vidéo). **Dépend de** : le plan
  provisoire du lot **montage-selection** (le même mécanisme que « générer dans une plage ») ; la durée est
  aimantée à la grille d'H3 (au moins 5,2 s générées, coupées à ce qu'il faut). La suite ressemble au plan sans
  le continuer à coup sûr : à essayer.

### 4. Une séquence sans fenêtre — rapide

- **Aujourd'hui** : « Nouvelle », la fenêtre, « Créer » (2 clics), puis les plans.
- **Proposé** : sur un Montage sans séquence, **lâcher un plan sur la timeline crée la séquence** à ses réglages
  (taille, cadence), nommée « Séquence du 10/10 » ; le nom se change sur place, en haut, comme aujourd'hui.
  « Nouvelle » crée tout de suite, sans fenêtre (Ctrl+Z l'enlève). 2 → 0.
- **Ce que ça change pour Cal** : on commence à monter dès l'arrivée.
- **Principe** : Premiere, « New Sequence From Clip » (les réglages du plan, son nom) [7] ; la règle 7 du thème :
  rien à valider qui pourrait se faire seul.
- **Coût** : petit (`newSequenceFrom` existe ; le dépôt de la timeline sans séquence l'appelle). **Dépend de** :
  rien.

### 5. Couper sous la souris — rapide

- **Aujourd'hui** : poser la tête (clic dans la règle), choisir le plan, Ctrl+K : 3 gestes ; ou l'outil Cutter
  (C), le clic, retour à la Sélection (V).
- **Proposé** : quand la souris survole la timeline, le Programme montre **l'image sous la souris** (un trait fin
  la suit, distinct de la tête) ; **Ctrl+K coupe là**, sur le plan survolé. Souris ailleurs : Ctrl+K coupe à la
  tête, comme aujourd'hui. 1 touche.
- **Ce que ça change pour Cal** : on coupe en regardant l'image, sans viser deux fois.
- **Principe** : Final Cut Pro, le « skimming » — ce qui passe sous le pointeur, dans le navigateur ou la timeline,
  se lit dans le visualiseur [8].
- **Coût** : petit à moyen (`montage/timeline.js`, `player.js` : afficher une image à un temps existe pour la tête ;
  la copie de défilement, `server/tools/defilement.py`, suit la souris sans retard ; le son au défilement,
  `commun/scrub.js`, peut suivre). **Dépend de** : rien ; une préférence pour l'éteindre.

### 6. Prendre un morceau au survol du Projet — rapide

- **Aujourd'hui** : double-clic sur le plan (le moniteur Source passe devant Effets), I, O, « Insérer » : 4 gestes
  et un panneau qui change.
- **Proposé** : survoler une vignette du Projet la **parcourt** (gauche = début, droite = fin) ; **I** et **O**
  pendant le survol marquent l'entrée et la sortie ; on **glisse la vignette** : seul le morceau part. 3 gestes,
  le panneau Effets reste.
- **Ce que ça change pour Cal** : on choisit ses morceaux dans le Projet même ; le moniteur Source ne sert plus
  qu'au travail fin.
- **Principe** : Premiere, « Hover Scrub » dans la vue en icônes, et I / O pendant le survol [9].
- **Coût** : petit (chaque vidéo a déjà sa copie faite pour être parcourue image par image, en 10 à 17 ms par
  image : `/api/defil/<id>`, `server/tools/defilement.py`).
  **Dépend de** : rien.

### 7. Les outils tenus — rapide

- **Aujourd'hui** : B (Propagation), le geste, V (retour) : 3 gestes ; on oublie souvent le retour, et le geste
  suivant fait autre chose.
- **Proposé** : **tenir** B, N, R, Y, U ou C pendant le geste ; au relâché, on revient à l'outil d'avant. Une
  frappe brève garde le comportement d'aujourd'hui (l'outil reste). 1 geste.
- **Ce que ça change pour Cal** : plus d'outil oublié allumé ; les dix outils deviennent des touches qu'on tient.
- **Principe** : les quasi-modes de Raskin — un mode qui ne dure que tant qu'on le tient ne surprend jamais [10] ;
  Final Cut Pro : tenir R prend l'outil Plage le temps du geste [11].
- **Coût** : petit (`montage/montage.js`, `TOOL_BY_KEY` : distinguer appui long et frappe). **Dépend de** : rien.

### 8. Découper une vidéo longue en plans — moyen

- **Aujourd'hui** : une vidéo de 3 min faite de vingt plans (un film de référence, un rendu d'un autre outil) : on
  coupe à la main à chaque changement de plan (≈ 3 gestes par coupe, 60 gestes).
- **Proposé** : au clic droit sur un plan, **« Couper aux changements de plan »** (1 clic) : les coupes tombent
  d'elles-mêmes, une par changement d'image ; Ctrl+Z les enlève toutes. Dans le Projet, la même commande fait des
  morceaux qu'on pose un à un.
- **Ce que ça change pour Cal** : on démonte une référence pour l'étudier ou la remonter, en un geste.
- **Principe** : Premiere, « Scene Edit Detection » — des coupes, des sous-plans ou des marques à chaque
  changement de plan [12]. Chez nous, le calcul existe déjà : la chaîne de Movie Analysis trouve les coupes par le
  score de scène de ffmpeg, sans modèle (`analyse/chaine/video-shots.mjs`, seuil 0,3) — une seule vérité.
- **Coût** : moyen (une route serveur qui appelle ce calcul sur la voie `cpu`, puis les coupes dans la timeline).
  **Dépend de** : ffmpeg sur DGX2 (présent).

### 9. Poser à la suite, et voir tout — rapide

- **Aujourd'hui** : glisser plusieurs plans sur la timeline écrase ce qui est dessous (Ctrl : insérer) ; après la
  pose, la vue reste au zoom d'avant et la fin du montage sort de l'écran (« tout », \\, pour la revoir).
- **Proposé** : un paquet glissé sur la timeline **s'insère** au point de chute, dans l'ordre de la sélection, et
  pousse la suite ; **Alt** écrase (le geste inverse d'aujourd'hui, réservé au remplacement d'un plan). Si la pose
  sort de la vue, la vue s'ajuste pour la montrer. 1 glisser, 0 réglage de vue.
- **Ce que ça change pour Cal** : poser n'abîme jamais ce qui est déjà monté.
- **Principe** : les défauts intelligents — le comportement par défaut est celui qui ne détruit rien [13] ;
  « Automate to Sequence » pose une sélection dans l'ordre choisi [5]. (Dans Premiere, glisser écrase et Ctrl +
  glisser insère : on s'en écarte volontairement ; à dire dans l'aide du « ? ».)
- **Coût** : petit (`montage/timeline.js`, le drop : inverser le mode ; `z-fit` existe). **Dépend de** : l'accord de
  Cal, puisqu'on quitte la convention de Premiere.

### 10. Monter sur le rythme de la musique — géniale

- **Aujourd'hui** : couper sur les temps d'une musique, c'est écouter, poser une marque à l'oreille (M) à chaque
  temps fort, puis aligner chaque coupe sur sa marque (≈ 3 gestes par plan).
- **Proposé** : une musique posée sur une piste son propose **« Marquer les temps »** (1 clic) : les temps et les
  mesures se dessinent sur la règle, l'aimant les prend. Puis, sur une sélection de plans : **« Poser sur les
  temps »** (1 clic) — un plan par mesure (ou par 2, 4 temps : un réglage), dans l'ordre. 2 clics pour un clip
  monté en rythme.
- **Ce que ça change pour Cal** : un montage musical (bande-annonce, clip) part juste du premier coup.
- **Principe** : « Automate to Sequence » de Premiere, qui pose une sélection de plans aux marques de la séquence
  [5] ; le détecteur de tempo d'ODIO, qui tourne dans la page en une fraction de seconde (`musique/tempo.js`,
  `server/tools/music_tempo.py`) — une seule vérité, réutilisée.
- **Coût** : moyen (les marques existent dans le Montage ; brancher `tempo.js` sur un son posé ; la pose sur les
  marques). **Dépend de** : un son au tempo régulier ; un morceau rubato donne des temps faux, et la page le dit.

## 3. Le top 3

1. **Monter par le texte** (n° 1) : la façon de monter une parole change ; gros, mais tout ce qu'il faut existe
   (Transcrire, les gestes de la timeline) ; à faire après le câblage réel de Transcrire.
2. **Couper sous la souris** (n° 5) : 3 gestes → 1 touche, le geste le plus fréquent d'un montage ; petit.
3. **Prolonger un plan trop court** (n° 3) : la génération là où on monte, d'un glisser ; moyen, sur le plan
   provisoire du lot montage-selection.

Puis, petits chacun : une séquence sans fenêtre (4), le morceau au survol du Projet (6), les outils tenus (7).

## Sources

1. Descript, « Edit like a doc » (effacer le texte efface le média ; couper-coller le déplace ; rien n'est
   détruit) — https://help.descript.com/getting-started/edit-like-a-doc (extrait du moteur de recherche,
   10/10/2026).
2. Adobe, « Edit sequences using Text-Based Editing » (couper ou effacer du texte retire les plans, avec
   propagation) — https://helpx.adobe.com/se/premiere/desktop/edit-projects/edit-video-using-text-based-editing/edit-sequences-using-text-based-editing.html
   (extrait ; les pages d'Adobe refusent les robots).
3. DaVinci Resolve 20, IntelliScript (une timeline montée en rapprochant le script de la transcription), décrit au
   lancement — https://www.provideocoalition.com/blackmagic-introduces-davinci-resolve-20/ (extrait).
4. Bederson, B. B. & Hollan, J. D., « Pad++: A Zooming Graphical Interface for Exploring Alternate Interface
   Physics », UIST '94, p. 17-26 —
   https://www.lri.fr/~mbl/Teach/SituatedComputing/2017/papers/ZUI/pad++-uis94-p17-bederson.pdf
5. Adobe, « Storyboard edits » (les plans rangés en vignettes, « Automate to Sequence » : à la suite ou aux
   marques de la séquence) — https://www.adobe.com/learn/premiere-pro/web/storyboard-edits (extrait).
6. Adobe, « Generative Extend in Premiere Pro (beta) », 14/10/2024 —
   https://blog.adobe.com/en/publish/2024/10/14/generative-extend-in-premiere-pro (extrait).
7. Adobe, « How to arrange clips into sequences » (« New Sequence From Clip »), cité et lu pour
   `docs/etudes/montage.md` (« Les séquences : des objets d'Asset »).
8. Apple, *Final Cut Pro User Guide*, « Skim media » (le contenu sous le pointeur se lit dans le visualiseur ; le
   son au défilement à part) — https://support.apple.com/guide/final-cut-pro/vere9ba3609/mac (extrait).
9. Adobe, « Customize the Icon View in Project panel » (Hover Scrub : survoler une vignette la parcourt, sans son) —
   https://helpx.adobe.com/dk/premiere/desktop/get-started/customize-the-project-panel/customize-icon-view-in-project-panel.html
   (extrait) ; I et O pendant le survol : PremiumBeat, « Premiere Pro CS6 Hover Scrub in the Project Panel » —
   https://www.premiumbeat.com/blog/premiere-pro-hover-scrub/ (extrait).
10. Raskin, J., *The Humane Interface*, 2000, les quasi-modes — https://www.raskincenter.org/rchi/core-principles
    (extrait).
11. Apple, *Final Cut Pro for iPad*, « Select items in the timeline » (l'outil Plage) —
    https://support.apple.com/guide/final-cut-pro-ipad/devcdf7f0dfc/ipados ; tenir R pour l'outil le temps du
    geste : ProVideo Coalition, « The versatile Range Selection tool in Final Cut Pro X » —
    https://www.provideocoalition.com/the-versatile-range-selection-tool-in-final-cut-pro-x/ (extraits).
12. Adobe, « Detect edit points using Scene Edit Detection » (couper, sous-plans ou marques à chaque changement de
    plan) — https://helpx.adobe.com/premiere-pro/using/scene-edit-detection.html (extrait).
13. Nielsen, J., « The Power of Defaults », Nielsen Norman Group, 2005 (extrait du moteur de recherche ; la page
    n'est pas lisible depuis le conteneur).
