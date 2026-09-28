# Étude — l'outil Image (28/09/2026)

Cal, 28/09 au soir : « un générateur d'image avec comme choix : imagez, qwen 2.1 et krea2 … on
doit pouvoir éditer les images aussi depuis une image créée, avec des prompts mais aussi tout ce
qui permet de faire de la super édition d'image … des fonctions comme higgsfield avec des
caméras, focales, pellicules car on veut vraiment faire des trucs photoréalistes ». Puis, le même
soir : « on se concentre sur l'UX et l'UI … ne lance pas de test de vidéo ou image, on câblera
après ».

**Statut** : étude sur documentation seulement, **aucun rendu fait**. L'outil tourne en moteur
factice (`image_backend: "stub"`, le défaut) ; le câblage réel est écrit et validé à blanc contre
le catalogue de nœuds des deux ComfyUI (§7), pas essayé. Ce qui reste à faire au câblage : §8.

Code : `image/` (page), `server/tools/image.py` (routes, travaux, graphes, pastilles, moteur
factice, contrôle), `server/workflows/image_zimage_*.json` (les deux graphes propres au
portail). Les graphes Krea 2, Qwen-Image 2.1, BiRefNet, SeedVR2 et Qwen-Edit 2511 sont importés
de Character Factory (`cf_repo`), jamais recopiés.

## 1. Higgsfield : ce que font ses outils image

Relevé sur les pages officielles (sites tiers signalés comme tels).

- **Cinema Studio 3.5** ([référence des réglages](https://higgsfield.ai/blog/ai-video-camera-control),
  07/09/2026, présentée pour la vidéo) : 3 « boîtiers » (Raw 16mm, Fine Film, Clean Digital),
  5 objectifs (Clinical Sharp, Extreme Macro, Anamorphic, Warm Halation, Vintage Haze), focales
  8/14/35/50/75 mm, ouvertures f/1.4 · f/4 · f/11, 6 lumières (Soft Cross, Overhead Fall,
  Contre-jour, Window, Practicals, Silhouette), 9 palettes.
- **Cinema Studio 2.0** ([guide](https://higgsfield.ai/blog/cinema-studio-guide)) : focales 8 à
  50 mm, profil de capteur, objectif, ouverture ; grilles 2×2 à 4×4.
- Au lancement (fin 2025), des marques réelles (ARRI Alexa 35, Sony Venice, RED V-Raptor, IMAX,
  Arriflex 16SR, Panavision DXL2 ; Cooke S4, Canon K-35, Petzval, Laowa…), renommées en février
  2026 en noms génériques (« Studio Digital S35 », « Swirl Bokeh Portrait »… — correspondance
  relevée par un tiers, [Flesh Syntax](https://www.fleshsyntax.com/new-cinema-studio-camera-and-lens-names-compared-to-old-camera-and-lens-names/)).
- **Comment ça marche** ([Inside Higgsfield #1](https://higgsfield.ai/blog/how-we-built-cinema-studio)) :
  les réglages passent **par le prompt**, pas par un entraînement dédié. Les prompts exacts ne
  sont pas publiés. C'est ce qui rend l'outil reproductible avec nos modèles.
- **Soul** ([page](https://higgsfield.ai/soul), [aide](https://higgsfield.ai/creator-hub/help-center/ai-models/how-do-i-use-soul-to-generate-images)) :
  50+ préréglages (iPhone, 2000s Cam, 90s Grain, Digital Camera, Fisheye…), formats 9:16 à 16:9,
  1,5k ou 2k, **1 à 4 images par lot**. **Soul ID** : un personnage appris sur 20 à 80 photos —
  chez nous, c'est l'élément « personnage » importé de Character Factory, sans entraînement.
- **Relight** ([billet](https://higgsfield.ai/blog/Relight-Director-Style-Cinematic-Lighting)) :
  direction (6 positions), doux/dur, intensité, couleur. **Inpaint** ([page](https://higgsfield.ai/image-editing)) :
  Nano Banana (Google), édition précise, retrait d'objet. **Upscale** ([page](https://higgsfield.ai/ai-image-upscaler)) :
  ×2 à ×16. Ni pellicule ni « film stock » dans Cinema Studio : non documenté.

Repris dans l'outil : les pastilles caméra / objectif / ouverture / lumière, la pellicule en plus
(demandée par Cal), 1 à 4 images par lot, les formats, le rééclairage par consigne, l'agrandissement,
la zone à retoucher.

## 2. Les dépôts qui reproduisent Higgsfield

| dépôt | licence | ce qu'on en tire |
|---|---|---|
| [underworldhistory1-ctrl/minimax-h3-higgsfield](https://github.com/underworldhistory1-ctrl/minimax-h3-higgsfield) (Charles Mod, donné par Cal ; lu sur DGX2 dans `/tmp/h3hf`) | MIT | l'espace image Qwen-Image 2.1 (`web/image.html`, `docs/UX_FLOW.md` « Image workspace », `docs/superpowers/specs/2026-09-28-qwen-image-studio-design.md`) : Créer / Éditer séparés ; l'édition = une image « canevas » + jusqu'à 9 références **ordonnées** ; la taille du canevas gardée sauf choix contraire ; un profil non installé **visible mais désactivé, avec la raison** ; le fond transparent RGBA natif ; le temps mesuré dans la fiche ; supprimer une image. **Repris en idées** (aucun code copié) : l'ordre des références (bouton ↑), l'option « fond transparent » de Qwen, la corbeille, les capacités absentes montrées avec leur raison. |
| [Anil-matcha/Open-Generative-AI](https://github.com/Anil-matcha/Open-Generative-AI) (ex « Open-Higgsfield-AI », ~29k ★) | MIT | `CinemaStudio.jsx` : chaque nom générique de Higgsfield → une phrase (`CAMERA_MAP`, `LENS_MAP`, `FOCAL_PERSPECTIVE`, `APERTURE_EFFECT`) et le gabarit `{prompt}, shot on a {camera}, using a {lens} at {focal}mm ({perspective}), aperture {f}, {effet}`. Passe par l'API payante Muapi — on ne reprend que le vocabulaire. |
| [NickPittas/DirectorsConsole](https://github.com/NickPittas/DirectorsConsole) | MIT | 49 caméras, 31 pellicules, règles d'époque (**pas de pellicule sur un boîtier numérique**), gabarits « shot on {manufacturer} {body} », « using {stock} film stock » ; des notes par modèle (`krea_2.md`, `qwen_image.md`, `z-image_turbo.md`) : décrire la qualité de la lumière, pas le projecteur. |
| [ComfyAssets/kiko-flux2-prompt-builder](https://github.com/ComfyAssets/kiko-flux2-prompt-builder) | MIT | plages focale 14–400 mm, f/1.2–f/16 (prompt JSON pour FLUX.2 / Z-Image). |
| [yedp123/ComfyUI-Cinematic-Prompt](https://github.com/yedp123/ComfyUI-Cinematic-Prompt) | MIT | constructeur visuel avec aperçus (listes non lues : dans `web/`). |
| [florestefano1975/comfyui-portrait-master](https://github.com/florestefano1975/comfyui-portrait-master) | **GPL-3.0** | 70 lumières de portrait ; inspiration seulement (GPL). |
| [twri/sdxl_prompt_styler](https://github.com/twri/sdxl_prompt_styler) | MIT | styles à mots-clés + négatifs SDXL : ne convient pas à nos modèles sans négatif. |

## 3. Les trois modèles : ce que dit leur documentation

**Z-Image Turbo** (Tongyi-MAI, Apache-2.0 ; [carte](https://huggingface.co/Tongyi-MAI/Z-Image-Turbo),
[GitHub](https://github.com/Tongyi-MAI/Z-Image), [ComfyUI](https://docs.comfy.org/tutorials/image/z-image/z-image-turbo)).
Anglais ou chinois ; « works best with long and detailed prompts »
([discussion #8](https://huggingface.co/Tongyi-MAI/Z-Image-Turbo/discussions/8)) ; aucun vocabulaire
photo officiel. 8 pas, CFG 0/1, pas de négatif ; gabarit ComfyUI : `ModelSamplingAuraFlow` 3,
`res_multistep`, `simple`. Tailles : les paliers exacts du Space officiel (1024, 1280, 1536 ;
[app.py](https://huggingface.co/spaces/Tongyi-MAI/Z-Image-Turbo/blob/main/app.py)). **N'édite
pas** : Z-Image-Edit et Omni sont « To be released » ; seul le ControlNet Union d'alibaba-pai
(pose, profondeur, canny, inpaint en 2.1) existe, non installé. Base (`z_image_bf16`, DGX1
seulement) : 28–50 pas, CFG 3–5, négatif recommandé (gabarit ComfyUI : 25 pas, CFG 4).

**Qwen-Image 2.1** (Qwen Research License, **non commerciale** ; [GitHub](https://github.com/QwenLM/Qwen-Image-2.1),
[ComfyUI](https://docs.comfy.org/tutorials/image/qwen/qwen-image-2-1)). Pas de guide de prompt ;
les réécrivains officiels (PE-T2I, PE-I2I) produisent de l'anglais détaillé. Génère et **édite**
dans un seul modèle : jusqu'à 10 références (`<image1>`…), éditions locales « via circles, painted
annotations, or separate masks », retrait, RGBA natif (gabarit : « This is an RGBA format image
with transparency. … The image has an alpha channel and a transparent background. »). En édition,
la sortie prend la taille de la première image (« canvas comes from the encode latent »). Tailles
natives 2K du README (2048², 2400×1792, 2528×1696, 2752×1536 et portraits ; pas de 21:9). Chez
nous, le turbo Viggle de Character Factory (6 pas, 1 à 3 références, édition apprise en 1024² et
1536², [carte](https://huggingface.co/Viggle/Qwen-Image-2.1-viggle-turbo)).

**Krea 2 Turbo** (Krea 2 Community License ; [prompting.md](https://github.com/krea-ai/krea-2/blob/main/docs/prompting.md),
[ComfyUI](https://docs.comfy.org/tutorials/image/krea/krea-2)). « use natural language prompts »,
« Long detailed prompts yield best results » ; ses 20 exemples emploient « shallow depth of
field », « high-key lighting », « soft diffused natural lighting », « film grain », « macro lens »
— **aucune marque, aucune focale en mm, aucune pellicule**. 1k à 2k, multiples de 16 ; 8 pas,
CFG 1. N'édite que par des LoRA : **Identity Edit** ([conradlocke](https://huggingface.co/conradlocke/krea2-identity-edit),
nœuds [comfyui-krea2edit](https://github.com/lbouaraba/comfyui-krea2edit)) — remise en scène d'une
personne, recolorer/ajouter/remplacer, deux entrées (scène puis sujet), ≤ 2 Mpx ; **les retraits
veulent Krea Raw, CFG 3, ~20 pas** (non installé) ; changements de tenue « hit-or-miss ».

## 4. Les pastilles de prise de vue : comment elles s'écrivent

Cinq groupes, 44 pastilles, dans `server/tools/image.py` (`LOOKS`), chacune avec sa source
(champ `src`, visible au survol dans la page). Règle d'écriture, tirée du §3 :

- **Z-Image et Qwen 2.1** reçoivent `prose` : le matériel nommé puis ce qu'il fait voir — les
  gabarits BFL (« Shot on Hasselblad X2D… », « shot on Kodak Portra 400, natural grain, organic
  colors »), fal pour Z-Image (« Shot on a Leica M6 … »), Open-Generative-AI pour focales et
  ouvertures (« 35mm … natural cinematic perspective », « f/1.4, shallow depth of field, creamy bokeh »).
- **Krea 2** reçoit `krea` : ce qu'on voit, **sans marque** (ses exemples officiels n'en ont
  aucune ; fal et aireiter : « décrire le format et ses défauts visibles »).
- **La lumière** se décrit par sa source, sa direction et sa retombée, pas par le projecteur
  (DirectorsConsole) — c'est aussi le banc Krea de Character Factory du 28/09 (`PHOTO_LIGHT`,
  la pastille « Studio doux »). En édition, chaque lumière a sa consigne « Relight the scene… ».
- Une pellicule sur un boîtier numérique : la page le signale (note), sans bloquer.
- « à nous » dans `src` : pas de phrase publiée (Gold 200, Velvia, CineStill, HP5, 135 mm,
  Smartphone, Heure bleue, Lampes du décor), formulée d'après les descripteurs des sources ; à
  juger au câblage.

Le prompt réellement envoyé est composé par le serveur (`POST /api/image/compose`) et montré dans
la page avant l'envoi ; chaque image garde le sien. Tout en anglais : les trois modèles sont
documentés en anglais (et chinois pour Qwen et Z-Image).

## 5. Tailles et réglages retenus

| modèle | tailles | pas · CFG | références |
|---|---|---|---|
| Z-Image Turbo | paliers 1024 / 1280 / 1536 du Space (ex. 16:9 → 1280×720) | 8 · 1, res_multistep, décalage 3 (gabarit) | aucune (dit dans la page, pas de bouton mort) |
| Z-Image base | idem ; DGX1 seulement (le travail y est épinglé) | 25 · 4 (gabarit) | aucune |
| Qwen-Image 2.1 | 1 Mpx au pas de 32 (gabarit) ; 2K natif (README) | turbo Viggle 6 · 1 (Character Factory) | 3, `<image1>`… ; option fond transparent |
| Krea 2 | 1 ou 2 Mpx au pas de 16 | 8 · 1 ; beta + UltraReal 0,7 sans référence (banc CF du 28/09) | 1 ou 2 (Identity Edit v1.2, scène puis sujet) |

Une référence que le prompt Qwen ne nomme pas est présentée en une phrase (« <image2> shows the
face of MJ Survêt. ») et la page le signale. Un élément de la bibliothèque (un personnage importé
de Character Factory) envoie l'image qu'on choisit parmi les siennes (visage, plein pied, expression…).

## 6. L'édition : ce qui est faisable avec ce qui est installé

| outil | modèle | graphe | source | état |
|---|---|---|---|---|
| Consigne | Qwen 2.1 turbo | `qwen21.workflow` (CF), latent de l'encodeur (taille de la source) | gabarit officiel `image_qwen_image_2_1_image_edit`, infobulle du nœud | câblé, validé à blanc |
| Consigne | Krea 2 + Identity Edit v1.2 | `krea2.workflow(edit="node")` (CF) | README comfyui-krea2edit ; banc CF du 28/09 | câblé ; DGX2 seulement (§7) |
| Zone peinte | les deux | la boîte autour de la zone, éditée à ≥ 768 px, recollée par le masque adouci — rien ne change hors zone, par construction | méthode du report de visage de CF (`krea2.face_pass`, banc 28/09) ; Qwen annonce aussi des masques séparés (README), mode d'emploi non publié | câblé, pas essayé |
| Références | les deux | `<image2>`, `<image3>` (Qwen) ; scène + sujet (Krea) | idem | câblé |
| Rééclairer | les deux | pastilles de lumière en consigne | §4 | câblé |
| Détourer | BiRefNet | `comfy.matte_workflow` (CF), alpha posé en PIL, polarité lue sur le pourtour | CF, gabarit `utility_birefnet_remove_background` | câblé |
| Agrandir ×2/×4 | SeedVR2 7B INT8 | `upscale.seedvr2_workflow` (CF) après Lanczos | gabarit `utility_seedvr2_7b_int8_upscale_image` | câblé |
| Affiner ×2 | Z-Image Turbo | `image_zimage_refine.json` : 1 Mpx → RealESRGAN ×2 → 5 pas, dpmpp_2m_sde, beta, débruitage 0,15–0,35 | gabarit `utility_z_image_turbo_2k_upscaler` (écart : x2 au lieu de x4plus ÷ 2, même facteur net) | câblé |
| Angle | Qwen-Image-Edit 2511 + LoRA Multiple-Angles (fal, Apache-2.0) + Lightning 4 pas | `views_qwen.workflow("qwen-2511")` (CF), « <sks> azimut hauteur distance » | [fiche fal](https://huggingface.co/fal/Qwen-Image-Edit-2511-Multiple-Angles-LoRA) ; 8 azimuts, 4 hauteurs, 3 distances | câblé ; sens des côtés à vérifier |
| Variations, Refaire | le modèle de l'image | la recette gardée (`params`), autres graines ou la même | — | câblé |
| Étendre (outpaint) | — | — | non documenté pour nos trois modèles (Krea v1.2 l'annonce sans mode d'emploi) | **éteint, la page dit pourquoi** |
| Retirer avec Krea | — | — | Krea Raw requis | la page renvoie vers Qwen |
| Composition par profondeur (Krea) | LoRA de Patil (installé) + nœuds facok (installés) | — | README du nœud : cartes Depth-Anything-V2 | modèle de profondeur absent (§9) |

**Qwen ou Krea pour éditer ?** À essayer quand on câblera — aucun rendu fait. Ce que disent les
sources : Qwen édite nativement (10 références, masques, retrait, texte) mais Cal le juge laid en
photographie (28/09) ; Krea tient mieux un visage (banc CF : expressions Krea 0,80–0,96 FaceNet
contre Qwen 0,72–0,78) mais retire mal en Turbo et change une tenue au hasard. Protocole prévu :
une même photo, quatre consignes (changer la tenue, ajouter un objet, changer la lumière, garder
le visage), les deux modèles, même graine ; planche côte à côte + FaceNet contre la source.

## 7. Inventaire et validation à blanc (28/09, lecture seule)

Lu sur les deux machines (`ls models/*`, `custom_nodes`, `GET /object_info`) : tout est sur DGX2
et DGX1 sauf Z-Image base (DGX1). Les 18 graphes de l'outil (10 créations, 8 éditions) passés au
validateur de Character Factory (`factory.comfy.validate` : nœud absent, entrée inconnue, fichier
inconnu) contre le catalogue de chaque ComfyUI — **rien mis en file, aucun modèle chargé** :

- **DGX2** : 14/18 acceptés. Refus attendus : Z-Image base (fichier sur DGX1 seulement) ; les 3
  créations Qwen sans référence, pour « images » absente — l'entrée `Autogrow` a `min: 0`, le
  validateur ne le sait pas ; c'est le graphe par lequel Character Factory a rendu ses visages
  Qwen du 25 au 28/09.
- **DGX1** : 10/18. En plus des 3 Qwen ci-dessus : le `Krea2EditModelPatch` servi par le ComfyUI
  :8188 a la **signature v1.1** (`model`, `source_latent`, `source_latent_b`) alors que le dossier
  `comfyui-krea2edit` est en 1.2.5 ; et `qwen_2.5_vl_7b_fp8_scaled` et le Lightning 2511 ne sont
  pas dans ses listes alors qu'ils sont sur le disque. **DGX1 n'est pas le miroir exact de DGX2**
  pour l'édition Krea et l'angle. La page le lit elle-même (`/api/image/models`, capacité par
  capacité) et épingle ces travaux sur DGX2.

## 8. Brancher le câblage réel (à faire, avec l'accord de Cal)

1. `showrunner.local.json` : `"image_backend": "comfyui"` (voies `image` : les deux ComfyUI :8188).
2. Premiers rendus à regarder, dans cet ordre : Z-Image 1024 ; Krea 2 texte seul ; Qwen texte
   seul (confirme l'entrée `images` vide) ; Qwen avec un personnage ; Qwen fond transparent ;
   Krea avec un personnage (Identity Edit v1.2) ; les deux éditions par consigne (bug signalé
   dans diffusers [#14824](https://github.com/huggingface/diffusers/issues/14824) : édition Qwen à
   1024 quasi-copiée — à vérifier chez nous) ; la zone peinte ; BiRefNet ; SeedVR2 ×2 et ×4 (temps) ;
   Affiner ; Angle (le sens gauche/droite, `views_qwen.py` le suppose).
3. Le banc Qwen contre Krea du §6, et les temps de chaque outil, écrits ici.
4. DGX1 : relire pourquoi son :8188 sert l'ancien `Krea2EditModelPatch` et ne voit pas deux
   fichiers présents (redémarrage, second dossier de nœuds ?) — pas touché : DGX1 porte les autres
   projets de Cal.
5. Des vignettes d'exemple par pastille (comme Higgsfield) : un rendu par pastille, une fois le
   câblage accepté.

## 9. Téléchargements proposés (non faits ; Cal dit oui d'abord)

| quoi | pour | source | taille |
|---|---|---|---|
| `Z-Image-Turbo-Fun-Controlnet-Union-2.1-lite-2602-8steps.safetensors` (ou la complète) | inpaint documenté, pose, profondeur avec Z-Image ; piste pour « Étendre » | [alibaba-pai](https://huggingface.co/alibaba-pai/Z-Image-Turbo-Fun-Controlnet-Union-2.1) | 2,02 Go (lite) · 6,71 Go (complète) |
| `depth_anything_v2_vitl.pth` | cartes de profondeur pour le LoRA de profondeur Krea déjà installé (garder la composition d'une image) ; `comfyui_controlnet_aux` le téléchargerait seul au premier usage | [depth-anything/Depth-Anything-V2-Large](https://huggingface.co/depth-anything/Depth-Anything-V2-Large) | 1,34 Go |
| `krea2_raw_fp8_scaled.safetensors` | retraits avec Krea (Raw, CFG 3, ~20 pas, README Identity Edit) | [Comfy-Org/Krea-2](https://huggingface.co/Comfy-Org/Krea-2) | 13,1 Go (bf16 : 26,3 Go) |
| `RealESRGAN_x4plus.safetensors` | le modèle exact du gabarit « Affiner » (au lieu du x2) | [Comfy-Org/Real-ESRGAN_repackaged](https://huggingface.co/Comfy-Org/Real-ESRGAN_repackaged) | 66,9 Mo |

Tailles relevées par l'API Hugging Face le 28/09.

## 10. Sources

Toutes les pages citées ci-dessus, plus : gabarits officiels ComfyUI lus dans
`comfyui_workflow_templates_json` 0.11.69 sur DGX2 (`image_z_image_turbo`, `image_z_image`,
`image_qwen_image_2_1_t2i`, `image_qwen_image_2_1_image_edit`, `image_qwen_image_2_1_background_removal`,
`image_krea2_turbo_t2i`, `utility_seedvr2_*_int8_upscale_image`, `utility_birefnet_remove_background`,
`utility_z_image_turbo_2k_upscaler`, `templates-1_click_multiple_scene_angles`) ; le nœud
`ResolutionSelector` (`comfy_extras/nodes_resolution.py`) et `TextEncodeQwenImage21`
(`comfy_extras/nodes_qwen.py`) ; les README de `comfyui-krea2edit` et `comfyui-krea2-controlnet`
sur DGX2 ; `Character_Factory/docs/ETUDES.md` §3 et §8 ; guides de prompt :
[BFL FLUX.2](https://docs.bfl.ai/guides/prompting_guide_flux2),
[fal Krea 2](https://fal.ai/learn/tools/krea-2-prompting-guide),
[fal Z-Image](https://fal.ai/learn/devs/z-image-turbo-prompt-guide),
[aireiter Krea 2](https://aireiter.com/blog/krea-2-prompting-guide),
[Google Nano Banana](https://cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-nano-banana),
[trendingprompt](https://trendingprompt.org/blog/lighting-terms-for-ai-prompts/),
[gptimager](https://gptimager.com/styles/35mm-film).
