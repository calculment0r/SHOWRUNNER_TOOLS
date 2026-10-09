# Étude — l'agent autonome du mode Showrunner (09/10/2026)

Demande de Cal (09/10) : « on doit aussi avancer sur le mode showrunner, on doit refaire une grosse étude de comment
notre agent va réagir en fonction de ce que le user lui demande : on doit sûrement développer des skills et construire
notre mode agentique pour que l'agent puisse faire du storyboard, analyser des docs… pour qu'il soit autonome et puisse
fabriquer de super slides etc. On a déjà fait plein d'études de cela donc il faut éclaircir et commencer à vraiment
travailler dessus. » Plus tard le même jour : « il va falloir qu'on comprenne ce que veut l'utilisateur et donc comment
aiguiller des demandes vers des workflows dispo ; exemple : le user demande d'enlever une personne ou un objet dans une
scène, on doit pouvoir comprendre si on utilise LTX 2.5 ou MiniMax H3 avec ce LoRA (akatz-ai/MiniMax-H3-Person-Remover-
LoRA) » ; « on aura besoin d'un super chat bot ». Le 06/10, sur l'agent actuel : « super lent et assez con… il aurait dû
me poser des questions avant… on ne submerge pas le user » ; « un modèle plus léger pour les textes et un plus compliqué
pour les vidéos… restitution par paliers ».

**Statut** : étude ; son lot 1 (§ 9) est codé le 09/10 (« Fait le 09/10 — lot 1 », en fin d'étude). Rien n'est téléchargé. Elle **consolide**, sans les remplacer :
`agent_showrunner.md` (l'agent d'Idéation, 05-06/10), `agent_design.md` (D1-D10, 06/10), `mode_showrunner.md`
(« Commencer un projet »), `orchestration.md` § 1 (un modèle de langue à l'entrée) et `presentations_motion.md` § 5 (la
passe assistée). Deux études voisines, écrites en même temps, rempliront le registre des capacités (§ 5.6) :
`veille_1009.md` (les modèles et skills à venir) et `objet_scenes_3d.md` (objets et scènes 3D) — renvois, pas
d'attente.

## Résumé pour Cal (une page)

**Ce qu'on a.** Un agent dans Idéation (`server/tools/ideation_agent.py`, `ideation/agent.js`) : un panneau façon
Claude, une conversation par planche, des lectures faites par le serveur, des gestes validés puis posés par la page en
un seul pas d'annulation, jamais un rendu sans la personne. Depuis le 06/10, l'entrée d'un projet accuse réception,
pose ses questions, propose un plan court, fait une étape à la fois, et regarde images et sons en arrière-plan. **Rien
n'a été mesuré sur le vrai modèle** : un seul essai de Cal, avant la conduite neuve ; tout le reste contre un faux
Ollama.

**Pourquoi il est lent** (lu dans le code, § 1.3) : un modèle dense de 32 B (≈ 9 jetons/s sur un DGX Spark) ; à chaque
appel 14 400 signes fixes (16 outils et la consigne) plus la planche, l'historique et jusqu'à 4 images ; jusqu'à 12
appels par tour ; le modèle **déchargé à la fin de chaque tour** ; chaque tour passe par la file et attend la fin de
tout rendu de la machine (H3 : 7 à 15 min), et en partant il **vide la ComfyUI** de DGX2 (la voie `audio` est son
:8188) — le rendu d'image suivant recharge son modèle.

**Pourquoi il est « con »** (§ 1.4) : il ne connaît du portail que la planche. Un seul gros prompt, 16 outils pour
toute demande, aucune idée de ce que savent faire Vidéo, Montage, Transcrire, ni de ce qui n'est pas branché : à
« enlève cette personne », il n'a ni outil ni connaissance. Rien ne l'oblige à demander avant d'agir hors de
l'entrée d'un projet ; et à l'entrée, le schéma l'oblige à poser au moins 3 questions même quand tout est dit.

**Ce que je propose.** Garder les rails (lire au serveur, poser en un geste annulable, la file, les paliers, le
carnet). Changer la conduite :

1. **L'accueil est du code** : l'accusé de réception part dans la réponse de la route, en moins d'une seconde (ce
   qui est reçu, ce qui va se passer, la place dans la file).
2. **Un routeur** classe la demande dans un **vocabulaire fermé d'intentions** (une sortie structurée, un appel
   court).
3. **Une politique de conversation écrite en code** (une machine à états, pas le modèle) décide : répondre, demander
   (3 questions au plus, tirées du registre), choisir un workflow, dire « je ne sais pas faire » et proposer
   l'approchant, proposer un plan, exécuter une étape.
4. **Des skills** : un dossier par savoir-faire (instructions, outils permis, contrat de sortie), chargés par le code
   selon l'intention — jamais 16 outils à la fois.
5. **Un registre des capacités** : chaque workflow du portail (intention → workflows candidats → critères → entrées →
   sortie → état branché ou non, coût, licence), que le routeur et la politique consultent. Le registre de musique
   d'ODIO (`intentions` de `musique/generatif_modeles.json`) en est déjà un petit.
6. **Le modèle propose des données, le code fait les gestes** : un storyboard est un découpage structuré que la
   personne corrige et valide ; le code pose les cadres et les cartes, exactement.

**Le premier lot** (§ 9, prêt à coder) : le registre, la politique et **la skill storyboard** de bout en bout (pas les
slides : elles attendent les décisions D1-D10, la licence des polices et le rendu par Chromium).

**À décider** (§ 10, recommandations entre parenthèses) : les modèles par DGX (texte `qwen3:30b-a3b` sur DGX2, la
vision sur DGX1, un gros modèle texte plus tard) ; garder le modèle chargé entre deux tours (après mesure) ; le
projet = le Workspace (le carnet et la conversation y vivent) ; le consentement par plan, coût affiché ; storyboard
d'abord ; LTX-2.5 avant le LoRA d'H3 pour retirer une personne (licence UE) ; D1-D10.

## 1. État des lieux

### 1.1 Ce qui existe (lu dans le code le 09/10)

| pièce | où | ce qu'elle fait |
|---|---|---|
| la route d'un tour | `server/tools/ideation_agent.py` `r_turn` | `POST /api/ideation/agent {board, messages, intent: '' \| ingest \| plan \| etape}` : la garde (voir, calcul, écrire), le modèle prêt (`/api/show` : `tools`), un tour à la fois par planche (409), le tour écrit, le travail `ideation.agent` en file ; `ingest` rend tout de suite la réception (`inventaire`, compté par le code) et lance les paliers |
| le travail | `run_turn` | selon l'intention : `intake` (1 appel, sortie structurée `INGEST_SCHEMA`), `plan_turn` (1 appel, `PLAN_SCHEMA`), `etape_turn` (la boucle, 6 appels et 12 gestes au plus), `converse` (la boucle, 12 appels et 60 gestes au plus) |
| la boucle | `loop` | Ollama `/api/chat` avec `tools` ; lectures exécutées au serveur (`lire_planche`, `lire_document`, `decrire_image`, `chercher_bibliotheque`), écritures validées (`Gestes.add`) et rendues en actions `{tool, args, why, id?}`, `noter_decision` au carnet ; un refus revient au modèle avec sa raison |
| le moteur | `Moteur` | `think: false` si le modèle pense, `num_ctx` 32 768, `num_predict` 4 096, `keep_alive: "2m"` par appel, **déchargé à la fin du travail** (`unload`, `keep_alive: 0`) ; garde `prompt_eval_count`, rien d'autre des temps d'Ollama |
| les paliers | `lancer_paliers`, `run_palier` | les images (et 3 images par vidéo) regardées en UN appel du modèle qui voit, sur sa machine (`route_vision`) ; les sons par Transcrire (mode rapide + résumé) ; priorité basse ; une ligne chacun, une question au plus |
| le carnet | `add_decisions`, `r_decisions` | les décisions de la conversation : les réponses cliquées (par le code), le plan accepté ou refusé, `noter_decision`, à la main ; relu à chaque tour (`<decisions>`) |
| la page | `ideation/agent.js` (1 248 lignes) | le panneau, le champ et ses pièces, les cartes (réception, questions, plan, étapes, paliers), le carnet ; un tour posé en UN `app.mutate` après `claim` ; « Annuler ce tour », « Reposer » ; relit la conversation toutes les 2,5 s quand quelque chose tourne |
| l'entrée d'un projet | `ideation/projet.js` | « Commencer un projet » : la Team, le Workspace, la planche, les fichiers, puis `app.agent.send(brief, {intent: 'ingest'})` |
| le diagnostic | `tools/diag_agent.py`, Admin → Diagnostics → « Agent Showrunner » | `tools`, `vision`, `num_ctx`, la route des images, les sons |
| l'essai | `tools/faux_ollama.py`, selftest d'`ideation_agent.py` (`conduite`), `ideation/pilote_agent.mjs`, `ideation/pilote_projet.mjs` | des appels d'outils scénarisés, des sorties conformes au schéma ; vérifie la FORME, jamais la qualité |
| la passe assistée | `ideation/presentation/assist.js` | cinq règles écrites (`agent_design.md` § 1.1), pas un modèle |
| l'assistant de Vidéo | `server/tools/movie.py` `r_assist` | 501 : « le modèle de texte du portail (llm_url) viendra ensuite » (décision de Cal du 28/09) |

Les outils du modèle (`tools_spec`) : 4 lectures, 11 écritures sur la planche (`poser_texte`, `poser_cadre`, `ranger`,
`grouper`, `poser_asset`, `carte_image`, `carte_video`, `composeur`, `relier`, `renommer_planche`, `deplacer`), 1 au
carnet. **Aucun outil hors de la planche** : ni Image, ni Vidéo (sauf poser une carte), ni Montage, ni Transcrire, ni
Movie Analysis, ni Asset au-delà d'une recherche par mots.

### 1.2 Ce qui est décidé, ce qui ne l'a jamais été, ce qui se contredit

**Décidé par Cal** (dans les études et REPRISE) : tout en local, pas d'API de modèle payante (`CLAUDE.md`) ; l'agent
travaille SUR la planche et ses gestes se voient (05/10) ; un seul champ façon Claude (05/10) ; « Commencer un projet »
crée une Team et son Workspace « Général » (05/10) ; ne pas submerger, demander avant, une restitution par paliers, les
deux DGX (06/10) ; rien n'est téléchargé ni changé sans son accord (06/10).

**Proposé, jamais tranché** :

| question | où | état |
|---|---|---|
| le modèle de la conversation | REPRISE § 2.A, `agent_showrunner.md` § 7.6 | `qwen3:30b-a3b` proposé, `qwen3-vl-32b-32k` en place |
| 32k ou 64k de contexte | `agent_showrunner.md` § 4.6, D4 d'`agent_design.md`, REPRISE § 2.D | Ollama conseille 64 000 au moins pour un agent ; 32k en place |
| un tour qui attend la fin d'un rendu sur sa machine | `agent_showrunner.md` § 6, REPRISE § 2.D | non tranché |
| les images sur DGX1 | `agent_showrunner.md` § 7.4 | possible si la voie `audio` y a une instance : non lu |
| l'agent design, D1 à D10 | `agent_design.md` § 5 | dix recommandations, aucune décision |
| un assistant de demande dans Cloudflare Workers AI | `orchestration.md`, décision 9 | « plus tard, oui ou non » |
| la licence des polices (bloque le PDF des slides) | REPRISE § 2.D | bloquant |

**Ce qui se contredit** :

1. **Un modèle ou deux.** `agent_design.md` (D3) recommande `qwen3-vl-32b-32k` seul (il voit et appelle des outils) ;
   `agent_showrunner.md` § 7.6 et REPRISE § 2.A proposent `qwen3:30b-a3b` pour le texte et le modèle qui voit pour
   les images seulement. Les deux sont écrits le 06/10. Cette étude tranche pour le second (§ 5.7) : la vision n'est
   utile qu'aux paliers et au regard d'une diapositive.
2. **Où vit le modèle qui comprend une demande.** `orchestration.md` § 1.3 le plaçait hors des DGX (Workers AI : « s'il
   en faut un, il ne tourne pas sur un DGX »), contre la règle « Ni Workers AI » de `cloudflare.md` § 6.2 et contre
   « tout en local ». Depuis le 05/10, l'agent est câblé sur l'Ollama de DGX2, par la file : la pratique a tranché sans
   que Cal tranche. À confirmer (§ 10, A11).
3. **Qui charge une compétence.** `agent_design.md` § 3.1 fait lire au modèle le corps d'une compétence par un outil
   (`lire_competence`) ; cette étude fait charger la skill **par le code**, d'après l'intention routée (§ 5.5) : un
   petit modèle choisit mal parmi beaucoup d'outils (BFCL, § 2.2), et une skill qu'on ne charge pas ne peut pas
   déborder.
4. **« Autonome » contre « jamais un rendu sans la personne ».** Le 09/10, Cal veut un agent autonome ; depuis le
   05/10, chaque carte Générer attend le clic de la personne. Proposition (§ 3.1) : l'autonomie s'exerce **dans un plan
   validé**, dont le coût est affiché ; le consentement se donne une fois pour le plan, pas carte par carte.
5. **Le nombre de questions.** Le principe « on ne submerge pas » contre `INGEST_SCHEMA` : `"minItems": 3` oblige à
   poser au moins 3 questions même quand le brief dit tout. Corrigé par construction au § 5.4 (les questions viennent
   des entrées qui manquent : zéro si rien ne manque).
6. **La portée de la mémoire.** Le projet est une Team et son Workspace (`mode_showrunner.md`) ; le carnet et la
   conversation sont gardés **par planche**. Un projet à deux planches a deux carnets. § 5.9.

### 1.3 Pourquoi il est lent : les causes dans le code, les ordres de grandeur

Aucune mesure sur le vrai modèle n'existe (le code ne garde pas `load_duration`, `prompt_eval_duration`,
`eval_duration`, que rend Ollama). Ce qui suit est lu dans le code ; les secondes sont des **estimations** à partir des
débits publiés pour un DGX Spark (`agent_showrunner.md` § 7.6 : 9,4 jetons/s en écriture et 705 en lecture pour un
dense de 32 B ; 61 et 2 987 pour un 30B-A3B), à 4 signes par jeton.

| cause | lu où | ce que ça coûte (estimation) |
|---|---|---|
| un modèle **dense de 32 B** pour tout | `model_name()` : `qwen3-vl-32b-32k` | ≈ 9 jetons/s : une réponse de 200 jetons ≈ 20 s ; un appel d'outil de 100 jetons ≈ 11 s |
| un préambule fixe lourd à **chaque** appel | `system_prompt()` 3 423 signes + `tools_spec()` 10 953 signes (16 outils), mesurés le 09/10 | ≈ 3 600 jetons avant tout contenu |
| le contenu de chaque tour | `board_digest` ≤ 7 000 signes, `history` ≤ 4 000, carnet ≤ 3 000, projet, jusqu'à 4 images à 1 024 px (≈ 1 024 jetons chacune) | jusqu'à ≈ 11 000 jetons à lire : ≈ 16 s au premier appel |
| la boucle | `MAX_STEPS = 12` | chaque appel d'outil est une génération de plus |
| `decrire_image` en plein tour | `Lectures.run` : un autre `chat`, une autre consigne | casse probablement le cache de préfixe d'Ollama (non mesuré) |
| **le modèle déchargé à la fin de chaque travail** | `run_turn`, `run_palier` : `finally: m.unload()` | 20,9 Go relus à chaque tour, puis au palier des images ; le temps de chargement n'est pas mesuré |
| **la file** : un seul travail GPU du portail par machine | `jobs.register("ideation.agent", …, gpu=real, family="ollama-agent")`, `gpu_jobs_per_machine` | un tour attend la fin de tout rendu de DGX2 (H3 : 7 à 15 min) |
| **la ComfyUI vidée** en partant | voie `audio` = ComfyUI :8188 de DGX2 (`config.py`, `transcrire.md`) ; `jobs._preflight` : `if machines.loaded(ep) != "": machines.free_instance(ep)` (`core/jobs.py:1150`) | le rendu d'image suivant recharge son modèle (Krea 2 : 58 s à froid, chargement compris, `orchestration.md` § 2.2) |
| le relevé de la page | `agent.js` : 2,5 s ; la file : 1,5 s | jusqu'à 2,5 s entre la fin et l'affichage |

L'entrée d'un projet est déjà passée de 44 appels à 1 pour la première réponse (`agent_showrunner.md` § 7.5) ; une
conversation libre reste une boucle longue sur un modèle lent, derrière la file.

### 1.4 Pourquoi il est « con » : les causes

1. **L'avalanche venait de notre consigne** (corrigé le 06/10 : `INGEST_TASK` demandait une note par document).
2. **Son monde est la planche.** Il ne sait rien des autres outils ni de ce qui n'est pas branché. Ses seules
   connaissances de modèles : la liste d'Image (`MODELS`). Pour « enlève la personne de ce plan », il n'a aucun outil
   ni aucune règle : il poserait une carte Vidéo avec un prompt, ou une note.
3. **Un seul prompt généraliste et 16 outils** pour toute demande, « que vois-tu ? » comme « range ces images » : le
   modèle choisit à chaque fois parmi tout. Les petits modèles tiennent un appel isolé, pas une longue conversation
   d'outils (BFCL, § 2.2).
4. **Demander n'est qu'une phrase** hors de l'entrée d'un projet (« ask one short question instead of guessing ») : rien
   ne l'y oblige. Et à l'entrée, l'inverse : au moins 3 questions imposées.
5. **Le plan est du texte libre** (`pose`), réinterprété par la boucle de l'étape : rien ne garantit que l'étape fait
   ce que le plan disait.
6. **Du bruit dans le contexte** : la planche lui est donnée avec des coordonnées (`@x,y w×h`) qu'il ne doit jamais
   employer ; une planche entière pour une question qui ne la touche pas.
7. **La pensée coupée** (`think: false`) sur un modèle à qui l'on demande de planifier plusieurs gestes.
8. **Aucune évaluation de la justesse** : le faux Ollama vérifie la forme ; le seul essai réel (06/10) précède la
   conduite neuve.

### 1.5 Ce qu'on garde, ce qu'on jette

| on garde | on change | on jette |
|---|---|---|
| lire au serveur, poser par la page en UN `app.mutate`, « Annuler ce tour » | le routage : une intention d'abord, puis une skill | les 16 outils offerts à toute demande |
| des identifiants, jamais des coordonnées (décision 5) | les questions : tirées des entrées qui manquent, 0 à 3 | `minItems: 3` des questions de l'entrée |
| la file, le jeton GPU, les paliers en priorité basse | le modèle de la conversation (§ 5.7) ; garder le modèle chargé quand la machine ne rend rien (après mesure) | le déchargement systématique sans mesure |
| la réception comptée par le code | l'accusé immédiat pour TOUTE demande, pas seulement l'entrée | — |
| le carnet, les réponses notées par le code | sa portée : le Workspace (le projet) | — |
| le plan court, une étape à la fois, dans l'ordre | le plan devient des données (une skill, des étapes typées), pas un texte libre | `pose` interprété par la boucle |
| jamais un rendu hors de ce que la personne a accepté | le consentement par plan, coût affiché | — |
| le faux Ollama, `conduite`, les pilotes | un banc rejouable avec des cas attendus (§ 7) | — |
| la passe assistée, sans modèle | — | — |

## 2. État de l'art

Lu le 09/10 quand la page s'ouvre au robot (« lu »), sinon dans les extraits du moteur de recherche (« extraits ») :
Hugging Face, ltx.io, comfyui-wiki.com et gorilla.cs.berkeley.edu ne répondent pas depuis ce conteneur.

### 2.1 Les skills

- **Le format Agent Skills** (lu [1]) : un dossier par compétence, un `SKILL.md` (en tête YAML `name`, 1 à 64 signes en
  minuscules, chiffres et traits d'union, égal au nom du dossier ; `description`, 1 à 1 024 signes, « what the skill
  does and when to use it »), facultatifs `license`, `compatibility`, `metadata`, `allowed-tools` (« experimental »),
  et les dossiers `scripts/`, `references/`, `assets/`.
- **Le chargement progressif** [1] : le nom et la description de chaque skill au départ (« about 100 tokens ») ; le corps
  à l'activation (« under 5,000 tokens recommended », « Keep your main SKILL.md under 500 lines ») ; les fichiers
  joints seulement s'il le faut.
- **Les autres** : les skills d'équipe de Figma, une place de marché de skills chez Higgsfield (`agent_design.md` § 2) ;
  PPTAgent publie une « PPTAgent Skill » pour les agents de code (« Create, revise, and visually review editable
  PowerPoint decks », lu [13]) ; Ming-Image publierait une « Image-to-Editable-PPT Skill » et une « Ling UI Design
  Skill » : examinées par `veille_1009.md`.
- **Ce qu'on en tire** : une skill est un **dossier de données**, pas du code chargé au hasard. Chez nous, un script
  d'une skill externe ne s'exécute jamais tel quel : il devient un travail de la file, déclaré au registre (§ 5.5).

### 2.2 Appeler des outils avec des modèles locaux

- **Ollama** (`agent_showrunner.md` § 2, sources [5]-[10] lues le 05/10) : `tools`, `tool_calls`, la boucle,
  `format` (un schéma JSON), `think`, `keep_alive`, `/api/show` et ses `capabilities`. Les sorties structurées
  (lu [4]) : « Provide a JSON schema to the `format` field » ; conseils : redonner le schéma en texte dans la consigne,
  température 0 ; « Vision models accept the same `format` parameter ». **Rien pour forcer un appel d'outil** : ni
  cette page ni `docs/api.md` (relu le 09/10 [5]) ne documentent de `tool_choice`. Chaque réponse rend ses temps
  (`load_duration`, `prompt_eval_duration` — « evaluating uncached prompt tokens » —, `eval_count`, `eval_duration`, en
  nanosecondes) [5].
- **vLLM** (lu [3]) : `tool_choice` `auto`, `required`, `none` ou une fonction nommée ; nommée ou `required` passent par
  les sorties structurées : « You are guaranteed a validly-parsable function call - not a high-quality one » ; en
  `auto`, « arguments may occasionally be malformed ». Analyseurs : `hermes` (Qwen), `openai` (gpt-oss).
- **La fiabilité selon la taille** (BFCL V4, `orchestration.md` § 1.2 [12]) : Qwen3-4B réussit 87,9 % des appels isolés
  mais 22,1 % en plusieurs tours ; Llama-3.2-3B 82,7 % et 4,0 %. BFCL V4 mesure aussi la recherche, la mémoire et la
  sensibilité au format (lu [12]).
- **Qwen** déconseille les gabarits à mots d'arrêt (ReAct) pour un modèle qui pense et recommande l'appel d'outils
  « Hermes » de son gabarit (`agent_showrunner.md` [11]).
- **Ce qu'on en tire** : une sortie structurée garantit la FORME (une intention parmi une liste, un découpage borné),
  jamais la justesse ; le multi-tours est là où les petits modèles cassent. Donc : **des appels isolés à schéma**,
  peu d'outils par appel, et l'enchaînement tenu par le code.

### 2.3 Routeur, planificateur et exécutant, ReAct, machines à états

- **Anthropic, « Building effective agents »** (lu [2]) : distingue les *workflows* (des chemins écrits d'avance) des
  *agents* (le modèle mène ses outils) ; « we recommend finding the simplest solution possible, and only increasing
  complexity when needed » ; parmi les motifs : le **routage** (classer, puis une consigne, un outil ou un modèle
  spécialisés ; « send simpler requests to cheaper models »), l'enchaînement de consignes avec des contrôles par le
  code entre deux, l'orchestrateur et ses exécutants, l'évaluateur. Et : « Tool definitions and specifications should
  be given just as much prompt engineering attention as your overall prompts » ; rendre les erreurs difficiles par la
  forme des arguments.
- **Un routeur sans génération** : semantic-router (lu [8]) classe par proximité d'embeddings avec des phrases
  d'exemple par route (« Rather than waiting for slow LLM generations to make tool-use decisions… »), en local
  possible ; Ollama sert des embeddings (`POST /api/embed`, vecteurs normalisés ; modèles cités : `embeddinggemma`,
  `qwen3-embedding`, `all-minilm`, lu [5]) — **aucun n'est relevé sur nos DGX**.
- **Planificateur puis exécutant** (LangChain, extraits [10]) : le gros modèle ne planifie et ne conclut, les étapes
  partent sans lui ou avec un modèle léger ; le défaut avoué : plus d'appels, et un plan rigide si le monde change
  (d'où une replanification).
- **Machines à états** : StateFlow (NeurIPS 2024, extraits [9]) sépare la conduite (des états et des transitions,
  « heuristic rules or decisions made by the LLM ») de la tâche (des actions dans un état) ; il bat ReAct de 13 % sur
  InterCode SQL et de 28 % sur ALFWorld, « with 5× and 3× less LLM inference cost » (GPT-3.5).
- **Ce qu'on en tire** : routeur (vocabulaire fermé) → **politique en code** (états, transitions) → skills (des
  appels courts à schéma). Le modèle ne décide jamais seul de produire.

### 2.4 MCP

La spécification (lu [7], 2025-06-18) : JSON-RPC 2.0 entre hôtes, clients et serveurs ; un serveur offre des
*resources*, des *prompts* et des *tools* ; le client offre *sampling*, *roots*, *elicitation* (« Server-initiated
requests for additional information from users »). Sécurité : « Users must explicitly consent to and understand all
data access and operations » ; « Tools represent arbitrary code execution ». PPTAgent sert un serveur MCP (lu [13]).

**Pour nous** : pas dans les premiers lots. Le registre (§ 5.6) est écrit pour qu'une façade MCP en soit une lecture
(chaque capacité branchée = un outil avec son schéma d'entrées), le jour où un agent extérieur doit piloter le portail.

### 2.5 La mémoire de projet

- Le Supercomputer de Higgsfield distingue un contexte court, une mémoire longue de marque et une mémoire
  « épisodique » des workflows réussis (`agent_showrunner.md` § 1 [4], extraits).
- Chez nous, aujourd'hui : la planche, la conversation de la planche (bornée à 4 000 signes dans le message), le carnet
  (relu à chaque tour). Pas de mémoire entre projets (« non demandé », `agent_showrunner.md` § 1).
- **Ce qu'on en tire** : une fiche projet structurée, écrite par le code d'après ce que la personne a choisi (§ 5.9),
  plutôt qu'un magasin de vecteurs ; l'embedding servira la recherche dans Asset (§ 6), pas la mémoire.

### 2.6 Évaluer un agent

- **τ-bench** (lu [11], et l'article, extraits) : un utilisateur simulé, des outils et une politique du domaine ; la
  mesure **pass^k**, la probabilité que les k essais d'une même tâche réussissent tous — contre pass@k (au moins un) ;
  le classement du dépôt montre des scores qui baissent de Pass^1 à Pass^4.
- **BFCL** sépare l'appel isolé du multi-tours (§ 2.2) ; **PPTEval** juge un deck sur « Content, Design, and Coherence »
  (lu [13]).
- **Ce qu'on en tire** : un banc de cas rejouables, chacun avec ce qu'on attend du comportement (§ 7), joué k fois sur
  le vrai modèle : la régularité compte autant que la réussite.

### 2.7 Les produits du domaine

| produit | ce qui est documenté | source |
|---|---|---|
| **LTX Studio** (storyboard) | un texte ou un script découpé en scènes et plans ; **la revue du découpage avant tout rendu** (« edit the structure before any image is rendered ») ; une case se refait seule ; les personnages, objets et lieux extraits en « Elements » réutilisés (@) | [15] (pages de l'éditeur, extraits) |
| **Gamma** (slides) | un plan (une entrée par carte : titre et points) proposé et corrigé AVANT de générer le deck | [16] (tiers, extraits) |
| **PPTAgent / DeepPresenter** | édition à partir de diapositives de référence ; un modèle qui voit relit ; un environnement de 20+ outils ; une skill et un serveur MCP | [13] (lu) |
| **Presenton** | générateur open source (Apache-2.0) avec Ollama, PPTX ou PDF, gabarits, une API | [14] (lu) |
| **Descript Underlord** (montage) | un co-monteur en conversation qui lit le script et la vidéo, enchaîne premier montage, habillage, plans de coupe ; « un stagiaire trop zélé » sans direction claire (avis d'utilisateur) | [17] (extraits) |
| **Higgsfield Supercomputer** | plan, choix des modèles, coût affiché, point d'arrêt avant de dépenser | `agent_showrunner.md` § 1 |
| **LTX-2.5 Clean Plate IC-LoRA** (VFX) | retire personnes et sujets mobiles d'une vidéo **sans masque** et reconstruit le fond ; côtés multiples de 32, 8k+1 images ; le gabarit encode le son (une piste muette sinon) ; une variante d'inpainting **avec masque** pour un objet | [19] (extraits) |
| **MiniMax H3 Person Remover LoRA** (VFX) | « experimental » ; H3 Ref2VA vidéo → vidéo ; la personne suivie par SAM 3.1, le masque rempli de vert ; la vidéo d'origine **et sa première image nettoyée** ; la personne décrite (« man in gray shirt ») ; 24 i/s, côtés multiples de 32, un plan continu de ≈ 5 s ; 155 Mo, 2 000 pas ; licence MiniMax H3 | [18] (extraits) |

Le motif commun : **une revue avant de produire** (le découpage, le plan, le coût), puis une production qu'on refait
case par case.

### 2.8 Ce qui marche de 8 à 125 B en local

| | mesuré ou publié | source |
|---|---|---|
| écrire vite | un modèle à experts (3 à 5 B actifs) écrit 6 à 9 fois plus vite qu'un dense de 32 B sur un Spark (273 Go/s) | `agent_showrunner.md` § 7.6 |
| appeler un outil isolé | ≈ 88 % dès 4 B | BFCL, § 2.2 |
| tenir plusieurs tours d'outils | s'effondre chez les petits : 22 % à 4 B, 4 % à 3 B ; de 8 à 32 B : non relevé ici | BFCL, § 2.2 |
| tenir une forme | garanti par la sortie structurée, quelle que soit la taille | [3][4] |
| voir | `qwen3-vl-32b-32k` sur les deux DGX ; `qwen3-vl:30b` (à experts) absent | `agent_showrunner.md` § 7.6 |
| un gros modèle texte | `gpt-oss:120b` (65,4 Go) sur DGX1 ; un 125 B NVFP4 à experts annoncé, servi par vLLM ou TensorRT-LLM : **à vérifier** (`veille_1009.md`) ; vLLM absent de DGX1 (`transcrire.md`) | |

Conclusion pratique : **un modèle à experts de 30 B pour converser et remplir des schémas, le code pour enchaîner,
la vision à part, un gros modèle seulement pour lire long** (un scénario entier) — s'il se confirme.

## 3. Le comportement

### 3.1 Les règles

1. **Accuser réception tout de suite, par le code.** Dans la réponse de la route : ce qui est reçu (le texte, les
   pièces comptées par sorte), où (l'outil, la planche, la sélection), ce qui va se passer et quand (la place dans la
   file, ce qui occupe la machine : `_auto_message`), « Arrêter ». Cible : moins d'une seconde.
2. **Comprendre avant d'agir** : une intention du vocabulaire fermé, et ses entrées. Une entrée requise manque : une
   question. **3 questions au plus par tour**, à choix cliquables, la plus utile d'abord ; jamais ce que le texte, le
   carnet ou la fiche projet disent déjà ; 0 si rien ne manque.
3. **Produire passe par un plan validé** : tout ce qui coûte du GPU, ou pose plus de 3 objets, est d'abord proposé
   (les étapes, ce que chacune posera, le coût estimé) ; rien ne part avant « Accepter ». Une petite retouche
   réversible (ranger, renommer, une note demandée) se fait tout de suite.
4. **Livrer par paliers** : ce qui est rapide d'abord (le texte), puis ce qui se calcule (images, sons, rendus) en
   arrière-plan, chacun annoncé en une ligne ; on peut parler pendant ce temps.
5. **Dire ce qu'on ne sait pas faire** : une intention sans workflow branché le dit, nomme ce qui manque (un modèle à
   télécharger, un réglage) et propose l'approchant branché.
6. **Plusieurs workflows conviennent** : le code compare leurs critères aux entrées connues ; s'ils départagent, il
   choisit et dit pourquoi ; sinon il demande, avec sa recommandation.
7. **Une demande qui contredit le carnet** est dite à voix haute, les deux citées ; on demande laquelle tient.

**Ce qu'il ne fait jamais** : submerger (jamais une note par document, jamais plus que le plan) ; un cadre incohérent
(une sorte est celle du portail, lue dans le contenu, jamais devinée) ; une production en masse sans accord ; un rendu
hors du plan accepté ; inventer une capacité ; suivre en silence une demande qui contredit une décision.

### 3.2 Demande → réaction

« P » : la politique (le code) ; « M » : un appel au modèle.

| demande | accusé (code, < 1 s) | comprendre | questions | plan avant de produire ? | paliers | jamais |
|---|---|---|---|---|---|---|
| **vague** : « fais-moi un truc pour la sortie du clip » | « Reçu. Je regarde ce que tu veux faire. » | M : intention `projet.creer`, clarté vague | 1 à 3 : le livrable (image, vidéo courte, storyboard, présentation, « propose-moi des pistes »), la durée ou le format, le ton | oui | — | produire avant d'avoir le livrable |
| **précise** : « une image de la danseuse sous la pluie, 16:9, avec cette référence » | « Reçu : 1 image citée. » | M : `image.creer`, entrées remplies | 0 | non pour **poser** la carte (une carte prête ne coûte rien) ; le rendu reste à son bouton, ou dans le plan accepté | — | lancer sans le clic |
| **document à analyser** : « lis ce scénario, qu'en penses-tu ? » | « Reçu : 1 document (PDF, 42 pages). » | M : `document.analyser` | 0, ou la portée si le texte dépasse ce qu'un appel lit (« tout, ou une séquence ? ») | non : une réponse dans le fil ; une note seulement si demandée | les parties lues s'annoncent | une note par document |
| **storyboard** : « fais le storyboard de la séquence 3 » | « Reçu : le scénario cité. » | M : `storyboard.creer` ; P : la séquence 3 trouvée par le code (§ 9.4) | 0 à 3 : nombre de plans, format, rendu des cases | **oui** : le découpage (plans, valeurs, durées, prompts) se corrige et se valide avant tout geste | 1. le découpage ; 2. la planche posée ; 3. les images, sur consentement | poser une case avant la validation du découpage |
| **slides** : « fais-moi la présentation client » | « Reçu. » | M : `slides.creer` | 0 à 3 : le public, la durée, le modèle de présentation | **oui** : le plan des diapositives (titre et points) avant de poser | 1. le plan ; 2. les diapositives dans un modèle ; 3. la passe assistée | réécrire des textes sans demande (D9) |
| **recherche Asset** : « retrouve les repérages de nuit » | « Je cherche dans la bibliothèque. » | M : `asset.chercher` (les mots) ; P : la recherche | 0 | non : des vignettes dans le fil, « poser sur la planche » au clic | — | poser ce qu'on n'a pas demandé |
| **modification** : « rends le titre plus court » / « range ces images en grille » | « Reçu : 1 objet cité. » | M : `planche.retoucher` | 0 (l'objet est cité) ; 1 si rien n'est cité ni sélectionné (« lequel ? ») | non (réversible, ≤ 3 objets) | — | toucher à ce qui n'est pas désigné |
| **hors capacités** : « publie-le sur Instagram » | « Reçu. » | M : `autre` | 0 | — | — | prétendre le faire ; P répond : ce n'est pas dans le portail, voici l'export (MP4, PDF, lien d'écoute) |
| **enlever une personne d'une scène** | « Reçu : 1 vidéo citée (6,2 s, 24 i/s). » | M : `vfx.retirer` ; P : le registre (§ 3.3) | 0 à 2 : qui retirer s'il y a plusieurs personnes ; ce qui doit rester | **oui** (un rendu vidéo) | 1. le choix du workflow et le plan ; 2. la première image nettoyée (si H3) ; 3. le rendu | lancer un rendu de plusieurs minutes sans accord ; promettre un workflow non installé |
| **contradiction** : « fais-le en 60 s » quand le carnet dit « 30 s » | « Reçu. » | P : le carnet | 1 : « Le carnet dit 30 s, tu demandes 60 s : lequel tient ? » | — | — | suivre la dernière en silence |

### 3.3 Enlever une personne ou un objet : choisir le workflow

Ce que disent les sources (§ 2.7), rangé en critères que le code compare :

| critère | LTX-2.5 Clean Plate IC-LoRA | H3 + Person Remover LoRA | image fixe : Image → Consigne |
|---|---|---|---|
| ce qu'il retire | les personnes et **tous** les sujets mobiles, sans masque [19] | **une** personne désignée, suivie (SAM 3.1) [18] | ce que dit la consigne, une zone peinte le borne (`image.EDIT_TOOLS["instruct"]`) |
| entrées | la vidéo (côtés ÷ 32, 8k+1 images, une piste son) | la vidéo (24 i/s, côtés ÷ 32, ≈ 5 s continus) + **sa première image nettoyée** + la personne décrite | une image (et une zone) |
| un objet immobile | non (il vise ce qui bouge) ; la variante **avec masque** d'LTX | non (« person ») | oui |
| plan long, coupes | non documenté | « long clips drift and hard cuts break » (le LoRA voisin, [20]) | — |
| licence | non lue (pages refusées) : à vérifier | licence MiniMax H3, qui exclurait l'UE (le LoRA voisin, [20]) ; REPRISE § 2.D : « H3 non licencié dans l'UE » | Qwen-Image 2.1 non commercial (REPRISE § 2.D) ; Krea 2 |
| installé | **non** (seuls les upscalers latents LTX sont relevés, `upscale.md`) | **non** (H3 oui, le LoRA et SAM 3.1 non relevés) | **oui** |
| essai | aucun | aucun | branché, retirer une personne non mesuré |

La règle (dans les critères du registre, § 5.6) :

1. Une **image** citée → Image, Consigne (branché).
2. Une **vidéo**, et tout ce qui bouge doit partir → LTX Clean Plate.
3. Une vidéo, **une personne parmi d'autres** → H3 Person Remover ; il demande la première image nettoyée : la skill la
   prépare elle-même par Image → Consigne (une étape du plan, validée).
4. Un **objet immobile** → l'inpainting LTX avec masque (son fichier et sa compatibilité avec LTX-2.5 : à vérifier
   [19]).
5. Le projet est **commercial dans l'UE** (la fiche projet) → H3 écarté, en le disant.
6. **Rien d'installé** (aujourd'hui) → « Je ne sais pas encore retirer quelqu'un d'une vidéo ici : ni LTX-2.5 Clean
   Plate ni le LoRA d'H3 ne sont installés (un téléchargement, avec ton accord). Je peux nettoyer une image fixe — par
   exemple la première image du plan. »

### 3.4 Dialogues d'exemple

**Vague.**
> — fais-moi un truc pour la sortie du clip
> — *(tout de suite)* Reçu. Je regarde ce que tu veux faire.
> — *(quelques secondes)* Pour la sortie du clip, il me manque deux choses. **Quoi ?** [une affiche] [un teaser vidéo]
> [un storyboard du teaser] [propose-moi des pistes] · **Format ?** [9:16] [16:9] [1:1]
> — *(clic : un teaser vidéo, 9:16)*
> — Noté au carnet : teaser vidéo, 9:16. Je propose : 1) un découpage de 4 plans à valider ; 2) les 4 premières images,
> prêtes ; 3) les plans vidéo (H3, ≈ 4 × 7 min sur DGX2). [Accepter] [Changer] [Refuser]

**Storyboard.**
> — fais le storyboard de la séquence 3 *(le scénario cité)*
> — *(tout de suite)* Reçu : 1 document (Fountain, 96 pages). Je trouve la séquence 3 : « EXT. QUAI — NUIT », 2 pages.
> — Combien de plans, à peu près ? [6] [12] [selon le texte] · Les cases : [crayonné] [photoréaliste]
> — *(clic : selon le texte, photoréaliste)*
> — Voici le découpage : 9 plans, 1 min 05 au total. *(un tableau : n°, valeur, mouvement, durée, action, dialogue ;
> fusionner, couper, supprimer, réécrire une ligne)* [Valider le découpage]
> — *(validé)* Posé : un cadre « Séquence 3 », 9 cases, 9 cartes Générer prêtes (Krea 2 ; l'élément de Lina branché
> sur ses 4 cases). [Lancer les 9 images · ≈ 5 min sur DGX2]

**Retirer une personne.**
> — enlève le passant en rouge *(une vidéo citée, 8 s, trois personnes)*
> — *(tout de suite)* Reçu : 1 vidéo (8,0 s, 24 i/s).
> — Je ne sais pas encore le faire sur une vidéo ici : le LoRA « Person Remover » d'H3 (une personne parmi d'autres,
> c'est ton cas) n'est pas installé, et H3 n'est pas licencié dans l'UE. Je peux nettoyer une image fixe tout de suite.
> [Nettoyer la première image] [Ce qu'il faudrait installer]

**Contradiction.**
> — on part sur 60 s
> — Le carnet dit « Durée : 30 s » (ta réponse du 06/10). 60 s ou 30 s ? [60 s, je change] [30 s, je garde]

## 4. Le chatbot comme livrable

- **L'accusé** : toujours, en moins d'une seconde, par le code (§ 3.1).
- **Les questions** : des cartes à choix (déjà faites : `questionsEl` d'`agent.js`), « autre » en texte libre ; au plus
  3 ; chaque réponse va au carnet par le code.
- **La mémoire** : le carnet et la fiche projet, lisibles et corrigibles en haut du panneau (§ 5.9).
- **Le ton** : celui du portail — tutoiement, phrases courtes, en français, sans émoticône ; il dit ce qu'il a fait, ce
  qu'il n'a pas fait, ce qui suit ; il ne flatte pas, ne s'excuse pas en boucle ; il nomme un modèle ou une machine
  quand c'est utile (« H3 sur DGX2, ≈ 7 min »). Un nom ou des rôles incarnés : décision A8.
- **La reprise de session** : à l'ouverture du panneau, une ligne écrite par le code — « Où on en est : plan
  « Teaser » accepté, étape 2/3 à faire ; les 4 images sont arrivées pendant ton absence ; une question ouverte. »
  Elle se lit dans la conversation, les paliers, la file (`sr:job`) : aucun appel au modèle.
- **Multi-tours dans les outils** : aujourd'hui l'agent n'est que dans Idéation. Lot 3 (§ 8) : le même panneau dans
  chaque outil (un module commun monté par `mountHeader`, comme le panneau Asset), qui reçoit le contexte de l'outil
  (la sélection, le document ouvert) et ses gestes — et la même conversation de projet.

## 5. L'architecture

### 5.1 Vue d'ensemble

```
la personne ─► route (code)
               ├─ ACCUEIL : l'accusé (inventaire, contexte, file) ──────────────► la page, tout de suite
               └─ travail en file (priorité haute, la machine libre)
                    ├─ ROUTEUR : 1 appel à schéma → {intention, clarté, entrées}
                    ├─ POLITIQUE (code, machine à états) ◄── REGISTRE (intentions, capacités, skills, état)
                    │      │                               ◄── MÉMOIRE (carnet, fiche projet, conversation)
                    │      ├─ répondre · demander · choisir · hors capacité · contradiction  → une carte
                    │      ├─ proposer un plan (données typées, coût)                      → Accepter
                    │      └─ exécuter une étape → SKILL (consigne + outils permis + schéma de sortie)
                    │                                 └─ le code fait les gestes / met les travaux en file
                    └─ PALIERS : travaux séparés, priorité basse, sur l'autre DGX si possible
```

### 5.2 L'accueil

Un module pur (`accuse(demande, contexte, travail)`), appelé par la route avant de rendre : il réutilise
`inventaire` (déjà là pour l'entrée d'un projet) pour toute demande, y ajoute le contexte (l'outil, la planche, la
sélection citée) et la file (`position`, `ahead`, `eta_s`, le message d'attente du travail). Aucun modèle.

### 5.3 Le routeur

- **Entrée** : la demande, les lignes des pièces citées (`cited_block`), le contexte (l'outil), les intentions du
  registre (id et une ligne chacune, ≈ 2 000 signes). Ni planche, ni outils, ni historique au-delà du dernier tour.
- **Sortie** (sortie structurée, schéma construit depuis le registre) :
  `{intention: enum(ids), clarte: "precise" | "vague", entrees: {…les entrées connues de l'intention…}, cible: [ids],
  resume: str}`. L'enum garantit une intention qui existe ; `autre` est dans la liste.
- **Court-circuits sans modèle** : une demande venue d'un bouton (« Storyboard », une réponse à une carte, une étape de
  plan) porte déjà son intention ; elle ne passe pas par le routeur.
- **Coût estimé** : ≈ 1 500 jetons à lire, ≈ 80 à écrire : 1 à 2 s avec un modèle à experts, ≈ 10 s avec le dense de
  32 B — hors chargement.
- **Lot 1** : le routeur est le premier appel du travail, avec le modèle de la conversation. **Plus tard** (A1) : un
  petit modèle résident ou des embeddings (§ 2.3), si la mesure le justifie.

### 5.4 La politique de conversation

Une fonction pure du code : `decide(routage, conversation, registre, memoire) → action`. Les états de la conversation
(un seul à la fois, gardé avec elle) : `libre`, `questions` (des cartes ouvertes), `choix` (un choix de workflow
ouvert), `plan` (proposé), `execution` (accepté, étape k à faire), `production` (des rendus en cours).

Les règles, dans l'ordre (la première qui s'applique gagne) :

| # | si | alors (action) |
|---|---|---|
| 1 | la demande répond à une carte ouverte (un clic) | `noter` les réponses au carnet, puis reprendre l'action de la carte |
| 2 | une entrée connue contredit le carnet ou la fiche projet | `contradiction` (les deux citées, 1 question) |
| 3 | intention `aide.capacites` | `repondre` : la liste du registre, branché ou non (code, sans modèle) |
| 4 | aucune capacité de l'intention n'est branchée | `hors_capacite` : ce qui manque (le `pourquoi` de chaque capacité) + l'approchant branché de même sortie |
| 5 | une entrée **requise** manque | `demander` : les questions du registre pour ces entrées, 3 au plus, dans l'ordre déclaré |
| 6 | plusieurs capacités branchées et leurs critères ne départagent pas | `choisir` : les candidates, la recommandée, pourquoi |
| 7 | l'action coûte du GPU, ou pose plus de 3 objets | `plan` : les étapes de la skill, ce que chacune pose, le coût estimé (`durations.json`) |
| 8 | plan accepté, étape k à faire, clic de la personne | `etape` (la skill, l'étape k) |
| 9 | sinon (petit, réversible) | `geste` : la skill `conversation`, ses outils permis, 3 gestes au plus |

« Juste par construction » : le nombre de questions vient des entrées manquantes (0 à 3, jamais `minItems`) ; la
production n'existe qu'à la règle 8, derrière une acceptation écrite dans la conversation ; une capacité non branchée
ne peut pas être choisie (l'état vient du registre) ; le modèle ne choisit ni l'état ni la transition.

### 5.5 Les skills

- **Le format** : celui d'Agent Skills [1], plus un contrat lisible par le code :
  `agent/skills/<nom>/SKILL.md` (la consigne pour le modèle : un résumé français en tête pour Cal, le corps en
  anglais comme les consignes actuelles — D8 d'`agent_design.md`) et `agent/skills/<nom>/skill.json` (§ 9.3).
- **Le chargement** : par le code, d'après l'intention et l'étape. Le modèle reçoit le corps de SA skill et **ses
  seuls outils** (3 à 6, pas 16). Aucun outil « lire une compétence » laissé au choix du modèle.
- **Une skill = des étapes typées** : `structure` (un appel à schéma : un découpage, un plan de diapositives),
  `boucle` (des appels d'outils bornés), `code` (des gestes ou des travaux calculés par le code depuis des données
  validées), `validation` (la personne).
- **Une skill externe** (Ming-Image, PPTAgent…) : son `SKILL.md` est lu comme une **référence** (`references/`) ; ses
  scripts ne s'exécutent jamais dans le portail tels quels (« Tools represent arbitrary code execution », [7]). Ce
  qu'ils font devient une capacité du registre servie par un travail de la file (`jobs.register`), sa voie, sa machine,
  après le téléchargement accepté par Cal, sa licence lue ; la skill de chez nous s'en sert comme d'un outil.

### 5.6 Le registre des capacités

**Ce que c'est** : la liste de tout ce que le portail sait faire ou pourrait faire, une fiche par workflow, en
données (`agent/capacites/<id>.json`), et le vocabulaire des intentions (`agent/intentions.json`). Le précédent :
`intentions` de `musique/generatif_modeles.json` (06/10) — pour chaque réponse, les voies dans l'ordre où on les
essaie, la première prête prise, une voie non câblée passée avec sa raison, la demande vérifiée par le serveur.

**Une capacité** (les champs) :

```jsonc
{
  "id": "vfx.retirer_personne.h3",            // stable, unique
  "label": "Retirer une personne · H3 Person Remover",
  "intentions": ["vfx.retirer"],                // les ids d'agent/intentions.json
  "outil": "movie",                             // la page qui la montre (href)
  "travail": "movie.retirer",                   // la sorte de la file (jobs.register) — à créer au lot 6 ; null : un geste
  "route": null,                                // ou la route du portail qui la fait
  "entrees": {                                  // ce qu'elle prend : sortes du portail, contraintes, questions
    "video": {"sorte": "video", "requis": true, "contraintes": {"fps": 24, "cote_multiple": 32, "duree_conseillee_s": 5}},
    "premiere": {"sorte": "image", "requis": true, "prepare_par": "image.consigne"},
    "qui": {"type": "texte", "requis": true,
            "question": {"texte": "Qui retirer ?", "choix_de": "personnes_vues"}}
  },
  "sortie": {"sorte": "video", "parents": ["video"]},
  "criteres": [                                 // comparés par le code aux entrées connues et à la fiche projet
    {"si": "une_personne_parmi_plusieurs", "poids": 1, "pourquoi": "elle suit la personne désignée"},
    {"si": "commercial_ue", "exclut": true, "pourquoi": "la licence MiniMax H3 exclut l'UE"}
  ],
  "limites": ["un plan continu de ≈ 5 s ; les coupes cassent"],
  "etat": {"exige": {"interrupteur": "movie_engine=h3", "comfy_modeles": ["…person_remover…"], "noeuds": ["SAM3…"]}},
  "cout": {"classe": "gpu", "famille": "h3", "estimation": "durations.json"},
  "consentement": "rendu",                      // aucun | rendu | telechargement
  "licence": {"nom": "MiniMax H3 Community License", "lue": false, "source": "…"},
  "sources": ["https://huggingface.co/akatz-ai/MiniMax-H3-Person-Remover-LoRA"],
  "rempli_par": "veille_1009.md", "verifie": "2026-10-09"
}
```

**L'état, calculé par le code** (jamais écrit à la main) : `branche` (le travail est déclaré, l'interrupteur posé, les
modèles et les nœuds présents dans la ComfyUI d'une machine : `/object_info`, la liste des modèles, déjà lus par
`movie.validate_graph` et le préflight), `factice` (le moteur d'essai), `installable` (documenté, à télécharger : le
geste de Cal), `absent` (aucune méthode connue), chacun avec son `pourquoi` — comme `EDIT_TOOLS["extend"]["off"]`
d'Image.

**Qui le remplit** :
- chaque lot qui ajoute un travail déclare sa capacité. **Le contrôle le rend sûr** : `tools/check.py` refuse une sorte
  de `jobs.register` de coût `gpu` ou `api` qui n'est ni dans une capacité ni marquée interne — comme `STORES` pour
  ce que les outils écrivent sous `<data_dir>` ;
- `veille_1009.md` écrit les capacités `installable` (les modèles et skills à venir, leurs sources et licences) ;
- `objet_scenes_3d.md` écrit celles des objets et scènes 3D ;
- Cal tranche les licences et les téléchargements.

**Qui s'en sert** : le routeur (l'enum des intentions) ; la politique (candidates, critères, état, questions,
coût) ; la page (« Ce que je sais faire », la carte de choix, « ce qu'il faudrait installer ») ; Admin → Diagnostics
(l'état de chaque capacité, par machine) ; le banc (le workflow attendu par cas) ; plus tard une façade MCP.

**Une intention** (`agent/intentions.json`) : `{id, label, une_ligne, exemples: [3 à 6 phrases], skill, sortie}`.
Les premières : `aide.capacites`, `planche.question`, `planche.retoucher`, `projet.demarrer`, `projet.creer`,
`document.analyser`, `media.analyser`, `asset.chercher`, `storyboard.creer`, `slides.creer`, `slides.retoucher`,
`image.creer`, `image.modifier`, `video.creer`, `vfx.retirer`, `vfx.incruster`, `montage.premier_jet`,
`musique.creer`, `objet3d.creer`, `autre`.

### 5.7 Les modèles sur les deux DGX

| rôle | modèle (présent) | machine | pourquoi |
|---|---|---|---|
| routeur et conversation (lot 1) | `qwen3:30b-a3b` (18 Go, 3,3 B actifs) — `tools` à confirmer au diagnostic | DGX2 | ≈ 6 fois plus rapide que le dense de 32 B ; déjà là ; sert déjà le carnet de Transcrire |
| la vision (paliers, regard d'une diapositive) | `qwen3-vl-32b-32k` | DGX1 si sa voie `audio` y a une instance, sinon DGX2 après le texte | le seul qui voit, présent sur les deux |
| lire long (un scénario entier, un dossier) | `gpt-oss:120b` (65,4 Go, DGX1) ou le 125 B NVFP4 annoncé (`veille_1009.md`) | DGX1, jamais à côté d'un rendu H3 (le jeton GPU) | plus tard, si la mesure montre qu'un 30B-A3B ne tient pas un long texte |
| routeur résident (plus tard) | `qwen3:4b` (sur DGX2) ou des embeddings (aucun relevé) | DGX2 | si le premier appel du travail est trop lent : à mesurer d'abord |
| générer | ComfyUI (Image, H3, ACE-Step, YuE2, TRELLIS.2) | les deux | inchangé |

**Le chargement.** Aujourd'hui, chaque travail décharge son modèle. Proposition (A2) : la mesure d'abord — garder
`load_duration`, `prompt_eval_duration`, `eval_count`, `eval_duration` de chaque appel dans le tour (lot 1) ; ensuite
seulement, un `keep_alive` de quelques minutes quand aucun travail GPU n'attend sur la machine, déclaré à
l'ordonnanceur (une famille résidente que le préflight compte). Ni le tueur OOM ni la cgroup ne voient cette mémoire
(`orchestration.md` § 3.1) : rien ne reste chargé sans être compté.

**La ComfyUI vidée.** Le travail de l'agent n'a pas besoin de la ComfyUI : il occupe sa voie `audio` pour le jeton GPU
de la machine. Proposition (lot 2) : pour une famille qui ne se charge pas dans la ComfyUI (`ollama-*`), le préflight
lit d'abord la mémoire libre et ne vide l'instance que s'il en manque (aujourd'hui il la vide d'abord, puis lit).

### 5.8 La restitution progressive

Chaque skill déclare ses paliers (`skill.json`, `paliers`) : le texte d'abord (un appel), puis ce qui se calcule en
travaux séparés de priorité basse, sur la machine libre. Les paliers d'aujourd'hui (images, sons) deviennent ceux de la
skill `projet` ; le storyboard a les siens (§ 9.4).

### 5.9 La mémoire du projet

| niveau | ce qu'il garde | écrit par | où |
|---|---|---|---|
| le tour | la demande, le contexte, les pièces | la route | la conversation |
| la conversation | les tours, bornés dans le message (4 000 signes) | la route, le travail | aujourd'hui par planche ; **proposé : par Workspace** (A3), chaque tour marqué de son outil et de son document |
| le carnet | les décisions, dans l'ordre | le code (réponses, plans), `noter_decision`, la personne | aujourd'hui par planche ; proposé : par Workspace |
| **la fiche projet** (neuf) | livrable, durée, format, public, ton, commercial ou non, UE ou non, personnages (éléments), lieux, documents retenus et écartés | **le code**, d'après les réponses et validations (jamais une interprétation du modèle) | à côté du carnet ; lue par le routeur (entrées déjà connues) et la politique (critères) |

Pas de magasin de vecteurs : la recherche dans la bibliothèque et le texte des documents suffisent ; une légende
écrite par le palier des images rend une image cherchable par ses mots (§ 6).

### 5.10 L'action dans les outils

- **Sur la planche** : les gestes d'aujourd'hui, en UN `app.mutate` (inchangé).
- **Dans un outil** : par ses routes et ses travaux, nommés dans le registre (`travail`, `route`) ; un travail ne part
  que dans un plan accepté ; sinon, **ouvrir l'outil prérempli** (Vidéo prend déjà `?mode=t2v|i2v|r2v`, `?start=`,
  `?ref=` : `movie.md`).
- **Jamais** une route d'admin, une suppression, une publication (lien d'écoute, Cloudflare) par l'agent.

## 6. Le catalogue des skills, par priorité

| # | skill | entrée | étapes | outils (portail) | sortie | qualité (mesurable) | dépend de |
|---|---|---|---|---|---|---|---|
| 1 | **conversation** (gestes de planche) | une demande précise sur la planche | `boucle` (3 gestes au plus) | `lire_planche`, `poser_texte`, `ranger`, `grouper`, `deplacer`, `relier` | des gestes annulables | 0 geste hors de ce qui est désigné | lot 1 |
| 2 | **projet** (l'entrée d'aujourd'hui) | brief + fichiers | réception, `structure` (compréhension, questions), paliers, `structure` (plan) | `/api/library/<id>/texte`, Transcrire, la vision | carnet, fiche, plan | questions 0-3, 0 geste avant le plan | existe ; à migrer |
| 3 | **storyboard** | un scénario, une séquence, un brief | `structure` (découpage) → `validation` → `code` (la planche) → `code` (cartes) → consentement (rendus) | `lire_document`, `chercher_bibliotheque`, éléments, `image.generate` (par les cartes) | un cadre, une case par plan (note + carte Générer prête) | le découpage validé = ce qui est posé (même nombre, même ordre) ; 0 rendu sans accord | lot 1 (§ 9) |
| 4 | **analyse de document** | un document | `structure` par partie bornée, réponse | `GET /api/library/<id>/texte`, `lire_document` | une réponse ; une note si demandée | cite ses pages ; ne pose rien sans demande | lot 2 |
| 5 | **analyse vidéo, son** | une vidéo, un son, un film | Transcrire (`transcrire.transcribe`, le carnet `…/notes`), Movie Analysis (`analyse.run`), paliers | routes de Transcrire et d'`analyse` | une réponse avec timecodes | timecodes justes (lus dans la transcription) | lot 5 |
| 6 | **slides** (« super slides ») | un brief, des documents, une planche | `structure` (plan des diapositives) → `validation` → `code` (diapositives dans un modèle de `ideation/presentation/modeles/`) → passe assistée → regard (agent design) | `presentation.pdf`, `presentation.video`, la passe, les outils de design d'`agent_design.md` § 4.3 | un deck dans le mode Présentation, PDF ou MP4 | les règles de `regles.json` tenues ; 0 texte réécrit sans demande | D1-D10, polices, `tools/regard.mjs` ; lot 4 |
| 7 | **recherche dans Asset** | des mots, une image | `chercher_bibliotheque` ; plus tard les légendes du palier des images, puis des embeddings | `GET /api/library`, `/api/asset/dock` | des vignettes à poser | rappel mesuré sur un jeu étiqueté | lot 5 |
| 8 | **image, vidéo** | une demande précise | carte prête ; plan si plusieurs | `image.generate`, `image.edit`, `movie.t2v/i2v/r2v`, `/api/ideation/lot` (8 au plus) | des cartes prêtes, des rendus sur accord | modèle choisi par le registre (références, durée) | lot 2 |
| 9 | **premier jet de montage** | un storyboard validé et ses plans rendus | `code` : une séquence dans l'ordre du découpage | `POST /api/montage/projects`, `POST /api/montage/projects/<id>` (positions en images entières, `montage.py`) | une séquence `seq-…` | l'ordre et les durées du découpage | lots 1 et 7 |
| 10 | **VFX** (retirer, incruster) | une vidéo ou une image | choix par le registre (§ 3.3) → plan → rendu | `image.edit` (Consigne) aujourd'hui ; LTX-2.5 et H3 après téléchargement | une vidéo, une image | la règle du § 3.3 jouée par le banc | téléchargements (Cal) ; lot 6 |
| 11 | **musique** | une demande de son | les `intentions` d'ODIO (déjà un registre) | `music.gen.*`, `chanson.*`, `music.stems` | un son, un projet ODIO | la voie choisie = celle d'ODIO | lot 7 |
| 12 | **objets et scènes 3D** | une image, une description | renvoi | `objet.mesh` (TRELLIS.2) | un élément 3D | `objet_scenes_3d.md` | lot 7 |

## 7. Le protocole d'évaluation

**Les cas** : `tools/banc_agent/cas.jsonl`, un cas par ligne, rejouable — la demande, les pièces (fabriquées par le
banc : un scénario Fountain, des images, une vidéo de 8 s à trois personnes, un son), l'état de départ (carnet, fiche,
planche), et **ce qu'on attend** :

```json
{"id": "vfx-une-parmi-trois", "demande": "enlève le passant en rouge", "pieces": ["video:trois-personnes-8s"],
 "fiche": {"commercial_ue": true},
 "attendu": {"intention": "vfx.retirer", "action": "hors_capacite", "approchant": "image.consigne",
             "questions_max": 1, "gestes_avant_validation": 0, "rendus_sans_accord": 0}}
```

Une trentaine de cas couvrent le tableau du § 3.2 (vague, précise, document, storyboard, slides, Asset, modification,
hors capacités, VFX dans chaque branche de la règle du § 3.3, contradiction, reprise de session).

**Deux bancs** :
- **faux** (le conteneur, `tools/check.py`) : contre `tools/faux_ollama.py`, qui route par mots-clés et remplit les
  schémas : vérifie la politique et le code, pas le modèle — chaque cas donne son action attendue ;
- **réel** (DGX2, Admin → Diagnostics → « Banc de l'agent ») : le vrai modèle, chaque cas joué **k = 3 fois**.

**Les mesures**, écrites dans un rapport (`<data_dir>/banc_agent/<date>.json`, puis « Copier tout ») :

| mesure | comment |
|---|---|
| temps de l'accusé | de la requête à la réponse de la route (cible < 1 s) |
| temps de la première réponse utile | de la requête à la carte (questions, plan ou réponse) ; dont `load_duration` |
| justesse du routage | intention obtenue = attendue (pass^1 et pass^3) |
| nombre de questions | ≤ attendu ; 0 si rien ne manque |
| conformité au plan | ce qu'une étape pose = ce que le plan dit (nombre et sortes d'objets) |
| gestes avant validation, rendus sans accord | 0 exigé |
| appels au modèle, jetons lus et écrits | `prompt_eval_count`, `eval_count` |
| chargements de modèle | `load_duration` > 0 |

Le banc réel compare les modèles (A1) sur les mêmes cas, comme `agent_design.md` § 4.8 le prévoyait pour le design.

## 8. La feuille de route

| lot | quoi | qui décide avant |
|---|---|---|
| 0 | Cal : le diagnostic « Agent Showrunner » sur DGX2 pour `qwen3:30b-a3b` (`tools` ?) ; un tour réel, son temps | — |
| **1** | **le registre, la politique, la skill storyboard** (§ 9) ; les temps d'Ollama gardés par appel | A1 (le modèle du texte), A4 (le consentement) |
| 2 | le banc réel (Admin) ; la conversation libre passée par le routeur et la skill `conversation` (outils filtrés) ; la skill `projet` (l'entrée d'aujourd'hui, questions 0-3) ; le préflight qui ne vide plus la ComfyUI pour l'agent ; image et vidéo | — |
| 3 | le panneau dans chaque outil (contexte par outil) ; la conversation, le carnet et la fiche par Workspace ; la reprise de session | A3 |
| 4 | les slides : plan des diapositives, modèle, passe ; puis l'agent design (`agent_design.md` § 6) | D1-D10, polices |
| 5 | analyse vidéo et son ; recherche dans Asset (légendes, puis embeddings) | un modèle d'embeddings (téléchargement) |
| 6 | VFX : LTX-2.5 Clean Plate, H3 Person Remover, l'inpainting avec masque | téléchargements, licences |
| 7 | premier jet de montage ; musique ; objets et scènes 3D | — |
| 8 | un routeur résident, un gros modèle texte, une façade MCP — si les mesures le demandent | A1, A2 |

## 9. Le premier lot, prêt à coder

**Pourquoi le storyboard et pas les slides.** Le storyboard ne dépend d'aucune décision ouverte : il n'emploie que des
gestes qui existent (cadres, notes, cartes Générer prêtes, éléments en références) et la lecture des documents ; c'est
le métier de Cal ; il prolonge « Commencer un projet » (un scénario déposé → un storyboard) ; il prépare la vidéo (une
case devient une première image) et le montage (l'ordre et les durées). Les slides attendent D1-D10, la licence des
polices (bloquante pour le PDF) et le rendu par Chromium sur DGX2 (`tools/regard.mjs`, non écrit) : elles viennent au
lot 4, sur le même socle.

### 9.1 Les fichiers

| fichier | neuf ou changé | contenu |
|---|---|---|
| `agent/intentions.json` | neuf | le vocabulaire fermé (§ 5.6) : 20 intentions, leurs exemples, leur skill |
| `agent/capacites/*.json` | neuf | une fiche par capacité ; au lot 1 : `planche.gestes`, `image.generer.krea2`, `image.generer.qwen21`, `image.generer.zimage`, `image.consigne`, `video.i2v`, `video.r2v`, `video.t2v`, `transcrire`, `presentation.pdf`, `presentation.video`, `objet.mesh`, `montage.export`, et en `installable` : `vfx.retirer_personne.ltx`, `vfx.retirer_personne.h3` |
| `agent/skills/conversation/{SKILL.md,skill.json}` | neuf | la consigne actuelle (`system_prompt`) déplacée, ses outils de planche |
| `agent/skills/storyboard/{SKILL.md,skill.json,decoupage.schema.json}` | neuf | § 9.3, § 9.4 |
| `server/tools/agent_registre.py` | neuf | charger et valider le registre ; l'état calculé ; `GET /api/agent/registre` ; selftest |
| `server/tools/agent_politique.py` | neuf | `decide()` (§ 5.4), `accuse()` (§ 5.2), `scenes_of()` (§ 9.4) ; fonctions pures ; selftest par table |
| `server/tools/ideation_agent.py` | changé | le routeur au début de `run_turn` ; `intent: "skill"` ; le storyboard ; les temps d'Ollama gardés (`mesures`) ; `tools_spec(noms)` filtré par la skill |
| `tools/faux_ollama.py` | changé | le schéma du routeur (une intention par mots-clés), celui du découpage |
| `ideation/agent.js`, `agent.css` | changé | la carte « hors capacité », la carte « choix », la carte du découpage (§ 9.5), « Lancer les N images » |
| `ideation/pilote_storyboard.mjs` | neuf | le pilote Playwright (§ 9.6) |
| `tools/check.py` | changé | le registre complet : chaque sorte GPU ou API de `jobs.register` est dans une capacité ou marquée interne (§ 5.6) |
| `docs/ARCHITECTURE.md`, cette étude | changé | les routes, le contrat du registre ; « Fait le … » |

### 9.2 Les routes

| route | |
|---|---|
| `GET /api/agent/registre` | `{intentions: [{id, label, skill}], capacites: [{id, label, intentions, outil, etat, pourquoi, cout, consentement}], skills: [{id, label, description}]}` — l'état calculé (gardé 30 s, comme `engine_state`) |
| `POST /api/ideation/agent` | inchangée pour `ingest`, `plan`, `etape` ; `intent: ""` passe par le routeur et la politique ; la réponse porte toujours `accuse` (`{texte, recu, contexte, file}`) ; `intent: "skill"` avec `{skill, etape, donnees}` (un bouton, une carte) court-circuite le routeur |
| `POST /api/ideation/agent/<planche>/turns/<t>` | en plus : `{decoupage: {...}}` (la personne corrige le découpage : relu par le schéma, 400 sinon), `{valide: true}` (le découpage validé, au carnet), `{consent: "images"}` (le lot d'images accepté) |

### 9.3 Les formats

`agent/skills/storyboard/skill.json` :

```json
{
  "id": "storyboard", "version": 1, "label": "Storyboard",
  "description": "Turn a script, a sequence or a brief into a shot breakdown the person validates, then a storyboard on the board: one panel per shot with its note and a ready Generate card.",
  "intentions": ["storyboard.creer"],
  "entrees": {
    "source": {"sorte": ["document", "note"], "requis": true,
               "question": {"texte": "D'où part le storyboard ?", "choix": ["le document cité", "le brief", "je décris la scène"]}},
    "portee": {"type": "texte", "requis": false, "si_long": true,
               "question": {"texte": "Quelle séquence ?", "choix_de": "scenes"}},
    "plans": {"type": "entier", "min": 1, "max": 24, "requis": false,
              "question": {"texte": "Combien de plans, à peu près ?", "choix": ["6", "12", "24", "selon le texte"]}},
    "format": {"type": "enum", "valeurs": ["16:9", "9:16", "2.39:1", "1:1"], "defaut_de": "fiche.format"},
    "rendu": {"type": "enum", "valeurs": ["crayonne", "photoreal"], "requis": true,
              "question": {"texte": "Les cases ?", "choix": ["crayonné", "photoréaliste"]}}
  },
  "etapes": [
    {"id": "decoupage", "sorte": "structure", "schema": "decoupage.schema.json", "pose": [], "validation": "personne"},
    {"id": "planche", "sorte": "code", "pose": ["frame", "frame×plans", "note×plans"], "max_objets": 80},
    {"id": "cartes", "sorte": "code", "pose": ["gen×plans"], "capacite": "image.generer", "lancer": false},
    {"id": "images", "sorte": "travaux", "consentement": "images", "cout_de": "image.generer"}
  ],
  "outils": ["lire_document", "chercher_bibliotheque"],
  "sortie": {"sorte": "planche", "contrat": "un cadre « Storyboard · <portée> », une case par plan dans l'ordre du découpage"},
  "verifications": ["plans posés = plans validés (nombre, ordre)", "0 geste avant la validation", "lancer faux sur chaque carte"],
  "paliers": ["decoupage", "planche", "images"]
}
```

`agent/skills/storyboard/decoupage.schema.json` (la sortie structurée ; les bornes sont dans le schéma) :

```json
{"type": "object", "required": ["titre", "plans", "remarques"], "properties": {
  "titre": {"type": "string"},
  "plans": {"type": "array", "minItems": 1, "maxItems": 24, "items": {"type": "object",
    "required": ["valeur", "mouvement", "duree_s", "action", "prompt"], "properties": {
      "scene": {"type": "string"},
      "valeur": {"enum": ["tres_gros_plan", "gros_plan", "plan_rapproche", "plan_taille", "plan_americain",
                          "plan_moyen", "plan_ensemble", "plan_general", "insert"]},
      "angle": {"enum": ["normal", "plongee", "contre_plongee", "aerien", "subjectif"]},
      "mouvement": {"enum": ["fixe", "panoramique", "travelling", "zoom", "camera_epaule", "drone"]},
      "duree_s": {"type": "number", "minimum": 0.5, "maximum": 30},
      "action": {"type": "string", "maxLength": 300},
      "dialogue": {"type": "string", "maxLength": 300},
      "son": {"type": "string", "maxLength": 200},
      "personnages": {"type": "array", "items": {"type": "string"}, "maxItems": 4},
      "prompt": {"type": "string", "maxLength": 600}}}},
  "remarques": {"type": "array", "items": {"type": "string"}, "maxItems": 3}}}
```

La sortie du routeur : `{intention: enum, clarte: enum, entrees: {source?, portee?, plans?, format?, rendu?}, cible:
[ids], resume}` — l'enum construit depuis `intentions.json`, les entrées depuis la skill de chaque intention.

### 9.4 Le déroulé, de bout en bout

1. **La demande** (« fais le storyboard de la séquence 3 », un scénario cité) : la route rend l'accusé, met le travail
   en file (priorité haute).
2. **Le routeur** (1 appel) : `storyboard.creer`, `entrees: {source: <doc>, portee: "séquence 3"}`.
3. **La portée trouvée par le code** : `scenes_of(texte)` découpe le scénario par ses en-têtes de scène (`INT.`,
   `EXT.`, `INT./EXT.`, `I/E` de Fountain ; `SÉQ.`, `SÉQUENCE`, une ligne « 3. EXT. QUAI — NUIT ») ; une portée qui
   ne se trouve pas devient la question `portee` (les scènes trouvées en choix). Le texte de la portée : 16 000 signes
   au plus ; au-delà, la question.
4. **La politique** : `rendu` manque → une carte de questions (1 à 3) ; sinon tout de suite l'étape `decoupage`.
5. **Le découpage** (1 appel, le schéma) : le corps de `SKILL.md`, la portée, la fiche projet, les éléments du
   Workspace (personnages : leur nom et leur id, par le code). Rien n'est posé. La carte du découpage arrive.
6. **La personne corrige et valide** (§ 9.5) ; le découpage validé va au carnet (« Storyboard de la séquence 3 :
   9 plans validés »).
7. **La planche** (code, pas de modèle) : un cadre « Storyboard · séquence 3 », une case par plan (un cadre au
   format choisi, sa note : n°, valeur, mouvement, durée, action, dialogue). Le serveur bâtit ces actions dans le format
   d'aujourd'hui (`{tool, args, why, id}` : `poser_cadre`, `poser_texte`, `ranger` en grille), les passe au même
   validateur (`Gestes.add`) ; la page les pose comme aujourd'hui, en UN `app.mutate` — un tour annulable d'un geste.
8. **Les cartes** (code) : une carte Générer par case, son prompt (celui du plan, préfixé du rendu choisi), ses
   références (les éléments des personnages du plan), le modèle par la règle d'aujourd'hui (`genWith` : Krea 2 si ses
   références y tiennent, sinon Qwen-Image 2.1), `lancer: false`.
9. **Le consentement** : « Lancer les 9 images · ≈ N min sur DGX2 » (le coût de `durations.json`), le seul bouton
   orange de la carte ; la page lance chaque carte par sa garde (`app.gen.generate`), comme aujourd'hui ; le carnet
   note l'accord. Sans clic, rien ne part.

Appels au modèle pour tout le storyboard : **2** (le routeur, le découpage), plus 1 s'il faut demander.

### 9.5 La page

- **La carte du découpage** : un tableau (n°, valeur, mouvement, durée, action, dialogue) ; chaque ligne se réécrit,
  se supprime, se fusionne avec la suivante, se coupe en deux ; un total des durées ; « Valider le découpage », seul
  orange ; « Refaire » (un appel de plus, avec ce que la personne a écrit). Chaque correction est enregistrée seule
  (`{decoupage}`), rien à « enregistrer ».
- **La carte « hors capacité »** : ce qui manque, l'approchant en bouton, « Ce qu'il faudrait installer » (le
  `pourquoi` de chaque capacité).
- **La carte « choix »** : les workflows candidats, la recommandation et sa raison, un bouton par candidat.
- Dans les deux thèmes, aux jetons de `commun/tokens.css` ; une action éteinte dit pourquoi.

### 9.6 Les tests

- **`agent_registre.py`, selftest** : chaque fiche se lit et suit le schéma ; le `travail` de chaque capacité qui
  n'est ni `installable` ni `absent` est une sorte déclarée (`jobs._META`), chaque `route` une route du portail ;
  chaque intention a sa skill ; l'état d'une capacité factice, branchée, installable ; `GET /api/agent/registre`
  rejoué par un guest (la garde).
- **`agent_politique.py`, selftest par table** : pour chaque ligne du § 5.4, un routage et un état donnés → l'action
  attendue ; les questions = les entrées manquantes, 3 au plus, 0 si rien ne manque ; la règle du § 3.3 dans ses six
  branches ; `scenes_of` sur un Fountain, un scénario français, un texte sans en-tête.
- **`ideation_agent.py`, selftest** (contre le faux Ollama) : un storyboard de bout en bout — l'accusé dans la réponse
  de la route ; 2 appels au modèle ; la carte du découpage, 0 geste avant la validation ; un découpage corrigé hors
  schéma refusé (400) ; validé → les gestes rendus : 1 + N cadres, N notes, N cartes `lancer: false` ; le carnet ; la
  demande « enlève la personne » → `hors_capacite` avec l'approchant `image.consigne`.
- **`tools/check.py`** : la garde du registre (une sorte GPU non déclarée fait échouer le contrôle).
- **`ideation/pilote_storyboard.mjs`** (portail d'essai, faux Ollama, sombre et clair) : le scénario cité → l'accusé
  affiché en moins d'une seconde → les questions → le découpage → une ligne supprimée et deux fusionnées → valider →
  la planche posée, les cases dans l'ordre, sans chevauchement → « Annuler ce tour » : la planche revient identique →
  « Reposer » → « Lancer les N images » : N travaux en file ; captures dans les deux thèmes.

## 10. Décisions pour Cal

| | la question | recommandation |
|---|---|---|
| **A1** | les modèles par DGX | texte et routeur : `qwen3:30b-a3b` sur DGX2 (après le diagnostic `tools`) ; vision : `qwen3-vl-32b-32k` sur DGX1 si possible ; un gros modèle texte plus tard, sur mesure |
| **A2** | garder le modèle chargé entre deux tours | mesurer d'abord (les temps d'Ollama gardés au lot 1) ; puis un `keep_alive` court, compté par l'ordonnanceur, seulement quand rien n'attend le GPU |
| **A3** | la portée de la mémoire | le projet = le Workspace : conversation, carnet et fiche projet par Workspace ; chaque tour marqué de son outil |
| **A4** | l'autonomie | le consentement par plan, coût affiché ; rien hors du plan ; chaque carte garde son bouton |
| **A5** | la première skill | le storyboard (§ 9) ; les slides au lot 4 |
| **A6** | l'agent hors d'Idéation | oui, au lot 3 : le même panneau dans chaque outil |
| **A7** | retirer une personne | télécharger LTX-2.5 et son Clean Plate IC-LoRA d'abord (sans masque, pas d'exclusion UE connue — licence à lire) ; le LoRA d'H3 ensuite pour « une parmi d'autres », hors UE ; les deux après `veille_1009.md` |
| **A8** | le ton, un nom, des rôles | « Showrunner », tutoiement, sobre ; des rôles incarnés plus tard si Cal le veut |
| **A9** | 32k ou 64k (D4) | 32k : les appels à schéma et les outils filtrés tiennent ; le banc dira |
| **A10** | D1-D10 d'`agent_design.md` | D1 un seul agent : oui (des skills) ; D2 aperçu dans le mode : oui ; D3 : remplacé par A1 (la vision pour le regard seul) ; D4 : A9 ; D5 Chromium : oui ; D6 jamais de lui-même : oui ; D7 la grille : oui ; D8 nous les écrivons, corps anglais et résumé français : oui, **chargées par le code** ; D9 réécrire sur demande : oui ; D10 la passe garde son bouton : oui |
| **A11** | un assistant dans Workers AI (`orchestration.md`, décision 9) | non : tout en local, le routeur sur DGX2 |
| **A12** | les questions de l'entrée | 0 à 3, d'après ce qui manque (plus de minimum de 3) |

## 11. N_PIPE_CHATBOT

Les discussions « N_PIPE_CHATBOT » que Cal cite sont **introuvables** dans son Drive et **inaccessibles** depuis cette
session : rien n'en est repris ici. Ce qu'il faudrait que Cal en extraie (un fichier texte suffit) :

1. les besoins et les scènes d'usage du chatbot qui y sont écrits (qui, pour quoi faire, dans quel outil) ;
2. les modèles essayés, avec leurs mesures (vitesse, justesse des outils, français) et la machine ;
3. les consignes système qui ont marché, et celles qui ont échoué (avec l'exemple) ;
4. une taxonomie des demandes ou des intentions, si elle existe (à comparer au § 5.6) ;
5. les produits regardés en veille (liens), et ce qui en était retenu ;
6. les décisions prises là-bas qui confirment ou contredisent ce document ;
7. des dialogues aimés et détestés (pour le banc, § 7) ;
8. un jeu d'essai éventuel (demandes et réponses attendues).

## Fait le 09/10

- L'étude, sans code : l'état des lieux de l'agent (code, études, REPRISE), ses lenteurs et ses erreurs lues dans le
  code, l'état de l'art, le comportement, l'architecture, le registre, le catalogue, le banc, la feuille de route,
  le premier lot.
- Un seul essai : la taille de la consigne et des outils envoyés à chaque appel (`system_prompt()` 3 423 signes,
  `tools_spec()` 10 953 signes pour 16 outils), lue en important le module.
- Renvois d'une ligne vers cette étude : `docs/ARCHITECTURE.md` et l'en-tête de `agent_showrunner.md`,
  `agent_design.md`, `mode_showrunner.md`, `orchestration.md`, `presentations_motion.md`.

## Fait le 09/10 — lot 1

Le § 9, codé (branche `wip3/agent-lot1`). Rien n'a tourné sur le vrai modèle : tout est essayé contre le faux Ollama,
qui vérifie la FORME (le banc réel est au lot 2).

**Les données** (`agent/`) :
- `intentions.json` : les 20 intentions du § 5.6, chacune sa skill ; `a_venir` dit le lot qui écrira la sienne
  (`slides.*` 4, `media.analyser` 5, `vfx.*` 6, `montage.premier_jet`, `musique.creer`, `objet3d.creer` 7) ; `autre`
  nomme ses approchants (les exports PDF, MP4, du Montage).
- `capacites/*.json` : 40 fiches. Les 15 du § 9.1, plus ce que la garde du registre a fait déclarer (chaque sorte de la
  file a sa fiche ou sa raison) : `document.lecture`, `asset.recherche`, `image.atelier`, `image.detourer`,
  `image.agrandir`, `video.agrandir`, `transcrire.traduire`, `transcrire.carnet`, `analyse.film`, `montage.sequence`, huit
  fiches de Musique, les vues et les rendus d'Object Creator (`objet_scenes_3d.md` § 10, sous `objet3d.creer` : ses trois
  intentions de plus attendent D9) ; de la veille (`veille_1009.md` § 3) : `vfx.retirer_objet.void`,
  `vfx.retirer_objet.h3_inpaint` (installables), `vfx.incruster.video`, `slides.pptx` (aucune voie connue : `absent`). Les champs de la veille
  (`telechargements`, `memoire`, `licence.commercial`, `licence.territoire`, `etat.exige.comfyui_min`) sont lus.
- `skills/conversation/` (la consigne du 05/10, déplacée ; `outils_selon_intention` : 4 à 9 outils par intention au lieu
  de 16 ; 3 gestes au plus), `skills/storyboard/` (§ 9.3 ; `decoupage.schema.json`).

**Le code** :
- `server/tools/agent_registre.py` : charger et vérifier le registre (le format d'Agent Skills, les fiches champ par
  champ, une intention sans skill ni `a_venir`, une entrée qui change de sens d'une skill à l'autre) ; l'état calculé
  (le travail déclaré, l'interrupteur, la voie et ses instances, `pret` — l'outil le dit —, `image.availability`, et dans
  la ComfyUI : `/object_info/<nœud>`, `/models/<dossier>` et `system.comfyui_version`, lus dans `server.py` de ComfyUI le
  09/10) ; `GET /api/agent/registre` ; le schéma du routeur, construit à chaque appel.
- `server/tools/agent_politique.py` : `decide` (les 9 règles du § 5.4), `accuse`, `scenes_of`, `trouver_portee`,
  `valeur_reponse` ; des fonctions pures.
- `server/tools/ideation_agent.py` : le routeur au début du tour (UN appel à sortie structurée), l'accusé dans la réponse
  de la route (gardé avec le tour), `intent: "skill"` (réponses, choix, « Refaire » : sans routeur), les outils filtrés par
  l'intention (un outil hors de la liste est refusé au modèle, avec sa raison), 3 gestes au plus dans la conversation, les
  temps d'Ollama gardés appel par appel (`mesures` : chargement, lecture, écriture, jetons), la skill storyboard de bout
  en bout, `INGEST_SCHEMA` de 0 à 3 questions (plus de minimum). La fiche du projet (§ 5.9) commence ici : écrite par le
  code d'après les réponses (une entrée `defaut_de: fiche.x`) et les validations (le format), gardée avec la conversation,
  rendue par `GET /api/ideation/agent/<planche>` ; le lot 3 la porte au Workspace.
- `POST …/turns/<t>` : `{decoupage}` (relu par le schéma, 400 sinon), `{valide: true}` et `{consent: "images"}` passent par
  `decide` (règle 8) ; la validation bâtit les gestes de la planche par le code, au même validateur (`Gestes`).
- `ideation/agent.js` : l'accusé tout de suite ; les questions des skills ; « pas encore ici » (l'outil qui le fait déjà,
  l'approchant, ce qu'il faudrait installer) ; le choix d'un workflow ; la carte du découpage (réécrire, supprimer,
  fusionner, couper ; chaque correction enregistrée seule) ; « Valider le découpage » ; « Lancer les N images ».
- `tools/check.py` : la garde du registre (`INTERNES`) ; `tools/faux_ollama.py` : le routeur et le découpage, les temps
  d'Ollama ; `tools/faux_comfy.py` : `/models/<dossier>`, la version.

**Les écarts au § 9, et pourquoi** :
1. **Pas d'orange dans le panneau** : « Valider le découpage » et « Lancer les N images » sont le vert `.tb.on` (comme
   « Accepter » du plan), pas un `.tb.go` : la règle 4 du thème (un seul orange par écran) est tenue par le Générer de
   l'inspecteur — le § 9.5 (« seul orange ») la contredisait.
2. **La règle 6 (choisir) ne vaut que pour une skill qui LANCE un workflow** (une étape `travaux`) : la conversation ne
   pose qu'une carte prête, que la personne règle et lance — lui demander « Krea 2 ou Qwen ? » avant une carte gratuite
   serait la submerger. La capacité retenue est gardée sur le tour (`decision`) pour le banc.
3. **Une intention dont la skill n'est pas écrite** dit ce que le portail fait déjà et dans quel outil (règle 4 élargie,
   § 3.1 règle 5) : « enlève le passant » répond aujourd'hui que la skill VFX arrive au lot 6, que l'atelier d'Image et la
   Consigne le font sur une image, et ce qu'il faudrait installer pour la vidéo. `media.analyser` est passée au lot 5
   (Transcrire et Movie Analysis, que la conversation ne mène pas encore).
4. **La garde du registre porte sur toutes les sortes**, pas seulement celles de coût `gpu` ou `api` : dans le contrôle,
   les sortes GPU s'enregistrent sur la voie cpu (les moteurs factices) ; le coût qu'on y lit ne dit pas celui des DGX.
5. **Demander ne coûte aucun appel** : les questions viennent du registre (les entrées qui manquent), par le code. Le
   storyboard coûte 2 appels (le routeur, le découpage), question comprise.
6. **Le schéma du découpage** : des longueurs bornées en plus (`titre`, `scene`, chaque remarque) ; un nombre de plans
   demandé fixe `minItems = maxItems` dans le schéma de l'appel ; la sortie est ramenée dans ses bornes (`borne`) avant
   d'être vérifiée — que la sortie structurée d'Ollama tienne `maxLength` n'est pas documenté.
7. **2,39:1** n'est pas un rapport d'Image (`ASPECTS`) : la carte prend 21:9, le plus proche. **Une image par case**
   (`nombre: 1`). Les personnages qui ne sont pas sur la planche se posent dans un cadre « Personnages » à côté du
   storyboard, chacun branché sur ses cases.
8. **Les sept intentions proposées par la veille** (`vfx.remplacer`, `vfx.decor`…) ne sont pas ajoutées (V12 est une
   décision de Cal) ; leurs voies d'aujourd'hui sont rangées dans les 20 (agrandir : `image.modifier`, `video.creer`).
9. L'étape de l'entrée d'un projet (`intent: "etape"`) garde ses 12 gestes et tous ses outils : la skill `projet` est au
   lot 2. Les intentions en une ligne pour le routeur font ≈ 2 800 signes (un exemple chacune), pas 2 000.

**Les essais** : les selftests `agent_registre` (le format, l'état calculé contre un faux ComfyUI, le schéma du routeur, la
route rejouée par un guest), `agent_politique` (la table du § 5.4, les six branches du § 3.3, les questions 0-3,
l'accusé, `scenes_of` sur un Fountain, un scénario français, un texte sans en-tête), `ideation_agent` (le routeur par
table ; le storyboard de bout en bout : l'accusé en moins d'une seconde, la question, 2 appels, 0 geste avant la
validation, un découpage hors schéma refusé, les gestes du code, le carnet, la fiche, le consentement, une portée
introuvable, « Refaire », une contradiction avec la fiche, « enlève la personne », « que sais-tu faire ? »), la garde du
registre (`python3 tools/check.py registre`). Les pilotes : `ideation/pilote_storyboard.mjs` (§ 9.6, sombre et clair) ;
`ideation/pilote_agent.mjs` suit les 3 gestes par tour.

**Pas vérifié** : le vrai modèle (le routeur et le découpage de `qwen3:30b-a3b` ou de `qwen3-vl-32b-32k`, leur justesse,
leurs temps) ; l'état lu dans les vraies ComfyUI des DGX (seulement contre le faux ComfyUI) ; le coût affiché tant que
`durations.json` n'a pas de rendu d'image mesuré (« durée non mesurée »).

## Sources

**Dans le dépôt** (lu le 09/10) : `server/tools/ideation_agent.py` (tout), `tools/diag_agent.py`,
`tools/faux_ollama.py`, `ideation/agent.js` (structure, relevés), `server/core/jobs.py` (`_preflight`, le jeton GPU),
`server/core/config.py` (la voie `audio`), `server/tools/image.py` (`MODELS`, `EDIT_TOOLS`), `server/tools/movie.py`
(`r_assist`, les modes), `server/tools/montage.py` (l'en-tête), `server/tools/ideation.py` (`r_lot`, `LOT_MAX`),
`musique/generatif_modeles.json` (`intentions`), les `jobs.register` de tous les outils ; `docs/REPRISE.md`,
`docs/ARCHITECTURE.md`, les études `agent_showrunner.md`, `agent_design.md`, `mode_showrunner.md`,
`orchestration.md`, `presentations_motion.md`, `ideation*.md`, `transcrire.md`, `upscale.md`, `lora_entrainement.md`,
`movie.md`.

**Sur le web** (09/10/2026) :

1. Agent Skills, spécification, https://github.com/agentskills/agentskills/blob/main/docs/specification.mdx (lu).
2. Anthropic, « Building effective agents », https://www.anthropic.com/research/building-effective-agents (lu).
3. vLLM, « Tool Calling », https://github.com/vllm-project/vllm/blob/main/docs/features/tool_calling.md (lu).
4. Ollama, « Structured outputs », https://github.com/ollama/ollama/blob/main/docs/capabilities/structured-outputs.mdx (lu).
5. Ollama, « Embeddings », https://github.com/ollama/ollama/blob/main/docs/capabilities/embeddings.mdx (lu) ; « API »,
   https://github.com/ollama/ollama/blob/main/docs/api.md (relu le 09/10 : pas de `tool_choice`, les temps rendus) ;
   l'appel d'outils, la pensée, la vision, le contexte : `agent_showrunner.md` [5]-[10].
6. Qwen, « Function Calling » : `agent_showrunner.md` [11] ; débits sur DGX Spark : `agent_showrunner.md` [15]-[17].
7. Model Context Protocol, spécification 2025-06-18,
   https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2025-06-18/index.mdx (lu).
8. aurelio-labs, semantic-router, https://github.com/aurelio-labs/semantic-router (lu).
9. Wu et al., « StateFlow: Enhancing LLM Task-Solving through State-Driven Workflows », arXiv 2403.11322, NeurIPS 2024
   (atelier) (extraits).
10. LangChain, « Plan-and-Execute Agents », https://blog.langchain.com/planning-agents (extraits).
11. sierra-research, τ-bench, https://github.com/sierra-research/tau-bench (lu) ; Yao et al., « τ-bench », arXiv
    2406.12045 (extraits : pass^k).
12. BFCL : `orchestration.md` § 1.2 (données du 12/04/2026) ;
    https://raw.githubusercontent.com/ShishirPatil/gorilla/main/berkeley-function-call-leaderboard/README.md (lu :
    les catégories de V4).
13. icip-cas, PPTAgent / DeepPresenter, https://github.com/icip-cas/PPTAgent (lu).
14. Presenton, https://github.com/presenton/presenton (lu).
15. LTX Studio, « AI storyboard generator », https://ltx.io/studio/platform/ai-storyboard-generator et
    https://ltx.studio/blog/how-to-create-a-consistent-character ; diyai.io, « AI Storyboard Generator 2026 »
    (extraits).
16. Gamma, le plan avant le deck : mindstudio.ai, uxplanet.org (tiers, extraits).
17. Descript, « Underlord », https://help.descript.com/hc/en-us/articles/36803785502221 et
    https://www.descript.com/underlord (extraits).
18. akatz-ai, « MiniMax-H3-Person-Remover-LoRA », https://huggingface.co/akatz-ai/MiniMax-H3-Person-Remover-LoRA, et
    le jeu `akatz-ai/H3-Person-Remover-v1` (pages refusées au robot ; extraits du moteur de recherche).
19. Lightricks, « LTX-2.5-22b-IC-LoRA-Clean-Plate », https://huggingface.co/Lightricks/LTX-2.5-22b-IC-LoRA-Clean-Plate ;
    LTX, « Video inpainting », https://ltx.io/model/capabilities/video-inpainting (pages refusées ; extraits).
20. Le LoRA voisin « Character Swap » (licence MiniMax H3, exclusion des États-Unis, de l'UE, du Royaume-Uni et de la
    Corée ; « long clips drift and hard cuts break ») :
    https://alphasignal.ai/news/akatz-labs-trains-minimax-h3-character-swap-lora-overnight-for-11 (extraits, source
    secondaire).

**Non lu** (à relire quand c'est possible) : les pages Hugging Face des deux LoRA de VFX et leurs licences ; la page
d'LTX ; le classement BFCL à jour ; les articles arXiv en entier ; les skills de Ming-Image et l'annonce du modèle 125 B
NVFP4 (`veille_1009.md`) ; les discussions N_PIPE_CHATBOT (§ 11) ; les études gardées sur le PC (`agent_brief.md`,
`positionnement.md`, `modeles.md`, `pipeline_video.md`, `presentations.md`, `package_export.md` — REPRISE § 6) et
`panneau_asset.md`.
