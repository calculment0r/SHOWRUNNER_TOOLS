# Reprise — à lire en premier

État au 30/09/2026, fin de session (commit ba8205b). Portail à la maison :
**http://192.168.10.247:8790/** (DGX2 ; Tailscale http://100.108.108.65:8790/).
**Adresse publique : https://showrunner.luxigone.workers.dev** — un ami tape le
pseudo que Cal lui a créé (Admin → « Ajouter quelqu'un »), sans code ni e-mail.
Cal : `nico007` (admin, compte `cal`) ; par l'adresse publique, un admin entre avec
le lien admin (Admin → « Montrer le lien admin », ou `bash tools/porte.sh lien`).
Secours : `ssh dgx2 'cd ~/SHOWRUNNER_TOOLS && python3 server/showrunner.py --admin nico007'`.
L'état des lieux lisible par Cal (HTML) : scratchpad de la session du 30/09,
`etat_des_lieux.html`.

## PREMIER GESTE DE LA SESSION SUIVANTE : le socle Team / Workspace (prêt, PAS en ligne)

Codé et essayé, gardé hors ligne pour le faire au calme : copie testée
**`/tmp/sr_espaces`** sur DGX2 (base 08c8917 ; ses fichiers n'ont pas bougé
depuis sur origin — revérifier), aussi sur le PC : `server/core/espaces.py`,
`server/tools/equipes.py`, `tools/migrer_espaces.py` (neufs), `server/core/auth.py`,
`server/core/http.py`, `admin/admin.js`, `admin/admin.css`, `admin/prefs.json`,
`docs/etudes/equipes_espaces.md`. check.py : 1705 / 0 sur la copie.
Décisions de Cal (30/09) : « Team » et « Workspace » à l'écran ; le guest est
**viewer ou acteur**, réglé dans l'admin ; un guest ne calcule jamais ; favoris
partagés par team et workspace ; les clics d'aujourd'hui restent.
Pour le mettre en ligne :
1. assembler depuis `/tmp/sr_espaces` (check.py), commit, push ;
2. `porte/worker.js` : ajouter `x-sr-espace` à `EN_TETES_TRANSMIS`, puis `tools/porte.sh deploie` ;
3. **portail arrêté**, `python3 tools/migrer_espaces.py --vraies-donnees` (sauvegarde
   `sauvegarde-espaces-<date>/` faite avant ; sur la copie : Nirvalab + Général, 395
   fichiers passés à `space: esp-general`, rien perdu, 2ᵉ passe vide), puis relancer ;
4. faire un guest répond 409 tant que les étapes 1 (garde du calcul dans
   `jobs.submit` : `espaces.garde_prete("calcul")`) et 2 (appartenance au workspace :
   `garde_prete("bibliotheque")`) ne sont pas faites — c'est voulu.
Ensuite (phase B, en parallèle, un agent par étape / par outil) : étape 1 garde du
calcul (chaque sorte déclare `cost` gpu | api | cpu | none), étape 2 `space` posé par
`library._owned` et dans chaque outil qui réécrit ses documents (ODIO `save_project`
ne garde que owner / shared / origin), étape 4 en-tête `X-SR-Espace` posé par `api()`
et le sélecteur Team / Workspace, étape 5 Asset tous workspaces + rapatriement
(`POST /api/espaces/<courant>/rapatrier`, copie neuve, `origin.from`), budget,
éléments entre workspaces ; puis le **panneau Asset branché dans chaque outil**
(`dock.configure`, `dock.contexte`, `declareZone` : voir l'en-tête de `commun/dock.js`),
la bibliothèque MIDI d'ODIO sur tous les workspaces, le Montage garde « Projet ».

## Travailler ici (règles fermes de Cal)

- **Chaque commande commence par `ssh dgx1 `, `ssh dgx2 ` ou `scp `.** Sur le PC :
  Read, Write, Edit, Glob, Grep seulement (pas de `mkdir`, ni `cd … &&` en local) ; pas
  d'artifact. À répéter en tête de chaque brief d'agent (presque tous ont fauté une fois).
- **Git sur DGX2, un seul intégrateur (la session principale), les agents ne poussent
  jamais.** Chaque agent : sa copie `/tmp/sr_<nom>`, son port, ses données ; il
  possède ses fichiers, le partage se négocie par message. Déployer : `/tmp/sr_deploy`
  ← `git reset --hard origin/main`, y copier **depuis la copie testée de l'agent** (le
  PC mêle des travaux en cours ; d'un fichier partagé, n'extraire que la part de l'agent :
  `git merge-file` avec la base commune), `python3 tools/check.py`, commit, push, puis
  `cd ~/SHOWRUNNER_TOOLS && git fetch && git reset --hard origin/main && tools/portail.sh restart`,
  **puis `bash tools/porte.sh deploie`** (sinon l'adresse publique garde les anciennes
  pages), et DGX1 : `ssh dgx@169.254.110.6 "cd ~/SHOWRUNNER_TOOLS && git fetch -q && git reset -q --hard origin/main"`.
- **Rendus réels : un verrou par machine** (`flock /tmp/sr_gpu_dgx1.lock` / `dgx2`),
  mémoire vérifiée avant, `/free` après seulement si la file ComfyUI est vide ; pas de
  téléchargement ni de redémarrage de service sans l'accord de Cal.
- **wrangler jamais depuis `~`** (il crée `~/.wrangler` et se croit déconnecté :
  `rm -rf ~/.wrangler` répare).
- Le PC est sauvegardé toutes les 30 min sur `wip/travail-en-cours` ; `main` = en ligne.
- Jamais `pkill -f` par motif : par PID. Bloqueurs de pub : vérifier chaque nouveau nom
  de fichier (`/tmp/easyprivacy.txt`, `/tmp/easylist.txt`).
- **Cal déteste les pages tierces imposées** (Cloudflare Access retiré le 29/09) :
  montrer l'expérience avant de déployer ce qui touche l'entrée.

## Câblage : tout est sur les vrais modèles (30/09)

`showrunner.local.json` de DGX2 : `image_backend: comfyui`, `upscale_backend: comfyui`,
`movie_engine: h3` avec `lanes.h3 = [127.0.0.1:8188, 169.254.110.6:8188]` (la recette de
Cal tourne sur les ComfyUI 0.37.2 :8188, pas sur H3TEST :8189), `music_engine: ace-step`,
`music_yue`, `music_stems`, `music_midi`, `chanson_paroles: true`,
`transcrire_moteur: local`, `objet_trellis: true`, `ideation_ice_servers` = STUN
Cloudflare. Temps mesurés : Z-Image ~15 s, Qwen 2.1 10-80 s, Krea 2 30-60 s, H3
Brouillon ~6 min 50, Qualité ~15 min 20, ACE ~30 s, YuE2 ~40 s, Whisper (Wall 139 s) 15 s,
TRELLIS.2 ~2 min 20. Restes : mode Images d'H3 en Brouillon forcé à 1 étage (2 étages
hachent) ; **aucun personnage CF n'a sa planche visage masqué ni ses 5 crops `.char`**
(l'import ne les ramène pas ; à fabriquer depuis `views/prepared/*` et `fullbody.png`) ;
écrêtage léger d'ACE / YuE2 (ComfyUI ne borne pas) ; `admin.py` décrit encore
`movie_engine` comme « H3TEST :8189 » ; message « DGX2 calcule déjà (lui-même) » dans
`core/jobs.py _gpu_block` ; Z-Image Base seulement sur DGX1 ; Angle « left » à vérifier.
Téléchargements en attente de Cal : Parakeet (2,5 Go), BS-RoFormer SW, ACE-Step 1.5
base, ADTOF, Ming-Image (~26 Go + mise à jour ComfyUI), Z-Image Base sur DGX2 (12,3 Go).

## En ligne les 29-30/09 (voir `git log` pour le détail)

Porte par pseudo (Worker + tunnel + Workers VPC, mode `code`, `invitation: false`,
médias servis par plages) ; ODIO rhabillé (aimant, étiquette de piste, attracteurs et
fils en espace écran, export par tranches, piano roll, thème clair) ; molette commune ;
références (`commun/refs.js`) ; Upscale (pile, rideau) ; Montage (effets, calques FX,
groupes, fondus, LUT) ; Movie Analysis ; apps **Transcrire** et **Musique** ; accueil
Apps / Studio (NIRVALAB, SHOWRUNNER, médias de Cal) ; Idéation (bibliothèque → panneau
commun, cartes Générer, diapositives + présentation, barres façon Miro, cadres, son,
Web, fils en espace écran) ; plein écran et panneaux détachables (`commun/fenetre.js`) ;
droit Studio ; **éléments versionnés** (Asset, Montage, ODIO) ; Object Creator
(TRELLIS.2) ; **lecteur commun** (`commun/lecteur.js`, `tete.js`, copie de défilement
`/api/defil`) ; **panneau Asset** (`commun/dock.js`, Ctrl+Espace / ²). Morceau vitrine
« Verre fumé » sur le compte de Cal.

## Restes techniques connus

- Panneau Asset : ODIO, Montage et les autres outils ne le configurent pas encore ; leurs
  CSS sont encore en `@media` (la barre d'ODIO déborde panneau ouvert) ; ancien pilote
  `/tmp/sr_ide_biblio_pilote.mjs` périmé (`/tmp/sr_dock_pilote.mjs` le remplace).
- Lecteur commun pas encore dans `commun/fil.js` (Image, Vidéo), Upscale, Movie
  Analysis, Idéation ; le Montage n'utilise pas encore la copie de défilement ; règles
  CSS mortes `.tl-ph`, `.tl-marks .mk` (montage.css), `.ar-ph`, `.ar-tri`, `.ae-now` (musique.css).
- Éléments versionnés : rendus automatiques à la première pose (séquence → MP4,
  personnage) pas branchés ; `ev_seq` dans `/api/jobs` ; noms français des sortes neuves
  dans `shell.js` ; le chutier du Montage ne liste pas les éléments.
- Droit Studio : un ami Apps invité sur une planche reçoit 403 sur la co-édition ;
  « Envoyer au Montage » / « Ouvrir ODIO » non cachés aux comptes Apps.
- `docs/ARCHITECTURE.md` : ajouter `tete.js`, `lecteur.js`, `dock.js`, `/api/defil`,
  `/api/asset/dock`, `elements.py`, `apercu_son.py`, `web_apercu.py`, `defilement.py`.
- Export PNG d'une planche : pas les objets Web ; pilote « fils » d'Idéation : 2 échecs
  Z-Image anciens (il attend `bad` là où la règle des références gardées donne `idle`).

## Les études (PC seulement, pas dans le dépôt public — question posée à Cal)

`docs/etudes/positionnement.md` (13 décisions), `modeles.md` (7), `pipeline_video.md`
(10), `presentations.md` (11, avec la section « Fait le 30/09 »), `agent_brief.md` (8),
`package_export.md` (10). Dans le dépôt : `equipes_espaces.md`, `panneau_asset.md`,
`fenetres.md`, `transcrire.md`, `musique_app.md`, `apps_studio_elements.md`, `ideation_collab.md` § 10 (visio).
**Alertes de licence** : H3 non licencié dans l'UE (écrire à MiniMax ; repli LTX-2.5) ;
Qwen-Image 2.1 et YuE2 non commerciaux ; **Venus Rising et Norelli servies en webfonts
sur l'adresse publique sans licence web** (acheter, ou OFL : Unbounded, Syne, Fraunces,
Instrument Serif, Inter Tight, Space Grotesk) ; règle « tout en local » de `CLAUDE.md` à
réécrire avec Cal (local d'abord, API fermées avec budget, compte Comfy.org).

## Ce qui attend Cal

1. Répondre : études hors du dépôt ? disque des attracteurs plafonné ? références au-delà
   de la limite ? « Tasser » de Vidéo ? réserve mémoire TRELLIS.2 40 → 15-20 Go ?
2. Les licences ci-dessus ; son abonnement Topaz ; compte Comfy.org ; les téléchargements.
3. Régénérer le jeton du tunnel `dgx2` (passé dans le chat) ; clé TURN Cloudflare pour la
   visio stricte ; Workers Paid si besoin ; commiter `C:\claude\MOVIE_ANALYSE\outils\partage\worker.js`.
4. Prochaine session (fresh start) : workspaces en ligne + phase B, panneau dans chaque
   outil, slides publication / PDF (+ Ming), agent stratégique, package agences, API fermées.

## Machines

- DGX2 : portail (`~/SHOWRUNNER_TOOLS`, `tools/portail.sh`, `~/showrunner.log`, données
  `~/showrunner-data`), porte 9790, `cloudflared.service`, ComfyUI :8188 (image, audio,
  H3 recette), H3TEST :8189 arrêté. DGX1 : miroir, ComfyUI :8188, studio CF :8765,
  diarisation :10002. La 3090 (`vfx-3090`, Windows) hors ligne.
