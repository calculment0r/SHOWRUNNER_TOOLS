# Vidéo (ex « Movie Creator ») — étude (28/09/2026, fil du 29/09)

Cal, 29/09 : « movie creator devient simplement "vidéo", movie creator c'est trop long et pas
clair ». Le nom affiché partout est **Vidéo** ; le chemin `movie/`, les travaux `movie.*`, les
routes `/api/movie/*` et l'interrupteur `movie_engine` gardent le leur (aucun lien mort).

Ce que Cal a demandé (28/09 au soir) : un outil « simple et qui fonctionne
comme Higgsfield » — un prompt, image → vidéo (première image), références
→ vidéo ; des **éléments** réutilisables entre les outils (un personnage de
Character Factory appelé directement dans une vidéo H3) ; tout ce qui sort
va dans la bibliothèque Asset ; le banc NL devient une fonction de l'outil
(« Comparer »). Puis, dans la soirée : **l'UX et l'UI d'abord, aucun rendu
réel ni démarrage d'H3** — « le câblage des modèles vidéo se fera après car
j'ai déjà bien avancé » — et la référence d'interface H3 Studio.

## 1. Higgsfield vidéo : ce qu'il propose

- Un générateur vidéo à plusieurs modèles (Kling, Veo, Sora, Seedance…) :
  prompt, format, durée, résolution
  ([higgsfield.ai/ai-video](https://higgsfield.ai/ai-video)).
- Image → vidéo : la photo animée selon le prompt ; **première et dernière
  image** pour fixer le début et la fin du plan
  ([image-to-video-ai](https://higgsfield.ai/image-to-video-ai)).
- **Références** : jusqu'à 7 images (personnages, tenues, objets, lieux)
  fondues dans un plan (Kling O1) ; les **Elements** — jusqu'à 4 images
  d'un même sujet, appelés par une étiquette `@` dans le prompt, pour
  garder l'identité d'un plan à l'autre
  ([Kling O1](https://higgsfield.ai/blog/Kling-01-is-Here-A-Complete-Guide-to-Video-Model),
  [Kling 3.0](https://higgsfield.ai/blog/Kling-3.0-is-on-Higgsfield-User-Guide-AI-Video-Generation)).
- Multi-plans (jusqu'à 5 plans) avec un élément par plan.

## 2. Ce qu'H3 fait de pareil, en local

| Higgsfield | H3 (ComfyUI) | Vidéo |
|---|---|---|
| texte → vidéo | `MiniMaxH3ImageToVideo` sans image, poids **fl2va** | mode **Texte** (`movie.t2v`) |
| première / dernière image | le même nœud, `first_frame` / `last_frame` | mode **Images** (`movie.i2v`) |
| références, Elements `@` | `MiniMaxH3ReferenceToVideo`, poids **ref2va** : 9 images, 3 vidéos, 3 sons, étiquettes `<Picture n>` `<Subject n>` `<Video n>` `<Audio n>` | mode **Références** (`movie.r2v`) : chaque référence porte un `@nom` ; un élément de la bibliothèque (un personnage de Character Factory) envoie son visage et son plein pied |
| son (Veo, Kling 3) | son natif : `VAEDecodeAudio` sur le même latent | gardé, muxé dans le mp4 |

Source des limites : le code du nœud (`comfy_extras/nodes_minimax_h3.py` de
ComfyUI-H3TEST : `max=9` images, 3 vidéos, 3 sons, vidéo de référence 2–15 s,
`FPS = 24`, « trained range is ~124-362 ») et H3 Studio (12 fichiers, 15 s par
type, une bande-son de vidéo compte comme un son).

## 3. L'interface : H3 Studio, dans notre thème

Référence d'UX de Cal : **H3 Studio**
([github.com/underworldhistory1-ctrl/minimax-h3-higgsfield](https://github.com/underworldhistory1-ctrl/minimax-h3-higgsfield),
**MIT, Copyright (c) 2026 Charles Mod**), cloné en lecture seule sur DGX2
(`/tmp/h3hf`), rien exécuté. Repris (réécrit, la mention MIT est en tête de
`movie/movie.js`, `movie/movie.css`, `movie/index.html` et `server/tools/movie.py`) :

- le parcours de `docs/UX_FLOW.md` : rail de création (carte du modèle,
  modes Texte / Images / Références, brouillon de prompt par mode),
  espace de travail (la vidéo, la progression — étape, %, écoulé, restant,
  file —, « Vidéo en cours » : épingler, réglages, télécharger, supprimer),
  les vidéos générées en cartes (8 puis « voir plus », détails) ;
- les références nommées : nom de mention, « utiliser comme » (personnage,
  lieu, look, objet ; mouvement, caméra, action, scène entière ; voix,
  musique, bruitages), `@` ouvre le menu des mentions, toute référence
  doit être mentionnée, les mentions deviennent les étiquettes H3 ; la forme
  des définitions et des marqueurs de rétention par rôle (`resolvedPrompt`) ;
- les toiles H3 Base avec temps estimé (1344×768, 1280×704, 1024×576,
  864×480), la méthode de rendu, les durées 124/175/226/294/362 images, les
  pas 20 / 30 / 50, la graine et « aléatoire » ;
- les notes de compatibilité des LoRA (Realism People : trois modes,
  déclencheur `r34l1sm` ; un LoRA fl2v n'est pas pour ref2va) ;
- le câblage des références vidéo et son (`docs/GRAPH_MAP.md` :
  `LoadVideo → GetVideoComponents → ref_videos.ref_video_N`, bande-son sur
  `ref_video_audios` au même indice, `LoadAudio → ref_audios`) ;
- le vocabulaire caméra contrôlé de MiniMax (`corpus/h3_style_rules.md`) :
  pastilles Push In, Pan, Tracking Shot, Arc Shot… avec amplitude et vitesse,
  écrites dans la phrase ; l'aide « (S1) … `<d>[Langue] …</d>` » pour une
  réplique ; la clause d'exclusions (pas de prompt négatif).

Changé pour le portail :

- **le thème** : jetons de `commun/tokens.css`, filets, Venus Rising /
  Chakra Petch / Azeret Mono ; **un seul orange** : « Générer » dans la
  colonne ; depuis le fil (29/09), « Réutiliser » dans la visionneuse plein
  écran, qui recouvre tout — jamais les deux (leur vert fluo « Download » à
  côté du bleu « Generate ») ;
- leurs fichiers locaux deviennent **la bibliothèque et les éléments** :
  une référence, une image de début, un personnage se prennent dans le
  sélecteur commun (`pick`), onglet Character Factory compris ; un élément
  pris comme image de début fait choisir laquelle de ses images (le plein
  pied d'abord, `POST /api/movie/element-image`) ;
- leur file ComfyUI directe devient **la file commune** (`jobs`), et leur
  bibliothèque de sortie la bibliothèque Asset filtrée `tool=movie`
  (« Toute la bibliothèque » pour comparer aussi d'autres vidéos) ;
- leur onglet « MiniMax H3 Base » devient **Comparer**, le banc NL de Cal
  (rideau, côte à côte, A, B, clignotement, zoom molette ancré sous le
  curseur jusqu'à 12×, boucle, ¼ ½ 1×, image par image, écoute A/B et
  volume, échange A⇄B, clavier) avec la recette de chaque plan et **ce qui
  diffère marqué** (≠, et la ligne « n différences : … ») ;
- l'assistant de prompt : l'interface (« décrivez simplement », « à
  garder », Écrire / Affiner) est là, désactivée avec sa raison ; la route
  `POST /api/movie/assist` répond 501 tant que le modèle de texte n'est pas
  câblé ;
- le temps estimé part de mesures faites sur **nos** DGX (§5), pas de leurs
  fourchettes RTX.

### Les entrées par position (Cal, 29/09)

« On ne les nomme pas par leur nom mais par @image1 @image2… car très
souvent on veut garder le prompt mais changer les images de ref » — comme les
« @ » de Higgsfield et de Magnific. Le cadre commun `commun/entrees.js` +
`commun/entrees.css` (repris ensuite par l'outil Image) :

- un seul cadre « Entrées » : une zone de dépôt ; les catégories Images,
  Éléments, Vidéos, Sons n'apparaissent qu'avec du contenu ; ce qu'on dépose
  (fichier du disque → bibliothèque `tool: upload`, `via: movie` ; ou vignette
  glissée d'ailleurs) va dans sa catégorie ;
- des jetons de position `@image1`, `@element1`, `@video1`, `@audio1` ; places
  stables : déposer sur une vignette la remplace, retirer laisse la place vide
  (son jeton rougit), « Tasser » renumérote et réécrit les jetons du prompt ;
- dans les trois champs, chaque jeton est vert s'il pointe vers une place
  remplie, rouge sinon, en direct (calque miroir derrière le `textarea`) ; `@`
  ouvre le menu des entrées ; Générer dit pourquoi il est grisé ;
- la capacité est un paramètre (`limits`, `cost`) : pour H3, 9 images (un
  personnage en envoie deux, visage et plein pied), 3 vidéos, 3 sons (bande-son
  de vidéo et voix d'élément comprises), 12 fichiers ; pas de places vides
  affichées d'avance, un compteur par catégorie, et un refus clair quand c'est
  plein (« plus de place pour une image : 9 / 9 images ») ;
- le serveur refait tout (`_inputs`, `check_tokens`, `swap_tokens`) : l'ordre
  d'H3 est images (catégorie Images, puis celles des éléments), vidéos, sons
  (bandes-son, sons, voix des éléments) ; une entrée non citée est seulement
  notée (elle est définie dans `subject_definitions`).

### Déposer partout, la file à droite (Cal, 29/09)

Tout emplacement qui attend un asset accepte un dépôt (`dropZone` du socle) :
début, fin, Entrées, A et B de Comparer ; les cartes des vidéos se glissent
(`dragItem`). « Vidéos générées » passe à droite (comme l'outil Image) : les
rendus y sont dès l'envoi, avec leur place dans la file, leur progression et
« Arrêter » ; un clic sur une autre vidéo la montre sans rien interrompre.
(Remplacé le même jour par le fil, ci-dessous.)

### Le fil, sur le modèle de Higgsfield (Cal, 29/09 après-midi)

Cal, avec quatre captures de Higgsfield : « regarde les interfaces de Higgsfield … cela est le
standard et les gens y sont habitués, le fait d'avoir un fil est assez pratique … pour le fil vidéo,
on fait aussi comme Higgsfield et au survol on a les options … le like, le recreate et le download
en accès direct, mais aussi un menu avec 3 petits points … le "reuse" est assez important pour les
images et vidéos car on est souvent en train de faire des variantes. »

La page devient deux colonnes, comme la capture 1 (page vidéo de Higgsfield) :

- **à gauche, les réglages** : onglets Créer | Comparer en tête (leur Create Video / Edit Video),
  la carte du modèle (MiniMax H3, avec l'état du moteur), les modes Texte / Images / Références,
  début · fin ou les Entrées, le prompt (les trois champs H3, caméra, réplique, exclusions,
  assistant), le format (famille, toile avec temps estimé, durée), les réglages avancés repliés
  (méthode, pas, graine et « d'origine », détail des références, LoRA, modèle, sampler, crf, prompt
  envoyé, graphe), et « Générer » au pied, le seul orange ;
- **au centre, le fil** (`commun/fil.js`, le même que l'outil Image) : en liste par défaut — la
  grande vidéo et sa carte à droite (modèle · mode · méthode, prompt aux jetons `@image1` surlignés,
  vignettes des entrées, puces toile · durée · famille · son, date) — ou en grille ; curseur de
  taille ; filtre (tout, aimés, cette session ; source : Vidéo ou toute la bibliothèque) ;
  recherche. Les rendus en file et en cours sont **en tête du fil** (place — « 2 devant », « le
  prochain » —, progression, étape, écoulé, restant, machine, Arrêter ; en échec : Relancer, ×) ;
  la vidéo prend la place de sa carte en arrivant, marquée « nouveau ». « Espace de travail »,
  « Vidéo en cours » et la colonne de droite disparaissent : tout est dans le fil et la visionneuse.
- **la visionneuse plein écran** (capture 3) : la vidéo en grand, lue en boucle ; à droite, le
  prompt (Copier), les entrées, la recette (`recipeRows`), le son et la musique demandés, le prompt
  envoyé à H3 et le graphe (repliés) ; « Réutiliser » (l'orange de cet écran), Recréer, Comparer,
  Continuer, Télécharger, aimer, ⋯. **La molette passe à la vidéo suivante ou précédente du fil**
  (les flèches aussi ; un panneau qui peut encore défiler garde la molette), Échap ferme ; au bout du
  fil chargé, la suite se charge.
- **au survol d'une vidéo** (capture 4) : aimer, réutiliser, recréer, télécharger en accès direct, et
  « ⋯ » (`commun/menu.js`) ; le même menu au clic droit sur la carte.

#### Les options du menu ⋯ : ce que le portail sait faire

Retenues (dans l'ordre du menu) :

| entrée | ce qu'elle fait | pourquoi |
|---|---|---|
| Ouvrir | la visionneuse plein écran | leur « Open » |
| **Réutiliser** | la recette dans le formulaire (mode, prompt et son, entrées ou images de début · fin, toile, durée, méthode, pas, LoRA, modèle, sampler, crf), **graine vidée** : « Générer » fait une variante ; la graine d'origine reste à un clic (« d'origine », réglages avancés) | leur « Reuse » ; l'action des variantes, que Cal a dite importante — aussi en accès direct et en orange dans la visionneuse |
| Recréer › nouvelle graine · à l'identique | remet en file, au nom de la personne, les réglages d'envoi de la vidéo (`POST /api/movie/redo`) | leur « Regenerate » ; « à l'identique » garde la graine (refaire un plan perdu, comparer deux méthodes) |
| Extraire une image › la première · la dernière | l'image rangée dans la bibliothèque, une seule fois (`POST /api/movie/frame`, ffmpeg) | pour reprendre un plan en image de début, en référence, dans Image, en élément |
| Continuer le plan | sa dernière image devient la première d'un nouveau plan (mode Images) | l'usage courant de la dernière image : enchaîner les plans |
| Prendre en référence | la vidéo dans les entrées du mode Références (`@video1`) | leur « Reuse » d'un mouvement ; H3 prend 3 vidéos de référence |
| Comparer › en A · en B | le banc A/B de Cal | remplace les boutons A et B des anciennes cartes |
| Agrandir dans Upscale | `upscale/?src=<id>` | l'outil Upscale prend les vidéos |
| Envoyer au Montage | `montage/?add=<id>` | la route d'entrée du Montage |
| Créer un élément | **désactivé, dit pourquoi** : un élément se fait d'images (et d'une voix) — tirer d'abord une image | la bibliothèque n'accepte pas une vidéo en référence d'élément (`POST /api/elements`) |
| Aimer | le drapeau `fav` de l'objet (`POST /api/library/<id>`), filtre « aimés » | leur « Like » ; c'était l'« Épingler » de l'ancienne page |
| Ajouter à un dossier › dossiers · Nouveau dossier… · Retirer | les dossiers d'Asset (`folder`) | leur « Add to folder » |
| Copier le prompt · Copier le lien | le prompt écrit ; `movie/#<id>` rouvre la visionneuse | le portail est en http : la copie passe par `execCommand` quand le presse-papiers moderne manque |
| Voir dans Asset · Télécharger | la fiche ; le mp4 | leur « Download » |
| Supprimer | à la corbeille, après confirmation (elle en revient depuis Asset) | leur « Delete », rouge ; jamais sans confirmation |

Absentes, parce que rien ne les fait ici : **Virality Predictor** (aucun modèle), **Change Color
Palette**, **Relight** et **Change Voice** d'une vidéo (aucun modèle local documenté pour
retoucher un plan H3 ; la voix d'un personnage passe par un élément avant le rendu), **Translate**
(pas de doublage de plan ; Movie Analysis double des films, pas les rendus), **Share** et
**Publish** (le portail n'est pas ouvert sur internet : `docs/etudes/cloudflare.md` — « Copier le
lien » sert entre les personnes du portail).

## 4. Réglages retenus, et pourquoi

| Réglage | Valeur | Source |
|---|---|---|
| Graphes | ceux du banc H3 de Cal (`SHOWRUNNER_SANDBOX/server/gabarits`, run **R5**) : Sol-Attn (`tau 1.3`, `diag`, `min_tokens 4096`), Spectrum, `ModelPreviewOverrideKJ`, `res_multistep`, `BasicScheduler simple` à planning complet, `VHS_VideoCombine` h264 crf 19 avec le son | README du banc ; HANDOFF_H3 §3–4 |
| Images/s | **24** (le banc écrivait 25) | `FPS = 24` dans le nœud ; note du gabarit officiel. À 25, l'image dure 4,96 s sous un son de 5,17 s |
| Durées | 124, 175, 226, 294, 362 images (5,2 à 15,1 s) | grille 17k+5 et plage entraînée du nœud ; liste de H3 Studio |
| Toiles | paysage 1344×768 / 1280×704 / 1024×576 / 864×480 ; 21:9 2240×960 (R5), 1792×768 (R0), 1344×576 ; portrait (les mêmes debout, 576×1024 du banc) ; carré 768 et 1024 ; « d'après l'image » en mode Images | H3 Studio ; banc de Cal (21:9 exact, « fixer width/height en dur ») ; `adapt_canvas` du nœud pour une image quelconque |
| Première image | recadrée au centre au rapport de la toile, et annoncée | le nœud l'étire (« plain stretch to canvas ») ; H3 Studio refuse au-delà de 3,5 % d'écart, ici on recadre |
| Méthode par défaut | **Turbo · banc de Cal** : LoRA turbo fl2v 4step v1.2 (Texte, Images) ou ref2v 4step v0.1 (Références) | défauts du banc H3 (R5) |
| Pas | turbo : **4** jusqu'à 1,4 Mpx, **8** au-delà ; origine et Spectrum : 20 (30, 50 en essai) | R0 propre à 1,38 Mpx en 4 ; R3 dédoublé à 2,15 Mpx en 4 ; R5 corrigé en 8 ; 20 = gabarit officiel |
| Méthode « Origine » | sans LoRA ni Spectrum, Sol-Attn gardé | gabarit officiel ; Sol-Attn = l'attention de ces machines (sageattention n'existe pas en aarch64, HANDOFF_H3 §3) |
| Détail des références | `match` (R5) ; `max` proposé, annoncé plus lent | infobulle du nœud |
| LoRA choisis | posés juste après le modèle, dans l'ordre affiché | `test-r2v-h3.py` (People puis cinéma) |
| Prompt Texte / Images | `integrated_multimodal_description`, `overall_soundscape`, `non_diegetic_music` ; ligne d'ancrage des images au-dessus, avec la durée à deux décimales | `VIDEO_PROMPT_WRITING_GUIDE_base_en.md` (MiniMax) |
| Prompt Références | six sections : `subject_definitions`, `summary [reference generation]`, `retention_analysis`, `detailed_description`, son, musique | `VIDEO_PROMPT_WRITING_GUIDE_ref_en.md` ; `Character_Factory/factory/prompts.py` |
| Rétention par rôle | personnage : `fully_preserved`, fonds et poses des références non reproduits ; lieu : `partially_preserved`, cadrage non reproduit ; look : `attribute_transfer` | le guide ; la planète de `test-r2v-h3.py` ; H3 Studio |
| Élément personnage | son premier visage et son premier plein pied (deux `<Picture>` pour un `<Subject>`) ; sa description en prose dans la définition | la méthode « .char » de V8 (personnage décrit une fois, appelé par son nom) |
| Son vide | « Natural diegetic sound of the scene… » ; musique vide : `N/A` | le guide : `N/A` seulement pour un silence voulu |
| Mémoire | sous 45 Go libres : décharger H3, puis le :8188 de la même machine, sinon refuser avec la raison | banc H3 (`MIN_FREE_GB = 45`, `/free` au corps vide) |
| H3 à la demande | démarré par le gardien quand un rendu attend (local ou `ssh` sur le câble 169.254.110.6 : clé DGX2 → DGX1 et `sudo -n` vérifiés) ; arrêté après **10 min** sans rendu, seulement s'il l'a démarré | mémoire de Cal « stop idle H3 » ; 10 min garde les modèles pour enchaîner les essais d'une séance. **Le temps de démarrage n'est pas mesuré** (H3 n'a pas été démarré ce soir) : à mesurer au câblage |

## 5. Temps mesurés (rendus de Cal, DGX1, pas refaits ce soir)

| Rendu | Toile | Images | Pas | Temps |
|---|---|---|---|---|
| R0 turbo | 1792×768 | 124 | 4 | 300 s |
| R3 turbo | 2240×960 | 124 | 4 | 510 s (visage dédoublé) |
| R5 turbo (retenu) | 2240×960 | 124 | 8 | 691 s |
| R6 turbo 8step | 2240×960 | 124 | 8 | 700 s |
| banc i2v | 1792×768 | 243 | 8 | 1024 s |
| banc ref2v | 1344×576 | 243 | 8 | 481 s |

Estimation affichée : `t ≈ 40 + 135·P + 9,8·P²·pas`, `P = Mpx × images / 124`,
ajustée sur R0, R3, R5 et les deux rendus du banc (écarts −12 % à +5 %) ;
fourchette −15 % / +20 % en turbo. Sans turbo : aucune mesure sur les DGX, la
fourchette est large (−40 % / +90 %) et le dit. Dès que des rendus H3 de l'outil
existent, l'estimation se recale sur eux (même méthode).

## 6. Ce qui est factice, ce qui reste à câbler

- **Moteur factice par défaut** (`movie_engine`, voie `cpu`) : ffmpeg testsrc2
  à la taille du plan, les images posées dessus, un bip dont la hauteur suit
  la graine ; la recette est complète et **le graphe H3 est construit et rangé**
  (dans la recette, et affiché dans « Réglages avancés »). Tout le parcours se
  teste sans GPU : `tools/check.py` le mène de bout en bout (trois rendus).
- **Moteur `h3`** : écrit, jamais essayé sur H3. À valider au câblage :
  la validation du graphe contre `/object_info` de :8189, la progression par
  le websocket (`executing`, `progress` de l'échantillonneur), le garde-fou
  mémoire, le gardien (start/stop), les références vidéo et son
  (`LoadVideo`, `LoadAudio`), la sortie `-audio.mp4` de VHS. Cal a déjà un
  câblage ailleurs : reprendre le sien là où il diffère.
- L'assistant de prompt (modèle de texte du portail, `llm_url`).
- Avant tout rendu sur DGX1 : vérifier le plafond d'horloge
  (`nvidia-smi -lgc 300,2000`, handoff du 25/09), toujours pas permanent.

## 7. Pièges rencontrés

- `.work` est aussi l'état « en cours » des pastilles du portail
  (`.pill.work`) : une classe d'outil qui porte ce nom met la pastille en
  colonne. L'espace de travail s'appelle `.wspace`.
- `replaceChildren(null)` écrit « null » dans la page : filtrer les nœuds.
- Captures sans affichage (swiftshader) : un voile `backdrop-filter` au-dessus
  d'une vidéo peut bloquer la capture ; la page, elle, répond (tâche la plus
  longue : 69 ms).
- La description d'un personnage importé de Character Factory contient son
  style (« Style : Painterly digital painting… ») ; elle part telle quelle
  dans `subject_definitions`. À trancher : garder, ou écrire le style à part.

## 8. Fichiers

`movie/index.html`, `movie/movie.js`, `movie/movie.css` ; le fil commun
`commun/fil.js`, `commun/fil.css` (et le menu `commun/menu.js`) ;
`server/tools/movie.py` (routes `GET /api/movie/options`, `POST /api/movie/plan`,
`GET /api/movie/loras`, `POST /api/movie/element-image`, `POST /api/movie/redo`
`{item, same_seed}`, `POST /api/movie/frame` `{item, which: first|last}`,
`POST /api/movie/assist`, `GET /api/movie/h3`, `POST /api/movie/h3/start|stop` ;
travaux `movie.t2v`, `movie.i2v`, `movie.r2v`) ; `server/workflows/h3_i2v.json`,
`h3_r2v.json`. Chaque vidéo garde, en plus de sa recette résolue, ses réglages
d'envoi (`params.request`) : Réutiliser et Recréer repartent d'eux (les vidéos
d'avant le 29/09 : refaits depuis la recette, `request_of`).
Réglages lus : `movie_engine` (`factice` | `h3`), `movie_stub_step_s`,
`h3_min_free_gb`, `h3_idle_minutes`, `h3_service`, `h3_neighbour_port`.
Paramètres d'URL : `?mode=t2v|i2v|r2v`, `?start=<image>`, `?ref=<id>`,
`#<vidéo>` (ou `?id=<vidéo>`) l'ouvre en grand, `?view=cmp&a=<id>&b=<id>`.
