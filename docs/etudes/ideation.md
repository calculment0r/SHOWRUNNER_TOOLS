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
   Éditer dans Image, Animer (première image) et Référence vidéo (l'outil
   Vidéo), Ajouter au montage, Faire un élément, Exporter en PNG dans la
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

## 5. Les fils : ports typés, cartes vidéo, composeur (29/09, soir)

Demande de Cal (29/09) : « plus d'intelligence dans la conception » — des
cartes Générer vidéo, des fils aussi beaux que ceux du nodal d'ODIO (les
flèches droites restent pour d'autres fonctions), des entrées justes en temps
réel (il avait changé de modèle, la carte disait encore que Z-Image prenait
une référence), un fil lâché sur une carte qui trouve sa place, un composeur
de prompt « comme dans Weavy ». Le composeur suit l'étude
`ideation_weavy.md` (§ 9, v1 : sans « varier » ni pastilles).

### 5.1 La seule vérité : `ideation/ports.js`

Pure (ni DOM ni réseau), essayée par node dans le contrôle
(`server/tools/ideation.py`, `_selftest_ports`, 17 contrôles).

- **Sortie** d'un objet (`outPort`) : `text` (note, post-it, titre,
  composeur), `image` | `video` | `audio` | `element` (un objet de la
  bibliothèque), `image` (carte Générer image : son dernier résultat),
  `video` (carte Générer vidéo : son dernier résultat).
- **Entrées** (`inPorts(n, caps)`) : `{ id, label, accepts, max, why, lock,
  off, token }`.
  | carte | entrées |
  |---|---|
  | Générer image (`gen`) | `prompt` (un texte) · `refs` (images, éléments ; `max` = `refs` du modèle dans `/api/image/models`, 0 pour Z-Image avec sa `refs_why`) |
  | Générer vidéo (`vgen`), mode `t2v` | `prompt` |
  | `vgen`, mode `i2v` | `prompt` · `start` (une image) · `end` (une image) |
  | `vgen`, mode `r2v` | `prompt` · `image`, `element`, `video`, `audio` (`limits` de `/api/movie/options` ; un élément compte ses images comme `element_parts` de movie.py) |
  | composeur (`compose`) | `s:<case>` : un texte par case |
- **Un fil** : `{ id, a, b, kind: 'wire', pa, pb, label }` — `pa` la sortie
  de `a` (sa sorte), `pb` l'entrée de `b`. Les **annotations** restent
  `arrow` et `line` (flèches droites, outil L) ; la **lignée** `out` (une
  carte et ses résultats). L'ordre des fils d'une entrée est leur ordre dans
  la planche : réf. 1, 2… (Qwen `<image1>`…), `@image1`, `@image2`… (H3).
- `canWire(board, a, pa, b, pb, caps, items)` rend `''` ou la raison :
  sorte refusée, entrée fermée (le `refs_why` de l'outil Image), case
  verrouillée, plein (`Krea 2 prend 2 références au plus`), plafond d'images
  d'H3, boucle. Une entrée à une place (prompt, première image, case) : le
  nouveau fil remplace l'ancien (`replaces`), ctrl+Z le défait.
- `flow(board, caps, items)` : l'état de chaque fil (`ok`, `why`, `idx`,
  `pending` : sa source fabrique et n'a pas encore de résultat, `off` : case
  coupée) et ce que chaque entrée reçoit. **Un fil qui ne va plus** (modèle
  changé, mode changé, objet parti à la corbeille) : `ok: false`, dessiné en
  alerte avec sa raison au survol et sur la carte, **pas envoyé** — il revient
  bon si la carte le reprend. Rien n'est relu en silence.
- Les capacités (`caps.image`, `caps.movie`) sont lues chez les outils ;
  avant leur lecture, un plafond inconnu vaut `null` : rien n'est marqué faux
  sur une supposition.

### 5.2 Le dessin : `commun/wire.js` + `wire.css`

Le câble d'ODIO (`musique/nodal.js`, `musique.css`) sorti en module : la
Bézier horizontale (poignées à la moitié de l'écart, 40 au moins), trait de 2
à 75 % dans la teinte de la source, clic sur 16, fil choisi orange à 3, fil
tiré en tirets 5 5, envois en 6 5. ODIO n'a pas d'animation de flux : il n'y
en a pas. Ajouts pour un canvas qui zoome de 8 à 400 % : l'épaisseur reste
celle de l'écran, le survol éclaire, un fil en alerte passe en pointillés
orange (`--or`, l'alerte), un fil en attente s'efface à moitié. Teintes
(`KINDS`, jetons) : texte `amb`, image `coral-3`, élément `coral-2`, vidéo
`cy`, son `grn2` — celles des pastilles de la bibliothèque et du plan.

### 5.3 Les gestes

- **Tirer un fil** depuis une sortie (ou une entrée) : les ports qui
  prennent s'allument, les autres s'éteignent, les cartes sans entrée
  possible pâlissent. Lâché **sur une carte** : l'entrée survolée (port ou
  ligne), sinon la seule qui prend, sinon un petit choix (commun/menu.js) ;
  rien ne prend : le menu dit pourquoi, entrée par entrée, et propose une
  flèche d'annotation. Lâché **dans le vide** : « créer, déjà branché »,
  filtré par ce qu'on tire (depuis un texte : Générer image, Générer vidéo ›
  trois modes, Composeur en case Libre ; depuis une image : Générer image —
  Krea 2 si le modèle par défaut ne prend pas de référence —, Générer vidéo ›
  Images ou Références), puis Note et Post-it fléchés. Depuis une entrée :
  de quoi la remplir (note, composeur, bibliothèque).
- **Texte lâché sur un texte**, après un arrêt de 0,4 s au-dessus : un
  composeur, les deux textes branchés dans deux cases Libres (la cible
  d'abord), le texte glissé revient à sa place — un pas d'annulation. Sur un
  composeur : la case sous le curseur, sinon la première vide, sinon une
  case Libre neuve. Les règles « objet lâché sur un objet » sont une liste
  (`app.dropRules`) : le module des groupes y ajoute la sienne après.
- **Dupliquer** (ctrl+D) une carte ou un composeur garde les fils qui y
  entrent : une variante garde ses sources.
- **Détacher** : le texte reçu est copié là où il arrivait, le fil coupé.
- Une carte se refait dès que ce qu'elle reçoit change ; seule la carte où
  l'on écrit attend qu'on quitte le champ (le bug du 29/09 venait de là : un
  sélecteur ou un bouton gardait aussi la carte figée).

### 5.4 Les cartes

- **Générer image** : prompt (écrit, ou reçu en lecture avec sa source),
  références (vignettes numérotées, les ignorées barrées), modèle (ses
  entrées suivent), format, nombre ; les fils ignorés en une ligne par
  raison.
- **Générer vidéo** : les trois modes de l'outil Vidéo, la durée
  (`frames`), la toile, et dans l'inspecteur la méthode, la graine, le son,
  la musique, l'estimation et le prompt envoyé à H3. La carte demande le plan
  à `/api/movie/plan` (la vérité de la page Vidéo) et lance `movie.<mode>`
  par la file (`tool: movie`) ; le résultat se pose à droite, relié.
- **Composeur** : cases à rôle (Style, Personnages, Action, Décor,
  Photographie ; + Son, Musique, Libre), l'ordre de la carte est celui de la
  prose (menu de l'étiquette : rôle, monter, descendre, renommer, retirer) ;
  chaque case donne une phrase (un point s'il en manque un, `_sentence`
  d'image.py), jointes par une espace, sans mot inventé ; Son et Musique vont
  aux champs `sound` et `music` d'H3, une carte image les ignore et le dit ;
  verrou : ni écriture ni fil ; couper : hors de la prose, gardée.

### 5.5 Les planches d'avant

Champ `v` de la planche (2 depuis les fils). Une planche sans `v` est migrée
à la lecture (`normalize`) : une flèche d'une image ou d'un élément vers une
carte Générer était sa référence — elle devient le fil `refs`, son mot gardé ;
les autres liens restent des annotations. La page renvoie `v` ; une flèche
tirée exprès vers une carte, ensuite, reste une flèche.

### 5.6 Ce que le canvas donne aux modules greffés (atelier, collaboration)

- `canvas.toWorld(x, y)` / `toScreen(wx, wy)` (coordonnées de la fenêtre),
  `viewFor(zone, pad, zmax)`, `flyTo(vue | zone | id, { ms, pad, zmax })`
  (une promesse), `zoomAt(z, x, y)`, `decorate(fn)` (fn(n, el) à chaque objet
  refait), `lock()` / `unlock()` / `isLocked()` (la vue seule bouge).
- Événements : `view` (S.view, émis par `applyView` ; plus de relevé par image
  dans plugins.js), `moving` (les identifiants déplacés ; `[]` à la fin),
  `commit` à chaque geste — écrire dans une note ou un champ (0,6 s après la
  dernière frappe, et à la sortie d'une note), une suite de flèches du
  clavier.
- `app.reloadBoard()` : relire la planche du serveur sans recharger la page.
- Une mesure de hauteur (notes, cartes) ne salit plus la planche : ouvrir une
  planche n'enregistre rien (le 29/09, deux personnes qui l'ouvraient se
  mettaient en conflit 409 sans rien toucher) ; la hauteur mesurée part avec
  le prochain vrai geste.
- Le serveur garde `slide` sur un cadre (l'ordre de présentation).

### 5.7 Ce qui reste

- v2 du composeur (étude Weavy § 9.3) : « varier » une case (un lot), le lot
  en cadre, les pastilles Photographie écrites par le serveur selon le modèle.
- Texte lâché sur une carte Générer (il deviendrait son prompt, § 9.5) : non
  fait, pour laisser au module des groupes le geste « objet sur objet ».
- Les rôles des entrées de référence vidéo (personnage, lieu, look…) : ceux
  par défaut de movie.py ; à régler dans l'inspecteur, plus tard.
- `canvas.preview({ nodes, links })` (montrer un état passé sans toucher la
  planche) : non fait ; la machine temporelle échange encore elle-même
  `S.board.nodes` autour d'un `render()`.

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
