# Reprise — à lire en premier

**État au 05/10/2026, 23 h.** C'est la fin de la session cloud du 05/10 après-midi et soir. `main` est à jour et
en ligne : la mise à jour automatique le publie seule. Cinq branches `wip/…` attendent sur GitHub ; elles se
fusionnent sans conflit (essayé, § 2.A).

- Portail à la maison : **http://192.168.10.247:8790/** (DGX2 ; Tailscale http://100.108.108.65:8790/).
- Adresse publique : **https://showrunner.luxigone.workers.dev**. Un ami tape le pseudo que Cal lui a créé
  (Admin → « Ajouter quelqu'un »), sans code ni e-mail.
- Cal : `nico007` (admin, compte `cal`). Ce pseudo est écrit ici, dans un dépôt public : ne jamais allumer
  `admin-pseudo` sans en changer d'abord (§ 2.D).
- Secours : `ssh dgx2 'cd ~/SHOWRUNNER_TOOLS && python3 server/showrunner.py --admin nico007'`.

## 0. En trente secondes

1. **Fusionner les cinq branches `wip/…` (§ 2.A)**, dans l'ordre du tableau. `check.py` sur la fusion des
   cinq : voir § 2.A, ligne « essai de fusion ».
2. **Finir ce qui est à moitié (§ 2.B)** : la page des documents, la page de l'agent Showrunner,
   « Commencer un projet » de bout en bout, la Session d'ODIO refaite.
3. **Le nouveau, décidé, à coder (§ 2.C)** : Musique → Spaces, playlists, lien d'écoute (le lecteur d'AGOSTA).
4. En parallèle, **ce qui attend Cal (§ 2.D)** : coller les diagnostics, son compte rendu LoRA, le jeton R2.

## 1. Démarrer : quelle session es-tu ?

### Une session cloud (claude.ai/code), comme celle du 05/10

- **Le dépôt** est cloné dans le conteneur. Git s'y fait directement : on pousse sur `main` ET sur la branche
  `claude/…` de la session. **Pousser sur `main` suffit pour mettre en ligne** : le cron `tools/auto_maj.sh`
  de DGX2 le prend en 2 min (§ 4).
  - Si le clone est superficiel et qu'une fusion se plaint : `git fetch --deepen=300 origin main`.
- **Aucun accès aux DGX.** Rien ne se calcule ici ; tout ce qu'on lit des DGX passe par Admin → Diagnostics →
  **« Tout lancer et copier »** : Cal colle le texte dans le chat.
  - Un envoi automatique des diagnostics vers GitHub, même chiffré, a été **refusé par les permissions de la
    session** comme exfiltration. Ne pas le retenter par un autre chemin.
- **Voir une page en vrai** : `python3 tools/portail_essai.py` (port 8795, données jetables, connexion coupée,
  moteurs factices).
  - Un second portail : `python3 tools/portail_essai.py 8796 /tmp/autre`.
  - L'arrêter **par son PID**, jamais `pkill -f`, qui tue aussi le shell.
- **Playwright** : `require('/opt/node22/lib/node_modules/playwright')`, Chromium déjà installé (ne jamais
  lancer `playwright install`).
  - Le CDN jsdelivr et Google Fonts sont bloqués dans le conteneur ; le registre npm passe.
  - Pour three.js (la visionneuse 3D) : `npm pack three@0.170.0`, puis servir le paquet par `page.route`.
- **Vérifier** : `python3 tools/check.py`. Il tourne sans GPU et doit finir à 0 échec ; compter environ
  15 min.
- **Travailler en parallèle** : un agent par sujet, chacun dans sa copie (`git worktree add /home/user/wt_<b> -b <b> main`).
  La session principale seule fusionne, vérifie et pousse. Les agents ne poussent jamais.
- **Le dépôt d'AGOSTA** (`calculment0r/AGOSTA`, privé) n'est pas dans la session d'office. Pour le lecteur
  d'écoute (§ 2.C), l'ajouter (outil `add_repo`), puis
  `git clone --depth 1 https://github.com/calculment0r/agosta /home/user/agosta` (≈ 142 Mo).
- **Ce qui part avec le conteneur** : les copies `/home/user/wt_*` et les portails d'essai. Tout ce qui compte
  est sur GitHub (`main`, `wip/*`).

### La session du PC (Claude Code chez Cal)

Ses règles sont fermes ; elles sont dans `CLAUDE.md` et au § 5 plus bas.
- Chaque commande commence par `ssh dgx1`, `ssh dgx2` ou `scp`.
- Git se fait sur DGX2.
- Pas de python, de node ni de navigateur sur le PC.
- Pas d'artifact.

### Dans les deux cas

- Réponses en français, courtes, avec le lien pour tester. **Jamais d'émoticône.**
- Cal lit un **« point » en HTML** envoyé dans le chat à chaque session (le dernier :
  `point_showrunner_0510_soir.html`). C'est un fichier, pas un artifact.
- Chercher avant de faire, citer ses sources, ne rien inventer ; « non documenté » plutôt qu'une
  supposition.
- Thème : uniquement les jetons de `commun/tokens.css`, deux thèmes (`CLAUDE.md`).

## 2. LA LISTE DES TÂCHES

### 2.A Fusionner les branches `wip/…` (Claude, en premier)

Chaque dernier commit dit ce qui est fait et ce qui reste.

**Méthode :**
1. `git fetch origin 'refs/heads/wip/*:refs/remotes/origin/wip/*'`
2. `git merge --no-ff origin/wip/<b>`
3. `python3 tools/check.py` (0 échec attendu)
4. un essai Playwright de la page touchée
5. pousser `main`

**Essai de fusion du 05/10 au soir** : les cinq branches, fusionnées dans cet ordre sur une copie de `main`
(4da6194), passent **sans un seul conflit**. `check.py` sur cette fusion : RÉSULTAT_FUSION. `check.py` sur
`main` seul : RÉSULTAT_MAIN.

| ordre | branche | état | avant de fusionner |
|---|---|---|---|
| 1 | `wip/odio-pistes-secousse` (862731e) | **FINIE** | Cal valide la hauteur mini des pistes : 26 px au lieu de 48 |
| 2 | `wip/documents` (c3104b5) | serveur seul | rien ne casse sans la page ; la fusionner tôt, car `projet-ingest` s'appuie dessus |
| 3 | `wip/agent-showrunner` (bd3c65b) | serveur seul | idem |
| 4 | `wip/projet-ingest` (4595b96) | partielle | après 2 et 3 (leur contrat est dans son commit) ; essayer « Commencer » de bout en bout |
| 5 | `wip/odio-session2` (d44ea80) | à peine commencée | rien de branché : on peut la fusionner (le modèle ne gêne pas) ou la continuer sur sa branche |

`wip/entete` est déjà dans `main` (0467a1f) : la branche peut être effacée. `wip/travail-en-cours` est la
sauvegarde du PC, à ne pas toucher.

### 2.B Finir ce qui est à moitié (Claude)

**Documents dans la bibliothèque** (`wip/documents`, `server/tools/documents.py`)
- Fait :
  - la sorte `document` : tout fichier est accepté ;
  - le texte est extrait (txt, md, csv, html, docx, pptx, xlsx, odt/odp/ods, epub, rtf ; le PDF par poppler,
    sinon `doc.needs_page`) ;
  - une vignette, toujours ;
  - les images exotiques sont converties en PNG, et l'original reste téléchargeable ;
  - le service est sûr (`library.serve_policy`) : le reste part en pièce jointe, avec une CSP sandbox ;
  - `GET/POST /api/library/<id>/texte`.
- Reste :
  - `commun/documents.js` (`extraireDocument`, pdf.js 4.10.38 épinglé sur cdnjs) ;
  - la fiche « document » d'Asset (texte, Télécharger, pages en vignettes) ;
  - l'objet d'Idéation (`MEDIA_KINDS`, carte, liseuse, export PNG) ;
  - `dropZone` et `pick` ;
  - Playwright ;
  - relancer `check.py` en entier : la correction de l'essai EPS est venue après le dernier passage complet.

**L'agent Showrunner dans Idéation** (`wip/agent-showrunner`, étude `docs/etudes/agent_showrunner.md`)
- Fait, et vérifié contre `tools/faux_ollama.py` :
  - `POST /api/ideation/agent` : un tour par la file, travail `ideation.agent` sur la voie audio épinglée,
    modèle déchargé en fin de tour ;
  - les outils de lecture sont exécutés au serveur ; les écritures sont validées puis rendues en actions ;
  - `lancer` est faux par défaut : jamais un rendu sans la personne ;
  - la conversation est gardée par planche.
- Reste :
  - la PAGE : `ideation/agent.js` et `.css` (panneau façon Claude, vignettes au-dessus du champ, « Citer
    dans la discussion », actions cliquables, « Annuler ce tour » = un seul `app.mutate`) ;
  - `app.agent = {open, send, busy}` ;
  - Playwright ;
  - **le vrai modèle** : `/api/show` de `qwen3-vl-32b-32k` sur DGX2 a-t-il `tools` et `vision` ? par un
    diagnostic ;
  - `TEXTE_DOCUMENT` à rebrancher sur la sorte `document` ;
  - le contexte 32k ou 64k : à faire trancher par Cal.

**« Commencer un projet »** (`wip/projet-ingest`, étude `docs/etudes/mode_showrunner.md`)
- Fait :
  - « Commencer un projet » remplace « Répondre à un brief » : Idéation, plus une fenêtre d'ingestion où tout
    se dépose (le brief tapé ou déposé) ;
  - il crée la Team et son Workspace « Général », et ajoute des personnes ;
  - `entrerEspace(id)` dans `shell.js`, la progression d'`uploadFile`, `GET /api/equipes/personnes`.
- Reste :
  - l'essai de bout en bout ;
  - `check.py` sur ce code ;
  - un fichier au nom accentué (`repérage_rue.mp4`) qui manque par `setInputFiles` : à comprendre ;
  - lancer l'analyse de l'agent, une fois la page de l'agent faite.

**ODIO : la Session refaite** (`wip/odio-session2`, étude `docs/etudes/odio_session.md` § 6)
- Ce que Cal demande :
  - une couche VIERGE par-dessus l'arrangement : ses propres voies, la même horloge, et elle joue EN PLUS ;
  - Tab y passe ;
  - un design centré ;
  - « Envoyer à la Session » depuis un clip ou une plage (références non destructives) ;
  - une bibliothèque du PROJET ODIO, pour que les découpes n'encombrent pas Asset.
- Fait : le modèle de données dans `musique/projet.js`, non branché.
- Reste, dans l'ordre du § 6 :
  1. le moteur ;
  2. `music.py` (validation et `ID_FIELDS`) ;
  3. `session.js` et `.css` réécrits sur les voies ;
  4. Tab, Maj+Tab et les menus ;
  5. la rubrique « Projet » du navigateur ;
  6. les essais.

### 2.C Nouveau, décidé, à coder (Claude)

**Musique : Spaces, playlists, lien d'écoute.** Étude : `docs/etudes/musique_spaces_playlists.md`. Rien n'est
codé, tout est décidé (Cal, 05/10 au soir) :

- **Spaces** (le mot « Workspace » est pris) :
  - tout ce qu'on génère dans Musique va dans le Space courant ;
  - une variante, des stems ou un projet ODIO restent dans le Space de leur chanson ;
  - un Space qu'on crée est **partagé avec le Workspace** ; « Mon Space » est personnel ;
  - dans les données, le champ s'appelle `music_space` (`msp-…`), car `space` est déjà le Workspace.
- **Playlists** :
  - un objet `playlist` de la bibliothèque, qui prend tout son ;
  - glisser, réordonner, écouter ;
  - pochette, ordre suggéré (tempo, tonalité) ;
  - **paroles calées sans saisie** : stem voix, puis Transcrire en mots, puis l'alignement ;
  - volume égal (−14 LUFS) et enchaînements.
- **Lien d'écoute** :
  - le lecteur d'AGOSTA généralisé (`ecoute/`) ;
  - **sur Cloudflare par défaut** : une route `/ecoute/*` du Worker, plus R2 ;
  - le lien se retire, peut avoir un code ou une date de fin, et compte les écoutes ;
  - publier = `can_publish` ;
  - pas de mention de Showrunner sur le lecteur ;
  - un .zip en premier : il ne demande rien, et on l'essaie sur l'album AGOSTA.
- Ordre : celui du § 5 de l'étude. La destination Cloudflare attend le jeton R2 de Cal (§ 2.D).

### 2.D Ce qui attend Cal (gestes, réponses, essais)

**Gestes**
1. **Admin → Diagnostics → « Tout lancer et copier »**, puis coller dans le chat. On y lit :
   - la mise à jour : le journal avance-t-il seul, sans « VERROU TENU » ?
   - YuE2 : les paroles ignorées, encore ouvert ;
   - « LoRA · entraîneurs ».
2. **Le compte rendu de l'installation des LoRA** (`docs/INSTALL_LORA.md` § 6). Cal installait encore le 05/10
   au soir, depuis une session du PC.
3. **Le jeton R2** : le geste 9 de `docs/etudes/cloudflare.md`. Il sert au lien d'écoute ET à la bibliothèque
   quand les DGX sont éteintes.
   - Cal crée un jeton Object Read & Write limité au bucket `showrunner-bibliotheque`.
   - Il écrit lui-même `~/.config/showrunner/r2.json` sur DGX2 (chmod 600).
   - **Jamais la clé dans un chat.**
4. Régénérer le jeton du tunnel `dgx2`, passé dans un chat.
5. Clé TURN Cloudflare pour la visio stricte ; Workers Paid si besoin ; commiter
   `C:\claude\MOVIE_ANALYSE\outils\partage\worker.js`.
6. `admin-pseudo` (entrer en admin par le seul pseudo sur la porte) : fermé par défaut. Changer de pseudo
   admin avant de l'allumer (`bash tools/porte.sh admin-pseudo on`). On pourrait en faire un bouton d'Admin.
7. La planche de la réunion réalisateur : Admin → Diagnostics → `planche`. Jamais lancée ; les photos de
   Wikimedia Commons n'ont pas été essayées en vrai.

**Réponses attendues**
- La hauteur mini des pistes d'ODIO à 26 px : d'accord ?
- Le carnet de Transcrire toujours en français ? Aujourd'hui, le résumé sort dans la langue de
  l'enregistrement.
- Le contexte de l'agent Showrunner : 32k ou 64k ? Ollama conseille 64k pour un agent.
- « Je dois valider un compte que j'ai créé » : une capture de ce qui s'affiche.
- Toujours en suspens :
  - les études hors du dépôt public ?
  - le disque des attracteurs plafonné ?
  - les références au-delà de la limite ?
  - « Tasser » de Vidéo ?
  - la réserve mémoire de TRELLIS.2, de 40 à 15-20 Go ?
- Licences :
  - **Venus Rising et Norelli servies en webfonts sur l'adresse publique sans licence web** : les acheter,
    ou passer à des polices OFL (Unbounded, Syne, Fraunces, Instrument Serif, Inter Tight, Space Grotesk) ;
  - H3 non licencié dans l'UE : écrire à MiniMax, sinon repli sur LTX-2.5 ;
  - Qwen-Image 2.1 et YuE2 non commerciaux ;
  - la règle « tout en local » à réécrire avec Cal (local d'abord, API fermées avec budget, compte
    Comfy.org) ;
  - son abonnement Topaz.
- Téléchargements en attente de son accord :
  - Parakeet (2,5 Go) ;
  - BS-RoFormer SW ;
  - ACE-Step 1.5 base ;
  - ADTOF ;
  - Ming-Image (~26 Go, plus une mise à jour de ComfyUI) ;
  - Z-Image Base sur DGX2 (12,3 Go).

**Essais que Cal seul peut lancer** (sur les vrais modèles), puis lus par un diagnostic :
- la consigne du carnet de Transcrire (la fille de 17 ans : réponse à la 3e personne ?) ;
- la partition de Musique en Soigné : le plan réel, sortie PreviewAny, à vérifier au premier rendu ;
- le tempo d'ODIO sur sa musique ;
- les appareils et la Session d'ODIO à 60 images par seconde ;
- Multishot : un même plan avec et sans « écrire la durée de chaque plan » (H3 en tient-il compte ?) ;
- la voie audio sur DGX1 : deux rendus de musique d'affilée ;
- **la galerie des modèles d'Idéation** (bouton « Modèles » de la barre du haut) : vérifier que Cal la voit.

### 2.E Ensuite (feuille de route, Claude)

- LoRA :
  - brancher ce qui a marché chez Cal ;
  - un LoRA de moodboard dans une carte Générer, et dans la page Vidéo pour H3 ;
  - YuE2 (nœud ComfyUI) pas branché au portail.
- YuE2 qui ignore les paroles : corriger dès que les diagnostics parlent.
- Workspaces, phase B (`docs/etudes/equipes_espaces.md`) :
  - la garde du calcul par `cost` ;
  - `space` posé par chaque outil ;
  - le sélecteur Team / Workspace ;
  - le rapatriement.
- Le panneau Asset dans chaque outil : ODIO et le Montage ne le configurent pas encore ; leurs CSS sont
  encore en `@media`, et la barre d'ODIO déborde quand le panneau est ouvert.
- Téléphone : des mises en page dédiées (le portail sait qu'il est sur mobile : `data-appareil`).
- Slides : publication et PDF (avec Ming) ; agent stratégique ; package agences ; API fermées (si Cal les
  ouvre).
- Multishot : confirmer la grammaire de H3 (durée par plan, lien (S1) ↔ élément) dans les guides MiniMax de
  DGX1.

### 2.F Restes techniques connus

- **ODIO** :
  - la courbe du compresseur du nodal est fausse (`docs/etudes/odio_appareils.md`) ;
  - la timeline ne grise pas les pistes jouées en Session ;
  - Follow Actions ; warp ;
  - règles CSS mortes `.ar-ph`, `.ar-tri`, `.ae-now` (`musique.css`) ;
  - ODIO ne charge pas Google Fonts.
- **En-tête** : `analyse/diarisation/portail.css` copie encore la barre ; `asset.css` suppose 57 px au lieu
  d'utiliser `--sr-hdr-h`.
- **Éléments versionnés** :
  - les rendus automatiques à la première pose (séquence → MP4, personnage) ne sont pas branchés ;
  - `ev_seq` / `sr:elements` : le Montage relit encore toutes les 5 s ;
  - les noms français des sortes neuves dans `shell.js`.
- **Idéation** : l'export PNG ne dessine pas les objets Web ; le pilote « fils » garde 2 échecs Z-Image
  anciens (il attend `bad` là où la règle des références gardées donne `idle`).
- **Vidéo / H3** :
  - le mode Images d'H3 en Brouillon est forcé à 1 étage (2 étages hachent) ;
  - `admin.py` décrit encore `movie_engine` comme « H3TEST :8189 » ;
  - le message « DGX2 calcule déjà (lui-même) » dans `core/jobs.py _gpu_block`.
- **Personnages CF** : aucun n'a sa planche visage masqué ni ses 5 crops `.char` (l'import ne les ramène pas ;
  à fabriquer depuis `views/prepared/*` et `fullbody.png`).
- **Divers** :
  - écrêtage léger d'ACE et de YuE2 (ComfyUI ne borne pas) ;
  - Z-Image Base seulement sur DGX1 ;
  - Angle « left » à vérifier.
- **`docs/ARCHITECTURE.md`** : ajouter les apps Musique (`chanson.py`) et Transcrire, `strategie.py` et
  `commun/kit_nav.js`, `music_tempo.py`, `tools/portail_essai.py`.

## 3. Ce qui a été fait (le plus récent d'abord ; le détail : `git log`)

### Session cloud du 05/10 après-midi et soir

Une session et onze agents en parallèle, chacun dans sa copie, fusionnés ici. `check.py` : **2601 / 0** à la
dernière fusion complète (les 5 échecs anciens sont corrigés).

- **Mise à jour automatique : la panne et sa correction** (7c9af00).
  - La panne : un tour qui relançait le portail lui laissait son verrou (`flock`, descripteur 9). Chaque tour
    suivant s'arrêtait en silence, et DGX2 est resté figé sur 0573119 de 13:54 à 16:15.
  - La correction : les commandes lancées par un tour prennent `9>&-` ; `etat` dit qui tient le verrou et
    nomme les travaux qui font attendre. Cal a débloqué à la main. À surveiller : que le journal reprenne seul.
- **Idéation** :
  - export PNG → téléchargement et presse-papier (`POST /api/ideation/boards/<id>/png`, plus de volet ni
    d'Asset) ;
  - les poignées des formes suivent pendant le geste ;
  - couleur des flèches d'annotation (`color`, LINK_COLORS) ;
  - titres et notes en style « Aucun » par défaut, avec une barre façon Miro (`ideation/diapo/libre.js`) ;
  - menus de polices écrits dans leur police (`diapo/polices.js`) ;
  - bouton **Animer** ;
  - les **composants d'un élément** en vignettes à glisser (`POST /api/elements/<id>/part`) ;
  - **visionneuse 3D** sur la planche (`objets/modele3d.js`, `character/viewer.html?embed=1`) ;
  - **moodboard** (`objets/moodboard.js` : images OU sons) et son **LoRA** (`server/tools/lora.py`,
    `lora_trainers.py`) ;
  - la pastille « enregistré » ne clignote plus pendant un geste.
- **LoRA** : étude `docs/etudes/lora_entrainement.md` ; brief `docs/INSTALL_LORA.md`, donné à une session du PC.
- **ODIO** :
  - zoom fluide et grille partout (timeline.js, echelle) ;
  - tête de lecture par son onglet, corps de clip = temps, plages, Ctrl+E/J/D/L (comme Live) ;
  - appareils visuels (`musique/appareils/`, `odio_appareils.md`) ;
  - vue Session, ancien modèle, à refaire (§ 2.B) ;
  - **détecter le tempo** d'un clip audio (`tempo.js`, `bpm.js`, `music_tempo.py`).
- **Musique** : Soigné (YuE2) par défaut, avec « relire la partition avant de chanter » (`chanson.plan`).
- **Transcrire** :
  - texte et carnet sur un écran en deux colonnes ;
  - nouvelle consigne du carnet (3e personne, citations) ;
  - le carnet replie ses timecodes (« N passages cités ») ;
  - le son envoyé au Montage arrive dans le Projet.
- **Droits** : un ami Apps invité sur une planche la co-édite (le calcul reste refusé) ; les gestes du Studio
  sont cachés aux comptes Apps (`studioSeul`).
- **Lecteur commun** dans le Montage et Upscale (`commun/defilement.js`) ; les éléments versionnés dans le
  chutier du Montage.
- **Kit de présentation** :
  - un gros bouton « Positionnement » sur l'accueil (Cal seul), dans le même onglet ;
  - dans le kit, une barre d'accès direct (`commun/kit_nav.js`) ; Échap ramène au positionnement ;
  - `plan.json` facultatif.
  - **Cal ne veut pas de volet pour le kit.**
- **En-tête** : la navigation est au même x sur toutes les pages ; la barre du Montage est identique (0467a1f).
- **Admin → Diagnostics → « Tout lancer et copier »**.
- **Études du soir** : `musique_spaces_playlists.md` (décidée), `agent_showrunner.md`, `mode_showrunner.md`,
  `odio_session.md` § 6.

### Session du 01 au 05/10 matin

- **La mise à jour se fait toute seule** (`tools/auto_maj.sh`, § 4).
- **Admin → Diagnostics** (`server/tools/admin.py`, `DIAGS`) : une liste blanche de scripts lancés d'un clic.
  Pour une vérification nouvelle, l'ajouter là plutôt que de demander un terminal à Cal.
- **Plein écran** : Échap est gardé (`commun/pleinecran.js`) ; une page « dans un nouvel onglet » s'ouvre dans
  un volet (`commun/coquille.js`). Le kit est l'exception, depuis le 05/10.
- **Pavé tactile** sans réglage (`commun/molette.js`).
- **Idéation** : fluidité ; nuancier ; panneau Diapositives ; **galerie des modèles** (`ideation/galerie.js`).
- **Vidéo (H3)** : une réplique citée devient `(S1) says: …` ; **panneau Multishot** (`commun/multishot.js`).
- **Montage** : barres de lecture ; lecture sous le moniteur ; format affiché.
- **Admin** : supprimer un compte ; `porte.admin_pseudo` (fermé par défaut).
- **Application sur l'écran d'accueil** : `data-appareil`, `data-tactile`, `data-standalone`.
- **Planche de la réunion** : `tools/board_reunion.py`.

### Câblage : tout est sur les vrais modèles (30/09)

- `showrunner.local.json` de DGX2 :
  - `image_backend: comfyui`, `upscale_backend: comfyui` ;
  - `movie_engine: h3`, avec `lanes.h3 = [127.0.0.1:8188, 169.254.110.6:8188]` ;
  - `music_engine: ace-step`, `music_yue`, `music_stems`, `music_midi`, `chanson_paroles: true` ;
  - `transcrire_moteur: local`, `objet_trellis: true` ;
  - `ideation_ice_servers` = STUN Cloudflare.
- La voie audio est sur les deux DGX.
- Temps mesurés :

| modèle | temps |
|---|---|
| Z-Image | ~15 s |
| Qwen 2.1 | 10-80 s |
| Krea 2 | 30-60 s |
| H3 Brouillon | ~6 min 50 |
| H3 Qualité | ~15 min 20 |
| ACE | ~30 s |
| YuE2 | ~40 s |
| Whisper (Wall, 139 s de son) | 15 s |
| TRELLIS.2 | ~2 min 20 |

### En ligne les 29-30/09

- Porte par pseudo : Worker, tunnel et Workers VPC, mode `code`.
- ODIO rhabillé ; molette commune ; références ; Upscale ; Montage.
- Movie Analysis ; les apps **Transcrire** et **Musique** ; accueil Apps / Studio.
- Idéation ; plein écran et panneaux détachables.
- Droit Studio ; **éléments versionnés** ; Object Creator (TRELLIS.2).
- **Lecteur commun** ; **panneau Asset** (Ctrl+Espace).

## 4. Comment ça se met en ligne

- **`tools/auto_maj.sh`** (cron de DGX2, toutes les 2 min) :
  1. `git fetch`, puis `reset --hard origin/main` ;
  2. relance le portail si `server/` a changé, mais attend si `jobs.json` a un calcul en cours ou en file ;
  3. `tools/porte.sh deploie` si autre chose que `docs/` a changé ;
  4. recale DGX1.
- Le journal est dans `~/showrunner-maj.log` (`bash tools/auto_maj.sh etat`, et le diagnostic `maj`).
- Côté Cal, Ctrl+Maj+R pour voir les nouvelles pages.
- GitHub Actions (`.github/workflows/porte.yml`) : inactif tant que les secrets Cloudflare ne sont pas posés ;
  inutile depuis `auto_maj`.

## 5. Travailler depuis le PC (règles fermes de Cal)

- **Chaque commande commence par `ssh dgx1 `, `ssh dgx2 ` ou `scp `.** Sur le PC : Read, Write, Edit, Glob,
  Grep seulement (pas de `mkdir`, ni `cd … &&` en local) ; pas d'artifact. À répéter en tête de chaque brief
  d'agent : presque tous ont fauté une fois.
- **Git sur DGX2, un seul intégrateur (la session principale) ; les agents ne poussent jamais.**
  - Chaque agent a sa copie `/tmp/sr_<nom>`, son port et ses données. Il possède ses fichiers ; le partage se
    négocie par message.
  - Déployer :
    1. `/tmp/sr_deploy` ← `git reset --hard origin/main` ;
    2. y copier **depuis la copie testée de l'agent**. D'un fichier partagé, n'extraire que la part de l'agent
       (`git merge-file` avec la base commune) ;
    3. `python3 tools/check.py`, commit, push. `auto_maj` fait le reste.
- **Rendus réels** :
  - un verrou par machine (`flock /tmp/sr_gpu_dgx1.lock` / `dgx2`) ;
  - la mémoire vérifiée avant ; `/free` après, seulement si la file ComfyUI est vide ;
  - ni téléchargement ni redémarrage de service sans l'accord de Cal.
- **wrangler jamais depuis `~`** : il crée `~/.wrangler` et se croit déconnecté ; `rm -rf ~/.wrangler` répare.
- Le PC est sauvegardé toutes les 30 min sur `wip/travail-en-cours`.
- Jamais `pkill -f` par motif : par PID.
- Bloqueurs de pub : vérifier chaque nouveau nom de fichier (`/tmp/easyprivacy.txt`, `/tmp/easylist.txt`).
- **Cal déteste les pages tierces imposées** (Cloudflare Access retiré le 29/09) : montrer l'expérience avant
  de déployer ce qui touche l'entrée.

## 6. Les études

- Dans le dépôt (`docs/etudes/`) : `equipes_espaces.md`, `panneau_asset.md`, `fenetres.md`, `transcrire.md`,
  `musique_app.md`, `musique_spaces_playlists.md`, `apps_studio_elements.md`, `ideation_collab.md` (§ 10 :
  visio), `lora_entrainement.md`, `odio_appareils.md`, `odio_session.md`, `cloudflare.md`, et sur les
  branches : `agent_showrunner.md`, `mode_showrunner.md`.
- Sur le PC seulement (question posée à Cal : les mettre dans le dépôt public ?) : `positionnement.md`
  (13 décisions), `modeles.md` (7), `pipeline_video.md` (10), `presentations.md` (11), `agent_brief.md` (8),
  `package_export.md` (10).

## 7. Machines

- **DGX2** :
  - le portail (`~/SHOWRUNNER_TOOLS`, `tools/portail.sh`, `~/showrunner.log`, données `~/showrunner-data`) ;
  - la porte 9790, `cloudflared.service` ;
  - ComfyUI :8188 (image, audio, recette H3) ; H3TEST :8189 arrêté ;
  - Ollama (`qwen3-vl-32b-32k`, 31 Go).
- **DGX1** : miroir, ComfyUI :8188, studio CF :8765, diarisation :10002 ; câble direct 169.254.110.6.
- La 3090 (`vfx-3090`, Windows) : hors ligne.
