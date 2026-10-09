# Étude — l'agent design (06/10/2026)

> **09/10** : `agent_autonome.md` reprend D1-D10 (§ 10, A10) et fait charger les compétences par le code ; l'agent design y devient la skill « slides » (lot 4).

Demande de Cal (06/10) : « c'est quoi la passe assistée ? on n'a pas un vrai agent qui travaille cela, donc il
en faudra un à un moment, avec des skills en design, et qui peut changer des trucs avec des briefs du user en
langage naturel. »

RIEN N'EST CODÉ. Cette étude dit ce qui existe, ce que font les autres, et propose une architecture.

## En bref

- **La passe assistée** (`ideation/presentation/assist.js`) n'est pas un agent : ce sont cinq règles écrites
  (lire, hiérarchie, grille, contraste, rythme). La même planche donne toujours la même proposition. Elle ne lit
  aucun brief, ne voit aucune image et réécrit toutes les diapositives d'un coup.
- **L'agent design ne serait pas un second agent.** C'est l'agent Showrunner d'Idéation
  (`server/tools/ideation_agent.py`) avec des outils de design en plus. Les rails ne changent pas :
  - il lit au serveur ;
  - ses écritures sont validées, puis rendues en actions ;
  - un tour = un `app.mutate`, que Ctrl+Z annule ;
  - il ne lance jamais de rendu sans la personne.
- **Le principe** : le modèle choisit l'INTENTION, dans un vocabulaire fermé (un style nommé, un ton de la
  palette, des colonnes de la grille, un effet du schéma). Le moteur déterministe en tire la géométrie et les
  durées exactes. Le résultat tient la grille et le contraste **par construction**, pas par une boucle qui
  vérifie et relance.
- **Les « skills »** : six fichiers de consignes (format Agent Skills : un `SKILL.md` par compétence), chargés
  selon la tâche :
  - typographie ;
  - grille ;
  - couleur et contraste ;
  - rythme et motion ;
  - mise en page ;
  - jetons.

  Leurs seuils sont des données (`regles.json`), mesurées par le moteur et par le contrôle.
- **Voir la diapositive** : un rendu par Chromium sans affichage sur DGX2, avec la même scène que le mode
  (`scene.js`). C'est le rendu que l'export PNG et PDF attend déjà (`presentations_motion.md` § 7). Le modèle
  qui voit le regarde ; il ne mesure rien au pixel.
- **Le modèle** : `qwen3-vl-32b-32k` d'Ollama sur DGX2, déjà là (REPRISE § 7). Deux choses restent à vérifier :
  - ses capacités `tools` et `vision`, par le diagnostic « Agent Showrunner » (branche `wip2/agent-page`) ;
  - sa justesse au banc d'essai (§ 4.8).

  `mistral-small3.2:24b`, présent sur les deux DGX, voit et appelle des outils : c'est le second candidat.
  Rien à télécharger.

## 1. Ce qui existe

### 1.1 La passe assistée (`assist.js`, lu le 06/10)

Ce qu'elle fait, dans l'ordre du code :

1. **Lire.** Chaque objet d'une diapositive prend une part (`scene.js`, `partOf`) :
   - une image ≥ 45 % de la surface est « plein cadre » ;
   - un texte qui commence par « ou " est une citation ;
   - un nombre court en Display, H1 ou H2 est un chiffre (`isFigure`) ;
   - le reste se lit par le style : titre, surtitre, corps, légende.

   Chaque diapositive prend un rôle (`roleOf`) : la première est le titre, la dernière la fin (s'il y en a plus
   de deux), puis image, citation, chiffres, grille, section, contenu.
2. **Hiérarchie.** Une part → un style nommé :
   - le titre d'une diapositive de titre, de section, d'image ou de fin → Display (H1 au-delà de trois lignes,
     mesurées au canvas dans la police du style) ;
   - surtitre → Étiquette ;
   - chiffre → Display ;
   - citation → H1 ou H2 selon sa longueur (90 signes) ;
   - le reste → Corps, Légende.
3. **Grille** (12 colonnes, marges 96, gouttière 24, ligne de base 8 : `DECK_GRID`) :
   - le texte s'empile dans une colonne avec des écarts fixes selon le style (de 20 après une Légende à 40
     après un Display) ;
   - il se cale en bas, au centre ou en haut selon le rôle ;
   - une image seule sur une diapositive de titre, de section, d'image ou de fin passe plein cadre, derrière ;
   - plusieurs images → des colonnes égales ;
   - sur une diapositive de contenu, les images vont sur les colonnes 7 à 12.
4. **Contraste.** Sur une image : un voile (`tone: veil`) et l'encre claire. Ailleurs : l'encre (`ink` ou
   `inverse`) au meilleur rapport WCAG sur le fond, calculé sur la palette. Le rapport l'écrit (AAA, AA,
   « AA grands textes », « faible »).
5. **Rythme.** L'entrée de chaque part vient du modèle, décalée par son `rhythm` dans l'ordre de lecture. Une
   diapositive qui reprend un objet de la précédente passe en morph ; les autres prennent la transition de leur
   rôle.

Le modèle proposé, quand on n'en a ni essayé ni appliqué (`recommend`) :

| ce qu'elle compte | le modèle |
|---|---|
| 2 chiffres ou plus | Lumière |
| au moins un plein cadre pour trois diapositives | Générique |
| des textes de plus de 140 signes en moyenne | Revue |
| au moins autant d'images que de diapositives | Toile |
| sinon | Métronome |

Le résultat est une **copie** de la planche. Le mode la montre en avant / après (une ligne qu'on glisse) avec
un rapport par diapositive ; « Appliquer la passe » l'écrit en un seul `app.mutate` (`applyProposal`).

**Ses limites** (lues dans le code, pas supposées) :

- **Aucun brief.** Elle ne prend pas de texte ; « plus sobre », « ralentis la 3 » ou « le titre est trop long »
  ne peuvent pas lui être dits.
- **Tout ou rien.** Elle traite toutes les diapositives de la planche. Elle replace chaque texte et chaque
  image (`x, y, w, h`) et réécrit leurs `style, align, tone, motion`, et le `deck` des cadres : ce que la
  personne avait calé à la main est perdu. On accepte ou on refuse le tout ; il n'y a ni portée « cette
  diapositive », ni règle qu'on décoche.
- **Elle ne voit rien.** Le rôle d'un objet est deviné par sa forme (guillemet, nombre, taille), jamais par son
  sens. Une image est recadrée au centre (`object-fit: cover`, `presentation.css`), sans savoir où est le
  sujet.
- **Le contraste est supposé sur une image.** Il est calculé sur la palette, jamais sur les pixels réels sous
  le texte. Un « faible » est écrit dans le rapport, pas corrigé.
- **Le débordement n'est pas vu.** L'empilement ne vérifie pas que le texte tient dans la diapositive : trop
  de texte sort par le bas, sans réduction ni coupe.
- **Des objets ignorés.** Les formes (`shape`) gardent leur place. L'objet Texte riche (`text`), les cartes,
  le Web et le reste sont « autres » et restent où ils sont. Le nouveau gabarit peut donc les recouvrir.
- **Les traits** sont seulement recalés en x sur une colonne.

L'en-tête d'`assist.js` le dit déjà : « Un LLM local (Ollama sur les DGX : qwen3-vl) pourrait un jour juger
l'image rendue ; il n'est pas appelé ici — les règles suffisent et restent vérifiables. » Cette étude garde
cette phrase comme règle : **les règles restent au code, le modèle juge et choisit.**

### 1.2 L'agent Showrunner (`ideation_agent.py`, étude `agent_showrunner.md`)

- **Le tour** :
  - `POST /api/ideation/agent {board, messages, intent?}` met en file un travail `ideation.agent` ;
  - il tourne sur la voie `audio`, épinglée sur la machine de l'Ollama, famille `ollama-agent`, 31 Go ;
  - le modèle est déchargé à la fin (`keep_alive: 0`).

  Pourquoi par la file : 30,8 Go de mémoire GPU à côté d'un rendu H3 de 100 Go a gelé DGX2 le 24/09
  (`orchestration.md` § 3.1).
- **La boucle** :
  - Ollama `/api/chat` avec `tools`, au plus 12 appels (`MAX_STEPS`) ;
  - `think: false` si le modèle pense ;
  - `num_ctx` 32 768 (réglage `ideation_agent_ctx`).
- **Les lectures**, exécutées au serveur : `lire_planche`, `lire_document`, `decrire_image` (un appel à part
  du même modèle, avec l'image en base64 réduite à 1024 px), `chercher_bibliotheque`.
- **Les écritures**, validées puis rendues en actions `{tool, args, why, id?}` : `poser_texte`,
  `poser_cadre`, `ranger`, `grouper`, `poser_asset`, `carte_image`, `carte_video`, `composeur`, `relier`,
  `renommer_planche`, `deplacer`.
  - Une écriture refusée revient au modèle avec sa raison (« n99 n'est pas sur la planche »), et il corrige.
  - Au plus 60 gestes par tour.
- **Des identifiants, jamais des coordonnées.** L'agent place par `dans` (un cadre) et `pres_de` (un objet) ;
  la page calcule la place. Un modèle de langue place mal au pixel (décision 5 de l'étude).
- **Jamais un rendu sans la personne.** `lancer` est faux par défaut ; une carte Générer est posée prête.
- **La page** (`ideation/agent.js`) existe sur la branche `wip2/agent-page` (8e34600), pas encore fusionnée :
  - un tour est réclamé (`claim`), puis posé dans UN `app.mutate` par des fonctions pures ;
  - « Annuler ce tour » retire ce qu'il a créé et remet ce qu'il a changé ;
  - `app.agent = {open, send, busy}`.
- **Le diagnostic** « Agent Showrunner » (`tools/diag_agent.py`, même branche, b289ae9) lit le `/api/show`
  d'Ollama : `tools`, `vision`, `thinking`, le `num_ctx` du Modelfile.
- **Rien n'a tourné sur le vrai modèle** : tout est essayé contre `tools/faux_ollama.py`.

### 1.3 Le mode Présentation et le motion (`ideation/presentation/`, `presentations_motion.md`)

- **Le mode** (`mode.js`) est une vue par-dessus l'Idéation :
  - le plan des diapositives à gauche, la scène au centre ;
  - la minuterie dessous : une piste par objet ; glisser une barre change le délai, l'étirer la durée ;
  - l'inspecteur à droite : Modèles, Diapositive, Objet ;
  - en haut, une seule action orange : la passe assistée.

  Tout ce qui change le document passe par `app.mutate`.
- **La scène** (`scene.js`) est le rendu unique. Le mode, le lecteur plein écran et la page d'impression
  (`lecture.html?print`) s'en servent tous. Les couleurs viennent de la palette du modèle (`--t-*`), sinon des
  jetons du thème.
- **Le moteur de motion** (`moteur.js`) est déclaratif : des données bornées par `schema.json`, jamais du code.
  - 18 entrées, 7 sorties, 6 boucles, 8 courbes, 8 transitions, 8 tons, des bornes : durée 0–6000 ms,
    décalage 0–1000 ms, délai 0–20 000 ms.
  - Le serveur borne les mêmes champs (`presentation.py`, `clean_motion`).
- **La frise** est exacte (`seek(t)`) : un export image par image est possible.
- **Dix modèles** (`modeles/*.json`), chacun des données :
  - une palette de neuf rôles ;
  - six styles de texte ;
  - un fond par rôle de diapositive ;
  - un décor ;
  - un motion : un rythme, des transitions par rôle, une entrée par part ;
  - un exemple de 7 ou 8 diapositives.
- **Ce que disent leurs chiffres** (relevé dans les fichiers le 06/10) :
  - les cinq modèles animés ont des entrées de 700 à 2600 ms et des rythmes de 90 à 260 ms ;
  - la machine à écrire va de 30 à 40 ms par signe ;
  - le rapport Display / Corps va de 4,3 (Générique) à 7,1 (Atelier).
- **Non fait** : l'export PNG d'une diapositive dans l'habit de son modèle. L'export actuel (PIL) l'ignore. La
  page d'impression pose `body.dataset.ready` pour un Chromium sans affichage, mais le script d'export n'existe
  pas.

### 1.4 Ce que la planche expose comme gestes

- **`app.mutate(fn)`** (`ideation/ideation.js`) :
  1. un instantané (`app.snap` : nom, objets, liens, `pres`) ;
  2. puis `fn(S.board)` ;
  3. puis `commit` : rendu, enregistrement, co-édition.

  `app.undoStep()` remet l'instantané. `app.quiet` change sans pas d'annulation (un travail qui avance).
- **Les objets** (`server/tools/ideation.py`, `TYPES`) : `media`, `note`, `sticky`, `title`, `frame`, `gen`,
  `vgen`, `compose`, `palette`, `group`, `shape`, `card`, `mind`, `ink`, `web`, `text`, `model3d`, `moodboard`.
  - Un cadre qui porte `deck` est une diapositive de taille fixe (`DECK_RATIOS` : 1920 × 1080 en 16:9).
- **Les styles** : six styles nommés (`TEXT_STYLES` : Display, H1, H2, Corps, Légende, Étiquette), changés par
  planche dans `pres.styles` (bornés par `_pres` : taille 6–400, interligne 0,7–3, approche −0,2–1, graisse
  100–900).
  - Un titre ou une note « Aucun » porte ses propres `font`, `fs`, `color` et `bg` (`diapo/libre.js`).
  - Les couleurs d'un texte libre sont des jetons (`TEXT_COLORS`), jamais des valeurs.
- **Les polices** (`FONTS`) : chacune déclare sa licence et ce qu'elle permet (`web`, `pdf`). Norelli n'entre
  jamais dans un style.
- **La grille** : `DECK_GRID` ; l'aimant des colonnes pendant un geste (`diapo/index.js`) ; les guides
  magnétiques à 6 px d'écran (`objets/guides.js`).
- **Le motion et les tons** : `motion`, `tone` d'un objet ; `motion` d'un cadre (`trans`, `tdur`, `ease`,
  `bg`, `auto`) ; `pres.template` de la planche.

## 2. Le marché : éditer un design par un brief

Presque toutes les pages des éditeurs sont refusées au robot de cette session : canva.com, figma.com,
gamma.app, helpx.adobe.com, adobe.design, techcrunch.com, arxiv.org (« blocked by the network egress
proxy »). Ce qui suit est lu dans les extraits du moteur de recherche, sauf mention « lu ».

| outil | ce qui est documenté | source |
|---|---|---|
| **Canva AI** | « describe what you want to change, and the agent reads your design, figures out the edits, and applies them directly on the canvas » ; des demandes vagues (« make it better ») ou précises (« make the headline larger and change the background to blue ») | [1] |
| **Ask Canva** | on sélectionne un élément ou une page, puis Ask Canva : des suggestions selon la sorte (texte : réécrire, améliorer ; image : changer de style ; page : « give me design advice ») ; on **remplace** ou on **ajoute** | [2] |
| **Canva AI 2.0** (15/04/2026) | un « Canva Design Model » qui rend des objets **en calques modifiables**, pas une image plate ; l'orchestration d'outils ; une « Memory Library » des préférences et des styles de marque | [3] |
| **Figma, l'agent design** (20/05/2026) | un agent sur le canevas partagé : il crée, itère, fait des retouches en lot « using your real components, tokens, and variables, not placeholders » | [4] |
| **Figma, les skills** | « Skills are markdown files that teach Figma AI agents how your team works », quels composants prendre, dans quel ordre, quelles conventions ; neuf skills de la communauté au lancement (`/apply-design-system`, `/sync-figma-token`…) | [5] |
| **Figma Make** | « point to an element and describe the change you want » | [6] |
| **Gamma Agent** (Gamma 3.0, 09/2025) | un panneau de conversation (Ctrl+E), pour tout le deck ou une carte : « switch to a dark theme », « make the typography larger throughout » ; un thème changé recalcule espacements, typographie et flux | [7] |
| **Pitch Agent** | des présentations « on-brand » faites depuis les modèles de l'équipe, puis affinées par la conversation (réécrire, restructurer) | [8] |
| **Adobe Express, AI Assistant** (bêta, 10/2025) | il modifie un calque à la fois (polices, images, fonds) « while keeping the rest of the design intact » ; il traduit une demande vague (« pop more ») en changements précis ; un interrupteur passe de l'assistant à l'édition manuelle, dans le même document en calques | [9] |
| **Recraft** | un mode conversation ; des styles de marque verrouillés (palette, illustration) appliqués d'une génération à l'autre ; l'édition en langage naturel passe par des modèles externes | [10] |
| **Higgsfield Supercomputer** | des « skills » en place de marché (charte de marque, kit visuel, système de marque) ; un point d'arrêt chiffré avant chaque génération payante (`agent_showrunner.md` § 1) | [11] |
| **PowerPoint Designer** | un panneau d'idées de mise en page, tirées du contenu de la diapositive, parmi lesquelles on choisit | [12] |

**Ce que dit la recherche** :

- **Éditer vaut mieux que générer.** PPTAgent (lu [13]) : « a two-stage, edit-based approach ». Il analyse
  des présentations de référence, puis « iteratively generates editing actions based on selected reference
  slides ». Un modèle qui voit sert de relecteur. L'évaluation PPTEval porte sur trois axes : « Content,
  Design, and Coherence ».
- **Regarder son rendu aide.** AutoPresent (CVPR 2025, lu [14]) écrit des diapositives en code avec une
  bibliothèque d'actions (SlidesLib). L'étape de raffinement donne au modèle sa consigne, son programme et
  « a snapshot of the rendered slide » ; il retouche couleurs et espacements, et la qualité monte.
- **Critiquer marche mieux avec des exemples.** UICrit (UIST 2024 [15]) : 3 059 critiques de designers sur
  983 écrans ; des exemples dans la consigne et des repères visuels donnent « a 55% performance gain ».
- **Les heuristiques écrites trouvent des défauts fins.** Duan et al. (CHI 2024 [16]) font évaluer 51
  interfaces par un modèle, sur des heuristiques écrites :
  - 9 % des défauts ne sont trouvés que par lui, surtout « poor text contrast » et « misalignment » ;
  - 29 % sont trouvés par lui et par les experts.

**Ce qu'on retient** :

1. **Modifier les vrais objets, jamais une image plate** (Adobe, Canva 2.0, Figma). Chez nous, c'est déjà la
   règle : les objets de la planche.
2. **Le système de design d'abord** : composants et jetons chez Figma, kits de marque chez Gamma, Canva et
   Recraft. Chez nous, ce sont le modèle de présentation (palette par rôles, six styles, famille de motion) et
   les jetons du thème. L'agent n'invente pas de couleur.
3. **Les skills en fichiers markdown** (Figma, Higgsfield, et le format ouvert Agent Skills [17]).
4. **Deux portées** : tout le deck (Gamma), ou ce qu'on a désigné (Ask Canva, Figma Make). Chez nous :
   les diapositives ou objets cités, sinon tout.
5. **Traduire le vague en gestes précis** (Adobe) : c'est le travail du modèle, dans notre vocabulaire fermé.
6. **Montrer avant d'écrire, et laisser choisir** (PowerPoint Designer, « remplacer / ajouter » de Canva, le
   point d'arrêt de Higgsfield). Chez nous : l'avant / après que la passe a déjà.
7. **Éditer par actions, et regarder le rendu** (PPTAgent, AutoPresent).

**Ce qu'on fait autrement** :

- Pas de modèle fermé, pas de « Design Model » propriétaire : Ollama sur les DGX.
- Pas de mémoire de marque entre projets : non demandé. La mémoire, c'est la planche, son modèle et sa
  conversation.
- Chaque geste est listé, se montre d'un clic et se défait avec tout le tour (comme l'agent Showrunner) ; et le
  rapport chiffré de chaque règle, que la passe donne déjà.

## 3. Les compétences de design (« skills »)

### 3.1 Le format

- **Le format Agent Skills** (spécification lue [17]) :
  - un dossier par compétence, avec un `SKILL.md` et, au besoin, `scripts/`, `references/`, `assets/` ;
  - en tête, `name` (64 signes au plus, minuscules, chiffres, traits d'union) et `description` (1024 signes au
    plus : ce qu'elle fait et quand s'en servir).
- **Le chargement progressif** :
  - le nom et la description de chaque compétence sont lus au départ (« ~100 tokens ») ;
  - le corps est lu quand la compétence sert (« under 5000 tokens recommended ») ;
  - les fichiers joints, seulement s'il le faut.
  - La spécification conseille un `SKILL.md` de moins de 500 lignes.
- **Chez nous** :
  - `ideation/presentation/competences/<nom>/SKILL.md` : la consigne, pour le modèle ;
  - `ideation/presentation/competences/regles.json` : les seuils. C'est une seule vérité, comme
    `schema.json` : lue par le moteur (la page et le rendu), par le serveur et par le contrôle.
- **Le budget** : avec 32k de contexte, un corps de compétence tient en 1 500 jetons environ, plus serré que
  la spécification.
- **Le chargement** :
  - la consigne système liste les six descriptions ;
  - le modèle lit un corps par un outil de lecture (`lire_competence`) ;
  - le serveur précharge `jetons` et `mise-en-page` pour tout tour de design, car elles disent le vocabulaire
    des outils.
- **La langue** : le corps est en anglais, comme la consigne actuelle (`system_prompt`), avec un résumé
  français en tête pour Cal (décision D8).

### 3.2 Les six compétences, et comment on les vérifie

Chaque règle porte sa source, ou « notre choix ». Le dernier cas est un seuil à faire valider par Cal (D10).

| compétence | ce qu'elle dit au modèle | règles mesurables (seuil, source) | qui mesure |
|---|---|---|---|
| **typographie** (typographie et hiérarchie) | les six styles et leur rôle par part (la règle 2 de la passe) ; un seul niveau de titre par diapositive ; pas de texte sans style sur une diapositive à modèle | chaque texte d'une diapositive porte un style nommé (sinon « Aucun » est signalé) ; Display ≤ 3 lignes (la passe) ; Corps : 45 à 90 signes par ligne en moyenne et interlignage de 120 à 145 % [20] ; polices de `FONTS` permises au web et au PDF pour publier | le moteur (styles), l'audit (lignes, longueur, au rendu), `_pres` (polices) |
| **grille** (grille et alignement) | 12 colonnes, marges 96, gouttière 24, ligne de base 8 ; on place en colonnes, jamais en pixels | bords gauche et droit sur un bord de colonne ; `y` multiple de 8 ; rien dans la marge sauf un plein cadre bord à bord ; deux textes ne se chevauchent pas ; aucun texte ne dépasse la marge du bas (notre choix, tolérance 0 pour le moteur) | le moteur (par construction), l'audit (ce que la personne a posé) |
| **couleur** (couleur et contraste, WCAG) | les rôles de la palette (`tone`) ; l'encre la plus lisible sur le fond ; un voile sur une image | texte courant ≥ 4,5:1, grand texte ≥ 3:1 (AA, 1.4.3) ; 7:1 et 4,5:1 en AAA (1.4.6) ; « grand » = 18 pt, ou 14 pt gras, soit 24 px, ou 18,7 px gras [18] ; trait ou forme qui porte du sens ≥ 3:1 (1.4.11) ; **texte sur image : le rapport mesuré sur les pixels réels sous la boîte**, texte masqué (nouveau) | le moteur (choix de l'encre, du voile), l'audit au rendu |
| **rythme** (rythme et motion) | la famille du modèle (ses entrées par part, ses courbes, son rythme) ; « plus lent » ou « plus vif » est un facteur, pas une valeur | effets, courbes et transitions de `schema.json`, avec ses bornes (par construction) ; délais croissants dans l'ordre de lecture (la passe) ; pas plus de courbes que le modèle n'en a sur une même diapositive (notre choix) ; apparition complète d'une diapositive ≤ 3 s (notre lecture du « glance test » [21]) ; boucle d'au moins 1000 ms (notre choix ; WCAG 2.3.1 interdit plus de trois flashs par seconde [18], or le schéma permet aujourd'hui une boucle de 0 ms) ; avec `prefers-reduced-motion`, l'état final = l'impression (`moteur.js`, déjà) | le moteur, `clean_motion`, l'audit (la frise) |
| **mise-en-page** (mise en page de diapositive) | les huit rôles et leur gabarit (plein cadre, texte en colonne calé, chiffres sur colonnes égales, grille d'images, citation centrée col. 3 à 10, contenu : texte col. 1 à 6, images col. 7 à 12) ; une idée par diapositive | nombre d'objets et de mots par diapositive (seuil à fixer ; proposition : 40 mots hors citation, notre choix) ; une diapositive se comprend en 3 secondes (« glance test » de Duarte [21] : un jugement, pas une règle, laissé au modèle qui voit) | l'audit (comptes), le modèle (jugement) |
| **jetons** (cohérence avec les jetons) | l'interface prend les jetons de `commun/tokens.css` (REPRISE § 1) ; une scène prend la palette de son modèle, sinon les jetons du thème ; jamais une valeur de couleur | aucune valeur de couleur dans une action (les arguments sont des listes fermées) ; les styles de la planche = ceux du modèle appliqué, sauf ce que la personne a changé ; les couleurs d'un texte libre dans `TEXT_COLORS` | le serveur (validation), `_node` et `_pres` |

**Les durées de Material 3** (lu [19]) vont de 50 ms (`short1`) à 1000 ms (`extra-long4`). La courbe
« standard » est `cubic-bezier(0.2, 0, 0, 1)`, déjà dans `moteur.js`. Elles valent pour l'interface du
portail, pas pour une diapositive : les modèles animés ont des entrées de 700 à 2600 ms, et c'est voulu
(générique de cinéma, keynote). La compétence `rythme` prend donc **le modèle comme référence**, pas Material.

**À noter** : le lecteur n'a pas de pause des boucles (`lecteur.js` : le clavier avance, recule, va au début
ou à la fin, sort, passe en plein écran). Une boucle de plus de 5 s à côté d'un autre contenu demande une pause
(WCAG 2.2.2 [18]). Une présentation projetée est-elle une « activité où le mouvement est essentiel » ? Non
tranché.

### 3.3 Vérifier : par construction, pas par relance

Cal veut « une méthode robuste, pas des filtres qui vérifient et relancent au cas par cas ». La vérification
se fait donc à trois étages, et aucun ne redemande au modèle :

1. **Par construction (le moteur).**
   - Les outils d'écriture ne prennent que des intentions dans des listes fermées : un style, un ton, des
     colonnes de 1 à 12, un effet du schéma, « plus lent ».
   - Le moteur en tire x, y, w, h, les durées et les délais. Il ne peut pas produire un objet hors grille ni
     une couleur hors palette.
   - Le serveur valide les arguments comme l'agent Showrunner. Il refuse avec la raison (« colonnes 9 à 14 :
     la grille en a 12 »), et c'est le modèle qui corrige dans sa boucle, comme aujourd'hui.
2. **Mesuré et dit (l'audit, `mesurer`).**
   - Le rapport de chaque diapositive, avant et après, comme celui de la passe, mais chiffré : contraste
     4,8:1 (AA), 2 objets hors grille, 62 signes par ligne, apparition en 2,4 s.
   - Il sert au modèle (il raisonne sur des faits, pas sur des pixels) et à la personne (le rapport sous
     l'avant / après).
   - Il ne bloque rien.
3. **Contrôlé (`tools/check.py`).**
   - Le moteur passe ses propres règles sur les dix exemples des modèles, et sur ces exemples dégradés exprès
     (décalés, mal stylés, peu contrastés).
   - Chaque seuil de `regles.json` existe dans le code, comme chaque effet de `schema.json` existe dans
     `moteur.js` aujourd'hui.

## 4. L'architecture proposée

### 4.1 Le principe : le modèle choisit, le moteur calcule

| le modèle (Ollama) | le moteur (le code) |
|---|---|
| comprend le brief (« plus sobre », « ce titre est trop long », « ralentis la 3 ») | calcule la géométrie sur la grille (les règles d'`assist.js`, devenues des fonctions pures par diapositive) |
| choisit quoi changer : quelles diapositives, quels objets, quel modèle | mesure les textes dans leur police (`textHeight`), choisit l'encre et le voile |
| regarde le rendu : ce que montre l'image, où est son sujet, si le titre le cache, si la diapositive se lit | tire les durées et les délais de la famille du modèle, dans les bornes du schéma |
| écrit ou raccourcit un texte, **seulement si on le lui demande** | applique tout dans une copie, rend l'avant / après et le rapport |
| explique en une phrase par geste (`pourquoi`) | écrit en un `app.mutate` quand la personne applique |

Les actions sont des **intentions sur des identifiants**, recalculées sur la planche du moment. Si quelqu'un
co-édite pendant le tour, un objet disparu le dit dans la ligne de l'action, sans casser le reste (la règle
de la page de l'agent, `claim` puis `applied`).

### 4.2 Les rails repris tels quels

- Le même agent, le même panneau, **la même conversation par planche**. Pas de second agent (D1).
- La même route `POST /api/ideation/agent`, avec `intent: "design"`. Le mode Présentation l'envoie, avec les
  diapositives ou objets désignés en `items`.
- Le même travail `ideation.agent` par la file : voie `audio` épinglée, 31 Go, modèle déchargé en fin de tour.
- Les mêmes lectures au serveur, et les écritures validées puis rendues en actions.
- **Jamais un rendu sans la personne.** Si le brief demande une meilleure image, l'agent pose une
  `carte_image` prête (l'outil existe). Il ne lance ni rendu, ni export PNG, PDF ou vidéo.
- **Dans le mode Présentation**, le résultat d'un tour de design est une **proposition**, comme celle de la
  passe : une copie, l'avant / après (la ligne qu'on glisse), le rapport par diapositive, puis
  « Appliquer », le seul bouton orange, en un `app.mutate`. Ctrl+Z l'annule (D2).

### 4.3 Les outils de design (en plus de ceux de l'agent Showrunner)

| lecture (le serveur) | écriture (actions ; le moteur les calcule) |
|---|---|
| `lire_diapos {diapos?}` : le résumé de chaque diapositive (rôle, parts, styles, tons, places en colonnes, motion, modèle) | `passe_assistee {diapos?, modele?}` : la passe telle qu'elle est, devenue un outil, avec une portée |
| `mesurer {diapos?}` : l'audit chiffré (§ 3.3) | `appliquer_modele {modele}` |
| `regarder_diapo {diapo, question?, proposition?}` : le rendu, regardé par le modèle (§ 4.4) ; avec `proposition`, la diapositive après les gestes du tour | `style_texte {ids, style}` : display, h1, h2, body, caption, label |
| `lire_competence {nom}` | `ton {ids, ton}` : un rôle de la palette (`schema.json`) |
| `lire_modele {id}` : palette (des rôles), styles, famille de motion | `disposer {diapo, disposition, ancre?}` : auto, plein_cadre, texte_image, image_texte, colonne, citation, chiffres, grille ; ancre haut, centre ou bas |
| | `placer {ids, colonnes: [de, a], ancre?}` : en colonnes de la grille, jamais en pixels |
| | `animer {ids \| diapo, entree?, par?, courbe?, rythme?, etape?}` : un effet du schéma ; `rythme` vaut plus_lent, plus_vif ou modele |
| | `transition {diapo, sorte, duree?}` · `fond {diapo, fond}` |
| | `recrire {id, texte}` : seulement sur demande explicite ; une ligne à part dans le rapport (D9) |

Les petits modèles tiennent un appel isolé mieux qu'une longue conversation : au BFCL V4, Qwen3-4B réussit
87,9 % des appels isolés, mais 22,1 % en plusieurs tours (`orchestration.md` § 1.2). D'où des outils de haut
niveau : **un appel = une intention**, et peu d'étapes par tour.

### 4.4 Voir la diapositive : le rendu

- **Où.** Un Chromium sans affichage sur DGX2, qui a déjà Playwright (`tools/shot.mjs` se sert de celui de
  `~/Character_Sheet`).
  - Un script `tools/regard.mjs` charge la page de lecture (`lecture.html?print`, qui pose déjà
    `body.dataset.ready`).
  - Pour une proposition, il applique les actions du tour **avec les mêmes modules JS** que la page, dans une
    copie.
  - Il rend une capture par diapositive, plus les mesures qui demandent la page : lignes, débordements, et le
    fond réel sous chaque texte (rendu une fois sans les textes).
  - C'est **le même rendu** que l'export PNG et PDF attendu (`presentations_motion.md` § 7) : une seule
    vérité, `scene.js`.
- **Pourquoi pas autre chose** :
  - l'export PIL ignore le modèle ;
  - le navigateur n'a pas d'API standard pour peindre un élément en image : la proposition WICG
    « HTML-in-Canvas » (`drawElementImage`) n'est qu'en essai d'origine, dans Chromium seul [27].
- **L'accès.** Le rendu doit lire la planche, ou la proposition, et ses images. Proposition : un jeton de
  lecture à usage unique, limité à la planche et à la boucle locale. À concevoir avec la garde de la porte.
- **Le regard** fonctionne comme `decrire_image` aujourd'hui :
  - un appel à part du même modèle, avec l'image réduite à 1024 px ;
  - une **sortie structurée** (`format` : un schéma JSON, que les modèles qui voient prennent aussi [26]) :
    lisible ou non, le sujet de chaque image et son point focal, les problèmes avec leur zone en coordonnées
    relatives, des propositions ;
  - le serveur traduit chaque zone en **identifiants d'objets** (l'objet dont la boîte la contient) ;
  - le résultat revient en texte dans la boucle. Le modèle ne mesure rien au pixel.
- **Le motion** se regarde en trois images de la frise (début, milieu, fin : `seek(t)`), plus ses données. Le
  modèle juge le rythme sur les chiffres, pas sur une vidéo.
- **Le coût en contexte.** Qwen3-VL découpe l'image en carreaux de 16 px, fusionnés 2 × 2 (lu dans
  `configuration_qwen3_vl.py` [23]), soit un jeton par carré de 32 px. Une diapositive à 1024 × 576 coûte
  donc environ 32 × 18 = 576 jetons, et un avant / après environ 1 150. C'est un calcul : le compte réel
  d'Ollama est à lire dans `prompt_eval_count`.
- **Le temps** (lancer Chromium, rendre, charger le modèle à chaque tour) : **non mesuré**.

### 4.5 Le modèle local

| | `qwen3-vl-32b-32k` | `mistral-small3.2:24b` |
|---|---|---|
| sur les DGX | les deux ; GGUF Q4_K_M de 20,9 Go, **30,8 Go chargé** à 32k (`orchestration.md` § 2.2) ; DGX2 (REPRISE § 7) | les deux, 15 Go (`transcrire.md`, relevé `ollama list`) |
| voit, appelle des outils | la page d'Ollama de `qwen3-vl` annonce `vision`, `tools`, `thinking` [24] ; Qwen annonce un « Visual Agent » qui « invokes tools » [22] ; **le nom de Cal est un Modelfile à lui : à vérifier** par le diagnostic « Agent Showrunner » | la page d'Ollama annonce la lecture d'images et les outils, 128k de contexte [25] ; la même page : « improves on function calling » [25] |
| repérer une zone dans l'image | « Precise Object Grounding », en coordonnées relatives [22] ; l'échelle exacte n'est pas dite dans le README : à essayer | non documenté ici |
| contexte | natif 256K [22] ; 32k réglé par Cal ; Ollama conseille au moins 64 000 jetons pour un agent (`agent_showrunner.md` [10]) | 128k [25] |
| français | non mesuré pour cet usage | « meilleur que Qwen3 en français » pour Transcrire (`transcrire.md`) |

**Recommandation (D3)** :
- `qwen3-vl-32b-32k` d'abord : un seul modèle qui voit et appelle des outils, déjà chargé par l'agent
  Showrunner, sans second modèle à recharger dans un tour ;
- `mistral-small3.2:24b` en second au banc d'essai (§ 4.8) ;
- `think: false` comme aujourd'hui.

**Le contexte (D4)** : 32k suffisent pour une diapositive à la fois :
- le résumé du deck : environ 300 jetons par diapositive ;
- deux compétences : environ 3 000 ;
- deux images : environ 1 150.

Le banc dira si un deck entier sature. La variante 64k coûte plus de mémoire GPU (non mesuré). C'est la même
question que celle de l'agent Showrunner, déjà posée à Cal.

### 4.6 Ce qui reste déterministe

- **La passe assistée garde son bouton**, sans modèle, instantanée, hors ligne. L'agent s'en sert comme d'un
  outil (`passe_assistee`), avec une portée (D10).
- La géométrie : la grille, l'empilement, la mesure des textes, les gabarits par rôle.
- Le contraste : le choix de l'encre et du voile, et désormais le fond mesuré sous le texte.
- Le motion : les valeurs viennent du modèle (`motionFor`) ; « plus lent » est un facteur borné par le
  schéma ; `prefers-reduced-motion` est géré par le moteur.
- L'audit, la validation des arguments, le rapport.
- **Le modèle de langue ne fait que** comprendre, choisir, regarder, expliquer (et réécrire sur demande).

### 4.7 Un tour, de bout en bout

Cal est dans le mode Présentation, la diapositive 3 choisie. Il tape : « plus sobre, et ce titre est trop
long ».

1. La page envoie `{board, messages: [{content, items: [f3]}], intent: "design"}`. Le travail part en file.
2. Le serveur prépare le message : la consigne de design, les six descriptions de compétences, `jetons` et
   `mise-en-page` préchargées, `lire_diapos(f3)` et `mesurer(f3)` déjà joints. Par exemple : « titre 4
   lignes en Display ; 3 entrées en flou ; contraste 5,1:1 ».
3. Le modèle appelle :
   - `lire_competence("rythme")` ;
   - `regarder_diapo(f3)`, qui rend : « le titre couvre le visage de l'image n12 ».
4. Il pose :
   - `recrire(t1, …)` : « trop long » est une demande explicite ;
   - `style_texte([t1], "h1")` ;
   - `animer(f3, entree: "fade", rythme: "plus_lent")` : « plus sobre » ;
   - `disposer(f3, "texte_image")` : le visage n'est plus caché.

   Chaque geste porte son `pourquoi`.
5. Il appelle `regarder_diapo(f3, proposition: true)`, puis il répond en deux phrases.
6. La page montre l'avant / après et le rapport chiffré, avant puis après. « Appliquer » l'écrit en un
   `app.mutate` ; Ctrl+Z l'annule.

### 4.8 Le banc d'essai

- **Les données** : les dix exemples des modèles, déjà là, plus leurs versions dégradées exprès (décalées, mal
  stylées, peu contrastées, trop chargées), plus une vingtaine de briefs écrits avec ce qu'on attend :
  - « mets l'image à droite » : l'image passe en colonnes 7 à 12 ;
  - « ralentis » : chaque durée × 1,25 dans les bornes ;
  - « plus sobre » : moins d'effets différents, et aucune règle qui recule.
- **La mesure** est automatique, par l'audit. Aucun goût n'entre dans la note :
  - la règle demandée est tenue ;
  - aucune autre ne recule ;
  - le geste reste dans la portée ;
  - le nombre d'appels, le temps, les jetons sont relevés.
- **Le lancement** : par un diagnostic d'Admin, que Cal lance sur DGX2 (la session cloud n'a pas les DGX). On
  passe `qwen3-vl-32b-32k`, puis `mistral-small3.2:24b`.

## 5. Décisions à prendre (Cal)

**D1. Un seul agent ou deux ?**
- Recommandation : **un seul**, l'agent Showrunner, qui gagne des outils et des compétences de design quand
  le tour vient du mode Présentation ou cite des diapositives. Même panneau, même conversation de planche.

**D2. Aperçu ou posé tout de suite ?**
- Recommandation :
  - **dans le mode Présentation, un aperçu avant / après**, puis « Appliquer » (comme la passe) ;
  - sur la planche, comme l'agent d'Idéation : posé, avec « Annuler ce tour ».

  Les deux finissent en un `app.mutate`.

**D3. Quel modèle ?**
- Recommandation : **`qwen3-vl-32b-32k`**, une fois que le diagnostic « Agent Showrunner » confirme `tools`
  et `vision` sur DGX2.
- `mistral-small3.2:24b` en second au banc. Rien à télécharger.

**D4. Le contexte : 32k ou 64k ?**
- C'est la question déjà posée pour l'agent Showrunner.
- Recommandation : **32k**, une diapositive à la fois, images à 1024 px ; 64k seulement si le banc montre
  qu'un deck entier sature.

**D5. Comment l'agent voit-il ?**
- Recommandation : **Chromium sans affichage sur DGX2**, le même rendu que l'export PNG et PDF à faire
  (`scene.js`). Pas l'export PIL, qui ignore le modèle.

**D6. Une demande qui casse une règle** (« texte gris clair sur blanc »).
- Recommandation : l'agent ne la propose **jamais de lui-même**. Sur demande explicite, il l'applique, et le
  rapport la marque « faible » avec le chiffre. Jamais bloquée : la personne décide.

**D7. Les positions libres.**
- Recommandation : **toutes les positions de l'agent en colonnes de la grille et en lignes de base**, jamais
  en pixels. Le placement libre (Alt, sans aimant) reste un geste de la personne.

**D8. Les compétences : qui, quelle langue, et des compétences de projet ?**
- Recommandation :
  - nous les écrivons, dans le dépôt ;
  - le corps est en anglais, comme la consigne actuelle, avec un résumé français en tête ;
  - les seuils sont dans `regles.json`, lu partout ;
  - les compétences « de projet » (la charte d'un client, à la manière des skills d'équipe de Figma) viennent
    plus tard.

**D9. L'agent peut-il réécrire les textes des diapositives ?**
- Recommandation : **oui, sur demande seulement** (« raccourcis », « reformule »), jamais de lui-même.
  Chaque texte changé est une ligne à part du rapport, avec l'ancien texte.

**D10. La passe assistée, et les seuils non sourcés.**
- Recommandation :
  - **la passe garde son bouton orange**, sans modèle ;
  - elle gagne une portée (une diapositive, une sélection) et la mesure du fond réel sous le texte ;
  - l'agent s'en sert comme d'un outil ;
  - les seuils marqués « notre choix » au § 3.2 sont adoptés pour commencer, puis revus après le banc. Ce
    sont : 40 mots, 3 s d'apparition, une boucle d'au moins 1000 ms, pas plus de courbes que le modèle.

## 6. L'ordre des travaux

0. **Avant tout** (déjà en cours ailleurs) :
   - fusionner `wip/agent-showrunner` et `wip2/agent-page` ;
   - Cal lance le diagnostic « Agent Showrunner » sur DGX2 (`tools`, `vision`, `num_ctx`) et un premier tour
     réel de l'agent d'Idéation.
1. **Le moteur** :
   - sortir les règles d'`assist.js` en fonctions pures par diapositive, avec une portée ;
   - écrire `mesurer()`, l'audit ;
   - créer `competences/regles.json` ;
   - ajouter la borne basse des boucles au schéma ;
   - le contrôle : le moteur passe ses règles sur les dix exemples et sur leurs versions dégradées.
2. **Le rendu** :
   - `tools/regard.mjs` (Chromium, DGX2) : la planche ou une proposition donne une capture par diapositive et
     les mesures (lignes, débordements, fond sous le texte) ;
   - en commun avec l'export PNG et PDF (travail `ideation.pdf`, voie `cpu`) ;
   - le jeton de lecture.
3. **Les compétences** : les six `SKILL.md`, et l'outil `lire_competence`.
4. **Le serveur** :
   - les outils de design dans `ideation_agent.py`, validés par `schema.json`, `TEXT_STYLES` et la grille ;
   - `intent: "design"` ;
   - les tours scénarisés dans `tools/faux_ollama.py` ;
   - le selftest.
5. **La page** :
   - dans le mode Présentation, le champ de brief (un onglet de l'inspecteur) ;
   - la proposition de l'agent en avant / après, avec son rapport et la liste de ses gestes ;
   - « Appliquer » en un `app.mutate` ;
   - un pilote Playwright, dans les deux thèmes.
6. **Le banc d'essai** : les decks dégradés et les briefs, mesurés par l'audit ; un diagnostic d'Admin qui le
   lance sur DGX2 avec les deux modèles ; Cal lit le résultat.
7. **Ensuite** :
   - le point focal des images : un champ `focus` qui devient `object-position`, posé par le modèle qui voit ;
   - le motion regardé en trois images ;
   - les compétences de projet (une charte) ;
   - la pause des boucles dans le lecteur.

## Sources

**Dans le dépôt** (lu le 06/10/2026) :
- `ideation/presentation/` : `assist.js`, `scene.js`, `modeles.js`, `moteur.js`, `mode.js`, `lecteur.js`,
  `lecture.js`, `presentation.css`, `schema.json`, `modeles/*.json` ;
- `ideation/diapo/` : `index.js`, `libre.js`, `polices.js` ; `ideation/objets/texte.js`, `guides.js` ;
  `ideation/ideation.js` (`app.snap`, `app.mutate`, `app.undoStep`) ;
- `server/tools/ideation.py` (`TYPES`, `DECK_RATIOS`, `DECK_GRID`, `TEXT_STYLES`, `FONTS`, `TEXT_COLORS`,
  `_pres`), `server/tools/presentation.py` (`clean_motion`), `server/tools/ideation_agent.py` ;
- la branche `wip2/agent-page` : 8e34600 (la page de l'agent), b289ae9 (`tools/diag_agent.py`) ;
- `tools/shot.mjs`, `tools/shot_connecte.mjs` ;
- `docs/REPRISE.md` § 1 et § 7 ;
- `docs/etudes/agent_showrunner.md`, `presentations_motion.md`, `orchestration.md` (§ 1.2, § 2.2, § 3.1),
  `transcrire.md` (relevé d'Ollama), `preferences.md` § 5, `mode_showrunner.md`.

**Sur le web** :

1. Canva, « Use Canva AI to refine designs through conversation »,
   https://www.canva.com/help/canva-design-assistant/ (page refusée au robot ; extraits du moteur de
   recherche, 06/10/2026).
2. Canva, « Use Ask Canva for AI-powered design edits », https://www.canva.com/help/edit-designs-with-ask-canva/
   et https://www.canva.com/help/ask-canva-comments/ (extraits).
3. Canva AI 2.0 : https://www.cmswire.com/digital-experience/canva-ai-20-adds-agentic-design-tools/,
   https://techcrunch.com/2026/04/16/canvas-ai-assistant-can-now-call-various-tools-to-make-designs-for-you/
   (extraits).
4. Figma, l'agent design : https://techcrunch.com/2026/05/20/figma-adds-an-ai-assistant-to-its-collaborative-canvas/,
   https://www.figma.com/solutions/ai-design-agent/ (extraits).
5. Figma, les skills : https://www.figma.com/blog/agent-custom-tools-context-skills/,
   https://www.figma.com/blog/the-figma-canvas-is-now-open-to-agents/,
   https://www.figma.com/blog/try-these-10-skills-and-show-off-your-own/ (extraits).
6. Figma Make : https://www.figma.com/blog/introducing-figma-make/ (extraits).
7. Gamma : https://gamma.app/insights/introducing-gamma-3-0,
   https://help.gamma.app/en/articles/8033284-can-i-edit-my-content-using-ai,
   https://gamma.app/explore/content/guides/instant-deck-restyling-across-the-entire-presentation (extraits).
8. Pitch : https://pitch.com/use-cases/ai-presentation-maker (extraits).
9. Adobe Express, AI Assistant : https://helpx.adobe.com/express/web/ai-assistant/adobe-express-ai-assistant-overview.html,
   https://adobe.design/stories/process/behind-the-design-adobe-express-ai-assistant,
   https://www.computerworld.com/article/4081807/adobe-ai-assistants-let-you-edit-images-in-photoshop-and-express-via-prompts.html
   (extraits).
10. Recraft : https://www.recraft.ai/blog/introducing-prompt-based-editing-the-ingenious-shortcut-for-your-ai-images,
    https://en.wikipedia.org/wiki/Recraft (extraits).
11. Higgsfield, skills : https://higgsfield.ai/supercomputer/skills,
    https://higgsfield.ai/supercomputer/marketplace/skills/a94d7b61-1470-4a8f-9b33-bdd5ee6257bd (extraits) ;
    et `agent_showrunner.md` § 1.
12. Microsoft, « Create professional slide layouts with Designer in PowerPoint »,
    https://support.microsoft.com/en-us/office/create-professional-slide-layouts-with-designer-53c77d7b-dc40-45c2-b684-81415eac0617
    (extraits).
13. PPTAgent, README, https://github.com/icip-cas/PPTAgent (lu) ; article arXiv 2501.03936.
14. AutoPresent, README, https://github.com/para-lost/AutoPresent (lu) ; « AutoPresent: Designing Structured
    Visuals from Scratch », CVPR 2025, arXiv 2501.00912 (extraits).
15. UICrit, https://github.com/google-research-datasets/uicrit ; arXiv 2407.08850, UIST 2024 (extraits).
16. Duan et al., « Generating Automatic Feedback on UI Mockups with Large Language Models », CHI 2024,
    https://dl.acm.org/doi/10.1145/3613904.3642782 (extraits).
17. Agent Skills, spécification, https://github.com/agentskills/agentskills/blob/main/docs/specification.mdx
    (lu) ; https://agentskills.io/specification.
18. WCAG 2, textes des critères dans le dépôt du W3C, https://github.com/w3c/wcag/tree/main/guidelines (lus) :
    `sc/20/contrast-minimum`, `sc/20/contrast-enhanced`, `terms/20/large-scale`, `sc/21/non-text-contrast`,
    `sc/20/pause-stop-hide`, `sc/20/three-flashes-or-below-threshold`, `sc/21/animation-from-interactions`.
19. Material 3, jetons de motion,
    https://github.com/material-components/material-web/blob/main/tokens/versions/v0_192/_md-sys-motion.scss
    (lu).
20. M. Butterick, Practical Typography, « Summary of key rules »,
    https://practicaltypography.com/summary-of-key-rules.html (extraits : 45 à 90 signes par ligne,
    interlignage de 120 à 145 %).
21. Duarte, « The Glance Test », https://www.duarte.com/resources/guides-tools/the-glance-test/ (extraits).
22. Qwen3-VL, README, https://github.com/QwenLM/Qwen3-VL/blob/main/README.md (lu).
23. Transformers, `configuration_qwen3_vl.py`,
    https://github.com/huggingface/transformers/blob/main/src/transformers/models/qwen3_vl/configuration_qwen3_vl.py
    (lu : `patch_size` 16, `spatial_merge_size` 2).
24. Ollama, bibliothèque, `qwen3-vl`, https://ollama.com/library/qwen3-vl (extraits).
25. Ollama, bibliothèque, `mistral-small3.2`, https://ollama.com/library/mistral-small3.2 ; Mistral, fiche
    `mistralai/Mistral-Small-3.2-24B-Instruct-2506` sur Hugging Face (extraits).
26. Ollama, « Structured outputs »,
    https://github.com/ollama/ollama/blob/main/docs/capabilities/structured-outputs.mdx (lu) ; l'appel
    d'outils et la vision : les sources [5] à [10] de `agent_showrunner.md`.
27. WICG, « HTML-in-Canvas », https://github.com/WICG/html-in-canvas (extraits : essai d'origine dans
    Chromium 148 à 150).
