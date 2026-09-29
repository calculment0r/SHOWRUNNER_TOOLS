# Étude — l'atelier du canvas d'idéation (29/09/2026)

Demande de Cal (29/09) : « dans mon zip avec ma DA, on avait des fonctions
aussi qu'on ne retrouve pas ici… visio conférence et mode présentation etc
etc… le canva que j'avais bien avancé arrive avec un brief, on a des trucs
pas mal en DA, UX etc dans les deux versions […] on doit en tout cas garder
notre thème général de graphisme. il faut les fonctions que j'ai expliquées
avant et aussi celles du canva que je te donne en zip. »

La référence : le prototype de Cal, `~/showrunner-refs/atelier-canvas/` sur
DGX2 (`atelier-canvas.html`, `README.md` « Handoff : Atelier Canvas —
collaboration temps réel », `support.js`, la fonte). Lu dans son code (le
composant `Component` : `onKey`, `presGo`, `palList`, `cluster`, `toMind`,
`insertTemplate`, `layout`, `moveDrag`, `renderVals`, et `steps()`, son guide
intégré de 17 étapes), servi sur DGX2 et capturé
(`/tmp/sr_ide_atelier_shots/proto-*.png`).

Le brief du README ne porte que la couche collaborative (présence, fil,
visio) : elle revient à l'agent de la collaboration (`ideation/collab.*`).
Cette étude porte le reste : les fonctions d'atelier du tableau.

## 1. L'inventaire : ce qu'il a, ce qu'on a, qui le fait

Dans l'ordre du guide du prototype, puis ce que son code a en plus.
« Atelier » = fait ici, en modules greffés (`ideation/atelier/`) ; « canvas »
= touche le cœur du canvas, décrit au § 3 pour l'agent qui le refond.

| fonction | le prototype | l'Idéation | qui |
|---|---|---|---|
| Naviguer | molette : zoom au curseur ; pavé : deux doigts déplacent, pincer zoome ; clic milieu, clic droit ou Espace + glisser ; mini-carte cliquable ; `0` ajuster, `+` `−` | molette et pincer : zoom ; Espace, bouton du milieu ou H : se déplacer ; mini-carte cliquable et glissable ; Maj+1 tout voir, Maj+0 100 %, `+` `−`, trame | existe (canvas). Deux doigts qui *déplacent* (la molette du pavé zoome toujours ici) : canvas |
| Zoom sémantique | trois niveaux : sous 30 % « vue d'ensemble », au-delà de 130 % « détail » ; le niveau est affiché dans l'en-tête (« TRAVAIL 73 % ») | un seuil : `.cv.far` sous 42 % (carte Générer résumée, légendes cachées) | canvas (§ 3.8) |
| Outils de création | V H N(note) T(texte) S(forme) C(carte) I(image) F(cadre) M(mind map) L(connecteur) P(crayon) ; double-clic sur le vide : un post-it | V H L N(note) S(post-it) T(titre) F(cadre) G(Générer) ; double-clic sur le vide : le menu « poser ici » | formes, cartes, mind map, crayon : canvas (§ 3.1-3.3, 3.9) |
| Poignées et connecteurs | quatre poignées ; lâcher dans le vide : « Créer et relier » ; connecteurs courbes ou coudés, pointillés, étiquette, inverser | une poignée (à droite) ; lâcher dans le vide : note, post-it, carte Générer, titre ; liens droits de bord à bord (flèche, trait, « produit »), étiquette | canvas (§ 3.5) |
| Mind map | Tab : un enfant, Entrée : un frère ; placement automatique, couleur par rameau, repli | — | canvas (§ 3.3) |
| Guides magnétiques | bords et centres aimantés, ligne de repère, Alt = libre, bouton « Aimant / Libre » | — | canvas (§ 3.4) |
| Vues ancrées | Maj+1…4 enregistre, 1…4 y revient en vol ; pastilles en bas à gauche | **fait** : **Alt+1…4** enregistre (Maj+1 est déjà « tout voir », `ideation.js`), 1…4 y revient en vol ; pastilles « vues » | atelier (`vues.js`) |
| Palette ⌘K | objets et commandes ; un objet : la caméra y vole, il est choisi | **fait** : ctrl+K / ⌘K, recherche sans accents dans le texte, le nom, le prompt, le titre d'un objet de la bibliothèque ; 27 commandes | atelier (`commandes.js`) |
| Présentation par cadres | les cadres en diapositives, ordre de lecture, vol, interface masquée, ← → Échap | **fait**, avec l'ordre des diapositives (réordonner, masquer), le plein écran, ce qui sort de la diapositive s'éteint, départ du cadre choisi | atelier (`presentation.js`) |
| Vote par points | clic +1, Alt+clic −1, classement en direct, voler vers un objet ; pastilles | **fait** (les voix gardées par planche) | atelier (`vote.js`) |
| Minuteur d'atelier | 3, 5, 10 min dans l'en-tête ; dernière minute en corail ; prévient à la fin | **fait** (local ; un minuteur partagé attend la collaboration) | atelier (`minuteur.js`) |
| Projecteur | assombrit tout sauf la sélection | **fait** ; un cadre choisi éclaire aussi son contenu | atelier (`projecteur.js`) |
| Regrouper par couleur | les post-it en colonnes par couleur, un cadre titré par colonne | — | canvas (§ 3.6) — ou un module, une fois les noms des couleurs choisis |
| Convertir en mind map | notes, formes, cartes → « Synthèse » et une branche par objet | — | canvas (§ 3.3), après la mind map |
| Machine temporelle | chaque état gardé, un curseur qui rejoue, « Restaurer cet état » sans perdre la suite | **fait** ; restaurer s'annule par ctrl+Z ; annuler/rétablir (150 pas) existait | atelier (`machine.js`) |
| Modèles | kanban, rétrospective, parcours, mind map, SWOT, au centre de la vue | — | à décider par Cal (§ 3.7) |
| Images | glisser du bureau, coller ⌘V (l'image est écrite dans la page) | glisser du disque, coller, bibliothèque, personnages de Character Factory — tout entre dans la bibliothèque (Upload) | existe, en mieux |
| Texte (hors guide) | un texte en Venus Rising | le titre (T, trois tailles) | existe |
| Crayon (hors guide) | P : un trait à main levée | — | canvas (§ 3.9) |
| Barre de sélection (hors guide) | au-dessus de la sélection : couleurs, actions du type | l'inspecteur à droite, le clic droit | existe autrement ; pas reprise |
| Guide intégré (hors guide) | 17 étapes, un anneau sur la cible, « Essayer » | « ? » : les raccourcis | greffable plus tard (il ne pointe que des éléments du DOM) ; non demandé |
| Bascule clair / sombre | un bouton | — | écartée : règle 2 du thème, « sombre, sans bascule » |
| Présence, fil, visio (le brief du README) | décrits, rien d'écrit | — | agent de la collaboration (`ideation/collab.*`), qui écoute déjà `atelier:present` |

## 2. Ce qui est fait : les modules d'atelier

Greffés par `ideation/plugins.js` (une ligne chacun dans `PLUGINS`), sans
toucher au canvas : `ideation/atelier/`.

| fichier | ce qu'il fait |
|---|---|
| `socle.js` | ce que les modules partagent : la feuille `atelier.css` ; la caméra (`fly`, `viewFor`, `toView`, `current`) ; le groupe « atelier » de la barre (inséré avant le bouton de la bibliothèque) et, sous 1480 px, le bouton « atelier » qui ouvre les autres en menu ; le coin haut droit de la planche ; les panneaux qui gardent leurs gestes ; le calque qui fige la planche ; **un seul clavier**, en capture sur `window` avant celui de la planche (priorités : palette 10, présentation 20, machine 30, vues 40, Échap du vote et du projecteur 50) ; les commandes de la palette ; les feuilles vivantes (éclairer par `data-id`, ce qui survit aux objets que le canvas refait) |
| `presentation.js` | les cadres en diapositives ; `ordre de lecture` : par rangées (un cadre dont le haut passe sous le milieu du premier de la rangée en ouvre une autre), de gauche à droite ; l'interface disparaît (en-tête du portail, barre, bibliothèque, inspecteur, coins de la planche), la caméra vole (640 ms, 720 au départ ; elle prend de la hauteur entre deux diapositives éloignées), ce qui n'est pas dans le cadre s'éteint (7 %) ; la barre du bas (‹ 01 / 03 NOM › · Diapositives · Plein écran · Échap) s'efface quand la souris dort ; au retour, la vue d'avant. Clic droit sur le bouton : depuis le début, depuis le cadre choisi, **l'ordre des diapositives** (glisser ou ↑ ↓, masquer, « ordre de lecture ») |
| `vote.js` | le mode vote : un clic sur un objet (ou l'en-tête d'un cadre) une voix, Alt+clic en retire une ; rien ne se choisit ni ne bouge ; le panneau (haut droite) classe les huit premiers, un clic y vole ; les pastilles sont posées *dans* l'objet (elles le suivent quand on le déplace ; un objet refait par le canvas les retrouve, `MutationObserver` sur les couches) |
| `projecteur.js` | tout s'assombrit (12 %, cadres 35 %) sauf la sélection, le contenu d'un cadre choisi et les liens entre deux objets éclairés ; suit la sélection ; Échap l'éteint |
| `minuteur.js` | 3, 5, 10 min (menu du bouton ou palette) ; le décompte en haut à droite, visible aussi en présentation ; la dernière minute en orange d'alerte ; à la fin : « temps écoulé », 00:00 qui clignote 9 s ; pause, reprise, arrêt ; survit à un rechargement |
| `machine.js` | l'histoire de la planche : un état par geste (`commit`), plus ceux qui n'y passent pas (écrire dans une note, les flèches, un travail qui pose ses images : `app.touch`, une seconde après le dernier) ; le curseur rejoue (← → , Maj : 10, Début, Fin) ; « Restaurer cet état » : l'état revient par `app.mutate` (donc ctrl+Z l'annule), il devient le plus récent, la suite reste |
| `commandes.js` | la palette ctrl+K / ⌘K : objets (le cadre d'abord quand rien n'est tapé), puis commandes ; une commande indisponible dit pourquoi ; celles de la planche (tout voir, 100 %, encadrer, ranger, annuler, rétablir, planches, exporter, bibliothèque, raccourcis) ne sont inscrites que si l'app les a |
| `vues.js` | quatre vues : le point du monde au centre et le zoom (une vue reste juste si la planche change de taille) ; touches physiques (`e.code`) : sur un clavier AZERTY, 1…4 sans Maj, et le pavé numérique |
| `atelier.css` | tout le reste de l'habit |

**Le thème.** Jetons seulement, filets (`inset`), capitales mono pour la
machine, Venus Rising pour les titres et les nombres. Deux écarts voulus
avec le prototype, qui met du corail partout : les valeurs lues (voix,
numéros de diapositive, d'état) sont en acier `--cy` ; l'orange reste à
l'action (« Restaurer cet état », « Présenter » : un seul `.tb.go` à
l'écran) et à l'alerte (la dernière minute).

**Le clavier.**

| touche | effet |
|---|---|
| ctrl+K · ⌘K | la palette (↑ ↓ Entrée, Échap) |
| 1…4 · Alt+1…4 | aller à la vue · l'enregistrer ici (Maj+1 reste « tout voir ») |
| en présentation | → espace Page↓ Entrée : suivante ; ← Page↑ ⌫ : précédente ; Début, Fin ; F : plein écran ; Échap. Aucune autre touche n'atteint la planche |
| machine temporelle | ← → (Maj : 10), Page↑ Page↓, Début, Fin ; Échap : revenir au présent. Aucune autre touche n'atteint la planche |
| vote · projecteur | Échap les quitte |

Alt+chiffre : la liste des raccourcis de Chrome n'en a aucun (Ctrl+1…8 et
⌘+1…8 changent d'onglet, pas Alt) [1] ; essayé dans le Chromium sans
affichage de DGX2 seulement — un autre navigateur ou le bureau peuvent le
prendre, à essayer chez Cal.

**Ce qui est gardé, et où.** Dans ce navigateur : l'ordre des diapositives
(`ide-at-slides-<planche>`), les voix (`ide-at-votes-<planche>`), les vues
(`ide-at-views-<planche>`), le minuteur (`ide-at-timer`). En mémoire : la
machine temporelle (une planche rouverte recommence son histoire ; si des
gestes ont précédé le module, la pile d'annulation fournit les états
d'avant). Borne : 300 états, environ 6 millions de caractères neufs ; un
objet inchangé d'un état à l'autre garde la même chaîne JSON (rien n'est
recopié), les travaux en cours (`jobs`) n'en font pas partie.

**Le serveur ne garde d'un cadre que sa place, sa taille et son nom**
(`server/tools/ideation.py`, `_node` : tout autre champ tombe à
l'enregistrement). Pour que l'ordre des diapositives suive la planche
(d'un poste à l'autre, entre participants), il faudrait y garder un numéro :
`out["slide"] = int(n["slide"])` s'il est entier et positif, et que le
module le lise. Non fait : `server/**` n'était pas à moi.

**Les événements** émis sur le bus de `plugins.js` : `atelier:present`
(true, false) et `atelier:replay` (true, false). L'état est aussi lisible :
`app.atelier.presenting`, `app.atelier.replaying`, la classe
`body.at-presenting`. Pour les essais : `window.ideation.app.atelier`
(`presentation`, `vote`, `projecteur`, `minuteur`, `machine`, `palette`,
`vues`).

**Une collision réglée ici, à régler à la source.** `commun/menu.js` nomme
`.ic` la case de l'icône de ses entrées ; `ideation.css` habille tout `.ic`
en bouton de barre (34 × 30, filet vert) : dans l'Idéation, chaque entrée
d'un menu commun portait une case vide. `atelier.css` rend la case à
`menu.css` (`.sr-menu .mi .ic`) ; la bonne place est `ideation.css` (limiter
`.ic` à la barre et à l'inspecteur) ou `menu.js` (un nom moins commun).

## 3. Pour l'agent du canvas : ce qui touche au cœur

Relevé dans le code du prototype ; les couleurs en dur du prototype sont
données avec le jeton le plus proche (règle 1 : une teinte qui manque est
un jeton à ajouter, jamais un `#rrggbb` dans un composant). Chaque sorte
d'objet neuve demande aussi le serveur (`TYPES` et `_node` dans
`server/tools/ideation.py`, le rendu PNG de l'export) et l'inspecteur.
Raccourcis : S est le post-it ici et C le « commenter » de `collab.js` ;
libres aujourd'hui : R, K, M, P, I.

### 3.1 Formes (prototype : S)
Six contours dans une boîte 100 × 100 étirée (`preserveAspectRatio="none"`) :
rectangle `M0 0H100V100H0Z`, arrondi `M12 0H88Q100 0 100 12V88Q100 100 88 100H12Q0 100 0 88V12Q0 0 12 0Z`,
ellipse `M50 0A50 50 0 1 1 49.99 0Z`, décision (losange) `M50 0L100 50L50 100L0 50Z`,
hexagone `M22 0H78L100 50L78 100H22L0 50Z`, données (parallélogramme) `M18 0H100L82 100H0Z`.
Trait 1,3 px qui ne grossit pas au zoom (`vector-effect: non-scaling-stroke`),
fond = la couleur du trait à 8 %, texte centré (14 px, graisse 500, marges
18 px). Taille par défaut 160 × 96. Couleurs : acier, orange, vert, sable,
encre (`--cy`, `--or`, `--grn2`, sable à créer, `--ink`). L'outil ouvre une
grille de six choix (3 colonnes de 64 px, icône + nom en mono 7,5 px) ; la
barre de sélection fait tourner le contour. Double-clic : écrire. Proposé : R.

### 3.2 Cartes tâche, lien, mesure, personne (prototype : C)
Une carte 300 × 150 : fond `--panel2`, filet, ombre, rayon 10 px ; en tête un
carré de couleur 8 px et la sorte en mono 8 px capitales, le titre en 15 px
graisse 500.
- **tâche** : une pastille d'état à droite (clic : À faire → En cours → Revue
  → Fait, fonds acier 10 %, orange 16 %, sable 16 %, vert sourd) ; une ligne
  avatar (initiales, 20 px, fond `--verd-5`), échéance en mono, barre de
  progression 3 px (orange), « 2/3 » ; en détail (zoom > 130 %) la liste
  des étapes, cases de 12 px à cocher d'un clic.
- **lien** : l'adresse en mono acier ; en détail, une description.
- **mesure** : la valeur en Venus Rising 26 px, l'unité en mono, l'écart en
  vert à droite ; en détail, une courbe (trait orange 1,2 px).
- **personne** : avatar 34 px (initiales en Venus Rising sur `--verd-4`), le
  rôle en mono capitales.
Pour Cal (films, personnages), la carte **personne** a un sens avec un
élément de la bibliothèque (le visage en avatar) ; tâche, lien et mesure
sont des outils d'atelier génériques : à lui de dire. Proposé : K.

### 3.3 Mind map et « Convertir en mind map » (prototype : M)
Des nœuds `mind` avec un `parent`, placés seuls : la racine (hauteur 48,
largeur = son texte en Venus Rising 13 px × 1,14 + 40, fond orange, encre
`--on-or`), le premier rang (36, fond `--panel`, filet 1,5 px de la couleur
du rameau), les suivants (28, un trait de 2 px dessous). Les enfants à
droite (84 px après la racine, 58 ensuite), empilés à 12 px, centrés sur la
hauteur de leur sous-arbre. Couleur par rameau du premier rang, héritée
dessous (orange, vert, acier bleuté, sable, menthe, pêche : jetons à
créer pour les trois derniers). Branches en courbes de Bézier du milieu
droit du parent au bord gauche de l'enfant (au pied pour les rangs ≥ 2),
2,6 / 1,7 / 1,2 px. Tab : un enfant, Entrée : un frère (même pendant
l'écriture) ; une pastille à droite dit le nombre d'enfants et replie
(« +n »). Déplacer un nœud déplace l'arbre ; supprimer emporte la
descendance ; de loin, les rangs ≥ 2 disparaissent et les noms deviennent
des pastilles. **Convertir** : les notes, formes, cartes choisies
deviennent une racine « Synthèse » au bord gauche de leur boîte et une
branche chacune (texte coupé à 60 signes) ; les objets d'origine s'en vont.

### 3.4 Guides magnétiques
Pendant qu'on déplace une sélection (sauf Alt tenu) : les x gauche, centre,
droit et les y haut, milieu, bas de la boîte déplacée se comparent aux
mêmes valeurs de chaque autre objet ; en deçà de 6 px d'écran (6 / zoom
dans le monde), la boîte saute sur le plus proche, en x et en y
séparément ; une ligne pointillée orange (1 px, 3 3) traverse la vue à la
coordonnée prise. Un bouton « Aimant / Libre » en bas à gauche (orange
quand l'aimant est pris). Sa place ici : `pressNode` du canvas.

### 3.5 Poignées et connecteurs
Quatre poignées sur l'objet choisi seul (haut, droite, bas, gauche : ronds
de 12 px, fond `--bg`, anneau orange 2 px, grossissent au survol) ; en tirer
une vers un objet le relie ; la lâcher dans le vide ouvre « Créer et
relier » (note, forme, décision, carte tâche, nœud de mind map). Les
connecteurs partent du côté qui fait face à l'autre objet, en courbe
(tangentes de longueur max(30, distance × 0,4)) ou coudés (H-V-H) ; un
connecteur choisi : Coudé/Courbe, Pointillé/Plein, Étiquette, Inverser,
Supprimer ; zone de clic de 14 px ; étiquette en mono capitales dans une
pastille au milieu. Ici : ajouter `style` (`line` droit, `curve`, `ortho`)
et `dash` aux liens (serveur : `normalize`) ; le sens « référence d'une
carte Générer » doit rester lisible (pointillé acier aujourd'hui).

### 3.6 Regrouper par couleur
Les post-it choisis (ou tous s'il n'y en a pas deux choisis) se rangent en
colonnes, une par couleur, 190 × 140 à 18 px d'écart, chacune dans un
cadre titré « <couleur> · <nombre> » ; ils glissent jusqu'à leur place
(0,6 s, `cubic-bezier(.2, .7, .2, 1)`). Ici les couleurs des post-it sont
des jetons (`coral-3`, `coral-2`, `coral-1`, `amb`, `verd-3`, `verd-4`,
`cy`, `paper`) : il leur faut des noms (« corail clair »…), à décider. Ne
touche que des objets existants (des `app.mutate`) : un module d'atelier
peut le faire, sauf l'animation (le canvas n'anime pas les objets).

### 3.7 Modèles
Un bouton « Modèles » en bas à gauche : « Insérer au centre de la vue ».
Kanban (trois cadres 320 × 520 et deux cartes tâche chacun), Rétrospective
(trois cadres, deux post-it chacun), Parcours (quatre formes reliées en
coudé : Début, Étape, Condition ?, Résultat), Mind map (un sujet et quatre
questions), SWOT (quatre cadres 410 × 290 en carré, un post-it chacun).
Pour un atelier de film, des modèles faits de cadres, post-it et notes
seraient greffables dès aujourd'hui (planche d'ambiance : lumière,
costumes, décors ; séquence en six cases ; fiche personnage : visage,
tenue, plein pied, voix) : **à décider par Cal**, rien n'est fait.

### 3.8 Zoom sémantique
Trois niveaux et leur nom affiché (« vue d'ensemble » < 30 %, « travail »,
« détail » > 130 %). De loin : le nom de chaque cadre en grand au centre
(Venus Rising, taille = largeur / 14 bornée à 10-26 px, dans une pastille
voilée avec le nombre d'objets), les post-it en aplats sans texte, les
cartes réduites au carré de couleur et au titre, la mind map à deux rangs.
De près : l'auteur et la date (en dur dans le prototype) et le nombre de mots sous un post-it, les
étapes d'une tâche, la courbe d'une mesure. Ici : ajouter `near` à côté de
`far` dans `applyView`, et les noms de cadres de loin.

### 3.9 Crayon (prototype : P)
Un trait à main levée (`ink` : une liste de points, couleur, épaisseur 2,2
px bornée au zoom) ; il se choisit, se déplace, se supprime ; couleurs de
la palette des formes. Proposé : P.

## 4. Ce que le canvas devrait exposer

Les modules s'en passent aujourd'hui, au prix de détours :

- **`canvas.flyTo(cible, { ms, pad, zmax })`** et **`canvas.viewFor(rect, pad)`** :
  le vol est écrit dans `atelier/socle.js` en pilotant `app.S.view` puis
  `app.canvas.applyView()` à chaque image ; `fit()` a ses marges et son
  zoom maximal (1,5) en dur.
- **`canvas.zoomAt(z, x, y)`** : le zoom au curseur est interne ; le calque
  de la machine temporelle le réécrit.
- **un événement `view`** émis par `applyView` : `plugins.js` le guette par
  `requestAnimationFrame` tant que quelqu'un l'écoute.
- **un rendu d'un état prêté** (`canvas.preview({ nodes, links })` et
  `canvas.preview(null)`) : la machine temporelle échange un instant
  `S.board.nodes` le temps d'un `render()`, puis rend le présent ; la
  mini-carte, dessinée à l'image suivante, montre le présent pendant ce
  temps.
- **`canvas.lock(raison)`** : figer les gestes (présentation, machine
  temporelle) ; aujourd'hui un calque par-dessus.
- **un crochet `decorate(n, el)`** après la construction d'un objet (les
  pastilles du vote) ; aujourd'hui un `MutationObserver` sur les couches.
- **`canvas.dom`** reste public (ou `nodeEl(id)`) : les modules y trouvent
  l'élément d'un objet.
- **un `commit` pour chaque geste** : écrire dans une note, les flèches,
  un redimensionnement passent par `app.touch` sans `commit`.
- **le serveur** : garder `slide` sur un cadre (§ 2).

Ce que les modules lisent, et qu'une refonte doit garder (ou dire) :
`app.S` (`board`, `view`, `sel`, `link`, `undo`, `redo`, `items`),
`app.node`, `app.label`, `app.kindLabel`, `app.select`, `app.mutate`,
`app.touch`, `app.LS`, `app.modal`, `app.canvas.{el, applyView, render, fit,
zoomTo, dom}`, `app.frameAround`, `app.tidy`, `app.undoStep`, `app.redoStep`,
`app.boardsModal`, `app.newBoard`, `app.exportBoard` ; dans le DOM : `#cv`,
`.ide-bar`, `#b-lib`, `#b-help`, `.world > .layer`, `.overlay`, `[data-id]`
sur `.nd` et `.fr`, `.links g[data-link]`, la variable `--z`.

## 5. Essais (29/09, DGX2)

Copie `/tmp/sr_ide_atelier` (dépôt au commit fffcf8a + `ideation.js` et
`plugins.js` du PC + `ideation/atelier/`), port 8803, données à part, une
planche semée de trois cadres, trois images, post-it, notes, liens
(`/tmp/sr_ide_atelier_seed.py`). Pilote Playwright
`/tmp/sr_ide_atelier_pilote.mjs` : **38 / 38**, aucun message de console —
présentation (trois cadres dans l'ordre de lecture, l'interface disparaît,
→ → ←, Suppr et N sans effet, Échap), ordre des diapositives (↓, masquer,
la présentation le suit, retour à l'ordre de lecture), vote (+1, Alt −1,
rien ne se choisit, classement, voler, Échap), projecteur, minuteur
(5 min, dernière minute en orange, pause, arrêt), machine temporelle (cinq
gestes = cinq états, l'état 1 se montre sans toucher la planche, ctrl+A
puis Suppr sans effet pendant qu'on rejoue, restaurer, enregistré sur le
serveur, ctrl+Z l'annule), palette (« gardien » → vol et sélection,
commandes sans accents), vues (Alt+1, 1, Alt+2, 2, Maj+chiffre
n'enregistre rien), barre étroite (1280 px : palette + bouton « atelier »,
minuteur et présentation par son menu). `python3 tools/check.py` : 613 / 613.

Captures : `/tmp/sr_ide_atelier_shots/` (`01-planche` … `19-presentation-1280`),
et côte à côte avec le prototype : `cote-a-cote-presentation.png`,
`cote-a-cote-presentation-2.png`, `cote-a-cote-machine.png`,
`cote-a-cote-palette.png`.

## Sources

1. Aide Google Chrome, « Raccourcis clavier de Chrome », https://support.google.com/chrome/answer/157179 (lu le 29/09 : Ctrl+1…8, Ctrl+9 sous Windows et Linux, ⌘+1…9 sur Mac ; aucun Alt+chiffre)
