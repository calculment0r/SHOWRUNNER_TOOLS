# L'orchestration des calculs — étude du 29/09/2026

La demande de Cal (29/09), mot pour mot :

> « je me demande si on va pas être obligé d'avoir un petit modèle d'IA
> local pour gérer des choses en fonction des demandes pour gérer la queue
> non ? car on a pas mal de workflows à traiter et à load/unload et en même
> temps il faut gérer que les dgx sont pas plantées... en plus on va devoir
> faire une carto précise de nos outils en fonction de notre parc
> informatique.. on a une station tx avec 3090, on va recevoir un laptop
> Blade avec RTX 5090 et qui aura aussi une 5090 en eGPU avec 21 Go de
> VRAM. on va aussi plug le calcul sur ComfyUI cloud pour pouvoir faire des
> vidéos avec les modèles propriétaires comme Seedance 2.5 ou Kling 4 quand
> il va sortir. donc tout cet aiguillage va être un nœud important dans
> l'orchestration de tout cela. lance un chantier de réflexion par rapport à
> cela car il faut que cet orchestrateur ne prenne pas trop de VRAM pour
> pouvoir laisser de la place aux autres outils en fonction des demandes.
> les dgx seront la base, avec dgx2 comme machine de base toujours dispo.
> mais il faut aussi qu'on puisse utiliser notre interface sans aucun ordi
> allumé pour aller taper l'API de ComfyUI et avoir accès aux modèles image
> et vidéo propriétaires. »

**Statut** : étude seulement. Rien d'installé, rien de lancé, rien de
déployé ; relevés **en lecture seule** sur les deux DGX le 29/09
(`nvidia-smi`, `free`, `vmstat`, `sar`, `systemctl`, `ss`, `journalctl`,
`/proc`, cgroups, `/system_stats` et `/queue` des ComfyUI, `/api/ps`
d'Ollama) ; documentation web lue le 29/09/2026. Chaque affirmation
technique porte sa source (lien, fichier:ligne, mesure) ; « non
documenté » quand elle manque.

## La recommandation, en sept lignes

1. **Pas de modèle d'IA pour gérer la file.** Aucun système de production
   ne le fait (SwarmUI, Ray Serve, Kueue, SkyPilot, Ollama : des règles et
   des mesures) ; la recherche le trouve lent et peu sûr. L'ordonnanceur
   déterministe du portail (`core/jobs.py`) fait déjà ce que font les
   meilleurs. Un LLM peut servir **plus tard, à l'entrée** (comprendre une
   demande, proposer un workflow du catalogue), dans Cloudflare Workers AI
   — jamais sur un DGX, jamais pour la mémoire (§ 1).
2. **Deux arbitres** : l'**aiguillage** (maison ou nuage, personnes,
   quotas, argent) dans un Durable Object Cloudflare, toujours allumé, zéro
   GPU ; l'**arbitre de la maison** (quelle machine, quand, quelle mémoire)
   = `core/jobs.py` sur DGX2, qui **tire** le travail (§ 6).
3. **Le nuage = Comfy Router** : sans abonnement, en crédits (1 $ = 211),
   appelable d'un Worker ; Seedance 2.5 (≈ 1,65 $ les 5 s en 720p), Kling 3
   (0,56 $ les 5 s en 1080p), Veo 3.1, H3. **Kling 4 n'a ni API ni prix au
   29/09** (§ 5).
4. **Ne pas planter les DGX** : mesuré le 29/09, la mémoire CUDA d'un GB10
   échappe **au plafond cgroup et au tueur OOM** — le plafond de 100 Go de
   DGX1 n'a pas empêché l'arrêt du 25/09 sous H3. Donc : une **sentinelle**
   qui lit `nvidia-smi` et tue le plus gros consommateur GPU, le **pilote**
   580.142 → 580.173.02 ou plus (NVIDIA : les pilotes de mai et juillet
   2026 « stop unit from freezing due to being OOM »), et une **prise
   connectée** pour relancer une machine gelée (le Spark n'a pas de
   Wake-on-LAN) (§ 3).
5. **Les autres machines** : l'agent de machine existe déjà — **nirva-agent**
   (Linux et Windows, déjà pair de `VFX_3090`) ; Tailscale pour les joindre ;
   un travail ne part que vers une machine dont l'`/object_info` accepte le
   graphe (§ 4).
6. **L'orchestration prend 0 Go sur les GPU** : le portail et son
   ordonnanceur 40 Mo de RAM sur DGX2 (mesuré), nirva-agent 21 Mo,
   l'aiguillage chez Cloudflare (§ 1.3).
7. **Premier pas utile** : la sentinelle, le pilote et les réglages
   d'Ollama (Cal, sudo) ; puis la voie « nuage » depuis DGX2 ; la porte et
   l'aiguillage Cloudflare ensuite (§ 7).

## Ce que Cal doit décider, acheter, ouvrir

1. **La règle « tout en local »** : l'ouvrir aux modèles propriétaires —
   « local d'abord ; le nuage pour ce qui n'existe pas en local, ou quand
   la maison dort » — et fixer un **budget mensuel** et les quotas des amis
   (zéro par défaut ?) (§ 6.4).
2. **Un compte Comfy.org et des crédits** (Router : pas d'abonnement).
   L'abonnement Comfy Cloud (dès 20 $/mois) seulement pour faire tourner
   **nos** workflows sur leurs GPU quand la maison dort (§ 5.4, 3) ;
   **H3 au nuage** (0,129 $/s en 768p) en repli : oui ou non.
3. **Le pilote NVIDIA** 580.142 → 580.173.02 (dépôt Ubuntu, candidat sur
   DGX2) ou 580.178.04 (candidat sur DGX1) : sudo et redémarrage, une
   machine après l'autre (laquelle d'abord ?) (§ 3.1).
4. **La sentinelle** : quels services a-t-elle le droit de tuer ? ComfyUI
   et H3 sûrement ; Ollama ; sur DGX1, marlin et les services nirva sont
   d'autres projets (§ 3.3).
5. **Ollama** : un modèle à la fois, `keep_alive` court, écoute sur le
   loopback et le câble plutôt que `0.0.0.0` — cela touche les autres
   projets de DGX1 (§ 3.3).
6. **nirva-agent** comme agent de chaque machine (projet Nirvalab), ou un
   agent propre au portail (§ 4.1).
7. **Deux prises connectées** + le réglage BIOS « démarrer au retour du
   courant » sur les DGX (relance à distance d'une machine gelée) ; un
   **câble Ethernet** pour la TX si on veut la réveiller (§ 4.4).
8. **La 5090 de l'eGPU** : la fiche NVIDIA d'une 5090 de bureau dit
   **32 Go**, celle de la 5090 portable **24 Go** ; aucune 5090 à 21 Go
   trouvée — quelle carte exactement (un `nvidia-smi` le dira) ? Et quel
   Blade : le Blade 16 2025 n'a que de l'USB4 (pas de Thunderbolt 5) et
   64 Go de RAM soudés ; le Blade 18 a le Thunderbolt 5 (§ 2.1).
9. **L'assistant de demande** (Workers AI) : plus tard, oui ou non — il
   contredit « Ni Workers AI » de l'étude Cloudflare (§ 1.3).

## 1. Faut-il un petit modèle d'IA pour gérer la file ?

**Non pour décider. Peut-être, plus tard, pour comprendre une demande.**

### 1.1 Ce que font les systèmes qui tournent en production

Aucun ne confie à un modèle de langage le choix de la machine, le
chargement des modèles ou la surveillance — dans toute la documentation
lue ; tous suivent des règles, des mesures et des coûts :

| système | comment il décide | source |
|---|---|---|
| SwarmUI (plusieurs ComfyUI) | backend actif qui a **déjà le modèle** d'abord ; sinon une « pression » par modèle (`nombre × 10 + secondes d'attente`) ; ne recharge que si un seul backend peut le faire ou après 1 500 ms d'attente (contre le va-et-vient) ; `last_used` par défaut ; vide la VRAM après 10 min | [Using More GPUs](https://github.com/mcmonkeyprojects/SwarmUI/blob/master/docs/Using%20More%20GPUs.md), [BackendHandler.cs](https://raw.githubusercontent.com/mcmonkeyprojects/SwarmUI/master/src/Backends/BackendHandler.cs), [Settings.cs](https://raw.githubusercontent.com/mcmonkeyprojects/SwarmUI/master/src/Core/Settings.cs) |
| Ray Serve (multiplexage de modèles) | la requête va au replica qui a **déjà le modèle** ; éviction LRU (`max_num_models_per_replica`) ; « power of two choices » ; santé toutes les 10 s, replica défaillant tué et relancé | [model multiplexing](https://docs.ray.io/en/latest/serve/model-multiplexing.html), [architecture](https://docs.ray.io/en/latest/serve/architecture.html), [fault tolerance](https://docs.ray.io/en/latest/serve/production-guide/fault-tolerance.html) |
| SkyPilot | régions et clouds triés **par prix**, repli sur le suivant en cas d'échec | [auto-failover](https://docs.skypilot.ai/en/latest/examples/auto-failover.html) |
| Kueue (Kubernetes) | admission par **quotas**, priorité puis date ; `BestEffortFIFO` : un gros travail qui ne rentre pas ne bloque pas les petits | [ClusterQueue](https://kueue.sigs.k8s.io/docs/concepts/cluster_queue/) |
| Ollama, llama-swap, LocalAI | garder chaud N minutes, LRU, décharger au délai ; LocalAI : un chien de garde « busy » qui arrête un backend bloqué | [FAQ Ollama](https://docs.ollama.com/faq), [llama-swap](https://github.com/mostlygeek/llama-swap), [LocalAI](https://localai.io/docs/advanced/vram-management/) |
| ComfyDeploy, RunComfy, Comfy Cloud | plafonds de parallélisme, maintien au chaud, file ; au-delà : attente ou 429 | [ComfyDeploy](https://docs.comfydeploy.com/docs/machines/scaling), [RunComfy](https://docs.runcomfy.com/serverless/create-a-deployment), [Comfy Cloud](https://comfy.org/cloud) |
| ComfyUI-Distributed | maître/ouvriers, `load_balance` vers le moins occupé | [dépôt](https://github.com/robertvoy/ComfyUI-Distributed) |

L'ordonnanceur de Cal (`core/jobs.py`) fait déjà ce que font les
meilleurs : affinité avec le modèle chargé (SwarmUI, Ray Serve), équité et
quotas (Kueue), limite aux dépassements (`max_overtake`, l'équivalent du
seuil anti-va-et-vient de SwarmUI), préflight mémoire.

### 1.2 Ce que dit la recherche

- **Ce qui marche, c'est la prévisibilité et la résidence** : Clockwork
  (OSDI 2020) mise sur des durées d'inférence prévisibles et un
  contrôleur central qui décide seul des chargements, et tient 100 ms pour
  99,997 % des requêtes ([Clockwork](https://www.usenix.org/conference/osdi20/presentation/gujarati)) ;
  ServerlessLLM (OSDI 2024) envoie le travail là où le modèle démarre le
  plus vite ([ServerlessLLM](https://www.usenix.org/conference/osdi24/presentation/fu)) —
  c'est la règle « la famille déjà chargée d'abord » de `_group_pick`.
- **Un LLM comme ordonnanceur est lent et peu sûr** : un ordonnanceur ReAct
  (o4-mini, Claude 3.7) met ~700 à ~4 000 s pour placer 100 travaux, les
  auteurs le jugent inadapté au temps réel et lui adjoignent un module qui
  valide chaque action, parce que les LLM « can hallucinate or misinterpret
  numeric limits » ([Jadhav et al., SC'25](https://arxiv.org/abs/2506.02025)) ;
  sur 21 LLM, environ la moitié seulement respecte strictement les
  contraintes, et les auteurs recommandent des « co-pilots », pas des
  solveurs autonomes ([arXiv 2511.11612](https://arxiv.org/abs/2511.11612)).
  Quand Google s'en sert pour Borg, c'est **hors ligne**, pour écrire une
  heuristique lisible qui tourne ensuite seule
  ([AlphaEvolve](https://deepmind.google/blog/alphaevolve-a-gemini-powered-coding-agent-for-designing-advanced-algorithms/)).
- **Les petits modèles tiennent un appel, pas une conversation** : au
  Berkeley Function Calling Leaderboard V4 (12/04/2026), Qwen3-4B réussit
  87,9 % des appels isolés mais 22,1 % en plusieurs tours ; Llama-3.2-3B
  82,7 % et 4,0 % ([BFCL, données](https://gorilla.cs.berkeley.edu/data_overall.csv)).
- **Générer un workflow ComfyUI est fragile** : GPT-4o sans exemple ne
  produit aucun workflow qui tourne sur ComfyBench, un agent spécialisé
  56 % ([ComfyBench, CVPR 2025](https://arxiv.org/html/2409.01392v3)) ;
  nœuds inventés et noms périmés sont les erreurs typiques
  ([FlowBench/ComfyGPT](https://arxiv.org/html/2503.17671v1)).

### 1.3 Donc, pour Cal

| tâche | qui la fait | pourquoi |
|---|---|---|
| la mémoire, `/free`, démarrer/arrêter H3, tuer un processus | **le code** (ordonnanceur + sentinelle) | l'erreur coûte une machine gelée (§ 3.1) ; décision en microsecondes sur des chiffres mesurés |
| l'ordre, l'équité, les quotas, le budget en € | **le code** | règles de Cal, vérifiables par `tools/check.py` |
| expliquer une attente | **le code**, déjà | chaque attente a sa raison exacte (`_auto_message`, `jobs.py:728` : « attend : le studio Character Factory calcule sur DGX1 ») ; un LLM ne ferait que la reformuler |
| comprendre une demande en langage naturel (« fais-moi 3 plans de MJ qui court sous la pluie ») et proposer l'outil, le workflow et les réglages | **un LLM peut aider** — en **choisissant dans le catalogue fermé** des travaux (`jobs.register`), paramètres validés par un schéma, proposition montrée à la personne qui l'envoie | l'échec est une proposition refusée, pas une machine gelée |
| proposer une suite (image → agrandir → vidéo) | idem, proposée, jamais lancée seule | — |

**S'il en faut un, il ne tourne pas sur un DGX** : sur un GB10, « sur le
processeur » n'est pas « sans VRAM » — la mémoire est la même (128 Go
unifiés, [DGX Spark](https://www.nvidia.com/en-us/products/workstations/dgx-spark/)) ;
le modèle de l'étage Identité prend 30,8 Go (§ 2.2). La place logique est
**Cloudflare Workers AI**, là où vit l'aiguillage : il marche machines
éteintes, 10 000 « neurons » gratuits par jour
([prix](https://developers.cloudflare.com/workers-ai/platform/pricing/)),
des modèles avec appel d'outils (`@cf/zai-org/glm-4.7-flash`,
`@cf/qwen/qwen3-30b-a3b-fp8`, `@cf/openai/gpt-oss-20b`,
`@cf/ibm-granite/granite-4.0-h-micro`). Pour ~200 demandes par jour
(1 500 jetons en entrée, 300 en sortie — hypothèse), tous tiennent dans la
gratuité (≈ 1 000 à 7 000 neurons/jour, calcul de la recherche d'après la
grille). Latence : non publiée pour ces modèles. Le mode JSON « n'est pas
garanti » ([JSON mode](https://developers.cloudflare.com/workers-ai/features/json-mode/)) :
le Worker valide la sortie et refuse ce qui ne passe pas. **Cela contredit
la règle « Ni Workers AI, ni modèle hébergé »** (`docs/etudes/cloudflare.md`
§ 6.2) : décision de Cal, et pas avant que le reste marche (§ 7, étape 7).

**Ce que prend l'orchestration** : zéro sur les GPU. Mesuré sur DGX2 : le
portail (ordonnanceur compris) 40 Mo de RSS, nirva-agent 21 Mo, le relais
21 Mo — de la mémoire du processeur, sans rien sur le GPU. Dans
Cloudflare : rien chez Cal.

## 2. La carte du parc

### 2.1 Les machines

| | DGX1 | DGX2 | TX | Blade (arrive) | eGPU du Blade | Comfy (nuage) |
|---|---|---|---|---|---|---|
| calcul | GB10 (Blackwell, 6 144 cœurs CUDA ; FP4) | idem | RTX 3090 (Ampere, sm_86 : **pas de FP8**, poids fp8 remontés en bf16) | RTX 5090 Laptop (FP8, NVFP4) | RTX 5090 ? | RTX 6000 Pro 96 Go (Cloud API) ; sans objet pour le Router |
| mémoire pour les modèles | **128 Go unifiés** (121,7 Gio vus par Linux), 273 Go/s ; ComfyUI plafonné à 100 Gio | 128 Go unifiés, sans plafond | **24 Go** GDDR6X + RAM du PC (non relevée) | **24 Go** GDDR7 (fiche NVIDIA) + RAM : 64 Go soudés (Blade 16 2025) à 128 Go (Blade 18 2026) | **32 Go** si 5090 de bureau (fiche) ; « 21 Go » selon Cal : à confirmer | — |
| système | Ubuntu 24.04 aarch64, pilote 580.142, DGX OS 7.2.3 | idem | Windows (tailnet) | Windows | Razer Core X V2 : « Windows 10 RS5 / Windows 11 » seulement | — |
| lien | Wi-Fi 2,4 GHz (lent) + câble 200 Gb | Wi-Fi 5 GHz + câble | Tailscale | Tailscale ; USB4 (Blade 16 2025) ou Thunderbolt 5 (Blade 18) | TB5 : 5,6 Go/s mesuré vers la carte (autre boîtier) | internet |
| réveil à distance | **pas de Wake-on-LAN** (NVIDIA) : prise connectée + démarrage au retour du courant | toujours allumée (même parade en cas de gel) | WoL par Ethernet, envoyé depuis DGX2 | non (on ne compte pas sur lui) | — | toujours là |
| rôle proposé | studio Character Factory, autres projets de Cal, 2ᵉ machine H3 | **base** : portail, arbitre de la maison, H3 | appoint image, upscale, musique | appoint mobile | appoint (un ComfyUI par carte) | propriétaires ; repli quand la maison dort |

Sources : relevés du 29/09 (`nvidia-smi`, `/proc/meminfo`, `apt-cache
policy`, `/etc/dgx-release`, `tailscale status`) ;
[fiche DGX Spark](https://docs.nvidia.com/dgx/dgx-spark/hardware.html) ;
[RTX 5090](https://www.nvidia.com/en-us/geforce/graphics-cards/50-series/rtx-5090/) (32 Go, 575 W) ;
[portables RTX 50](https://www.nvidia.com/en-us/geforce/laptops/compare/) (5090 Laptop : 24 Go, 95–150 W) ;
[RTX 3090](https://www.nvidia.com/en-us/geforce/graphics-cards/30-series/rtx-3090-3090ti/) ;
[FP8 : capacité 8.9 et plus](https://github.com/NVIDIA/TransformerEngine), [comfy-kitchen](https://github.com/Comfy-Org/comfy-kitchen) ;
[Blade 16 2025](https://www.razer.com/gaming-laptops/razer-blade-16-2025), [Blade 18](https://www.razer.com/gaming-laptops/razer-blade-18) ;
[Core X V2](https://www.razer.com/gaming-egpus/razer-core-x-v2) ;
Thunderbolt 5 contre OCuLink ([Tom's Hardware](https://www.tomshardware.com/pc-components/gpus/oculink-outpaces-thunderbolt-5-in-nvidia-rtx-5070-ti-tests-latter-up-to-14-percent-slower-on-average-in-gaming-benchmarks), extrait de recherche) ;
[pas de Wake-on-LAN sur Spark](https://forums.developer.nvidia.com/t/cant-get-wake-on-lan-to-work/348168)
(NVIDIA, 18/10/2025 : « confirmed Spark does not support wake-on-lan »).
La seule « 21 Go » rencontrée dans ce domaine est un fichier : le H3
élagué `minimax_h3_*_pruned_int8_convrot` (21,0 Go, présent sur DGX2).

### 2.2 Chaque outil : poids, mémoire, temps mesurés

Poids : la somme des fichiers que charge le graphe du portail ou de
Character Factory, tailles relevées sur DGX2 (`~/ComfyUI/models`, 29/09).
Temps : **mesurés** dans les journaux ComfyUI des deux DGX (« Prompt
executed in », regroupés par les modèles chargés juste avant ; DGX2
depuis le 20/09, DGX1 depuis le 15/09) — « à froid » = chargement compris.

| outil · workflow | poids chargés | mémoire à prévoir | temps mesuré (GB10) |
|---|---|---|---|
| Image · **Z-Image Turbo** | 12,3 (DiT bf16) + 8,0 (Qwen3 4B) + 0,3 = **20,6 Go** | `FAMILY_GB` 24 (estimé) | 17,9 s à froid, n=10 (DGX2) |
| Image, visage, plein pied, expressions · **Krea 2 Turbo** (+ UltraReal, Identity Edit) | bf16 : 26,3 + 5,2 (Qwen3-VL 4B fp8) + 0,3 = **31,8 Go** ; en fp8 (13,1 Go, présent) : 18,6 Go | 36 (estimé) | 58 s à froid n=17 ; 32 s modèle seul rechargé n=64 (DGX2) ; 31 s n=2 (DGX1) |
| A-pose, vues, édition · **Qwen-Image 2.1** turbo INT8 (+ LoRA Viggle) | 7,3 + 9,4 (Qwen3-VL 8B int8) + 0,7 = **17,4 Go** ; en bf16 : 14,2 + 17,5 | 34 (estimé) | 55 s à froid n=152 (DGX2), 58 s n=69 (DGX1) ; « 40 à 65 s l'image » en 1344×1792 (`Character_Factory/docs/ETUDES.md` l. 42) |
| Vidéo · **H3** fl2va / ref2va INT8 | 34,0 + 27,1 (Qwen3-VL 32B int8) + 5,2 + 0,6 = **66,9 Go** ; « pruned » int8 : 21,0 → 53,9 Go ; encodeur nvfp4 : 15,7 Go | **100** (`FAMILY_GB`, relevé sur DGX2 : « 50 Go sur le GPU et 53 Go de RAM pour son encodeur », `factory/memory.py:87-88`) ; 45 libres (`h3_min_free_gb`) | 161–198 s par rendu enchaîné (DGX2, 24/09) ; 582 s médiane à froid, n=16 (`comfyui-h3test` DGX1) ; 300–1024 s selon toile et pas (`docs/etudes/movie.md` § 5) |
| Upscale · **SeedVR2** 7B / 3B INT8 | 8,3 / 3,5 + 0,5 (VAE) | loi de ComfyUI : ≈ 8,5 + 2,2 + 0,55 Gio par Mpx·image latente ; 13 Go (portrait ×2) à 131 Go (plan H3 en 4K, découpé en morceaux) (`docs/etudes/upscale.md` § 5) | 10 s image, n=6 (DGX2) ; vidéo non mesurée |
| Musique · **YuE2** 3B | bf16 7,8 / int8 4,0 + SheetSage2 1,4 | « 24 GB VRAM » (README YuE2, `docs/etudes/yue.md` § 5) | 30 s de chanson en 20–40 s (ComfyUI, DGX2) ; 60 s en 163 s (dépôt autonome, DGX1) |
| Musique · **ACE-Step 1.5 XL** | 10,0 + 1,2 + 8,4 + 0,3 = **19,9 Go** | non mesuré | 29 s à froid, n=1 (DGX2) |
| Séparation · htdemucs_ft, BS-RoFormer | 0,34 Go ; 0,64 Go | petit (non documenté) | 8 s pour 30 s (htdemucs_ft, DGX2, `docs/etudes/stems.md`) |
| Objet · **TRELLIS.2** INT8 (+ DINOv3, BiRefNet) | 5,3 + 1,1 + … | 40 (estimé) | 176 s médiane à froid, n=11 (DGX1) ; 185–242 s (DGX2) |
| Rig · **UniRig** | venv à part (`remote_unirig: local`) | 20 (estimé) | non relevé ici |
| Rig, contrôle · SAM 3D Body | — | 20 (estimé) | 1,6 s, n=135 (DGX2) |
| Détourage · BiRefNet | — | 4 | 1,4 s, n=30 (DGX2) |
| Identité · **qwen3-vl-32b-32k** (Ollama) | GGUF Q4_K_M 20,9 Go | **30,8 Go** chargé avec 32k de contexte (mesuré, `/api/ps`, DGX1 29/09) | conversation |
| Movie Analysis · chaîne complète | whisper, SAM 3, `mistral-vlm-16k` (15,2 Go)… | plafond de 64 Go posé, « pas mesuré » (`docs/etudes/analyse.md` § 2) | lourd, une à la fois |
| (FLUX.2 dev, présent, hors portail) | 35,5 + 35,6 | 75 | 162 s à froid, n=2 |
| Montage · export | ffmpeg, processeur | — | — |
| **Seedance, Kling, Veo…** | propriétaires | — | nuage seulement (§ 5) |

### 2.3 Où chaque outil peut tourner, où il doit tourner

| outil | DGX (128 unifiés) | 24 Go (3090, 5090 portable) | 32 Go (5090 de bureau) | Comfy (nuage) | **doit tourner** |
|---|---|---|---|---|---|
| Z-Image Turbo | oui | oui : « fits within 16GB VRAM consumer devices » ([doc Comfy](https://docs.comfy.org/tutorials/image/z-image/z-image-turbo)) | oui | via la Cloud API (non vérifié) | partout : le meilleur candidat pour les PC |
| Krea 2 Turbo | oui | en fp8 : tourne sur une 3090 Ti 24 Go (tiers, [smeltcore](https://smeltcore.com/recipes/krea-2-rtx-3090-ti/)) ; nos LoRA à copier | oui | partner node Krea 2, **sans nos LoRA** | DGX (visages, Identity Edit, UltraReal : décision de Cal du 28/09) ; PC en appoint |
| Qwen-Image 2.1 INT8 | oui | 17,4 Go de poids : devrait tenir, non mesuré ; INT8 ConvRot sur Ampere : non documenté | oui | — | DGX (A-pose, vues) |
| **H3** | **oui, et seulement là** | non (67 Go de poids ; fiche MiniMax : exemples sur 4 GPU) | non recommandé : sur une 5090, ~31,8 Go de VRAM et **71 à 93 Gio de RAM** (mesure tierce, [wan2-7.io](https://wan2-7.io/blog/minimax-h3-local-requirements/)) | partner node H3 (0,129 $/s en 768p) | DGX2, puis DGX1 ; le nuage en repli |
| SeedVR2 | oui | image oui ; « 12–16 Go en FP8 avec BlockSwap » ([numz](https://github.com/numz/ComfyUI-SeedVR2_VideoUpscaler)) | oui | — | vidéo longue : DGX ; image : partout |
| YuE2 | oui | oui : « 24GB NVIDIA GPU », pic 11–14 Gio sur 4090 ; **Linux** seulement annoncé ([fiche](https://huggingface.co/m-a-p/YuE2-3B)) | Linux ? | — | DGX |
| ACE-Step 1.5 XL | oui | 19,9 Go de poids : non documenté | probable | — | DGX |
| Séparation | oui | oui (Demucs ≥ 3 Go, [dépôt archivé](https://github.com/facebookresearch/demucs)) | oui | — | partout |
| TRELLIS.2 | oui | « au moins 24 Go », testé A100/H100, code officiel « tested only on Linux » ([Microsoft](https://github.com/microsoft/TRELLIS.2)) ; nœuds ComfyUI natifs depuis le 31/08 ([blog](https://blog.comfy.org/p/trellis2-and-pixal3d-are-now-native)) | à essayer | — | DGX |
| UniRig | oui | ≥ 8 Go, mais `spconv` sans version CUDA 12.8/13 : pas sur une 5090 en l'état ([UniRig](https://github.com/VAST-AI-Research/UniRig)) | non | — | DGX |
| LLM de l'étage Identité | DGX1 (studio) | — | — | — | DGX1 |
| Movie Analysis | DGX2 (les films sont là) | — | — | — | DGX2 |
| Seedance, Kling, Veo | — | — | — | Router | nuage |

Conséquence : **les PC ne soulagent que les petits travaux** (Z-Image,
Krea 2 en fp8, upscale d'image, séparation) ; H3, TRELLIS.2, UniRig et
YuE2 restent sur les DGX. Le gain des PC, c'est de laisser les DGX à H3
pendant qu'une rafale d'images part ailleurs.

## 3. Ne pas planter les DGX

### 3.1 Ce qui a déjà gelé (relevé des journaux, 29/09, lecture seule)

| quand | machine | ce qui tournait | ce que disent les journaux |
|---|---|---|---|
| 04/08 17:47 et 05/08 17:55 | DGX1 | ComfyUI :8188 | cités par le commentaire de `/etc/systemd/system/comfyui.service.d/10-memory-cap.conf` (DGX1) : « aucun oom-kill dans les logs, boot interrompu sans arrêt propre » ; le plafond est posé le 05/08 à 18:32 (date du fichier) |
| 24/09 15:44 → 16:29 | DGX2 | **H3** enchaîné cinq fois dans `comfyui.service` :8188 de 15:44 à 16:02:55 (PID 1045628), **resté chargé** ensuite ; puis un second `python` lancé à côté (PID 1069214, non identifié dans le journal) | `sar -r` : mémoire utilisée 93,8 % à 15:50, **98,3 % à 16:10 et 16:21, MemAvailable 0** ; `sar -S` : swap 94 % ; relevés de 10 min en retard (16:10:20, 16:21:09) = machine qui rame ; OOM global à 16:13 et 16:29 : le noyau tue **pipewire, pipewire-pulse, dbus-daemon** (quelques Mo chacun) — les deux `python` n'ont que ~30 Mo de RSS ; journal coupé à 16:29:46, redémarrage à 16:30:24 **sans arrêt** (`last -x`). Même lecture dans `analyse/chaine/gpu-libre.sh:7` : « deux grosses tâches GPU en même temps ont déjà gelé dgx2 (24/09) » |
| 24/09 16:53 → 17:06 | DGX1 | **H3** dans `comfyui-h3test` :8189 (sans plafond ; pic 54,8 Go relevé par systemd à l'arrêt de 16:58) ; la diarisation NeMo à côté | `NVRM: … Out of memory [NV_ERR_NO_MEMORY]` à 16:53:31 ; `sar` à 16:50 : **MemFree 6,4 Go, cache 90 Go, MemAvailable 99 Go** ; journal coupé à 17:06:50, redémarrage le 25/09 09:48 sans arrêt |
| 25/09 10:14 | DGX1 | **H3** dans `comfyui.service` :8188 — **celui qui porte le plafond de 100 Go** ; un rendu fini à 10:13:57, le suivant reçu à 10:14:00 | journal coupé à 10:14:57, redémarrage à 10:28:34 sans arrêt ; cause non établie (aucune ligne OOM) |
| 11/09 16:19 | DGX2 | non relevé | trace de pile du noyau (`__sync_rcu_exp_select_node_cpus`) puis redémarrage à 16:24 ; cause non établie |

Ce qu'on en tire, des chiffres :

- **Le tueur OOM du noyau ne voit pas la mémoire GPU** : il choisit sa
  victime sur la RSS, et la mémoire allouée par CUDA n'y est pas (les
  `python` de ComfyUI à ~30 Mo de RSS le 24/09 sur DGX2). Il tue des
  processus minuscules, n'y gagne rien, la machine gèle. C'est ce
  qu'écrivait déjà `Character_Factory/factory/memory.py` (l. 3-5).
- **MemAvailable ment dans les deux sens sur un GB10** : le 24/09 sur DGX1,
  le pilote NVIDIA refuse une allocation alors que `MemAvailable` annonce
  99 Go — 90 Go étaient du cache de fichiers (les poids lus), que le
  pilote n'a pas pu récupérer à temps (indice, pas une preuve : relevés à
  10 min). NVIDIA écrit que `cudaMemGetInfo` ne compte pas la mémoire que
  le système pourrait récupérer, et donne pour contournement
  `sync; echo 3 > /proc/sys/vm/drop_caches`
  ([known issues](https://docs.nvidia.com/dgx/dgx-spark/known-issues.html),
  [porting guide](https://docs.nvidia.com/dgx/dgx-spark-porting-guide/optimization.html)).
  Or le préflight du portail lit `ram_free` de `/system_stats`, qui est
  `psutil.virtual_memory().available` (ComfyUI `comfy/system_memory.py:122`,
  `virtual_memory_available`) : cache compris.
- **Un plafond cgroup sur `comfyui.service` n'a pas suffi** : DGX1 le porte
  depuis le 05/08 (`MemoryHigh=92G`, `MemoryMax=100G`, `MemorySwapMax=0`)
  et s'est pourtant arrêté net le 25/09 pendant un rendu H3 dans ce service.
  Et le 24/09, H3 tournait dans l'autre instance, `comfyui-h3test`, qui n'a
  **aucun plafond, sur aucune des deux machines** (`systemctl show`).
- **Pourquoi, mesuré le 29/09 sur DGX1** (lecture seule, rien lancé) : la
  mémoire allouée par CUDA sur un GB10 n'est **pas comptée dans la
  cgroup**. Ollama tenait `qwen3-vl-32b-32k` sur le GPU :

  | processus | GPU (`nvidia-smi --query-compute-apps`) | RSS | sa cgroup (`memory.current`) |
  |---|---|---|---|
  | `ollama` runner | **29 136 Mio** | 1,06 Go | `ollama.service` : 20 Go, dont **19,8 Go de cache de fichier** (le GGUF lu), 0,9 Go anonyme |
  | ComfyUI :8188 | **29 255 Mio** | 3,3 Go | `comfyui.service` : 19 Go, dont 17,5 Go de cache de fichier, 2,4 Go anonyme ; `memory.events` : `max 0`, `oom_kill 0` |
  | marlin | 7 439 Mio | — | — |

  Le plafond de 100 Go de DGX1 ne voit donc que le cache des poids et la
  mémoire du processus, **jamais ce qui est sur le GPU** — ni le tueur OOM
  du noyau (qui juge la RSS). Le commentaire du plafond (« Avec ce cap : le
  kernel tue python. La machine survit ») est faux pour la mémoire GPU.
  Les pics de 76–81 Go relevés par systemd (ci-dessous) sont du cache de
  fichiers et de la mémoire épinglée, pas la mémoire GPU.
- **Mais `nvidia-smi` voit la mémoire GPU de chaque processus** sur un GB10
  (la ligne de total dit « Not Supported », la table des processus non) :
  c'est **le** chiffre sur lequel un garde-fou peut agir.
- **H3 est dans les trois gels datés de septembre**, chaque fois avec
  autre chose à côté ou en enchaînant les rendus. Pics de la cgroup
  relevés par systemd à l'arrêt du service (cache de fichiers et mémoire
  du processus, **sans** la mémoire GPU — ci-dessus) : 54,8, 76,0 et 78,0 Go (`comfyui-h3test`, DGX1, 24, 20 et
  19/09) ; 80,8 Go (`comfyui.service` DGX2, séance du 25/09 : H3 puis
  FLUX.2). Sans H3, une longue séance TRELLIS.2 + Qwen (DGX2, 27-28/09)
  est montée à 76,0 Go : **les familles s'empilent** quand on ne vide pas
  entre deux.
- Deux seuils pour la même question dans le portail : `h3_min_free_gb`
  = 45 Go (`server/tools/movie.py:910`, repris du banc H3) et
  `FAMILY_GB["h3"]` = 100 Go (`factory/memory.py:89`, lu par
  `core/machines.py`). Le seul relevé à l'échelle de la machine (50 Go sur
  le GPU + 53 Go de RAM, `factory/memory.py:87-88`) et les 66,9 Go de
  poids du graphe (§ 2.2) disent que **45 est trop bas**.
- **Ce n'est pas propre à Cal.** NVIDIA, 28/01/2026 : « This is a known
  issue which we are actively working to fix » ; 11/08/2026 : « Driver
  updates released in May and July have mechanisms to stop unit from
  freezing due to being OOM by stopping processes that take too much
  memory » ([forum NVIDIA](https://forums.developer.nvidia.com/t/spark-hangs-requires-a-hard-reset-physically-unplugging/358951)).
  **Les deux DGX sont en 580.142** (« Tue Mar 3 », `/proc/driver/nvidia/version`),
  antérieur ; `apt-cache policy` propose 580.173.02 (DGX2) et 580.178.04
  (DGX1). Des gels sont encore signalés après (fil ci-dessus, en 580.173.02 ;
  [open-gpu-kernel-modules #1358](https://github.com/NVIDIA/open-gpu-kernel-modules/issues/1358) :
  `NV_ERR_NO_MEMORY` avec 10 à 12 Gio libres).
- **La même configuration que Cal a gelé sans manque de mémoire** :
  [ComfyUI #16587](https://github.com/Comfy-Org/ComfyUI/issues/16587)
  (26/09/2026) — GB10, pilote **580.142**, noyau **6.17.0-1014-nvidia**,
  H3 FL2VA `pruned_int8_convrot`, `--reserve-vram 16` : machine perdue avec
  ~44,5 Gio disponibles, PSI et compteurs OOM à zéro, sans réponse des
  mainteneurs. Et un gel « RCU stall » sous charge soutenue est signalé
  ([forum](https://forums.developer.nvidia.com/t/dgx-spark-gb10-hard-freeze-under-sustained-load-rcu-stall-on-cpu-11-watchdog-kdump-both-fail-working-pstore-only-crash-capture-recipe-eviden/381655)) —
  à rapprocher du 11/09 sur DGX2. **Aucun garde-fou mémoire ne couvre
  ces gels-là** : il faut aussi pouvoir relancer une machine à distance
  (§ 3.3, 6).
- **Mesures de la communauté qui recoupent la nôtre** : ~71 776 Mio
  alloués par CUDA pour ~3 762 Mio dans `memory.current` sous
  `MemoryMax=108G` ([evanwtf/local-llm #456](https://github.com/evanwtf/local-llm/issues/456),
  17/09/2026) ; `systemd-run -p MemoryMax=100G -p MemorySwapMax=0` qui
  n'empêche pas le gel ([forum NVIDIA](https://forums.developer.nvidia.com/t/dgx-spark-becomes-unresponsive-zombie-instead-of-throwing-cuda-oom/353752)).
  NVIDIA n'a rien écrit sur les cgroups.

### 3.2 Ce qui est en place aujourd'hui (relevé du 29/09)

| | DGX1 | DGX2 |
|---|---|---|
| `comfyui.service` (:8188) | `MemoryHigh=92G`, `MemoryMax=100G`, `MemorySwapMax=0`, `--reserve-vram 12` ; `Restart=on-failure` | **aucun plafond** ; ni `--reserve-vram` ; `Restart=on-failure` |
| `comfyui-h3test.service` (:8189, H3) | **aucun plafond** ; `--reserve-vram 12` | **aucun plafond** ; `--reserve-vram 12` |
| `ollama.service` | aucun plafond, `OLLAMA_HOST=0.0.0.0:11434`, rien d'autre (garde un modèle 5 min par défaut, jusqu'à 3 modèles : [FAQ Ollama](https://docs.ollama.com/faq)) ; modèles sur disque jusqu'à **65,4 Go** (`gpt-oss:120b`) et 47,4 Go (`qwen2.5:72b`) | idem ; jusqu'à **49,9 Go** (`hermes-3-70b`) |
| tueur en espace utilisateur | `systemd-oomd` inactif, `earlyoom` absent | `systemd-oomd` non installé, `earlyoom` absent |
| swap | fichier de 16 Go (2,4 Go pris) | fichier de 16 Go (6,1 Go pris) |
| `vm.min_free_kbytes` | — | 45 167 (44 Mo) |
| ce qui tourne à côté | marlin (7,4 Go sur le GPU), NeMo reelbench (1,1 Go), nirva-agent, nirva-sandbox, nirva-upscale (qui envoie aussi sur :8188), nirva-visio, audiolab, le studio Character Factory | le portail (40 Mo de RSS), le relais du studio, nirva-agent, 10 portails d'essai des agents (8781–8797) et deux faux ComfyUI (8771, 8772) |
| `/proc/pressure/memory` (PSI) | présent | présent (0,00 au relevé) |
| `nvidia-smi` | mémoire « Not Supported » (GB10) | idem |
| au repos, files ComfyUI vides (29/09 ~09:50) | **75 Go utilisés, 2,7 Go vraiment libres** (MemFree), 45 Go de cache ; Ollama garde `qwen3-vl-32b-32k` : **30,8 Go** (`/api/ps`, contexte 32k), jusqu'à 5 min après la dernière question | 14 Go vraiment libres, **98,5 Go de cache** (`vmstat`), MemAvailable 108 Go |

Au repos, un GB10 n'a presque pas de mémoire *vraiment* libre : le cache
des poids lus remplit le reste. ComfyUI lui-même libère son cache de
résultats quand `MemAvailable` passe sous 10 Go (`execution.py:745-811`,
`--cache-ram`), donc en comptant ce cache comme disponible.

La mémoire que ComfyUI annonce : `ram_total` et `ram_free` de
`/system_stats` sont bornés par la cgroup quand il y en a une
(`comfy/system_memory.py:117-130`, ComfyUI 830232b8) : DGX1 annonce
100 Gio au lieu de 121,7, et « libre » = le plus petit de `MemAvailable` et
de ce qui reste sous le plafond. Le commentaire de `core/machines.py:162`
(« `ram_free` … vaut pour toute la machine ») n'est vrai que sans plafond.

### 3.3 Les garde-fous au niveau du système (à poser par Cal : sudo)

Principe, tiré des mesures du § 3.1 : sur un GB10, **ni le tueur OOM du
noyau, ni un plafond cgroup (`MemoryMax`), ni `systemd-oomd`** (qui juge
les cgroups) ne voient la mémoire allouée par CUDA. Un plafond de service
reste utile pour ce qu'il voit (le cache des poids, la mémoire épinglée,
le swap), mais **le seul filet qui voit le GPU est un programme qui lit
`nvidia-smi`**. D'où, dans cet ordre :

1. **La sentinelle** : un petit service par DGX (bibliothèque standard,
   `OOMScoreAdjust=-1000`, `Nice=-5`, `MemoryMin` pour ne jamais être
   privé de mémoire), qui chaque seconde lit `/proc/meminfo`
   (MemAvailable, MemFree), `/proc/pressure/memory` (PSI) et
   `nvidia-smi --query-compute-apps=pid,used_memory` :
   - **alerte** (point de départ : MemAvailable < 20 Go ou PSI `some
     avg10` > 10) : `keep_alive: 0` sur les modèles d'Ollama, `/free` sur
     les ComfyUI dont la file est vide, et le dire (journal, portail) ;
   - **danger** (point de départ : MemAvailable < 12 Go — le niveau où le
     pilote a déjà échoué, #1358 — ou PSI `full avg10` > 5) :
     `POST /interrupt` du rendu en cours ; si la mémoire ne remonte pas
     dans les secondes qui suivent, `systemctl kill -s KILL` du service
     qui tient **le plus de mémoire
     GPU** parmi une liste fermée (ComfyUI :8188, H3 :8189, Ollama ; sur
     DGX1 marlin et les services nirva seulement si Cal les y met) ; le
     service repart seul (`Restart=on-failure`), sa mémoire GPU est rendue
     à la mort du processus.
   Les seuils sont à régler sur un essai contrôlé (§ Incertain) : un rendu
   H3 normal laisse lui-même peu de marge (~100 Go sur 121,7), un seuil
   trop haut tuerait des rendus sains. C'est une petite pièce de nirva-agent (qui lit
   déjà `nvidia-smi --query-compute-apps`, `main.py:639-642`) ou un
   service à part. Même idée publiée :
   [gpuoom](https://github.com/tom-doerr/gpuoom) classe les processus en
   ajoutant la mémoire GPU lue par NVML, parce que « la mémoire CUDA
   épinglée n'apparaît dans aucun compteur RSS ».
   Les outils tout faits, et pourquoi ils ne suffisent pas seuls :
   - **earlyoom** lit `MemAvailable` (qui, lui, voit la mémoire GPU) mais
     choisit sa victime par `oom_score` (la RSS) : il faut la nommer par
     `--prefer`, une expression sur le nom de processus **tronqué à 15
     octets** ([manpage](https://github.com/rfjakob/earlyoom/blob/master/MANPAGE.md)).
     Configuration publiée pour Spark : `-m 2 -s 100 --prefer
     'vllm|python3|python|…' --avoid 'sshd|systemd|journald|…'`
     ([forum NVIDIA](https://forums.developer.nvidia.com/t/system-crashes-when-memory-is-full/352339?page=2)).
     Chez Cal, les noms ne séparent pas assez : ComfyUI, le studio
     Character Factory et la diarisation NeMo s'appellent tous `python`,
     le portail et marlin `python3`, le runner d'Ollama `ollama` (relevé
     `ps`, DGX1). Entre deux `python`, earlyoom prendra la plus grosse
     RSS (ComfyUI : 3,3 Go, le studio : 0,18 Go) — probable, pas garanti.
     Acceptable **en attendant** la sentinelle, avec
     `--prefer '^python$|^ollama$' --avoid 'sshd|tailscaled|cloudflared|python3'`,
     essayé d'abord.
   - **systemd-oomd** juge la pression des cgroups et n'agit que sur les
     unités qui ont des `ManagedOOM*`
     ([manpage](https://manpages.ubuntu.com/manpages/noble/man8/systemd-oomd.service.8.html)) ;
     absent de DGX2, inactif sur DGX1 ; un utilisateur de Spark l'a réglé
     sans effet sur le gel (fil 353752). Non retenu.
   - **nohang** lit la PSI, seuils doux et durs ([dépôt](https://github.com/hakavlad/nohang)) :
     même limite qu'earlyoom pour le choix de la victime.
2. **Des plafonds de service quand même**, parce qu'ils bornent ce qu'ils
   voient : `MemorySwapMax=0` sur tous les services de calcul (le 24/09,
   DGX2 a gelé en swap plein à 94 %), `MemoryHigh`/`MemoryMax` sur
   `comfyui-h3test` et le `comfyui` de DGX2 comme sur celui de DGX1, en
   sachant qu'ils ne comptent que le cache et la mémoire du processus
   ([cgroup-v2, noyau](https://docs.kernel.org/admin-guide/cgroup-v2.html) :
   `memory.high` freine, `memory.max` tue **dans** la cgroup).
3. **Chaque service redémarre seul** après avoir été tué
   (`Restart=on-failure` est déjà là pour ComfyUI ; `always` pour Ollama).
4. **Ollama** : `OLLAMA_MAX_LOADED_MODELS=1` et un `OLLAMA_KEEP_ALIVE`
   court (défauts : 3 modèles, 5 min — [FAQ Ollama](https://docs.ollama.com/faq)),
   et écouter sur le loopback et le câble plutôt que `0.0.0.0` (audit M5,
   `docs/etudes/cloudflare.md` § 3.3) : aujourd'hui n'importe quel appareil
   du réseau peut charger 65 Go sur DGX1 pendant un rendu H3, et ni le
   portail ni aucun plafond ne le verraient.
5. **Le swap** : il ne peut pas recevoir la mémoire GPU ; il ne fait que
   ralentir tout le reste jusqu'au gel (DGX2, 24/09 : 20 minutes de swap
   plein avant la coupure). Les avis divergent : NVIDIA compte le swap
   comme mémoire récupérable ; plusieurs utilisateurs le coupent pour un
   arrêt net plutôt qu'un gel lent, l'un a gelé quand même
   ([forum](https://forums.developer.nvidia.com/t/unlocking-the-power-of-the-spark-in-comfyui-no-crashes/360336),
   fils 352339 et 353752). À décider après l'essai de la sentinelle ;
   `MemorySwapMax=0` sur les services de calcul, lui, ne coûte rien.
6. **Le pilote, puis la relance à distance** : passer les deux DGX au
   pilote proposé par `apt` (580.173.02 ou 580.178.04), une machine à la
   fois ; régler le BIOS pour **démarrer au retour du courant** et mettre
   chaque DGX sur une **prise connectée** — c'est le contournement qu'un
   utilisateur donne dans le fil où NVIDIA confirme l'absence de
   Wake-on-LAN (« the next best thing to wake on lan »,
   [forum](https://forums.developer.nvidia.com/t/cant-get-wake-on-lan-to-work/348168)).
   Pour les gels sans manque de mémoire (#16587, RCU stall), c'est le
   seul chemin de retour quand Cal n'est pas devant la machine.

Rien de cela ne remplace l'ordonnanceur : la sentinelle est le filet
quand quelqu'un passe à côté de la file (une autre session, un script, un
modèle d'Ollama appelé du réseau).

### 3.4 Les garde-fous au niveau de l'ordonnanceur (code du portail)

Ce qui existe (`core/jobs.py`, `core/machines.py`) est juste et reste :
un seul travail GPU du portail par machine (`_gpu_block`, l. 601), rien
sous le rendu d'un autre (`_foreign`, l. 580, par le `client_id` de
`/queue`), `/free` quand on change de famille (`_preflight`, l. 692), les
autres instances vidées si leur file est vide, attente dite en clair,
refus d'un travail plus gros que la machine. À ajouter, dans l'ordre :

1. **Le budget de chaque famille mesuré, pas estimé.** Pendant chaque
   rendu, l'agent de la machine relève chaque seconde la mémoire GPU du
   processus ComfyUI qui calcule (`nvidia-smi --query-compute-apps`, le
   seul chiffre qui la voit, § 3.1) et `memory.current` de sa cgroup (le
   cache et la mémoire épinglée) ; le maximum de la somme est le pic réel
   du travail. Les médianes remplacent `FAMILY_GB` (aujourd'hui « estimé
   pour les autres, d'après leurs poids », `factory/memory.py:86-88`) —
   une seule table, rangée à côté de `durations.json`, que le studio lit
   aussi.
2. **Un seul seuil H3** : 100 Go (le relevé machine de `FAMILY_GB`)
   jusqu'à la mesure de la sentinelle ; `h3_min_free_gb` disparaît.
3. **Ollama déchargé avant une grosse famille** (`keep_alive: 0` sur
   chaque modèle de `/api/ps`), comme le fait déjà le studio
   (`Manager.before_gpu`, `factory/memory.py:127-151`) ; le préflight du
   portail ne le fait pas aujourd'hui.
4. **La mémoire vraiment libre** : lire `/proc/meminfo` (MemFree, Cached,
   Dirty) en plus de `ram_free`, et la pression (`/proc/pressure/memory`,
   `some avg10`) ; refuser de partir si la pression monte, même quand
   `MemAvailable` semble suffire (§ 3.1, DGX1 le 24/09). Avant une grosse
   famille (H3), vider le cache de pages comme NVIDIA l'indique
   (`sync; echo 3 > /proc/sys/vm/drop_caches`, non destructif :
   [sysctl vm](https://docs.kernel.org/admin-guide/sysctl/vm.html)) — il
   faut `sudo -n`, déjà en place sur les deux DGX (relevé) ; à essayer :
   les poids seront relus du disque.
5. **Un battement par machine** : l'agent de la machine (§ 4) donne son
   `boot_id` (`/proc/sys/kernel/random/boot_id`). Un `boot_id` qui change =
   la machine a redémarré : les travaux qui y tournaient passent
   « interrompus » (la règle actuelle : on le dit, on ne relance pas seul,
   `jobs.py:130-132`), toutes ses instances « contenu inconnu ».
6. **Jamais deux gros calculs sur une machine**, y compris hors ComfyUI :
   Movie Analysis attend déjà que la machine soit libre
   (`analyse/chaine/gpu-libre.sh`) ; la séparation audio-separator et le
   YuE autonome sont lancés en sous-processus par le portail
   (`docs/etudes/stems.md` § 6) et doivent compter comme travaux GPU dans
   `_gpu_block`.

### 3.5 Coexister avec le studio, Ollama et les autres projets de Cal

Aujourd'hui **quatre** programmes décident de ce qui tourne sur les DGX,
sans se parler autrement que par ce qu'ils lisent :

| qui | où | comment il décide |
|---|---|---|
| la file du portail (`core/jobs.py`) | DGX2, calcule sur les deux | mémoire, famille, `client_id` des autres sur `/queue` |
| la file du studio Character Factory (`factory/studio.py`, un ouvrier) | DGX1, calcule sur les deux (`comfyui_peers`) | `factory/memory.py` : un seul gros travail, `/free`, Ollama déchargé |
| nirva-agent (projet Nirvalab de Cal, ADR-0022 du 01/06/2026) | DGX1 et DGX2 (:8080), pairs DGX2 et **VFX_3090** | démarre et arrête des services d'une liste fermée, par jeton |
| les autres sessions (bancs, nirva-upscale, marlin…) | surtout DGX1 | rien : elles envoient à ComfyUI ou chargent leur modèle |

Le garde-fou qui marche pour tous sans que personne change son code est la
**sentinelle de la § 3.3** : elle regarde la machine entière et la
mémoire GPU de chaque processus, et ne demande à aucun programme de
connaître les autres. Au-dessus, la règle du portail (« rien sous le rendu
d'un autre ») couvre ce qui passe par ComfyUI ; elle ne voit ni Ollama, ni
marlin, ni un script lancé à la main — d'où la lecture de la mémoire
réelle avant chaque départ (§ 3.4, 4). À terme, le studio envoie ses
travaux GPU à la file du portail (`POST /api/jobs`) au lieu d'avoir la
sienne : un seul arbitre par machine, ce que `docs/etudes/cloudflare.md`
§ 5.1 demandait déjà.

## 4. Brancher d'autres machines

### 4.1 Ce qui existe déjà : deux agents, dont un multi-plateforme

- **nirva-agent** (dépôt Nirvalab de Cal, `infra/nirva-agent/`, ADR-0022
  du 01/06/2026, lu sur DGX1) : « Daemon FastAPI déployé sur chaque DGX
  Spark. Pilote une allowlist de services locaux (systemd / docker) via
  une API HTTP avec bearer token » ; et, en tête de `main.py` :
  « MULTI-PLATEFORME : le même fichier tourne sur les DGX (Linux : systemd,
  docker, cgroups) et sur les stations Windows (type de service `process` :
  lancé par une commande, état déduit du port en écoute, arrêt par l'arbre
  de processus) ». Routes : `/health` (public), `/system` (mémoire,
  processeur, GPU par `nvidia-smi`, mémoire GPU par processus),
  `/inventory`, `/services/<id>/start|stop|logs`, `/cluster`. Il tourne
  sur DGX1 et DGX2 (:8080, 21 Mo de RSS) ; son `services.yaml` de DGX1 a
  pour pairs `DGX2` (`http://100.108.108.65:8080`) et **`VFX_3090`
  (`http://100.74.134.89:8080`)** — la station 3090, sur Tailscale.
- **Le pont de Character Factory** (`tools/bridge.py`, branche
  `claude/cf-bridge`, non fusionnée) : `/bridge/health`, `/bridge/start|stop`
  pour le studio, ComfyUI, H3, Ollama des deux DGX. L'étude Cloudflare
  (§ 3.3) a relevé qu'il fait confiance à `127.0.0.1`, ce qui ne tient plus
  derrière un tunnel.

**Recommandation : pas de troisième agent.** L'agent d'une machine, c'est
nirva-agent (il a déjà Windows, la liste fermée, le jeton, la mémoire, les
pairs), auquel on ajoute trois choses : le `boot_id` (§ 3.4, 5) ; **ce que
la machine sait faire** — son `/object_info` ComfyUI et la liste de ses
poids, qu'il résume en une empreinte ; et `wake` (§ 4.4) sur la machine
toujours allumée. Le pont de Character Factory se réduit à ce que
nirva-agent n'a pas (le relais du studio). À décider par Cal : nirva-agent
appartient à un autre projet (§ Décisions).

### 4.2 Qui décide, qui exécute

L'agent **ne décide rien** : il dit l'état de sa machine et exécute « démarre
ComfyUI », « arrête H3 », « réveille la TX ». Le travail lui-même passe,
comme aujourd'hui, par l'API de ComfyUI de la machine (`/prompt`, `/queue`,
`/free`, `/view`), que le portail sait parler (`core/comfy.py`). Une
nouvelle machine = une instance de plus dans une voie de
`showrunner.local.json`, avec son nom (`machine_names`) : c'est déjà le
mécanisme de DGX1 (joint par le câble).

Ce qui change pour une carte graphique **à mémoire séparée** (3090, 5090) :
`core/machines.py` lit `ram_free` (la mémoire unifiée d'un GB10) ; il
faudra lire `vram_free` de `/system_stats` pour ces machines, et garder la
RAM à part (un modèle déchargé de la carte va dans la RAM du PC). Une
colonne « mémoire : unifiée | séparée » par machine suffit.

Et **on n'envoie un graphe qu'à une machine qui peut le rendre** : le
portail valide déjà ses graphes contre `/object_info` de chaque ComfyUI
(`factory.comfy.validate`, `docs/etudes/image.md` § 7,
`docs/etudes/upscale.md` § 8 : « épinglerait un travail sur la seule
machine qui peut le faire »). Généraliser : avant le choix, la file écarte
les machines où le graphe ne passe pas. Juste par construction : pas de
rendu qui échoue sur un nœud absent à 3 h du matin.

### 4.3 Les joindre

| machine | réseau relevé le 29/09 | chemin proposé |
|---|---|---|
| DGX1 | Wi-Fi 192.168.10.205 (2,4 GHz, lent), câble 169.254.110.6, Tailscale 100.120.2.111 | le câble, comme aujourd'hui |
| DGX2 | Wi-Fi 192.168.10.247, câble 169.254.42.193, Tailscale 100.108.108.65 ; **aucun Ethernet branché** (`enP7s7` : « Link detected: no ») | la machine de base : c'est elle qui joint les autres |
| TX (3090) | Tailscale `vfx-3090` 100.74.134.89, Windows, « offline, last seen 6d ago » | Tailscale, depuis DGX2 |
| Blade (5090) | pas encore là ; un `blade15` Windows est sur le tailnet (hors ligne) | Tailscale, depuis DGX2 |
| Comfy Cloud | internet | HTTPS, clé API côté serveur (§ 5) |

Tailscale est déjà sur toutes les machines de Cal (`tailscale status` de
DGX2 : dgx1, dgx2, vfx-3090, blade15, ally, ico) : c'est le chemin pour les
machines de la maison, **pas** pour les pages (la porte reste Cloudflare,
`docs/etudes/cloudflare.md`). Aucun port à ouvrir ; ComfyUI des PC Windows
écoute sur l'adresse Tailscale seulement. Sous Windows, Tailscale en mode
« Run unattended » tourne avant toute connexion d'utilisateur
([Tailscale](https://tailscale.com/docs/how-to/run-unattended)). Pas besoin
de `cloudflared` sur les PC : c'est DGX2 qui les joint, et l'aiguillage
Cloudflare ne parle qu'à DGX2 (§ 6).

Côté ComfyUI Windows : la version portable embarque Python 3.13 et
PyTorch cu130 ([ComfyUI](https://github.com/Comfy-Org/ComfyUI)) ; sur les
RTX 50 sous Windows, `--use-sage-attention` donne des images noires sur
Qwen et Wan selon un retour de la communauté
([discussion #11583](https://github.com/Comfy-Org/ComfyUI/discussions/11583)) ;
et le pilote Windows déborde en silence de la VRAM vers la RAM (« Sysmem
Fallback Policy », à couper pour un arrêt net plutôt qu'une lenteur, lu
via la recherche sur [nvidia.custhelp](https://nvidia.custhelp.com/app/answers/detail/a_id/5490)).
Chaque PC est donc validé à part, par ses propres rendus d'essai.

### 4.4 Les machines qui dorment

- **Une machine absente n'est pas une erreur** : pas de battement = elle
  sort des voies ; les travaux qu'elle seule sait faire attendent « la
  TX dort » ; les autres vont ailleurs. Le portail le fait déjà pour une
  instance qui ne répond pas (`_choose` : « en attente : … ne répond pas »).
- **Réveil (Wake-on-LAN)** : le paquet magique est une diffusion sur le
  réseau local ; Tailscale, qui travaille en couche 3, ne le transporte
  pas, même avec un routeur de sous-réseau : il faut une machine allumée
  sur le même réseau qui l'envoie
  ([Tailscale](https://tailscale.com/blog/wake-on-lan-tailscale-upsnap)).
  Ce sera DGX2, toujours allumée (une route `wake` de son agent).
  - **Les DGX ne se réveillent pas ainsi** : « confirmed Spark does not
    support wake-on-lan » (NVIDIA, 18/10/2025,
    [forum](https://forums.developer.nvidia.com/t/cant-get-wake-on-lan-to-work/348168)) —
    leur puce Wi-Fi a beau annoncer « wake up on magic packet » (`iw
    phy`, relevé), et elles ne sont reliées au réseau que par le Wi-Fi
    (prise Ethernet sans lien). Pour DGX1 : prise connectée + démarrage au
    retour du courant (§ 3.3, 6).
  - **La TX (Windows)** : Microsoft ne prend pas en charge le réveil par le
    réseau depuis l'arrêt par défaut (Fast Startup, S4/S5) ; il marche
    depuis la veille S3 ou une mise en veille prolongée demandée, certains
    firmwares le permettent depuis S5
    ([Microsoft](https://learn.microsoft.com/en-us/troubleshoot/windows-client/setup-upgrade-and-drivers/wake-on-lan-feature)).
    Il faut la TX **en Ethernet**, la veille plutôt que l'arrêt, et le
    réglage de sa carte réseau et de son BIOS.
- **Le portable** : il part de la maison, se met en veille, change de
  réseau. On ne compte jamais sur lui : il prend des travaux quand il est
  là (Tailscale le joint où qu'il soit), rien ne lui est réservé. Avec
  l'eGPU, deux « places » : la 5090 du portable et celle de l'eGPU (deux
  ComfyUI, un par carte, `--cuda-device` : `comfy/cli_args.py:77`), comme
  les deux instances d'un DGX. Après une veille, le Core X V2 ne se
  reconnecte parfois qu'au redémarrage (retours d'utilisateurs,
  [Razer Insider](https://insider.razer.com/razer-support-45/core-v2-connection-problems-how-to-troubleshoot-31115)) :
  l'agent le verra (plus de carte dans `nvidia-smi`) et retirera la place.

### 4.5 Le miroir des modèles et des nœuds

Entre les DGX, rien ne change : rsync par le câble, jamais par le PC
(`tools/mirror_lib.sh`, `docs/etudes/yue.md` § 2), et le miroir n'est
jamais parfait (les venvs diffèrent, DGX1 sert un ancien nœud Krea :
`docs/etudes/image.md` § 7). Les PC Windows ne seront **pas** des miroirs :
autre système, autre carte, 24–32 Go. Chacun a sa **liste** : les familles
qui y tiennent (§ 2), copiées de DGX2 par Tailscale ou par le réseau local.
Et c'est l'empreinte annoncée par l'agent (§ 4.1) + la validation du graphe
(§ 4.2) qui décident où va un travail, pas une liste tenue à la main.

## 5. Comfy Cloud et les modèles propriétaires

### 5.1 Ce que Comfy.org propose au 29/09/2026 : trois portes

| porte | ce qu'on envoie | abonnement | depuis quoi | source |
|---|---|---|---|---|
| **Comfy Router** (lancé le 23/09/2026) | une requête à **un modèle** (pas un workflow) : `POST https://api.comfy.org/v2/models/{model_id}/requests` (en-têtes `X-API-Key`, `Idempotency-Key`), puis `GET …/requests/{id}/status` et `GET …/requests/{id}` | **aucun** : « pay per use … with no subscription » ; 402 si crédits insuffisants | n'importe quel serveur, **un Worker compris** | [quickstart](https://docs.comfy.org/development/comfy-router/quickstart), [annonce](https://blog.comfy.org/p/introducing-comfy-router-one-api), [limites](https://docs.comfy.org/development/comfy-router/limitations), [catalogue](https://docs.comfy.org/development/comfy-router/models) |
| **Comfy Cloud API** | **un workflow** au format API : `POST https://cloud.comfy.org/api/prompt` (`X-API-Key`), état par `GET /api/job/{id}/status`, sorties par `GET /api/view` (302 vers une URL signée) ; la v1 est « deprecated in favor of Comfy API v2 » (`POST /api/v2/jobs`, 0.1.x, encore mouvante) | **payant** : « API access requires a paid Comfy Cloud subscription; the Free tier does not include it » | n'importe quel serveur | [overview](https://docs.comfy.org/development/cloud/overview), [référence](https://docs.comfy.org/development/cloud/api-reference), [v2](https://docs.comfy.org/api-reference/v2/overview) |
| **Partner nodes dans un ComfyUI** | un workflow qui contient un nœud Seedance, Kling… envoyé à **notre** ComfyUI, avec `extra_data.api_key_comfy_org` dans `POST /prompt` ; le nœud appelle `api.comfy.org` | aucun (crédits) | un ComfyUI allumé (DGX2) | [api-key-integration](https://docs.comfy.org/development/comfyui-server/api-key-integration) |

Les crédits : **1 $ = 211 crédits**, valables « across both Comfy Cloud and
supported usage in ComfyUI Local »
([How credits work](https://support.comfy.org/articles/5846341390-how-credits-work-in-comfy)).
Abonnements Comfy Cloud (API comprise) : Standard 20 $/mois (4 200 crédits,
1 workflow à la fois par l'API, 30 min au plus), Creator 35 $ (3 à la
fois), Pro 100 $ (5, 1 h) ; cartes RTX 6000 Pro de 96 Go ; « Every model on
Comfy Cloud is cleared for commercial use »
([pricing](https://comfy.org/pricing/), [cloud](https://comfy.org/cloud)).

**Aucune des trois n'a de webhook** (la v2 les refuse explicitement,
[design](https://docs.comfy.org/development/api-development/sdks-design)) :
on relit l'état. Les URL signées durent ~6 h ; les entrées et sorties des
partner nodes sont **supprimées 24 h après** leur stockage
([data-retention](https://docs.comfy.org/support/data-retention)) : le
fichier part dans R2 (ou la bibliothèque de DGX2) dès la fin du rendu.

### 5.2 Les modèles propriétaires, à date

| modèle | chez Comfy | prix Comfy (crédits → $ à 211 pour 1 $) | 5 s |
|---|---|---|---|
| **Seedance 2.5** (ByteDance, sorti le 31/07/2026 : 30 s en un plan, jusqu'à 50 références — [Seed](https://seed.bytedance.com/en/blog/one-take-creation-flexible-referencing-introducing-seedance-2-5)) | partner node (08/08), 1080p (17/08), Router | 3,229 crédits / 1 000 jetons (480–720p), 3,530 (1080p) ; jetons = durée × largeur × hauteur × i/s ÷ 1024 | 720p 24 i/s : 108 000 jetons → **≈ 1,65 $** ; 1080p : **≈ 4,07 $** |
| Seedance 2.0 | oui | 2,112 / 2,323 crédits / 1 000 jetons | ≈ 1,08 $ / 2,68 $ |
| **Kling 4.0** | **non** : annoncé les 27–28/09/2026, version « lite » réservée aux abonnés annuels de Kling, sortie complète « en octobre », **ni API ni prix** publiés ([Bloomberg](https://www.bloomberg.com/news/articles/2026-09-28/kuaishou-s-ai-video-spinoff-unveils-new-model-in-bytedance-chase), [kling.ai](https://kling.ai/)) | — | — |
| Kling v3 / v3-omni / o1 | oui | 17,72 crédits/s (720p), 23,63 (1080p), 26,59 / 35,45 avec le son | 1080p : **0,56 $**, avec son 0,84 $ |
| Veo 3.1 fast / lite / standard | oui | 0,12 / 0,08 / 0,40 $/s (1080p, son) | 0,60 $ (fast) |
| **MiniMax H3** | partner node et Router | 27,16 crédits/s (768p), 39,22 (2K) | 768p : **0,64 $** — un repli pour H3 quand la maison dort (même modèle que notre H3 local : à vérifier) |
| Runway gen4_turbo, Luma Ray 3.2, Hailuo 02, Wan 2.7/3.0, Vidu Q3, PixVerse V6, Grok Imagine | oui (Vidu et Hailuo absents du Router) | 0,07 à 0,36 $/s | — |
| Sora 2 | **retiré** le 28/09 ([PR #1802](https://github.com/Comfy-Org/docs/pull/1802)) | — | — |
| Image : **Krea 2** (Large/Medium/Turbo), Seedream 5.0, FLUX.2 pro, GPT Image 2, Nano Banana Pro, Ideogram V4, Recraft V4 | oui | Krea 2 : 0,015 à 0,06 $ l'image | — |

Source des prix : [pricing des partner nodes](https://docs.comfy.org/tutorials/partner-nodes/pricing)
(fichier du dépôt Comfy-Org/docs, dernier commit le 28/09/2026). Que le
Router facture exactement comme les partner nodes : non documenté.
Ailleurs, pour comparer (5 s) : fal a des webhooks et Seedance 2.5 à
2,37 $ en 720p ([fal](https://fal.ai/models/bytedance/seedance-2.5/text-to-video)),
Kling v3 au même prix que Comfy ; Replicate a des webhooks mais garde les
sorties 1 h ([Replicate](https://replicate.com/docs/topics/predictions/data-retention)) ;
BytePlus en direct serait moins cher pour Seedance (chiffres de tiers, pages
officielles illisibles sans JavaScript).

### 5.3 Ce qu'il faut savoir avant d'envoyer nos personnages

- **Visages** : Seedance accepte un portrait généré par IA s'il « must not
  correspond to an identifiable natural person » ; une personne réelle
  passe d'abord par une vérification de vivacité
  ([doc Comfy Seedance](https://docs.comfy.org/tutorials/partner-nodes/bytedance/seedance-2-0)).
  Nos personnages photoréalistes (Krea 2 + UltraReal) peuvent-ils être pris
  pour des personnes réelles ? Non documenté : à essayer sur un personnage
  avant d'en faire une fonction. Les photos de visages réels déposées par
  les amis : non, sans vérification.
- **Veo** : en Europe, seul `allow_adult` pour les personnes, filigrane
  SynthID ([Veo](https://ai.google.dev/gemini-api/docs/veo)).
- Le contrat de Comfy interdit les « synthetic media designed to impersonate
  a real individual without their consent » ([MSA](https://comfy.org/enterprise-msa)).

### 5.4 Comment le portail l'appelle

1. **Tout de suite, depuis DGX2** (la maison est là) : une voie `cloud` dans
   `showrunner.local.json` — des ouvriers `local` sans ComfyUI, donc sans
   famille ni règle GPU (`_http_lane`, `_resolve`, `jobs.py:148-174`) —
   et un travail `movie.cloud` qui appelle **le Router** (un modèle, pas de
   workflow à maintenir), relit l'état toutes les quelques secondes, range
   la vidéo dans la bibliothèque avec son coût. Le nombre d'ouvriers de la
   voie = le nombre de rendus nuage simultanés. L'outil Vidéo gagne
   « Seedance 2.5 », « Kling 3 », « Veo 3.1 » à côté d'H3 ; chaque pastille
   dit le prix avant l'envoi.
2. **Machines éteintes** : le même appel, depuis le Durable Object de
   l'aiguillage (§ 6), la clé en secret du Worker, une alarme pour relire
   l'état (une alarme à la fois par objet, handler de 15 min au plus :
   une table des échéances et l'alarme sur la prochaine —
   [alarms](https://developers.cloudflare.com/durable-objects/api/alarms/),
   [limits](https://developers.cloudflare.com/durable-objects/platform/limits/)),
   la vidéo copiée en flux dans R2 (128 Mo de mémoire par Worker :
   jamais le fichier entier en mémoire —
   [limits](https://developers.cloudflare.com/workers/platform/limits/)).
3. **Nos propres workflows sur les GPU de Comfy** (Krea 2 + nos LoRA, Qwen
   2.1, H3 avec le banc de Cal) quand la maison dort : c'est la Comfy Cloud
   API, avec abonnement. Que nos LoRA (UltraReal, Identity Edit, Viggle) et
   nos nœuds (krea2edit…) y soient utilisables : **non documenté**. À
   n'ouvrir que si Cal veut ce repli ; sinon ces travaux attendent la
   maison.

Cal veut « ComfyUI Cloud » : les portes 1 (Router) et 3 (Cloud API) sont
toutes deux de Comfy.org, avec les mêmes crédits ; le Router suffit pour
les modèles propriétaires, sans abonnement.

## 6. L'interface sans aucun ordinateur allumé

### 6.1 Deux questions, deux arbitres

La demande mêle deux décisions qui n'ont ni les mêmes données ni le même
rythme :

| | **où** : maison ou nuage | **quand et sur quelle machine** de la maison |
|---|---|---|
| dépend de | le modèle (propriétaire ou non), la maison allumée ou pas, le budget en € de la personne | la mémoire, la famille chargée, le rendu d'un autre, la santé de la machine |
| doit marcher | **toujours**, même tout éteint | seulement quand la maison est là |
| rythme | à l'envoi (une fois) | à chaque seconde (relevés, préflight) |
| erreur possible | payer un rendu pour rien | **geler une machine** |
| donc vit | dans Cloudflare (toujours allumé, 0 GPU) | sur DGX2 (la machine de base), près des machines |

D'où **l'aiguillage dans Cloudflare** et **l'arbitre de la maison sur
DGX2**. L'aiguillage ne décide jamais de la mémoire (règle déjà posée par
`docs/etudes/cloudflare.md` § 5 : « il ne décide jamais de la mémoire ») ;
l'arbitre de la maison ne décide jamais de dépenser de l'argent.

### 6.2 Ce qui vit dans Cloudflare

- **Les pages, la porte, la bibliothèque** : le Worker `showrunner`,
  Access, R2 — tel que `docs/etudes/cloudflare.md` les décrit (§ 1 à 4).
  Rien de neuf ici.
- **L'aiguillage** : un **Durable Object** « file » unique. Il reçoit chaque
  demande (`POST /api/jobs`), la range (épinglés, priorité, tourniquet,
  quotas — les règles de `core/jobs.py`, qui sont des règles *de
  personnes*, pas de machines), choisit la **place** :
  - modèle propriétaire → **nuage** ;
  - modèle de la maison et maison présente → **maison** ;
  - maison absente → le travail attend « la maison dort » (ou, si Cal le
    permet pour ce travail, part au nuage quand un équivalent y existe).

  Pourquoi un Durable Object : un objet unique, état en SQLite cohérent,
  disponible sur le plan gratuit (SQLite seulement : 100 000 requêtes et
  13 000 Go-s par jour, 5 Go —
  [prix](https://developers.cloudflare.com/durable-objects/platform/pricing/)) ;
  des **alarmes** qui réveillent l'objet (une à la fois, relancées en cas
  d'échec — [alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)) ;
  des WebSocket **entrantes qui hibernent** sans facturer la durée
  ([websockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)) —
  exactement la connexion sortante de l'agent de DGX2 ; un message entrant
  compte pour 1/20 de requête. Pas **Queues** : livraison « au moins une
  fois », ordre « best effort », ni priorité ni équité
  ([garanties](https://developers.cloudflare.com/queues/reference/delivery-guarantees/)) —
  on ne peut pas y dire « la machine qui a déjà la famille chargée ».
  **Workflows** (`step.do`, `waitForEvent` jusqu'à 365 jours —
  [events](https://developers.cloudflare.com/workflows/build/events-and-parameters/))
  pourrait porter le cycle de vie d'un rendu nuage ; il ne choisit rien.
  Pas l'Agents SDK non plus pour la file : son `this.queue()` est un FIFO
  sans priorité ([queue-tasks](https://developers.cloudflare.com/agents/api-reference/queue-tasks/)).
- **Les travaux « nuage »** partent **du Durable Object lui-même** vers
  le Comfy Router (§ 5), avec la clé gardée en secret du Worker
  (`wrangler secret put`, jamais dans une page ni un dépôt) ; comme aucune
  API de Comfy n'a de webhook, l'alarme relit l'état jusqu'à la fin (une
  table des échéances, l'alarme sur la plus proche) ; la vidéo part en flux
  dans R2 avant l'effacement de 24 h, l'objet entre dans la bibliothèque
  publiée. Aucune machine de Cal n'est nécessaire. Limite à surveiller :
  50 sous-requêtes par invocation sur Workers Free, 10 000 en payant
  ([limits](https://developers.cloudflare.com/workers/platform/limits/)).
- **Les travaux « maison »** sont **tirés** par l'arbitre de DGX2 : son
  agent ouvre une connexion **sortante** vers le Durable Object (WebSocket
  ou relève régulière), annonce ce que la maison sait faire et ce qu'elle
  peut prendre maintenant, reçoit un travail avec un **bail** (renouvelé à
  chaque battement ; bail expiré = travail « interrompu », jamais relancé
  seul sur un GPU). Juste par construction : une machine qui dort ne tire
  rien, et rien ne lui est poussé.

### 6.3 Ce que devient l'ordonnanceur Python

`core/jobs.py` + `core/machines.py` restent **l'arbitre de la maison**, sur
DGX2, avec tout ce qu'ils savent : voies, instances, familles chargées,
`/free`, préflight, rendu d'un autre, H3 à la demande, mesures de durée.
Ce qui change : ils ne reçoivent plus les demandes des pages, ils les
**tirent** de la file de Cloudflare, et ils y renvoient l'état (progression,
message d'attente, résultat). L'ordre entre personnes se calcule au même
endroit que les quotas (le Durable Object) ; le choix de la machine reste
`_choose` (qui prend déjà une liste ordonnée et y pioche selon la famille
chargée : `jobs.py:629-675`).

Tant que la porte Cloudflare n'est pas là, **rien ne bouge** : le portail
de DGX2 reste tout (§ 7.3, étapes 0 à 3). L'aiguillage n'arrive qu'avec la
porte, et il reprend le code de la file, pas une autre logique.

### 6.4 Le secret, l'argent

- **La clé Comfy.org** : un secret du Worker. Tant que le nuage part du
  portail de DGX2 (étape 3), un fichier hors dépôt (`~/.config/showrunner/comfy.key`,
  `chmod 600`), comme la clé R2 (`docs/etudes/cloudflare.md` § 4.2).
- **Le budget** : un rendu nuage coûte de l'argent réel. Quotas en crédits
  (ou en €) par personne et par jour, à côté des quotas de travaux
  (`core/auth.py`, page admin) ; les amis à zéro par défaut, Cal ouvre ;
  le coût estimé affiché avant l'envoi (§ 5), le coût réel rangé dans la
  recette de l'objet.
- **La règle « pas d'API de modèle payante »** (`CLAUDE.md` du portail ;
  `docs/etudes/cloudflare.md` § 6.2 « Ni Workers AI, ni modèle hébergé ») :
  la demande du 29/09 l'ouvre pour les modèles propriétaires. À confirmer
  par Cal et à écrire dans `CLAUDE.md` : **local d'abord ; le nuage pour ce
  qui n'existe pas en local, ou quand la maison dort**.

## 7. Recommandation

### 7.1 L'architecture retenue

```
                 Cal, les amis — n'importe où, n'importe quel appareil
                                     │ https://showrunner.luxigone.workers.dev
┌──────────────────────── Cloudflare : toujours allumé, zéro GPU ─────────────────────────┐
│  Access (la porte, code par e-mail)                                                      │
│     │                                                                                    │
│  Worker « showrunner » : pages, identité signée, /api                                    │
│     ├── R2 : la bibliothèque publiée (fichiers, item.json, index)                        │
│     └── Durable Object « AIGUILLAGE » (un seul, SQLite)                                  │
│           · la file de tout le monde : épinglés, priorité, tourniquet, quotas, budget €  │
│           · choisit la PLACE : NUAGE (propriétaire, ou maison endormie si permis)        │
│                                MAISON (tout le reste)                                    │
│           · alarmes : relève des rendus nuage, baux de la maison, battements             │
│           · [plus tard, en option] Workers AI : « comprendre la demande »              │
└──────────────┬─────────────────────────────────────────────────┬─────────────────────────┘
               │ WebSocket SORTANTE ouverte par la maison        │ HTTPS, clé en secret du Worker
               │ (tire le travail, renvoie l'état)               ▼
               │                                        Comfy Router (api.comfy.org)
               │                                        Seedance 2.5 · Kling 3 · Veo 3.1 · H3
               ▼                                        crédits, sans abonnement ; sorties → R2
┌──────────────────────── DGX2 : la base, toujours allumée ───────────────────────────────┐
│  ARBITRE DE LA MAISON = core/jobs.py + core/machines.py (40 Mo de RAM, 0 GPU)            │
│    quelle machine, quand : famille chargée, /free, préflight mémoire, rendu d'un autre   │
│  AGENT (nirva-agent) : état, boot_id, ce que la machine sait faire, start/stop, wake     │
│  SENTINELLE : nvidia-smi + MemAvailable + PSI → /free, puis tue le plus gros GPU         │
│  ComfyUI :8188 · H3 :8189 · Ollama                                                       │
└──────┬──────────────────────────────────┬───────────────────────────────┬───────────────┘
       │ câble 200 Gb                      │ Tailscale                     │ Tailscale
       ▼                                   ▼                               ▼
  DGX1 (agent + sentinelle)          TX 3090 (agent, ComfyUI)        Blade 5090 + eGPU
  studio CF, ComfyUI, H3, Ollama     réveil : WoL par DGX2           (agent, un ComfyUI
  relance : prise connectée          petits travaux                   par carte ; quand il est là)
```

### 7.2 Le rôle de chaque pièce

| pièce | où | ce qu'elle décide | ce qu'elle ne décide jamais | mémoire |
|---|---|---|---|---|
| Access + Worker | Cloudflare | qui entre, son rôle | rien sur les machines | — |
| **Aiguillage** (Durable Object) | Cloudflare | l'ordre entre personnes, les quotas, le budget, **maison ou nuage** | la mémoire d'une machine | 0 chez Cal |
| **Arbitre de la maison** (`core/jobs.py`) | DGX2 | **quelle machine, quand**, vider ou non, attendre | dépenser de l'argent | 40 Mo de RAM, 0 GPU |
| **Agent** (nirva-agent) | chaque machine | rien : il dit et il exécute (démarrer, arrêter, réveiller) | — | ~21 Mo de RAM |
| **Sentinelle** | chaque DGX | tuer un calcul qui va geler la machine | l'ordre de la file | quelques Mo |
| ComfyUI, Ollama | chaque machine | rien : ils calculent | — | tout le reste |
| Comfy Router | nuage | rien : il calcule, facture | — | — |
| Assistant (option) | Workers AI | propose un travail du catalogue | lancer quoi que ce soit | 0 chez Cal |

**Ce que prend l'orchestration sur les GPU : zéro.** Sur les DGX, les
seules pièces locales (arbitre, agent, sentinelle) sont des processus
Python de quelques dizaines de Mo de RAM, sans CUDA.

### 7.3 Le plan, du plus petit pas utile au complet

**Étape 0 — ne plus geler** (Cal, sudo ; aucune ligne du portail).
- Pilote 580.142 → celui qu'`apt` propose, une DGX après l'autre ; noter
  la version dans `docs/`.
- Ollama : `OLLAMA_MAX_LOADED_MODELS=1`, `OLLAMA_KEEP_ALIVE` court, écoute
  hors `0.0.0.0` (accord de Cal pour les autres projets de DGX1).
- `MemorySwapMax=0` et des plafonds sur `comfyui-h3test` (les deux) et
  `comfyui` (DGX2), en sachant ce qu'ils ne voient pas.
- En attendant la sentinelle : earlyoom avec `--prefer '^python$|^ollama$'`
  et `--avoid` pour ssh, tailscaled, cloudflared, `python3`.
- BIOS « démarrer au retour du courant » + prise connectée pour chaque DGX.
- **Essai** (le point le plus incertain de l'étude) : sur DGX2, un
  programme qui alloue par CUDA jusqu'au seuil d'alerte, pour vérifier que
  le garde-fou agit avant le gel. Avec l'accord de Cal seulement : c'est
  un essai qui peut geler la machine s'il échoue — donc prise connectée
  d'abord.

**Étape 1 — la sentinelle et l'ordonnanceur qui mesure** (code).
- La sentinelle (§ 3.3, 1) sur les deux DGX, dans nirva-agent ou à part.
- Dans le portail (§ 3.4) : budget par famille **mesuré** (GPU par
  `nvidia-smi` + cgroup), un seul seuil H3, Ollama déchargé avant une
  grosse famille, mémoire vraie et PSI au préflight, `boot_id`, les
  sous-processus GPU (audio-separator, YuE autonome) comptés comme travaux
  GPU. Vérifié par `tools/check.py` (faux ComfyUI réglable).

**Étape 2 — le nuage depuis DGX2** (code + compte Comfy.org).
- Voie `cloud`, travail `movie.cloud` par le Router ; prix affiché avant
  l'envoi, coût rangé dans la recette ; quotas en crédits par personne
  (amis à zéro par défaut) ; clé dans `~/.config/showrunner/comfy.key`.
- Premier rendu (avec l'accord de Cal) : le moins cher qui prouve la
  chaîne, un Seedance 2.5 court en 480p ; puis un personnage de Character
  Factory, pour voir si le détecteur de « personne réelle » le refuse.

**Étape 3 — la porte Cloudflare** : `docs/etudes/cloudflare.md`, étapes 1
à 3 (Access, Worker, R2). Rien de neuf.

**Étape 4 — l'aiguillage** (Durable Object).
- La file des personnes passe dans le Durable Object (le code de
  `_fair_seq` et des quotas, porté) ; les travaux nuage en partent ;
  l'arbitre de DGX2 tire les travaux maison par sa WebSocket sortante et
  renvoie l'état ; les pages lisent l'aiguillage.
- Essai : **tout éteint** (portail arrêté), un Seedance part et revient
  dans R2 ; un H3 attend « la maison dort » ; la maison rallumée, il part.

**Étape 5 — les PC.** nirva-agent (Windows) + ComfyUI sur la TX et le
Blade, Tailscale, leurs voies avec « mémoire séparée », la validation du
graphe par machine, le réveil de la TX par DGX2. Leur liste de familles :
§ 2.3.

**Étape 6 — un seul arbitre par machine** : le studio Character Factory
envoie ses travaux GPU à la file commune au lieu d'avoir la sienne.

**Étape 7 (option) — l'assistant de demande** : Workers AI, sortie
validée par schéma, proposition montrée avant l'envoi.

### 7.4 Ce que ça coûte

| poste | coût | source |
|---|---|---|
| Cloudflare (Workers, Access, R2 ≤ 10 Go, Durable Objects en SQLite) | 0 € pour commencer ; Workers Paid 5 $/mois si besoin | `docs/etudes/cloudflare.md` § 7 ; [prix DO](https://developers.cloudflare.com/durable-objects/platform/pricing/) |
| Comfy Router | à l'usage : Seedance 2.5, 5 s, ≈ 1,65 $ (720p) / 4,07 $ (1080p) ; Kling v3, 5 s 1080p, 0,56 $ ; H3, 5 s 768p, 0,64 $ | § 5.2 |
| Comfy Cloud (nos workflows sur leurs GPU) | dès 20 $/mois (Standard) — seulement si Cal veut ce repli | [pricing](https://comfy.org/pricing/) |
| Workers AI (assistant, option) | 0 € à ~200 demandes/jour (hypothèse de taille) | [prix](https://developers.cloudflare.com/workers-ai/platform/pricing/) |
| Prises connectées | à choisir par Cal (prix non relevé) | — |

Exemple de budget, pour fixer les idées : 30 plans Seedance 2.5 de 5 s en
720p par mois ≈ 50 $ ; les mêmes en Kling v3 1080p ≈ 17 $.

## Ce qui reste incertain

1. **La sentinelle attrape-t-elle le gel à temps ?** La mémoire GPU échappe
   aux cgroups (mesuré), mais `MemAvailable` et `nvidia-smi` la voient ;
   les seuils et la vitesse de réaction (une lecture par seconde) sont à
   établir par un essai contrôlé — qui peut lui-même geler une machine.
2. **Les gels sans manque de mémoire** (ComfyUI #16587 sur la même
   configuration, RCU stall ; DGX2 le 11/09 ; DGX1 le 25/09 à 10:14) : cause
   non établie ; le nouveau pilote les couvre-t-il ? Non documenté. Seule
   parade sûre : la relance à distance.
3. **Le pilote 580.173.02/580.178.04** : NVIDIA dit que les pilotes de mai
   et juillet 2026 empêchent le gel par manque de mémoire ; des gels sont
   encore signalés après. Les numéros exacts « de mai et juillet » ne sont
   pas donnés par NVIDIA.
4. **La 5090 « 21 Go »** : aucune carte ne correspond ; le modèle du Blade
   (USB4 ou Thunderbolt 5) et la RAM de la TX ne sont pas connus.
5. **Rien n'est mesuré sur les PC** : ni la diffusion sur eGPU Thunderbolt 5,
   ni INT8 ConvRot sur Ampere, ni YuE2/TRELLIS.2 sous Windows.
6. **Comfy** : le Router facture-t-il comme les partner nodes ; nos LoRA et
   nœuds sur Comfy Cloud ; le H3 du nuage est-il le nôtre ; nos personnages
   photoréalistes passent-ils le détecteur de personnes réelles de
   Seedance ; conservation exacte des sorties du Router — non documentés.
7. **Kling 4** : ni date, ni API, ni prix au 29/09/2026.
8. **Workers AI** : latence non publiée pour les petits modèles ; mode JSON
   non garanti ; disponibilité des modèles récents sur le plan gratuit
   non précisée.
9. **Le cache de pages** : que le pilote échoue faute de pouvoir le
   récupérer (DGX1, 24/09) est un indice à 10 min près ; que `drop_caches`
   avant H3 aide chez nous : à essayer.
10. **Le second programme du gel du 24/09 sur DGX2** (PID 1069214) : non
    identifié dans le journal.

## Sources

**Relevés du 29/09 sur les DGX (lecture seule)** : `nvidia-smi` et
`--query-compute-apps` ; `free`, `vmstat`, `/proc/meminfo`,
`/proc/pressure/memory` ; `sar -r`/`-S` des 24 et 25/09 ;
`journalctl --list-boots`, `last -x`, `journalctl -b -3/-4` (OOM, NVRM),
`journalctl -u comfyui -u comfyui-h3test` (« memory peak », « Prompt
executed in ») ; `systemctl cat/show` de `comfyui`, `comfyui-h3test`,
`ollama` ; `/sys/fs/cgroup/system.slice/{comfyui,ollama}.service/memory.*` ;
`/system_stats`, `/queue` (:8188, :8189) ; `/api/ps`, `/api/tags`
d'Ollama ; `ss -ltnp` ; `tailscale status` ; `ip`, `ethtool`, `iw phy` ;
`apt-cache policy nvidia-driver-580-open` ; `/etc/dgx-release` ;
`ps` (RSS du portail, de nirva-agent, du relais).

**Code lu** : `SHOWRUNNER_TOOLS/server/core/jobs.py`, `machines.py`,
`config.py`, `server/tools/movie.py` ; `Character_Factory/factory/memory.py`,
`studio.py`, branche `claude/cf-bridge` (`tools/bridge.py`) ; ComfyUI
830232b8 : `comfy/system_memory.py`, `comfy/model_management.py`,
`comfy/cli_args.py`, `execution.py`, `server.py` ; Nirvalab :
`infra/nirva-agent/main.py`, `services.yaml`, README,
`docs/architecture/0022-dashboard-infra-dgx.md`.

**Études et notes** : `docs/etudes/cloudflare.md`, `movie.md`, `image.md`,
`upscale.md`, `yue.md`, `stems.md`, `analyse.md` ;
`Character_Factory/docs/REPRISE_CAL.md`, `docs/ETUDES.md`.

**Web** (lu le 29/09/2026) : les liens cités dans le texte, notamment —
ordonnancement : SwarmUI, Ray Serve, SkyPilot, Kueue, Ollama, llama-swap,
LocalAI, ComfyDeploy, RunComfy, ComfyUI-Distributed ; Clockwork,
ServerlessLLM, Jadhav et al. (SC'25), arXiv 2511.11612, AlphaEvolve, BFCL
V4, ComfyBench, FlowBench ; Cloudflare : Workers AI (prix, JSON mode),
Durable Objects (prix, limites, alarmes, WebSocket), Queues, Workflows,
Agents SDK, limites des Workers ; Comfy : Router (quickstart, annonce,
limites, catalogue), Cloud API (overview, référence, v2, design des SDK),
intégration de la clé API, prix des partner nodes, conservation des
données, crédits, pricing, MSA ; Seedance 2.5 (Seed), Kling 4 (Bloomberg,
kling.ai), fal, Replicate, Veo ; NVIDIA : fiche et known issues du DGX
Spark, porting guide, forums (gels, Wake-on-LAN, earlyoom), fiches RTX
5090, 5090 Laptop, 3090 ; open-gpu-kernel-modules #1358 ; ComfyUI #16587 ;
evanwtf/local-llm #456 ; gpuoom ; earlyoom, systemd-oomd, nohang ; noyau
cgroup-v2 et sysctl vm ; Razer (Blade 16/18, Core X V2) ; Tailscale
(unattended, Wake-on-LAN) ; Microsoft (Wake-on-LAN) ; fiches des modèles
(Z-Image, Krea 2, Qwen-Image 2.1, MiniMax H3, SeedVR2, YuE2, TRELLIS.2,
UniRig, Demucs).
