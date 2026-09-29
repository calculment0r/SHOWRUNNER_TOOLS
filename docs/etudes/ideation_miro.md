# Étude — sélection, groupes, cadres : l'UX de Miro et des autres (29/09/2026)

Demande de Cal (29/09) : « il nous faut un système de frames qui servent la
présentation et on veut un système de groupes qu'on peut réduire ou qui
fonctionne en zoom sémantique, comme les subnodes de ComfyUI en fait… on
essaye de ne pas faire une usine à gaz car les canvas deviennent vite
ingérables. […] si je drag un objet sur un autre, il me fait un groupe direct
avec les options de mise en forme comme Miro : un clic pour les mettre à la
même hauteur ou largeur, quand je resize le groupe, ils se remettent en forme
dedans etc. Il y a deux fonctions dans Miro : une pour resize le groupe et une
autre handle qui gère l'auto-organisation dans cette sélection d'objets ou de
groupe. Il faut pouvoir bien sûr dégrouper les éléments et aussi les grouper
avec une zone de sélection avec plein d'objets. Quand ils sont sélectionnés un
cadre apparaît qui contient la sélection et une barre d'outils apparaît
au-dessus de ce cadre, centrée : regarde l'UX de Miro. »

La fluidité avec beaucoup d'images est l'objet d'une étude à part :
`docs/etudes/ideation_fluidite.md`. L'étude du canvas lui-même :
`docs/etudes/ideation.md`.

Lecture : l'aide de Miro (help.miro.com) refuse les robots (403) ; ce qui en
vient ici a été lu dans les extraits du moteur de recherche, marqué
« (moteur) ». Le reste vient des pages elles-mêmes : forum et annonces de
Miro, SDK de Miro, aides de Figma, documentation et code de tldraw,
d'Excalidraw et de ComfyUI. Le prototype de Cal (`atelier-canvas.html`,
`~/showrunner-refs/atelier-canvas/` sur DGX2) sert de référence pour le zoom
sémantique.

## 1. Ce que font les outils

### 1.1 La sélection et la barre au-dessus

| | Miro | FigJam / Figma | tldraw | ComfyUI |
|---|---|---|---|---|
| sélection au rectangle | par intersection : un objet touché est pris [M20] ; souris : Maj + glisser (moteur) [M28] | Maj + clic, rectangle, Ctrl+A [F7] | rectangle, Maj + clic | rectangle |
| « entièrement dedans » | appui long jusqu'au réticule (modérateur) [M20] | — | — | — |
| filtre par type | bouton « Filter » dans la barre : nombre d'objets par type (moteur) [M29] | — | — | — |
| la barre | « A context menu appears above your selection » (moteur) [M30] ; ni déplaçable ni épinglable [M32] | barre de la sélection, « Tidy up » dedans [F7] | `TldrawUiContextualToolbar` : x = `midX - w/2` (centrée), au-dessus avec un écart, ramenée dans l'écran, « disappears while shapes are being dragged, resized, or rotated » [T9][T10] | « selection toolbox » flottante (1.10, mars 2025) : couleur, bypass, épingle, supprimer, encadrer [C4] |
| contenu selon le type | post-it : couleur, taille, police auto, tags, Align [M34] ; images : « Resize » [M18] ; cadre : l'œil (masquer) [M24] ; plusieurs : Group, « Align objects » [M7][M35] ; « … » : premier plan, supprimer (moteur) [M36] | | | |

### 1.2 Grouper, dégrouper

- **Miro** : Ctrl/Cmd+G, dégrouper Ctrl/Cmd+Maj+G, verrouiller Ctrl/Cmd+Maj+L [M9].
  Un groupe se comporte comme un objet (moteur) [M7] ; un double-clic sur un
  enfant le déplace seul sans dégrouper (modérateur, 07/03/2021) [M6]. **Pas de
  groupes imbriqués** : « Previously grouped items cannot be grouped again »
  (SDK) [M15] ; dégrouper aplatit tout (idée ouverte depuis 2020) [M16]. Chaque
  objet porte un `groupId`, le groupe `itemsIds` [M15].
- **tldraw** : Ctrl/Cmd+G, Ctrl/Cmd+Maj+G ; un clic prend le groupe le plus
  extérieur, les suivants descendent (`focusedGroupId`) ; un groupe à un seul
  enfant se dissout ; il n'a « pas de représentation visuelle », sa géométrie
  est l'union de ses enfants [T1][T3].
- **Excalidraw** : Ctrl/Cmd+G ; chaque élément porte `groupIds`, « ordered
  from deepest to shallowest » [E1] ; double-clic pour éditer dans le groupe
  (moteur) [E2].

### 1.3 Glisser un objet sur un autre

**Aucun des outils étudiés ne fait un groupe quand on lâche un objet sur un
autre — Miro non plus.** Miro n'attache que les traits de stylo posés sur un
post-it, une forme ou une image (janvier 2024 : « the grouping behavior is
expected », et « a square appears around the image or shape ») [M10] ; images
et icônes posées sur un post-it « do not automatically attach » (moteur)
[M34], stickers non plus [M11]. Le « lâcher dedans » documenté partout, c'est
le **cadre** : l'objet lâché dans un cadre en devient l'enfant (Miro, SDK :
coordonnées relatives au parent) [M13][M14] ; tldraw `onDragShapesIn` /
`onDragShapesOut` [T4] ; Excalidraw `frameId` [E3] ; ComfyUI : un nœud est dans
un groupe si son centre y est (`containsCentre`) [C6].

Ce que Cal décrit (lâcher → groupe, avec la mise en forme) est donc **à
inventer**, en s'appuyant sur le retour visuel de Miro pour le stylo (un
carré autour de la cible) et sur le lâcher dans un cadre des autres.

### 1.4 Aligner, distribuer, même taille

- **Miro** : « Align objects » dans la barre (gauche, droite, haut, bas,
  centres, distribuer) (moteur) [M35] ; aucun raccourci [M9][M8]. « Même
  taille » : seulement pour les images, « resize multiple images at once by
  height or width » (17/04/2023) [M17] par l'icône « Resize » [M18] ; Miro
  précise : même proportion, « not the same size » (30/09/2024) [M19]. Pour les
  formes, c'est une demande ouverte [M21][M22].
- **Figma** : aligner Alt+W/A/S/D/V/H [F5] ; pas de « même taille ».
- **tldraw** : aligner Alt+A/D/W/S/H/V, distribuer Alt+Maj+H/V ; `stack`,
  `pack` (grille compacte), `stretch` (remplir la boîte commune), `flip` [T2][T8].
- **PureRef** fait exactement le « un clic même hauteur / même largeur » :
  **Normalize Height** (Ctrl+Alt+←), **Width** (Ctrl+Alt+→), **Size**
  (Ctrl+Alt+↑), **Scale** (Ctrl+Alt+↓), Area ; la référence est « From first »
  ou « Average » ; et **Arrange Optimal** (Ctrl+P), par nom, par ordre
  d'ajout… [P1].

### 1.5 Redimensionner le groupe, ou le réorganiser : les deux poignées

- **Miro, la poignée d'auto-organisation** s'appelle **Auto layout** (d'abord
  « Smart alignment », lancée le 01/06/2020, annoncée le 29/06/2020) [M1] :
  « click on the grey icon in the upper right corner and drag it
  horizontally » (moteur) [M7][M4] ; en 2024, « the handle with the four dots
  in the top right corner », qui range les post-it « into perfectly aligned
  rows and columns » [M3]. Tirer règle l'espacement horizontal ; le vertical
  se règle par le bord bleu de la sélection pour les post-it, images, cartes
  (modérateur, 01/06/2025) [M5]. Défaut connu : l'ordre des objets n'est pas
  gardé [M39]. En janvier 2026, un utilisateur la décrit comme une poignée de
  coin qui « instantly reflows the grid (changing columns/rows
  dynamically) » [F9] — c'est ce que Cal décrit.
- **Miro, la poignée de redimensionnement** de la sélection est une **mise à
  l'échelle** proportionnelle (le texte ne suivait plus en 2022, corrigé le
  02/11/2022) [M40] — pas un réarrangement. Le « Grid mode » des cadres (un
  objet lâché se rangeait en grille) a été abandonné, « wasn't working as
  expected » [M41][M43].
- **Figma, le vrai reflow** : **Auto layout** (Maj+A), « the layout adjusts
  without requiring manual repositioning », avec **Wrap** (passage à la ligne
  quand la place manque) [F6] ; **Smart selection** : poignées roses entre les
  objets pour l'espacement, anneau au centre pour réordonner, et redimensionner
  « while maintaining an equal distance » [F1]. **Tidy up** (Ctrl+Alt+T) range
  une fois, sans reflow ensuite [F2][F7].
- **Milanote** : des colonnes où l'on glisse et réordonne des cartes, qui se
  redimensionnent par le coin et **se replient** par le tiret (26/03/2025) [P2].

### 1.6 Les cadres (frames)

- **Miro** : déplacer le cadre emmène ses enfants ; un redimensionnement qui en
  laisserait dehors « may fail » (SDK) [M13][M14] ; pas de cadres imbriqués
  (modérateur, 27/03/2025) [M25][M26]. Le panneau des cadres donne **l'ordre de
  présentation**, qu'on change en glissant ; « Organize frames » trie de gauche
  à droite puis de haut en bas (moteur) [M27]. Masquer un cadre (l'œil,
  16/09/2020) [M24] ; formats 16:9, 4:3, A4… (moteur) [M49] ; export en image
  ou en PDF, une page par cadre (moteur) [M50].
- **FigJam, les sections** : un objet y entre quand on l'y déplace ou quand on
  pose la section dessus ; Maj+S ; « Lock background only » ; **pas de repli**
  (demande de 2022) [F8][F10].
- **tldraw** : un frame découpe son contenu (« clipped to its bounds »),
  l'option `resizeChildren` met les enfants à l'échelle [T3].

### 1.7 Le zoom sémantique

- **Miro** : pas de masquage selon le zoom (idée ouverte, « reviewing » en mai
  2024) [M51] ; les titres de cadre gardent leur taille à l'écran [M52] ;
  tableaux, frises et Kanban montrent un aperçu simplifié de loin (moteur) [M53].
- **tldraw** : le texte perd son contour sous `textShadowLod` (0,35) ; le zoom
  « efficace » (`getEfficientZoomLevel`) reste fixe pendant le mouvement
  au-delà de 500 formes [T11].
- **Le prototype de Cal** (`atelier-canvas.html`) : trois niveaux —
  « Vue d'ensemble » sous 30 %, « Travail », « Détail » au-dessus de 130 %. De
  loin, les cadres affichent leur titre en grand au centre, les notes
  deviennent des pastilles de couleur ; de près, les cartes montrent leurs
  listes, les notes leur auteur. Il ne peint que ce qui est dans la vue
  (200 px de marge).
- Notre canvas a déjà un niveau : `.cv.far` sous 42 % (la carte Générer
  n'affiche que son résumé, les légendes et les travaux se cachent).

### 1.8 ComfyUI : subgraphs et groupes

- **Subgraph** (officiel le 07/08/2025) [C1] : on sélectionne des nœuds, on
  clique sur l'icône Subgraph de la barre ; « the system will automatically
  generate a subgraph based on your selection's inputs and outputs » : les
  liens qui traversent la frontière deviennent des **entrées et des sorties**
  du nœud replié [C2][C3]. On entre par double-clic ou le bouton d'édition, on
  sort par la barre de navigation (fil d'Ariane sur plusieurs niveaux) ou
  Échap ; on renomme ou retire une entrée exposée d'un clic droit sur son
  point ; « Unpack subgraph » défait [C2].
- **Groupe** LiteGraph : un rectangle titré ; un nœud y est si son centre y
  est ; le déplacer emmène ses nœuds ; « Fit Group to Nodes » ; Ctrl+Alt+glisser
  déplace le cadre seul ; aucun repli [C6][C7].

### 1.9 Comment les autres rangent la parenté

| | l'appartenance | l'ordre |
|---|---|---|
| Miro (SDK) | `groupId` sur l'objet, `itemsIds` sur le groupe ; un cadre a des `childrenIds`, l'enfant un `parentId` [M13][M15] | — |
| tldraw | `parentId` sur chaque forme (page ou forme), x, y relatifs au parent [T6] | `index` fractionnaire, « scoped to siblings within the same parent » [T7] |
| Excalidraw | `groupIds` (du plus profond au plus large) et `frameId` sur chaque élément [E1] | `index` fractionnaire [E1] |
| ComfyUI | le subgraph est une définition à part, le nœud en est une instance [C3] | — |

Tous mettent l'appartenance **sur l'enfant**.

## 2. Ce que Cal décrit, confronté aux sources

| Cal | qui le fait vraiment | sous quel nom |
|---|---|---|
| lâcher un objet sur un autre → un groupe | personne (Miro : le stylo seulement) [M10] | à inventer (§ 3.3) |
| un clic : même hauteur, même largeur | PureRef [P1] ; Miro pour les images seulement [M17] | Normalize Height / Width |
| redimensionner le groupe | Miro, tldraw, Figma : mise à l'échelle [M40][T3] | — |
| la poignée qui réorganise | Miro **Auto layout** [M1][M3] ; Figma **Auto layout + Wrap** (reflow à chaque changement) [F6] | § 3.5 |
| grouper par zone de sélection, dégrouper | tous (Ctrl+G / Ctrl+Maj+G) [M9][T1] | — |
| un cadre autour de la sélection, la barre centrée au-dessus | Miro [M30] ; tldraw (code) [T10] ; ComfyUI [C4] | — |
| groupes qui se réduisent, zoom sémantique, comme les subnodes | ComfyUI subgraph (entrées/sorties à la frontière) [C2] ; Milanote (colonnes qui se replient) [P2] ; prototype de Cal | § 3.6, § 3.7 |
| cadres qui servent la présentation | Miro : ordre du panneau = ordre des diapositives [M27] | § 3.8 |

## 3. Spécification pour notre canvas

Principe : **deux conteneurs seulement, et chacun sa règle.** Le **cadre**
est une zone du plan (géométrique, comme aujourd'hui : ce qui est entièrement
dedans lui appartient), qui sert la présentation et l'export. Le **groupe**
est une appartenance (écrite sur l'enfant), qui sert la mise en forme et le
repli. Pas de troisième notion.

### 3.1 Le modèle

**Tranché : un champ `group` sur chaque enfant, et un nœud `type: 'group'`
qui porte le nom et la mise en forme ; pas de liste `children`.**

```json
{ "id": "g1", "type": "group", "name": "Casting", "x": 0, "y": 0, "w": 900, "h": 420,
  "collapsed": false, "lod": false,
  "layout": { "mode": "free", "width": 900, "gap": 24, "fit": "" } }
{ "id": "n7", "type": "media", "item": "ima-…", "kind": "image", "x": 24, "y": 24, "w": 280, "h": 373, "group": "g1" }
{ "id": "l3", "a": "n7", "b": "n9", "kind": "wire", "pa": "image", "pb": "ref" }
```

Pourquoi l'enfant, et pas une liste sur le groupe :

1. **Une seule vérité, juste par construction** : un objet ne peut pas être
   dans deux groupes ; supprimer, dupliquer, coller, annuler n'ont pas de
   liste à tenir à jour (`cloneInto` remappe `group` comme il remappe déjà les
   deux bouts d'un lien). Une liste `children` serait une seconde vérité qui
   peut contredire la première.
2. **Tout le monde fait ainsi** : `groupId` chez Miro, `parentId` chez tldraw,
   `groupIds` / `frameId` chez Excalidraw (§ 1.9).
3. **Rien ne change pour le reste du code** : l'enfant reste un objet de
   `nodes`, en coordonnées du monde (absolues). L'export PIL, les liens
   (`edgePts`), la sélection, le culling de l'étude de fluidité l'ignorent.
   Déplacer un groupe déplace ses enfants, comme un cadre les emmène déjà
   (`carried()`).
4. **L'ordre dans le groupe est l'ordre d'empilement** (`nodes`) entre frères,
   comme l'index par parent de tldraw [T7] : pas de second ordre à garder.
   Réordonner dans une disposition rangée change cet ordre.

Règles (validées par `server/tools/ideation.py`, `normalize`) :

- `group` pointe vers un nœud `type: 'group'` présent, sinon il tombe ;
- **pas de groupes imbriqués** (un groupe n'a pas de `group`), comme Miro
  [M15] : la hiérarchie s'arrête à deux étages, cadre (zone) puis groupe
  (appartenance). Grouper une sélection qui contient un groupe y ajoute les
  autres objets s'il n'y en a qu'un ; s'il y en a plusieurs, le bouton est
  éteint et dit « un groupe ne se met pas dans un groupe : dégroupez d'abord »
  (règle 7) ;
- un cadre n'entre jamais dans un groupe (c'est un fond) ;
- un groupe sans enfant disparaît ; un groupe réduit à un enfant se dissout
  (tldraw [T1]) ;
- `x, y, w, h` d'un groupe déplié = la boîte de ses enfants + 24 px, recalculée
  par la page après chaque geste (comme la hauteur des notes, `AUTO_H`) ;
  replié, `w, h` sont ceux de sa carte, `x, y` le coin de la boîte au moment
  du repli ;
- `layout.mode` : `free` (les enfants restent où ils sont) ou `flow` (rangés
  à la suite, à la ligne quand `layout.width` est atteinte) ; `gap` en px du
  monde ; `fit` : `''`, `'h'` (même hauteur) ou `'w'` (même largeur) ;
- liens : `kind` `arrow` (annotation), `line`, `out` (existent) et `wire` (un
  fil de données entre deux ports nommés `pa`, `pb`).

### 3.2 Le groupe à l'usage

- **Un clic sur un enfant choisit le groupe** ; un **double-clic** choisit
  l'enfant dans le groupe (Miro [M6], Excalidraw [E2]) ; **Échap** remonte au
  groupe, puis à rien.
- **Ctrl+G** groupe la sélection (au rectangle, au lasso, Maj + clic) ; le
  groupe garde les places (`free`). **Ctrl+Maj+G** dégroupe : les enfants
  restent où ils sont, choisis.
- Le groupe n'a pas de dessin à lui (tldraw [T3]) : un filet pointillé et son
  nom n'apparaissent qu'au survol et quand il est choisi ; seul le cadre a un
  fond.
- Glisser un enfant choisi (après double-clic) : en `flow`, il **change de
  rang** (la place d'insertion suit le pointeur, comme la Smart selection de
  Figma [F1]) ; lâché à plus de 32 px hors de la boîte du groupe, il en
  **sort** (tldraw `onDragShapesOut` [T4]) — le filet du groupe l'annonce en
  gris avant qu'on lâche.

### 3.3 Lâcher un objet sur un autre : un groupe

Ce que Cal demande, et qu'aucun outil ne fait (§ 1.3). Pour que ce ne soit
jamais un accident :

- pendant qu'on glisse un objet (ou une sélection), **l'objet sous le
  pointeur** — pas celui qu'on frôle — s'entoure d'un filet orange avec une
  étiquette `GROUPER` (le carré de Miro pour le stylo [M10]) ;
- **lâcher** : un groupe naît (la cible + ce qu'on glissait), en `flow`, les
  objets posés à droite de la cible, alignés en haut ; il est choisi, la
  barre montre aussitôt la mise en forme (§ 3.9) ;
- cible déjà dans un groupe : on **rejoint** ce groupe, juste après elle ;
- cible = un **cadre** : pas de groupe, l'objet est simplement dans le cadre
  (comme aujourd'hui, et comme partout [M13][T4]) ;
- cible = une **carte Générer** et objet = image ou élément : pas de groupe,
  un lien de **référence** (le sens que la planche donne déjà aux liens vers
  une carte Générer, `docs/etudes/ideation.md` § 2) ;
- **Alt** en lâchant : poser par-dessus sans grouper ; **Ctrl+Z** défait le
  groupe d'un coup.

### 3.4 La mise en forme

Sur une sélection de plusieurs objets, **une fois** ; sur un groupe, **elle
reste** (le groupe la réapplique quand un objet entre, sort ou change de
taille — « ils se remettent en forme dedans »).

| action | effet | d'où |
|---|---|---|
| Aligner ▾ | gauche, centre, droite, haut, milieu, bas (existe : `app.align`) | Miro [M35], tldraw [T2] |
| Distribuer ▾ | écarts égaux, horizontal ou vertical, trois objets au moins (existe : `app.distribute`) | tldraw [T8] |
| **Même hauteur** | chaque objet prend la hauteur du **premier choisi** ; une image garde ses proportions (sa largeur suit) ; une note, un post-it, une carte : leur largeur ne bouge pas | PureRef « Normalize Height », « From first » [P1] |
| **Même largeur** | idem en largeur ; la hauteur d'une image suit | PureRef « Normalize Width » [P1] |
| Ranger | en rangées, dans l'ordre de lecture (existe : `app.tidy`) ; sur un groupe : passe en `flow` | Miro Auto layout [M3], Figma Tidy up [F2] |
| Espacement − / + | `gap` par pas de 8 px (groupe) | Miro Auto layout [M1] |

### 3.5 Les deux poignées d'un groupe

Le cadre de sélection d'un groupe porte deux sortes de poignées, qui ne se
confondent pas :

- **les quatre coins : l'échelle.** Tirer met le groupe à l'échelle : places
  et tailles des enfants (depuis le coin opposé) ; les images gardent leurs
  proportions ; le texte garde sa taille de police, sa boîte s'élargit. C'est
  la poignée de redimensionnement de Miro [M40].
- **la poignée d'organisation**, au milieu du bord droit (une pastille à trois
  points, `cursor: ew-resize`) : tirer change `layout.width` et **refait le
  flux** à chaque image — plus étroit, les objets passent à la ligne ; plus
  large, ils remontent. Pendant le geste, un repère dit `3 COLONNES` quand les
  objets ont même largeur. C'est l'Auto layout de Miro [M1][F9] fait comme le
  Wrap de Figma [F6] : persistant, pas un rangement d'une fois. Sur un groupe
  `free`, la première traction le passe en `flow`.
- sur une **sélection** (pas un groupe) : les coins mettent à l'échelle ; la
  poignée d'organisation range une fois (Ranger), puis propose « Grouper » —
  sans groupe, rien ne retient la mise en forme.

### 3.6 Réduire un groupe : la carte et ses ports

Réduire (bouton de la barre, ou de loin si le groupe le demande, § 3.7)
remplace les enfants par **une carte** de 280 px de large, comme le nœud
replié d'un subgraph de ComfyUI [C2] :

- en tête le nom (Venus Rising), `12 OBJETS · 2 GÉNÉRATIONS` (mono) ; une
  mosaïque des quatre premières images (la plus petite copie, 256 px) ;
- **les ports** : chaque fil `wire` qui traverse la frontière devient un
  port — `a` dedans et `b` dehors : une **sortie** sur le bord droit ; `a`
  dehors et `b` dedans : une **entrée** sur le bord gauche. Un port par couple
  distinct (objet intérieur, `pa` ou `pb`) : deux fils qui partent du même
  port intérieur n'en font qu'un. Étiquette : `nom de l'objet · pa`. Les ports
  sont rangés dans l'ordre vertical des objets intérieurs (les fils se croisent
  moins). Tirer un fil depuis un port de la carte le relie à l'objet intérieur
  (le lien reste `a → b` entre objets : la carte n'est qu'un affichage, rien
  n'est réécrit) ;
- les flèches d'annotation (`arrow`, `line`, `out`) qui traversent la
  frontière se dessinent jusqu'au bord de la carte, sans port ; les liens
  intérieurs se cachent ;
- les enfants ne sont ni rendus ni peints (une carte au lieu de N objets : le
  gain de l'étude de fluidité) ; ils gardent leurs places : déplacer la carte
  les emmène, déplier les remet autour de son coin ;
- **double-clic** sur la carte : déplier en place. On n'entre pas dans une
  autre vue (le fil d'Ariane de ComfyUI) : un seul niveau de groupe, pas de
  navigation à tenir ;
- l'export PNG montre le contenu déplié (l'export sert à montrer les images).

### 3.7 Le zoom sémantique

Trois niveaux, posés sur le zoom « efficace » (celui d'après le geste, 150 ms
— `ideation_fluidite.md`, § 2 et § 4.2 : changer le style de toute la planche
à chaque image du zoom coûte 20 ms par image à 1000 objets) :

| niveau | zoom | ce qui change |
|---|---|---|
| **Ensemble** | z < 0,42 (le seuil actuel de `.cv.far` : un texte de 13 px y fait moins de 5,5 px à l'écran) | le nom de chaque cadre en grand, centré dans le cadre, sur un voile (prototype de Cal) ; notes et post-it : leur couleur seule, sans texte ; cartes Générer : leur résumé (existe) ; légendes, travaux, étiquettes des liens cachés ; un groupe marqué « se réduit de loin » (`lod: true`) s'affiche en carte (§ 3.6) quand sa boîte fait moins de 240 px à l'écran |
| **Travail** | 0,42 à 1,3 | tout comme aujourd'hui |
| **Détail** | z > 1,3 (le seuil du prototype de Cal) | les légendes restent sous les images sans survol (titre, taille, modèle) ; la carte Générer montre son prompt entier ; l'élément toutes ses références ; les images vont jusqu'à l'original quand elles sont vues à leur taille (étude de fluidité) |

Les images ne suivent pas ces niveaux : leur définition suit la taille à
l'écran (`max(w, h) × z × densité de pixels`, étude de fluidité). `lod` est
éteint par défaut : un groupe d'images reste une planche d'images de loin ;
on l'allume pour un groupe de fabrication (une carte Générer et ses
références).

### 3.8 Les cadres pour présenter

- Le cadre reste une zone (ce qui est entièrement dedans lui appartient, et
  vient avec lui) ; il gagne un champ `order` (entier) : l'ordre de
  présentation. Par défaut, l'ordre de lecture de leurs coins (de haut en bas,
  de gauche à droite : « Organize frames » de Miro [M27]).
- Le panneau « Plan » de l'inspecteur liste les cadres dans cet ordre ; on le
  change en glissant (Miro [M27]).
- **Présenter** (bouton de la barre, pas orange) : la vue plein écran va de
  cadre en cadre, ajustée (`fit(cadre)`), sans la chrome ; ← / → / espace,
  Échap pour sortir ; « présenter depuis ici » sur un cadre choisi.
- Export : le PNG d'un cadre existe (`ideation.export`) ; un PDF d'une page
  par cadre dans cet ordre viendra ensuite (Miro [M50]).

### 3.9 Le cadre de sélection et sa barre

Dès que **deux objets** ou **un groupe** sont choisis, un cadre (filet orange
de 1 px, en pixels d'écran, dans le calque `overlay` au-dessus de la planche)
entoure la boîte de la sélection, avec ses poignées (§ 3.5) ; la **barre** se
pose **centrée au-dessus**, à 10 px (x = milieu − largeur / 2, comme tldraw
[T10]), à taille d'écran constante, ramenée dans la planche ; s'il n'y a pas
la place au-dessus, elle passe **en dessous**. Elle **disparaît pendant qu'on
glisse, redimensionne, se déplace ou zoome** et revient 150 ms après (tldraw
[T10]). Ses boutons, en capitales mono, sans `.tb.go` (l'orange reste à
Générer, règle 4) :

| sélection | la barre |
|---|---|
| plusieurs objets | Grouper · Aligner ▾ · Distribuer ▾ · Même hauteur · Même largeur · Ranger · Encadrer · Carte Générer (s'il y a des images) · … |
| un groupe | Dégrouper · Réduire · Libre / Rangée · Même hauteur · Même largeur · Espacement − / + · Se réduit de loin · … |
| un groupe réduit | Déplier · Dégrouper · … |
| un cadre | Renommer · Présenter d'ici · Exporter en PNG · … |
| une image | Variations · Éditer · Nuancier · Carte Générer · … |

« … » ouvre le menu qui existe (dupliquer, premier plan, arrière-plan,
supprimer). Un seul objet autre qu'une image : pas de barre, l'inspecteur
suffit. L'inspecteur de droite garde le détail (réglages d'une carte, liens,
plan) : la barre ne porte que les gestes fréquents.

### 3.10 Gestes et raccourcis

| geste | effet | d'où |
|---|---|---|
| clic · Maj + clic | choisir · ajouter, retirer (existe) | tous |
| glisser le fond · Alt + glisser | rectangle (par intersection) · lasso (existe) | Miro [M20] |
| double-clic sur un enfant · Échap | choisir dans le groupe · remonter | Miro [M6] |
| **Ctrl+G · Ctrl+Maj+G** | grouper · dégrouper | Miro [M9], tldraw [T2] |
| **Ctrl+Alt+G** | encadrer la sélection (existe au menu : « Encadrer ») | tldraw [T2] |
| glisser sur un objet, lâcher | grouper (§ 3.3) ; **Alt** : sans grouper | — |
| **Alt+A / D / W / S · Alt+H / V** | aligner à gauche / droite / en haut / en bas · centres | Figma [F5], tldraw [T2] |
| **Alt+Maj+H / V** | distribuer | tldraw [T2] |
| **Ctrl+Alt+T** | ranger (existe au menu : `app.tidy`) | Figma Tidy up [F2] |
| coins du cadre · poignée d'organisation | échelle · reflow (§ 3.5) | Miro [M40][M1] |
| double-clic sur une carte de groupe | déplier | — |

Les raccourcis existants (V, H, L, N, S, T, F, G sans modificateur ; `[` `]` ;
flèches) ne bougent pas. « Même hauteur / largeur » n'ont pas de raccourci :
ceux de PureRef (Ctrl+Alt+flèches) font pivoter l'écran sur certains pilotes
graphiques de Windows (non vérifié sur la machine de Cal : à essayer avant de
les prendre).

### 3.11 Ce qu'on ne fait pas

- **Pas de groupes imbriqués**, pas de cadres dans des groupes, pas de
  navigation dans un groupe (fil d'Ariane) : deux étages, cadre puis groupe.
- **Pas de groupe par simple recouvrement** : seul le lâcher sur un objet,
  annoncé, groupe (§ 3.3).
- Pas de rotation, pas de verrouillage, pas de moteur de mise en page général
  (ni « hug / fill », ni contraintes, ni alignement dans la cellule) : `free`
  ou `flow`, avec `gap` et `fit`.
- Pas de « Grid mode » de cadre (Miro l'a abandonné [M43]) : un cadre reste une
  zone libre.
- Pas de ports sur les flèches d'annotation ; seuls les fils `wire` en ont.
- Pas de collaboration en temps réel, pas de présence (un seul utilisateur).

### 3.12 Dans quel ordre

1. `group` + nœud `group` (validation serveur, `cloneInto`, `carried()`,
   annuler) ; Ctrl+G / Ctrl+Maj+G ; clic / double-clic / Échap.
2. Le cadre de sélection et sa barre (§ 3.9) ; même hauteur, même largeur,
   aligner, distribuer (déjà dans l'inspecteur) déplacés dans la barre.
3. `flow`, la poignée d'organisation, le lâcher sur un objet (§ 3.3, 3.5).
4. Le repli et ses ports (§ 3.6), quand les fils `wire` existeront.
5. Les niveaux Ensemble / Détail (§ 3.7), les cadres ordonnés et Présenter
   (§ 3.8).

Chaque étape passe par `tools/check.py` (le `selftest` d'`ideation.py` gagne
les règles du § 3.1) et une capture sur DGX2 avant d'aller plus loin.

## Sources

Miro — (moteur) : extrait lu dans le moteur de recherche, la page refuse les robots.

- [M1] Miro Community, « Auto layout and other UX improvements » (29/06/2020), https://community.miro.com/product-news-31/auto-layout-and-other-ux-improvements-1225
- [M3] Facilitator School, « Miro sticky notes tricks » (mise à jour 07/06/2024), https://www.facilitator.school/blog/miro-sticky-notes-tricks
- [M4] https://community.miro.com/ask-the-community-45/how-do-i-switch-off-auto-layout-4316
- [M5] https://community.miro.com/ideas/auto-layout-should-give-control-to-space-out-content-vertically-as-well-as-horizontally-15571
- [M6] https://community.miro.com/inspiration-and-connection-67/trick-double-clicking-an-object-that-is-part-of-a-group-let-s-you-move-that-single-object-3934
- [M7] Miro Help, « Structuring board content » (moteur), https://help.miro.com/hc/en-us/articles/360017730973-Structuring-board-content
- [M8] https://community.miro.com/ideas/shortcut-key-for-alignment-and-distribution-9487
- [M9] Miro, raccourcis, https://miro.com/shortcuts/
- [M10] https://community.miro.com/ask-the-community-45/objects-are-automatically-grouping-when-placed-together-and-cannot-be-ungrouped-15389
- [M11] https://community.miro.com/ask-the-community-45/grouping-stickers-emojis-and-sticky-notes-12545
- [M13] Miro Developers, « Children inside parent items », https://developers.miro.com/docs/children-inside-parent-items
- [M14] Miro Developers, « Frame », https://developers.miro.com/docs/websdk-reference-frame
- [M15] Miro Developers, « Group », https://developers.miro.com/docs/websdk-reference-group
- [M16] https://community.miro.com/ideas/ungrouping-a-big-group-preserves-the-smaller-nested-groups-there-were-within-it-2410
- [M17] Miro Community, « Crop and resize images in bulk » (17/04/2023), https://community.miro.com/product-news-31/crop-and-resize-images-in-bulk-13237
- [M18] Miro Help, « Images and Icons » (moteur), https://help.miro.com/hc/en-us/articles/16631693545490-Images-and-Icons
- [M19] https://community.miro.com/ask-the-community-45/need-help-match-images-by-height-or-width-17869
- [M20] https://community.miro.com/ideas/allow-the-drag-selection-tool-to-either-select-intersect-or-select-contained-6867
- [M21] https://community.miro.com/ideas/resize-multiple-shapes-to-the-same-size-10711
- [M22] https://community.miro.com/ideas/match-size-paste-size-mechanism-would-be-useful-727
- [M24] https://community.miro.com/product-news-31/introducing-the-new-hide-and-reveal-setting-for-frames-2005
- [M25] https://community.miro.com/ask-the-community-45/frames-within-frames-container-frame-doesn-t-move-nested-children-frames-20785
- [M26] https://community.miro.com/ideas/nested-frames-3902
- [M27] Miro Help, « Frames » et « Presentation mode » (moteur), https://help.miro.com/hc/en-us/articles/360018261813-Frames , https://help.miro.com/hc/en-us/articles/34307373858450-Presentation-mode
- [M28] Miro Help, « Working with objects » (moteur), https://help.miro.com/hc/en-us/articles/360017730953-Working-with-objects
- [M29] https://community.miro.com/ideas/multiple-object-filtering-10984 (moteur)
- [M30] Miro Help, « Clustering » (moteur), https://help.miro.com/hc/en-us/articles/4409706795410-Clustering
- [M32] https://community.miro.com/ideas/want-to-be-able-to-move-pin-or-hide-the-floating-editing-toolbar-15695
- [M34] Miro Help, « Sticky notes » (moteur), https://help.miro.com/hc/en-us/articles/360017572054-Sticky-notes
- [M35] https://supademo.com/tutorials/miro/how-to-align-objects-in-miro
- [M36] https://community.miro.com/ask-the-community-45/issue-with-ellipsis-more-context-menu-not-opening-25342 (moteur)
- [M39] https://community.miro.com/ideas/make-auto-layout-be-able-to-retain-the-sequence-of-stickies-9298
- [M40] https://community.miro.com/ask-the-community-45/text-scaling-when-resizing-multiple-shapes-10081
- [M41] Miro Help, « Grid » (moteur), https://help.miro.com/hc/en-us/articles/360011986519-Grid
- [M43] https://community.miro.com/ask-the-community-45/missing-grid-freeform-buttons-from-frame-toolbar-no-more-send-to-front-back-6515
- [M49] https://community.miro.com/ideas/frames-in-standard-paper-sizes-for-print-pdf-export-3143 (moteur)
- [M50] Miro Help, « How to print your board » (moteur), https://help.miro.com/hc/en-us/articles/4408887050386-How-to-print-your-board
- [M51] https://community.miro.com/ideas/hide-and-reveal-elements-at-different-zoom-levels-6064
- [M52] https://community.miro.com/ideas/make-frame-titles-smaller-when-zoomed-out-986
- [M53] Miro Help, « Board performance and loading issues » (moteur), https://help.miro.com/hc/en-us/articles/360013588560-Board-performance-and-loading-issues

Figma, FigJam

- [F1] « Arrange layers with Smart selection », https://help.figma.com/hc/en-us/articles/360040450233-Arrange-layers-with-Smart-selection
- [F2] Figma Blog, « Introducing Smart Selection » (11/10/2018), https://www.figma.com/blog/introducing-smart-selection/
- [F5] « Adjust alignment, rotation, position, and dimensions », https://help.figma.com/hc/en-us/articles/360039956914-Adjust-alignment-rotation-position-and-dimensions
- [F6] « Guide to auto layout », https://help.figma.com/hc/en-us/articles/360040451373-Guide-to-auto-layout
- [F7] « Select, move, and order objects in FigJam », https://help.figma.com/hc/en-us/articles/1500004292221-Select-move-and-order-objects-in-FigJam
- [F8] « Organize your FigJam board with sections », https://help.figma.com/hc/en-us/articles/4939765379351-Organize-your-FigJam-board-with-sections
- [F9] Figma Forum, « Dynamic drag-to-reflow handle » (09/01/2026), https://forum.figma.com/suggest-a-feature-11/feature-request-dynamic-drag-to-reflow-handle-porting-auto-layout-wrap-to-canvas-49475
- [F10] https://forum.figma.com/t/collapsable-sections/19624 (moteur)

tldraw

- [T1] « Groups », https://tldraw.dev/sdk-features/groups
- [T2] `actions.tsx` (raccourcis), https://raw.githubusercontent.com/tldraw/tldraw/main/packages/tldraw/src/lib/ui/context/actions.tsx
- [T3] « Default shapes », https://tldraw.dev/sdk-features/default-shapes
- [T4] `FrameShapeUtil`, https://tldraw.dev/reference/tldraw/FrameShapeUtil
- [T6] « Shapes », https://tldraw.dev/sdk-features/shapes
- [T7] « Shape indexing », https://tldraw.dev/sdk-features/shape-indexing
- [T8] « Shape transforms », https://tldraw.dev/sdk-features/shape-transforms
- [T9] Exemple « Contextual toolbar », https://tldraw.dev/examples/contextual-toolbar
- [T10] `TldrawUiContextualToolbar.tsx`, https://raw.githubusercontent.com/tldraw/tldraw/main/packages/tldraw/src/lib/ui/components/primitives/TldrawUiContextualToolbar.tsx
- [T11] « Performance », https://tldraw.dev/sdk-features/performance

Excalidraw

- [E1] `types.ts`, https://raw.githubusercontent.com/excalidraw/excalidraw/master/packages/element/src/types.ts
- [E2] https://x.com/excalidraw/status/1265376722750504965 (moteur)
- [E3] `frame.ts`, https://raw.githubusercontent.com/excalidraw/excalidraw/master/packages/element/src/frame.ts

ComfyUI

- [C1] « Subgraph official release » (07/08/2025), https://blog.comfy.org/p/subgraph-official-release
- [C2] « Subgraph », https://docs.comfy.org/interface/features/subgraph
- [C3] RFC Subgraphs, https://github.com/Comfy-Org/rfcs/discussions/17
- [C4] « ComfyUI frontend 1.10 », https://blog.comfy.org/p/comfyui-frontend-110-update-powerful
- [C6] `LGraphGroup.ts`, https://raw.githubusercontent.com/Comfy-Org/ComfyUI_frontend/main/src/lib/litegraph/src/LGraphGroup.ts
- [C7] https://comfyui.nomadoor.net/en/begin-with/group/

Autres

- [P1] PureRef Handbook, « Organize », https://www.pureref.com/handbook/images/organize/
- [P2] Milanote Help, « Columns », https://help.milanote.com/en/articles/10478526-columns
- Prototype de Cal : `~/showrunner-refs/atelier-canvas/atelier-canvas.html` (DGX2), `renderVals()` : `far = z < .3`, `near = z > 1.3`, `inView` à 200 px de marge.
