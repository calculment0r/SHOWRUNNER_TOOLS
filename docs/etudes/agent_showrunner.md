# Étude — l'agent Showrunner dans Idéation (05/10/2026)

Demande de Cal (05/10, « le mode Showrunner ») : « on doit faire une énorme analyse de tous
les documents et pouvoir les organiser déjà dans notre canvas avec l'aide de notre agent, qui
sera toujours disponible dans ce mode studio, comme le Supercomputer de Higgsfield. Cependant,
notre agent peut modifier, ajouter ou organiser des choses sur le canvas, et c'est tout
l'intérêt, car le Supercomputer de Higgsfield a un fil d'assets mais on ne sait pas vraiment ce
qu'il fait ou comment il le fait… Si on demande une génération d'image à partir d'une image
qu'on a déjà sur le canvas, ou qu'on glisse-dépose dans le champ de discussion, il organise un
nœud de création d'image directement. L'agent doit comprendre les docs. » Et pour le champ :
« comme une interface comme Claude : on glisse-dépose des assets dans le champ de saisie de
texte et ils se mettent en vignettes au-dessus. »

## En bref

- **Où** : un panneau « Showrunner » à droite de la planche (bouton de la barre du haut,
  touche `I`), une conversation par planche gardée par le serveur ; le module
  `ideation/agent.js` (+ `agent.css`), le serveur `server/tools/ideation_agent.py`, le faux
  Ollama d'essai `tools/faux_ollama.py`.
- **Le partage du travail** : le serveur appelle Ollama (`/api/chat`, `tools`) et exécute
  lui-même les **outils de lecture** (lire la planche, lire un document, regarder une image,
  chercher dans la bibliothèque) ; il rend les **outils d'écriture** comme des actions
  `{tool, args, why}` que **la page** applique par `app.mutate` — l'annulation (un seul pas par
  tour) et la co-édition passent donc par le chemin ordinaire.
- **Par la file des travaux** (`ideation.agent`), comme le carnet de Transcrire : un modèle de
  30,8 Go à côté d'un rendu H3 de 100 Go dépasse les 128 Go d'un DGX — c'est ce qui a gelé DGX2
  le 24/09. Le prix : un tour attend la fin d'un rendu en cours sur la machine, et la page le dit.
- **Jamais un rendu sans la personne** : une carte Générer est posée prête (prompt, références
  branchées), son bouton orange reste à elle ; seule une demande explicite fait lancer, et
  l'action le dit (« lancée à ta demande »).
- **Rien n'a tourné sur le vrai modèle** : tout est essayé contre un faux Ollama qui rend des
  appels d'outils scénarisés (§ 6). Le premier essai réel est à faire sur DGX2 ; avant, le
  diagnostic **Admin → Diagnostics → « Agent Showrunner »** (`tools/diag_agent.py`) dit si le
  modèle de Cal a `tools` et `vision`.

## 1. Le Supercomputer de Higgsfield

Les pages de Higgsfield, et les articles qui en parlent, sont refusées au robot de cette session
(higgsfield.ai, all-ai.de, postium.ru, popularaitools.ai, creatify.ai : « blocked by the network
egress proxy ») ; ce qui suit est lu dans les extraits du moteur de recherche [1–4].

- **Un agent par la conversation** : « Supercomputer is Higgsfield's agentic workspace: you
  describe what you want in natural language, and the agent plans the task, generates across
  image, video, and audio models, and connects to external apps to complete multi-step work » [1] ;
  « The agent breaks the job into steps, picks the models and presets for each step, shows you
  the credit cost before running anything, and executes on approval » [2].
- **Le point d'arrêt avant de dépenser** : « Before every generation that costs credits,
  Supercomputer pops a checkpoint that includes live credit cost … The credit cost appears
  before generation and requires an Approve button click before anything is spent » [3].
- **Les assets dans la conversation** : « Once an image is generated, you can pin it to a
  Composer panel — basically an in-chat clipboard for assets. From there, ask the agent to
  animate it, restyle it, or build a sequence. Composer items survive between turns and feed
  into downstream skills » [3].
- **La mémoire** : « short-term context for active task execution, long-term knowledge for brand
  identity and style guides that persist across projects, and episodic memory that records
  successful workflows » [4] ; l'accès « through a browser or Telegram » [4].
- **Les modèles** : un routeur (« Hermes ») sur « more than 40 built-in tools » et des modèles
  fermés (« Claude Opus 4.7, GPT-5.5 Pro, and Gemini 3.1 Pro for reasoning ») [4].
- **Le Canvas** de Higgsfield est un autre produit : des nœuds reliés, « keeping the
  relationship between assets visible » [2] (étude `ideation.md` § 1, sources 7 et 8).

Ce que Cal lui reproche est là : le Supercomputer rend des assets dans un fil, on ne voit pas
ses gestes sur une planche. **Ce qu'on reprend** : la conversation qui planifie et choisit les
modèles ; le point d'arrêt avant un rendu (chez nous : la carte posée prête, le bouton reste à
la personne — et pas de crédits : tout est local) ; les assets épinglés au-dessus du champ (la
demande de Cal, comme Claude). **Ce qu'on fait autrement** : chaque geste de l'agent est un
geste de la planche, listé dans la réponse, qu'un clic montre et qu'un bouton défait ; la
mémoire est la planche elle-même et la conversation de la planche (pas de mémoire « de marque »
entre projets : non demandé) ; les modèles sont ceux d'Ollama sur les DGX (règle « tout en
local » de `CLAUDE.md`), pas des modèles fermés.

## 2. Appeler des outils avec Ollama

D'après la documentation d'Ollama, lue dans son dépôt [5–9] (docs.ollama.com et ollama.com sont
refusés au robot ; le dépôt GitHub porte les mêmes pages) :

- **La requête** : `POST /api/chat` avec `tools`, une liste de
  `{"type": "function", "function": {"name", "description", "parameters": <schéma JSON>}}` [5].
- **La réponse** : `message.tool_calls`, une liste de
  `{"function": {"name", "arguments": {…objet…}}}` (avec `index` dans les exemples de plusieurs
  appels) ; plusieurs appels peuvent venir d'un coup (« Parallel tool calling ») [6].
- **Rendre un résultat** : on remet le message de l'assistant tel quel dans l'historique, puis
  un message `{"role": "tool", "tool_name": <nom>, "content": <texte>}` par appel [5, 6].
- **La boucle** : « An agent loop allows the model to decide when to invoke tools and
  incorporate their results into its replies. It also might help to tell the model that it is
  in a loop and can make multiple tool calls » [6]. La boucle s'arrête quand le modèle répond
  sans `tool_calls`.
- **Les images** : un champ `images` du message, des images en base64 (« the REST API expects
  base64-encoded image data ») [5, 8].
- **La pensée** : `think` (`true`, `false`, ou un niveau) ; les capacités d'un modèle se lisent
  par `POST /api/show` (`capabilities`) [7] ; leurs noms : `completion`, `tools`, `vision`,
  `thinking`… [9].
- **Le contexte** : par défaut selon la mémoire (« >= 48 GiB VRAM: 256k context »), et « Tasks
  which require large context like web search, agents, and coding tools should be set to at
  least 64000 tokens » [10].
- **Décharger** : `keep_alive: 0` (déjà employé par le carnet de Transcrire et Admin →
  décharger).

**Quels modèles qwen3 le gèrent.** Qwen recommande pour Qwen3 l'appel d'outils « Hermes-style »,
déjà dans le gabarit du modèle, et déconseille les gabarits à mots d'arrêt (ReAct) pour un modèle
qui pense [11] ; « Tool use with Qwen3 can also be conducted with … llama.cpp, Ollama, etc. » [12].
Qwen3-VL annonce un « Visual Agent » qui « invokes tools » et existe en éditions Instruct et
Thinking, contexte natif de 256K [13]. **Non vérifié ici** : que le `qwen3-vl-32b-32k` de Cal
(un nom de modèle à lui, sur les deux DGX — `orchestration.md` § 2.2 ; 30,8 Go chargé avec 32k de
contexte) ait la capacité `tools` dans son gabarit : la page d'ollama.com qui la liste est
refusée au robot. Le serveur **la lit à chaque fois** (`/api/show`) et refuse un tour, en le
disant, si `tools` manque ; même chose pour `vision` (sans elle, une image citée n'est pas vue, et
l'agent le dit). Qwen prévient : « It is not guaranteed that the model generation will always
follow the protocol even with proper prompting or templates … be prepared that if it breaks,
countermeasures or rectifications are in place » [11] — d'où la validation du § 4.

## 3. Ce qu'Idéation expose déjà (lu dans le code, 05/10)

- `app.mutate(fn)` : un instantané (`app.snap`) puis `fn(S.board)`, puis `commit` (rendu,
  enregistrement, co-édition : `coedition.js` envoie les opérations de chaque commit) ;
  `app.undoStep()` remet l'instantané. Un geste = un instantané : un tour de l'agent est donc
  appliqué **dans un seul `app.mutate`**, avec des fonctions pures dedans.
- Les fonctions pures dont l'agent se sert : `canWire`, `replaces`, `outPort`, `newSlots`,
  `newSlot` (`ports.js`, la seule vérité de ce qui se branche) ; `app.freeSpot`,
  `app.sizeFor`, `app.newMedia` ; `app.groups.make`, `app.groups.shift` (`groups.js`) ;
  `bbox`, `canvas.dispBox`, `canvas.flyTo(zone)`, `canvas.center()`.
- Les gestes qui appellent eux-mêmes `app.mutate` (`addAt`, `wire`, `feed`, `genWith`,
  `frameAround`, `tidy`, `groups.group`) **ne sont pas** appelés par l'agent : chacun prendrait
  son propre pas d'annulation. L'agent refait leur règle avec les fonctions pures : la carte
  Générer image prend Krea 2 si ses références y tiennent, sinon Qwen-Image 2.1 (comme
  `genWith`) ; une référence de la bibliothèque qui n'est pas sur la planche y est posée à
  gauche de la carte et branchée (comme `feed`) ; ranger en grille prend les colonnes de
  `app.tidy`.
- Lancer : `app.gen.generate(id)`, `app.video.generate(id)` — seulement sur demande explicite.
- Les menus : `menus.js` (`node`, `selection`) reçoivent une entrée « Citer dans la discussion ».
- Les dépôts : `dropZone` (fichier du disque → `uploadFile` → bibliothèque, vignette glissée du
  panneau Asset) ; le glisser d'un objet de la planche passe par le geste de déplacement de
  `canvas.js` : lâché sur le champ de l'agent, il est cité et revient à sa place, sans pas
  d'annulation (`app.unsnap`).
- Les événements (`plugins.js`) : `board`, `commit`, `moving`.

## 4. Les décisions

1. **Lire au serveur, écrire à la page.** Le serveur a la planche enregistrée, la bibliothèque,
   le texte des documents, les images : il exécute les lectures dans sa boucle. Les écritures
   sont rendues à la page, qui les applique d'un coup (`app.mutate`) : un pas d'annulation par
   tour, la co-édition, l'enregistrement — le chemin de tous les gestes. Le serveur **valide**
   chaque écriture (les identifiants existent, la sorte va, le modèle prend ce nombre de
   références…) et rend sa raison au modèle quand il refuse (« refusé : n99 n'est pas sur la
   planche ») : le modèle corrige au tour de boucle suivant. Une action rendue est donc toujours
   applicable par construction ; la page refait seulement les règles de place et de fil
   (`canWire`) — un fil refusé est dit dans la ligne de l'action.
2. **Par la file des travaux**, sorte `ideation.agent`, comme le carnet de Transcrire : voie
   `audio`, épinglée sur l'instance de la machine de l'Ollama (le jeton GPU : « un seul travail
   GPU du portail par machine »), famille `ollama-agent`, 31 Go (`orchestration.md` § 2.2 : 30,8
   Go mesurés pour `qwen3-vl-32b-32k` à 32k de contexte), le modèle déchargé à la fin du tour
   (`keep_alive: 0`). Pourquoi pas un appel direct : le modèle tient 30,8 Go **de mémoire GPU**,
   que ni la cgroup ni le tueur OOM ne voient (`orchestration.md` § 3.1) ; à côté d'un rendu H3
   (100 Go) il gèle la machine (DGX2 le 24/09, DGX1 le 24/09). La file est le seul endroit où
   « qui calcule sur quelle machine » se décide. **Le prix** : un tour attend la fin d'un rendu
   en cours sur la machine (H3 : 7 à 15 min) ; la page montre la place (« en file · 1 devant ») et
   « Arrêter ». Un portail sans voie `audio` (le contrôle, une copie d'essai) passe sur la voie
   `cpu`. La garde du calcul : la route juge `see`, puis `jobs._guard` (dans le Workspace de la
   planche), puis `edit` — l'ordre de `lora.py r_train`.
3. **Les outils natifs d'Ollama** pour la conversation ; pour l'analyse d'entrée, les lectures
   par morceaux en **sorties structurées** (`format` : un schéma JSON), comme le carnet : le
   schéma tient la forme, sans boucle.
4. **Jamais un rendu sans la personne** (le point d'arrêt du Supercomputer, § 1) : `lancer` est
   faux par défaut ; la consigne dit de ne le mettre que sur une demande explicite, et l'action
   le dit alors (« lancée à ta demande »). Le bouton de la carte garde sa garde (`gen.why`).
5. **Des identifiants, pas des coordonnées** : l'agent nomme les objets par leurs identifiants
   (ceux de la planche, de la bibliothèque, ou `new:N` pour ce qu'il a posé plus tôt dans le
   tour) et place par `dans` (un cadre) et `pres_de` (un objet) ; la page calcule la place
   (`freeSpot`, empilé dans un cadre qui grandit). Un modèle de langue place mal au pixel.
6. **Le contexte de 32k** (le modèle de Cal) : la planche en résumé borné (7 000 signes, puis
   `lire_planche` par pages), un document par parties de 5 000 signes, la conversation d'avant
   bornée (4 000 signes), les images citées réduites à 1024 px, au plus 4 jointes au message
   (au-delà : `decrire_image`). Ollama conseille 64k pour un agent [10] : une variante 64k
   coûterait plus de mémoire — à décider par Cal (réglage `ideation_agent_ctx`).
7. **La conversation est gardée par planche**, à côté d'elle :
   `<data_dir>/ideation_agent/<planche>.json` (les tours, leurs actions, ce qui a été posé).
   Un tour fini est appliqué **une seule fois** : l'onglet qui l'attend le réclame au serveur
   (`claim`) avant de l'appliquer ; un autre onglet, ou la page rechargée, propose « Poser ces
   gestes » au lieu de les poser deux fois.
8. **Le texte d'un document** : la sorte `document` (`server/tools/documents.py`) —
   `ideation_agent.TEXTE_DOCUMENT` y est rebranché (05/10 soir) : la lecture même de
   `GET /api/library/<id>/texte` (`documents.read_text`, les pages jointes d'une ligne vide). Un
   document sans texte (un scan, un format que le serveur ne lit pas) se lit par ce qu'on en sait
   (`doc.why` compris) et sa couverture est regardée. Un autre objet : son fichier s'il est du
   texte UTF-8, sinon la description d'un élément, le titre et le prompt d'une image. Un document
   ne se pose pas sur la planche tant qu'Idéation ne le sait pas (`ideation.MEDIA_KINDS`) : le
   serveur le refuse au modèle, qui le résume en note.

## 5. Ce qui est fait

### Le serveur (`server/tools/ideation_agent.py`)

| route | |
|---|---|
| `POST /api/ideation/agent {board, messages: [{role: "user", content, items?: [ids]}], intent?: "" \| "ingest"}` | un tour : la garde (see, calcul, edit), le modèle prêt (Ollama répond, le modèle y est, il a `tools`), un seul tour à la fois par planche (409), le tour gardé, le travail `ideation.agent` en file → `{turn, job}` ; à la fin, `job.result` et le tour portent `{reply, actions: [{tool, args, why, id?}], reads}` |
| `GET /api/ideation/agent/<planche>` | la conversation (`turns`), le tour en cours (`busy`), le moteur (`engine` : modèle, prêt, pourquoi) |
| `POST /api/ideation/agent/<planche>/turns/<tour> {claim} \| {applied, ids, results} \| {undone}` | réclamer un tour pour l'appliquer (409 s'il l'est déjà), dire ce qui a été posé, qu'il a été défait |
| `POST /api/ideation/agent/<planche>/clear` | une conversation neuve (l'ancienne est archivée) |

Les outils (les descriptions que lit le modèle sont dans `TOOLS`) :

| lecture (le serveur) | écriture (la page, un geste lisible chacun, avec son `pourquoi`) |
|---|---|
| `lire_planche {cadre?, depuis?}` · `lire_document {id, partie?}` · `decrire_image {id, question?}` · `chercher_bibliotheque {q, sorte?}` | `poser_texte {sorte: note \| postit \| titre, texte, couleur?, dans?, pres_de?}` · `poser_cadre {nom, autour?, dans?}` · `ranger {ids, disposition: rangee \| grille \| colonne, dans?}` · `grouper {ids, nom?}` · `poser_asset {item, dans?, pres_de?}` · `carte_image {prompt, refs?, modele?, format?, nombre?, lancer?}` · `carte_video {prompt, image?, fin?, lancer?}` · `composeur {style?, personnages?, action?, decor?, photographie?, son?, musique?, vers?}` · `relier {de, vers, texte?}` · `renommer_planche {nom}` · `deplacer {ids, dans?, pres_de?, dx?, dy?}` |

### La page (`ideation/agent.js`, `agent.css`) — faite (05/10 soir)

Un greffon (`plugins.js`). Le panneau « Showrunner » : le bouton de la barre du haut (après
« ? », un geste du Studio : `studioSeul`), la touche `I`, la palette ⌘K. Une troisième colonne de
`.ide-main` (360 px) ; sous 1360 px de page, il prend la place de l'inspecteur ; sous 760 px, il
couvre la planche ; caché pendant la présentation. Ouvert ou fermé : retenu par visiteur
(`ide-agent-open`).

- **Le fil** : la demande en bulle à droite (ses pièces en petites vignettes), la réponse en prose,
  « a lu : … » (les lectures du serveur), puis les gestes en lignes numérotées, avec leur
  `pourquoi` ; un tour en cours dit sa place (« en file · 1 devant · départ ≈ 4 min ») ou ce qu'il
  lit (le message du travail), avec « Arrêter » ; un tour en échec ou arrêté : « Reprendre la
  demande » (le texte et les pièces reviennent dans le champ). La conversation est celle de la
  planche (relue à chaque planche ouverte) ; « Nouvelle » (deux clics) l'archive.
- **Le champ** : une boîte arrondie ; au-dessus du texte, les pièces citées en vignettes de 56 px,
  retirables (×) — glissées du panneau Asset ou du disque (`dropZone` : un fichier est d'abord
  rangé dans la bibliothèque), collées (une capture d'écran), prises au « + » (`pick`), « citer la
  sélection · N », « Citer dans la discussion » au clic droit d'un objet ou d'une sélection
  (`menus.js`, `app.agent.menuItems`), ou un objet de la planche glissé jusqu'au champ (il est cité
  et revient à sa place sans pas d'annulation : `app.dropOut` dans `canvas.js`, `app.unsnap`).
  Entrée envoie ; une action éteinte dit pourquoi (le moteur pas prêt, un tour en cours). Le champ
  est gardé par planche le temps de la page.
- **Poser un tour** : à la fin du travail, l'onglet qui l'a envoyé le réclame (`claim`, son jeton)
  puis l'applique dans **un seul `app.mutate`** (`run`) — des fonctions pures (`canWire`,
  `replaces`, `outPort`, `newSlots`, `groups.make`, `groups.shift`, `app.def`, `app.sizeFor`,
  `app.newMedia`), jamais les gestes qui prennent leur propre pas (`addAt`, `wire`, `feed`…) ;
  puis `applied` avec `ids` (new:N → l'objet) et `results` (`{text, ok, ids}` : ce que chaque geste
  a créé). Un tour fini sans être posé (la page fermée, un autre onglet) propose « Poser ces
  gestes ». Ce qui vient d'arriver s'éclaire un instant (sans bouger la vue) ; un clic sur une
  ligne vole jusqu'à ses objets, les choisit et les éclaire (`agFlash`).
- **La place** (décision 5) : `prevoir` calcule d'abord la taille de tout ce que le tour pose (un
  texte mesuré dans la feuille de la planche, une carte à sa hauteur haute — elle suit son contenu
  au rendu) ; un **cadre posé dans le tour** reçoit d'avance la taille de ce qu'on mettra `dans`
  lui (la même grille que le placement : les colonnes d'`app.tidy`, ou celles de `ranger`) ; un
  cadre de la planche grandit à la suite de ce qu'il contient ; `pres_de` cherche une place libre
  à droite de l'objet ; sinon près du centre de la vue, puis à côté du précédent ; une place libre
  compte les cadres (un objet posé dans un cadre en ferait partie). Une carte Générer se met à
  droite de ses références déjà posées ; une référence de la bibliothèque se pose à sa gauche
  (dans un cadre : la place d'avant la carte) ; Krea 2 si ses références y tiennent, sinon
  Qwen-Image 2.1. Un composeur se met à gauche de la carte qu'il nourrit.
- **Annuler ce tour** : un seul `app.mutate`, qui retire ce que le tour a créé (objets, fils,
  flèches), remet ce qu'il a changé de ce qui était là (`x, y, w, h, group` : les déplacés, les
  cadres agrandis, les groupés), les fils qu'il a remplacés, le nom de la planche — même après
  d'autres gestes ; ctrl+Z le remet. Puis « Reposer » (dans la même page : son jeton). Après un
  rechargement, ce que le tour a créé part (le serveur garde `ids` et `results`), ses déplacements
  restent, et le message le dit.
- **Jamais un rendu sans la personne** : une carte est posée prête (« — prête : son bouton
  Générer est à toi ») ; `lancer: true` la lance après la pose, si sa garde (`gen.why`) le permet,
  et la ligne dit « lancée à ta demande » ; un tour reposé ne relance pas.

### Le contrat pour l'agent « Commencer un projet » — exposé (05/10 soir)

```js
app.agent.open()                                              // ouvre le panneau, le champ prend la main
app.agent.send(text, { items = [], pieces = [], intent = '' }) // → Promise<{ turn, reply, actions, results }>
app.agent.busy()                                              // un tour en vol sur cette planche
```

`items` (ou `pieces`, le même ; les deux s'ajoutent) : des identifiants de la bibliothèque, des
objets de la planche, ou des objets `{id}`. La promesse est tenue quand le tour est fini **et posé**
(`results` : une ligne par geste) ; rejetée sur un refus du portail (son message : 400, 409 « un
tour est déjà en cours ») ou un tour en échec ou arrêté. `send` enregistre d'abord la planche
(`app.flushSave`) : l'agent lit celle du serveur. Pour l'analyse d'entrée, le texte au-delà de
4 000 signes est coupé (le reste est dans les documents cités) et le serveur prend jusqu'à 400
objets cités (`MAX_ITEMS_INGEST`) ; il en lit 40, les documents d'abord, et le tour dit combien
il n'a pas lus (`skipped`). Avec `intent: 'ingest'`, le tour est l'**analyse d'entrée** : chaque
document est lu par parties et chaque image regardée (une sortie structurée par partie ou par
image : résumé, thèmes, personnages, lieux, références), puis l'agent organise la planche
(cadres par thème ou par sorte, les documents résumés en notes, les personnages, lieux et
références repérés, une proposition de suite) — la progression se lit dans le fil (« lit
« scénario » · partie 2/4 »). Sans objet cité, l'analyse prend ce qui est posé sur la planche.

## 6. Vérifié, et ce qui reste

**Vérifié (05/10, ce conteneur, sans GPU ni Ollama)** : le selftest de `ideation_agent.py` contre le faux
Ollama (`tools/faux_ollama.py`), 17 contrôles — un tour « une image dans ce style » avec une image citée
rend une action `carte_image` branchée sur elle, `lancer` faux, l'image regardée par le serveur ; Ollama
reçoit les outils, `think: false`, `num_ctx`, la planche, l'objet cité et son image en JPEG base64 ; les
résultats de lecture reviennent en `role: tool` ; le modèle est déchargé ; un tour ne s'applique qu'une
fois (`claim`) ; trois écritures impossibles refusées au modèle avec leur raison ; l'analyse d'entrée
(sortie structurée, puis trois cadres) ; les entrées invalides (400), un modèle sans `tools` (409) ;
`clear`. `tools/check.py` en entier : **2626 passés, 0 en échec** (dont la garde du calcul : la route rejouée par un guest est refusée).

**Vérifié le 05/10 au soir (la page, ce conteneur, contre le faux Ollama)** :
- selftest de `ideation_agent.py` : **22 contrôles** (les 17 d'avant ; le texte d'un document DOCX
  est celui de `GET /api/library/<id>/texte` et « lis ce document » le résume en note ; poser un
  document est refusé au modèle ; 27 objets cités : refusés pour un message, pris pour l'analyse
  d'entrée, le document lu d'abord ; le diagnostic dit `tools` et `vision`, et sort en échec sans
  `tools`) ;
- Playwright (`tools/portail_essai.py 8802` avec `SR_OLLAMA_URL` sur `tools/faux_ollama.py`), dans les
  deux thèmes, sans erreur console : le panneau par `I` ; « Citer dans la discussion » au clic droit ;
  « une image dans ce style » → la carte Générer image posée à droite de l'image, branchée, Krea 2,
  pas lancée, **un seul pas d'annulation** ; le clic sur la ligne choisit la carte ; « Annuler ce
  tour », « Reposer », ctrl+Z ; l'analyse d'entrée par `app.agent.send(texte, { pieces, intent:
  'ingest' })` : trois cadres côte à côte sans chevauchement, chacun à la taille de ce qu'il reçoit ;
  un tour de neuf gestes (carte vidéo branchée sur sa première image, composeur branché sur son
  prompt, flèche, renommer, grouper, un cadre et ce qu'on y met, une carte lancée à la demande),
  défait d'un coup : la planche revient **identique** ; un document glissé du panneau Asset sur le
  champ puis lu ; une note de la planche glissée sur le champ (citée, revenue à sa place, aucun pas
  d'annulation) ; « Poser ces gestes » d'un tour fini sans page ; « Arrêter », « Reprendre la
  demande » ; un modèle sans `tools` : « pas prêt », l'envoi éteint dit pourquoi ; à 1280 px, le
  panneau à la place de l'inspecteur.
- le pilote du dépôt, à relancer après une fusion : `ideation/pilote_agent.mjs` (l'essai ci-dessus en
  12 contrôles par thème, sombre et clair ; la commande est dans son en-tête) — 24 / 24.

**Reste** :
1. **Rien n'a tourné sur le vrai modèle** : lancer Admin → Diagnostics → « Agent Showrunner » sur DGX2
   (`qwen3-vl-32b-32k` a-t-il `tools` et `vision` ? son `num_ctx`), puis un premier tour réel : la
   qualité de ses appels d'outils, ses temps (chargement à chaque tour, `keep_alive: 0`).
2. Un tour attend la fin d'un rendu sur la machine de l'Ollama : à revoir avec Cal (priorité haute pour un
   tour court ? l'Ollama de l'autre DGX quand celui-ci rend ?). Contexte 32k contre 64k conseillés [10] :
   **à faire trancher par Cal** (réglage `ideation_agent_ctx`).
3. La page ne suit pas en direct les tours lancés par quelqu'un d'autre sur la planche : elle relit la
   conversation toutes les 2,5 s tant qu'un tour tourne et que le panneau est ouvert.
4. Les étiquettes de deux cadres posés côte à côte peuvent se chevaucher de loin (le nom d'un cadre
   grossit quand on dézoome : `canvas.js`, `.fr-h`) ; les cadres eux-mêmes ne se chevauchent pas.


## Sources

1. Higgsfield, « How do I use Supercomputer », https://higgsfield.ai/creator-hub/help-center/tools-and-workflows/how-do-i-use-supercomputer (page refusée au robot ; extraits du moteur de recherche, 05/10/2026)
2. Higgsfield, « Higgsfield Supercomputer guide », https://higgsfield.ai/blog/higgsfield-supercomputer-guide, et « Higgsfield Canvas Review », https://dreamina.capcut.com/ai-video/higgsfield-canvas (extraits du moteur de recherche)
3. Résultats de recherche « Higgsfield Supercomputer assets panel … approval » : help center, guide, https://popularaitools.ai/blog/higgsfield-supercomputer-review/, https://creatify.ai/blog/higgsfield-ai-review-(2026)-is-it-worth-it (pages refusées au robot ; extraits)
4. https://www.bitsminds.com/news/higgsfield-supercomputer-cloud-native-ai-agent-2026, https://postium.ru/higgsfield-predstavila-supercomputer/, https://sourceforge.net/software/product/Higgsfield-Supercomputer/alternatives (extraits)
5. Ollama, « API » (§ Generate a chat completion : `tools`, `tool_calls`, `tool_name`, `images`, `think`, `keep_alive`), https://github.com/ollama/ollama/blob/main/docs/api.md, lu le 05/10/2026
6. Ollama, « Tool calling » (un outil, en parallèle, la boucle d'agent, en flux), https://github.com/ollama/ollama/blob/main/docs/capabilities/tool-calling.mdx
7. Ollama, « Thinking », https://github.com/ollama/ollama/blob/main/docs/capabilities/thinking.mdx
8. Ollama, « Vision », https://github.com/ollama/ollama/blob/main/docs/capabilities/vision.mdx
9. Ollama, `types/model/capability.go` (les noms des capacités), https://github.com/ollama/ollama/blob/main/types/model/capability.go
10. Ollama, « Context length », https://github.com/ollama/ollama/blob/main/docs/context-length.mdx
11. Qwen, « Function Calling » (Qwen3), https://github.com/QwenLM/Qwen3/blob/main/docs/source/framework/function_call.md
12. Qwen3, README (« Tool Use »), https://github.com/QwenLM/Qwen3/blob/main/README.md
13. Qwen3-VL, README (« Visual Agent », éditions Instruct et Thinking, contexte, hyperparamètres), https://github.com/QwenLM/Qwen3-VL/blob/main/README.md
