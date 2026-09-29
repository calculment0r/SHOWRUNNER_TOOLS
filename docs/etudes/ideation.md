# Étude — l'outil Idéation (29/09/2026)

Demande de Cal (29/09) : « on veut aussi un canva d'idéation ». Il fait des
films et des personnages photoréalistes : le canvas sert à poser, rapprocher
et faire naître des idées visuelles avant de passer aux outils de
production. Consigne en vigueur : **l'UX et l'UI d'abord**, les générations
passent par les travaux existants du portail (`image.generate`,
`image.edit`), aujourd'hui sur leur moteur factice.

## 1. Ce que font les canvas d'idéation des outils de création

| outil | ce qu'on pose | comment une génération naît | relier | vers la production |
|---|---|---|---|---|
| **FLORA** (flora.ai) | des « nodes » texte, image, vidéo, audio, 3D sur un canvas infini [1] | un node se crée d'un double-clic ; ses sorties vont dans **l'historique de générations du node** ; un historique au niveau du compte les réutilise d'un projet à l'autre [2] | on tire la poignée « + » d'un node vers un autre ; les entrées multiples se réordonnent en les glissant ; on peut relier un node encore en calcul [3] | télécharger depuis la barre du node [2] |
| **Krea Nodes** | nodes de génération (image, vidéo, édition, agrandissement, 3D…), « section nodes » pour grouper, groupes, **post-it** [4] | un node de génération sort ses résultats par sa poignée de sortie vers les nodes branchés [4] | poignées **colorées par type de donnée** ; glisser depuis une poignée propose les nodes compatibles [4] | modèles de flux partagés |
| **Krea 2 — mood boards** | un tableau de références (plus de quatre images, « no hard limit ») [5] | le tableau analysé donne un profil de goût, des mots-clés et des « avoids », puis guide la génération [5] | — | le tableau se choisit dans l'outil image [5] |
| **Freepik Spaces** | « prompts, references, generations and notes on an infinite shared canvas » ; nodes Upload, Text, Assistant, Image, Video, Upscaler [6] | chaque étape est un node ; plusieurs images d'un même sujet reliées donnent de meilleurs angles extrêmes [6] | on relie les nodes pour dire où passent les données [6] | le flux se rejoue, se partage |
| **Higgsfield Canvas** (avril-mai 2026) | prompts, références, générations de tous ses modèles sur un tableau infini [7] | « a prompt feeds an image, an image feeds a video, a style branches into variations » ; chaque version est gardée [8] | on glisse la sortie d'un node dans l'entrée du suivant ; une image reliée à Kling = **première image**, pas référence [7] | les personnages Soul ID et les générations passées entrent comme nodes [8] |
| **Higgsfield Popcorn** | jusqu'à 4 références (personnage, lieu, objet, ambiance) [9] | une suite de 8 cases cohérentes ; une case se retouche et se refait [9] | — | « a frame works as a start frame or reference for Kling or Veo » [9] |
| **Milanote** | images, notes, vidéos, **nuanciers**, PDF, fichiers déposés du disque [10] | — | libre, sans contrainte de grille [10] | PDF imprimable du tableau, lien en lecture [10] |
| **Miro** | post-it colorés, **cadres** (frames) [11] | — | — | un cadre s'exporte **en image** ; à l'export, seul ce qui est entièrement dans le cadre compte [11] |

Navigation commune (Krea, doc officielle [4]) : glisser le fond ou
espace + glisser pour se déplacer, molette ou pincement pour zoomer,
**cadre de sélection** ou Maj + clic pour choisir plusieurs objets.

## 2. Ce qu'on reprend, et pourquoi

1. **Deux familles d'objets sur la même planche** (Milanote + FLORA) : ce
   qu'on pose (images, vidéos, sons, éléments de la bibliothèque, notes,
   post-it, titres, nuanciers) et ce qui fabrique (la carte « Générer »).
   Cal travaille d'abord par références : une planche d'ambiance doit
   rester une planche d'ambiance, pas un graphe.
2. **Les liens portent le sens** (FLORA, Freepik, Higgsfield) : une image
   ou un élément relié à une carte « Générer » en est une **référence**,
   dans l'ordre des liens (Qwen `<image1>…`, Krea : la scène puis le
   sujet) — le nombre maximal est celui du modèle (`/api/image/models`).
   Les résultats se posent **à côté de la carte, reliés à elle** : la
   planche garde qui vient d'où, comme l'historique de FLORA, mais à plat.
3. **Variations et édition depuis l'objet posé** (Higgsfield « branches
   into variations », Popcorn « regenerate ») : « Variations » relance la
   recette de l'image (`/api/image/redo`), « Éditer » passe par
   `image.edit` (consigne, détourer, agrandir) ; le résultat se pose à
   côté, relié. Une image déposée n'a pas de recette : le bouton le dit et
   propose une carte « Générer » qui la prend en référence.
4. **Cadres = zones nommées** (Miro frames, Krea section nodes) : un
   cadre regroupe une planche d'ambiance ou une séquence ; le déplacer
   emmène ce qu'il contient ; il s'exporte seul en PNG. En plus des outils
   étudiés : un cadre d'images devient un **élément** (style, lieu,
   personnage) que l'image et la vidéo H3 prennent en référence — le
   mood board de Krea 2 [5], avec les éléments du portail.
5. **Nuancier tiré d'une image** (Milanote a des nuanciers [10]) : une
   quantification médiane de PIL (`Image.quantize`, MEDIANCUT) sur le
   serveur ; les couleurs sont des données, pas des jetons du thème.
6. **Passer à la production depuis l'objet** (Popcorn → Kling/Veo [9]) :
   Éditer dans Image, Animer (première image) et Référence vidéo (Movie
   Creator), Ajouter au montage, Faire un élément, Exporter en PNG dans la
   bibliothèque. Les adresses sont celles que les pages lisent déjà
   (§ 4).
7. **Ce qu'on ne reprend pas** : l'exécution en chaîne d'un graphe entier
   (Krea, Freepik) — la chaîne de Cal est Character Factory ; la
   collaboration temps réel (un seul utilisateur pour l'instant) ; les
   profils de goût par modèle de langage (Krea 2) — à revoir quand les
   modèles seront câblés.

## 3. Ce qui est fait

- `ideation/` : `index.html`, `ideation.js` (planches, enregistrement,
  annuler/rétablir, clavier, gestes à plusieurs objets), `canvas.js`
  (vue, objets, sélection au cadre et au lasso, liens, mini-carte, dépôts),
  `library.js` (le panneau de la bibliothèque), `inspector.js` (le panneau
  de droite), `gen.js` (carte Générer, variations, éditions, pose des
  résultats), `ideation.css`.
- Glisser-déposer : celui du socle (`dragItem`, `dropZone`, `ITEM_MIME` de
  `commun/shell.js`, règle de Cal du 29/09) sur la planche et dans
  l'emplacement des références d'une carte Générer ; un fichier du disque
  entre dans la bibliothèque en `tool: 'upload'`, `via: 'ideation'`.
  L'export PNG d'une planche reste `tool: 'ideation'` (une création).
- `server/tools/ideation.py` : planches sous `<data_dir>/ideation/<id>.json`
  (créer, lister, lire, enregistrer avec `rev` — 409 si un autre onglet a
  écrit —, renommer, dupliquer, corbeille), nuancier
  (`/api/ideation/palette/<id>`), export PNG (travail `ideation.export`,
  voie `cpu`, PIL, rangé dans la bibliothèque avec sa lignée), `selftest`.

## 4. Les adresses des autres outils (vérifiées dans leur code, 29/09)

| geste | adresse | lue par |
|---|---|---|
| Animer | `movie/?start=<id>` | `movie.js` (boot : mode image → vidéo) |
| Référence vidéo | `movie/?ref=<id>` | `movie.js` (boot : mode références) |
| Ajouter au montage | `montage/?add=<id>` | `montage.js` (start) |
| Éditer dans Image | `image/#<id>` | `image.js` lit le **fragment** ; `image/?edit=<id>`, qu'emploie `asset.js`, n'est lu par personne : l'image ne s'ouvre pas (signalé, non corrigé ici) |
| Dans Asset | `asset/#<id>` | `asset.js` (fiche) |

## Sources

1. FLORA, « Node Overview », https://docs.flora.ai/nodes/editor.md
2. FLORA, « Image Node » (question à la doc : sorties « saved as items in that node's generation history »), https://docs.flora.ai/nodes/image-node.md
3. FLORA, « Canvas », https://docs.flora.ai/editor/canvas
4. Krea, « Nodes workflows », https://www.krea.ai/docs/user-guide/features/nodes
5. Krea, « Mood boards in Krea 2 », https://www.krea.ai/blog/moodboards-krea-2
6. Freepik, « Introduction to Spaces », https://www.freepik.com/ai/docs/introduction-to-spaces (page refusée au robot ; extraits lus dans le moteur de recherche) ; Magnific, « Introducing Spaces », https://www.magnific.com/blog/introducing-spaces/
7. Higgsfield, « How to Use Higgsfield Canvas », https://higgsfield.ai/creator-hub/help-center/tools/how-do-i-use-canvas
8. Higgsfield, « AI Canvas », https://higgsfield.ai/canvas-intro
9. Higgsfield, « How to Use Popcorn », https://higgsfield.ai/creator-hub/help-center/ai-models/how-do-i-use-popcorn
10. Milanote, « Moodboarding », https://milanote.com/product/moodboarding
11. Miro Help Center, « Frames » et « How to export your board », https://help.miro.com/hc/en-us/articles/360018261813-Frames (page refusée au robot ; extraits lus dans le moteur de recherche)
