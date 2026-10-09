# Étude — la veille des modèles du 09/10 et le catalogue des workflows de l'agent (09/10/2026)

Cal, 09/10, en substance :
- « Dans le mode Showrunner, il va falloir comprendre ce que veut l'utilisateur, et aiguiller des demandes vers des
  workflows disponibles. Exemple : enlever une personne ou un objet dans une scène : LTX 2.5 ou MiniMax H3 avec ce
  LoRA (akatz-ai/MiniMax-H3-Person-Remover-LoRA) ? A-t-on intégré LTX avec ses derniers LoRA de VFX ? »
- « Des gens vont vouloir faire des incrustations hyper bien faites avec notre agent du studio » (avec un lien t.co
  **qui n'a pas pu être lu** : ce qu'il montrait manque à cette étude).
- « Tester Ming-Image : Ming-Image-0.1-Design (6B), Ming-Image-0.1-Design-Layer (6B), et deux Agent Skills open
  source : la Ling UI Design Skill et la Image-to-Editable-PPT Skill. »
- « NVIDIA a sorti un Qwen3.8-Flash-Next 63 % plus petit, quantifié NVFP4 : 125B MoE à attention hybride. »
- Les nœuds ComfyUI-MiniMaxH3-Studio ; des modèles d'image **sans filtre** pour la production audiovisuelle
  (horreur, violence de fiction, nudité artistique), avec des garde-fous ; un workflow H3 « Dialogues.json » pour des
  personnages qui jouent naturellement.

**Statut** : étude. Rien n'est codé, rien n'est téléchargé, aucun rendu (pas de GPU ici). Chaque essai est un
protocole pour Cal ; chaque téléchargement attend son accord. Elle remplit, pour la veille, le registre des capacités
proposé par `agent_autonome.md` § 5.6 (même jour, branche `wip3/agent-etude`) : mêmes champs, mêmes intentions.

Ce que vaut chaque fait : **[lu]** dans le code, un README, une licence ou un gabarit, lus en entier depuis GitHub
(clone ou fichier brut) ; **[extrait]** extrait de moteur de recherche seulement (huggingface.co, ltx.io,
docs.nvidia.com, comfyui-wiki.com, legifrance.gouv.fr ne répondent pas depuis ce conteneur) ; **[calcul]** ;
**[supposition]**. Versions lues : ComfyUI `08ff3c11` (v0.39.0, 09/10) et `830232b8` (v0.37.2, **celle des DGX**) ;
Comfy-Org/workflow_templates `8be1f8c` ; Lightricks/LTX-2 `9ec55f9` ; inclusionAI/Ming-Image `3515cd7` ;
inclusionAI/ling-cookbook `e96eff7` ; rookiestar28/ComfyUI-MiniMaxH3-Studio `8999053` ; krea-ai/krea-2 `db3984f` ;
Haidra-Org/horde-safety `050b0b3`.

## En bref

- **LTX n'est pas intégré** : aucune ligne de code ne le nomme (grep du 09/10) ; seuls les upscalers latents
  LTX 2.3/2.5 sont relevés sur les deux DGX (`upscale.md` § 2), et ai-toolkit sait l'entraîner
  (`lora_entrainement.md`). LTX-2.5 (11/08/2026, 22 B, licence LTX-2.x Community, gratuite sous 10 M$ de CA) a ses
  IC-LoRA de VFX : **Clean-Plate** (retirer tout ce qui bouge, sans masque), **Alpha-Gen** (un détourage alpha sans
  fond vert, 02/10), **Day-To-Night**, Restore, Decompression, Colorization, SDR-To-HDR, Layout-To-Render,
  Ingredients. Le Relight et l'in/outpainting ne sont trouvés qu'en LTX-2.3, et un LoRA ne vaut que pour son modèle.
- **Retirer une personne** : quatre voies documentées, aucune installée. LTX-2.5 Clean-Plate (tout ce qui bouge) ;
  le LoRA Person-Remover d'H3 (une personne suivie par SAM 3.1, avec la première image nettoyée ; licence d'H3, hors
  UE) ; **deux voies déjà dans notre ComfyUI 0.37.2 sans mise à jour** : l'inpainting avec masque d'H3 (ControlNet
  Union d'alibaba-pai, 2,14 Go) et **VOID** de Netflix (objet ET ses effets : ombres, contacts ; ≈ 34 Go). Même
  recommandation qu'`agent_autonome.md` A7 : LTX-2.5 d'abord.
- **Incrustation** : la chaîne est détourer → poser → harmoniser. On a BiRefNet (image), Qwen/Krea « Relight the
  scene » (image), H3 Références (re-génère tout le plan). Il manque le détourage vidéo (Alpha-Gen, ou SAM 3.1) et
  **le Montage jette l'alpha d'une source** (`format=gbrp`, `montage.py` l. 1613-1615, 1731, 1820) : une
  incrustation par détourage y est aujourd'hui impossible, quel que soit le modèle.
- **Ming-Image** : réel, MIT, 6 B ; génère des maquettes, affiches, pages à texte dense, en RGBA. Natif dans ComfyUI
  **à partir de v0.38.0** (nous : 0.37.2) ; ≈ 24 Go (sans son réécrivain de 16 Go, que notre Ollama remplace).
  Design-Layer n'est pas dans ComfyUI (dépôt officiel épinglé torch 2.4.0, validé sur 80 Gio ; vLLM-Omni). Les deux
  skills (MIT) appellent par défaut des API payantes (Novita, OpenRouter) : à reprendre en méthode, pas à installer.
- **Qwen3.8-Flash-Next NVFP4** : réel (125 B, 6 B actifs, Gated DeltaNet + attention clairsemée, 124 Go sur
  disque). Sur un seul Spark, seulement avec un correctif communautaire de vLLM (la table n-gram de 48 Gio laissée
  sur le NVMe) : ≈ 102 Go pris, 10 min de chargement, ≈ 44 jetons/s. Il prend une DGX entière : **écarter** pour
  l'agent ; garder `qwen3:30b-a3b` (A1).
- **ComfyUI-MiniMaxH3-Studio** : Apache-2.0, sérieux, mais il double `movie.py` et son éditeur ne tourne que sous
  Windows. Ne pas l'installer ; en reprendre deux règles du guide officiel d'H3 qu'il cite : les temps de coupe
  `[Shot 2] At 00:08.000,` (notre Multishot écrit « (about N seconds) ») et `(S1,S2)`.
- **Sans filtre** : le fichier de Cal (`abenzerps/Qwen-Image-2.1-Uncensored-GGUF`) n'a **rien de « uncensored »**
  d'après la seule source trouvée (les poids d'origine quantifiés), sous licence de recherche non commerciale :
  écarter. **Z-Image Turbo (Apache-2.0) et Krea 2 sont déjà sur les disques** et passent pour permissifs. Rien à
  télécharger. Mais la licence de Krea 2 **exige des filtres de contenu chez qui le déploie** (§ 4.2, lu) : le
  portail n'en a aucun aujourd'hui, mode sans filtre ou non.
- **Garde-fous** : un socle légal toujours actif (mineurs, personnes réelles) et un étage « contenu adulte » que Cal
  ouvre compte par compte ou Team par Team ; **par construction** : en sans filtre, aucune image d'entrée dont la
  lignée remonte à une photo déposée ni à Character Factory ; filtres locaux sur l'invite et sur l'image ; journal.
- **Dialogues.json** : ce qui marche, d'après le code du nœud H3 : une référence vidéo réduite au quart garde sa
  petite taille (128 × 96) et ne coûte ≈ 4 % des jetons du plan ; floutée, elle ne transmet que le rythme et les
  gestes, pas la bouche. **Le « dénoise 0,97 » ne fait rien** à 10 pas (`int(10/0,97) = 10` : mêmes sigmas que 1,0) et
  le latent est vide. Proposition : une recette du mode Vidéo, « jeu libre → plans dialogués », puis une capacité du
  registre.

## 1. Ce que le portail fait déjà, et ce que nos ComfyUI savent (lu le 09/10)

- **Vidéo** (`server/tools/movie.py`) : H3 seulement — `movie.t2v`, `movie.i2v`, `movie.r2v` ; la recette de Cal
  (Singularity ref2va v1.3 int8, LoRA People 0,6 → cinéma DY 0,6 → Turbo v4 1,0, 8 pas, `MiniMaxH3TurboSampler`,
  `server/workflows/h3_recette.json`) ; « Continuer le plan » (la dernière image devient la première d'un plan) ;
  les références vidéo (rôles mouvement, caméra, action, scène) et son (voix, musique, bruitages) ; la réplique mise
  au format H3 `(S1) says: <d>[French] …</d>` (`speech_to_h3`).
- **Image** (`image.py`, `image_atelier.py`) : Z-Image, Qwen-Image 2.1, Krea 2 ; Consigne (une zone peinte la
  borne), Détourer (BiRefNet), Agrandir (SeedVR2), Affiner, Angle ; l'atelier : Détail, Lumière, Style, Ajouter,
  Retirer, Fond ; Étendre éteint (aucune méthode documentée).
- **Upscale** : SeedVR2 3B/7B, RealESRGAN ; **Montage** : pistes superposées (`overlay`), opacité, recadrage — mais
  chaque source passe en `format=gbrp` (sans alpha) avant ses effets : l'alpha propre d'une source est perdu.
- **Transcrire** (Whisper, Nemotron), **Musique/ODIO** (ACE-Step, YuE2, stems, MIDI ; son propre registre
  d'intentions, `musique/generatif_modeles.json`), **Object Creator** (TRELLIS.2), **Présentation** (PDF, PNG, MP4 ;
  pas de PPTX).
- **Les nœuds présents dans ComfyUI 0.37.2** (`830232b8`, relu dans le dépôt de ComfyUI à ce commit) :
  `MiniMaxH3AddGuide` (ancrer une image ou un court extrait à n'importe quelle image du plan),
  `MiniMaxH3FunControlNetApply` (contrôle canny, profondeur, pose… et **inpainting** : `mask`, « 1 marks the regions
  to regenerate », `source_video`), les nœuds VOID (`nodes_void.py`), SAM 3 (`SAM3_Detect`, `SAM3_VideoTrack`,
  `SAM3_TrackToMask`), le cœur LTX (`LTXVAddGuide`, `GetICLoRAParameters`…). **Absents** : Ming-Image
  (`nodes_ming.py`, arrivé le 24/09, `3b4c0b0e`, étiquettes ≥ v0.38.0) et `LTXAddVideoICLoRAGuide`, le nœud que les
  gabarits IC-LoRA d'LTX emploient — il vient du paquet ComfyUI-LTXVideo de Lightricks, pas du cœur ; sa présence sur
  les DGX n'est pas relevée.

## 2. Les annonces, une par une

### 2.1 Retirer une personne ou un objet ; LTX-2.5 et ses IC-LoRA de VFX

**Le LoRA Person-Remover d'H3** (`akatz-ai/MiniMax-H3-Person-Remover-LoRA`). Existence confirmée par l'extrait de sa
page [extrait], page non lue. « Experimental » ; H3 **Ref2VA** vidéo → vidéo ; le gabarit fourni suit la personne
par **SAM 3.1**, remplit son masque de vert et régénère le fond par fenêtres qui se chevauchent ; il faut la vidéo
d'origine **et sa première image déjà nettoyée** (faite par un éditeur d'image), la personne décrite en une phrase ;
24 i/s, côtés multiples de 32, un plan continu d'≈ 5 s ; « selected successful results, not a benchmark ». Fichier
`H3-Person-Remover-V1.safetensors`, **222 Mo** selon un extrait, **155 Mo** selon celui d'`agent_autonome.md` [18] :
non confirmé. Licence non lue ; un LoRA d'H3 reste sous la licence d'H3, qui **exclut l'UE**, les États-Unis, le
Royaume-Uni et la Corée [extrait] (REPRISE § 2.D). Son voisin, **Character-Swap** (même auteur, 25/09/2026, 1 000
pas) remplace une personne par un personnage donné en image ; « long clips drift and hard cuts break » [extrait].

**LTX-2.5** (Lightricks, 11/08/2026) [lu : README et LICENSE du dépôt LTX-2] : 22 B, audio et vidéo ensemble ;
encodeur Gemma 4 12B propre à LTX ; ≈ 66 Gio pour le jeu « distillé » (transformeur, encodeur, deux VAE,
agrandisseur). Licence **LTX-2.x Community** (11/08/2026) : un CA annuel ≥ 10 M$ exige une licence commerciale ;
parmi les usages interdits, lus : présenter un contenu sans dire qu'il est fait par une machine (5), imiter
quelqu'un sans son consentement, « deepfakes » (7), contourner les filtres et les marquages (19), un produit qui
concurrence Lightricks (20). Les **pipelines** du dépôt : `ICLoraPipeline` (vidéo → vidéo, transformeur distillé),
`RetakePipeline` (refaire une plage de temps d'une vidéo, le reste gardé ; 8k+1 images, côtés ÷ 32),
`DubItPipeline` (changer une réplique en gardant la voix et en recalant les lèvres — IC-LoRA **LTX-2.3** seulement),
`AlphaGenPipeline` (**transformeur complet**, pas le distillé), `DFRPipeline` (qualité de production). torch 2.13
cu132, une roue `natten` pour Linux aarch64 : plausible sur Spark, **non essayé** (le pilote doit accepter CUDA 13.2 :
à lire par `nvidia-smi`).

**Ses IC-LoRA de VFX** : trouvés pour 2.5 [extrait, pages Hugging Face] : Clean-Plate
(`ltx-2.5-22b-ic-lora-clean-plate-1.0`), Alpha-Gen (`…-alpha-gen-0.9`, « beta » : cheveux, fourrure, fumée,
voilages), Day-To-Night, Restore, Decompression, Colorization, SDR-To-HDR, Layout-To-Render, Ingredients,
Pixel-Spatial-Upscaler. Seulement en 2.3 : Relight (le soleil d'un extérieur, une direction parmi 8 et une dureté),
In-Outpainting, Union-Control, Motion-Track, DubIt, HDR, Clean-Plate 2.3. Le README d'LTX-2 : « a LoRA only works with the model it was trained on » [lu]. Gabarits
ComfyUI officiels [lu] : LTX-2.5 t2v, i2v, première et dernière image (min. ComfyUI 0.32.0 : nos DGX conviennent),
IC-LoRA 2.3, « Obscura Remova » 2.3 (retirer un objet nommé), outpainting 2.3, retirer sous-titres ou filigrane.

**Les deux voies déjà possibles chez nous** (nœuds dans 0.37.2, modèles à télécharger) :
- **H3 Fun ControlNet Union** (alibaba-pai) : un seul point de contrôle pour canny, profondeur, HED, MLSD, pose **et
  l'inpainting vidéo** ; `minimax_h3_fun_controlnet_union_pruned_int8_convrot.safetensors`, **2,14 Go** [lu : gabarit
  `video_minimax_h3_fun_controlnet_union`, min. 0.35.0] ; posé sur le **même H3** que le nôtre ; une v2.0 de 13,5 Go
  [extrait]. Licence non lue (et celle d'H3 par-dessous).
- **VOID** (Netflix, code Apache-2.0 [lu]) : SAM 3.1 désigne l'objet par un mot, deux passes effacent l'objet **et ce
  qu'il cause** (ombres, recouvrements) ; gabarit `utility_void_video_inpainting` (min. 0.21.0) de **34,3 Go** au
  total, dont T5-XXL 9,12 Go, SAM 3.1 1,63 Go, VAE CogVideoX 0,41 Go [lu] ; licence des poids non lue.

**Faisabilité sur DGX Spark** : LTX-2.5 22 B en bf16 ≈ 44 Go, ≈ 22 Go en int8 [calcul] ; plus Gemma 4 12B : tient
seul dans 128 Go, jamais à côté d'H3 (100 Go, `FAMILY_GB`) — une famille `ltx` à déclarer à la file. Le seul temps
publié (10 s en 720p en 6,8 s) est sur deux GB200 [extrait] : **aucun temps sur Spark**.

**Apport** : Vidéo (un mode « Retoucher un plan » : nettoyer, détourer, nuit, restaurer) ; la licence de repli
quand H3 est exclu (UE).

**Protocole d'essai** (après l'accord de Cal sur les téléchargements) :

```sh
ssh dgx2 'df -h ~ | tail -1; free -g | sed -n 2p; curl -s 127.0.0.1:8188/queue | head -c 300; nvidia-smi | head -4'
# LTX-2.5 distillé, format ComfyUI (gabarit video_ltx2_5_i2v ; fichiers du dépôt Lightricks/LTX-2.5) + Clean-Plate
ssh dgx2 'cd ~/ComfyUI/models && hf download Lightricks/LTX-2.5 diffusion_models/ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors text_encoders/gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors vae/ltx-2.5-video-vae-bf16.safetensors vae/ltx-2.5-audio-vae-bf16.safetensors --local-dir .'
# le nom du fichier vient d'un extrait (fiche non lue) : le vérifier sur la fiche avant
ssh dgx2 'cd ~/ComfyUI/models/loras && hf download Lightricks/LTX-2.5-22b-IC-LoRA-Clean-Plate ltx-2.5-22b-ic-lora-clean-plate-1.0.safetensors --local-dir .'
ssh dgx2 'curl -s -X POST 127.0.0.1:8188/free -H "Content-Type: application/json" -d "{\"unload_models\":true,\"free_memory\":true}"'
```

Puis, dans la ComfyUI :8188 de DGX2, le gabarit d'exemple livré avec le LoRA (fiche Hugging Face, non lue ici) ; s'il
demande `LTXAddVideoICLoRAGuide`, le paquet ComfyUI-LTXVideo d'abord (un ajout à la ComfyUI : accord de Cal). Trois
plans de 5 s de la bibliothèque, mis en 8k+1 images et côtés ÷ 32 (`ffmpeg -vf "crop=…,fps=24" -frames:v 121`) : un
passant seul, trois personnes, une voiture. Relever : temps, mémoire libre au plus bas (`free -g` toutes les 2 s),
ce qui reste (ombres ?), ce qui part à tort (un objet immobile ?). Puis le même plan en H3 Person-Remover et en
VOID, après leur téléchargement accepté.

**Recommandation** : **essayer LTX-2.5 + Clean-Plate**, puis Alpha-Gen (il demande en plus le transformeur complet,
≈ 44 Go [calcul]). Le Person-Remover d'H3 ensuite, pour « une personne parmi d'autres », hors projets commerciaux
dans l'UE. Pour un objet immobile : **VOID** ou l'inpainting d'H3, qui ne demandent aucune mise à jour de ComfyUI.

### 2.2 L'incrustation (le lien de Cal manque)

Le lien t.co n'a pas pu être ouvert : on ne sait pas quel outil ou quelle démonstration Cal voulait montrer. Ce qui
suit couvre la chaîne en général.

| étape | branché | installable (avec quoi) | écarté ou inexistant |
|---|---|---|---|
| détourer une image | BiRefNet (Image → Détourer) ; Qwen-Image 2.1 et Ming en RGBA natif | — | — |
| détourer une vidéo | — | **LTX-2.5 Alpha-Gen** (alpha sans fond vert ni masque ; « beta » ; un plan full HD à durée max. demande une H100 [extrait]) ; **SAM 3.1** (1,63 Go, « SAM License » de Meta [lu], masques, nœuds présents) | MatAnyone 2 (S-Lab, **non commerciale** [extrait]) ; SAM2Matting (CC BY-NC-SA) |
| poser sur un fond | Montage (pistes, opacité) — **sans l'alpha de la source** | garder l'alpha au Montage (`gbrap` au lieu de `gbrp`) : du code, hors de ce lot | — |
| harmoniser la lumière, image | Consigne « Relight the scene… » (pastilles, Qwen 2.1 ou Krea 2) | Qwen-Image-Edit 2509 + LoRA Relight (gabarit officiel, 31,8 Go [lu]) | IC-Light v2 (non commerciale [extrait, à vérifier]) |
| harmoniser la lumière, vidéo | — | LTX-2.5 Day-To-Night ; LTX-2.3 Relight (extérieurs seulement) | FlowPortal, « Relightful Video Portrait Harmonization » (CVPR 2026) : code public non confirmé [extrait] |
| composer en générant | H3 Références : un personnage (élément) + un lieu, le plan entier refait | LTX-2.5 Ingredients (une planche de référence → un plan) | — |

**Recommandation** : l'incrustation « hyper bien faite » demande trois pièces qui manquent ensemble : le détourage
vidéo (Alpha-Gen), l'alpha au Montage (code), et une harmonisation vidéo (aucune voie générale ouverte et
documentée). En attendant, la voie qui marche est la génération : H3 Références (le personnage dans le lieu, le plan
re-généré), puis Upscale. Revoir quand Cal redonne son lien.

### 2.3 Ming-Image 0.1 Design, Design-Layer, et les deux skills

**Ce que c'est** [lu : README et LICENSE du dépôt inclusionAI/Ming-Image, recette vLLM-Omni, gabarits ComfyUI] :
deux modèles de 6 B d'inclusionAI (Ant Group), MIT. **Design** génère des maquettes d'interface, infographies,
affiches, pages riches en texte, jusqu'à 2048², **en RGBA** (une phrase fixe en tête de l'invite : « RGBA, 4-channel,
transparent background ») ; 12 pas, CFG 1. **Design-Layer** décompose une image plate en N calques RGBA (rendus
après une image composite), 12 pas, CFG 2, d'après une spécification calque par calque. Architecture : une tour de
vision Qwen2.5-VL + un modèle de langue BailingMoeV2 de 20 couches (Ling mini 2.0) → un DiT Z-Image de 30 couches →
le VAE RGBA de Qwen-Image. Mise en ligne le 17/09, annonce le 22/09 [extrait]. Le dépôt recommande de réécrire
l'invite par un VLM (Ling-3.0-flash-VL ou qwen3.8-27B) avec sa consigne publiée (des calques « Figma » en JSON).

**Dans ComfyUI** [lu] : natif depuis `3b4c0b0e` (24/09), étiquettes **≥ v0.38.0** ; gabarits « Text to Image »
(min. 0.37.3, **43,3 Go** : DiT int8 5,75 Go, encodeur Ling mini 2.0 int8 18,17 Go, VAE 0,24 Go, et le réécrivain
Qwen3.8-27B w4a8 16,1 Go par le nœud `TextGenerate`) et « Image Edit » (min. 0.38.0, **26,0 Go**, jusqu'à 8 images de
référence : `TextEncodeMingImageEdit`). **Design-Layer n'est pas dans ComfyUI** (ni nœud ni gabarit, relu le 09/10).
Hors ComfyUI : `infer.py` du dépôt, dépendances **épinglées** torch 2.4.0, transformer-engine 1.11.0 (aucune roue
aarch64 cu130 connue : non documenté sur Spark), « one GPU with at least 80 GiB » validé ; ou vLLM-Omni (vLLM 0.29.0,
CUDA 13.0, essayé sur 2 × H100, « 1×H100 to be validated », une requête et une image de référence à la fois).

**Les skills** [lu, MIT, « Copyright (c) 2026 Ant Group »] :
- **Image-to-Editable-PPT** : une image de diapositive → **une** diapositive PowerPoint : le texte en zones de texte,
  les cadres simples en formes natives, l'illustration en images recadrées ; « needs a strong model » ; la
  décomposition passe par une API au format OpenAI `/images/edits` (**Novita ou OpenRouter par défaut**, clé dans
  un `.env`) ; vérification du PPTX rendu par LibreOffice (`soffice`).
- **Ling UI Design** : une invite ou une capture → une image de référence → décomposition → extraction des éléments →
  code d'interface → vérification dans un navigateur ; Novita par défaut (`ming-image-0.1-design`, `…-layer`).
- Les deux sont faites pour Codex, Claude Code, Cursor (un agent de code), pas pour un agent local de 30 B.

**Apport** : Image (un 4e modèle « design » : affiches, cartons, maquettes, éléments transparents) ; Idéation et le
mode Présentation (des visuels de diapositive ; plus tard, une image de diapositive refaite en objets de la planche
plutôt qu'en PPTX : la même idée que la skill, chez nous) ; l'agent design (`agent_design.md`).

**Protocole d'essai** (sans toucher à la ComfyUI de production) : une **seconde ComfyUI d'essai**, comme H3TEST l'était
(un autre dossier, port 8190, arrêtée après), à la version ≥ 0.38.0 ; les trois fichiers du gabarit « Image Edit »
(≈ 24 Go sans le réécrivain) ; le réécrivain remplacé par notre Ollama (`qwen3-vl-32b-32k` ou `qwen3:30b-a3b`) avec la
consigne publiée (`assets/t2i_rewriter_system_prompt.txt`). Quatre cas : un carton titre de film avec son texte exact,
une affiche, une maquette d'écran, un élément détouré (RGBA). Relever : texte exact (caractère par caractère), alpha
réel, temps, mémoire.

**Recommandation** : **Design : essayer**, dans une ComfyUI d'essai (la mise à jour de la ComfyUI des DGX touche tous
les graphes validés : la faire à part, Cal décide). **Design-Layer et les skills : attendre** (pas de ComfyUI, un
environnement épinglé ancien, des API payantes par défaut) ; en reprendre la méthode dans nos skills (la décomposition
itérative, le schéma de scène, « ne jamais coller l'image source sous le texte »).

### 2.4 Qwen3.8-Flash-Next en NVFP4 : le cerveau de l'agent ?

**Ce que c'est** [extrait, sauf mention] : le modèle ouvert « Flash-Next » d'Alibaba (Qwen), 26/08/2026 (le 28 selon
une source), aperçu de l'architecture de Qwen4 : 125 B en tout, **6 B actifs**, attention hybride (Gated DeltaNet et
« Qwen Sparse Attention »), MoE, une table d'embeddings n-gram de 51 B, une tête MTP de 4 B, une tour de vision ;
262K de contexte (1M par YaRN) ; licence Qwen Community. **La version NVIDIA** (`nvidia/Qwen3.8-Flash-Next-NVFP4`,
fiche du 31/08) : NVIDIA Model Optimizer 0.46.0, experts en NVFP4, licence NVIDIA Open Model **plus** la Qwen
Community License 1.0 ; la fiche vise vLLM sur **B200/B300** (TP8). **124 Go sur disque** [lu : README de la
recette d'un seul Spark, source 12] ; « 63 % plus petit » : cohérent avec ≈ 335 Gio en BF16 (une autre
quantification) [calcul], la fiche de NVIDIA n'a pas été lue. Outils : Toolathlon 73,5 annoncé par Qwen ; aucun BFCL
trouvé.

| moteur | sert-il ce point de contrôle sur un DGX Spark ? |
|---|---|
| vLLM | **oui, sur un seul Spark, avec un correctif** [lu] : vLLM nightly `8a728663`, la table n-gram FP8 de 47,7 Gio laissée sur le NVMe (16 lignes lues par jeton), ≈ 76 Gio de poids résidents, `gpu-memory-utilization 0.80`, ≈ 16 Go laissés libres, chargement ≈ 10,5 min ; **43,9 jetons/s** en médiane (prose 29), 1 027 392 jetons de cache KV |
| SGLang | « runs on RTX PRO 6000, 1x or 2x DGX Spark », avec un correctif de chargement (#38121) [extrait, livre de recettes SGLang] ; 39 jetons/s à deux Spark [extrait] |
| TensorRT-LLM | non documenté (rien trouvé) |
| llama.cpp | des GGUF communautaires ; support du modèle dans llama.cpp **non confirmé** |
| Ollama | aucune étiquette officielle ; `ollama run hf.co/…` dépend du même support llama.cpp : non confirmé |

**Faisabilité** : il prend ≈ 102 Go d'un Spark de 128 Go pendant qu'il sert, et 10 min pour se charger : il ne peut
ni cohabiter avec un rendu H3 (100 Go), ni être déchargé à la fin de chaque tour comme nos travaux le font
(`agent_showrunner.md` § 7.7). À deux Spark (TP2), plus aucun rendu nulle part.

**Recommandation** : **écarter** pour le cerveau de l'agent tant que les DGX rendent aussi ; il ne servirait que sur
une machine qui lui serait dédiée. Pour la décision A1 d'`agent_autonome.md` : `qwen3:30b-a3b` (déjà là) pour le texte
et le routeur ; au banc, deux candidats Ollama récents qui **voient et appellent des outils** [extrait, étiquettes à
confirmer par le diagnostic « Agent Showrunner »] : `qwen3.6:35b-a3b` (≈ 23-24 Go, à experts : un seul modèle pour le
texte et les images) et `qwen3.8:27b` (≈ 18 Go, dense, donc plus lent ; Ollama ≥ 0.32.12). Rien à télécharger avant
le banc d'`agent_autonome.md` § 7.

### 2.5 ComfyUI-MiniMaxH3-Studio

[lu : README, LICENSE, code] Apache-2.0, v1.1.0, dernier commit le 08/10/2026 ; 28 nœuds et une barre latérale : une
demande → un plan → une invite compilée → un rapport de validation (« Guide readiness » contre le guide officiel
d'H3, révision `fa9c8ab…` du dépôt MiniMaxAI/MiniMax-H3) ; les répliques en contraintes dures (langue, qui parle,
voix off : « … while his lips remain completely closed ») ; les vidéos longues (4 à 60 s, **texte → vidéo
seulement**) ; un éditeur de montage **Windows x64 seulement** ; une aide à l'écriture par Ollama (ou des API). Essayé
sur ComfyUI 0.38.0 (nous : 0.37.2).

Ce qu'on en tire, sans l'installer (les règles qu'il attribue au guide officiel, non relu ici) :
- **§ 4.2** : `[Shot 1]` sans temps, puis chaque plan suivant commence par son temps de coupe,
  `[Shot 2] At 00:08.000,` strictement croissant ; pas de coupe ni de mouvement de caméra inventés. Notre Multishot
  écrit « (about N seconds) », case éteinte par défaut (`commun/multishot.js`) : la grammaire officielle est donc
  peut-être trouvée (REPRISE § 2.E, « confirmer la grammaire de H3 ») — un essai A/B la tranchera.
- **§ 4.4** : un identifiant stable avant chaque `<d>` : `(S1)`, et `(S1,S2)` quand deux voix parlent ensemble.

**Recommandation** : **écarter l'installation** (il double `movie.py`, son éditeur ne tourne pas sur nos DGX) ;
**reprendre ces règles** dans `movie.py` et le Multishot (Apache-2.0 : citer la source), après un essai A/B.

### 2.6 Des modèles d'image sans filtre

Le besoin de Cal : la production audiovisuelle professionnelle (horreur, violence de fiction, nudité artistique) que
les services hébergés refusent. Le graphique de Contra Labs (« Creative Intelligence 2026 », Higgsfield × 25) n'a pas
été retrouvé : **non confirmé**.

| option | ce que c'est | licence (celle du modèle de base) | sur nos DGX | verdict |
|---|---|---|---|---|
| `abenzerps/Qwen-Image-2.1-Uncensored-GGUF` | d'après la seule source trouvée : **les poids d'origine de Qwen quantifiés**, aucun filtre retiré ; Q4_K_M 4,6 Go ; pour ComfyUI-GGUF [extrait] | Qwen Research License, **non commerciale** | non | **écarter** |
| Qwen-Image 2.1 + encodeur « sans refus » | un encodeur dont la direction de refus est retirée (refus de 100 % → 5 %, annoncé) [extrait] ; dépôt non identifié | non commerciale | non | écarter (licence) |
| Noct Q | un fine-tune anime de Qwen-Image 2.1 [extrait] | non commerciale | non | écarter |
| **Z-Image Turbo** | 6 B, décrit comme permissif par des sources secondaires [extrait] ; pas de négatif | **Apache-2.0** | **oui**, les deux DGX | **le premier candidat** |
| **Krea 2** Turbo (Raw) | Krea annonce un réglage de sûreté (« targeted fine-tuning ») ; la communauté le dit le plus permissif des modèles ouverts récents [extrait] | Krea 2 Community : commercial **sous 1 M$** de CA ; **§ 4.2 : des filtres de contenu obligatoires** chez qui le déploie ; § 4.1 c : ne pas contourner les sécurités [lu] | **oui** (Turbo ; Raw non) | **le second**, derrière nos filtres |
| Kroma v0.2 | fine-tune complet de Krea 2 [extrait] | celle de Krea 2 | non | attendre |
| Chroma1-HD | 8,9 B sur FLUX.1-schnell, « neutre », sans post-entraînement [extrait] ; « uncensored » non confirmé | Apache-2.0 | non | attendre |
| vidéo : H3 | — | exclut l'UE ; règles d'usage non lues | oui | **écarter** du sans filtre |
| vidéo : LTX-2.5 | — | LTX-2.x : dire que c'est fait par une machine, pas de deepfake sans consentement [lu] | non | plus tard |

ComfyUI-GGUF : inutile chez nous (128 Go ; nos modèles sont en int8 ou bf16).

**Ce qui découle de la licence de Krea 2** : le portail rend déjà Krea 2 sans aucun filtre (carte Générer, Image,
Character Factory). Le § 4.2 [lu] demande des « reasonable and appropriate Content Filter measures » (classifieurs,
revue humaine…) **pour tout déploiement**, pas seulement en mode sans filtre. Le socle légal du § 2.7 y répond.

**Protocole d'essai** (après le socle du § 2.7, sur DGX2) : douze invites d'adultes et de fiction (maquillage et
effets d'horreur, blessure de cinéma, scène de combat, nu académique d'atelier de dessin — **jamais un mineur, jamais
une personne réelle**), Z-Image Turbo puis Krea 2, mêmes graines ; relever : refus, image « assagie », qualité
anatomique, et le verdict de chaque filtre (pour régler les seuils).

**Recommandation** : **rien à télécharger**. L'offre « sans filtre » = Z-Image Turbo (Apache-2.0) et Krea 2, déjà là,
ouverts par le garde-fou ; Qwen-Image 2.1 jamais dans ce mode (licence).

### 2.7 Les garde-fous (obligatoires)

**Le droit** (Légifrance ne répond pas d'ici : textes lus dans des sources secondaires [extrait], **à vérifier**) :
- **Art. 227-23 du Code pénal** : l'image ou la **représentation** pornographique d'un mineur, y compris virtuelle
  (dessin, image générée) ; le dernier alinéa vise aussi « une personne dont l'aspect physique est celui d'un
  mineur », sauf preuve qu'elle avait 18 ans. Cinq ans et 75 000 € pour la fixation ou la diffusion.
- **Art. 226-8-1** (créé par la loi SREN, n° 2024-449 du 21/05/2024) : diffuser sans son consentement un montage ou
  un contenu généré **à caractère sexuel** avec l'image ou la voix d'une personne : 2 ans et 60 000 €, 3 ans et
  75 000 € en ligne. **Art. 226-8** : le même délit hors caractère sexuel (1 an et 15 000 € ; 2 ans et 45 000 € en
  ligne). Ces deux articles visent la diffusion ; pour les mineurs, le 227-23 punit aussi la détention et la
  consultation.
- **AI Act, art. 50(4)** (applicable depuis le 02/08/2026) : un contenu qui ressemble à des personnes réelles
  (« deepfake ») se signale ; pour une œuvre artistique ou de fiction, l'obligation porte sur la forme, pas sur le
  principe.
- Les licences : Krea 2 § 4.2 (filtres), LTX-2.x (5, 7, 19), H3 (territoire).

**L'architecture, par construction** (rien qui « vérifie et relance ») :

1. **Deux étages.** Un **socle légal** pour tous, toujours actif, que personne n'ouvre : contenu sexuel et mineur, ou
   personne réelle identifiable dans un contenu sexuel ou intime → refus. Un **étage « contenu adulte »** (nudité
   explicite) : fermé par défaut, ouvert par Cal. La violence de fiction : à décider (§ 4, V7).
2. **Qui** : une capacité `sans_filtre` posée par Cal **par compte** (comme `access: studio`) ou **par Team** (comme
   l'API payante, « coupée par défaut »), jugée par la garde du calcul (`jobs.submit`, `auth.compute_refusal`) avec une
   action neuve de la matrice (`compute_sans_filtre`, dans `_COMPUTERS` : **jamais un guest**). Refusée par
   construction à un compte d'atelier (`via: "equipe"`, `auth.create_invited`), même si sa Team l'a.
3. **Quelles entrées** : en sans filtre, une image de référence, un élément, un LoRA de moodboard ou une image à
   éditer ne passent que si **toute leur lignée** (`parents`, `origin.tool`) est faite de rendus du portail : aucun
   `upload` (une photo déposée), aucun élément de Character Factory (le portail ne sait pas si un personnage vient
   d'une photo : non documenté côté Character Factory). Un visage réel ne peut donc pas entrer dans le graphe.
4. **L'invite** : avant la file, un classifieur local sur le texte (catégories « exploitation sexuelle d'enfants »
   et « contenu sexuel » de Llama Guard 4, ou Qwen3Guard) et une liste de termes de mineurs en français et en
   anglais ; un nom de personne (repérage d'entités nommées, local) qui n'est pas le titre d'un élément du projet →
   refus, avec la raison.
5. **L'image produite** : avant d'entrer dans la bibliothèque, un détecteur de nudité et un détecteur de
   « mineur apparent » ; si les deux, l'image est **détruite** (jamais rangée, jamais montrée), le travail échoue
   avec sa raison, le compte est suspendu en attendant Cal. Le seuil « mineur » se règle sur des images habillées
   (légales) ; la conjonction est une règle du code.
6. **Le journal** : `<data_dir>/sans_filtre.jsonl` (qui, quand, l'invite, le modèle, la graine, les verdicts,
   l'empreinte sha256 de l'image) ; déclaré dans `STORES` de `tools/check.py`.
7. **Ce qui sort** : marqué `params.sans_filtre`, visible de son auteur, des admins et des comptes qui ont la
   capacité dans ce Workspace — jamais d'un guest ; jamais publié (lien d'écoute, R2) sans un geste de Cal.

**Les classifieurs ouverts qui tournent en local** :

| classifieur | ce qu'il juge | taille | licence | rôle proposé |
|---|---|---|---|---|
| **Llama Guard 4** (Meta) | texte **et images** ; catégories S4 « Child Sexual Exploitation », S12 « Sexual Content » [lu : fiche du modèle] | 12 B | Llama 4 Community (accès sur demande) [extrait] | l'invite ; l'image en second avis |
| **ShieldGemma 2** (Google) | images : « sexually explicit », « violence & gore », « dangerous » ; rien sur les mineurs [extrait] | 4 B | conditions Gemma (à lire) | l'étage adulte, la violence |
| Qwen3Guard-Gen | texte ; « Sexual Content or Sexual Acts », pas de catégorie mineurs [lu : README] | 0,6 / 4 / 8 B | non lue | l'invite (variante) |
| Falconsai/nsfw_image_detection, NudeNet, CompVis safety checker | nudité, image par image ; cités en exemples par la licence de Krea 2 [lu] | petits | NudeNet **AGPL-3.0** [lu] ; les autres non lues | le détecteur de nudité |
| la méthode d'AI Horde (`horde-safety`) | scores CLIP ViT-L/14 de concepts « mineur » croisés avec des concepts « sexuels » [lu] | ≈ 0,4 B | **AGPL-3.0** [lu] | la méthode du « mineur apparent », réécrite ou dans un processus à part |

Ce que les sources disent sans détour [extrait] : **aucun modèle ouvert ne détecte les mineurs de façon fiable** ; la
détection d'abus sur enfants avérée se fait par empreintes, sous accord avec les organismes habilités. Les filtres
ci-dessus réduisent le risque, ils ne le suppriment pas : la règle d'entrée (3) et la conjonction (5) sont ce qui
tient. L'obligation de signalement d'un portail privé (PHAROS) : **non documentée ici**, à voir avec un juriste.

### 2.8 Le workflow H3 « Dialogues.json » : jeu libre → plans dialogués

**La méthode de son auteur** : H3 rend d'abord un plan où le personnage parle librement (du charabia, 544 × 384,
12 s : « plus de liberté donc plus d'expression ») ; ce plan devient la **référence vidéo** des plans suivants,
réduit au quart et flouté (flou gaussien 2), avec la réplique voulue au format officiel `<d>[English] … </d>`,
dénoise 0,97, l'audio du plan comme référence de voix ; une image du personnage possible « mais elle nuit au jeu » ;
rendu final lo-fi. **Le graphe décodé** : `MiniMaxH3ReferenceToVideo` (`ref_video_0` la vidéo réduite et floutée,
`ref_audio_0` son audio, 544 × 544, longueur = durée × 24 calée sur la grille 17k+5) ; UNET
`minimax_h3_hybrid_fl2va_ref2va_b30-49-int8` ; encodeur `qwen3vl_32b_minimax_h3_nvfp4_awq` ; VAE vidéo fp16 et audio
fp32 ; LoRA `minimax_h3_dmd_ref2va_8step_turbo_pruned` à 0,9 ; `BasicScheduler` simple, 10 pas, dénoise 0,97 ; euler ;
`SamplerCustomAdvanced` ; `VHS_LoadVideo`, `ImageScaleBy` 0,25, un flou GLSL. Deux LoRA de morphologie pour adultes
(0,9 et 0) étrangers à la méthode : **retirés** de nos essais.

**Ce qui la fait marcher, lu dans le code du nœud** (`comfy_extras/nodes_minimax_h3.py`, identique sur nos DGX) :
- **Une petite référence reste petite.** Le nœud ramène une vidéo de référence à la toile d'H3 (768 de petit côté)
  seulement si elle est plus grande ; plus petite, il ne l'agrandit pas et l'arrondit à 32 : 544 × 384 réduit au
  quart (136 × 96) devient **128 × 96** [lu, calcul].
- **Elle ne coûte presque rien.** Le VAE réduit par 16 et le DiT découpe en carreaux 1 × 2 × 2 (`patch_size`, lu) :
  un jeton par carré de 32 px et par image latente ; (n − 5) // 17 × 5 + 2 images latentes. Pour un plan de 5,2 s
  (124 images) en 544 × 544 : 10 693 jetons ; la référence au quart, coupée à la longueur du plan (le nœud la coupe) :
  **444 jetons (≈ 4 %)** ; la même non réduite : 7 548 (71 %) ; un plan Brouillon de chez nous (1536 × 640) pris tel
  quel en référence : 35 520 (3,3 fois le plan dialogué lui-même) [calcul]. Ordre de grandeur cohérent avec notre
  relevé du 30/09 (`movie.py`) : 34 812 jetons avec une image et une vidéo de 5,17 s en 864 × 480, contre 17 214 avec
  deux images ; le calcul donne 14 985 pour la vidéo seule.
- **Floutée, elle ne transmet que le jeu.** À 128 × 96 et floue, la bouche, les dents et les détails du visage
  disparaissent : restent la posture, les gestes, les mouvements de tête, le rythme. Qwen3-VL la voit en plus à 2 i/s
  avec ses temps (`FPS // 2`, lu). Les lèvres sont donc libres de suivre les **nouveaux** mots écrits en `<d>` au lieu
  de recopier le charabia [supposition : c'est l'explication qui rend compte des faits ; la doc d'H3 ne décrit pas cet
  usage, et ses guides préviennent que les références ne garantissent pas la synchronisation des lèvres [extrait]].
- **La voix vient de l'audio** : `ref_audio_0` est une référence de son autonome ; notre `compose_ref` la décrit déjà
  ainsi : « timbre, tone and delivery only, never its words ».
- **Le dénoise 0,97 ne fait rien.** `BasicScheduler` calcule `total_steps = int(steps / denoise)` puis garde les
  `steps + 1` derniers sigmas (`nodes_custom_sampler.py`, lu) : `int(10 / 0,97) = 10`, donc **les mêmes sigmas qu'à
  1,0**. Il ne jouerait qu'à partir de 33 pas, ou sous 0,91 à 10 pas [calcul]. Et le latent du nœud est vide (des
  zéros) : ce n'est pas une vidéo → vidéo.
- **Les poids** : l'UNET hybride est une fusion communautaire (base FL2VA, les `adaln_proj` des blocs 30 à 49 pris à
  Ref2VA, sans entraînement ; ≈ 21 Go ; avis partagés) ; le LoRA DMD 8 pas (communautaire, VDN-H3 ; 8 pas,
  force 0,65 à 1,0 conseillées ; ≈ 2,1 Go) [extrait]. Rien des deux n'est sur nos DGX (non relevé).

**Comparé à ce que fait Vidéo** :

| | Dialogues.json | Vidéo, mode Références (aujourd'hui) |
|---|---|---|
| référence vidéo | réduite au quart, floutée : le jeu seul | le fichier tel quel (`LoadVideo`) : rôle mouvement, caméra, action, scène ; coûteux (§ ci-dessus) |
| voix | l'audio du plan de jeu, en `ref_audio` | une référence son (rôle voix) ou la voix d'un élément : déjà là |
| réplique | `<d>[English] … </d>` | `(S1) says: <d>[French] …</d>` écrit par le portail (`speech_to_h3`) : déjà là |
| identité | aucune image (« nuit au jeu ») | l'élément envoie 2 à 5 images (visage, plein pied, planche) |
| poids, échantillonnage | hybride b30-49 + DMD 8 pas à 0,9, 10 pas, euler | Singularity ref2va v1.3 + People + DY + Turbo v4, 8 pas, sampler Turbo |
| toile | 544 × 544, lo-fi | Brouillon 1536 × 640 (deux étages), Qualité 1920 × 800 |

**Proposition : une recette du mode Vidéo « Jeu libre → plans dialogués »** (puis une capacité du registre, § 3) :
1. **Le plan de jeu** : le personnage (un élément) improvise, « speaks expressively in an improvised, unintelligible
   language », sans `<d>` ; 12 s (294 images), une petite toile (544 × 384 comme l'auteur, ou notre Brouillon).
2. **Chaque réplique** : mode Références ; la vidéo du plan de jeu en **rôle « jeu »** (neuf) : le serveur la prépare
   (ffmpeg `scale=iw/4:-2,gblur=sigma=2` — l'équivalence avec le « flou 2 » GLSL n'est pas documentée), le choix du
   début dans le plan de jeu (le nœud coupe à la longueur du plan dialogué), sa bande-son en voix ; la réplique en
   `(S1) says: <d>[…] … </d>` ; l'image du personnage en option (A/B).
3. **L'identité sans image** : à essayer, ancrer une première image du personnage (faite par Image) par
   `MiniMaxH3AddGuide` à l'image 0, à côté de la référence de jeu (les deux nœuds sont dans nos ComfyUI ; non
   documenté pour cet usage).
4. **Agrandir** : Upscale, SeedVR2 3B → 1080p.

**Protocole d'essai** (DGX2, sans téléchargement : nos poids d'abord) :

```sh
ssh dgx2 'cd ~/ComfyUI/input && ffmpeg -y -i jeu_libre.mp4 -vf "scale=trunc(iw/8)*2:-2,gblur=sigma=2" -an -c:v libx264 -crf 12 jeu_libre_q.mp4 && ffmpeg -y -i jeu_libre.mp4 -vn -c:a pcm_s16le jeu_libre_voix.wav'
```

Cinq variantes d'une même réplique, même graine, notre recette (Brouillon) : A sans référence ; B référence non
réduite ; C réduite au quart et floutée ; D = C + l'image du visage de l'élément ; E = C + la première image ancrée par
`MiniMaxH3AddGuide`. Relever : temps, jetons (journal de Sol-Attn), lèvres sur les mots (à l'œil, image par image dans
le banc Comparer), jeu (A/B à l'aveugle par Cal), identité (FaceNet contre l'élément, comme le banc de Character
Factory). Seulement si C gagne : l'hybride b30-49 (≈ 21 Go) et le LoRA DMD (≈ 2,1 Go), avec l'accord de Cal.

**Recommandation** : **essayer** C contre A et B ; faire la recette du mode Vidéo avant une skill de l'agent (la
recette est déterministe et se contrôle ; l'agent la choisira ensuite dans le registre).

## 3. Le catalogue des workflows pour le routeur de l'agent

### 3.1 Le principe (celui d'`agent_autonome.md` § 5.3-5.6)

Le routeur classe la demande dans un **vocabulaire fermé d'intentions** ; le code choisit le workflow dans le
registre (critères comparés aux entrées connues et à la fiche projet) ; un workflow non branché ne peut pas être
choisi, il se dit avec ce qui manque ; rien ne part sans la personne. Ce catalogue en est le contenu, côté veille.

### 3.2 Le catalogue, intention par intention

« Branché » : un travail de la file existe et tourne sur les vrais modèles ; « installable » : documenté, à
télécharger ou à câbler ; « inexistant » : aucune voie locale documentée.

| intention (`agent/intentions.json`) | branché aujourd'hui | installable (avec quoi) | inexistant en local | critères de choix | entrées | sortie |
|---|---|---|---|---|---|---|
| retirer d'une **image** (`vfx.retirer`) | Image, Consigne (« Retirer » + zone), `image.edit` | Krea Raw pour retirer avec Krea (13,1 Go, `image.md` § 9) | — | une zone peinte la borne ; Qwen non commercial | une image, une zone, la consigne | une image |
| retirer d'une **vidéo** (`vfx.retirer`) | — | LTX-2.5 Clean-Plate ; H3 Person-Remover (+ SAM 3.1) ; VOID ; H3 Fun ControlNet inpainting (+ SAM 3.1) | — | tout ce qui bouge → Clean-Plate ; une personne parmi d'autres → Person-Remover ; un objet et ses ombres → VOID ; commercial UE → pas d'H3 | une vidéo (24 i/s, ÷ 32 ; 8k+1 images pour LTX) ; la personne ou l'objet nommé ; la première image nettoyée (H3) | une vidéo |
| remplacer un objet, un personnage (`vfx.remplacer`, proposée) | image : Consigne + références (Qwen, Krea Identity Edit) | vidéo : H3 Fun ControlNet inpainting ; Wan VACE (gabarit 57,8 Go) ; personnage : Character-Swap d'H3 | — | une personne → Character-Swap (hors UE) ; un objet → inpainting avec masque | la source, le masque ou la désignation, le remplaçant en image | image, vidéo |
| changer le décor (`vfx.decor`, proposée) | image : Consigne « Fond » ; Détourer + poser ; vidéo : H3 Références (le personnage dans un lieu, plan re-généré) | vidéo : H3 Fun ControlNet (pose ou profondeur du plan d'origine + nouveau décor) ; Alpha-Gen + composition | garder le plan exact avec un autre fond, harmonisé | garder le jeu exact → ControlNet ; garder les pixels du sujet → détourage | la source, le décor (image, élément lieu, texte) | image, vidéo |
| incrustation (`vfx.incruster`) | image : Détourer (BiRefNet) + Consigne de lumière | vidéo : Alpha-Gen, SAM 3.1 ; l'alpha au Montage (code) | l'harmonisation vidéo générale | § 2.2 | un sujet, un fond | image, vidéo |
| rééclairer (`vfx.reeclairer`, proposée) | image : Consigne « Lumière » (pastilles « Relight the scene… ») | image : Qwen-Image-Edit 2509 Relight ; vidéo : LTX-2.5 Day-To-Night, LTX-2.3 Relight (extérieurs) | rééclairer un intérieur en vidéo | jour → nuit : Day-To-Night ; soleil d'un extérieur : Relight 2.3 | la source, la lumière voulue | image, vidéo |
| prolonger un plan (`video.prolonger`, proposée) | « Continuer le plan » (dernière image → nouveau plan i2v) | H3 : les dernières 22 ou 39 images en guide à l'image 0 (`MiniMaxH3AddGuide` : le mouvement continue, pas seulement la pose) ; LTX-2.5 Retake (refaire une plage) | — | raccord de mouvement → AddGuide ; raccord d'image → Continuer | le plan, la suite voulue | une vidéo |
| image → vidéo (`video.creer`) | H3 `movie.i2v` (première, dernière image) | LTX-2.5 i2v, première et dernière image ; `video_minimax_h3_multiframe_reference` (jusqu'à 4 images ancrées) | — | H3 exclu en UE commercial → LTX | 1 ou 2 images, le texte | une vidéo |
| références → vidéo (`video.creer`) | H3 `movie.r2v` (9 images, 3 vidéos, 3 sons ; éléments) | LTX-2.5 Ingredients (une planche de référence) | — | des personnages (éléments) → H3 | images, éléments, vidéos, sons | une vidéo |
| dialogue joué (`video.dialogue`, proposée) | une réplique `(S1) says: <d>…</d>` en Texte, Images, Références | la recette « jeu libre → plans dialogués » (§ 2.8 : du code) ; changer la réplique d'un plan fait : LTX-2.3 DubIt | — | un jeu naturel → la recette ; une réplique d'un plan existant → DubIt | le personnage, les répliques, la langue | des vidéos |
| agrandir (`media.agrandir`, proposée) | Upscale : SeedVR2 3B/7B, RealESRGAN ×2 ; Image : Agrandir, Affiner | FlashVSR (6,95 Go, `upscale.md` § 7) ; LTX-2.5 Restore, Decompression, Pixel-Spatial-Upscaler | — | fidèle → SeedVR2 ; vite → RealESRGAN ; créatif → Affiner | une image ou une vidéo, la cible | idem |
| storyboard (`storyboard.creer`) | les cartes Générer posées par l'agent (Z-Image, Qwen, Krea, éléments) ; le Multishot | la skill storyboard (`agent_autonome.md` § 9 : du code) ; LTX-2.5 Ingredients pour animer | — | — | un scénario, une séquence | une planche |
| slides, présentation éditable (`slides.creer`) | le mode Présentation, sa passe, PDF, PNG, MP4 | Ming Design pour les visuels (ComfyUI ≥ 0.38) ; image → planche éditable (la méthode de la skill PPT, chez nous) | un export PPTX | — | un brief, des documents | un deck |
| design d'interface (`design.interface`, proposée) | — | Ming Design (maquettes, RGBA) ; Design-Layer (hors ComfyUI) | Ling UI Design en local (API payantes par défaut ; un agent de code) | — | une invite ou une capture | une image, des calques |
| musique (`musique.creer`) | ACE-Step, YuE2, stems, MIDI (registre d'ODIO) | MiniMax Music 3 (≈ 13,4 Go, nœuds dans 0.37.2 ; licence à lire : `musique_generatif.md` § 2.5) | — | le registre d'ODIO | une demande, des paroles | un son |
| transcrire (`media.analyser`) | Transcrire (Whisper, Nemotron ; traduction, carnet) | Parakeet (2,5 Go, REPRISE § 2.D) | — | — | un son, une vidéo | un texte calé |
| objet 3D (`objet3d.creer`) | Object Creator, TRELLIS.2 (`objet.mesh`) | voir `objet_scenes_3d.md` (hors de ce lot) | — | — | une image | un GLB |
| image sans filtre (`image.creer`, garde) | — | Z-Image Turbo, Krea 2 derrière le § 2.7 (du code) | — | la capacité de la personne ; la lignée des entrées | un texte (des entrées de lignée sûre) | une image |

### 3.3 Le format : les fiches de capacité d'`agent_autonome.md`, avec cinq champs de plus

Le format retenu est celui d'`agent_autonome.md` § 5.6 (données JSON, une fiche par capacité dans
`agent/capacites/<id>.json`, l'état **calculé** par le code, jamais écrit). Ce que la veille demande en plus,
facultatif et sans rien casser :

- `licence` : `{nom, lue, source, commercial, territoire}` — `commercial` dit la condition (« < 10 M$ de CA »,
  « non », « < 1 M$ »), `territoire` les exclusions (`["UE", "US", "UK", "KR"]` pour H3) : la politique écarte une
  capacité contre la fiche projet (`commercial_ue`) sans lire la prose.
- `telechargements` : `[{depot, fichier, dossier, go, licence}]` — ce que Cal accepte pour passer d'« installable » à
  « branché » ; la page « ce qu'il faudrait installer » le montre tel quel.
- `etat.exige.comfyui_min` : la version minimale de ComfyUI (« 0.38.0 » pour Ming), lue contre `/system_stats`.
- `memoire` : `{famille, go}` — la famille de `FAMILY_GB` à déclarer (`ltx`, `void`…) et sa mémoire.
- `garde` : `{sans_filtre: true, lignee_sure: true}` — la capacité n'existe que pour qui a `sans_filtre`, et ses
  entrées passent la règle de lignée (§ 2.7).

### 3.4 Quatre fiches, pour montrer le format

```jsonc
{
  "id": "vfx.retirer_personne.ltx", "label": "Retirer les sujets mobiles · LTX-2.5 Clean-Plate",
  "intentions": ["vfx.retirer"], "outil": "movie", "travail": "movie.retoucher", "route": null,
  "entrees": {"video": {"sorte": "video", "requis": true,
                        "contraintes": {"cote_multiple": 32, "images": "8k+1", "fps": 24}}},
  "sortie": {"sorte": "video", "parents": ["video"]},
  "criteres": [{"si": "tout_ce_qui_bouge", "poids": 1, "pourquoi": "il retire tous les sujets mobiles, sans masque"},
               {"si": "une_personne_parmi_plusieurs", "poids": -1, "pourquoi": "il ne choisit pas qui retirer"}],
  "limites": ["un objet immobile reste", "temps sur DGX Spark non mesuré"],
  "etat": {"exige": {"comfy_modeles": ["ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors",
                                       "ltx-2.5-22b-ic-lora-clean-plate-1.0.safetensors"],
                     "noeuds": ["LTXAddVideoICLoRAGuide"],   // supposition : le nœud des gabarits IC-LoRA 2.3
                     "comfyui_min": "0.32.0"}},
  "cout": {"classe": "gpu", "famille": "ltx", "estimation": "durations.json"}, "memoire": {"famille": "ltx", "go": null},
  "consentement": "rendu",
  "licence": {"nom": "LTX-2.x Community License", "lue": true, "commercial": "< 10 M$ de CA", "territoire": [],
              "source": "https://github.com/Lightricks/LTX-2/blob/main/LICENSE-2_x"},
  "telechargements": [{"depot": "Lightricks/LTX-2.5", "fichier": "diffusion_models/ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors", "dossier": "diffusion_models", "go": null, "licence": "LTX-2.x"},
                      {"depot": "Lightricks/LTX-2.5-22b-IC-LoRA-Clean-Plate", "fichier": "ltx-2.5-22b-ic-lora-clean-plate-1.0.safetensors", "dossier": "loras", "go": null, "licence": "LTX-2.x"}],
  "sources": ["https://huggingface.co/Lightricks/LTX-2.5-22b-IC-LoRA-Clean-Plate"],
  "rempli_par": "veille_1009.md", "verifie": "2026-10-09"
}
```

```jsonc
{
  "id": "vfx.retirer_objet.void", "label": "Retirer un objet et ses effets · VOID",
  "intentions": ["vfx.retirer"], "outil": "movie", "travail": "movie.retoucher",
  "entrees": {"video": {"sorte": "video", "requis": true},
              "quoi": {"type": "texte", "requis": true, "question": {"texte": "Quel objet retirer ?"}}},
  "sortie": {"sorte": "video", "parents": ["video"]},
  "criteres": [{"si": "objet_et_ombres", "poids": 1, "pourquoi": "il efface l'objet et ce qu'il cause (ombres, contacts)"}],
  "etat": {"exige": {"noeuds": ["VOIDInpaintConditioning", "SAM3_Detect"],
                     "comfy_modeles": ["void_pass1.safetensors", "void_pass2.safetensors", "sam3.1_multiplex_fp16.safetensors"]}},
  "cout": {"classe": "gpu", "famille": "void"}, "consentement": "rendu",
  "licence": {"nom": "code Apache-2.0 ; poids non lus", "lue": false, "commercial": null, "territoire": []},
  "rempli_par": "veille_1009.md", "verifie": "2026-10-09"
}
```

```jsonc
{
  "id": "video.dialogue.jeu_libre", "label": "Jeu libre → plans dialogués · H3",
  "intentions": ["video.dialogue"], "outil": "movie", "travail": "movie.r2v",
  "entrees": {"personnage": {"sorte": "element", "requis": true},
              "jeu": {"sorte": "video", "requis": false, "prepare_par": "video.dialogue.plan_de_jeu"},
              "repliques": {"type": "texte", "requis": true, "question": {"texte": "Quelles répliques, et dans quelle langue ?"}}},
  "sortie": {"sorte": "video", "parents": ["jeu"]},
  "criteres": [{"si": "commercial_ue", "exclut": true, "pourquoi": "la licence d'H3 exclut l'UE"}],
  "limites": ["méthode communautaire, non mesurée chez nous (veille_1009.md § 2.8)"],
  "etat": {"exige": {"interrupteur": "movie_engine=h3"}},
  "cout": {"classe": "gpu", "famille": "h3"}, "consentement": "rendu",
  "licence": {"nom": "MiniMax H3 Community License", "lue": false, "territoire": ["UE", "US", "UK", "KR"]},
  "rempli_par": "veille_1009.md", "verifie": "2026-10-09"
}
```

```jsonc
{
  "id": "image.sans_filtre.zimage", "label": "Image sans filtre · Z-Image Turbo",
  "intentions": ["image.creer"], "outil": "image", "travail": "image.generate",
  "entrees": {"texte": {"type": "texte", "requis": true}},
  "sortie": {"sorte": "image"},
  "garde": {"sans_filtre": true, "lignee_sure": true},
  "etat": {"exige": {"comfy_modeles": ["z_image_turbo_bf16.safetensors"]}},
  "cout": {"classe": "gpu", "famille": "zimage"}, "consentement": "rendu",
  "licence": {"nom": "Apache-2.0", "lue": true, "commercial": "oui", "territoire": []},
  "rempli_par": "veille_1009.md", "verifie": "2026-10-09"
}
```

`movie.retoucher` n'existe pas : c'est le travail qu'un lot VFX créerait (une sorte, plusieurs graphes) ; la fiche est
« installable » tant que le travail et les modèles manquent — le code le calcule.

### 3.5 Ce que la veille propose au registre

- **Sept intentions de plus** que les vingt d'`agent_autonome.md` : `vfx.remplacer`, `vfx.decor`, `vfx.reeclairer`,
  `video.prolonger`, `video.dialogue`, `media.agrandir`, `design.interface` (ou les ranger dans `image.modifier` et
  `video.creer` : à trancher avec l'auteur du registre, le routeur gagne à des intentions qui se distinguent).
- **La règle « retirer » d'`agent_autonome.md` § 3.3, point 4** : « un objet immobile → l'inpainting LTX avec masque »
  n'existe qu'en LTX-2.3 (In-Outpainting) ; chez nous, **VOID** et **l'inpainting d'H3** (masque SAM 3.1) le font sans
  mise à jour de ComfyUI.
- **Un contrôle** : toute capacité « installable » porte au moins une source et une licence (`lue` vrai ou faux).

## 4. Décisions pour Cal

| | la question | recommandation |
|---|---|---|
| **V1** | retirer une personne d'une vidéo | télécharger **LTX-2.5 distillé (int8 ComfyUI) + Clean-Plate** et l'essayer (§ 2.1) ; puis VOID ou l'inpainting d'H3 pour les objets ; le Person-Remover d'H3 en dernier (licence UE) |
| **V2** | Alpha-Gen (détourage vidéo) | après V1, s'il convainc : il demande en plus le transformeur complet (≈ 44 Go [calcul]) |
| **V3** | la mise à jour de ComfyUI (0.37.2 → ≥ 0.38) pour Ming | **pas sur la ComfyUI de production** : une ComfyUI d'essai à part (port 8190), puis décider |
| **V4** | Ming Design | oui, dans la ComfyUI d'essai, **sans son réécrivain de 16 Go** (notre Ollama avec la consigne publiée) ; ≈ 24 Go |
| **V5** | Design-Layer, les deux skills | attendre ; reprendre leur méthode dans nos skills |
| **V6** | Qwen3.8-Flash-Next NVFP4 pour l'agent | **écarter** (une DGX entière) ; A1 inchangée : `qwen3:30b-a3b` ; au banc : `qwen3.6:35b-a3b` |
| **V7** | le sans filtre | rien à télécharger : Z-Image Turbo et Krea 2 ; défaut proposé : nudité explicite fermée, violence de fiction permise, le socle légal jamais ouvert ; ouvert par Cal compte par compte ou Team par Team |
| **V8** | les filtres de Krea 2 (§ 4.2 de sa licence) | les poser pour **tous** les rendus Krea 2, pas seulement en sans filtre : c'est le socle légal du § 2.7 |
| **V9** | Dialogues.json | la recette du mode Vidéo, essayée d'abord avec nos poids (C contre A et B) ; l'hybride et le LoRA DMD seulement si C gagne |
| **V10** | ComfyUI-MiniMaxH3-Studio | ne pas l'installer ; essayer `[Shot n] At mm:ss.mmm,` et `(S1,S2)` dans le Multishot |
| **V11** | l'alpha au Montage | le garder pour une source qui en a (préalable à toute incrustation au Montage) |
| **V12** | le registre | les fiches d'`agent_autonome.md` § 5.6, plus les cinq champs du § 3.3 et les sept intentions du § 3.5 |

## 5. Annonces non confirmées, sources non lues

- **Non confirmé** : la taille du Person-Remover (222 ou 155 Mo) et sa licence ; le « 63 % » de Qwen3.8-Flash-Next
  (cohérent par calcul, fiche de NVIDIA non lue) et sa date (26 ou 28/08) ; le support de Qwen3.8-Flash-Next dans
  llama.cpp et Ollama ; les étiquettes Ollama `qwen3.6:35b-a3b` et `qwen3.8:27b` (vision, outils) ; que
  `abenzerps/…-Uncensored-GGUF` soit les poids d'origine (une seule source) ; le Krea 2 « permissif » et le Z-Image
  « permissif » (sources secondaires) ; l'encodeur « sans refus » de Qwen 2.1 ; le graphique de Contra Labs ; les
  peines des art. 226-8, 226-8-1 et 227-23 (Légifrance non lu) ; Alpha-Gen sur Spark ; la licence d'IC-Light v2.
- **Non lu** (bloqué depuis le conteneur) : toutes les fiches Hugging Face (Person-Remover, Character-Swap,
  Clean-Plate, Alpha-Gen, Ming-Image, Qwen3.8-Flash-Next NVIDIA, l'UNET hybride, le LoRA DMD, Fun ControlNet Union,
  ShieldGemma 2, Falconsai) ; la règle d'usage de Lightricks (`ltx-acceptable-use-policy.pdf`) et celle de Krea
  (`krea.ai/krea-2-use-policy`) ; la licence et les règles d'usage d'H3 ; les guides de MiniMax (sur DGX1) ;
  docs.ltx.io, docs.nvidia.com, le livre de recettes SGLang ; le lien t.co de Cal sur l'incrustation.

## Fait le 09/10

- L'étude, sans code ni téléchargement. Lus en entier depuis GitHub : le nœud H3 de ComfyUI aux deux versions (celle
  des DGX et la dernière), `BasicScheduler`, le modèle H3 (`patch_size`), les nœuds Ming, les gabarits officiels
  (H3, LTX, VOID, SAM 3.1, Ming, MiniMax Music 3 : modèles, tailles, version minimale), le dépôt LTX-2 (pipelines,
  licence), Ming-Image et ling-cookbook (les deux skills), ComfyUI-MiniMaxH3-Studio, la licence et la sûreté de
  Krea 2, horde-safety, la recette vLLM-Omni de Ming, la recette d'un seul Spark pour Qwen3.8-Flash-Next.
- Trois constats dans notre code : aucune intégration d'LTX ; le Montage jette l'alpha d'une source ; notre
  Multishot écrit la durée des plans autrement que le guide d'H3 cité par H3 Studio.
- Le catalogue aligné sur le registre d'`agent_autonome.md` (branche `wip3/agent-etude`, commit `5b66756`, lu le
  09/10).
- Le même jour, le lot 1 de l'agent (`agent_autonome.md`, « Fait le 09/10 — lot 1 ») a écrit le registre : les fiches
  de LTX-2.5 Clean-Plate, du Person-Remover d'H3, de VOID et de l'inpainting d'H3 sont dans `agent/capacites/`
  (installables : le travail `movie.retoucher` n'existe pas), avec les champs du § 3.3 ; les sept intentions du § 3.5
  attendent la décision V12.

## Sources

**Dans le dépôt** (lu le 09/10) : `server/tools/movie.py`, `server/workflows/h3_recette.json`, `server/tools/image.py`
(`EDIT_TOOLS`), `server/tools/image_atelier.py`, `server/tools/montage.py` (l. 1613-1626, 1700-1840),
`server/tools/ideation_agent.py` (`tools_spec`), `server/core/espaces.py` (`MATRIX`), `server/core/auth.py`
(`create_invited`, `via`), `server/core/library.py` (`ELEMENT_TYPES`, `add_file`), `server/core/jobs.py`
(`register`), `commun/multishot.js`, `commun/multishot_texte.js` ; `docs/REPRISE.md`, `docs/ARCHITECTURE.md` § 9-10,
`docs/etudes/movie.md`, `image.md`, `lora_entrainement.md`, `upscale.md`, `presentations_motion.md`,
`agent_design.md`, `agent_showrunner.md`, `orchestration.md`, `musique_generatif.md` § 2.5 ; `agent_autonome.md`
(branche `wip3/agent-etude`).

**Lus sur GitHub** (clone ou fichier brut, le 09/10) :
1. ComfyUI, `comfy_extras/nodes_minimax_h3.py`, `nodes_custom_sampler.py`, `nodes_ming.py`, `nodes_lt.py`,
   `nodes_sam3.py`, `comfy/ldm/minimax/model.py`, `comfy/supported_models.py`, commit `3b4c0b0e` —
   https://github.com/comfyanonymous/ComfyUI (versions `830232b8` et `08ff3c11`).
2. Comfy-Org/workflow_templates, `templates/index.json` et les gabarits cités — https://github.com/Comfy-Org/workflow_templates
3. Lightricks/LTX-2 : README, `MODELS-LTX-2.3.md`, `LICENSE-2_x`, `packages/ltx-pipelines/docs/pipelines.md`,
   `packages/ltx-pipelines/CLAUDE.md`, `pyproject.toml` — https://github.com/Lightricks/LTX-2
4. inclusionAI/Ming-Image : README, LICENSE, `requirements.txt` — https://github.com/inclusionAI/Ming-Image
5. vLLM-Omni, `recipes/inclusionAI/Ming-Image.md` — https://github.com/vllm-project/vllm-omni
6. inclusionAI/ling-cookbook, `resources/recommended-skills/image-to-editable-ppt` et `ling-ui-design` (README,
   SKILL.md, LICENSE, `image_decomposer.py`, `render_pptx.py`) — https://github.com/inclusionAI/ling-cookbook
7. rookiestar28/ComfyUI-MiniMaxH3-Studio : README, LICENSE, NOTICE, `core/prompt_fidelity.py`,
   `core/reference_role_resolution.py` — https://github.com/rookiestar28/ComfyUI-MiniMaxH3-Studio
8. krea-ai/krea-2 : `docs/safety.md`, `docs/KREA-2-COMMUNITY-LICENSE`, LICENSE — https://github.com/krea-ai/krea-2
9. Haidra-Org/horde-safety : README, LICENSE, `csam_checker.py` — https://github.com/Haidra-Org/horde-safety
10. Netflix/void-model, LICENSE ; facebookresearch/sam3, LICENSE (« SAM License ») ; notAI-tech/NudeNet, LICENSE.
11. meta-llama/PurpleLlama, `Llama-Guard4/12B/MODEL_CARD.md` ; QwenLM/Qwen3Guard, README.
12. tonyd2wild/Qwen3.8-Flash-Next-NVFP4-DGX-Spark, README —
    https://github.com/tonyd2wild/Qwen3.8-Flash-Next-NVFP4-DGX-Spark

**Extraits du moteur de recherche** (pages non ouvertes, le 09/10) :
13. akatz-ai/MiniMax-H3-Person-Remover-LoRA — https://huggingface.co/akatz-ai/MiniMax-H3-Person-Remover-LoRA ;
    Character-Swap : https://comfyui-wiki.com/en/news/2026-09-25-h3-character-swap-lora,
    https://alphasignal.ai/news/akatz-labs-trains-minimax-h3-character-swap-lora-overnight-for-11
14. LTX-2.5 : https://venturebeat.com/technology/ltx-2-5-can-generate-a-10-second-ai-video-from-an-image-in-just-6-8-seconds-on-nvidia-superchips-and-its-open-weights ;
    IC-LoRA 2.5 : https://huggingface.co/Lightricks/LTX-2.5-22b-IC-LoRA-Clean-Plate, `…-Alpha-Gen`, `…-Day-To-Night`,
    `…-Restore`, `…-Decompression`, `…-Colorization`, `…-SDR-To-HDR`, `…-Layout-To-Render`, `…-Ingredients` ;
    Relight 2.3 : https://docs.ltx.io/open-source-model/feature-guides/editing-effects/relight ;
    Alpha-Gen : https://www.creativeainews.com/articles/ltx-alpha-gen-ai-alpha-matte-no-green-screen-2026/
15. MiniMax H3 Fun ControlNet Union : https://docs.comfy.org/tutorials/video/minimax/minimax-h3-fun-controlnet,
    https://comfyui-wiki.com/en/news/2026-09-22-minimax-h3-fun-controlnet-union-2
16. MatAnyone 2 et autres : https://beeble.ai/models/matanyone, https://fudancvl-sam2matting.hf.space/ ;
    harmonisation : https://openaccess.thecvf.com/content/CVPR2026/html/Choi_Relightful_Video_Portrait_Harmonization_CVPR_2026_paper.html,
    https://arxiv.org/pdf/2511.18346
17. Ming-Image : https://comfyui-wiki.com/en/news/2026-09-23-ming-image-design,
    https://rits.shanghai.nyu.edu/ai/ant-ming-image-0-1-design/, https://www.baseten.co/library/ming-image-0-1-design/
18. Qwen3.8-Flash-Next : https://huggingface.co/nvidia/Qwen3.8-Flash-Next-NVFP4,
    https://docs.sglang.io/cookbook/autoregressive/Qwen/Qwen3.8-Flash-Next,
    https://huggingface.co/nota-ai/Qwen3.8-Flash-Next-Nota-NVFP4, https://gigazine.net/gsc_news/en/20260827-qwen3-8-flash-next/,
    https://www.datacamp.com/blog/qwen3-8-flash-next, https://forums.developer.nvidia.com/t/qwen3-8-flash-next-nvfp4-single-spark/381500
19. Ollama : https://computingforgeeks.com/ollama-models-cheat-sheet/, https://www.orcarouter.ai/blog/qwen-3-8-27b-ollama
20. L'UNET hybride : https://huggingface.co/smhfacct/Minimax-H3-fl2va-ref2va-hybrid-models,
    https://comfyui-wiki.com/en/news/2026-08-11-minimax-h3-fl2va-ref2va-hybrid ; le LoRA DMD et Turbo ref2va 8 pas :
    https://comfyui-wiki.com/en/news/2026-09-04-minimax-h3-turbo-ref2v-8step,
    https://comfyui-wiki.com/zh/news/2026-09-10-vdn-h3-turbo-standalone ; les guides H3 sur les répliques :
    https://huggingface.co/MiniMaxAI/MiniMax-H3/discussions/76, https://aireiter.com/blog/minimax-h3-prompt-guide,
    https://www.domoai.app/blog/minimax-h3-reference-to-video
21. Sans filtre : https://pasqualepillitteri.it/fr/news/20765/qwen-image-2-1-uncensored,
    https://hermes-ai.net/news/community-strips-qwen-image-2-1-s-refusals-to-run-locally-on-16gb-laptops/,
    https://note.com/hirorohi03/n/n7f3c37c9c9e6, https://www.cometapi.com/how-to-use-z-image-to-create-nsfw-content/,
    https://huggingface.co/lodestones/Chroma1-HD, https://comfyui-wiki.com/en/news/2026-08-09-kroma-v0-2
22. Licence d'H3 : https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/LICENSE,
    https://www.techtimes.com/articles/322904/20260804/minimax-h3-open-weights-exclude-us-eu-uk-korea-local-deployment.htm
23. Le droit : https://www.justice.gouv.fr/sites/default/files/2024-12/JUSD2434603C.pdf,
    https://kohenavocats.com/repression-penale-deepfake-pornographique-article-226-8-1-code-penal-chambre-criminelle-2022-2026/,
    https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006418093, https://www.cabinetaci.com/la-pedopornographie-et-la-protection-des-mineurs/,
    https://www.mccannfitzgerald.com/knowledge/data-privacy-and-cyber-risk/ai-transparency-european-commissions-guidelines-on-article-50-part-2-deployer-obligations
24. Classifieurs : https://arxiv.org/pdf/2504.01081 (ShieldGemma 2), https://huggingface.co/meta-llama/Llama-Guard-4-12B,
    https://about.iftas.org/library/csam-detection/
