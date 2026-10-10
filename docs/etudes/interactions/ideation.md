# Idéation — dix propositions d'interaction (10/10/2026)

Cal, 09/10 : « on veut des interactions simples, rapides, et on élimine des clics pour que tout soit fluide
[…] je veux des features géniales, comme quand on travaille avec un zoom sémantique ». Ce fichier est
l'étude pour Idéation : la planche, ses cartes Générer, et l'agent Showrunner. Pas de code : des
propositions, chacune avec le geste d'aujourd'hui compté, le geste proposé, le principe et sa source, le coût.

Les mots sont ceux du lexique du lot rédaction (`docs/etudes/redaction.md`, à venir) : une planche, un
cadre, une carte Générer, une référence, un rendu, un élément.

## 1. Ce qui a été mesuré

Le même pilote que pour ODIO (`interactions/odio.md` § 1) : un portail d'essai neuf (port 9051, moteurs
factices, `SR_FAUX_MACHINES=1`, le faux Ollama de `tools/faux_ollama.py`), Chromium sans affichage, chaque
geste compté. Passé le 09/10, puis le 10/10 sur l'intégration (`23a0fbb`) : les mêmes comptes. Scratchpad :
`sr_c/parcours2.mjs`, `sr_c/shots/ideation_*.png`, `sr_c/shots/projet_*.png`, `sr_c/shots2/parcours.txt`.

| parcours (aujourd'hui) | clics | champs | touches | attentes | glisser | gestes |
|---|---|---|---|---|---|---|
| une planche neuve (« + » → le nom → Créer) | 2 | 1 | | 1 | | **4** + une page |
| une note (N, poser, écrire, Échap) | 1 | 1 | 2 | | | **4** |
| une carte Générer, une image en référence, le rendu | 4 | 2 | 3 | 1 | 1 | **11** |
| une demande à l'agent (Showrunner, écrire, Entrée) | 1 | 1 | 1 | 2 | | **5** (fin du tour : 3,6 s, faux Ollama) |
| chercher par la palette (Ctrl+K, écrire, Échap) | | 1 | 2 | | | **3** |
| commencer un projet (accueil → le brief → Commencer → 3 réponses → Répondre) | 5 | 1 | | 2 | | **10** + deux pages |

Le détail de la carte Générer (11 gestes) : G, poser la carte, écrire le prompt, Ctrl+Espace (le panneau
Asset), chercher l'image, un clic la pose au centre de la vue, fermer le panneau, glisser l'image sur la carte
(elle devient sa référence), choisir la carte, « Générer », attendre (3,7 s en factice).

Ce qui est déjà bien, et qu'on garde : une lettre par outil (N, S, T, F, G, M, P…) ; un fil tiré d'une sortie
allume ce qui peut le recevoir ; lâché dans le vide, il propose un objet déjà branché ; une image lâchée sur
une carte devient sa référence ; les rendus se posent à côté de la carte, reliés ; le zoom sémantique à trois
niveaux (`canvas.js`, étude `ideation_miro.md` § 3.7) ; la palette Ctrl+K qui vole jusqu'à un objet ; l'agent
qui pose tous ses gestes en un seul pas d'annulation ; « Commencer un projet » qui crée Team, Workspace et
planche d'un geste.

Les frictions vues :
- **Le même texte six fois** : sur un projet neuf, le nom « Pub de 30 s pour une marque de thé glacé » est
  dans l'en-tête, dans la barre de la planche, en titre de l'inspecteur, deux fois dans son plan, en titre sur
  la planche, et dans le premier message de l'agent (`projet_planche_sombre.png`). Le titre posé sur la
  planche mord en plus sur l'étiquette du cadre « Brief » juste dessous.
- **Les raccourcis trois fois** : une bande en bas de la planche (« molette : zoom · glisser le fond… »), une
  case « Gestes » dans l'inspecteur, et la fenêtre « ? ».
- **La carte et l'inspecteur se répètent** : le prompt, les références, le modèle, le nombre d'images et le
  bouton « Générer ×2 » sont sur la carte et dans l'inspecteur (`ideation_carte_sombre.png`). L'inspecteur
  compte 31 champs et boutons pour une carte.
- **Trois colonnes** : avec l'agent ouvert, la planche n'a plus que 880 px sur 1 600 ; l'inspecteur et l'agent
  prennent le reste (`ideation_agent_tour_sombre.png`).
- **La barre du haut a 21 boutons** (Exporter, Modèles, Présenter, Animer, Diapositives, Vote par points,
  Projecteur, Minuteur, Machine temporelle, chercher, commenter, le fil, la visio…) et celle de gauche 19
  outils ; « Modèles » est en haut et en bas à gauche.
- **Une référence, c'est quatre gestes** : ouvrir le panneau, chercher, poser l'image au centre, la glisser
  sur la carte. Les images déjà sur la planche, à côté, ne servent pas plus vite.
- **Choisir un modèle avant d'écrire** : la carte montre trois tuiles (Z-Image « texte seul », Qwen-Image
  « 10 réf. au plus », Krea 2 « 2 réf. au plus ») ; le bon choix découle pourtant des références branchées.
- **Une planche neuve demande un nom** dans une fenêtre, alors qu'elle en propose déjà un (« Planche du
  09/10 ») et que le nom se change sur place dans la barre.
- **Les questions de l'agent** : trois clics de réponse, puis « Répondre » ; un « Vas-y sans répondre » à côté.

## 2. Les dix propositions

« Géniale » : ça change la façon de travailler. « Rapide » : ça enlève des clics tout de suite.

### 1. Choisir des images, taper G — rapide

- **Aujourd'hui** : 11 gestes pour une carte branchée sur une image et son rendu (§ 1).
- **Proposé** : on choisit une ou plusieurs images (ou un élément) sur la planche, on tape **G** (ou M pour la
  vidéo) : la carte naît à droite de la sélection, déjà branchée (les images en références, dans l'ordre du
  choix), le champ du prompt a la main. Sans sélection, G garde son geste d'aujourd'hui (poser la carte).
  11 → 4 (choisir, G, écrire, Ctrl+Entrée — proposition 2).
- **Ce que ça change pour Cal** : on part de ce qu'on regarde ; plus de fil à tirer pour le cas le plus courant.
- **Principe** : l'objet d'abord, l'action ensuite (le « nom puis verbe » du Xerox Star : on désigne, puis
  une touche dit quoi faire [1]) ; c'est déjà le geste de Ctrl+Alt+G (encadrer la sélection).
- **Coût** : petit (`ideation.js`, la table des lettres : G et M lisent `S.sel` ; `ports.js` sait déjà quelle
  entrée prend une image). **Dépend de** : rien.

### 2. Ctrl+Entrée lance — rapide

- **Aujourd'hui** : le prompt écrit dans la carte, il faut choisir la carte puis cliquer « Générer » (2 clics),
  ou aller au bouton de l'inspecteur.
- **Proposé** : dans le champ d'une carte (et dans le composeur), **Ctrl+Entrée** lance la carte, comme son
  bouton ; Entrée seule reste un retour à la ligne. 2 → 1 touche.
- **Ce que ça change pour Cal** : on écrit, on lance, on écrit la suivante, sans quitter le clavier.
- **Principe** : le raccourci d'envoi des champs de prompt (le champ de l'agent part déjà sur Entrée) ; les
  raccourcis pour l'expert (Shneiderman, règle « enable frequent users to use shortcuts » [2]).
- **Coût** : petit (`gen.js`, `video.js`). **Dépend de** : rien.

### 3. Garder, jeter au clavier — rapide

- **Aujourd'hui** : un lot de 8 images se trie à la souris : glisser les bonnes, supprimer les autres (et perdre
  leur lignée), ou les laisser encombrer la planche.
- **Proposé** : sur un rendu choisi, **P** garde (une pastille, l'image remonte en tête de son lot), **X** met de
  côté (l'image se grise et passe dans un groupe « chutes » replié au bout du lot), **U** remet à zéro ; le choix
  passe tout seul à l'image suivante du lot (les flèches aussi). Rien n'est supprimé : les chutes gardent leur
  lignée et se rouvrent. 2 à 3 gestes par image → 1 touche.
- **Ce que ça change pour Cal** : trier vingt essais prend vingt touches, les yeux sur les images.
- **Principe** : le tri de Lightroom Classic — P pour garder, X pour rejeter, U pour annuler, et l'avance
  automatique à l'image suivante ; un rejet n'est pas une suppression [3].
- **Coût** : moyen (`gen.js`, `placeResults` : l'ordre et le groupe des chutes ; `groups.js` replie déjà).
  **Dépend de** : rien. À aligner avec Asset (la même pastille de favori) : lot transverse A.

### 4. La carte choisit le modèle — rapide

- **Aujourd'hui** : lire trois tuiles, en choisir une (1 clic) ; une référence de trop met un fil en alerte.
- **Proposé** : la carte prend le modèle qui va avec ce qui est branché (aucune référence, une ou deux, plus) et
  l'écrit en petit (« Krea 2 · choisi pour 2 références ») ; un clic sur ce mot rouvre les trois tuiles. Le choix
  vient du registre des capacités, le même que celui de l'agent (lot 2 : « une demande précise → la carte prête
  avec le bon modèle choisi par le registre ») : une seule vérité. 1 clic et une lecture → 0.
- **Ce que ça change pour Cal** : il dit ce qu'il veut (un prompt, des images), l'outil fait le choix technique.
- **Principe** : les défauts intelligents — le défaut est lu comme la recommandation [4] ; ne pas demander ce
  qu'on peut déduire.
- **Coût** : petit (`gen.js` : le modèle déduit des fils, tant que la personne n'en a pas choisi un).
  **Dépend de** : le registre (`agent/intentions.json`, lot 2 de l'agent).

### 5. Une seule place pour chaque réglage — rapide

- **Aujourd'hui** : le prompt, les références, le modèle, le nombre et « Générer ×2 » sont sur la carte ET dans
  l'inspecteur ; les raccourcis sont à trois endroits ; le nom de la planche est six fois à l'écran.
- **Proposé** : la carte garde ce qu'on touche à chaque rendu (le prompt, les références, le bouton) ;
  l'inspecteur ne montre que ce qui n'y est pas (format, taille, nombre, graine, LoRA) et n'a plus de bouton —
  l'orange est sur la carte choisie. Les raccourcis : seulement « ? » (et l'aide au survol de chaque outil) ; la
  bande du bas et la case « Gestes » partent. Le nom de la planche : une fois, dans la barre. 31 champs et
  boutons dans l'inspecteur → une douzaine.
- **Ce que ça change pour Cal** : l'écran se lit d'un coup d'œil ; on ne se demande plus quel bouton est le bon.
- **Principe** : la règle 3 de Cal (« une information ne s'affiche qu'une fois par écran, à l'endroit où l'on
  s'en sert », `briefs/redaction_regles.md`) ; la règle 4 du thème (un seul orange).
- **Coût** : petit (`inspector.js`, `ideation.css`). **Dépend de** : la relecture du lot rédaction.

### 6. Une planche sans fenêtre — rapide

- **Aujourd'hui** : « + » → la fenêtre (le nom proposé) → Créer : 2 clics, 1 champ, une attente.
- **Proposé** : « + » crée « Planche du 10/10 » et l'ouvre, le nom sélectionné dans la barre : on tape pour le
  changer, ou on commence à travailler. 4 → 1.
- **Ce que ça change pour Cal** : une planche se jette et se recommence comme une feuille de brouillon.
- **Principe** : remplacer la formalité par l'édition sur place, des actions rapides et réversibles [2] ; le
  même geste qu'ODIO (`odio.md`, n° 6) — le même mot, le même geste dans tous les outils.
- **Coût** : petit (`ideation.js`, `newBoard` : sans `askName`). **Dépend de** : rien.

### 7. Le fil lâché dans le vide, en étoile — géniale

- **Aujourd'hui** : tirer un fil depuis une image et le lâcher dans le vide ouvre une liste (Générer image,
  Générer vidéo et ses modes, Note, Post-it, Depuis la bibliothèque…) : on lit, on clique (2 gestes après le
  glisser).
- **Proposé** : la même liste en **étoile**, sous le pointeur, les huit suites d'une image aux mêmes places
  partout : Variation, Éditer, Vidéo (première image), Agrandir, Objet 3D, Élément, Note, Bibliothèque. Le
  débutant lit l'étoile ; l'habitué **ne s'arrête pas** : il tire l'image et finit le geste dans la direction
  voulue (vers la droite = une vidéo qui part de cette image), la carte naît branchée sans que le menu se montre.
  2 gestes → 1 seul glisser.
- **Ce que ça change pour Cal** : « la suite de cette image » devient un mouvement de la main, comme un
  geste de peintre ; les directions s'apprennent seules.
- **Principe** : les marking menus — un trait est environ 3,5 fois plus rapide que le menu, et les habitués
  ouvrent le menu seulement pour se rappeler la disposition [5] ; ComfyUI propose déjà des nœuds quand on lâche
  un fil [6]. Le même menu en étoile que pour ODIO (`odio.md`, n° 9).
- **Coût** : moyen (`commun/menu.js` : la forme en étoile et la lecture du trait, une fois pour tous ;
  `wires.js` : les huit suites). **Dépend de** : les outils derrière (Agrandir, Objet 3D) par leurs routes.

### 8. Générer tout le cadre — géniale

- **Aujourd'hui** : un cadre qui tient huit cartes prêtes (un storyboard, une planche d'essais) se lance carte par
  carte : choisir, Générer, huit fois (16 clics) ; seul le découpage de l'agent a « Lancer les N images ».
- **Proposé** : un cadre (ou une sélection) qui contient des cartes prêtes porte un bouton **« Générer les 8 »**
  avec le coût (le temps de GPU estimé, comme le budget de la Team l'affiche) ; un clic, un seul consentement ;
  les rendus tombent chacun à côté de sa carte. 16 → 1.
- **Ce que ça change pour Cal** : la planche devient une table de production ; on prépare, puis on lance tout.
- **Principe** : le coût affiché avant de dépenser, puis un seul accord — Higgsfield Supercomputer [7] et la
  décision A4 de Cal (`agent_autonome.md` § 10 : « le consentement par plan, coût affiché ») ; le même chemin
  que `/api/ideation/lot` (8 au plus).
- **Coût** : moyen (`groups.js` ou `selection.js` : le bouton ; `gen.js` : lancer chaque carte par son chemin).
  **Dépend de** : l'estimation du coût par travail (`/api/budget`, étape 8 des Teams).

### 9. L'agent voit ce que je montre — géniale

- **Aujourd'hui** : pour parler d'une image à l'agent, on la cite (« citer la sélection », 1 clic, ou un
  glisser sur le champ) ; l'agent prend toute une colonne de plus.
- **Proposé** : ce qui est choisi sur la planche est le sujet de la phrase, sans geste : « fais-en une vidéo de
  5 s » parle de l'image choisie (une petite vignette au-dessus du champ le montre, on la retire d'un clic). Et
  l'agent n'a plus sa colonne : il partage celle de l'inspecteur (deux onglets, ou l'agent replié en une ligne de
  saisie au bas de la planche, qui s'ouvre quand il répond). 1 clic → 0 ; la planche retrouve 360 px.
- **Ce que ça change pour Cal** : on montre et on dit, comme à quelqu'un à côté de soi.
- **Principe** : « Put-that-there » — désigner et dire ensemble, le geste lève l'ambiguïté du « ça » [8] ;
  le lot 3 de l'agent donne déjà à chaque outil `agent.contexte()` (ce qui est ouvert, la sélection).
- **Coût** : moyen (`agent.js` : la sélection en pièces par défaut ; la mise en page des colonnes).
  **Dépend de** : le lot 3 de l'agent (le panneau commun) ; la règle « jamais un rendu sans la personne » reste.

### 10. La barre du haut en sept boutons — rapide

- **Aujourd'hui** : 21 boutons en haut, 19 outils à gauche ; les modes de réunion (Présenter, Animer,
  Diapositives, Vote par points, Projecteur, Minuteur, Machine temporelle) sont toujours là.
- **Proposé** : en haut, ce qui sert à chaque séance — Planches, le nom, annuler, Exporter, Présenter, la
  recherche (Ctrl+K), inviter ; les modes de réunion dans un seul menu « Réunion », et tous dans la palette
  Ctrl+K ; à gauche, les outils rares (mind map, carte de tâche, adresse web) dans un tiroir « + ». 40 boutons
  visibles → une vingtaine.
- **Ce que ça change pour Cal** : on trouve plus vite ce qui sert, et le reste se tape.
- **Principe** : la loi de Hick (le temps de choix croît avec le nombre de choix [9]) ; la divulgation
  progressive [10] ; Figma range ses actions rares dans un menu d'actions ouvert par Ctrl+K [11].
- **Coût** : petit (`ideation/index.html`, `menus.js`, la palette existe). **Dépend de** : rien.

## 3. Le top 3

1. **Choisir des images, taper G** (n° 1), avec **Ctrl+Entrée** (n° 2) : 11 gestes → 4 pour le geste le plus
   fréquent d'Idéation ; une demi-journée.
2. **Le fil lâché dans le vide, en étoile** (n° 7) : la suite d'une image en un mouvement ; le menu en étoile,
   écrit une fois dans `commun/menu.js`, sert aussi ODIO et le Montage.
3. **Générer tout le cadre** (n° 8) : la planche devient une table de production, sous la règle de Cal (le coût
   affiché, un seul accord).

Puis, en une demi-journée chacune : une seule place pour chaque réglage (5), une planche sans fenêtre (6), la
carte qui choisit le modèle (4, dès que le registre du lot 2 est là).

## Sources

1. Smith, D. C., Irby, C., Kimball, R., Verplank, B., Harslem, E., « Designing the Star User Interface »,
   *Byte* 7(4), avril 1982, p. 242-282 (on choisit l'objet, puis une touche de commande agit dessus).
2. Shneiderman, B., « Direct Manipulation: A Step Beyond Programming Languages », *Computer* 16(8), 1983,
   p. 57-69 ; et les « huit règles d'or » de *Designing the User Interface* (raccourcis pour les habitués).
3. Adobe Lightroom Classic, le tri par drapeaux : P, X, U et l'avance automatique — Julieanne Kost (Adobe),
   « Applying Flags, Stars, and Color Labels in Lightroom Classic », 2024 —
   https://jkost.com/blog/2024/06/applying-flags-stars-and-color-labels-in-lightroom-classic.html ;
   « un rejet n'est pas une suppression » : https://havecamerawilltravel.com/lightroom/delete-rejected-photos/
   (extraits du moteur de recherche, 10/10/2026).
4. Nielsen, J., « The Power of Defaults », Nielsen Norman Group, 2005 (extrait, cité par `odio.md`).
5. Kurtenbach, G. & Buxton, W., « User Learning and Performance with Marking Menus », CHI '94, p. 258-264 —
   https://research.autodesk.com/app/uploads/2023/03/user-learning-and-performance.pdf_recFBbPwmG7SW9uDe.pdf
6. ComfyUI, réglages LiteGraph (les nœuds proposés quand on relâche une connexion) —
   https://docs.comfy.org/interface/settings/lite-graph ; https://comfyui-wiki.com/en/interface/settings/lite-graph
   (extraits).
7. Higgsfield Supercomputer : « shows the credit cost upfront for you to approve » — `docs/etudes/mode_showrunner.md`
   § 1.1 (ses sources H1-H6).
8. Bolt, R. A., « "Put-that-there": Voice and Gesture at the Graphics Interface », SIGGRAPH '80, p. 262-270
   (DOI 10.1145/800250.807503).
9. Interaction Design Foundation, « Hick's Law » —
   https://ixdf.org/literature/article/hick-s-law-making-the-choice-easier-for-users (extrait).
10. Nielsen Norman Group, « Progressive Disclosure » — https://www.nngroup.com/videos/progressive-disclosure/ (extrait).
11. Figma, « Use the actions menu in Figma Design » (Ctrl+K : les actions, les assets, les plugins) —
    https://help.figma.com/hc/en-us/articles/23570416033943-Use-quick-actions (extrait).
