# Reprise — à lire en premier

État au 05/10/2026 au soir (session cloud de l'après-midi, `main` = cb2a140 et suivants). Portail à la maison :
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

## Session cloud du 05/10 après-midi (une session, 11 agents en parallèle, chacun dans sa copie, fusionnés ici)

Tout est sur `main`, en ligne, et `tools/check.py` passe : **2601 / 0** (les 5 échecs anciens sont corrigés).

- **Mise à jour automatique : LA PANNE et sa correction** (7c9af00). Un tour qui relançait le portail lui
  laissait son verrou (`flock`, descripteur 9) : chaque tour suivant s'arrêtait en silence, DGX2 est resté figé
  sur 0573119 de 13:54 à 16:15. Les commandes lancées par un tour prennent maintenant `9>&-` ; `etat` dit qui
  tient le verrou et nomme les travaux qui font attendre. À surveiller : que le journal reprenne seul.
- **Idéation** : export PNG → téléchargement + presse-papier (`POST /api/ideation/boards/<id>/png`, plus de
  volet ni d'Asset) ; poignées des formes qui suivent pendant le geste ; couleur des flèches d'annotation
  (`color`, LINK_COLORS) ; titres et notes en style « Aucun » par défaut, avec une barre façon Miro
  (`ideation/diapo/libre.js` : police, taille, couleur, fond, alignement) ; menus de polices écrits dans leur
  police (`diapo/polices.js`, fontMenu) ; bouton **Animer** (le mode Présentation, barre du haut et
  diapositive) ; **composants d'un élément** en vignettes à glisser (panneau de droite ; `POST
  /api/elements/<id>/part`) ; **visionneuse 3D** sur la planche (`objets/modele3d.js`, character/viewer.html en
  `?embed=1`, éclairage et canal par message) ; **moodboard** (`objets/moodboard.js` : images OU sons, carte fixe,
  double-clic pour tout voir) et son **LoRA** (`server/tools/lora.py` : à jour / périmé, maintenant ou la nuit,
  versions ; `lora_trainers.py` : ai-toolkit et ACE-Step d'après le manifeste `~/trainers/sr_lora.json`).
  « Pastille enregistrée » qui ne clignote plus pendant un geste (coedition.js ; l'annulation était déjà juste).
- **LoRA** : étude `docs/etudes/lora_entrainement.md` ; brief `docs/INSTALL_LORA.md`, donné à une session du PC.
  **Cal installait encore le 05/10 au soir** : attendre son compte rendu (§ 6 du brief), puis vérifier
  Admin → Diagnostics → « LoRA · entraîneurs ». Reste : utiliser un LoRA de moodboard dans une carte Générer
  (et la page Vidéo pour H3) ; YuE2 (nœud ComfyUI) pas branché au portail.
- **ODIO** : zoom fluide et grille partout, par-dessus les clips (timeline.js, echelle) ; tête de lecture par son
  onglet, corps de clip = temps, plages, Ctrl+E/J/D/L (comme Live) ; appareils visuels (`musique/appareils/`,
  étude `odio_appareils.md`) ; la Console devient la **vue Session** (`session.js`, étude `odio_session.md`,
  `scenes`/`slots`/`launch` dans le projet) ; **détecter le tempo** d'un clip audio (`tempo.js`, `bpm.js`).
  Restes : la courbe du compresseur du nodal (fausse, voir odio_appareils.md) ; timeline qui ne grise pas les
  pistes jouées en Session ; Follow Actions ; warp.
- **Musique** : Soigné (YuE2) par défaut, avec « relire la partition avant de chanter » (`chanson.plan`) ; le
  plan réel (sortie PreviewAny) est **à vérifier au premier rendu**.
- **Transcrire** : texte et carnet sur un écran en deux colonnes ; nouvelle consigne du carnet (3e personne,
  citations, `<transcript>` encadré) **à essayer sur le vrai modèle** (la fille de 17 ans) ; le son envoyé au
  Montage arrive dans le Projet.
- **Droits** : un ami Apps invité sur une planche la co-édite (le lien ouvre CETTE planche ; le calcul reste
  refusé) ; les gestes du Studio cachés aux comptes Apps (`studioSeul`, `studio: true` des menus).
- **Lecteur commun** dans le Montage et Upscale (`commun/defilement.js`) ; les éléments versionnés dans le
  chutier du Montage ; `ev_seq` / `sr:elements` (le Montage relit encore toutes les 5 s : à brancher).
- **Kit de présentation** : un gros bouton « Positionnement » sur l'accueil (Cal seul), même onglet ; dans le
  kit, une barre d'accès direct (`commun/kit_nav.js`, ajoutée au service, le kit n'est pas touché) et Échap →
  le positionnement ; `plan.json` facultatif pour l'ordre. **Cal ne veut pas de volet pour le kit.**
- **Admin → Diagnostics → « Tout lancer et copier »** : tous les diagnostics, un seul texte au presse-papier.
  (Un envoi automatique vers GitHub, même chiffré, a été refusé par les permissions de la session cloud.)

## PREMIER GESTE DE LA SESSION SUIVANTE

1. Admin → Diagnostics → « Tout lancer et copier » : demander à Cal de coller le texte. Y lire : la mise à jour
   (le journal avance-t-il seul ? pas de « VERROU TENU »), YuE2 (paroles ignorées, encore ouvert), LoRA.
2. LoRA : le compte rendu de l'installation de Cal (docs/INSTALL_LORA.md § 6) → brancher ce qui a marché ;
   puis un LoRA de moodboard dans la carte Générer.
3. Essais à faire faire à Cal (rien ne s'essaie ici sans GPU) : la consigne du carnet de Transcrire, la
   partition de Musique (Soigné), le tempo d'ODIO sur sa musique, les appareils et la Session d'ODIO à 60 i/s.
4. Toujours ouverts : comptes « à valider » (une capture de Cal), planche de la réunion (Diagnostics →
   `planche`), téléphone (mises en page dédiées), licences.

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
