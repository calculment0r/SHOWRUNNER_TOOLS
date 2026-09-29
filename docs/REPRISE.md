# Reprise — à lire en premier

État au 29/09/2026, fin de matinée (commit b63ce64). Portail :
**http://192.168.10.247:8790/** (DGX2 ; Tailscale http://100.108.108.65:8790/).
Entrer : taper le pseudo **`nico007`** (Cal, admin). Secours si plus aucun
admin n'entre : `ssh dgx2 'cd ~/SHOWRUNNER_TOOLS && python3 server/showrunner.py --admin nico007'`.

## Travailler ici (règles fermes de Cal)

- **Chaque commande commence par `ssh dgx1 `, `ssh dgx2 ` ou `scp `** (seules
  commandes autorisées une fois pour toutes ; le reste lui demande « allow
  once »). Sur le PC : Read, Write, Edit, Glob, Grep seulement. À répéter en
  tête de chaque brief d'agent.
- **Git se fait sur DGX2** (clé ssh, pousse sur GitHub). Méthode sûre suivie
  le 29/09 : une copie de déploiement `/tmp/sr_deploy` (clone du dépôt), on y
  copie seulement les fichiers d'un chantier fini, `python3 tools/check.py`,
  commit, push, puis `cd ~/SHOWRUNNER_TOOLS && git fetch && git reset --hard
  origin/main && tools/portail.sh restart`, et DGX1 suit par
  `ssh dgx@169.254.110.6 "cd ~/SHOWRUNNER_TOOLS && git fetch -q && git reset -q --hard origin/main"`.
  Le PC sert de brouillon partagé par les agents : il peut contenir du travail
  inachevé — ne jamais pousser tout le PC d'un coup.
- Un script qui contient des barres inverses : l'écrire en fichier sur le PC
  (scratchpad), le copier par scp, l'exécuter sur DGX2 (les heredocs à travers
  ssh ont déjà écrit un octet nul dans http.py).
- Jamais de `pkill -f` par motif (tue la commande ssh elle-même) : par PID.
- **Aucun rendu de modèle** tant que Cal ne le demande pas : tout tourne sur
  des moteurs factices ; le câblage réel est écrit derrière des interrupteurs
  (page Admin → Câblage, ou `showrunner.local.json` sur DGX2) : `image_backend`,
  `movie_engine`, `music_yue`, `music_stems`, `music_engine`, `objet_trellis`,
  `upscale_backend`.
- Captures : `node tools/shot.mjs` (sans session) ou
  `node tools/shot_connecte.mjs <base> <dossier> nico007 '<json>'` sur DGX2.

## Ce qui est en ligne (tous vérifiés, 584 contrôles)

Accueil · **Asset** (sélection standard, barre d'outils, zip, dossiers,
Uploads, éléments avec voix) · **Image** (Z-Image, Qwen 2.1, Krea 2, prise de
vue, édition, file vivante à droite) · **Movie Creator** (entrées par place
`@image1` vert/rouge, catégories, élément = images + voix, banc « Comparer »,
sur le modèle de H3 Studio) · **Character Factory** intégré sous
`/character/` (relais vers le studio de DGX1) · **Object Creator** ·
**Montage** · **ODIO** (DAW : sections, arc d'énergie, rack, nodal, console,
YuE → stems en pistes, moteur repris d'ODIO_01 avec l'accord de Cal) ·
**Movie Analysis** (Getaround et Le Loup de Wall Street dans le portail,
diarisation relayée) · **Idéation** (canvas en planches) · **Upscale** ·
**Admin** (porte par pseudo, personnes, file, machines, câblage, stockage,
journal). Glisser-déposer partout où un asset est attendu (catégorie Upload).
Le contrat entre outils : `docs/ARCHITECTURE.md`. Les études : `docs/etudes/`.

## En cours au moment de la coupure

- **ODIO, deuxième tour : FAIT et en ligne (commit 194ae62, 586/586)** ; restent
  à relire par Cal : la table FACETTES de `musique/banc.js`, le calage au tempo
  qui change la hauteur (pas d'étirement), et les cinq teintes des lanes
  d'ODIO_01 (remplacées par des jetons voisins). Pour mémoire, la liste livrée —
  panneau gauche repliable, pas de sélection de texte sauf renommer au
  double-clic, tap tempo, en-tête qui ne bouge plus, poignée gauche = rogner le
  début, raccourcis d'Ableton Live, rack sous l'arrangement (panneaux
  redimensionnables), zoom à la molette, réglages de clip audio (in/out, boucle,
  gain…), Tab = Arrangement ↔ Nodal, nodal façon ODIO-O1 (timeline simplifiée
  en bas avec pistes « groove », « mélodie », attracteurs glissés vers le
  canvas — doc d'ODIO_01 clonée sur DGX2 dans `/tmp/odio01`). Sa copie :
  `/tmp/sr_daw3` sur DGX2 (port 8784), rien de commité. À reprendre : lire son
  rapport s'il est arrivé, sinon relancer un agent avec cette liste.
- **Movie Analysis** : Cal dit ne pas avoir « ses cas d'étude comme en local »
  et ne plus voir le menu du haut. Constaté le 29/09 : les deux films sont
  listés et leurs pages ont l'en-tête du portail à 1600 px ; sous 1100 px le
  menu disparaissait (corrigé : bouton « Outils », b63ce64). **À demander à
  Cal** : quelle page, quelle largeur de fenêtre, et ce qu'il appelle ses cas
  d'étude (le dépôt MOVIE_ANALYSE n'a que getaround et wall ; DGX2 a aussi
  `~/reelbench/runs/getaround-nv`, `getaround-orig`, `wall-nv`). Les vidéos
  viennent de R2 (Worker `movie-analysis-partage.luxigone.workers.dev`).

## Ce qui attend Cal (décisions)

1. **Câbler les modèles** (interrupteurs ci-dessus) ; ordre des premiers
   rendus : études image §8, movie, upscale §9, yue, stems.
2. Téléchargements proposés : ControlNet Union 2.1 Z-Image (2,02 Go),
   depth_anything_v2 (1,34 Go), krea2_raw_fp8 (13,1 Go), RealESRGAN_x4plus
   (67 Mo), ACE-Step 1.5 XL turbo (9,97 Go), BS-Roformer-SW (699 Mo),
   htdemucs_6s (55 Mo), AuraSR v2 (2,47 Go), FlashVSR (6,95 Go).
3. DGX1 : paquets `seconohe` et `tiktoken` (copie depuis DGX2) + un
   redémarrage de ComfyUI file vide ; son ComfyUI sert un ancien nœud Krea.
4. **Orchestration** (`docs/etudes/orchestration.md`) : ouvrir « tout en
   local » aux modèles propriétaires (Comfy Router, budget), pilote NVIDIA,
   sentinelle mémoire (la mémoire CUDA du GB10 échappe aux cgroups), prises
   connectées, VRAM réelle de l'eGPU 5090, nirva-agent comme agent de machine.
5. **Cloudflare** (`docs/etudes/cloudflare.md`) : 6 décisions ; **ne pas
   ouvrir de tunnel vers le portail** avant de lire l'identité signée de la
   porte (derrière un tunnel tout arrive de 127.0.0.1 et la règle « admin
   depuis le réseau de Cal » ne protégerait plus rien).
6. Porte : « tout le monde voit tout » par défaut ; quotas 1 simultané / 3 en
   file ; pseudo sans mot de passe (choix de Cal).
7. Movie Analysis : ajouter l'adresse du portail aux origines du Worker pour
   écrire les corrections (wrangler, session Cloudflare de Cal).
8. Movie Creator : `@element1` pour un élément (proposé, à confirmer).

## Machines

- DGX2 : le portail (`~/SHOWRUNNER_TOOLS`, `tools/portail.sh`, journal
  `~/showrunner.log`, données `~/showrunner-data`), ComfyUI :8188, H3 :8189
  arrêté au repos. DGX1 : miroir du code, ComfyUI :8188, studio Character
  Factory :8765, diarisation :10002. YuE2 et la séparation sont en miroir
  (`tools/mirror_yue.sh --check`, `tools/mirror_stems.sh --check`).
- Références clonées sur DGX2 : `/tmp/h3hf` (H3 Studio, MIT), `/tmp/odio01`
  (ODIO_01), `/tmp/sr_uikit/export` (kit UI de Cal).
