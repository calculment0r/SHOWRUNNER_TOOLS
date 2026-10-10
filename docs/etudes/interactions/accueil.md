# L'accueil et le passage d'un outil à l'autre — dix propositions d'interaction (10/10/2026)

Cal, 09/10 : « on veut des interactions simples, rapides, et on élimine des clics pour que tout soit fluide ».
Ce fichier est l'étude pour l'accueil du portail, l'en-tête (le menu Team / Workspace, le nom et son menu), et
le passage d'un outil à l'autre. Pas de code : des propositions, chacune avec le geste d'aujourd'hui compté, le
geste proposé, le principe et sa source, le coût.

## 1. Ce qui a été mesuré

Le même pilote que pour ODIO (`interactions/odio.md` § 1), une fenêtre de 1 600 × 1 000, passé le 09/10 puis
le 10/10 sur l'intégration (`23a0fbb`) : les mêmes comptes. Scratchpad : `sr_c/parcours2.mjs`,
`sr_c/shots2/parcours.txt`, `sr_c/shots/accueil_*.png`, `sr_c/shots2/entete_*.png`.

| parcours (aujourd'hui) | clics | champs | touches | pages | gestes |
|---|---|---|---|---|---|
| l'accueil → un outil (la carte) | 1 | | | 1 | **2** |
| d'un outil à un autre (« Outils » → l'outil) | 2 | | | 1 | **3** |
| changer de Workspace (le sélecteur → le Workspace) | 2 | | | 0 ou 1 | **2** (une page de plus dans 7 outils sur 12) |
| un Workspace neuf (le sélecteur → « + Nouveau Workspace » → le nom → Créer) | 3 | 1 | | | **4** |
| la file de rendu (le nom → « File de rendu » → fermer) | 2 | | 1 | | **3** |
| l'état des machines (survoler le nom) | | | | | **0** (une bulle) |

Ce qui est déjà bien, et qu'on garde : une seule action orange sur l'accueil (« Commencer un projet ») ; la
case du nom de l'outil a la même largeur partout (la barre ne saute plus) ; la barre ne se coupe jamais (les
outils passent dans « Outils ») ; en plein écran, changer d'outil garde le plein écran (la coquille) ; le
Workspace dans l'adresse (`?e=`), deux onglets dans deux Workspaces ; « Reprendre » sur l'accueil (les travaux
en cours, les derniers projets d'Idéation, du Montage, d'ODIO) ; deux points discrets sur le nom (un calcul en
cours, une demande à traiter).

Les frictions vues :
- **À 1 600 px, la barre ne montre plus les outils** : les douze noms n'y tiennent pas, tout passe dans le
  menu « Outils » (`entete_menu_workspace_sombre.png`). Changer d'outil : 2 clics et une page.
- **Changer d'outil, c'est quitter l'autre** : hors plein écran, la page se recharge ; la lecture d'ODIO
  s'arrête, la sélection du Montage se perd. Revenir, c'est encore 3 gestes.
- **Changer de Workspace recharge la page** dans Image, Vidéo, Upscale, Faire une chanson, Object Creator,
  Character et Movie Analysis ; Asset, Transcrire, ODIO, Idéation et le Montage relisent leurs listes sur place
  (`surEspace`).
- **La bulle du nom couvre la barre de l'outil** : dans ODIO, elle tombe sur Exporter et Générer, et elle reste
  ouverte tant que le pointeur la survole (`commun/apercu.js`) ; le pilote n'a pas pu cliquer « Générer » pendant
  8 secondes (`sr_c/parcours.out`, 09/10). À vérifier à la main, mais la règle est dans le code.
- **Un Workspace neuf demande un nom** dans un champ avant d'exister.
- **L'accueil répète « LOCAL » sur chaque carte** (dix fois) : c'est vrai pour toutes ; seule l'exception
  (un modèle payant branché un jour) mériterait une marque. À 1 000 px de haut, le Studio commence au bas de
  l'écran et les derniers assets sont hors de la vue.
- **Le même geste ne fait pas la même chose partout** : dans ODIO et Idéation, un clic sur une vignette du
  panneau Asset la pose ; ailleurs, c'est le double-clic (qui pose deux fois dans ODIO, `odio.md` § 1) ; Ctrl+K
  n'ouvre une palette que dans Idéation ; « ? » n'ouvre les raccourcis que dans Idéation.

## 2. Les dix propositions

« Géniale » : ça change la façon de travailler. « Rapide » : ça enlève des clics tout de suite.

### 1. Ctrl+K partout : aller n'importe où — rapide

- **Aujourd'hui** : un outil, 3 gestes (« Outils », l'outil, la page) ; un document d'un autre outil, 3 gestes
  plus le chercher dans sa liste ; un Workspace, 2 clics ; la file, 2 clics.
- **Proposé** : **Ctrl+K** sur toutes les pages ouvre la palette qu'Idéation a déjà : sans rien taper, les
  derniers documents ouverts (planches, projets ODIO, séquences, transcriptions) et les travaux en cours ; en
  tapant, les outils, les documents, les Workspaces, les commandes de l'outil ouvert (« exporter »,
  « nouvelle piste »), la file, les préférences. Entrée y va. Dans Idéation, la même palette garde ses objets de
  planche en tête. 3 gestes → 2 touches et quelques lettres.
- **Ce que ça change pour Cal** : une seule touche à retenir pour tout le portail ; on va où l'on veut sans
  savoir où c'est rangé.
- **Principe** : la palette de commandes — Figma ouvre ses actions, ses assets et ses plugins par Ctrl+K [1] ;
  notre palette d'Idéation (`ideation/`, Ctrl+K) vole déjà jusqu'à un objet.
- **Coût** : moyen (la palette d'Idéation sortie dans `commun/`, montée par `mountHeader` ; chaque outil déclare
  ses commandes comme il déclare son menu de repli). **Dépend de** : l'inventaire (`core/inventaire.py`) pour
  les documents de tous les outils, qui existe.

### 2. Les outils toujours dans la barre — rapide

- **Aujourd'hui** : à 1 600 px, « Outils » puis l'outil (2 clics), et l'on relit la liste à chaque fois.
- **Proposé** : quand les douze noms ne tiennent pas, la barre garde **les quatre outils qu'on a ouverts le
  plus récemment** (par leur nom) et range les autres dans « Outils » ; les icônes de l'accueil passent devant
  chaque nom pour qu'une forme suffise de loin. 2 clics → 1 pour l'outil d'à côté.
- **Ce que ça change pour Cal** : Idéation, ODIO, Vidéo, le Montage — ses quatre outils du moment — sont
  toujours à un clic.
- **Principe** : les menus scindés — mettre en tête les quelques choix les plus fréquents fait gagner de 17 à
  58 % du temps de sélection [2] ; la largeur reste mesurée, pas devinée (la règle actuelle de `mountHeader`).
- **Coût** : petit (`commun/shell.js`, `paintNav` et `fit` : la liste des récents dans `sessionStorage` ou les
  préférences). **Dépend de** : rien.

### 3. Glisser un asset sur un outil — géniale

- **Aujourd'hui** : faire une vidéo d'une image vue dans Asset : ouvrir Vidéo (3 gestes), ouvrir le panneau,
  chercher l'image, la poser (3 à 4) ; ≈ 7 gestes.
- **Proposé** : on glisse une image (ou un son, un élément) depuis le panneau Asset, la page Asset ou une
  planche, **sur le nom d'un outil** dans la barre : l'outil s'ouvre avec elle déjà posée — Vidéo en première
  image, Image en référence, Upscale prête à agrandir, Object Creator prête pour le mesh, ODIO sur une piste ;
  tenue une demi-seconde au-dessus de « Outils », la liste s'ouvre pour qu'on lâche sur l'outil voulu. 7 → 1.
- **Ce que ça change pour Cal** : « fais-en une vidéo » devient un geste de la main, d'un outil à l'autre.
- **Principe** : le « spring-loading » d'Apple — un objet glissé au-dessus d'une destination l'active après un
  temps de survol (ou la barre d'espace), pour lâcher dedans [3] ; les adresses préremplies existent déjà (Vidéo
  prend `?mode=`, `?start=`, `?ref=` : `agent_autonome.md` § 5.10).
- **Coût** : moyen (`commun/shell.js` : une zone de dépôt par nom d'outil, `dragItem` porte déjà l'objet ;
  chaque outil lit son paramètre d'entrée). **Dépend de** : une adresse d'entrée par outil (Vidéo l'a ; Image,
  Upscale, Object Creator, ODIO à déclarer, dans `docs/ARCHITECTURE.md`).

### 4. Changer d'outil sans le quitter — géniale

- **Aujourd'hui** : hors plein écran, changer d'outil recharge la page ; en revenant, on retrouve le document,
  pas sa place (la lecture arrêtée, la sélection perdue, le zoom remis).
- **Proposé** : les trois derniers outils restent ouverts, endormis, dans des cadres posés l'un sur l'autre
  (c'est déjà ce que fait la coquille en plein écran : la page du dessous est mise en sommeil, ses sons coupés).
  Revenir à un outil le réveille tel qu'on l'a laissé, en un clic, sans chargement. Le quatrième pousse le plus
  ancien, qui se ferme comme aujourd'hui.
- **Ce que ça change pour Cal** : on passe d'Idéation à ODIO et retour comme d'un onglet à l'autre ; aller
  chercher un son ne coûte plus sa place dans la planche.
- **Principe** : garder l'état de ce qu'on quitte — c'est ce qu'attend qui change d'application sur un
  ordinateur ; notre coquille l'a déjà prouvé pour le plein écran (`commun/coquille.js`).
- **Coût** : gros (la mémoire de trois outils lourds à mesurer — ODIO et le Montage ; la co-édition et les
  flux qui se ferment en sommeil, déjà traités par la coquille). **Dépend de** : une mesure de mémoire sur le
  PC de Cal.

### 5. Le portail vu de haut — géniale

- **Aujourd'hui** : pour retrouver « ce qu'on a fait pour le thé glacé », il faut savoir dans quel outil :
  ouvrir chaque outil, changer de Workspace, parcourir ses listes.
- **Proposé** : une vue « de haut » (depuis l'accueil, ou en dézoomant l'accueil) où chaque Workspace est une
  région ; de loin, on lit les noms des Workspaces et leurs couleurs ; en approchant, leurs planches, projets
  ODIO, séquences et transcriptions apparaissent en vignettes ; en approchant encore une planche, on la voit en
  miniature ; un clic l'ouvre dans son outil. Le même zoom que le panneau Asset en accordéon, mais pour tout ce
  qu'on fabrique.
- **Ce que ça change pour Cal** : le portail se lit comme une carte ; on retrouve par l'endroit, pas par l'outil.
- **Principe** : le zoom sémantique — la taille apparente d'un objet décide du détail qu'il montre (Pad++ [4]) ;
  le « ZoomWorld » de Raskin : tous les documents sur un plan qu'on parcourt en zoomant, parce qu'on se
  souvient bien des places [5].
- **Coût** : gros (une page neuve ; le canvas d'Idéation sait dessiner par niveaux). **Dépend de** :
  l'inventaire (`core/inventaire.py`, `GET /api/tableau`) qui énumère déjà les créations de chaque outil par
  Workspace, avec leur auteur.

### 6. Le Workspace change sans recharger — rapide

- **Aujourd'hui** : dans sept outils, changer de Workspace recharge la page (2 clics + une page, et l'outil
  repart de zéro).
- **Proposé** : chaque outil relit ses listes sur place, comme le font déjà ODIO, Idéation, le Montage,
  Transcrire et Asset (`surEspace`) ; un document ouvert reste ouvert et dit toujours son Workspace (la règle de
  `equipes_espaces.md` § 4.3). 3 → 2.
- **Ce que ça change pour Cal** : passer d'un projet à l'autre ne coûte plus la page en cours.
- **Principe** : la cohérence (le même geste fait la même chose partout : Nielsen, heuristique 4 [6]).
- **Coût** : moyen (sept outils, un par un). **Dépend de** : rien.

### 7. Un Workspace neuf sans fenêtre — rapide

- **Aujourd'hui** : le sélecteur → « + Nouveau Workspace » → le nom → Créer : 4 gestes.
- **Proposé** : « + Nouveau Workspace » crée « Workspace du 10/10 » dans la Team choisie, l'ouvre, et met son nom
  en édition dans la barre ; on tape le vrai nom ou on travaille. 4 → 1 (+ le nom quand on veut).
- **Ce que ça change pour Cal** : le même geste que pour un projet ODIO et une planche (`odio.md` n° 6,
  `ideation.md` n° 6) : on crée d'abord, on nomme sur place.
- **Principe** : remplacer la formalité par l'édition sur place, réversible [7].
- **Coût** : petit (`commun/shell.js`, le menu du Workspace). **Dépend de** : rien.

### 8. La bulle du nom ne cache rien — rapide

- **Aujourd'hui** : au survol du nom, une bulle (les machines, les travaux) tombe sur la barre de l'outil et y
  reste tant que le pointeur la survole.
- **Proposé** : l'état se lit **sur le nom lui-même** — une pastille par machine (couleur de jeton : prête,
  occupée, absente) et le nombre de travaux en cours —, ce qui rend la bulle rarement utile ; elle ne s'ouvre
  plus qu'après un temps d'arrêt, se ferme dès que le pointeur sort du nom, et ne reste que si l'on y entre par
  son bord haut. 0 geste pour l'état ; plus jamais un bouton caché.
- **Ce que ça change pour Cal** : il voit d'un coup d'œil si les DGX sont libres, et Générer reste cliquable.
- **Principe** : les états par des formes plutôt que par des phrases (règle 4 de la rédaction,
  `briefs/redaction_regles.md`) ; un aperçu au survol ne doit pas masquer la cible suivante.
- **Coût** : petit (`commun/apercu.js`, `commun/shell.js` : `paintFile`). **Dépend de** : rien.

### 9. L'accueil en un écran — rapide

- **Aujourd'hui** : à 1 600 × 1 000, l'écran montre le titre, le kit, les Apps ; le Studio commence en bas,
  « Reprendre » et les derniers assets sont plus bas ; « LOCAL » est écrit dix fois.
- **Proposé** : **« Reprendre » en premier** (les derniers documents, en vignettes, et les travaux en cours) :
  c'est le geste de chaque retour ; puis les Apps et le Studio en cartes plus basses ; « LOCAL » disparaît (dit
  une fois en pied : « tout calcule sur nos machines »), seule l'exception aurait une marque. 1 défilement → 0.
- **Ce que ça change pour Cal** : en arrivant, il reprend où il était en un clic.
- **Principe** : une information une seule fois, là où l'on s'en sert (règle 3 de la rédaction) ; la
  reconnaissance plutôt que le rappel (Nielsen, heuristique 6 [6]).
- **Coût** : petit (`accueil.js`, `accueil.css` ; « Reprendre » existe, il gagne des vignettes). **Dépend de** :
  rien.

### 10. Les mêmes touches dans tous les outils — rapide

- **Aujourd'hui** : un clic pose une vignette du panneau Asset dans ODIO et Idéation, un double-clic ailleurs ;
  Ctrl+K et « ? » n'existent que dans Idéation ; Ctrl+T (une piste) est pris par Chrome hors plein écran.
- **Proposé** : une grammaire commune, écrite une fois (`docs/ARCHITECTURE.md`) et lue par chaque outil :
  Ctrl+K aller et faire (n° 1), Ctrl+Espace la bibliothèque, « ? » les raccourcis de l'outil, Ctrl+, les
  préférences, Ctrl+Z annuler ; un clic choisit, un double-clic pose, glisser pose là où l'on lâche — partout ;
  aucune touche que le navigateur garde (Ctrl+T, Ctrl+N, Ctrl+W). 0 geste de plus, des erreurs en moins.
- **Ce que ça change pour Cal** : ce qu'il apprend dans un outil marche dans tous.
- **Principe** : la cohérence et les standards (Nielsen, heuristique 4 [6]) ; la règle 7 de la rédaction (le
  même mot, le même geste, pour la même chose).
- **Coût** : petit (le réglage `clickPlaces` de `commun/dock.js`, un « ? » commun dans `mountHeader`).
  **Dépend de** : le lot transverse A (le panneau Asset, le glisser-déposer universel).

## 3. Le top 3

1. **Ctrl+K partout** (n° 1) : une touche pour tout le portail, sur une palette qui existe déjà.
2. **Glisser un asset sur un outil** (n° 3) : passer d'un outil à l'autre AVEC ce qu'on tient, en un geste.
3. **Les outils toujours dans la barre** (n° 2) avec **la bulle qui ne cache rien** (n° 8) : deux petits
   changements qui suppriment un clic à chaque changement d'outil et un bouton caché.

Les deux grosses : **changer d'outil sans le quitter** (n° 4) et **le portail vu de haut** (n° 5), le zoom
sémantique appliqué à tout ce qu'on fabrique.

## Sources

1. Figma, « Use the actions menu in Figma Design » (Ctrl+K) —
   https://help.figma.com/hc/en-us/articles/23570416033943-Use-quick-actions (extrait, 10/10/2026).
2. Sears, A. & Shneiderman, B., « Split Menus: Effectively Using Selection Frequency to Organize Menus »,
   *ACM TOCHI* 1(1), 1994, p. 27-51 (DOI 10.1145/174630.174632) — https://www.cs.umd.edu/~ben/papers/Sears1994Split.pdf
   (résumé : 17 à 58 % de temps gagné sur le terrain).
3. Apple, AppKit, « NSSpringLoadingDestination » (« dragging an object onto a destination object and hovering
   or force-clicking to activate it ») — https://developer.apple.com/documentation/appkit/nsspringloadingdestination
   (extrait) ; la barre d'espace l'ouvre tout de suite : https://eshop.macsales.com/blog/88761-how-to-use-spring-loaded-folders-in-macos/
   (tiers, extrait).
4. Bederson, B. B. & Hollan, J. D., « Pad++: A Zooming Graphical Interface for Exploring Alternate Interface
   Physics », UIST '94, p. 17-26 — https://www.lri.fr/~mbl/Teach/SituatedComputing/2017/papers/ZUI/pad++-uis94-p17-bederson.pdf
5. Raskin, J., *The Humane Interface*, Addison-Wesley, 2000, « ZoomWorld » —
   https://en.wikipedia.org/wiki/The_Humane_Interface ; https://raskincenter.org/rchi/zoomable-interfaces-decade-on/
   (extraits).
6. Nielsen, J., « 10 Usability Heuristics for User Interface Design », Nielsen Norman Group (4 : cohérence et
   standards ; 6 : reconnaître plutôt que se rappeler) — https://www.nngroup.com/articles/ten-usability-heuristics/
7. Shneiderman, B., « Direct Manipulation: A Step Beyond Programming Languages », *Computer* 16(8), 1983,
   p. 57-69 (DOI 10.1109/MC.1983.1654471).
