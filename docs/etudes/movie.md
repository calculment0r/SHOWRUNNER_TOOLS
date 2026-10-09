# Vidéo (ex « Movie Creator ») — étude (28/09/2026, fil du 29/09)

Cal, 29/09 : « movie creator devient simplement "vidéo", movie creator c'est trop long et pas
clair ». Le nom affiché partout est **Vidéo** ; le chemin `movie/`, les travaux `movie.*`, les
routes `/api/movie/*` et l'interrupteur `movie_engine` gardent le leur (aucun lien mort).

Veille du 09/10 (`veille_1009.md`) : retirer, détourer, rééclairer un plan (LTX-2.5 et ses IC-LoRA, VOID,
l'inpainting d'H3), prolonger un plan, et le dialogue joué (« jeu libre → plans dialogués », § 2.8).

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
travaux `movie.t2v`, `movie.i2v`, `movie.r2v`) ; `server/tools/movie_invite.py` (09/10 : `POST /api/movie/apercu`, `POST /api/movie/invite`, travail `movie.invite`, § 9) ; `server/workflows/h3_i2v.json`,
`h3_r2v.json`. Chaque vidéo garde, en plus de sa recette résolue, ses réglages
d'envoi (`params.request`) : Réutiliser et Recréer repartent d'eux (les vidéos
d'avant le 29/09 : refaits depuis la recette, `request_of`).
Réglages lus : `movie_engine` (`factice` | `h3`), `movie_stub_step_s`,
`h3_min_free_gb`, `h3_idle_minutes`, `h3_service`, `h3_neighbour_port`.
Paramètres d'URL : `?mode=t2v|i2v|r2v`, `?start=<image>`, `?ref=<id>`,
`#<vidéo>` (ou `?id=<vidéo>`) l'ouvre en grand, `?view=cmp&a=<id>&b=<id>`.

## 9. Fait le 09/10 — l'audit des références

Cal, 09/10 : « on appelle nos références avec "@xxx" mais on est sûr que cela marche bien dans tous nos modèles ? en
image j'ai l'impression que certains attendent d'autres conventions de noms … il faut que le user puisse le faire
tout le temps de la même façon. […] regarde par exemple mon dernier essai vidéo avec ce prompt : "il mange des
@element1 et @element2 se dispute en francais, il en viennent aux main , cinema d'action". Mon output est
complètement nul … il n'a même pas vraiment utilisé les character sheets je pense. » Et : « on veut pouvoir
facilement faire plusieurs résolutions, et même des plus faibles que celles proposées ».

Sources relues ce jour (GitHub ; Hugging Face est fermé au conteneur) : le guide officiel d'H3,
**MiniMax-AI/MiniMax-H3** `skills/h3-prompt-writing/` (`SKILL.md`, `references/base-en.txt`, `references/ref-en.txt`)
et son README ; ComfyUI `comfy_extras/nodes_minimax_h3.py`, `comfy/text_encoders/minimax.py`,
`comfy_extras/nodes_qwen.py`, `comfy/text_encoders/qwen_image21.py` ; les README de `lbouaraba/comfyui-krea2edit` et
`lbouaraba/krea2edit-trainer`, `krea-ai/krea-2` (`docs/prompting.md`).

### 9.1 La carte : où l'on nomme une référence, et ce que chaque modèle en reçoit

Avant le 09/10, **trois grammaires** coexistaient : la place par sorte (`@image1`, `@element1` : Vidéo Références),
l'étiquette du modèle tapée à la main (`<image1>` pour Qwen dans Image et Idéation ; `<Picture 1>` dans Vidéo Images
et la carte Générer vidéo d'Idéation), et rien du tout (Krea 2 : « l'ordre suffit » ; le « @ » y était refusé).

| où | avant | après |
|---|---|---|
| Vidéo · Références (`commun/entrees.js`, `movie._inputs`) | `@image1` `@element1` `@video1` `@audio1` → `<Subject k>`, `<Video k>`, `<Audio j>` | inchangé, par l'analyseur commun |
| Vidéo · Images | `<Picture 1>` à la main ; un `@` refusé (« ne sert qu'en Références ») | `@image1` (la première envoyée), `@image2` → `<Picture n>` |
| Vidéo · Multishot (`commun/multishot_texte.js`) | `@element1 (S1) says: <d>…</d>` ; « (about N seconds) », case éteinte | les mêmes répliques ; `[Shot 2] At 00:02.700,` toujours (guide § 4.2) |
| Image · Qwen-Image 2.1 | le « @ » posait `<image1>` | `@image1`, `@element1` → `<imageN>` à sa place du carrousel |
| Image · Krea 2 | « @ » refusé | `@…` → « the scene », puis « the subject » |
| Image · Z-Image | « @ » refusé | refusé avant le rendu, avec la raison |
| Idéation · cartes Générer, inspecteur | comme Image ; `<Picture n>` pour la vidéo | `@image1`, `@element1` ; `@image1` / `@image2` en vidéo Images |
| Idéation · l'agent | aucune règle | « name a reference only by its place … @image1, @element1 » |

L'analyseur commun : `server/core/mentions.py` (et `commun/mentions.js`, le même motif) ; chaque outil tient la table
de ses places vers la convention de son modèle (`docs/ARCHITECTURE.md`, « Les mentions »). Une mention qui ne pointe
vers rien — une place vide, une référence grisée, un modèle sans référence — est refusée avant le rendu.

Les conventions **documentées** :

| modèle | ce qu'il lit | source |
|---|---|---|
| MiniMax H3 | `<Picture i>`, `<Video k>`, `<Audio j>`, 1-based par sorte, dans l'ordre images, vidéos (la bande-son juste avant sa vidéo), sons ; `<Subject N>` pour un contenu défini dans `subject_definitions` | `minimax.py` : « "<Picture %d>: " » devant chaque bloc de vision ; le nœud : « Use the same tags when prompting » ; `ref-en.txt` § 2 |
| Qwen-Image 2.1 | `<image1>`, `<image2>`… dans l'ordre d'envoi | `qwen_image21.py` : `"<image{}>…".format(i + 1)` devant chaque image |
| Qwen-Image-Edit 2511 | « Picture 1: » | `TextEncodeQwenImageEditPlus` ; chez nous l'outil Angle, sans prompt libre |
| Krea 2 Identity Edit | aucune étiquette : la scène (`source_latent`), le sujet (`source_latent_b`) ; des consignes en langage courant | README comfyui-krea2edit ; krea2edit-trainer : « The caption is the instruction ("place her on a beach at sunset") » |
| Z-Image | aucune image d'entrée | § 3 de image.md |

Ce que le guide d'H3 demande et que le portail ne faisait pas (ou mal) : **tout en anglais** sauf les répliques dans
`<d>` et le texte visible (« Write all six rewrite sections in English ») ; 350 à 500 mots de description, plan par
plan ; `[Shot 2] At 00:03.500,` pour chaque plan suivant ; un locuteur `(S1)` par voix, `(S1,S2)` ensemble, la voix de
référence liée à son sujet (« <Audio 1> is the voice-timbre reference for <Subject 1> (S1) ») ; les vidéos et les sons
définis dans `subject_definitions` avec leur ligne de rétention ; « appears in » les plans réels ; les lignes
d'ancrage FL2VA et L2VA (« How the reference pictures align with the target video — … ») ; « field: … » sur la même
ligne en mode de base. Et le README : la version ouverte d'H3 n'inclut pas **H3-Context-IR**, le réécrivain de son
pipeline — « H3-Context-IR is critical to the quality of the final output, so we strongly recommend incorporating it
into your generation pipeline or following the "Prompting Guidance" to build your own context-processing system ».

### 9.2 L'essai de Cal, rejoué par le vrai chemin de compilation

Deux personnages de Character Factory (visage verrouillé, un look, deux tenues, des expressions, une voix : la forme de
`core_api._walk_cf`), Brouillon, 124 images. Ce que H3 recevait (extrait, mot pour mot) :

```text
subject_definitions:
<Subject 1> is Marc, male, 34, Mediterranean, athletic, 1m82. Visage carré, barbe de trois jours, cheveux noirs
courts. Costume bleu marine, chemise blanche. Colérique, loyal. Style : Painterly digital painting, cinematic light,
whose face, hair, age and identity come from <Picture 1>, and whose body proportions and outfit come from <Picture 2>.
<Subject 2> is Léa, …
summary:
[reference generation] il mange des <Subject 1> et <Subject 2> se dispute en francais, il en viennent aux main ,
cinema d'action. <Audio 1> is the voice reference of <Subject 1>: timbre, tone and delivery only, never its words.
retention_analysis: …
detailed_description:
r34l1sm. DY. [Shot 1] il mange des <Subject 1> et <Subject 2> se dispute en francais, il en viennent aux main ,
cinema d'action
overall_soundscape:
Natural diegetic sound of the scene, in sync with the action on screen.
non_diegetic_music:
N/A
```

Images envoyées : **quatre**, `<Picture 1>` visage de Marc, `<Picture 2>` son premier plein pied, `<Picture 3>` et
`<Picture 4>` de même pour Léa ; toile 1536 × 640 en deux étages depuis 768 × 320 ; 5,17 s ; 8 pas. Pourquoi c'est
mauvais, cause par cause :

1. **La langue.** Tout est en français (la description, le résumé, la définition de chaque personnage) ; le guide veut
   l'anglais partout sauf dans `<d>`. Qwen3-VL lit le français, mais H3 a appris sur des réécritures anglaises.
2. **La grammaire.** « il mange des `<Subject 1>` et `<Subject 2>` se dispute » se lit « il mange des Sujet 1 » : les
   personnages deviennent le plat ; « il » n'est personne ; « se dispute » n'a pas de sujet.
3. **Aucune structure.** 18 mots pour 350 à 500 attendus ; manger, se disputer et se battre dans un seul plan de 5,17 s,
   sans cadre, sans caméra, sans lieu, sans lumière ; « cinema d'action » est un mot abstrait (« Prefer concrete visual
   and audio details over abstract words like "cinematic" ») ; et la définition de Marc ajoute « Style : Painterly
   digital painting » (le style de sa fiche) : un tableau, pas du cinéma.
4. **Pas une réplique.** « se dispute en français » sans les mots : H3 ne dit que ce qui est écrit dans
   `<d>[French] …</d>` (« Inside <d>, include only … the actual user-provided spoken content ») ; la voix de Marc
   (`<Audio 1>`) était une référence de timbre pour une voix que rien ne faisait parler.
5. **Les images des personnages.** Un personnage de Character Factory n'a ni la planche « corps 3 vues visage
   masqué » ni les 5 crops « .char » (REPRISE § 2.F) : il envoie son visage verrouillé et le plein pied de sa première
   tenue, rien d'autre — ses expressions, ses looks, ses autres tenues ne partent pas. Les « character sheets » de Cal
   (les planches de ses scripts) ne sont pas dans ces éléments. Et deux personnages complets (5 + 5 images)
   auraient été **refusés** : H3 prend 9 images.
6. **Le Multishot** écrivait des plans sans temps de coupe, et le résumé recopiait toute la description (plans et
   répliques compris) ; la rétention mettait chaque sujet dans tous les plans.

### 9.3 Ce qui change

- **Une grammaire** (§ 9.1), un analyseur, une table par modèle, le refus avant le rendu.
- **La mise en forme de l'invite** (`server/tools/movie_invite.py`) : le réécrivain que le README recommande, en local.
  Le modèle de texte (Ollama, le modèle de l'agent d'Idéation ; travail `movie.invite`, le jeton GPU de sa machine,
  déchargé après) reçoit l'intention de la personne, la durée, la toile, chaque entrée (ce qu'elle est, sa
  description), la langue des répliques (choisie, nommée — « en français » —, sinon celle du texte), le découpage du
  Multishot s'il existe, et des règles tirées du guide. Il rend un objet structuré (schéma JSON ; les jetons des
  sujets en liste fermée) : le style, l'apparence de chaque sujet en anglais, les plans (début, description, répliques :
  qui, langue, mots, ton), le son, la musique, le résumé. **La forme est du code** : `[Shot n] At MM:SS.mmm,` (les débuts
  relus : premier à 0, croissants, dans la durée ; sinon parts égales, et c'est dit), `(S1)`, `(S2)` dans l'ordre des
  premières répliques, `<d>[French] …</d>` sans un mot changé, le style avant `[Shot 1]` en Références et après en mode
  de base. Le résultat remplit les champs de la page (`desc`, `sound`, `music`, `subjects` — les définitions en
  anglais —, `summary`) : la personne relit, corrige, puis lance. Sans modèle de texte, le gabarit (le texte gardé, en
  plans, temps posés) et la raison. `POST /api/movie/apercu` montre à tout moment ce que H3 recevra, avec ses
  vérifications (mentions, entrées citées, langue, plans et temps, répliques, longueur, images de chaque élément,
  toile).
- **La compilation pour H3** suit le guide mot pour mot : lignes d'ancrage I2VA, FL2VA, L2VA ; « field: » sur la même
  ligne ; vidéos et sons dans `subject_definitions` et `retention_analysis` ; la voix d'un élément reprend le `(Sx)` de
  son sujet ; « appears in » les plans où le sujet est écrit ; le résumé est la première phrase du premier plan sans
  ses répliques (ou celui de la mise en forme) ; un temps de coupe hors de la durée bloque le rendu ; un texte français
  est signalé, comme la description française d'un élément.
- **Les images des éléments** : les 9 places se partagent (`movie.fit_budget`) — chacun garde d'abord son identité
  (la planche, le visage de face, le plein pied, le haut de la tenue, le 3/4…), on retire à celui qui en a le plus
  sa pièce la moins utile, jamais la dernière, et c'est dit. Deux personnages complets : 5 + 4 (le second laisse son
  dos en Qualité, son 3/4 sourire en Brouillon). Aucun guide ne documente ce partage : **décision du portail**, à
  juger au rendu.
- **L'échelle des toiles** (`movie.scale`, `/api/movie/options` → `scale`, et dans chaque plan) : un format, puis un
  préréglage. Deux préréglages plus petits : **Esquisse** — le premier étage du Brouillon (768 × 320 au 2,4:1), rendu
  seul : sa toile est déjà rendue par la recette validée de Cal — et **Léger** (le double de son aire, un étage). Les
  aires de la recette au 2,4:1, reportées à chaque format, en multiples de 32 (le nœud : min 32, pas 32 ; aucun autre
  plafond, `MAX_PIXELS` ne servant qu'à `adapt_canvas`) ; le Brouillon est le double exact de l'Esquisse :

| format | Esquisse (1 étage) | Léger (1 étage) | Brouillon (2 étages) | Qualité (1 étage) |
|---|---|---|---|---|
| 2,4:1 | 768 × 320 · ≈ 1,2–1,7 min | 1152 × 480 · 2,1–3,0 | 1536 × 640 · 3,6–5,2 | 1920 × 800 · 7,3–10,3 |
| 21:9 | 736 × 320 | 1120 × 480 | 1472 × 640 | 1792 × 768 |
| 16:9 | 672 × 384 | 1024 × 576 | 1344 × 768 (la toile par défaut du nœud) | 1536 × 864 |
| 4:3 | 608 × 448 | 896 × 672 | 1216 × 896 | 1408 × 1056 |
| 1:1 | 480 × 480 | 736 × 736 | 960 × 960 | 1248 × 1248 |
| 3:4 | 448 × 608 | 672 × 896 | 896 × 1216 | 1056 × 1408 |
| 9:16 | 384 × 672 | 576 × 1024 | 768 × 1344 (le plafond cité) | 864 × 1536 |

  Temps pour 124 images à 8 pas, à l'échelle des rendus de Cal (l'Esquisse et le Léger à la vitesse du Brouillon :
  **non mesurés**). Le paramètre `format` du plan choisit la ligne ; « Paramètres avancés » garde sa toile libre.
- **Admin → Diagnostics → « Rendus · ce que le modèle a reçu »** (`tools/diag_rendus.py`) : pour les dernières vidéos,
  le préréglage, la toile et ses étages, ce que la personne a écrit, les mentions, chaque sujet, les images envoyées
  dans l'ordre de `ref_images` (de quel élément, quelle pièce), les vidéos, les sons, ce que le plan a dit avant le
  rendu, le graphe, puis l'invite en entier ; pour les dernières images, le modèle, les références dans l'ordre, le
  prompt écrit et le prompt envoyé. La recette d'une vidéo garde désormais ses sujets, ses remarques et son format.

Le même essai, après (le faux modèle de texte du contrôle, pour la forme ; le vrai rédige le contenu) :

```text
detailed_description:
r34l1sm. DY. Live-action, cinematic action film look with hard daylight, high contrast and a handheld camera.
[Shot 1] Wide shot of a small kitchen table at noon: <Subject 1> and <Subject 2> sit facing each other over steaming
bowls of noodles, eating with chopsticks. The camera holds a static shot.
[Shot 2] At 00:02.700, Medium close-up on <Subject 1>, who slams his bowl down … <Subject 1> (S1) shouts angrily:
<d>[French] Tu as encore pris ma part !</d> <Subject 2> (S2) snaps back: <d>[French] C'est faux, menteur !</d>
[Shot 3] At 00:05.300, <Subject 1> and <Subject 2> stand up and grapple, the table tips over …
```

### 9.4 Ce qui reste, ce qui n'est pas vérifié

- **La mise en forme n'a pas tourné sur le vrai modèle** (le conteneur n'a pas d'Ollama) : à essayer sur DGX2 avec
  l'invite de Cal (temps de l'appel, anglais, longueur, répliques), puis un rendu A/B : le texte de Cal tel quel contre
  sa mise en forme, même graine, Esquisse puis Brouillon.
- **Esquisse, Léger et les formats autres que 2,4:1 n'ont jamais été rendus** : la qualité d'H3 à 0,25 Mpx, et les toiles
  de la Qualité au-delà de 768 de petit côté (16:9 : 864 ; 4:3 : 1056), sont à voir ; les temps sont extrapolés.
- **Le partage des 9 images** et les mots « the scene » / « the subject » de Krea 2 sont des décisions (aucune
  documentation) : à juger aux rendus.
- **Les personnages de Character Factory** n'ont toujours ni planche masquée ni crops `.char` : le studio ne les fait
  pas ; tant qu'ils manquent, H3 ne reçoit que leur visage et leur premier plein pied (le diagnostic le montre).
- La page Vidéo (l'agent « video-ux ») doit afficher l'aperçu et le bouton de mise en forme : `POST /api/movie/apercu`,
  `POST /api/movie/invite` (le travail, son `result.invite`), `scale` d'`/api/movie/options`.
- Vu en passant, non corrigé : un Brouillon sur une toile avancée dont un côté n'est pas multiple de 64 (1920 × 800,
  864 × 480) a un premier étage qui n'est pas la moitié exacte de la toile (960 × 384 pour 1920 × 800).

## 10. Fait le 09/10 — l'expérience

Cal, 09/10 : « pourquoi dans H3 on a le format (carré, 16:9 etc.) dans les paramètres avancés ? ce n'est pas
logique… on veut aussi pouvoir facilement faire plusieurs résolutions et même des plus faibles… pourquoi on ne peut
pas drag drop des éléments depuis la bibliothèque accordéon dans la zone des références… le multishot ne va pas car
on ne peut pas drag and drop les éléments ou références dedans car il est en pop-up… très compliqué, trop de texte
partout, les infos les plus importantes sont mal hiérarchisées… Je n'arrive pas à modifier les longueurs de plan par
leurs handles sur la timeline. »

### 10.1 L'état des lieux (la page du 08/10, relue et essayée en portail d'essai)

Le parcours d'un plan en Références, de haut en bas de la colonne de gauche (350 px) : la carte du modèle (un grand
« H3 » en filigrane, le moteur), les trois modes en tuiles, le cadre Entrées (une zone de dépôt, puis une phrase de
quatre lignes sur les jetons), la carte Prompt (un compteur « 0 mot · visé 350–500 », l'intitulé
« Ce qu'on voit et entend · detailed_description », un champ de six lignes, Son, Musique, cinq aides en puces), la
carte Préréglage (deux boutons à trois lignes de texte chacun, une note de trois lignes, le curseur de durée), puis
« Réglages avancés » replié — et c'est là, sous le profil de la recette, qu'étaient **le format et la toile**.
« Générer » au pied, avec les blocages en capitales orange et une phrase sur le fil.

- **Caché** : le format et la résolution (dans l'avancé, sous « Toile », derrière une famille puis une ligne) ; le
  temps de chaque toile ; ce que le modèle reçoit (le prompt envoyé, en bas de l'avancé).
- **Trop bavard** : chaque bloc porte sa phrase d'aide (Entrées, Préréglage, Durée, Comparer…), les deux préréglages
  répètent leur note, le pied répète que le rendu paraît dans le fil ; le modèle a une carte entière alors qu'il n'y en
  a qu'un. À 800 px de haut, le prompt commence sous le pli : on ne voit à la fois ni l'invite, ni la durée, ni le bouton.
- **Mal hiérarchisé** : l'ordre de la colonne est celui du graphe (modèle, entrées, prompt, réglages), pas celui
  d'une intention ; les réglages qui changent le résultat (format, résolution, durée) sont au même rang que le
  détail des références ou le crf.
- **Le Multishot** (`commun/multishot.js`) est une fenêtre par-dessus la page : on n'y glisse rien depuis le panneau
  Asset (la fenêtre couvre tout), et il faut « Écrire dans le prompt » pour qu'il compte. **Ses poignées ne
  marchaient pas** : au premier mouvement, la frise était redessinée (`paintTl`), la poignée tenue sortait de la page
  avec sa capture du pointeur, le glisser s'arrêtait — essayé : 120 px de glisser déplaçaient la coupe de 0,1 s.
- **Le glisser d'un élément** : depuis « Ce workspace » du panneau Asset, un élément glissé sur les Entrées arrive
  bien (`ITEM_MIME`, essayé) ; mais un personnage de la section **Character Factory** du panneau, pas encore importé,
  ne porte que `CF_MIME` (`commun/dock.js`), que seul le canevas d'Idéation comprenait : `dropZone` (le dépôt de tous
  les outils) le refusait sans rien dire. C'est le cas des personnages de Cal : « les images marchent mais pas les
  éléments ».

### 10.2 Ce que fait la barre d'Image, et pourquoi elle marche

`image/` (29/09, capture 2 de Higgsfield) : le fil sur toute la largeur et une barre flottante en bas, trois lignes —
les références en vignettes (on y dépose, on les réordonne en les glissant), le prompt d'une à trois lignes, des
puces (modèle, format, taille, nombre, prise de vue, LoRA, avancé) qui ouvrent un petit menu vers le haut ou un
panneau au-dessus de la barre ; à droite, « Générer », le seul orange, avec le temps mesuré. Elle marche parce que
**tout ce qui change le résultat est visible d'un coup d'œil** (chaque puce montre sa valeur), que l'aide est dans les
infobulles, que le résultat paraît juste au-dessus, dans le fil, et que la barre ne bouge pas quand on fait défiler.

### 10.3 La nouvelle hiérarchie

La page Vidéo prend la forme d'Image : le fil sur toute la largeur, la barre de création en bas. Ce qu'on voit d'abord,
dans cet ordre : **l'invite et ses références** (les vignettes et leur jeton `@element1`, le nom de l'élément),
**le format** (16:9, 9:16, 1:1, 2,4:1, 21:9… dessinés), **la durée** (aux pas d'H3), **la qualité et la résolution**
avec le temps estimé, **le bouton**. Le reste est replié derrière une puce : le son et la musique, les aides d'écriture
(caméra, réplique, exclusions, assistant), les réglages avancés (pas, graine, LoRA, modèle, crf, détail des
références, graphe), et « ce que H3 reçoit ». Le Multishot s'ouvre **dans la barre**, au-dessus de l'invite : la frise
des plans, le plan choisi édité sur place, et l'on y dépose les éléments comme ailleurs.
