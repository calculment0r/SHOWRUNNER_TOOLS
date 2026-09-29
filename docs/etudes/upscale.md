# Étude — l'outil Upscale (29/09/2026)

Cal, 29/09 : « il faudra un upscale aussi ». Il fait des images et des films photoréalistes :
l'outil agrandit et affine **les images et les vidéos** de la bibliothèque — un portrait de
Character Factory, une photo de l'outil Image, un plan H3 de l'outil Vidéo (768 à 1344 px) porté
en 1080p ou en 4K.

**Statut** : étude sur documentation, inventaire lu sur les deux DGX, **aucun rendu fait**
(consigne du 28/09 : « on se concentre sur l'UX et l'UI, le câblage des modèles se fera après »).
L'outil tourne en moteur factice (`upscale_backend: "stub"`, le défaut : un bicubique PIL ou
ffmpeg, étiqueté « FACTICE ») ; le câblage réel est écrit et **validé à vide** contre le
catalogue de nœuds des deux ComfyUI :8188 (§8), rien mis en file.

Code : `upscale/` (page), `server/tools/upscale.py` (routes, travaux, tailles, mémoire, graphes,
factice, contrôle), `server/workflows/upscale_seedvr2_video.json` et `upscale_esrgan_video.json`
(les deux graphes vidéo propres au portail, tirés des gabarits officiels). Les graphes image
viennent de Character Factory (`factory/upscale.py` : `seedvr2_workflow`, `esrgan_workflow`) et
de l'outil Image (`tools.image.edit_graph`, « Affiner ×2 »), importés, jamais recopiés.

## 1. Ce que fait l'outil

- **Entrée** : une ou plusieurs images ou vidéos, choisies dans la bibliothèque, déposées depuis
  le disque, ou envoyées par l'adresse `upscale/?src=<id>[,<id>…]` (la bibliothèque et les autres
  outils y enverront). Un élément ou un son est refusé, avec la raison.
- **Réglages** : le modèle (une phrase dit à quoi il sert ; les modèles absents sont visibles,
  grisés, avec ce qui manque) ; ×2, ×4 ou une cible (image : 2K / 4K par le grand côté ; vidéo :
  1080p / 4K UHD, dans le cadre) ; la couleur (SeedVR2) ou le débruitage (Affiner). Sous chaque
  fichier, **avant l'envoi** : la taille exacte de sortie, le pic de mémoire estimé et le temps
  estimé — ou pourquoi il ne passera pas. Un seul bouton orange.
- **Résultat** : avant/après en **rideau**, **côte à côte**, avant seul, après seul ; une **loupe
  1:1** qui suit la souris (la même zone : l'avant agrandi simplement | l'après pixel pour pixel) ;
  pour une vidéo, la **lecture synchronisée** des deux (le banc A/B de l'outil Vidéo : l'une suit
  l'autre à 0,06 s près), image par image, boucle, son de l'une ou de l'autre. La file de la page,
  l'historique ; « Ouvrir dans la bibliothèque », « Envoyer au montage » (`montage/?add=<id>`),
  « Télécharger ».
- **Bibliothèque** : chaque sortie y entre avec sa lignée (`parents` = la source), sa recette
  (`params` : modèle, taille, couleur, graine…), `origin.model` (`…-factice` en factice),
  `render_s` et `upscale.from/to/frames`.

## 2. Inventaire réel (29/09, lecture seule)

Lu par `ls ~/ComfyUI/models/*`, `ls ~/ComfyUI/custom_nodes`, `GET /object_info` des deux :8188
(ComfyUI 830232b8 du 23/09 sur les deux).

| | DGX2 | DGX1 |
|---|---|---|
| SeedVR2 natif (nœuds `SeedVR2Preprocess`, `Conditioning`, `PostProcessing`, `TemporalChunk`, `TemporalMerge`, PR #14424) | oui | oui |
| `diffusion_models/seedvr2_3b_int8_convrot` (3,46 Go), `seedvr2_7b_int8_convrot` (8,33 Go), `vae/seedvr2_ema_vae_fp16` (0,50 Go) | oui | oui |
| nœud numz `ComfyUI-SeedVR2_VideoUpscaler` 2.5.24 + `models/SEEDVR2/seedvr2_ema_7b_fp16` (16,5 Go) et `ema_vae_fp16` | oui | oui |
| `upscale_models/RealESRGAN_x2.pth` (67 Mo — sha256 = `ai-forever/Real-ESRGAN`) | oui | oui |
| `upscale_models/RealESRGAN_x2plus.pth` (xinntao) | — | oui |
| Z-Image Turbo (`z_image_turbo_bf16`, `qwen_3_4b`, `ae`) : le graphe « Affiner » | oui | oui |
| `AuraSR-ComfyUI` (nœud) | oui, **dossier `models/Aura-SR` vide** | — |
| `ComfyUI_InvSR` (nœud) | oui, **poids absents** (`models/diffusers` vide, pas de `models/invsr`) | — |
| `ComfyUI-SUPIR` + `checkpoints/SUPIR-v0Q_fp16` (2,66 Go) | oui, **aucun SDXL** | oui, **aucun SDXL** |
| latents : `ltx-2.3/2.5-*-upscaler`, `minimax_h3_latent_upscaler_3d`, `SesquiLSR` | oui | oui |
| FlashVSR | — | — |

Les upscalers latents (LTX, H3 Latent Upscaler-Plus, SesquiLSR) agrandissent **pendant une
génération** (un second passage du même modèle, README de chacun) : ils ne prennent pas une vidéo
finie. Ils relèvent de l'outil Vidéo, pas de cet outil.

Gabarits officiels lus dans `comfyui_workflow_templates_json` 0.1.95 (DGX2) :
`utility_seedvr2_3b_int8_upscale_image`, `utility_seedvr2_7b_int8_upscale_image`,
`utility_seedvr2_3b_int8_upscale_video`, `utility-gan_upscaler`, `utility_z_image_turbo_2k_upscaler`
(les autres « upscale » passent par des API payantes : Magnific, Topaz, WaveSpeed… — écartés, tout
reste local).

## 3. Les modèles, un par un

| | image / vidéo | ce qu'il fait | facteur, taille | mémoire | temps documenté | cohérence temporelle | licence |
|---|---|---|---|---|---|---|---|
| **SeedVR2 7B INT8** | les deux | restauration en **un pas** par diffusion : « conservative upscaling … preserves original structure » (docs ComfyUI) ; « higher quality » que le 3B | toute taille paire ; les gabarits ×2 / ×4 ; nœud numz jusqu'à 16384 | loi de ComfyUI (§5) ; poids 8,8 Go | aucun | oui : le modèle voit des blocs de 4n+1 images, fenêtre temporelle ≤ 30 (constants.py) | Apache-2.0 |
| **SeedVR2 3B INT8** | les deux | le même, « lower VRAM » ; celui du gabarit vidéo officiel | idem | idem ; poids 4,0 Go | aucun | idem | Apache-2.0 |
| **RealESRGAN ×2** | les deux | GAN : netteté rapide, « can't create new detail like diffusion can, but it's much faster » (note du gabarit GAN) | ×2 fixe ; une cible plus petite = ×2 puis Lanczos (conseil du gabarit) | poids 67 Mo ; le reste non documenté | aucun | **non** : image par image (`ImageUpscaleWithModel`) | BSD-3-Clause |
| **Z-Image Turbo « Affiner »** | image | **réinvente** le détail fin : 1 Mpx → ESRGAN ×2 → 5 pas, débruitage 0,15–0,35 (« au-delà, des défauts ») | ≈ 4 Mpx fixe | poids 20,7 Go | aucun | — | Apache-2.0 |
| AuraSR v2 (fal) | image | GAN ×4 (GigaGAN) « for upscaling generated images » ; « not ideal for detailed face upscaling » | ×4 | 0,6B param. | aucun | — | Apache-2.0 (poids) ; nœud CC-BY-SA-4.0 |
| SUPIR v0Q | image | restauration par SDXL + ControlNet, 45 pas par défaut ; 512→1024 sur 10 Go, 3072² sur 24 Go (README kijai) | libre (`scale_by`) | lourde | aucun | non (image par image) | **non commerciale** |
| InvSR | image | inversion de diffusion sd-turbo, 1 à 5 pas | libre ; `chopping_size` 256 pour 1k→4k | — | aucun | — | **S-Lab, non commerciale** |
| FlashVSR v1.1 | vidéo | diffusion en un pas sur Wan 2.1 1,3B, « real-time streaming » | ×2 à ×4 | — | temps réel annoncé | oui (décodeur temporel) | Apache-2.0 |

Limites écrites par ByteDance pour SeedVR2 (fiche Hugging Face) : pas robuste aux dégradations
lourdes ni aux très grands mouvements ; **sur une source peu dégradée (720p propre), il peut trop
générer de détail et sur-accentuer**. C'est le cas des plans H3 et des portraits de Character
Factory : la loupe de l'outil sert à le voir, et la couleur « lab » recale la teinte.

## 4. Fidèle ou inventif

L'axe que la page montre sur chaque modèle (« fidèle », « net », « créatif ») :

- **fidèle** — SeedVR2 : la même image, restaurée ; rien d'ajouté qui n'y était pas. Couleur
  recalée sur la source (`SeedVR2PostProcessing` : `lab` « most faithful », le défaut du nœud ;
  `wavelet`, `adain`, `none` — celui des gabarits).
- **net** — RealESRGAN : des contours nets, vite ; ni détail inventé ni lien d'une image à la
  suivante (scintillement possible en vidéo).
- **créatif** — Z-Image « Affiner » : du grain de peau, des fils de tissu qui n'existaient pas.
  Peut changer un visage : à réserver à une image dont l'identité n'est pas en jeu, ou à faible
  débruitage (0,15).

## 5. Mémoire et temps

**Mémoire (SeedVR2)** : ComfyUI écrit sa loi dans `comfy/ldm/seedvr/constants.py` — « the
sampler's activation wall is linear in T_latent × pixel area » : pic ≈ 8,5 Gio + 4 × 0,55 Gio +
**0,55 Gio par mégapixel et par image latente**, une image latente valant 4 images vidéo (4n+1).
Calibrée sur 3B fp16 et une RTX 5090 : un ordre de grandeur. Le nœud `SeedVR2TemporalChunk` en
mode `auto` découpe la vidéo en morceaux qui tiennent dans la mémoire libre ; l'outil fait le même
calcul avec la mémoire libre lue sur `/system_stats` et l'affiche (« 2 morceaux »). Exemples :

| | sortie | pic |
|---|---|---|
| portrait 768² ×2 | 1536² | ≈ 13 Go |
| photo 1024² ×4 | 4096² | ≈ 21 Go |
| plan H3 1792×768, 124 images → 1080p | 1920×822 | ≈ 42 Go |
| plan H3 1792×768, 124 images → 4K UHD | 3840×1646 | ≈ 131 Go d'un bloc → **2 morceaux** avec ~73 Go libres |
| plan H3 1344×768, 121 images → 4K UHD | 3780×2160 | ≈ 161 Go d'un bloc → 3 morceaux |

Les autres modèles : leurs poids seuls (« ≥ ») ; le reste n'est pas documenté.

**Temps** : aucune source ne donne un temps de SeedVR2, de RealESRGAN ou d'Affiner sur un DGX
Spark (fiches, README, docs ComfyUI : « higher target resolutions require more processing time »,
sans chiffre). L'outil **ne l'invente pas** : il affiche « temps non mesuré » jusqu'au premier
rendu, puis la médiane des rendus passés du même modèle, en secondes par mégapixel·image (en
factice, les mesures factices, dites comme telles).

## 6. Ce qu'on retient par défaut

| cas | modèle | réglage | pourquoi |
|---|---|---|---|
| **une photo** | **SeedVR2 7B** | ×2 ou 4K, couleur lab | fidèle par construction ; le 7B « higher quality » (docs ComfyUI) ; c'est le choix de Character Factory pour les détails de la planche (`factory/upscale.py`) et de l'outil Image (« Agrandir ») |
| **un visage** | **SeedVR2 7B** | ×2 (ou ×4), lab | l'identité ne doit pas bouger : pas d'invention ; AuraSR « not ideal for faces », Affiner peut changer les traits. Affiner à 0,15 seulement si la peau paraît cireuse, et à comparer à la loupe |
| **une vidéo H3** (768–1344 px) **→ 1080p / 4K** | **SeedVR2 3B** | cible 1080p ou 4K UHD, lab | le gabarit vidéo officiel prend le 3B ; restauration temporellement cohérente (4n+1) ; moitié moins de poids que le 7B pour une vidéo longue, découpage auto ; le 7B pour un plan clé, si le temps le permet |
| un aperçu rapide | RealESRGAN ×2 | ×2 | secondes ; pas pour une livraison vidéo (image par image) |

1080p et 4K UHD d'une vidéo : la vidéo **tient dans le cadre** 1920×1080 ou 3840×2160 — les deux
réglages du nœud numz, `resolution` (petit côté) et `max_resolution` (« if any edge exceeds this …
both dimensions are scaled down ») : 1344×768 → 1890×1080 ; 1792×768 → 1920×822 ; 768×1344 →
1080×1890. Une image 2K/4K se règle par son grand côté (2048 = la 2K de Qwen-Image 2.1 ; 4096 =
l'exemple « 4K image » du nœud numz).

Bornes : ×8 au plus pour SeedVR2 (le multiplicateur de `ResizeImageMaskNode` des gabarits : max
8,0) ; une image ≤ 8192 px (la borne de l'outil Image) ; une vidéo ≤ 4K UHD (petit côté 2160,
grand côté 4096 — la cible de Cal). Côtés toujours pairs (H.264 yuv420p ; « any resolution
divisible by 2 », README numz).

## 7. Téléchargements proposés (non faits ; Cal dit oui d'abord)

| quoi | pour | source | taille | licence |
|---|---|---|---|---|
| `RealESRGAN_x4plus.safetensors` | le ×4 GAN (bouton éteint aujourd'hui) ; le modèle exact des gabarits GAN et « Affiner » | [Comfy-Org/Real-ESRGAN_repackaged](https://huggingface.co/Comfy-Org/Real-ESRGAN_repackaged) | 66,9 Mo | BSD-3-Clause |
| `model.safetensors` + `config.json` → `models/Aura-SR/` (DGX2 ; nœud absent de DGX1) | AuraSR v2, un GAN ×4 pour les images générées (pas les visages) | [fal/AuraSR-v2](https://huggingface.co/fal/AuraSR-v2) | 2,47 Go | Apache-2.0 |
| FlashVSR v1.1 (`diffusion_pytorch_model_streaming_dmd`, `LQ_proj_in`, `TCDecoder`, `Wan2.1_VAE`) **+ un nœud ComfyUI** (paquet) | une seconde voie vidéo, plus rapide que SeedVR2 ; à comparer au banc | [JunhaoZhuang/FlashVSR-v1.1](https://huggingface.co/JunhaoZhuang/FlashVSR-v1.1) ; nœuds [1038lab](https://github.com/1038lab/ComfyUI-FlashVSR), [naxci1](https://github.com/naxci1/ComfyUI-FlashVSR_Stable) | 6,95 Go | Apache-2.0 (poids) ; nœud à vérifier |

**Non proposés** : SUPIR (il lui faut un SDXL de ~7 Go de plus, licence non commerciale, 45 pas) ;
InvSR (licence S-Lab non commerciale ; le nœud téléchargerait sd-turbo et son noise_predictor au
premier usage — l'outil ne l'appelle jamais). Déjà sur disque et inutilisé : `seedvr2_ema_7b_fp16`
(16,5 Go, nœud numz) — la même 7B en fp16, qu'on pourrait comparer à l'INT8 au câblage.

Tailles relevées par l'API Hugging Face le 29/09.

## 8. Le câblage réel, et sa validation à vide

| modèle | image | vidéo |
|---|---|---|
| SeedVR2 7B / 3B | Lanczos à la taille voulue en PIL, puis `seedvr2_workflow` de Character Factory (le montage du gabarit `utility_seedvr2_*_int8_upscale_image`), la couleur réglée sur son `SeedVR2PostProcessing` | `upscale_seedvr2_video.json` : le sous-graphe du gabarit `utility_seedvr2_3b_int8_upscale_video` au format API (LoadVideo → GetVideoComponents → redimension → Preprocess → VAEEncodeTiled 512·128·64·8 → TemporalChunk auto → Conditioning + KSampler 1 pas → TemporalMerge → VAEDecodeTiled → PostProcessing → CreateVideo avec le son et la cadence de la source → SaveVideo) |
| RealESRGAN ×2 | `esrgan_workflow` de Character Factory, puis Lanczos à la cible | `upscale_esrgan_video.json` : le gabarit `utility-gan_upscaler` + le redimensionnement conseillé par sa note |
| Affiner | `tools.image.edit_graph` (« refine »), la description reprise du prompt d'une image de l'outil Image | — |

Écarts aux gabarits, écrits dans les `_source` des JSON : la taille en pixels exacts (pour que la
taille affichée soit celle qui sort), le découpage `auto` branché d'office (conseil de la note du
gabarit pour les vidéos longues), la couleur `lab` par défaut. La transparence d'une image est
reposée après coup (alpha agrandi en Lanczos), comme le `JoinImageWithAlpha` du gabarit.

**Validation à vide** (29/09) : les 7 graphes retenus (4 modèles × image/vidéo) passés au
validateur de Character Factory (`factory.comfy.validate` : nœud absent, entrée obligatoire
manquante, fichier inconnu) contre `/object_info` de chaque ComfyUI — **7/7 sur DGX2, 7/7 sur
DGX1**, rien mis en file, aucun modèle chargé. Témoin : un `unet_name` inventé et une couleur
« violet » sont bien refusés sur les deux. La page relit cette validation elle-même
(`GET /api/upscale/models`, `availability`) et épinglerait un travail sur la seule machine qui peut
le faire.

## 9. Brancher (à faire, avec l'accord de Cal)

1. `showrunner.local.json` (DGX2) : `"upscale_backend": "comfyui"`, puis `tools/portail.sh restart`.
   Les travaux passent alors sur la voie `image` (un ouvrier par DGX).
2. Premiers rendus, dans cet ordre : un portrait 768² en SeedVR2 7B ×2 (temps, mémoire, la loupe :
   sur-accentuation ?) ; le même en 3B ; RealESRGAN ×2 ; Affiner 0,15 et 0,35 ; un plan H3 court
   (2 s) en 3B → 1080p (le son, la cadence, le découpage) ; puis 4K UHD (plusieurs morceaux :
   raccord visible entre morceaux ? sinon `temporal_overlap` > 0, réglage du nœud, à essayer).
3. Lire `SaveVideo` au premier rendu : le fichier revient en `.mp4` (format `auto`, codec `auto`).
4. Comparer au banc SeedVR2 7B INT8 et 7B fp16 (déjà sur disque, nœud numz) sur un plan H3.
5. Écrire ici les temps mesurés ; l'outil les reprend seul pour ses estimations.

## 10. Sources

- SeedVR2 : [fiche ByteDance-Seed/SeedVR2-3B](https://huggingface.co/ByteDance-Seed/SeedVR2-3B)
  (Apache-2.0, limites) ; [docs ComfyUI](https://docs.comfy.org/tutorials/utility/seedvr2) ;
  [PR #14424](https://github.com/Comfy-Org/ComfyUI/pull/14424) ; `comfy_extras/nodes_seedvr.py` et
  `comfy/ldm/seedvr/constants.py` (ComfyUI 830232b8, lus sur DGX2) ; README et exemples du nœud
  [numz/ComfyUI-SeedVR2_VideoUpscaler](https://github.com/numz/ComfyUI-SeedVR2_VideoUpscaler) 2.5.24
  (4n+1, `resolution`, `max_resolution`, couleurs, exemples HD vidéo et 4K image).
- Gabarits ComfyUI (`comfyui_workflow_templates_json` 0.1.95, DGX2) cités au §2.
- Real-ESRGAN : [xinntao](https://github.com/xinntao/Real-ESRGAN) et
  [ai-forever](https://huggingface.co/ai-forever/Real-ESRGAN) (BSD-3-Clause ; sha256 du fichier
  installé = celui d'ai-forever).
- AuraSR : [fal/AuraSR-v2](https://huggingface.co/fal/AuraSR-v2), README d'AuraSR-ComfyUI (DGX2).
- SUPIR : README de ComfyUI-SUPIR (kijai) et sa déclaration « Non-Commercial Use Only » (DGX2).
- InvSR : README et licence S-Lab de ComfyUI_InvSR (DGX2).
- FlashVSR : [JunhaoZhuang/FlashVSR-v1.1](https://huggingface.co/JunhaoZhuang/FlashVSR-v1.1).
- Upscalers latents : README de Comfyui_Minimax_h3_latent_Upscaler-Plus et de SesquiLSR (DGX2).
- `docs/etudes/image.md` (§6 « Agrandir », « Affiner » ; §7 DGX1 pas un miroir exact) ;
  `Character_Factory/factory/upscale.py`.
