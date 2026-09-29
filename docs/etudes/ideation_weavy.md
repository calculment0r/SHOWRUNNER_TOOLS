# Étude — le composeur de prompt de l'Idéation, d'après Weavy (29/09/2026)

Cal, 29/09 : « un prompt composer comme dans Weavy, pour pouvoir séparer mon action de mes
personnages, de mes décors, de la photographie : cela est puissant pour pouvoir déployer vite des
choses différentes mais qui gardent certaines composantes … on essaye de ne pas faire une usine à
gaz aussi car les canvas deviennent vite ingérables. » Et : « je veux sur les nodes image et vidéo
pouvoir rentrer un prompt qui vient d'un bloc texte ou d'un prompt composer … un bloc texte que je
drag and drop sur un autre, il me fait un node prompt composer direct. »

**Statut** : étude sur documentation, pour la v2. Aucun compte Weavy ouvert, aucun rendu. La v1
s'écrit en même temps dans `ideation/` (`ports.js` : cinq cases Action, Personnages, Décor,
Photographie, Style ; une case s'écrit sur place ou reçoit un fil ; verrou ; couper ; cases jointes
par un saut de ligne) ; le § 10 dit ce que la v2 y change.

**Accès aux sources.** `help.weavy.ai` est derrière un contrôle anti-robot de Cloudflare : ses
articles sont lus dans les copies de l'Internet Archive (date de chaque copie aux sources). Les
vidéos : descriptions et chapitres de la chaîne officielle « Figma Weave » (les transcriptions ne
se lisent pas sans navigateur). Les flux partagés `app.weavy.ai/flow/…` cités par l'aide n'ont
pas été ouverts (application connectée). Freepik et Runway refusent aussi le robot : copies de
l'Internet Archive.

## 1. Weavy est devenu Figma Weave

- Figma a annoncé le rachat de Weavy le 30/10/2025 ; le produit s'appelle **Figma Weave**, reste
  une application à part (weave.figma.com), et ses « tools » tournent dans Figma Design pour les
  offres payantes [1][2].
- Un nœud : entrées à gauche, sorties à droite ; nœuds génératifs (bouton Run, payants) et non
  génératifs (gratuits : le Prompt Concatenator en est un) ; une couleur par type — image verte,
  texte violet, vidéo rouge, Array / List bleu, entrées multiples blanches [3].
- Weavy n'a pas de nœud nommé « prompt composer » : ce que Cal appelle ainsi, ce sont le **Prompt
  Concatenator** et les **Prompt Variables** (§ 2).

## 2. Weavy : les nœuds de texte et de prompt

| nœud | ce qu'il fait | source |
|---|---|---|
| **Prompt** | un texte libre, aussi long qu'on veut ; ctrl+P en crée un | [4] [14] |
| **Prompt Concatenator** | colle ses entrées de texte bout à bout (A + B + C) ; autant d'entrées qu'on veut (bouton + en bas à gauche) ; un texte en plus s'écrit dans le nœud lui-même ; gratuit | [3] [4] |
| **Prompt Variables** | dans **un seul** nœud Prompt : « Add Variables » ajoute une poignée d'entrée par variable ; un nœud Text branché dessus devient la variable ; la variable se glisse à sa place dans le texte ; affichage au choix : la source, la valeur, ou les deux | [5] |
| — tutoriel officiel | les variables remplacent plusieurs nœuds Prompt câblés qu'il fallait sans cesse recâbler ; « @ » appelle une variable ; chapitre « Prompt Variables with Iterators » ; une sortie de LLM découpée par un délimiteur alimente les variables (version avancée) | [16a] [16b] |
| — syntaxe | non documentée par Weavy ; dans un flux tiers exporté, une variable s'écrit `{{variable1:hot pink}}` | [17a] |
| **Text** | un texte, comme Prompt ; c'est aussi la **forme visible d'un réglage texte d'un modèle** : « Set as Output » sort un réglage du panneau de droite sur la planche (Number, Toggle, Seed de même) | [6] |
| **Array** | plusieurs textes, saisis ou découpés dans un texte branché selon un signe du clavier ; nourrit List Selector et Text Iterator | [6] |
| **List Selector** | un menu déroulant : **une** valeur choisie parmi la liste | [6] |
| **Text Iterator** | toutes les valeurs à la fois : chaque texte reste séparé, un rendu par texte, en lot ; saisie directe, Array branché ou Prompt branché ; import CSV (une colonne → un itérateur) | [7] [13] |
| **Image / Video Iterator** | pareil pour des images ou des vidéos : un rendu séparé par entrée | [7] |
| **Prompt Enhancer** | réécrit un prompt pour les nœuds image et vidéo ; LLM au choix, consigne de réécriture modifiable | [4] |
| **Run Any LLM · Image Describer · Video Describer** | un LLM libre ; une image ou une vidéo décrite en prompt modifiable | [4] |
| **Router** | une entrée vers plusieurs sorties : on rebranche le Router au lieu de recâbler chaque modèle ; double-clic sur une sortie pour en créer un | [9] |

Non documenté dans l'aide : ce que produisent **deux itérateurs** branchés sur le même modèle
(toutes les paires ? par rang ?) — seul un blog d'un concurrent (Wireflow) parle d'itérateurs
imbriqués qui se multiplient, sans source [17e] ; un verrou sur un texte (le verrou de Weavy sert
à cacher un nœud de la vue « tool », § 4).

## 3. Weavy : des variantes qui gardent des composantes

1. **Le fixe et le variable dans un Concatenator** : une consigne fixe collée à ce qu'on veut
   changer — c'est l'usage que décrit un guide détaillé [17c] et celui de Chase Jarvis (des listes
   pour la lumière, la valeur de plan, la température de couleur, choisies dans un menu) [17b].
2. **Des variables dans un seul prompt** : un flux tiers garde tout le prompt d'une photo de mode
   et n'en fait varier qu'un élément (couleur de robe, bottes, pose, filtre), chacun dans sa
   variable, chacun tiré d'un Array par un List Selector [17a].
3. **Une valeur à la main ou toutes d'un coup** : Array → List Selector pour essayer une valeur ;
   Array → Text Iterator pour les lancer toutes [6][7] ; l'annonce officielle des itérateurs :
   construire une fois, nourrir de plusieurs prompts ou images, chaque variante d'un clic, sans
   nœud dupliqué ni relance à la main [16d].
4. **Une composante décrite une fois, portée partout** : le billet de Figma fait d'abord une
   définition de style (deux images décrites par Image Describer, fondues en un texte) puis
   l'applique à un autre sujet — la matière reste, le sujet change ; et les formats d'écran se
   déclinent seuls [18].
5. **Repartir des résultats** : « Create Iterator » fait un itérateur des résultats d'un nœud,
   pour les passer tous au nœud suivant [8].

## 4. Weavy : ce qui garde la planche lisible

- **Groupes** : ctrl+G, titre et taille du titre, couleur, « Resize to Fit », retirer un nœud du
  groupe [10]. **Post-it** posés depuis la barre d'actions [14].
- **Les résultats restent dans le nœud** qui les a faits : un seul, tous, ou un lot d'itérateur ;
  « Unpack » les sort en nœuds séparés, **rangés dans un groupe** [8][14].
- **Moins de nœuds** : un itérateur remplace dix à quinze nœuds dupliqués (tutoriel officiel)
  [16c] ; les variables remplacent des prompts câblés [16a] ; le Router remplace des fils
  répétés [9]. Revers noté sous l'annonce, par un utilisateur : moins de nœuds, mais des
  résultats plus durs à voir d'un coup [17d].
- **Gestes** : supprimer un nœud en gardant le fil qui le traversait (Maj+Suppr) ; dupliquer
  avec ses branchements (ctrl+Maj+D ou Alt + glisser) ; brancher plusieurs nœuds choisis d'un
  seul fil ; Maj + glisser un fil sur plusieurs cibles [13].
- **« Tools »** (ex « Design Apps ») : un nœud Output rend le flux utilisable dans une vue
  propre, sans la planche ; les réglages montrés sont les nœuds **sans entrée** (Prompt, Import) ;
  on verrouille ceux qu'on veut cacher ; chaque mise à jour garde une version datée [11][16e].
- **Saved** : modèles réglés, nœuds, groupes de nœuds gardés pour d'autres flux (extrait du
  moteur de recherche seulement : la page n'est pas archivée) [15].
- Non documenté : **replier** un nœud ou un groupe, des **sous-graphes**.

## 5. Weavy : les entrées d'un nœud image ou vidéo

- Lâcher une sortie sur un nœud la branche **sur l'entrée qui convient** (texte sur texte, image
  sur image), **dans l'ordre** : le premier fil prend la première entrée libre ; sur un nœud à
  plusieurs images, une nouvelle place apparaît à chaque fil ; rien ne se branche s'il n'y a pas
  de place compatible [12].
- Une entrée marquée d'une **étoile** est obligatoire [12].
- **Double-clic sur une poignée de texte** : un nœud Prompt neuf, déjà branché, se pose à côté
  [13]. Un fil lâché dans le vide ouvre le menu des nœuds ; avec Alt, des suggestions déjà
  branchées [12][14].
- Les réglages d'un modèle sont au panneau de droite ; « Set as Output » en sort un sur la
  planche [3][6]. La galerie d'un résultat montre son prompt, ses réglages, sa graine [14].
- Écrire le prompt **dans** le nœud image lui-même : non documenté.

## 6. Les autres, brièvement

| outil | texte, prompt | variantes, lots | planche lisible | entrée du nœud image |
|---|---|---|---|---|
| **ComfyUI** (code lu sur DGX2, 23/09/2026) | `Concatenate Text` (deux textes et un séparateur), `Format Text` (gabarit `{a}` à la Python, entrées qui s'ajoutent), `Build JSON Prompt (Ideogram)` : un prompt en champs (description, fond, style photo ou art, esthétique, lumière, médium, palette) [19a] | `{a\|b\|c}` dans un champ texte : **un choix au hasard à la mise en file**, commentaires `//` retirés [19b] | sous-graphes (un nœud qui en contient d'autres, entrées et sorties exposées, publiables) [19c] ; replier Alt+C, contourner ctrl+B, couper ctrl+M, cadre ctrl+G [19d] ; App mode [19e] | le texte est un réglage du nœud d'encodage, ou un fil |
| **Krea Nodes** [20] | prompt **écrit dans le nœud ou reçu d'un fil** ; `Concat Text` (plusieurs opérateurs de jointure), `Line Splitter`, `LLM Call` | non documenté (ni variables ni itérateurs) | « section nodes », groupes, post-it ; « Node app builder » (un flux publié en app) | poignées colorées par type ; une entrée se branche ou se remplit à la main |
| **Freepik Spaces** [21] | Text : source sans entrée, « écrire une fois, brancher partout » ; `@nom` dans un texte cite la sortie d'un autre nœud, **mise à jour seule** ; Assistant (LLM, sortie simple ou « As list ») | **List** : des éléments cochés ou non, réordonnés, un rendu par élément, dans l'ordre ; fil de lot **en pointillé** ; résultats **empilés** sur le nœud ; 2 à 10 rendus par lancement | groupes colorés **à ports de sortie** ; post-it | le générateur prend un prompt en entrée |
| **FLORA** [22] | Text Node (texte, analyse d'image) | **Batch Node** : un rendu par élément ; **deux lots sur un nœud : Cross (N × M) ou Zip (par rang), trois refusés** ; chaque résultat marqué de sa paire ; vue **Matrice** (lignes = lot A, colonnes = lot B) ; **Batch Generate** : un gabarit à variables-pastilles, chaque combinaison écrite en ligne avant de lancer | Router (« Character refs », « Brand palette ») ; Technique Builder (un flux → un nœud ou une app) | — |
| **Runway Workflows** [23] | nœuds Input (texte ou média, sans entrée), nœuds LLM (prompt + consigne système) | — | « Lock node » : la sortie gelée ne se refait pas ; publier en app | `Prompt*` : entrée obligatoire ; références appelées par `@nom` dans le prompt (Gen-4) |

## 7. Ce que nos modèles attendent : de la prose, dans quel ordre

| modèle | ce que dit sa documentation | source |
|---|---|---|
| **Krea 2** | langage naturel, les prompts longs et détaillés réussissent le mieux ; son gabarit de réécriture : **chaque sujet groupé avec ses attributs et son action**, un seul paragraphe cohérent, ni puces ni JSON ni markdown, garder la tournure de l'auteur, respecter le médium demandé ; ses exemples ouvrent sur le médium ou le plan et finissent sur la lumière et la profondeur de champ, **sans marque** | [24] |
| **Qwen-Image 2.1** | réécrivain officiel (un Qwen3.5-VL 9B affiné, local) : un long paragraphe anglais qui décrit l'image finie ; **phrase d'ouverture : médium, style, sujet, fond** ; puis le cadre parcouru par régions ou le sujet de haut en bas ; **la lumière dans une phrase à elle** ; une phrase de clôture sur la composition, la palette, l'ambiance ; présent, troisième personne, aucun « 8K » ni « masterpiece » | [25] |
| **Z-Image Turbo** | réécrivain du Space officiel (en chinois) : d'abord les éléments intouchables (sujet, nombre, action, état, couleurs, textes), puis composition, lumière et atmosphère, matières, palette, plans de profondeur ; description objective, **sans métaphore ni méta-étiquette** (« 8K », « chef-d'œuvre ») ; tout texte à afficher entre guillemets | [26] |
| **MiniMax H3** | trois champs : `integrated_multimodal_description`, `overall_soundscape`, `non_diegetic_music` ; **en tête du [Shot 1] : le style et la composition de départ**, puis apparence et place des sujets, décor et accessoires, actions, sons ; le mouvement de caméra (type + amplitude + vitesse) s'écrit comme une action dans le plan, pas en étiquettes au bout ; tout en anglais sauf les répliques, les paroles et le texte visible ; le son et la musique ont **leur propre champ** | [27] |

L'ordre commun : **style et médium (avec le plan) → personnages et leurs attributs → leur action
→ décor → lumière et prise de vue** (H3 seul met le décor avant l'action) ; un paragraphe ; des
phrases qui décrivent ce qu'on voit ; aucun mot de qualité ; en anglais. Le son et la musique ne
vont qu'à la vidéo, à part.

## 8. Ce qu'on retient de Weavy

1. **Des composantes nommées, assemblées en un prompt** (Concatenator, Variables) [4][5] → nos
   cases.
2. **Une composante s'écrit sur place ou arrive par un fil** (Krea : dans le nœud ou reçu [20] ;
   Weavy : un réglage sorti en nœud [6]) → chaque case a son port.
3. **Faire varier une seule composante, le reste fixe** (Array → Text Iterator, Variables avec
   itérateurs) [6][7][16a] → « varier » une case = un lot, sans dupliquer de carte.
4. **Une source, plusieurs consommateurs** (Router [9], Text de Freepik [21]) → un composeur
   branché sur plusieurs cartes Générer compare Krea 2, Qwen 2.1 et Z-Image sur le même prompt.
5. **Les résultats d'un lot restent ensemble** (dans le nœud, puis « Unpack » en groupe [8]) →
   un lot se pose dans un cadre.
6. **Un texte neuf naît d'une poignée** (double-clic sur une poignée de texte [13]) → le bouton
   « Composer » d'une carte Générer, et le texte lâché sur un texte.
7. **Moins d'objets, pas plus** (itérateur contre 15 nœuds [16c], variables contre prompts
   câblés [16a]) — avec le revers noté [17d] : les résultats doivent rester visibles.
8. **Réécrire avec une consigne modifiable** (Prompt Enhancer [4]) → plus tard, « Affiner » par un
   modèle local (§ 9.6).

## 9. Notre composeur (la spécification v2)

### 9.1 La carte

```
COMPOSEUR · Course Tokyo                                   texte ×3 ●
● STYLE          A candid cinematic photograph.            [verrou][couper][varier]
● PERSONNAGES  ← note « femme au manteau rouge » (lue par fil)
● ACTION         She runs across the street, looking back over her shoulder.
● DÉCOR  ×3      [x] A rainy street in Tokyo at night, neon reflected in puddles.
                 [x] A snowy square in Prague at dawn.
                 [ ] A desert road at noon.        [x] A crowded market in Marrakech.
● PHOTOGRAPHIE   [35 mm] [Portra 400] [Fenêtre] + une ligne libre
+ case (Son, Musique, Libre)          Affiner — éteint : le modèle de texte n'est pas câblé
```

- **Les cases, dans l'ordre d'assemblage** (§ 7) : Style, Personnages, Action, Décor,
  Photographie ; « + case » ajoute Son, Musique (vidéo seulement) ou une case Libre. L'ordre de la
  carte **est** l'ordre de la prose ; une case se glisse pour le changer. Une case vide ne compte
  pas ; nommée, elle garde une ligne grise avec son aide.
- **Remplir une case** : on écrit dans la ligne (elle grandit jusqu'à 4 lignes), ou on y branche un
  fil (port à gauche de la ligne, un seul fil par case — un second remplace le premier, ctrl+Z le
  défait). Branchée, la case montre le texte reçu en gris et le nom de sa source ; un clic sur le
  nom montre la source ; « Détacher » copie le texte dans la case et coupe le fil. Une source est
  une note, un post-it, un titre, ou un autre composeur (son paragraphe entier).
- **Changer le rôle d'une case** : clic sur son étiquette, menu des rôles.
- **Verrou** : la case ne s'écrit plus et ne prend plus de fil ; elle ne peut pas varier ; le jour
  où « Affiner » existe, elle part comme « à garder » et n'est jamais réécrite (la forme de
  l'assistant de l'outil Vidéo).
- **Couper** : la case reste, barrée, et sort de la prose (le « bypass » de ComfyUI [19d], la case
  décochée de Freepik [21]).
- **Aucun orange** sur le composeur : il ne fabrique rien ; l'action reste « Générer ».

### 9.2 L'assemblage de la prose (déterministe)

1. Les cases non coupées et non vides, dans l'ordre de la carte.
2. Chaque case devient une ou plusieurs phrases : un point est ajouté s'il manque (`_sentence`
   d'`image.py`).
3. **Jointes par une espace, en un seul paragraphe** — pas un saut de ligne (Krea et Qwen
   demandent un paragraphe [24][25]).
4. **Aucun mot de liaison inventé** : le composeur ne sait pas si « a woman in a red coat » est une
   phrase ou un groupe nominal ; il garde la tournure de Cal (règle 7 du gabarit Krea [24]). Les
   aides des cases montrent une phrase complète en exemple.
5. **Photographie** : les pastilles de l'outil Image (caméra, objectif, ouverture, pellicule,
   lumière — `LOOK_ORDER`) plus une ligne libre ; le composeur envoie les **identifiants** des
   pastilles, le serveur écrit leur phrase selon le modèle (`krea` sans marque pour Krea 2,
   `prose` pour les autres — `compose` d'`image.py`, étude Image § 4). La carte Générer branchée
   cache alors son propre choix de pastilles : une seule vérité.
6. Les jetons `<image2>` (Qwen) et `@element1` (H3) s'écrivent dans n'importe quelle case ; la
   carte Générer les contrôle comme aujourd'hui.
7. **Vidéo (H3)** : Style à Photographie → `integrated_multimodal_description` (déjà préfixé
   `[Shot 1]` par `compose_base`) ; Son → `overall_soundscape` ; Musique → `non_diegetic_music`
   (vides : les défauts de `movie.py`). Les pastilles image ne vont pas à H3 : seule la ligne
   libre de Photographie passe (la caméra d'H3 est son vocabulaire à elle [27]). Le guide d'H3 met
   le décor avant les actions : pour un composeur fait pour la vidéo, glisser Décor au-dessus
   d'Action. Une carte image ignore Son et Musique et le dit.
8. En anglais : les quatre modèles sont documentés en anglais [24]–[27]. Traduire sera le rôle
   d'« Affiner ».

Exemple (Krea 2, la première valeur du lot ci-dessus) : *A candid cinematic photograph. A woman
in her thirties with short black hair, wearing a long red wool coat. She runs across the street,
looking back over her shoulder. A rainy street in Tokyo at night, neon reflected in puddles.*
suivi des phrases `krea` des trois pastilles.

### 9.3 N variantes sans multiplier les cartes

- **« Varier »** sur une case : son contenu devient une liste, **une valeur par ligne** (Entrée en
  ajoute une, un collage de plusieurs lignes en fait plusieurs), chacune avec sa case à cocher,
  réordonnable. Une case branchée varie aussi : le texte reçu est découpé par ligne (l'Array de
  Weavy, avec un seul séparateur possible : la ligne).
- **Une seule case varie** par composeur, et une seule par carte Générer (un composeur imbriqué
  compte) : ailleurs, « varier » est éteint et dit laquelle varie déjà. Deux listes croisées, c'est
  le Cross de FLORA (N × M, deux lots au plus, vue matrice [22]) : écarté pour l'instant (§ 9.6).
- La carte Générer affiche **« Générer 3 × 2 »** (valeurs cochées × images par valeur). Plafond :
  celui du serveur, **8 images par envoi** (`api_generate`) — au-delà, le bouton est éteint et dit
  quoi décocher.
- **Même graines d'une valeur à l'autre** : l'image *k* de chaque valeur prend la graine *base + k*
  (ce que fait déjà `api_generate` pour *k*) ; d'une colonne à l'autre, seule la case change.
- Un seul `batch` pour le lot ; chaque image garde son prompt résolu **et** `{case, valeur}`, pour
  que Réutiliser, Recréer et le fil de l'outil Image marchent image par image.
- **Où tombent les résultats** : dans **un cadre** posé à droite de la carte, nommé « Décor × 3 »,
  une colonne par valeur, la valeur en légende, les images d'une valeur l'une sous l'autre. La
  lignée reste un lien `out` par image, mais le canvas n'en dessine qu'un vers le cadre. Le cadre
  s'exporte en planche contact (export PNG existant). Pas de nouvel objet : le cadre existe.
- Vidéo : même chose ; la carte montre le temps estimé de l'outil Vidéo multiplié par le nombre
  de rendus (H3 : 5 à 17 min par plan mesuré, étude Vidéo § 5).

### 9.4 La carte Générer qui reçoit un prompt

- Son entrée **prompt** prend un fil (une note ou un composeur). Branchée : le champ devient un
  aperçu en lecture seule de la prose, avec le nom de la source, « Décor × 3 » si une case varie,
  et deux gestes : **Détacher** (le texte copié dans la carte, le fil coupé) et **Voir le prompt
  envoyé** (`/api/image/compose`), valeur par valeur (‹ ›).
- Générer éteint dit pourquoi : composeur vide, fil en alerte (sa raison, v1), plus de 8 images,
  deux cases variées qui arrivent ici.
- **« Composer »** à côté du champ écrit : le prompt tapé part dans un composeur neuf, posé à
  gauche, branché, le texte dans une case Libre (le double-clic sur une poignée de Weavy [13]).
- Un composeur branché sur plusieurs cartes : le même prompt pour Krea 2, Qwen 2.1, Z-Image, côte
  à côte.

### 9.5 Le geste « texte lâché sur texte »

- On glisse une note, un post-it ou un titre **sur** un autre texte : après un court arrêt
  au-dessus (≈ 0,4 s, pour qu'un simple passage ne fusionne rien), la cible s'allume
  « composeur ». Au lâcher : un composeur se pose à droite de la cible, **les deux textes y sont
  branchés** dans deux cases Libres (la cible d'abord), et le texte glissé **revient à sa place**.
  Un seul pas d'annulation.
- **Pourquoi brancher, pas absorber** : les notes sont les composantes qu'on garde ; changer la
  note change tous les composeurs qui la lisent (le `@` de Freepik se met à jour seul [21]) ; la
  planche d'ambiance reste intacte.
- **Pourquoi des cases Libres** : rien ne dit qu'une note est un décor plutôt qu'une action ;
  deviner ferait une prose dans le mauvais ordre. Un clic sur l'étiquette donne le rôle.
- Texte lâché **sur un composeur** : dans la case sous le curseur (vide, ou remplacée — ctrl+Z),
  sinon dans une nouvelle case Libre. Texte lâché **sur une carte Générer** : il devient son
  prompt ; si elle en a déjà un (écrit ou branché), un composeur se pose entre les deux avec les
  deux textes. La règle tient en une phrase : deux textes qui se rencontrent font un composeur.

### 9.6 Ce qu'on ne fait pas

- **Pas de variables dans le texte** (`{{variable}}` de Weavy [17a], pastilles de FLORA [22],
  `{a|b}` de ComfyUI [19b]) : les cases font ce travail, visibles ; une syntaxe s'apprend et se
  casse ; le `{a|b}` tiré au hasard défait la reproductibilité.
- **Pas de produit de listes, pas d'itérateurs en chaîne, pas de listes de références** (Image
  Iterator, variables-images de FLORA) : une case varie, un lot, huit images au plus. Si le besoin
  revient, le Cross de FLORA (deux listes au plus, vue matrice) est le modèle documenté.
- **Pas de Router, de sous-graphe, de groupe à ports** : un composeur partagé fait office de
  Router ; nos cadres font les groupes.
- **Pas de nœud LLM sur la planche** (Prompt Enhancer, Run Any LLM, Image Describer) : un bouton
  « Affiner » dans le composeur, éteint avec sa raison tant que le modèle de texte du portail
  (`llm_url`) n'est pas câblé — comme l'assistant de l'outil Vidéo. Pistes locales documentées :
  le gabarit `expansion.txt` de Krea 2 [24], le réécrivain Qwen-Image 2.1 (Qwen3.5-VL 9B affiné,
  **non téléchargé**) [25], `pe.py` de Z-Image [26]. « Décrire une image en note » viendra avec le
  même modèle.
- **Pas de vue « app », de publication, d'import CSV, d'exécution du graphe entier** (déjà écartée,
  étude Idéation § 2.7) : un seul utilisateur, qui voit sa planche.

## 10. Écarts avec la v1 (`ideation/ports.js`, 29/09)

| v1 | v2 proposée | pourquoi |
|---|---|---|
| cases dans l'ordre de l'énoncé de Cal (Action d'abord), jointes par `\n` | ordre d'assemblage des guides (Style, Personnages, Action, Décor, Photographie), phrases jointes par une espace | § 7 : un paragraphe, le style et le plan d'abord |
| verrou = refuse un fil | refuse aussi l'écriture et la variation ; « à garder » pour Affiner | § 9.1 |
| Photographie en texte | pastilles de l'outil Image + ligne libre, écrites par le serveur selon le modèle | Krea sans marque, par construction |
| — | « varier » (une case), lot en cadre, « Générer 3 × 2 », mêmes graines | § 9.3 |
| — | Son, Musique vers les champs d'H3 | § 9.2 point 7 |
| — | Détacher, Composer, texte lâché sur texte / composeur / carte | § 9.4, § 9.5 |

## Sources

Weavy (Figma Weave). Les articles `help.weavy.ai` sont lus dans l'Internet Archive
(`web.archive.org/web/<date>/<adresse>`), date de la copie entre parenthèses.

1. Figma Blog, « Introducing Figma Weave », 30/10/2025, https://www.figma.com/blog/welcome-weavy-to-figma/
2. Figma Learn, « Figma Weave FAQ », https://help.figma.com/hc/en-us/articles/35965787376919-Figma-Weave-FAQ
3. « Understanding Nodes », https://help.weavy.ai/en/articles/12292386-understanding-nodes (21/05/2026)
4. « Text Tools », https://help.weavy.ai/en/articles/12268282-text-tools (19/06/2026)
5. « Prompt Variables », https://help.weavy.ai/en/articles/14047674-prompt-variables (21/05/2026)
6. « Datatypes », https://help.weavy.ai/en/articles/12268346-datatypes (19/06/2026)
7. « Iterators », https://help.weavy.ai/en/articles/12343281-iterators (19/06/2026)
8. « Unpack a Node », https://help.weavy.ai/en/articles/14688070-unpack-a-node ; « Creating Iterators from Existing Node », https://help.weavy.ai/en/articles/14688156-creating-iterators-from-existing-node (19/06/2026)
9. « Helpers Overview » (Router, Output, Compare), https://help.weavy.ai/en/articles/12268300-helpers-overview (19/06/2026)
10. « Group and Ungroup Nodes », https://help.weavy.ai/en/articles/13560959-group-and-ungroup-nodes (21/05/2026)
11. « Tools », https://help.weavy.ai/en/articles/12267755-tools (03/09/2026)
12. « Connecting Edges/Wires », https://help.weavy.ai/en/articles/14688276-connecting-edges-wires ; « How can I know which inputs are mandatory… », https://help.weavy.ai/en/articles/12343730-how-can-i-know-which-inputs-are-mandatory-for-a-model-to-run (21/05/2026)
13. « New Figma Weave Delights » #2, #3, #4, https://help.weavy.ai/en/articles/14878372-new-figma-weave-delights-2 , https://help.weavy.ai/en/articles/15068263-new-figma-weave-delights-3 , https://help.weavy.ai/en/articles/15263628-new-figma-weave-delights-4 (11/06/2026)
14. « Media Gallery », https://help.weavy.ai/en/articles/12292408-media-gallery ; « Working with Media », https://help.weavy.ai/en/articles/14653652-working-with-media ; « Keyboard Shortcuts », https://help.weavy.ai/en/articles/14688389-keyboard-shortcuts ; « Sticky Notes », https://help.weavy.ai/en/articles/14046539-sticky-notes (21/05 et 19/06/2026)
15. « Using the Saved section », https://help.weavy.ai/en/articles/15495911-using-the-saved-section (non archivée : extrait du moteur de recherche)
16. Chaîne YouTube « Figma Weave » (descriptions et chapitres) : (a) « How to Use Prompt Variables in Weavy », 09/03/2026, https://www.youtube.com/watch?v=kA_QQ77i0_E ; (b) « Advanced Prompt Variables in Weavy », 09/03/2026, https://www.youtube.com/watch?v=CCz7qQgwUwI ; (c) « How to Use Iterators in Weavy », 03/12/2025, https://www.youtube.com/watch?v=_uIxc7IaW9c ; (d) « Weavy Iterators – From One Giraffe to an Entire Zoo », 03/12/2025, https://www.youtube.com/watch?v=yw-8rfVseiY ; (e) « Tutorial 04: Build Your Own Design App », 01/06/2025, https://www.youtube.com/watch?v=aEoHwSdWWWM
17. Tiers : (a) Hausu Media (gcwalther), « Stop Rewriting Prompts → Use Variable Nodes in Weavy », 13/03/2026, https://www.youtube.com/watch?v=3DXzkWT6omc ; (b) Chase Jarvis, https://chasejarvis.com/blog/how-to-use-weavys-prompt-concatenator-to-hack-your-creativity/ ; (c) MOMOTARO, guide de Figma Weave, https://note.com/momotaro_ai/n/nadf8304c32a1 ; (d) commentaire sous « Iterators are live in Weavy », https://www.linkedin.com/posts/figmaweave_iterators-are-live-in-weavy-our-first-real-activity-7401991925928460289-tN_m ; (e) Wireflow (concurrent, sans sources), https://www.wireflow.ai/blog/weavy-workflows
18. Figma Blog, « Turning Prompts into Five Scalable Workflows with Figma Weave », https://www.figma.com/blog/five-figma-weave-workflows/

Les autres outils :

19. ComfyUI : (a) `comfy_extras/nodes_string.py` (`StringConcatenate`, `StringFormat`) et `comfy_extras/nodes_json_prompt.py`, lus sur DGX2 (`~/ComfyUI`, commit 830232b8 du 23/09/2026) ; (b) `processDynamicPrompt` du frontend (`comfyui_frontend_package`, `formatUtil`), activé par `dynamicPrompts: True` sur `CLIPTextEncode` (`nodes.py`) ; (c) « Subgraph », https://docs.comfy.org/interface/features/subgraph ; (d) « Shortcuts », https://docs.comfy.org/interface/shortcuts ; (e) « App mode », https://docs.comfy.org/interface/app-mode
20. Krea, « Nodes workflows », https://www.krea.ai/docs/user-guide/features/nodes
21. Freepik Help Center, « Text nodes in Spaces », https://www.freepik.com/ai/docs/text-nodes (15/04/2026) ; « Utility nodes in Spaces », https://www.freepik.com/ai/docs/utility-nodes (15/04/2026) ; « Nodes & connections in Spaces », https://www.freepik.com/ai/docs/nodes-and-connections (15/04/2026)
22. FLORA Docs, « Batch Node », https://docs.flora.ai/nodes/batch-node ; « Batch Generate », https://docs.flora.ai/batch-generate/batch-generate ; « Router Node », https://docs.flora.ai/nodes/router-node ; « Technique Builder », https://docs.flora.ai/nodes/technique-builder
23. Runway Help, « Introduction to Workflows », https://help.runwayml.com/hc/en-us/articles/45763528999699-Introduction-to-Workflows (12/05/2026) ; « Creating with Gen-4 Image References », https://help.runwayml.com/hc/en-us/articles/40042718905875-Creating-with-Gen-4-Image-References (22/09/2026)

Les modèles :

24. Krea 2, « Prompting guidelines », https://github.com/krea-ai/krea-2/blob/main/docs/prompting.md ; gabarit de réécriture, https://github.com/krea-ai/krea-2/blob/main/docs/expansion.txt
25. Qwen-Image 2.1, réécrivain texte → image, https://github.com/QwenLM/Qwen-Image-2.1/blob/main/prompt_rewrite/prompts/system_prompt_t2i.txt ; son README (Qwen3.5-VL 9B affiné), https://github.com/QwenLM/Qwen-Image-2.1/blob/main/prompt_rewrite/README.md
26. Z-Image Turbo, réécrivain du Space officiel, https://huggingface.co/spaces/Tongyi-MAI/Z-Image-Turbo/blob/main/pe.py
27. MiniMax H3, « Video Prompt Writing Guide » (base), https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_base_en.md ; (références), https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_ref_en.md

Le portail : `server/tools/image.py` (`compose`, `_sentence`, `LOOK_ORDER`, `api_generate` : 1 à 8
images, graine + k, `_batch`), `server/tools/movie.py` (`compose_base`, `compose_ref`),
`ideation/ports.js` (v1), `docs/etudes/image.md` § 4, `docs/etudes/movie.md` § 4–5,
`docs/etudes/ideation.md` § 2.
