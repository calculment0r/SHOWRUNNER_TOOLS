# Étude — Object Creator refait, et la voie des scènes : vues, multi-vues, gaussian splatting, 3D → vidéo H3 (09/10/2026)

Cal, 09/10, en substance : « Le mode création d'objet n'est pas assez fonctionnel. Quand je donne l'image d'une
voiture en perspective, il ne me propose pas automatiquement de faire les vues dont il a besoin pour faire le modèle.
Regarde si en mettant plus d'images ce serait mieux. On valide les vues principales, et si on valide on refait plus de
vues avec nos vues validées, pour avoir un modèle et des textures super bien faits. Ça marche à peu près : il me fait un
modèle assez fidèle. Mais on doit avoir aussi les images pour faire une sheet pour H3, et les images du modèle. Les
objets créés sont comme les characters : des éléments. […] une image de décor → un objet où l'on serait à l'intérieur ;
un château → un objet ; une pièce intérieure → sûrement une autre technique. On va vouloir des objets 3D en gaussian
splatting aussi : une scène → générer avec l'IA toutes les images pour valider l'espace et, si le user le veut, un
gaussian splatting, une vidéo dedans avec H3 ? […] On pourra intégrer des assets 3D pour faire du blocking → 3D to video
en H3. Il y a des trucs qui traînent pour H3 déjà faits, regarde bien, il faut sûrement la Z depth. Un pipeline
"omnisplat" fait par quelqu'un : il nous faut un truc comme ça avec les meilleures technos. » Liens donnés :
Bingeljell/image-to-3dlab, les nœuds 3D de visualbruno, rookiestar28/ComfyUI-MiniMaxH3-Studio, deux LoRA d'angles
pour Qwen-Image 2.1 (lilylilith/QI_2.1_AnyAngle, akhaliq/Qwen-Image-2.1-Multiple-Angles-LoRA).

**Statut** : étude, et un premier lot codé (§ 11, « Fait le 09/10 ») — le parcours « propose les vues, on valide, on
affine » de bout en bout, sur des moteurs factices, prêt à brancher. Aucun rendu réel, aucun téléchargement (pas de GPU
ici) : chaque essai est un protocole pour Cal (§ 9), chaque poids attend son accord.

Ce que vaut chaque fait (la convention de `veille_1009.md`) : **[lu]** dans le code, un README, une licence ou un
gabarit, lus en entier depuis GitHub ; **[extrait]** extrait de moteur de recherche seulement (huggingface.co,
comfyui-wiki.com, docs.comfy.org ne répondent pas d'ici ; les sources de docs.comfy.org sont lues dans leur dépôt
GitHub) ; **[calcul]** ; **[supposition]**. Versions lues : ComfyUI `830232b8` (v0.37.2, **celle des DGX**) et
`08ff3c11` (le 09/10) ; Comfy-Org/docs `2c66540` ; microsoft/TRELLIS.2 `75fbf01` ; visualbruno/ComfyUI-Trellis2
`b0e84c0` ; cuzelac/ComfyUI-Trellis2-MultiViewRefiner `f8c676a` ; Bingeljell/image-to-3dlab `d16bcd7` ;
T8mars/Comfyui-Qwen-Image-2.1-MultiAngle-T8 (« AnyAngle Studio », v1.6.3) `cc17129` ;
rookiestar28/ComfyUI-MiniMaxH3-Studio `8999053` ; mickmumpitz/ComfyUI-SplatKit `47c93ee` ;
ByteDance-Seed/Depth-Anything-3 `3d835ec`.

## Résumé pour Cal (une page)

- **Fait (le lot codé)** : à l'arrivée d'une image, la fiche de l'objet montre déjà son plan — l'image choisie à sa
  place, les quatre vues principales prévues (face, gauche, dos, droite) ; on dit d'où l'image voit l'objet (une
  boussole : la voiture en 3/4 avant gauche → la face rentre dans le plan), ou le modèle qui voit le propose (avec ce
  que montre l'image : objet, bâtiment, décor, pièce, personnage). « Générer » : un travail par vue. Chaque vue se
  garde, se refait, se rejette. Les principales décidées, « Plus de vues » fait les 3/4 et le dessus, **chacune
  depuis la vue gardée la plus proche**. Puis la 3D (TRELLIS.2), ses rendus, la planche pour H3 ; Vidéo envoie à H3 la
  planche de l'objet puis ses vues. L'objet reste un élément. Les générateurs sont derrière un interrupteur ; sans lui,
  des mires factices montrent tout le parcours.
- **Les vues, recommandation nette** : (1) **tout de suite, sans téléchargement**, Qwen-Image-Edit 2511 + le LoRA
  Multiple-Angles de fal, déjà installé et câblé dans Image (« Angle ») : `objet_vues = qwen-edit-2511` ; (2) **la
  cible : AnyAngle** (Qwen-Image 2.1 + un LoRA de 120 Mo) — l'angle vient d'un **rendu du modèle 3D** que TRELLIS.2
  fait déjà « assez fidèle », le style de la vue de départ : la géométrie des vues est juste **par construction**, et
  la boucle de Cal (vues validées → meilleur modèle → meilleures vues) s'y lit telle quelle ; (3) l'autre LoRA
  d'angles pour Qwen 2.1 (akhaliq, appris sur des objets) en comparaison, s'il faut des vues sans modèle 3D.
- **Le multi-vues, recommandation nette** : TRELLIS.2 officiel ne lit **qu'une** image [lu]. Le seul multi-vues
  **natif** de notre ComfyUI 0.37.2 est **Pixal3D Multi-View** (face, gauche, dos, droite ; les mêmes VAE et le même
  DINOv3 que TRELLIS.2, déjà sur les DGX ; un fichier de plus) — mais Cal a écarté Pixal3D le 28/09 : **décision D2**.
  Sinon, garder la forme d'une image et **projeter les vues validées sur la texture** (visualbruno, image-to-3dlab).
  Hunyuan3D-2mv est natif aussi, mais sa licence exclut l'UE.
- **Plus d'images, est-ce mieux ?** Pour TRELLIS.2 : non, il n'en lit qu'une. Pour une reconstruction multi-vues :
  oui **si** les vues sont cohérentes (mêmes angles exacts, même échelle, hauteur d'œil) — sinon pire (« des entrées
  mal alignées donnent un résultat pire qu'une seule image », Character Factory). Pour les **textures** : oui, chaque
  vue couvre ce que l'image ne voit pas. D'où la validation par la personne, et AnyAngle qui donne des angles exacts.
- **Une pièce, un décor** : une autre technique (§ 5). La plus proche de « l'omnisplat » qu'a vue Cal, dans ComfyUI :
  **SplatKit** (MIT) — un panorama 360° → profondeur MoGe → un chemin de caméra → WAN comble ce que le panorama ne voit
  pas → structure-from-motion → un jeu de données pour un entraîneur de gaussian splatting. « OmniSplat » existe aussi
  comme article (CVPR 2025, deux panoramas → splats) ; la pièce de Cal n'a pas été transmise.
- **3D → vidéo H3** : « la Z depth », oui — **H3 Fun ControlNet Union** est natif dans notre ComfyUI 0.37.2 (depuis le
  31/08) : une vidéo de contrôle (profondeur, pose, contours) **avec** les références (ref2va). Le blocking : un GLB
  posé, une caméra qui bouge, la passe de profondeur rendue → H3 avec la planche de l'objet et les personnages. Un
  patch à télécharger (≈ 6,8 Go) ; la licence d'H3 exclut l'UE (`veille_1009.md`).
- **Le premier essai réel** (§ 9) : aucun téléchargement pour l'étape 1 ; puis `QI2.1_AnyAngle.safetensors`
  (lilylilith/QI_2.1_AnyAngle, ≈ 120 Mo, licence non écrite sur la carte d'après AnyAngle Studio : à lire) dans
  `ComfyUI/models/loras` des deux DGX. Les rendus n'ont besoin d'aucun poids (Render Mesh est un nœud natif).

## 1. État des lieux (lu dans le code le 09/10)

- **Object Creator** (`server/tools/objet.py`, `objet/`) : un objet est un élément `object` ; TRELLIS.2 **image unique**
  (`objet.mesh`, graphe de Character Factory `trellis2_single.json`, `pad_factor` 1,0), câblé sur DGX2
  (`objet_trellis: true`, REPRISE § 3 : ≈ 2 min 20) ; un cube de contrôle sans câblage. Les vues : l'étude du 28/09
  n'avait retenu aucun modèle (Krea 2 1/4, Qwen 2.1 turbo 0/4 en miroir, LoRA d'orbite 1/3 mais 128 clés non chargées)
  ; quatre emplacements à 90° remplis à la main. **Rien ne proposait les vues.**
- **Image** (`server/tools/image.py`) : l'outil **Angle** — Qwen-Image-Edit 2511 + LoRA Multiple-Angles de fal
  (Apache-2.0) + Lightning 4 pas, `factory/views_qwen.py` de Character Factory : `<sks> <azimut> <hauteur> <distance>`,
  8 azimuts, 4 hauteurs (−30 à 60°), 3 distances ; essayé fonction par fonction le 30/09 ; **« Angle "left" à
  vérifier »** (REPRISE § 2.F). Le détourage BiRefNet, wired.
- **Vidéo** (`server/tools/movie.py`) : H3 Texte, Images (première, dernière), Références (9 images, 3 vidéos, 3 sons) ;
  un personnage envoie sa planche « corps 3 vues visage masqué » et ses gros plans (Brouillon) ou ses 5 images
  « .char » (Qualité) ; un objet envoyait ses deux premières images, définies comme un personnage. Le LoRA H3
  **« Orbite 360° »** (`minimax_h3_flf2v_orbit360_v1`, première + dernière image) est dans la liste [lu]. **Rien sur la
  profondeur ni le contrôle** dans le portail (grep du 09/10) ; ComfyUI 0.37.2, lui, a `MiniMaxH3AddGuide` (une image ou
  un extrait ancré à n'importe quelle image du plan) et `MiniMaxH3FunControlNetApply` [lu].
- **Character Factory** (`character/js/schema.js`) : ses étages « Planche · H3 Ref2VA · 5 frames » (« sert à valider
  le design et la cohérence, pas à nourrir la 3D »), « Vues orthogonales · 0° 90° 180° 270° · ±5° » (« des entrées mal
  alignées donnent un résultat pire qu'une seule image ») et « Mesh 3D · TRELLIS 2 · Hunyuan3D 2.1 » [lu].
- **Le rendu déterministe** : Présentation · vidéo (`presentation_video.py`) pose chaque image à son instant dans
  Chromium sans affichage puis ffmpeg ; la visionneuse GLB (`character/viewer.html`, `ideation/objets/modele3d.js`,
  three.js 0.170) ; les images clés et courbes du motion (`ideation/presentation/courbes.js`) — de quoi rendre un
  chemin de caméra image par image (§ 4).
- **ComfyUI 0.37.2, natif** [lu, `comfy_extras/`] : TRELLIS.2 et Pixal3D (`nodes_trellis2.py`, 21/08, dont
  `Pixal3DMultiViewConditioning`) ; Hunyuan3D-2mv (`nodes_hunyuan3d.py`, forme seule) ; TripoSplat (01/06) et les
  splats (`RenderSplat`, `SplatToMesh`, `CreateCameraInfo`, 31/05) ; Depth Anything 3 (10/06 : profondeur mono et
  multi-vues, poses, nuage de points) ; MoGe 1-3 (15/05, dont `MoGePanoramaInference`) ; `Get3DComponents` (27/08 : un
  GLB → MESH) ; `RenderMesh` (une vue d'un mesh : texture, normales, **profondeur** — « near (small depth) = white »,
  masque) ; H3 et son Fun ControlNet (02/08, 31/08). Absents de 0.37.2 : `CameraAngle` et la nouvelle `CreateCameraInfo`
  (05-06/10, `nodes_camera*.py`).

## 2. Classer l'image : objet, bâtiment, décor, pièce, personnage

Ce que l'image montre décide de la technique (Cal) : **objet** et **bâtiment vu de dehors** → la voie objet (des vues
autour, un modèle) ; **décor extérieur** et **pièce intérieure** → la voie scène (§ 5 : on est dedans, rien ne se
tourne autour) ; **personnage** → Character Factory.

- **Le modèle** : celui qui voit des paliers d'Idéation (`qwen3-vl-32b-32k`, Ollama, `ideation_agent.route_vision` :
  sur la machine du modèle, la voie audio pour jeton GPU). **Un appel, sortie structurée** (`format` = un schéma JSON :
  la classe, le sujet en quelques mots, l'azimut parmi 8, la hauteur parmi 4) — le même `Moteur` que l'agent, rien de
  recopié. Le prompt donne la convention des côtés (« front-left = the camera stands toward the subject's own left
  side »).
- **Une proposition, jamais un ordre** : ce que la personne a dit (la classe, l'angle) n'est jamais remplacé ; la
  proposition est notée à côté. Sans modèle qui voit : rien d'inventé, la page le dit (« le modèle … ne voit pas les
  images »).
- **Non documenté** : la justesse de Qwen3-VL à estimer l'azimut d'un objet dans une image (aucune mesure publiée lue) ;
  le protocole § 9 le mesure sur la voiture. La profondeur et le champ (MoGe : `MoGeGeometryToFOV`) diraient la focale,
  pas le côté de l'objet.
- **Le coût** : charger 31 Go pour une image. À l'arrivée d'un objet neuf seulement, et seulement si la préférence le
  veut (« Demander au modèle qui voit à l'arrivée d'une image », oui par défaut) et si le modèle est là ; sinon un bouton.

## 3. La voie OBJET

### 3.1 Les vues proposées : lesquelles, combien

Le plan est fait **à l'arrivée**, sans calcul : il ne dépend que de l'angle de l'image.

| passe | vues | pourquoi (sources) |
|---|---|---|
| 0 | l'image choisie, à son angle | elle est une vue : la voiture en 3/4 avant gauche occupe 45° |
| 1 · principales | **face 0°, gauche 90°, dos 180°, droite 270°**, hauteur d'œil | les entrées de `Pixal3DMultiViewConditioning` (« front, left, back, right », « the same scale in every view », l'objet sur 1/1,1 du cadre, champ 20°) [lu] ; les nœuds multi-vues de visualbruno (`front_image`, `back_image`, `left_image`, `right_image`) [lu] ; Hunyuan3D-2mv (face, gauche, dos) [lu, docs] ; les « vues orthogonales » de Character Factory [lu] ; la planche « face, profil, dos » |
| 2 · affinage | **3/4 avant gauche 45°, 3/4 arrière gauche 135°, 3/4 arrière droit 225°, 3/4 avant droit 315°, dessus** | ce que la face et les profils voient mal (l'arrière en biais, le toit) : la projection de texture de visualbruno ajoute le dessus (`azimuts 0,90,180,270,0`, `hauteurs 0,0,0,0,90`) [lu] |
| 3 · à la main | n'importe quel angle de la grille (8 azimuts × 0°, 30°, 60°, et le dessus) | ce que l'objet demande (le dessous d'un vase, la calandre en contre-plongée) |

**La convention** : l'azimut se compte depuis la face, **vers la gauche de l'objet** (90° voit son côté gauche) —
celle de Pixal3D (`_VIEW_AZIMUTHS = {front 0, left 90, back 180, right 270}`), de visualbruno (`left az=90`) et des
anciens libellés d'Object Creator. Le repère des rendus : Y en haut, la face vers +Z, 90° sur +X.

**Combien** : 4, puis 5 — moins qu'un seul passage ne peut décider (H3 prend 9 images en tout ; une planche lisible,
3 ou 4 vues). L'image choisie remplace la vue de sa place ; la grille ne double jamais un angle.

### 3.2 Générer les vues : les candidats

| | nature | angles pilotables | entrée | licence | état chez nous | résultats |
|---|---|---|---|---|---|---|
| Krea 2 (prompt) | génération | dits en mots | texte + image | Krea 2 Community | installé | 28/09 : face juste 1/4 |
| Qwen-Image 2.1 turbo (prompt) | édition | dits en mots | image | Qwen Research (non commerciale) | installé | 28/09 : 0/4, en miroir |
| LoRA d'orbite (ML-Intern-lab) | LoRA Qwen 2.1 | une orbite | image | non lue | essayé le 28/09 | 1/3, 128 clés non chargées : l'essai ne compte pas |
| **Qwen-Image-Edit 2511 + Multiple-Angles (fal)** | LoRA d'édition | **8 azimuts × 4 hauteurs (−30 à 60°) × 3 distances**, `<sks> front-left quarter view eye-level shot medium shot` | une image | Apache-2.0 (LoRA) [`image.md`] ; Qwen-Image-Edit 2511 : non relue ici | **installé, câblé** (Image › Angle) | jamais jugé pour un objet ; « left » à vérifier |
| **akhaliq/Qwen-Image-2.1-Multiple-Angles-LoRA** | LoRA d'édition, Qwen 2.1 | **12 azimuts (30°) × 4 hauteurs (0, 30, 60, 90) + gros plan** (72), `<mva> back view, eye-level shot` [extrait] | une image | Apache-2.0 [extrait, à lire] ; données Dome-Objaverse (CC-BY-4.0) [extrait] | à télécharger (v1 `multiple_angles_step1000.safetensors` 159 Mo ; v2 du 07/10, ≈ 319 Mo, conseillée [extrait]) | appris sur des **objets** ; « human-subject angles are untested » ; proportions qui dérivent dans ses exemples [extrait] |
| **lilylilith/QI_2.1_AnyAngle** | LoRA d'édition, Qwen 2.1 | **n'importe lequel** : l'angle vient d'un rendu grossier du modèle 3D à la caméra voulue | **deux images** : l'originale (`image_1`) et le rendu (`image_2`) ; « Change the camera angle from <image2> to <image1>. » [lu, gabarit T8] | non écrite (« Refer to the original model repository », T8 THIRD_PARTY) | à télécharger : `QI2.1_AnyAngle.safetensors`, ≈ 120 Mo [extrait] | « only as good as the reconstruction » [extrait] ; le style de l'originale gardé |

**AnyAngle contre Multiple-Angles 2.1 (akhaliq)**, ce que demandait le lot :

- **Nature** : les deux sont des LoRA d'édition de Qwen-Image 2.1. Multiple-Angles **imagine** la vue d'après un mot
  (`<mva> left side view, eye-level shot`) ; AnyAngle **recopie** une vue qu'on lui montre (le rendu du modèle 3D) dans
  le style de l'originale. Le premier invente la géométrie ; le second la reçoit.
- **Déclencheurs** : `<mva> {azimut}, {hauteur}[ close-up]`, des libellés et non des degrés (« 47° » n'est pas lu,
  [extrait]) ; AnyAngle : la phrase du gabarit, telle quelle, et les deux images dans cet ordre.
- **Angles** : 72 cases fixes contre une caméra libre (focale comprise, AnyAngle Studio : 12–200 mm [lu]).
- **Réglages** : Multiple-Angles, force 0,8–1,0 [extrait], pas et CFG non lus ; AnyAngle, **20 pas, CFG 3, euler /
  simple**, Qwen-Image 2.1 de base (`AnyAngle-Studio-Qwen21-API.json`) [lu] ; avec le turbo Viggle (6 pas) de
  Character Factory : **non documenté** (le gabarit turbo d'AnyAngle Studio n'emploie pas le LoRA AnyAngle [lu]).
- **Compatibilité avec notre Qwen 2.1** : les deux visent le même modèle (`qwen_image_2.1_int8_convrot`, l'encodeur
  `qwen3vl_8b_int8_convrot`, la VAE `qwen_image_2.1_vae_bf16` dans les gabarits d'AnyAngle Studio [lu]) ; les fichiers
  de Character Factory sont lus dans `factory/qwen21.py` (une seule vérité). **Le piège du 28/09** (un LoRA chargé à
  moitié) : un défaut connu de diffusers pour les LoRA Qwen 2.1 à `gate_up` fusionné, AnyAngle compris (160/232 couches)
  [extrait] ; AnyAngle Studio le charge dans ComfyUI 0.36 avec ses propres essais [lu] — le journal de ComfyUI dira au
  premier rendu s'il reste des clés non chargées.
- **Résultats** : aucun des deux n'est jugé chez nous. AnyAngle Studio montre ses rendus réels (une seule personne
  par image, 20 pas, CFG 3) [lu] ; Multiple-Angles, ses exemples.

**Recommandation** : (1) **essayer d'abord fal 2511** (installé : un interrupteur) ; (2) **AnyAngle ensuite, et le
garder s'il tient** : il est le seul où la géométrie des vues vient d'un objet 3D unique — les vues sont cohérentes
entre elles par construction, ce qu'aucun générateur « à l'angle dit en mots » ne garantit ; (3) Multiple-Angles 2.1
en troisième, pour comparer, ou pour un objet sans modèle 3D. Le générateur est un interrupteur (`objet_vues`) : on
compare sur le même objet sans rien recoder.

### 3.3 Valider, affiner

Le parcours codé (§ 11) : chaque vue proposée est une image de la bibliothèque (dossier « Objets »), filles de l'objet
et de la vue de départ ; **garder** en fait une référence `view` de l'élément (avec son angle) ; **refaire** propose
une autre image (une autre graine), la gardée le reste tant qu'on n'en garde pas une autre ; **rejeter** l'écarte ;
**rouvrir** défait l'un ou l'autre (Ctrl+Z). L'affinage s'ouvre quand chaque vue principale est décidée et qu'une au
moins est gardée. **La vue de départ d'une vue à faire** : la vue gardée la plus proche en angle (l'écart sur la sphère),
sinon l'image choisie — la plus grande surface vue en commun ; c'est notre règle, aucune documentation de modèle ne la
donne. AnyAngle n'en reçoit qu'une, les deux autres générateurs aussi.

### 3.4 La reconstruction multi-vues

| | vues | méthode | état | licence |
|---|---|---|---|---|
| TRELLIS.2 officiel | **1** (`run(self, image)`) ; la texture d'un mesh donné : 1 image (`Trellis2TexturingPipeline`) | — | câblé (image unique) | MIT + licence DINOv3 |
| PR 104 de TRELLIS.2 | plusieurs | moyenne des conditionnements ; « fatter or thinner » (étude du 28/09) | non fusionnée | — |
| visualbruno, « Mesh With Voxel Multi-View Generator » | face, dos, gauche, droite (hauteur 0) | **mélange spatial** : chaque voxel pondéré par sa position (softmax d'un score par vue, `blend_temperature`), une prédiction par vue à chaque pas [lu, `samplers/flow_euler.py`] — une heuristique, aucune mesure publiée | son propre TRELLIS.2 (cumesh, nvdiffrast, flex_gemm, o_voxel compilés ; roues Windows seulement ; Linux à compiler ; aarch64 non documenté) | MIT |
| cuzelac, « Mesh Refiner Multi-View » | jusqu'à 4 | le même mélange, pour raffiner un mesh | greffon de visualbruno | non lue |
| **Pixal3D Multi-View (natif 0.37.2)** | face, gauche, dos, droite ; la première est la face | conditionnement multi-vues avec caméras en orbite (champ 20°, 1/1,1 du cadre, même échelle) [lu] | un fichier : `pixal3d_multiview_int8_convrot.safetensors` (taille non lue) ; VAE et DINOv3 de TRELLIS.2 déjà là | MIT (code et poids) + DINOv3 (image-to-3dlab [lu]) ; **écarté par Cal le 28/09** |
| Hunyuan3D-2mv (natif) | face, gauche, dos | forme seule (« does not yet support texture » [lu, docs]) | à télécharger | **Tencent Hunyuan Community : pas l'UE, le Royaume-Uni, la Corée** [lu, image-to-3dlab] |
| image-to-3dlab (AssetFurnace) | **1** par moteur (Pixal3D, TRELLIS.2, Hunyuan3D 2.1) | « Pixel Match » : reprojette les pixels de l'image sur le mesh (Blender) ; planches d'accessoires ; rig | hors ComfyUI, son propre studio | Apache-2.0 |
| TripoSplat (natif) | 1 | une image → des gaussiennes (262 144) → `SplatToMesh` | 3,78 Go (5 fichiers) | MIT [extrait] |

**Recommandation** : lever ou confirmer le « pas de Pixal3D » du 28/09 pour son **seul** usage multi-vues (D2) — c'est
le seul multi-vues documenté, natif, sans compilation, qui consomme exactement nos vues principales. À défaut :
TRELLIS.2 image unique pour la forme, et les vues gardées **projetées** sur la texture (§ 3.5). Pas visualbruno sur
les DGX tant que ses extensions ne sont pas compilées pour GB10 (un chantier, et un second TRELLIS.2 à côté du natif).

### 3.5 Le texturage

- TRELLIS.2 cuit lui-même couleur, métal, rugosité, normales, occlusion (`BakeTextureFromVoxel`…) [lu, notre graphe].
- **Projeter les vues validées** : `Trellis2MultiViewTexturing` de visualbruno (face/dos/gauche/droite avec des poids) et
  ses gabarits `Projection_*_Qwen_XViews` (rendre le mesh, retoucher chaque rendu par Qwen, reprojeter) [lu] ; « Pixel
  Match » d'image-to-3dlab (les pixels de l'image sur ce qu'elle voit) [lu]. C'est exactement « des textures super bien
  faites » : chaque vue gardée peint ce qu'elle voit. Natif chez nous : `PaintMesh`, `ApplyTextureToMesh`,
  `MeshTextureToImage` existent (0.37.2) ; une projection multi-vues native : **non trouvée**.

### 3.6 Plus d'images, est-ce mieux ?

Non pour TRELLIS.2 (une image lue). Oui pour un modèle multi-vues **à condition** que les vues soient cohérentes :
mêmes angles que ceux qu'il suppose (0/90/180/270 à hauteur d'œil pour Pixal3D, visualbruno, Hunyuan3D-2mv), même
échelle, même lumière — sinon pire qu'une image (Character Factory). Oui pour la **texture** (chaque vue ajoute la
surface qu'elle voit). Donc : peu de vues, aux angles attendus, **validées** ; et des vues dont l'angle est exact par
construction (AnyAngle, depuis le modèle) plutôt qu'à l'angle « dit en mots ».

### 3.7 Les rendus, la planche pour H3, l'élément

- **Les rendus** (fait) : le GLB vu des 8 azimuts et du dessus, fond blanc, par **Render Mesh** (natif, aucun poids) :
  `Load 3D (Advanced)` → `Get 3D Components` → `Render Mesh`, une caméra `Create Camera Info` (mode `look_at`) par vue.
  La caméra vise le centre de la boîte du GLB (ses `min`/`max` passés par les transformations des nœuds), à la distance
  où sa sphère tient dans le champ (la formule du cadrage automatique de Render Mesh, `r / tan(fov/2) × 1,04`) : **une
  échelle pour toutes les vues, par construction**. Le dessus à 89° (à 90°, le repère « regarder vers » dégénère).
  **Non documenté** : de quel côté du GLB de TRELLIS.2 est la face de l'image — la fiche règle « la face du modèle »
  par quarts de tour, à caler au premier rendu (§ 9).
- **La planche** (fait) : **aucun guide MiniMax ne documente la planche d'un objet** ; elle prend la forme de celle des
  personnages qu'H3 reçoit déjà (Cal, 30/09 : « corps 3 vues », fond blanc de studio) — face, profil (gauche, sinon
  droite), dos, et un 3/4 avant s'il est gardé, côte à côte, sans texte, fond blanc. Vidéo envoie pour un objet **sa
  planche puis ses vues** (la face d'abord, quatre images au plus : la place des autres entrées), définies ainsi :
  « whose shape, materials and details are shown in <Picture 1> (front, side and back views on a white studio
  background), seen from several angles in <Picture 2>… » ; rétention `fully_preserved` de la forme, des matières,
  des couleurs, la planche et son fond « not reproduced ».
- **Les vues gardent leur fond** : une planche « fond blanc » par construction demande de détourer chaque vue
  (BiRefNet, câblé dans Image) avant de la poser : à brancher (D7).

## 4. La voie BLOCKING : un asset 3D posé → une vidéo H3

**Ce qu'H3 accepte** (`comfy_extras/nodes_minimax_h3.py` à 0.37.2) [lu] :

| entrée | nœud | ce qu'elle fait |
|---|---|---|
| première, dernière image | `MiniMaxH3ImageToVideo` (fl2va) | le plan part de l'une, finit sur l'autre |
| références | `MiniMaxH3ReferenceToVideo` (ref2va) | 9 images, 3 vidéos (2-15 s), 3 sons ; `<Picture n>`… |
| un guide ancré | `MiniMaxH3AddGuide` | une image, ou un extrait de 5, 22, 39… images, à n'importe quelle image du plan |
| **une vidéo de contrôle** | `MiniMaxH3FunControlNetApply` (un patch de modèle) | **canny, profondeur, HED, MLSD, pose** ; un masque (1 = à refaire) et la vidéo source : l'inpainting ; « works with both the fl2va and ref2va transformer files » ; CFG 1 ; la durée suit la vidéo de contrôle (17k+5 images, 24 i/s) [lu, docs] |

Le patch : `minimax_h3_fun_controlnet_union_pruned_int8_convrot.safetensors` (Comfy-Org/MiniMax-H3, `model_patches/`)
[lu, docs] ; ≈ 6,8 Go, ou ≈ 13,5 Go pour la version 2.0 à huit contrôles [extrait]. Licence : celle d'H3 (territoire,
`veille_1009.md` § 3.4 : UE, États-Unis, Royaume-Uni, Corée exclus).

**La chaîne proposée** :

1. **la scène** : un ou plusieurs GLB (l'objet d'Object Creator ; un personnage en mesh de Character Factory ; un
   décor) posés sur une scène — position, rotation, échelle ;
2. **la caméra** : un chemin (images clés, courbes : le motion d'Idéation sait déjà les écrire) ;
3. **les passes**, image par image, à 24 i/s, sur 124 à 362 images : **profondeur** (près = blanc : la convention de
   Render Mesh [lu] et des cartes de contrôle), normales, masque par objet, couleur grossière ;
4. **H3 ref2va + Fun ControlNet (profondeur)** avec les références : la planche de l'objet, le personnage (sa planche),
   le lieu ; le prompt dit l'action ; ou la passe de **pose** quand il y a un corps — une lecture communautaire dit que
   la pose tient mieux que la profondeur sous la tokenisation d'H3 [extrait, non mesuré].

**Le rendu des passes, image par image** : Render Mesh lance un rayon par pixel (un BVH en torch) — son temps pour
124 images n'est pas mesuré. **L'existant du portail fait mieux** : le rendu déterministe de Présentation · vidéo
(Chromium sans affichage, chaque image posée à son instant, ffmpeg) et la visionneuse three.js des GLB — une page de
rendu de scène qui pose la caméra à `t`, peint la profondeur (`MeshDepthMaterial`) ou les normales, et capture : la
même mécanique, des passes exactes et rapides. Recommandation : Chromium + three.js pour les séquences (un travail
`scene.passes`, voie cpu), Render Mesh pour les images fixes (fait).

**ComfyUI-MiniMaxH3-Studio** (Apache-2.0) : des prompts inspectables, cinq modes (texte, image d'ouverture, première et
dernière, image de fin, références), un plan de production, un éditeur [lu, README] — **rien sur la 3D ni la
profondeur** ; nous avons l'équivalent (Vidéo, Multishot, Montage). « Les trucs qui traînent pour H3 » sont dans
ComfyUI même : AddGuide et le Fun ControlNet.

## 5. La voie SCÈNE ou INTÉRIEUR

**Pourquoi une autre technique** : un objet se reconstruit de l'extérieur (TRELLIS.2, Pixal3D, TripoSplat sont
« object-centric ») ; « TripoSplat primarily generates objects; preserving the input background does not accurately
recover a complete room or a 360° environment » [lu, README d'AnyAngle Studio]. Une pièce se voit de dedans : il faut
des images **cohérentes d'un même espace**, puis une géométrie de scène.

**Trois chemins documentés** :

| | entrée | étapes | ce qui existe | ce qui manque chez nous |
|---|---|---|---|---|
| **A. Panorama** (« omnisplat »-like) | une image ou un texte | un panorama 360° → **MoGe panorama** (profondeur, mesh) → un chemin de caméra rendu dans ce mesh (vidéo de contrôle + masque des trous) → **WAN 2.1 i2v + LoRA panorama de Matrix-3D** comble les trous → **SphereSfM** (structure-from-motion sur panoramas) → COLMAP → un entraîneur de splats | **SplatKit** (mickmumpitz, MIT, 13/09/2026) [lu] ; son gabarit 0 fait le panorama (Krea 2 Turbo texte → panorama, ou Qwen-Image-Edit + un LoRA 360) ; `MoGePanoramaInference` natif | WAN 2.1 i2v et le LoRA de Matrix-3D (à télécharger) ; **SphereSfM n'a pas de binaire aarch64** (`linux-x64` seulement [lu] : à compiler pour GB10) ; un entraîneur |
| **B. Vues validées** | l'image | la boucle des vues (§ 3), autour d'un **point de vue** cette fois : des images de l'espace, validées → **Depth Anything 3 multi-vues** (poses et profondeur ensemble) → nuage de points → splats entraînés | DA3 natif (Small, Base : Apache-2.0 ; la tête « 3D Gaussian » seulement sur Giant, **CC BY-NC 4.0** [lu]) | un générateur de vues « dans » une pièce (non documenté : les LoRA d'angles tournent autour d'un sujet) ; un entraîneur |
| **C. Une vidéo qui tourne** | l'image | **H3 « Orbite 360° »** (déjà dans la liste de Vidéo) ou un travelling → ses images → DA3 ou COLMAP → splats | H3, DA3 natifs | un entraîneur ; la cohérence d'H3 sur 360° (non mesurée) |

**L'entraîneur de splats sur DGX Spark (GB10, aarch64)** : **gsplat** (nerfstudio, Apache-2.0) se compile au premier
usage, pas de roue aarch64 ; un retour d'expérience sur DGX Spark le compile avec `TORCH_CUDA_ARCH_LIST="12.0"` (GB10 =
sm_121, compatible sm_120) en ≈ 34 s [extrait] ; gsplat 1.6.0 empaqueté conda pour linux-aarch64 / CUDA 13 passe son
essai GPU sur un GB10 [extrait]. Brush, OpenSplat : non trouvés sur GB10. **Feed-forward** (sans entraînement) :
la tête de DA3-Giant (non commerciale), AnySplat (SIGGRAPH Asia 2025, licence non lue), HunyuanWorld-Mirror (licence
Tencent propre) [extrait]. **OmniSplat** (CVPR 2025) : deux panoramas → splats en une passe, ses rasteriseurs CUDA à
compiler [extrait].

**Valider l'espace** : la même boucle que les vues d'un objet — des images proposées, gardées ou refaites — puis, si la
personne le veut, le splat. **Une vidéo dedans** : le splat se rend le long d'un chemin (`RenderSplat` + une caméra par
image, natifs ; ou un visualiseur de splats dans la page, GaussianSplats3D, MIT) → la passe de profondeur → H3 Fun
ControlNet (§ 4), avec un lieu (élément `place`) en référence.

**Recommandation** : A (SplatKit) pour une pièce ou un décor à partir d'**une** image — c'est la chaîne complète la plus
documentée, dans ComfyUI, sous MIT ; ses deux manques sur GB10 (SphereSfM à compiler, gsplat à compiler) sont des
gestes d'installation, à faire avec Cal. B plus tard, quand un générateur de vues « de l'intérieur » existera.

## 6. L'architecture

- **Pages** : `objet/` (fait : la fiche refaite) ; une page **Scène** plus tard (`scene/` : l'espace, ses images
  validées, son splat, ses chemins de caméra) ; le **blocking** dans Vidéo (une scène et sa caméra → un plan contrôlé).
- **Éléments** : l'objet (`object`) porte ses références `view` (avec `az`, `el`), `sheet` (la planche), ses
  `meshes[]` (et leurs `rendus`), son plan (`vues`) et sa classe (`classe`) ; un lieu (`place`) porterait ses images
  validées, son panorama, son splat (`splats[]`, comme `meshes[]`).
- **Travaux** — faits : `objet.vue_factice`, `objet.vue` (voie image), `objet.rendus_factice`, `objet.rendus` (voie
  image), `objet.planche` (cpu), `objet.classer` (le modèle qui voit). À venir : `objet.multivues` (Pixal3D MV, D2),
  `objet.texture` (la projection des vues gardées), `scene.panorama`, `scene.dataset` (SplatKit), `scene.splat`
  (gsplat), `scene.passes` (Chromium + three.js), `movie.controle` (H3 Fun ControlNet).
- **Interrupteurs** (Admin → Câblage) — faits : `objet_vues` (`factice`, `qwen-edit-2511`, `qwen21-anyangle`),
  `objet_rendus` ; existant : `objet_trellis`. À venir : `objet_multivues`, `scene_splat`, `movie_controle`.

## 7. La feuille de route

1. **Fait** : le plan des vues, la boucle valider / affiner, les rendus, la planche, la classe (§ 11).
2. **L'essai de Cal** (§ 9) : fal 2511 sur la voiture, puis AnyAngle ; la face du GLB calée ; « left » vérifié.
3. **La planche « fond blanc » par construction** : chaque vue détourée (BiRefNet) avant d'être posée (D7).
4. **Le multi-vues** : Pixal3D MV (si D2) — un graphe, un travail ; sinon la projection de texture.
5. **Le blocking** : la page de rendu de scène (Chromium + three.js), les passes, `movie.controle` (après le patch, D6).
6. **La scène** : SplatKit et gsplat sur GB10 (D5), la page Scène, le splat comme partie d'un lieu.

## 8. Ce qui reste non documenté

L'angle exact d'une vue générée « en mots » (fal, akhaliq) ; la face du GLB de TRELLIS.2 par rapport à l'image ; la
licence d'AnyAngle ; le temps de Render Mesh et de RenderSplat sur GB10 ; la tenue d'H3 sous un contrôle de profondeur
sur 5 à 15 s ; la qualité de Qwen3-VL pour dire l'azimut d'un objet ; une projection de texture multi-vues native.

## 9. Le protocole d'essai pour Cal : une voiture en perspective → ses vues → son modèle

Sur le portail de la maison, avec ce que le lot a codé. Aucun téléchargement aux étapes 1 à 4.

1. **Câbler les vues sur ce qui est installé** : Admin → Câblage → « Object Creator · vues » = `qwen-edit-2511` ;
   « Object Creator · rendus » = vrai (`objet_rendus`) ; redémarrage (`tools/portail.sh restart`, ou la mise à jour).
2. **Object Creator → Nouvel objet** : l'image de la voiture, un nom. La fiche montre le plan. Dire d'où on la voit
   (3/4 avant gauche) — ou lire ce que propose le modèle qui voit, et noter s'il a raison.
3. **Générer** (quatre vues, ≈ le temps d'une édition Qwen 2511 chacune, sur la machine qui a le modèle). Juger chaque
   vue sur une grille simple : bon côté (la **gauche est-elle la gauche** de la voiture ? — « left à vérifier »), bonne
   hauteur, même échelle, détails gardés. Garder, refaire, rejeter. Noter : combien de vues justes sur quatre, au premier
   essai et après une reprise.
4. **Plus de vues** (les 3/4 et le dessus — le dessus n'est pas dans le vocabulaire de fal : la page le dit). **Tirer la
   3D** (TRELLIS.2). **Faire les rendus** : la vignette « face » montre-t-elle la face de l'image ? Sinon, « face du
   modèle » 90°, 180° ou 270°, et refaire — dire laquelle était juste (elle deviendra le défaut). **Faire la planche**,
   puis Vidéo → Références → l'objet en `@element1` : un plan Brouillon.
5. **AnyAngle (après accord, ≈ 120 Mo)** : vérifier d'abord le dossier, puis télécharger sur les deux DGX :
   ```sh
   ssh dgx2 'ls ~/ComfyUI/models/loras | head -3'
   ssh dgx2 'cd ~/ComfyUI/models/loras && hf download lilylilith/QI_2.1_AnyAngle QI2.1_AnyAngle.safetensors --local-dir .'
   ssh dgx1 'cd ~/ComfyUI/models/loras && hf download lilylilith/QI_2.1_AnyAngle QI2.1_AnyAngle.safetensors --local-dir .'
   ```
   (Le dossier est celui de `veille_1009.md` ; si `ls` ne le trouve pas, le chemin de ComfyUI de DGX2 est à relire.)
   Lire la licence sur la carte avant. Puis « Object Creator · vues » = `qwen21-anyangle`, et **refaire les mêmes vues
   sur le même objet** : la page garde les deux propositions côte à côte (‹ 1/2 ›). Le journal de ComfyUI ne doit dire
   aucune clé de LoRA non chargée (le piège du 28/09).
6. **Rendre** : les captures des deux séries de vues, le chiffre « justes sur quatre » de chaque générateur, la face
   du GLB, le temps d'une vue et des rendus (la fiche de chaque image les garde : `render_s`).

## 10. Ce que l'agent peut demander : les fiches de capacités

Au format du registre d'`agent_autonome.md` § 5.6, avec les champs de plus de `veille_1009.md` § 3.3 (`licence`
détaillée, `telechargements`, `memoire`). L'**état** (`branche`, `factice`, `installable`, `absent`) est calculé par le
code, jamais écrit ici. Deux intentions de plus proposées au vocabulaire : `objet3d.vues` (« fais-moi les vues de cet
objet », « une vue de dos ») et `scene3d.creer` (« fais-moi cette pièce en 3D »), et `video.blocking` (« un plan qui
suit ce chemin dans cette scène »), à trancher avec l'auteur du registre (D9). Ce que l'agent ne fait jamais : **garder
une vue à la place de la personne** (la validation est son geste : `consentement: "validation"`), changer un
interrupteur, télécharger un poids.

Les routes que l'agent appelle (au nom de la personne, dans son Workspace) : créer l'objet (`POST /api/objet/objects
{title, item}`), le plan (`GET /api/objet/{eid}/vues`), l'angle (`…/vues/source {az, el}`), ce qu'elle est
(`…/classe`, `…/classer`), générer (`…/vues/generer {slots?}`), plus de vues (`…/vues/plan {pass: 2}` ou `{az, el}`),
la 3D (`POST /api/jobs {kind: "objet.mesh"}`), les rendus (`…/rendus`), la planche (`…/planche`). Il lit ce qui part et
pourquoi pas : `go`, `pass_open`, `gen` de la réponse du plan.

```jsonc
{
  "id": "objet3d.creer.trellis2", "label": "Un objet 3D depuis une image · TRELLIS.2 (image unique)",
  "intentions": ["objet3d.creer"], "outil": "object", "travail": "objet.mesh", "route": "POST /api/objet/objects",
  "entrees": {"image": {"sorte": "image", "requis": true, "contraintes": {"un_seul_objet": true, "fond_simple": "conseillé"}},
              "nom": {"type": "texte", "requis": true, "question": {"texte": "Comment s'appelle-t-il ?"}}},
  "sortie": {"sorte": "element", "type": "object", "parties": ["meshes"]},
  "criteres": [{"si": "classe in [decor, interieur]", "exclut": true, "pourquoi": "une scène ne se reconstruit pas comme un objet (objet_scenes_3d.md § 5)"},
               {"si": "classe == personnage", "exclut": true, "pourquoi": "un personnage passe par Character Factory"}],
  "limites": ["une seule image lue ; les vues gardées attendent un multi-vues", "≈ 2 min 20 sur DGX2 (REPRISE § 3)"],
  "etat": {"exige": {"interrupteur": "objet_trellis=true", "comfy_modeles": ["trellis_2_int8_convrot.safetensors", "dino_v3_L_naf_fp32.safetensors", "birefnet.safetensors"],
                     "noeuds": ["Trellis2Conditioning", "Trellis2ShapeStage", "SaveGLB"]}},
  "cout": {"classe": "gpu", "famille": "trellis", "estimation": "durations.json"}, "memoire": {"famille": "trellis", "go": 40},
  "consentement": "rendu",
  "licence": {"nom": "MIT (TRELLIS.2) + DINOv3 License", "lue": true, "commercial": "selon DINOv3", "territoire": [], "source": "https://github.com/microsoft/TRELLIS.2"},
  "sources": ["https://github.com/microsoft/TRELLIS.2/blob/main/trellis2/pipelines/trellis2_image_to_3d.py"],
  "rempli_par": "objet_scenes_3d.md", "verifie": "2026-10-09"
}
```

```jsonc
{
  "id": "objet3d.vues.qwen_edit_2511", "label": "Les vues d'un objet · Qwen-Image-Edit 2511 + Multiple-Angles (fal)",
  "intentions": ["objet3d.vues"], "outil": "object", "travail": "objet.vue", "route": "POST /api/objet/{eid}/vues/generer",
  "entrees": {"objet": {"sorte": "element", "type": "object", "requis": true},
              "vues": {"type": "liste", "requis": false, "defaut_de": "le plan (prévues, en échec)",
                       "question": {"texte": "Quelles vues ?", "choix": ["les principales", "les 3/4 et le dessus", "une vue précise"]}}},
  "sortie": {"sorte": "image", "parents": ["objet", "la vue de départ"], "validation": "personne"},
  "criteres": [{"si": "vue_de_dessus", "exclut": true, "pourquoi": "hauteurs −30 à 60° seulement"},
               {"si": "modele_3d_absent", "poids": 1, "pourquoi": "il n'a pas besoin du modèle 3D"}],
  "limites": ["l'angle est dit en mots : la géométrie entre deux vues n'est pas garantie", "« left » à vérifier (REPRISE § 2.F)"],
  "etat": {"exige": {"interrupteur": "objet_vues=qwen-edit-2511",
                     "comfy_modeles": ["qwen_image_edit_2511_fp8mixed.safetensors", "qwen-image-edit-2511-multiple-angles-lora.safetensors",
                                       "Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors"]}},
  "cout": {"classe": "gpu", "famille": "qwenedit", "estimation": "durations.json"},
  "consentement": "rendu",
  "licence": {"nom": "Apache-2.0 (LoRA) ; Qwen-Image-Edit 2511 non relue", "lue": false, "commercial": null, "territoire": [],
              "source": "https://huggingface.co/fal/Qwen-Image-Edit-2511-Multiple-Angles-LoRA"},
  "rempli_par": "objet_scenes_3d.md", "verifie": "2026-10-09"
}
```

```jsonc
{
  "id": "objet3d.vues.anyangle", "label": "Les vues d'un objet · AnyAngle (depuis un rendu du modèle 3D)",
  "intentions": ["objet3d.vues"], "outil": "object", "travail": "objet.vue", "route": "POST /api/objet/{eid}/vues/generer",
  "entrees": {"objet": {"sorte": "element", "type": "object", "requis": true, "contraintes": {"un_modele_3d_reel": true}},
              "vues": {"type": "liste", "requis": false, "defaut_de": "le plan"}},
  "sortie": {"sorte": "image", "parents": ["objet", "la vue de départ"], "validation": "personne", "parties": ["guide"]},
  "criteres": [{"si": "modele_3d_reel", "poids": 2, "pourquoi": "l'angle vient du modèle : des vues cohérentes par construction"},
               {"si": "modele_3d_absent", "exclut": true, "pourquoi": "il part d'un rendu du modèle 3D"}],
  "limites": ["aussi juste que le modèle 3D", "20 pas : plus lent que le turbo ; turbo non documenté"],
  "etat": {"exige": {"interrupteur": "objet_vues=qwen21-anyangle", "comfy_modeles": ["QI2.1_AnyAngle.safetensors"],
                     "noeuds": ["Load3DAdvanced", "Get3DComponents", "RenderMesh", "CreateCameraInfo", "TextEncodeQwenImage21"]}},
  "cout": {"classe": "gpu", "famille": "qwen21"}, "consentement": "rendu",
  "licence": {"nom": "non écrite sur la carte (à lire)", "lue": false, "commercial": null, "territoire": [],
              "source": "https://huggingface.co/lilylilith/QI_2.1_AnyAngle"},
  "telechargements": [{"depot": "lilylilith/QI_2.1_AnyAngle", "fichier": "QI2.1_AnyAngle.safetensors", "dossier": "loras", "go": 0.12, "licence": "à lire"}],
  "sources": ["https://github.com/T8mars/Comfyui-Qwen-Image-2.1-MultiAngle-T8"],
  "rempli_par": "objet_scenes_3d.md", "verifie": "2026-10-09"
}
```

```jsonc
{
  "id": "objet3d.vues.qwen21_angles", "label": "Les vues d'un objet · Qwen-Image 2.1 Multiple-Angles (akhaliq)",
  "intentions": ["objet3d.vues"], "outil": "object", "travail": "objet.vue", "route": "POST /api/objet/{eid}/vues/generer",
  "entrees": {"objet": {"sorte": "element", "type": "object", "requis": true}},
  "sortie": {"sorte": "image", "validation": "personne"},
  "criteres": [{"si": "objet", "poids": 1, "pourquoi": "appris sur des objets (Objaverse)"}, {"si": "personnage", "poids": -1, "pourquoi": "« human-subject angles are untested »"}],
  "limites": ["12 azimuts de 30° (nos 3/4 à 45° tombent entre deux)", "générateur à câbler (un graphe de plus)"],
  "etat": {"exige": {"comfy_modeles": ["multiple_angles_step1000.safetensors"]}},
  "cout": {"classe": "gpu", "famille": "qwen21"}, "consentement": "rendu",
  "licence": {"nom": "Apache-2.0 (extrait, à lire)", "lue": false, "commercial": null, "territoire": [],
              "source": "https://huggingface.co/akhaliq/Qwen-Image-2.1-Multiple-Angles-LoRA"},
  "telechargements": [{"depot": "akhaliq/Qwen-Image-2.1-Multiple-Angles-LoRA", "fichier": "multiple_angles_step1000.safetensors (v1) ou la v2 conseillée", "dossier": "loras", "go": 0.16, "licence": "Apache-2.0 ?"}],
  "rempli_par": "objet_scenes_3d.md", "verifie": "2026-10-09"
}
```

```jsonc
{
  "id": "objet3d.classer.vlm", "label": "Ce que montre une image, et d'où · le modèle qui voit",
  "intentions": ["objet3d.creer", "media.analyser"], "outil": "object", "travail": "objet.classer", "route": "POST /api/objet/{eid}/classer",
  "entrees": {"objet": {"sorte": "element", "type": "object", "requis": true}},
  "sortie": {"type": "proposition", "champs": ["classe", "sujet", "azimut", "hauteur"]},
  "limites": ["une proposition : ce que la personne a dit n'est jamais remplacé", "la justesse de l'azimut n'est pas mesurée"],
  "etat": {"exige": {"ollama_modele_vision": true}},
  "cout": {"classe": "gpu", "famille": "ollama-agent"}, "memoire": {"famille": "ollama-agent", "go": 31}, "consentement": "aucun",
  "rempli_par": "objet_scenes_3d.md", "verifie": "2026-10-09"
}
```

```jsonc
{
  "id": "objet3d.rendus.rendermesh", "label": "Les rendus d'un modèle 3D · Render Mesh (natif)",
  "intentions": ["objet3d.creer"], "outil": "object", "travail": "objet.rendus", "route": "POST /api/objet/{eid}/rendus",
  "entrees": {"objet": {"sorte": "element", "type": "object", "requis": true, "contraintes": {"un_modele_3d": true}}},
  "sortie": {"sorte": "fichiers", "partie_de": "meshes[].rendus", "nombre": 9},
  "limites": ["la face du GLB de TRELLIS.2 se cale à la main (non documentée)", "temps non mesuré"],
  "etat": {"exige": {"interrupteur": "objet_rendus=true", "noeuds": ["Load3DAdvanced", "Get3DComponents", "RenderMesh", "CreateCameraInfo"], "comfyui_min": "0.37.2"}},
  "cout": {"classe": "gpu", "famille": null}, "consentement": "rendu",
  "licence": {"nom": "GPL-3.0 (ComfyUI)", "lue": true, "commercial": "oui", "territoire": []},
  "rempli_par": "objet_scenes_3d.md", "verifie": "2026-10-09"
}
```

```jsonc
{
  "id": "objet3d.planche.h3", "label": "La planche d'un objet pour H3 (face, profil, dos)",
  "intentions": ["objet3d.creer", "video.creer"], "outil": "object", "travail": "objet.planche", "route": "POST /api/objet/{eid}/planche",
  "entrees": {"objet": {"sorte": "element", "type": "object", "requis": true, "contraintes": {"vues_gardees": "la face et un profil ou le dos"}}},
  "sortie": {"sorte": "image", "partie_de": "element.refs (rôle sheet)"},
  "limites": ["la forme de la planche des personnages : aucun guide MiniMax pour un objet", "les vues gardent leur fond tant qu'elles ne sont pas détourées"],
  "etat": {"exige": {}}, "cout": {"classe": "cpu"}, "consentement": "aucun",
  "rempli_par": "objet_scenes_3d.md", "verifie": "2026-10-09"
}
```

```jsonc
{
  "id": "objet3d.multivues.pixal3d", "label": "Un objet 3D depuis ses quatre vues · Pixal3D Multi-View (natif)",
  "intentions": ["objet3d.creer"], "outil": "object", "travail": "objet.multivues", "route": null,
  "entrees": {"objet": {"sorte": "element", "type": "object", "requis": true,
                        "contraintes": {"vues_gardees": ["face 0°", "gauche 90°", "dos 180°", "droite 270°"], "hauteur": 0, "meme_echelle": true}}},
  "sortie": {"sorte": "element", "parties": ["meshes"]},
  "criteres": [{"si": "quatre_vues_gardees", "poids": 2, "pourquoi": "il consomme exactement les vues principales"},
               {"si": "decision_cal_pixal3d", "exclut": true, "pourquoi": "« pas de Pixal3D » (28/09) : D2"}],
  "etat": {"exige": {"comfy_modeles": ["pixal3d_multiview_int8_convrot.safetensors", "trellis_2_shape_vae_bf16.safetensors", "trellis_2_texture_vae_bf16.safetensors", "dino_v3_L_naf_fp32.safetensors"],
                     "noeuds": ["Pixal3DMultiViewConditioning"], "comfyui_min": "0.37.2"}},
  "cout": {"classe": "gpu", "famille": "trellis"}, "consentement": "rendu",
  "licence": {"nom": "MIT (code et poids) + DINOv3", "lue": false, "commercial": "selon DINOv3", "territoire": [], "source": "https://huggingface.co/Comfy-Org/Pixal3D"},
  "telechargements": [{"depot": "Comfy-Org/Pixal3D", "fichier": "diffusion_models/pixal3d_multiview_int8_convrot.safetensors", "dossier": "diffusion_models", "go": null, "licence": "MIT"}],
  "rempli_par": "objet_scenes_3d.md", "verifie": "2026-10-09"
}
```

```jsonc
{
  "id": "scene3d.dataset.splatkit", "label": "Une pièce ou un décor en gaussian splatting · SplatKit (panorama → jeu de données)",
  "intentions": ["scene3d.creer"], "outil": "scene", "travail": "scene.dataset", "route": null,
  "entrees": {"panorama": {"sorte": "image", "requis": true, "contraintes": {"equirectangulaire": "2:1"}, "prepare_par": "scene3d.panorama"},
              "chemin": {"type": "camera", "requis": true}, "decrire": {"type": "texte", "requis": true, "question": {"texte": "Que voit-on dans ce lieu ?"}}},
  "sortie": {"sorte": "dossier", "contenu": "COLMAP (images/, sparse/0, nuage initial)"},
  "limites": ["SphereSfM : binaire linux-x64 seulement (à compiler pour GB10)", "le prompt doit décrire la scène vraie"],
  "etat": {"exige": {"noeuds": ["SplatKit"], "comfy_modeles": ["Wan2.1 i2v", "pano_video_gen_720p_comfy.safetensors (Matrix-3D)"]}},
  "cout": {"classe": "gpu", "famille": "wan"}, "consentement": "telechargement",
  "licence": {"nom": "MIT (SplatKit) ; Wan 2.1 et Matrix-3D non lues", "lue": false, "territoire": [], "source": "https://github.com/mickmumpitz/ComfyUI-SplatKit"},
  "rempli_par": "objet_scenes_3d.md", "verifie": "2026-10-09"
}
```

```jsonc
{
  "id": "scene3d.splat.gsplat", "label": "Entraîner un gaussian splatting · gsplat (sur GB10)",
  "intentions": ["scene3d.creer"], "outil": "scene", "travail": "scene.splat", "route": null,
  "entrees": {"dataset": {"sorte": "dossier", "requis": true, "contraintes": {"colmap": true}}},
  "sortie": {"sorte": "splat", "formats": ["ply", "spz"]},
  "limites": ["à compiler au premier usage (TORCH_CUDA_ARCH_LIST=12.0) [extrait]", "temps d'entraînement non mesuré"],
  "etat": {"exige": {"paquet": "gsplat"}}, "cout": {"classe": "gpu", "famille": "gsplat"}, "consentement": "telechargement",
  "licence": {"nom": "Apache-2.0", "lue": false, "territoire": [], "source": "https://github.com/nerfstudio-project/gsplat"},
  "rempli_par": "objet_scenes_3d.md", "verifie": "2026-10-09"
}
```

```jsonc
{
  "id": "video.blocking.h3_controle", "label": "Un plan H3 qui suit une scène 3D · H3 Fun ControlNet Union (profondeur, pose)",
  "intentions": ["video.blocking", "video.creer"], "outil": "movie", "travail": "movie.controle", "route": null,
  "entrees": {"passes": {"sorte": "video", "requis": true, "contraintes": {"fps": 24, "images": "17k+5", "duree_s": [5, 15]}, "prepare_par": "scene.passes"},
              "references": {"sorte": ["element", "image"], "requis": false}, "action": {"type": "texte", "requis": true}},
  "sortie": {"sorte": "video", "parents": ["passes", "references"]},
  "criteres": [{"si": "commercial_ue", "exclut": true, "pourquoi": "la licence d'H3 exclut l'UE"},
               {"si": "un_corps_a_l_image", "poids": 1, "pourquoi": "la pose tient mieux que la profondeur [extrait]"}],
  "etat": {"exige": {"interrupteur": "movie_engine=h3", "comfy_modeles": ["minimax_h3_fun_controlnet_union_pruned_int8_convrot.safetensors"], "noeuds": ["MiniMaxH3FunControlNetApply"]}},
  "cout": {"classe": "gpu", "famille": "h3"}, "consentement": "rendu",
  "licence": {"nom": "MiniMax H3 Community License", "lue": false, "territoire": ["UE", "US", "UK", "KR"], "source": "https://huggingface.co/alibaba-pai/MiniMax-H3-Fun-Controlnet-Union"},
  "telechargements": [{"depot": "Comfy-Org/MiniMax-H3", "fichier": "model_patches/minimax_h3_fun_controlnet_union_pruned_int8_convrot.safetensors", "dossier": "model_patches", "go": 6.8, "licence": "MiniMax H3"}],
  "rempli_par": "objet_scenes_3d.md", "verifie": "2026-10-09"
}
```

## 10 bis. Décisions pour Cal

- **D1 — le générateur des vues du premier essai** : `qwen-edit-2511` (installé) puis AnyAngle (120 Mo, après lecture de
  sa licence). Recommandation : oui aux deux, dans cet ordre (§ 9).
- **D2 — Pixal3D pour le multi-vues seulement** : la décision du 28/09 (« pas de Pixal3D ») tient-elle aussi pour son
  conditionnement multi-vues natif ? Recommandation : un essai sur la voiture une fois ses quatre vues gardées (un
  fichier de plus, le reste est déjà sur les DGX). Les raisons du 28/09 ne sont pas lisibles d'ici
  (`Character_Factory/docs/BRIEF_CAL_2026-09-28.md`).
- **D3 — la planche d'un objet** : face, profil, dos, un 3/4, fond blanc, sans texte (la forme de celle des
  personnages). Recommandation : oui, jusqu'à un guide MiniMax qui dise mieux.
- **D4 — classer à l'arrivée** : le modèle qui voit (31 Go) pour chaque objet neuf, la préférence « oui » par défaut.
  Recommandation : oui (la classe et l'angle font le plan) ; « non » si la mémoire des DGX est disputée.
- **D5 — la voie scène** : SplatKit (panorama) d'abord, gsplat et SphereSfM compilés pour GB10 — un chantier
  d'installation sur DGX2 avec Cal.
- **D6 — le blocking** : télécharger le patch H3 Fun ControlNet Union (≈ 6,8 Go ; la 2.0, ≈ 13,5 Go, huit contrôles)
  et écrire la page de rendu de scène (Chromium + three.js). Rappel : la licence d'H3 exclut l'UE.
- **D7 — détourer les vues avant la planche** (BiRefNet) : une planche fond blanc par construction. Recommandation : oui.
- **D8 — la face du GLB de TRELLIS.2** : la caler au premier rendu, puis en faire le défaut.
- **D9 — le registre** : trois intentions de plus (`objet3d.vues`, `scene3d.creer`, `video.blocking`).

## 11. Fait le 09/10

**Le parcours « propose les vues, on valide, on affine »**, sans GPU, prêt à brancher (branche `wip3/objet-3d`).

- **Serveur** — `server/tools/objet_vues.py` (neuf) : le plan dans l'élément (`element.vues` : l'image choisie, les
  passes, une place par vue, la face du modèle), **déduit à chaque lecture** de l'élément et de la file (`normalize` :
  une vue n'est gardée que si sa référence est dans l'élément ; l'état d'un travail se lit dans la file) ; la classe
  (`element.classe`). Routes : `GET /api/objet/{eid}/vues`, `POST …/vues/source {az, el, file?}`, `…/vues/plan {pass: 2}
  | {az, el}`, `…/vues/generer {slots?, seed?}`, `…/vues/{sid} {action: garder | poser | rejeter | rouvrir | retirer,
  item?}`, `…/classe {value}`, `…/classer`, `…/face {face}`, `…/rendus`, `…/planche`. Travaux : `objet.vue_factice`
  (cpu : une mire qui dit l'angle, la vue de départ, le générateur, la graine, et la boussole), `objet.vue` (voie image :
  Qwen-Edit 2511 par le graphe d'Image, `image._real_edit` ; AnyAngle par un graphe écrit ici, jugé contre
  `/object_info` avant l'envoi), `objet.rendus_factice` (la boîte du mesh projetée par la même caméra), `objet.rendus`
  (Render Mesh), `objet.planche` (PIL), `objet.classer` (le modèle qui voit, `ideation_agent.Moteur`, sortie
  structurée). Interrupteurs : `objet_vues`, `objet_rendus`.
- `server/tools/objet.py` : `/api/objet/state` dit aussi la chaîne des vues (`vues` : générateur, angles, passes,
  classes, le modèle qui voit) ; le mesh retient combien de vues gardées attendaient un multi-vues (`views_kept`) ;
  `validate` admet les entrées dynamiques (`images.image_1`, `mode.position_x`) et le GLB déposé.
- `server/core/comfy.py` : `upload(…, subfolder=)` — un GLB va dans `input/3d`, là où Load 3D le liste.
- `server/tools/movie.py` + `movie/movie.js` : un objet envoie à H3 sa planche puis ses vues (`object_parts`, quatre au
  plus), défini par sa forme et ses matières, sa planche « not reproduced » ; le même compte côté page.
- **Page** — `objet/objet.js`, `objet.css`, `prefs.json` : la fiche refaite (l'image, ce qu'elle est, d'où on la voit,
  sa description | les vues en cartes par passe | la 3D, ses rendus, sa planche) ; un seul orange, celui de la prochaine
  étape ; les gestes et leur contraire (Ctrl+Z) ; une image déposée sur une place la remplit ; la préférence « Demander
  au modèle qui voit à l'arrivée d'une image ».
- **Contrôles** : `objet_vues.selftest` (50 contrôles avec ceux d'objet : le plan à l'arrivée, l'angle, les classes qui
  ferment les vues, quatre vues factices, garder / rejeter / rouvrir / refaire / poser, l'affinage depuis la vue la plus
  proche, les limites des générateurs, la voie image, les bornes du GLB et la caméra, les rendus, le graphe Render Mesh
  jugé, la planche, le plan H3 d'un objet, le modèle qui voit contre le faux Ollama) ; `objet/pilote_vues.mjs` (le
  parcours entier dans Chromium, un seul orange à chaque étape, aucun « null », sombre, clair, téléphone).
- **Pas fait** : aucun générateur réel essayé (pas de GPU) ; la planche ne détoure pas ses vues (D7) ; le multi-vues
  (D2) ; la voie scène et le blocking (§ 4, § 5 : étude seulement).

## Sources

- ComfyUI v0.37.2 [lu] : `comfy_extras/nodes_trellis2.py` (`Pixal3DMultiViewConditioning`, `_VIEW_AZIMUTHS`,
  `_VIEW_PAD`), `nodes_mesh_postprocess.py` (`RenderMesh`), `nodes_gaussian_splat.py` (`CreateCameraInfo`,
  `RenderSplat`), `nodes_load_3d.py` (`Load3DAdvanced`, `input/3d`), `nodes_mesh_io.py` (`Get3DComponents`),
  `nodes_minimax_h3.py` (`MiniMaxH3AddGuide`, `MiniMaxH3FunControlNetApply`), `nodes_triposplat.py`,
  `nodes_depth_anything_3.py`, `nodes_moge.py`, `server.py` (`/upload/image`, `subfolder`), `comfy_api/latest/_io.py`
  (`finalize_prefix`).
- Comfy-Org/docs [lu] : `tutorials/video/minimax/minimax-h3-fun-controlnet.mdx`, `tutorials/3d/triposplat.mdx`,
  `pixal3d.mdx`, `trellis2.mdx`, `hunyuan3D-2.mdx`, `tutorials/utility/depth-anything-3.mdx`, `moge.mdx`.
- [microsoft/TRELLIS.2](https://github.com/microsoft/TRELLIS.2) [lu] : `trellis2_image_to_3d.py` (`run`),
  `trellis2_texturing.py`, README.
- [visualbruno/ComfyUI-Trellis2](https://github.com/visualbruno/ComfyUI-Trellis2) [lu] : README, `nodes.py`,
  `trellis2/pipelines/samplers/flow_euler.py`, `example_workflows/Projection_NvDiffrast_Qwen_XViews.json` ;
  [cuzelac/ComfyUI-Trellis2-MultiViewRefiner](https://github.com/cuzelac/ComfyUI-Trellis2-MultiViewRefiner) [lu].
- [Bingeljell/image-to-3dlab](https://github.com/Bingeljell/image-to-3dlab) [lu] : README (moteurs, licences, Pixel
  Match, planches d'accessoires).
- [T8mars/Comfyui-Qwen-Image-2.1-MultiAngle-T8](https://github.com/T8mars/Comfyui-Qwen-Image-2.1-MultiAngle-T8) [lu] :
  README_EN, THIRD_PARTY, `workflows/AnyAngle-Studio-Qwen21-API.json`, `…-ViggleTurbo6-API.json`.
- [lilylilith/QI_2.1_AnyAngle](https://huggingface.co/lilylilith/QI_2.1_AnyAngle) [extrait] ;
  [akhaliq/Qwen-Image-2.1-Multiple-Angles-LoRA](https://huggingface.co/akhaliq/Qwen-Image-2.1-Multiple-Angles-LoRA)
  [extrait] ; [l'article ArtRealm](https://artrealmai.com/article/qwen-image-2-1-multiple-angles-camera-lora) [extrait] ;
  [diffusers #14937](https://github.com/huggingface/diffusers/issues/14937) [extrait] ;
  [fal/Qwen-Image-Edit-2511-Multiple-Angles-LoRA](https://huggingface.co/fal/Qwen-Image-Edit-2511-Multiple-Angles-LoRA) (`image.md`).
- [rookiestar28/ComfyUI-MiniMaxH3-Studio](https://github.com/rookiestar28/ComfyUI-MiniMaxH3-Studio) [lu] : README.
- [alibaba-pai/MiniMax-H3-Fun-Controlnet-Union](https://huggingface.co/alibaba-pai/MiniMax-H3-Fun-Controlnet-Union)
  [extrait] ; [ComfyUI-H3-FunControl](https://github.com/wyzborrero/ComfyUI-H3-FunControl) [extrait].
- [mickmumpitz/ComfyUI-SplatKit](https://github.com/mickmumpitz/ComfyUI-SplatKit) [lu] : README,
  `core/spheresfm_colmap.py` (`_BUNDLES`).
- [ByteDance-Seed/Depth-Anything-3](https://github.com/ByteDance-Seed/Depth-Anything-3) [lu] : README (variantes,
  licences, tête gaussienne).
- [esw0116/OmniSplat](https://github.com/esw0116/OmniSplat) (CVPR 2025) [extrait] ;
  [TripoSplat, comparaison](https://radiancefields.com/single-image-gaussian-splatting-in-2026-—-triposplat-vs-sharp-vs-trellis)
  [extrait] ; [gsplat sur DGX Spark](https://dev.classmethod.jp/en/articles/dgx-spark-3dgs-digital-twin/) [extrait] ;
  [rerun-io/examples-monorepo #278](https://github.com/rerun-io/examples-monorepo/pull/278) [extrait] ;
  [AnySplat](https://gittrend.io/repo/InternRobotics/AnySplat), [HunyuanWorld-Mirror](https://huggingface.co/tencent/HunyuanWorld-Mirror)
  [extrait].
- Le portail [lu] : `server/tools/objet.py`, `image.py`, `movie.py`, `ideation_agent.py`, `presentation_video.py`,
  `character/js/schema.js`, `docs/etudes/image.md`, `movie.md`, `agent_autonome.md` § 5.6, `veille_1009.md` § 3,
  REPRISE § 2.F et § 3.
