# Reprise — à lire en premier

État au 05/10/2026, fin de session (commit 1ad5ebb, sur `main`). Portail à la maison :
**http://192.168.10.247:8790/** (DGX2 ; Tailscale http://100.108.108.65:8790/).
**Adresse publique : https://showrunner.luxigone.workers.dev** — un ami tape le
pseudo que Cal lui a créé (Admin → « Ajouter quelqu'un »), sans code ni e-mail.
Cal : `nico007` (admin, compte `cal`).
Secours : `ssh dgx2 'cd ~/SHOWRUNNER_TOOLS && python3 server/showrunner.py --admin nico007'`.

## Session du 01-05/10 : ce qui a changé dans la façon de travailler

- **La mise à jour se fait toute seule** (`tools/auto_maj.sh`, installé sur DGX2 le 05/10) :
  un cron passe toutes les 2 min. Il fait `git fetch` puis `reset --hard origin/main` ; il
  relance le portail si `server/` a changé, mais attend si `jobs.json` a un calcul en cours
  ou en file. Il lance `tools/porte.sh deploie` si autre chose que `docs/` a changé, puis
  recale DGX1. Le journal est dans `~/showrunner-maj.log` (`bash tools/auto_maj.sh etat`).
  **Pousser sur `main` suffit donc pour mettre en ligne** ; ensuite, Ctrl+Maj+R côté Cal.
- **Admin → Diagnostics** (`server/tools/admin.py`, `DIAGS`) : liste blanche de scripts
  lancés d'un clic, avec leur sortie à l'écran. Cal n'a plus à copier de commandes :
  `maj`, `voies`, `yue`, `yue_wf`, `yue_miroir`, `director`, `planche_plan`, `planche`.
  Pour ajouter une vérification, la mettre là au lieu de demander un terminal à Cal.
- Une session cloud (claude.ai/code) pousse directement sur `main`, ainsi que sur sa
  branche `claude/…`. Cal n'a donc rien à faire sur le PC.
- Rapport lisible par Cal : un HTML envoyé dans le chat (pas d'artifact), avec un
  « point » par session.

## Fait du 01 au 05/10 (détail : `git log --since=2026-10-01`)

- Plein écran : Échap gardé (Keyboard Lock, `commun/pleinecran.js`). Une page du portail
  ouverte « dans un nouvel onglet » (kit de présentation, Révéler dans Asset, Ouvrir ODIO)
  s'ouvre dans un **volet** par-dessus l'outil (`commun/coquille.js`, `ouvrirAcote`,
  `window.open` intercepté), et le plein écran tient.
- Pavé tactile sans réglage (`commun/molette.js`, `brancherCanvas`) : Idéation et ODIO
  (nodal, attracteurs) ; deux doigts déplacent, pincer zoome.
- Idéation :
  - la fluidité : plus de mise en page forcée par événement de molette (taille et boîte
    du canvas en cache, mini-carte, cadre de sélection, curseurs de co-édition) ;
  - le nuancier se déplace, avec « Copier #hex » au clic droit ;
  - le panneau Diapositives est lisible ;
  - **la galerie des modèles** (`ideation/galerie.js`) : 5 présentations motion, 5
    statiques, 5 ateliers. Elle est sur une planche vide, dans le menu Modèles du dock,
    et derrière un **bouton « Modèles » de la barre du haut**, à côté de Présenter
    (1ad5ebb). Cal la cherchait (« ils sont où les modèles ? ») : **vérifier qu'il la voit**.
- Vidéo (H3) :
  - une réplique citée devient `(S1) says: <d>[French] …</d>`
    (`server/tools/movie.py`, `speech_to_h3`), au lieu d'une voix de narrateur ;
  - **panneau Multishot** (`commun/multishot.js`, `multishot_texte.js`) : frise de plans
    à poignées, prompt et répliques par plan, mode auto, qui écrit les `[Shot n]`. On
    l'ouvre par la puce « multishot… » de Vidéo et des cartes vidéo d'Idéation. Inspiré
    du nœud « Bernini Director » de ComfyUI (`tools/diag_director.py`). A/B à faire sur
    l'écriture des durées (case décochée par défaut).
- Montage : barres de lecture au fader du thème, lecture sous le moniteur programme, le
  cadre vidéo distinct du fond, format affiché.
- Asset : moins de petit texte.
- Admin :
  - le lien admin reste affiché, avec « Copier le message » ;
  - on peut supprimer un compte (`auth.delete_user`, `espaces.forget_user` ; ses objets
    restent) ;
  - `porte.admin_pseudo` permet à un admin d'entrer par son seul pseudo sur la porte.
    C'est le choix de Cal, mais l'option est **fausse par défaut** : Cal l'allume avec
    `bash tools/porte.sh admin-pseudo on`. Ce n'est pas encore fait ; on pourrait en
    faire un bouton d'Admin.
- Musique : la voie audio passe sur les deux DGX (`tools/voie.py audio dgx2 dgx1`, fait
  par Cal).
- Application sur l'écran d'accueil : manifeste, icônes, plein écran iOS ;
  `data-appareil` (mobile, tablette, ordi), `data-tactile` et `data-standalone` posés sur
  `<html>` (`commun/theme-tot.js`).
- Planche de la réunion réalisateur (establishing shots, Montparnasse 1920-1929, Team
  « LES ANEES FOLLES ») : `tools/board_reunion.py` (23 cadres, photos de la bibliothèque
  et de Wikimedia Commons). On la crée par Admin → Diagnostics → `planche`. **Pas encore
  lancée par Cal**, et les photos de Commons n'ont pas été essayées en vrai.
- Déploiement par GitHub Actions (`.github/workflows/porte.yml`) : inactif tant que les
  secrets Cloudflare ne sont pas posés. Il ne sert plus vraiment, puisque `auto_maj`
  publie déjà.

## PREMIER GESTE DE LA SESSION SUIVANTE

1. Vérifier que `1ad5ebb` est en ligne : Admin → Diagnostics → `maj`, ou `auto_maj.sh etat`.
   Demander ensuite à Cal s'il voit le bouton « Modèles » de l'Idéation.
2. **Paroles de YuE ignorées** : le câblage du code paraît bon, mais la cause n'est pas
   trouvée. Il faut les sorties de Diagnostics → `yue` et `yue_wf` (ce que YuE2 a reçu,
   et les workflows de Cal comparés au graphe du portail), puis corriger.
3. Comptes créés « à valider » : Cal s'en plaint, alors que le code les crée actifs. Lui
   demander ce qu'il voit exactement (capture d'écran).
4. Planche de la réunion : la lancer (Diagnostics → `planche`), puis la regarder.
5. `tools/check.py` : 5 échecs anciens, présents avant la session. Les stems sortent en
   « unknown format 65534 », plus ODIO et la garde `music.yue.abc`. Ils sont à corriger.
6. Backlog : mises en page mobiles, panneau Asset dans ODIO et le Montage, lecteur commun
   ailleurs, `docs/ARCHITECTURE.md`, 403 du droit Studio, licences (voir plus bas).

Le socle Team / Workspace (`server/core/espaces.py`, en-tête `x-sr-espace` dans le Worker)
est dans `main`. La phase B (garde du calcul par `cost`, `space` posé par chaque outil,
sélecteur Team / Workspace, rapatriement) reste à vérifier puis à poursuivre :
voir `docs/etudes/equipes_espaces.md`.

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
