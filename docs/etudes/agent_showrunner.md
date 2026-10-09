# Étude — l'agent Showrunner dans Idéation (05/10/2026)

> **09/10** : la suite (routeur, politique de conversation, skills, registre des capacités, premier lot) est dans `agent_autonome.md`, qui consolide cette étude sans la remplacer.

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
- **06/10, après le premier essai réel de Cal** (§ 7) : l'entrée d'un projet accuse réception (l'inventaire
  compté par le code), comprend en UN appel sur le début des documents, dit ce qui ne colle pas, pose 3 à 5
  questions à choix, puis propose un plan court qu'on accepte, et fait une étape à la fois. Les images et les sons
  arrivent par paliers, en arrière-plan, sur l'autre DGX si on veut. Le carnet garde les décisions. La première
  réponse passe de 44 appels à 1 (faux Ollama).
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
**Remplacé le 06/10** (§ 7) : rien n'est posé à l'entrée ; la réception, la compréhension et les questions d'abord.
`send` prend aussi `brief` (les pièces qui sont le brief) ; les tours `plan` et `etape` passent par la page de
l'agent (ses boutons), pas par ce contrat.

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


## 7. 06/10 : le premier essai réel, ce qui change

### 7.1 Ce que Cal a vu

Premier essai de « Commencer un projet » sur DGX2, avec `qwen3-vl-32b-32k`. Cal avait déposé exprès des documents
hétéroclites et un brief sans rapport avec eux. Ses mots, résumés :

- l'agent est « super lent et assez con » ;
- il a pris tous les documents et a voulu tout organiser avec des post-it et des cartes ;
- il a même fait un cadre « Vidéo » avec les sons dedans ;
- il aurait dû dire « c'est bon, j'ai tous les documents » et poser des questions avant de tout faire d'une seule
  passe, ce qui est pénible à corriger : « on ne veut justement pas submerger l'utilisateur avec une production
  énorme de mauvaise qualité qui l'oblige à faire plein de corrections ».

### 7.2 Les causes, lues dans le code

- **L'avalanche venait de NOTRE consigne**, pas seulement du modèle. `INGEST_TASK` demandait, mot pour mot :
  - une note par document, avec son résumé ;
  - les personnages, les lieux et les références en post-it, dans des cadres ;
  - les images rangées dans des cadres ;
  - une note des prochaines étapes.
- **La lenteur venait de la lecture par morceaux.** `ingest` lisait chaque document par morceaux de 9 000 signes
  (jusqu'à 8 par document, 40 documents), avec un appel au modèle par morceau, puis un appel de fusion, puis une
  boucle d'outils.
  - Ce sont des dizaines d'appels séquentiels à un modèle dense de 32 milliards de paramètres.
  - Sur un GB10, un modèle dense de cette taille écrit environ 9 jetons par seconde : Ollama mesure 9,411 jetons/s
    pour `qwen3:32b` en q4_K_M [17]. La raison : chaque jeton relit tous les poids, et la mémoire du Spark débite
    273 Go/s [18].
- **Le cadre « Vidéos » avec des sons** : c'était le serveur, pas l'agent.
  - `core/library.py` donnait la sorte d'un fichier par son extension seule (`EXT_KIND` : `.webm` et `.mp4` →
    vidéo), sans regarder ce qu'il contient.
  - La mise en page de `projet.js` range ensuite par `item.kind`.
  - Un mémo vocal en `.webm`, une voix off en `.mp4` partaient donc dans « Vidéos ».
  - Corrigé à la racine (commit dc8a29c) : `add_file` lit le contenu (ffprobe) avant de donner la sorte ; un
    conteneur vidéo sans piste d'image est un son ; une pochette (`attached_pic`) n'est pas une piste d'image.

### 7.3 La conduite neuve : recevoir, comprendre, demander, proposer peu, faire pas à pas

Le principe de Cal, et ceux de *Fondations II* [14] qui s'y appliquent (document interne de Cal, pas dans le dépôt :
repris ici en substance) :

- **Le poste et son occupant.** Ce qui est décidé appartient au projet et reste quand l'occupant change. Ici, le
  carnet est gardé avec la conversation de la planche, pas dans le modèle : changer de modèle ne perd aucune
  décision.
- **La scripte.** Quelqu'un note les décisions, et les relit. Ici, le carnet.
- **Les contradictions dites à voix haute**, pas lissées. Un assistant seul suit la dernière instruction ; une
  contradiction doit au contraire être signalée, avec les deux versions.
- **Le droit de dire non**, ou de dire ce que ça coûte.
- **Ne pas faire la moyenne** de deux choses qui s'excluent.
- **Peu de postes allumés pour une pub.** Une pub de 30 s n'a pas besoin de toute la machinerie : un plan court,
  peu d'étapes, rien de plus que ce qui est demandé.

Le parcours (`server/tools/ideation_agent.py`, `ideation/agent.js`), par paliers (l'idée de Cal du 06/10 : « une
restitution par paliers, avec déjà des choses qui arrivent rapidement… on peut discuter pendant qu'on analyse le son
ou les vidéos ») :

| palier | qui le fait | quand | ce qui s'affiche | ce qui se pose sur la planche |
|---|---|---|---|---|
| 0. **réception** | le code (`inventaire`) | dans la réponse de la route : immédiat | « J'ai bien reçu 12 pièces : 7 documents (dont le brief), 2 images, 1 vidéo et 2 sons. » et la liste à déplier | la mise en page de départ de `projet.js` seule (les cadres par sorte, sans les mélanger) |
| 1. **texte** | UN appel au modèle du texte, sortie structurée (`INGEST_TASK`, `INGEST_SCHEMA`) | dès que la file le prend | ce qu'il comprend (3 à 5 lignes), ce qui ne colle pas (en ambre), 3 à 5 questions à choix cliquables, « autre » en texte libre | rien |
| 2a. **images** | un travail `ideation.palier` : le modèle qui voit, sur SA machine, en un appel (8 images au plus, 448 px ; une vidéo en trois images côte à côte) | en arrière-plan, priorité basse | une ligne (« Les 4 images sont… ») et ce qu'est chaque pièce ; il peut ajouter UNE question à la carte | rien |
| 2b. **sons** | Transcrire (mode rapide, puis son résumé), un travail par son ou piste son de vidéo (8 au plus, 15 min chacun) | en arrière-plan, priorité basse | une ligne (« Les 2 sons : transcrits… ») avec le résumé de chacun | rien |
| 3. **plan** | UN appel, sortie structurée (`PLAN_TASK`, `PLAN_SCHEMA`) | après les réponses, ou « Vas-y sans répondre » | 1 à 4 étapes, chacune dit ce qu'elle posera ; Accepter, Changer, Refuser | rien |
| 4. **étapes** | la boucle d'outils, UNE étape (`ETAPE_TASK`), 12 gestes et 6 appels au plus | une à la fois, dans l'ordre, sur le clic de la personne | la réponse, les gestes ; « Faire cette étape » pour la suivante | les quelques objets de l'étape, annulables d'un geste (« Annuler ce tour ») |

Détails qui font que c'est juste par construction :

- **Les schémas tiennent les bornes.** 3 à 5 questions, 2 à 5 choix, 1 à 4 étapes, une question au plus par palier :
  c'est le schéma JSON de la sortie structurée qui l'impose, pas un filtre après coup.
- **Les réponses vont au carnet par le code.** Chaque réponse cliquée est notée telle quelle (« Quel est le
  livrable ? → Un film de 30 s ») ; c'est un fait de la personne, pas une interprétation du modèle. Le plan accepté
  ou refusé y est noté aussi. Le modèle n'ajoute que ce qu'il entend en texte libre (`decisions` du plan,
  `noter_decision` dans la conversation).
- **Une étape à la fois, dans l'ordre.** Le serveur refuse l'étape 2 avant la 1 (409). Une étape défaite est à
  refaire. Un plan neuf remplace l'ancien s'il n'était pas fini.
- **Lecture bornée.** Le début de chaque document : 700 signes, 16 000 en tout, 40 documents. Le reste se lit par
  `lire_document`, plus tard, quand c'est utile ou demandé. Le brief rangé en document (`brief.md`, le document coché)
  est compté, pas relu : son texte est déjà le message.
- **La consigne de tous les tours** (`system_prompt`) dit maintenant :
  - peu de gestes, jamais une note par document ;
  - le carnet tient tant que la personne ne le change pas ;
  - une demande qui contredit une décision est dite à voix haute, les deux citées, au lieu d'être suivie en
    silence ;
  - pas de moyenne entre deux choses incompatibles.
- **Le carnet est dans le panneau, pas sur la planche.** C'est le plus simple :
  - gardé avec la conversation (`decisions`) ;
  - relu par chaque tour (`<decisions>`) ;
  - lisible et corrigible en haut du panneau (retirer une décision, en écrire une).

  Une note épinglée sur la planche aurait été co-éditée, défaite avec un tour, et elle aurait été une production
  de plus sur la planche.

### 7.4 Les deux DGX

Cal (06/10) : « on ne pourrait pas optimiser en lançant des trucs différents sur les deux DGX ?… un modèle plus léger
pour les textes et un plus compliqué pour les vidéos ».

Ce que fait déjà la file (`core/jobs.py`) :

- un seul travail GPU du portail par machine (le jeton GPU) ;
- un travail est épinglé sur l'instance de sa voie qui est sur la machine où il calcule ;
- `ideation.agent` est sur la voie `audio`, épinglé sur la machine de l'Ollama, famille `ollama-agent`, 31 Go.

Les paliers sont des travaux SÉPARÉS de la file. Ils peuvent partir en parallèle sur les deux machines, sans jamais
charger deux gros modèles sur la même :

- **Le texte** (`ideation.agent`) : `ideation_agent_url` et `ideation_agent_modele`, comme avant.
- **Les images** (`ideation.palier`) : `ideation_agent_vision_url` et `ideation_agent_vision_modele` (sinon ceux du
  texte), et `ideation_agent_vision_gb` (la mémoire déclarée d'un autre modèle, sinon 31).
  - `route_vision` les épingle sur l'instance de la voie `audio` de la machine de la vision (le jeton GPU de CETTE
    machine).
  - Si cette machine n'a pas d'instance dans la voie `audio`, les images passent sur la machine du texte, après lui,
    et la ligne du palier le dit.
- **Les sons** : Transcrire, dans sa voie (son texte sur la machine du portail, son résumé par son Ollama :
  `qwen3:30b-a3b` par défaut, le modèle léger, déjà là).
  - `ideation_agent_sons` vaut `auto` par défaut : seulement si Transcrire est réglé en local. En factice, ses textes
    seraient des textes d'essai, et la ligne le dit.
- **Les paliers sont en priorité basse** : un tour de conversation passe devant eux. La règle « pas doublé plus de 3
  fois » (`max_overtake`) leur garantit de partir quand même.
- **Les défauts marchent aujourd'hui** avec le seul modèle installé : `qwen3-vl-32b-32k` fait le texte et la vision,
  sur DGX2, l'un après l'autre. Le jeton GPU les sérialise, et chaque travail décharge le modèle à la fin.

Pour paralléliser : si la voie `audio` de DGX2 a une instance sur DGX1 (à lire dans `showrunner.local.json`, le
diagnostic le dit), régler `ideation_agent_vision_url: "http://169.254.110.6:11434"`. Le modèle est sur les deux DGX
(`orchestration.md` § 2.2). Les images partent alors sur DGX1 pendant que le texte tourne sur DGX2.

### 7.5 Mesuré contre le faux Ollama

L'entrée de 12 documents hétéroclites (un scénario de 90 000 signes, un chapitre de roman, deux PDF, deux DOCX, un
CSV, un JSON, des sous-titres…), 3 images, 2 sons (dont un `.webm`), 1 vidéo, et un brief sans rapport. Le script
d'essai est hors du dépôt (`mesure.py`). Il lance le portail dans un processus, avec le faux Ollama du dépôt, dans
l'état d'avant (9b90f07) et d'après.

| | avant | après |
|---|---|---|
| appels au modèle pour la première réponse | 44 (40 sorties structurées + 4 tours de boucle d'outils) : la première réponse EST la fin | **1** |
| signes de texte envoyés pour la première réponse | 280 837 (≈ 70 000 jetons à 4 signes le jeton) | **12 450** (≈ 3 100 jetons) |
| plafond de sortie demandé (`num_predict` × appels) | 180 224 jetons | 4 096 |
| images jointes | 4, à 1024 px (≈ 1 024 jetons chacune pour Qwen3-VL : un jeton par carré de 32 px, `agent_design.md` § 4.4) | 4 au palier des images, à 448 px (≈ 200 jetons ; la bande d'une vidéo ≈ 300) |
| appels en tout, paliers compris | 44 | 2 (le texte, les images) ; les sons passent par Transcrire |
| gestes posés sans qu'on ait rien demandé | 32 | **0** |
| questions posées | 0 | 5 (dont la contradiction brief / documents, et une du palier des images) |

Avec 2 s par appel au faux Ollama (pour voir le temps) :

| | première réponse utile | les images arrivent | les sons arrivent |
|---|---|---|---|
| avant | 88 s (44 appels) | — | — |
| après, un seul Ollama, un ouvrier (une seule machine) | 2,0 s | 4,3 s | 7,6 s |
| après, deux Ollama (le second pour la vision), deux ouvriers (deux machines) | 2,0 s | 2,4 s | 4,2 s |

Les paliers arrivent pendant la conversation : à la première réponse, la mesure les trouve tous deux « en cours ».
Le contrôle (`conduite` dans le selftest) vérifie que la question ajoutée par le palier des images arrive dans la
carte tant qu'on n'y a pas répondu, et que le plan lit ce que les paliers ont appris (`<background>`).

Ce que coûtera le vrai modèle (une **estimation** à partir des débits publiés, pas une mesure) :

- La réponse de l'entrée fait quelques centaines de jetons : ce qu'il comprend, ce qui ne colle pas, 3 à 5 questions.
- À environ 9 jetons/s pour un dense de 32 B [17], cela fait de l'ordre de la minute, plus le chargement du modèle.
- Avant, c'était 44 appels de cette sorte.

### 7.6 Des modèles plus rapides, et meilleurs aux outils, sur un GB10 : ce que disent les sources

Décision de Cal : rien n'est téléchargé, rien n'est changé. Ce qui suit est pour sa décision.

Pourquoi un modèle à experts (MoE) est plus rapide sur un Spark :

- Le débit d'écriture est borné par la mémoire : 273 Go/s [18].
- Un modèle dense de 32 B en q4 relit environ 20 Go à chaque jeton.
- Un modèle à experts ne lit que ses paramètres actifs, environ 3 B pour un 30B-A3B.

| modèle | paramètres (actifs) | sur les DGX | vitesse publiée sur un DGX Spark | outils | voit | contexte | licence |
|---|---|---|---|---|---|---|---|
| `qwen3-vl-32b-32k` (aujourd'hui) | 32 B dense [21] | les deux, 20,9 Go en Q4_K_M, 30,8 Go chargé à 32k (`orchestration.md` § 2.2) | même famille de taille : `qwen3:32b` q4_K_M, **9,4 jetons/s** en écriture, 705 en lecture (Ollama 0.12.6) [17] | oui (gabarit à vérifier par le diagnostic, § 6) | oui | 256K natif [21] ; 32k réglés | Apache-2.0 [21] |
| **`qwen3:30b-a3b`** | 30,5 B (**3,3 B**) [23] | **les deux, 18 Go** (`transcrire.md` § 1) ; c'est le modèle du carnet de Transcrire | Qwen3-Coder-30B-A3B (la même architecture) en Q8_0 : **61 jetons/s** en écriture, 2 987 en lecture ; 30 à 32k de contexte : 30 jetons/s (llama.cpp, build 7941 ; `llama-bench -fa 1 -p 2048 -n 32` [16]) [15] | oui : appel d'outils « Hermes » dans le gabarit (§ 2 [11][12]) | **non** | 32 768 natif [23] | Apache-2.0 [23] |
| `qwen3-vl:30b` (Qwen3-VL-30B-A3B) | ≈ 30 B (≈ 3 B) [21] ; 31,1 B dans la fiche d'Ollama [22] | **absent** (un téléchargement de 20 Go [22]) | non publiée trouvée ; même architecture 30B-A3B : de l'ordre de la ligne au-dessus, **à mesurer** | « Visual Agent » [21] | **oui** | 256K natif [21][22] | Apache-2.0 [21] |
| `gpt-oss:20b` | 21 B (**3,6 B**) [19] | absent (« tient dans 16 Go » [19]) | **83 jetons/s** en écriture, 4 506 en lecture (llama.cpp) [15] ; 58,3 / 3 224 (Ollama 0.12.6) [17] ; 49,7 / 2 053 (Ollama, LMSYS) [24] | oui : appel de fonctions, sorties structurées, effort de raisonnement réglable [19] | non (rien sur les images dans le README [19]) | 128k (131 072), d'après des sources secondaires [20] | Apache-2.0 [19] |
| `gpt-oss:120b` | 117 B (**5,1 B**) [19] | **DGX1, 65,4 Go** (`orchestration.md` § 3.2) | **58,7 jetons/s** en écriture, 2 444 en lecture (llama.cpp) [15] ; 41,1 / 1 169 (Ollama 0.12.6) [17] | oui [19] | non | 128k [20] | Apache-2.0 [19] |
| `mistral-small3.2:24b` | 24 B dense | les deux, 15 Go (`transcrire.md`) | dense : de l'ordre d'un 27 B dense, `gemma3:27b` q4_K_M 10,8 jetons/s (Ollama) [17] | « améliore l'appel de fonctions » (`agent_design.md` [25]) | oui (`agent_design.md` [25]) | 128k (`agent_design.md` [25]) | Apache-2.0 (`transcrire.md` [MS]) |

Les vitesses viennent de moteurs et de quantifications différents. Elles disent un ordre de grandeur : un modèle à
experts écrit 6 à 9 fois plus vite qu'un dense de 32 B sur la même machine. Ce n'est pas une mesure sur nos DGX.
La justesse de l'appel d'outils de ces modèles côte à côte n'est pas lue ici (le classement BFCL est refusé au robot)
: elle est à mesurer sur notre banc.

**Recommandation pour Cal** (rien à télécharger pour les points 1 et 2) :

1. **Garder la conduite neuve quel que soit le modèle.** C'est elle qui supprime l'avalanche et les dizaines
   d'appels.
2. **Essayer `qwen3:30b-a3b` pour le texte**, sur DGX2, en gardant `qwen3-vl-32b-32k` pour les images :
   `ideation_agent_modele: "qwen3:30b-a3b"`, `ideation_agent_vision_modele: "qwen3-vl-32b-32k"`.
   - Il est déjà sur les deux DGX et sert déjà au carnet de Transcrire.
   - Il écrirait environ 6 fois plus vite d'après les sources [15][17].
   - Il ne voit pas, mais le texte n'a plus besoin de voir : les images ont leur palier.
   - À vérifier d'abord par le diagnostic : sa capacité `tools` dans l'Ollama de DGX2.
   - Les deux modèles ne sont jamais chargés ensemble sur une machine : le jeton GPU, et le déchargement à la fin
     de chaque travail.
3. **Les images sur DGX1** si sa voie `audio` y a une instance (`ideation_agent_vision_url`, § 7.4).
4. **Plus tard, si Cal le décide** (un téléchargement de 20 Go) : `qwen3-vl:30b`, le même genre de modèle à experts,
   qui voit et appelle des outils. Il remplacerait les deux, à vitesse de modèle à experts.
   - `gpt-oss` (déjà sur DGX1 en 120b) est rapide et fait des sorties structurées, mais il ne voit pas.
   - Le 120b prend 65 Go : il ne cohabite pas avec un rendu H3 sur DGX1.

### 7.7 À vérifier sur les vraies machines

1. **Admin → Diagnostics → « Agent Showrunner »** (`tools/diag_agent.py`) dit maintenant aussi :
   - où partent les images (le modèle, la machine, l'épinglage, s'il voit) ;
   - si les sons seront transcrits (`ideation_agent_sons`, Transcrire en local ou non).
2. **Le temps de la première réponse sur DGX2.** Il est écrit dans chaque tour (« N s » sous la réponse ; `seconds`
   et `calls` dans la conversation). Le chargement du modèle compte dedans (non mesuré).
3. **La tenue des schémas par le vrai modèle**, avec les sorties structurées d'Ollama : 3 à 5 questions, des choix
   concrets, la contradiction vue sur le jeu d'essai de Cal (un brief sans rapport et des documents hétéroclites).
4. **Si `qwen3:30b-a3b` est essayé** : `tools` au diagnostic, puis le même jeu d'essai ; comparer les questions et
   le plan aux mêmes avec `qwen3-vl-32b-32k`.
5. **Chaque travail décharge son modèle** (`keep_alive: 0`). Trois travaux de suite sur une machine rechargent
   donc le modèle trois fois. C'est le prix de la sûreté à côté d'un rendu H3 (§ 4.2) : à mesurer avant de
   l'optimiser.


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
14. Fondations II — « Le poste et son occupant » (document de Cal, 16/09/2026) : document interne, pas dans le dépôt ; repris en substance au § 7.3
15. ggml-org/llama.cpp, `benches/dgx-spark/dgx-spark.md` (build 11fb327bf, 7941), https://github.com/ggml-org/llama.cpp/blob/master/benches/dgx-spark/dgx-spark.md, lu le 06/10/2026
16. ggml-org/llama.cpp, discussion 16578 « Performance of llama.cpp on NVIDIA DGX Spark » (14/10/2025, mise à jour jusqu'au 05/02/2026), https://github.com/ggml-org/llama.cpp/discussions/16578 (lu)
17. Ollama, « NVIDIA DGX Spark performance » (Ollama 0.12.6, micrologiciel 580.95.05), https://ollama.com/blog/nvidia-spark-performance (refusé au robot ; extraits du moteur de recherche, 06/10/2026)
18. La bande passante du DGX Spark, 273 Go/s, 128 Go LPDDR5x unifiés : PNY (partenaire de NVIDIA), https://www.pny.com/dgx-spark, et StorageReview, https://www.storagereview.com/review/nvidia-dgx-spark-review-the-ai-appliance-bringing-datacenter-capabilities-to-desktops (extraits du moteur de recherche)
19. openai/gpt-oss, README, https://github.com/openai/gpt-oss (lu : paramètres, mémoire, licence, MXFP4, appel de fonctions, sorties structurées, effort de raisonnement)
20. Le contexte de gpt-oss, 128k (131 072 jetons) : sources secondaires, https://intuitionlabs.ai/articles/openai-gpt-oss-open-weight-models, https://console.groq.com/docs/model/openai/gpt-oss-20b (extraits ; la fiche de Hugging Face est refusée au robot)
21. QwenLM/Qwen3-VL, README, https://github.com/QwenLM/Qwen3-VL (lu le 06/10/2026 : tailles 2B, 4B, 8B, 32B denses, 30B-A3B et 235B-A22B à experts ; Instruct et Thinking ; 256K natif ; Apache-2.0 ; « Visual Agent »)
22. Ollama, bibliothèque, `qwen3-vl:30b`, https://ollama.com/library/qwen3-vl:30b (refusé au robot ; extrait : 20 Go, 256K, texte et image, qwen3vlmoe 31,1 B, Q4_K_M)
23. Qwen, `Qwen3-30B-A3B`, https://huggingface.co/Qwen/Qwen3-30B-A3B (cité par `transcrire.md` [Q] : 30,5 B dont 3,3 B actifs, Apache-2.0 ; « 32,768 natively » : `server/tools/transcrire.py`, CARNET_MODELS)
24. LMSYS, « NVIDIA DGX Spark In-Depth Review » (13/10/2025), https://www.lmsys.org/blog/2025-10-13-nvidia-dgx-spark/ (refusé au robot ; extraits du moteur de recherche)
