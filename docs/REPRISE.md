# Reprise — à lire en premier

**État au 06/10/2026.** Session cloud du 06/10 : une session principale et une trentaine d'agents en parallèle,
chacun dans sa copie, fusionnés et vérifiés lot par lot, poussés sur `main` à chaque lot (`check.py` complet à
0 échec avant chaque poussée ; dernier passage complet : **3544 / 0**). La mise à jour automatique de DGX2 publie
seule. Les branches de la session : `claude/adoring-turing-op7th8` (l'intégration, égale à `main`) et
`wip2/<sujet>` (une par agent, toutes fusionnées sauf celles marquées « en cours » au § 2.A).

- Portail à la maison : **http://192.168.10.247:8790/** (DGX2 ; Tailscale http://100.108.108.65:8790/). Il ne
  passe pas par Cloudflare : le préférer à la maison (§ 2.D, le compte des requêtes).
- Adresse publique : **https://showrunner.luxigone.workers.dev**. Un ami tape le pseudo que Cal lui a créé
  (Admin → « Ajouter quelqu'un »), sans code ni e-mail.
- Cal : `nico007` (admin, compte `cal`). Ce pseudo est écrit ici, dans un dépôt public : ne jamais allumer
  `admin-pseudo` sans en changer d'abord (§ 2.D).
- Secours : `ssh dgx2 'cd ~/SHOWRUNNER_TOOLS && python3 server/showrunner.py --admin nico007'`.

## 0. En trente secondes

1. **Fusionner ce qui reste en cours (§ 2.A)** s'il y en a, puis lire les comptes rendus des agents dans les
   derniers commits de chaque branche.
2. **Ce qui attend Cal (§ 2.D)** : la longue liste des réponses (polices, ACE-Step, Macro, réglages par défaut…),
   les diagnostics à lancer (Agent, Documents · PDF, Présentation · PDF, LoRA), le jeton R2.
3. **La suite (§ 2.E)** : les images clés du Montage si elles ne sont pas finies, l'agent design (étude faite,
   décisions à prendre), ACE-Step « ajouter un instrument » (après l'accord de Cal), le flux unique par onglet.
4. **Les restes (§ 2.F).**

## 1. Démarrer : quelle session es-tu ?

### Une session cloud (claude.ai/code), comme celles du 05 et du 06/10

- **Le dépôt** : la session peut démarrer sur un AUTRE dépôt (le 06/10 : `calculment0r/ShowRunner`, le site
  vitrine). Ajouter `calculment0r/SHOWRUNNER_TOOLS` par l'outil `add_repo`, puis
  `git clone --depth 1 https://github.com/calculment0r/showrunner_tools /home/user/showrunner_tools`.
  - Git s'y fait directement : on pousse sur la branche `claude/…` de la session ET sur `main`.
    **Pousser sur `main` met en ligne** : le cron `tools/auto_maj.sh` de DGX2 le prend en 2 min (§ 4).
    Cal l'a autorisé le 06/10 (« pousse sur main ») : une fois chaque lot vérifié.
  - Clone superficiel : `git fetch --depth=300 origin main` avant une fusion.
  - Pillow manque dans le conteneur : `pip install pillow` (sinon `check.py` ne démarre pas).
- **Aucun accès aux DGX ni à l'adresse publique** (le proxy du conteneur refuse `*.workers.dev`). Tout ce qu'on
  lit des DGX passe par Admin → Diagnostics → **« Tout lancer »** puis **« Copier tout »** (06/10 : la copie se
  fait dans le clic, elle marche en http ; un bouton Copier par sortie ; la sélection à la main tient).
  - Un envoi automatique des diagnostics vers GitHub, même chiffré, a été **refusé par les permissions de la
    session** comme exfiltration. Ne pas le retenter par un autre chemin.
- **Voir une page en vrai** : `python3 tools/portail_essai.py <port> <données>` (données jetables, connexion
  coupée, moteurs factices ; `SR_OLLAMA_URL` pour le faux Ollama de `tools/faux_ollama.py`, `SR_FAUX_R2=1` pour
  un faux R2, `SR_LORA_MANIFEST` pour un faux manifeste d'entraîneurs). L'arrêter **par son PID**, jamais
  `pkill -f`.
- **Playwright** : `require('/opt/node22/lib/node_modules/playwright')`, Chromium déjà installé (ne jamais
  lancer `playwright install`).
  - jsdelivr, cdnjs, Google Fonts, les sites d'Adobe, d'Ableton, de Cloudflare et web.archive.org sont bloqués
    dans le conteneur ; le registre npm passe ; PyPI passe mais pas les poids des modèles (Hugging Face).
  - Le Chromium du conteneur ne lit pas le H.264 : médias d'essai en VP9/Opus fabriqués par ffmpeg.
  - Chromium sous la locale POSIX laisse tomber les noms de fichiers non ASCII de `setInputFiles` : lancer avec
    `LC_ALL=C.UTF-8`.
  - Les pilotes rangés dans le dépôt (`*/pilote_*.mjs`) prennent `SR_PLAYWRIGHT=/opt/node22/lib/node_modules/playwright`
    (ou `PLAYWRIGHT=…/package.json`) ; la plupart veulent un portail d'essai NEUF (ils comptent depuis zéro).
- **Vérifier** :
  - `python3 tools/check.py` : tout (≈ 15 min, plus si des agents tournent) ; doit finir à 0 échec ;
  - `python3 tools/check.py chanson documents` : seulement ces selftests (06/10) ; `socle` et `garde` les
    ajoutent. Attention : la garde (`garde`) suppose que tous les selftests ont tourné.
  - Sous forte charge (plusieurs agents), deux essais de temps peuvent échouer seuls (`apercu_son` : `soon` en
    moins de 50 ms ; les LoRA d'un moodboard) : les relancer seuls avant de chercher plus loin. Mais un échec qui
    revient au passage complet est à prendre au sérieux : le 06/10, c'était une vraie course (`wip2/carnet-course`).
- **Travailler en parallèle** : un agent par sujet, chacun dans sa copie
  (`git worktree add /home/user/wt_<b> -b wip2/<b> <intégration>`), son port, ses données ; la session
  principale seule fusionne, vérifie et pousse ; les agents ne poussent jamais. Leur donner les contrats entre
  eux dans le brief (le 06/10 : la playlist, `spaceCourant()`, `app.agent`, les sections de `p.sections`) et
  leur demander de fusionner l'intégration dans leur copie quand un voisin touche leurs fichiers.
- **Le dépôt d'AGOSTA** (`calculment0r/AGOSTA`, privé) : par `add_repo`, puis
  `git clone --depth 1 https://github.com/calculment0r/agosta /home/user/agosta` (≈ 142 Mo). Jamais ses MP3 ni
  ses LRC dans notre dépôt (public).
- **Ce qui part avec le conteneur** : les copies `/home/user/wt_*`, les portails d'essai, les scripts d'essai
  des agents (`/tmp/sr_*`). Tout ce qui compte est sur GitHub.

### La session du PC (Claude Code chez Cal)

Ses règles sont fermes ; elles sont dans `CLAUDE.md` et au § 5 plus bas.
- Chaque commande commence par `ssh dgx1`, `ssh dgx2` ou `scp`.
- Git se fait sur DGX2.
- Pas de python, de node ni de navigateur sur le PC.
- Pas d'artifact.

### Dans les deux cas

- Réponses en français, courtes, avec le lien pour tester. **Jamais d'émoticône.**
- Cal lit un **« point » en HTML** envoyé dans le chat à chaque session. C'est un fichier, pas un artifact, et
  il n'est pas dans le dépôt : ce fichier-ci fait foi.
- Chercher avant de faire, citer ses sources, ne rien inventer ; « non documenté » plutôt qu'une
  supposition.
- Thème : uniquement les jetons de `commun/tokens.css`, deux thèmes (`CLAUDE.md`). Les sliders : le fader du
  kit (`musique/ui.js` `fader`, couché par `commun/curseur.css`), jamais un curseur natif à rond.

## 2. LA LISTE DES TÂCHES

### 2.A Ce qui est fusionné, ce qui est en cours

Toutes les branches `wip/…` du 05/10 sont fusionnées (documents, agent Showrunner, Commencer un projet, Session
d'ODIO) ; `wip/entete` peut être effacée ; `wip/travail-en-cours` est la sauvegarde du PC, à ne pas toucher.

Les branches `wip2/<sujet>` du 06/10 : chacune porte, dans ses commits, ce qui est fait et vérifié. Fusionnées
dans `main` : documents, agent-page, projet-ingest, odio-session, spaces, playlists, ecoute, paroles, restes,
montage-odio, montage-scrub, odio-craquements, motion-transcrire, etude-agent-design, lora, odio-selection-sliders,
odio-generatif, odio-arcs-session, odio-synthes, playlist-publier, worker-requetes, montage-cadre, scrub-lecteur,
odio-spaces, slides-pdf, odio-finitions, et la partie 1 de montage-poignees (l'export à une autre cadence).

Fusionnées ensuite le 06/10 : transcrire-ecran, montage-poignees (le moniteur sous la tête pendant un rognage,
Alt pour le bord ; les images clés), espaces-phaseb, telephone, onde-precise. `check.py` complet : **3447 / 0**.

Puis : `wip2/agent-ingest` (la nouvelle conduite de « Commencer un projet » : réception, compréhension en un
appel, questions cliquables, plan, une étape à la fois, carnet des décisions, paliers en arrière-plan sur les deux
DGX ; 44 appels au modèle → 1 pour la première réponse ; le cadre « Vidéos » rempli de sons venait de
`library` qui jugeait par l'extension : il lit le contenu par ffprobe). `check.py` complet : **3476 / 0**.

Puis : `wip2/motion-editeur` (les idées d'une note de spécification d'éditeur de motion partagée par Cal : le
rendu déterministe, l'export MP4 `presentation.video` par Chromium sans affichage et ffmpeg, les losanges
déplaçables, les courbes et le ressort, les préréglages et la cascade ; `presentations_motion.md` § 10).

Puis : `wip2/carnet-course` — une vraie course trouvée par un passage complet de `check.py` : une vue lisait le
document puis la file ; un travail fini entre les deux montrait « échec : fini » (une question du carnet, une
traduction, une transcription) et la page cessait de relire. `_settled` : un travail fini n'est jamais un échec ;
un essai `_selftest_vue` rend l'ordre fautif certain. `check.py` complet : **3544 / 0**.

Plus rien en cours à la fin de la session du 06/10 : toutes les branches `wip2/…` sont fusionnées.

**Décision proposée à Cal (sans téléchargement)** : `ideation_agent_modele: "qwen3:30b-a3b"` pour la
conversation de l'agent (déjà sur les deux DGX ; un modèle à experts, ≈ 6 fois plus rapide à écrire d'après les
sources publiées, `agent_showrunner.md` § 7), `qwen3-vl-32b-32k` gardé pour les images ; vérifier d'abord au
diagnostic « Agent Showrunner » qu'il prend les outils.

### 2.D Ce qui attend Cal (gestes, réponses, essais)

**Gestes**
1. **Recharger (Ctrl+Maj+R) ou fermer tous les onglets du portail déjà ouverts** : un onglet ouvert garde
   l'ancien code des relevés et continue d'interroger le Worker (§ 3, « Cloudflare »).
2. **Admin → Diagnostics → « Tout lancer », puis « Copier tout »**, et coller dans le chat. On y lit :
   - la mise à jour (le journal avance-t-il seul, sans « VERROU TENU ») ;
   - YuE2 (les paroles ignorées, encore ouvert) ; « LoRA · entraîneurs » ;
   - **« Agent Showrunner »** : `tools`, `vision`, `num_ctx` de `qwen3-vl-32b-32k` ;
   - **« Documents · PDF »** : poppler est-il sur DGX2 (non documenté) ;
   - **« Présentation · PDF »** : `node`, Playwright et Chromium sur la machine du portail (le défaut cherche
     `~/Character_Sheet`).
3. **Le jeton R2** (geste 9 de `docs/etudes/cloudflare.md`) : il allume « Publier le lien » des playlists (tout
   est codé, essayé sur un faux R2) et la bibliothèque quand les DGX sont éteintes. Jeton Object Read & Write
   limité au bucket `showrunner-bibliotheque`, écrit par Cal dans `~/.config/showrunner/r2.json` (chmod 600).
   **Jamais la clé dans un chat.**
4. **Cloudflare, vérifier le compte des requêtes** le lendemain : Workers & Pages → showrunner → Observability →
   Overview, visualisation Count, Group By `$workers.event.request.path`. Et, pour décider du flux unique,
   combien d'invocations par heure pour `…/collab/…/stream` avec une planche ouverte.
5. Régénérer le jeton du tunnel `dgx2`, passé dans un chat ; clé TURN Cloudflare ; Workers Paid si besoin ;
   commiter `C:\claude\MOVIE_ANALYSE\outils\partage\worker.js`.
6. `admin-pseudo` : changer de pseudo admin avant de l'allumer (`bash tools/porte.sh admin-pseudo on`).
7. La planche de la réunion réalisateur : Admin → Diagnostics → `planche` (jamais lancée).

**À écouter, à regarder (rien n'a été écouté ici : pas de carte son dans le conteneur)**
- ODIO : la banque de 130 préréglages et l'instrument **Macro** (Plaits complet, 24 moteurs) ; le **Tampon
  audio** (moyen par défaut ; long s'il reste un craquement sur une machine chargée) ; les **arcs** (réverbe,
  delay, largeur, saturation…) ; le génératif refait ; la Session.
- Le son au défilement (Montage, lecteur commun, ODIO) : la hauteur qui suit la vitesse.
- Le lien d'écoute sur l'album AGOSTA (un .zip depuis le volet des playlists), sur un vrai iPhone et un vrai
  Android (liste du README d'AGOSTA § 9).

**Réponses attendues (la recommandation des agents entre parenthèses ; le détail est dans l'étude citée)**
- **Polices — BLOQUANT pour le PDF** : Venus Rising et Norelli n'ont ni licence web ni licence PDF ; le PDF
  des présentations les refuse, or les titres par défaut sont en Venus Rising. Acheter les licences web + PDF,
  ou passer à des polices OFL (Unbounded, Syne, Fraunces, Instrument Serif, Inter Tight, Space Grotesk) ? Les
  PNG avec Venus Rising sont-ils permis ?
- **Montage** : le son au défilement à hauteur variable (0,5-2) ou fixe ; une préférence unique ou par outil ;
  Maj+S pour le basculer ; Movie Analysis : servir le son des films longs (R2) par morceaux ? Les images clés :
  en cours (oui de Cal). Gardé : Maj libère les proportions, l'ancrage par Alt + glisser, la grille sans
  recadrage.
- **ODIO, le bas** : panneau de 300 px par défaut, l'agrandir ? clip et chaîne côte à côte (Live les empile) ?
  F/H inactifs quand le clavier joue ; l'arpège au clavier attend le pas suivant ; replier une section vaut pour
  tous les Synthés.
- **ODIO, les synthés** (`docs/etudes/odio_synthes.md` § 5) : garder Macro (oui après écoute) ; brancher FM-6,
  STRINGS-4, MicroFreak sur Macro ; des échantillons libres (VCSL, CC0) dans la bibliothèque ; « mes
  préréglages » personnels (`/api/prefs`) ; l'arpège stéréo. **Où est l'étude d'origine des synthés à
  préréglages** (introuvable dans le dépôt ; dans ODIO_01, dont la lecture a été refusée à la session, ou sur le
  PC) ?
- **ODIO, le moteur** : le tampon moyen (20 ms, 300 ms d'avance) par défaut ; une retouche pendant la lecture
  s'entend jusqu'à 0,3 s plus tard.
- **ODIO, les arcs** (`docs/etudes/odio_arcs.md`) : les lois (volume −40 dB × (1 − v), filtre 150 Hz → 20 kHz,
  envois (2v)², saturation tanh(4x)) ; une région replanifiée à durées égales par bloc de paroles.
- **ODIO, la Session** : Maj+Tab à l'envers (aujourd'hui Clip ↔ Instruments, comme Live) ; un clip posé depuis
  Asset n'entre dans les clips du projet que par « Garder » ; une voie copie toute la chaîne de sa piste.
- **ODIO, le génératif** (`docs/etudes/musique_generatif.md` § 8.7) : ACE-Step par le serveur de son dépôt
  et le modèle **base** (4,79 Go, MIT) pour le vrai « ajouter un instrument » (lego), en deux temps (repaint et
  cover avec le sft déjà sur disque, puis base) ; la voie de repli par défaut (ACE-Step) ; télécharger
  BS-RoFormer SW (699 Mo) ; essayer le clip d'inspiration avec et sans ; les arcs dans le style ; caler un rendu
  (mesurer et décaler) ; une partition plus longue que la plage (couper par groupes entiers) ; le comping
  (attendre lego) ; 6/4 ou 6/8 ; licences YuE2 et SheetSage2.
- **ODIO, les Spaces** : les stems d'une chanson d'un autre Space, séparés dans un projet, suivent la chanson
  ou le projet ? Ce qu'ODIO importe, enregistre ou exporte naît encore dans « Mon Space » (il faudrait que
  `PUT /api/library/upload` prenne un Space : le socle) ; un projet rangé dans le « Mon Space » d'un autre :
  le cacher aussi de la liste des projets ?
- **ODIO, divers** : la barre sur deux rangées à 1920 px panneau ouvert ; la forme d'onde de la barre cachée
  sous 1280 px ; la courbe Comp du nodal (sortie) et celle des Instruments (détection) ; la hauteur mini des
  pistes à 26 px.
- **Musique, Spaces** : un admin peut sortir une chanson du « Mon Space » d'un autre, un membre non ; la carte
  « importé » sans Variante.
- **Musique, playlists** : le sommet du tempo aux deux tiers ; un tempo mesuré pris à partir d'une confiance
  de 0,5, et aucun détecteur de tonalité ; les défauts (sans blanc, 3 s de fondu, téléchargement fermé,
  dossier « Musique ») ; « Fais-moi une pochette » (prompt anglais, « no text », Krea 2, deux images).
- **Musique, lien d'écoute** : « 20 Yo » légèrement compressé pour −14 LUFS ; le lecteur suit le thème du
  système ; polices du système ; l'aperçu d'un lien à code sans pochette ; une écoute comptée après 30 s ; en
  sans blanc il reste 25-63 ms : « un seul fichier » par défaut pour un album ? ; une section R2 dans Admin ? ;
  le .zip qui se télécharge seul.
- **Musique, paroles calées** : transcrire la voix seule ou le mélange (Jam-ALT : la voix séparée dégrade le
  plus souvent Whisper) ; une séparation interne pour les comptes Apps ; les documents de calage dans la liste
  de Transcrire ; compenser le temps de réaction.
- **Idéation** : le contexte de l'agent 32k ou 64k (`ideation_agent_ctx`) ; un tour qui attend la fin d'un
  rendu sur sa machine ; **l'agent design : les dix décisions D1-D10 de `docs/etudes/agent_design.md`** ;
  les couvertures de documents dessinées aux couleurs du thème sombre ; « Commencer un projet » : chaque ami
  Studio voit tous les comptes Studio ; le nom du projet = le titre lu dans le document ? ; Motion : la règle en
  secondes, Origine/Lecture/Fin ; le travail `presentation.pdf` à renommer `ideation.pdf` (la garde Studio).
- **LoRA** : un LoRA Z-Image refusé sur Z-Image Base ; couper le mot déclencheur ; Krea 2 avec référence +
  LoRA (jamais essayé) ; empiler plusieurs LoRA ; la visibilité des LoRA de `loras/showrunner/` ; le tempo
  détecté par ODIO écrit sur le son (pour `ds.json`) ; la force 0-2 de la page Vidéo contre 0-1,5.
- **Cloudflare** : Admin se relit toutes les 3 s (≈ 20 requêtes par minute visible) : allonger ? Character
  Factory toutes les 5 s : 15-30 s au repos ?
- **Diarisation** : la barre collée sous l'en-tête en défilant ; le pilote « fils » d'origine est-il sur une DGX ?
- **Transcrire** : le carnet toujours en français ?
- **Toujours en suspens (05/10)** : les études hors du dépôt public (et `docs/etudes/panneau_asset.md`, cité
  mais jamais commité : sur le PC ?) ; le disque des attracteurs plafonné ; les références au-delà de la
  limite ; « Tasser » de Vidéo ; la réserve mémoire de TRELLIS.2 ; « Je dois valider un compte que j'ai créé »
  (une capture).
- **Licences** : H3 non licencié dans l'UE (écrire à MiniMax, sinon LTX-2.5) ; Qwen-Image 2.1 et YuE2 non
  commerciaux ; la règle « tout en local » à réécrire avec Cal ; l'abonnement Topaz.
- **Téléchargements en attente de son accord** : Parakeet (2,5 Go), BS-RoFormer SW, ACE-Step 1.5 base, ADTOF,
  Ming-Image (~26 Go et une mise à jour de ComfyUI), Z-Image Base sur DGX2 (12,3 Go).

**Essais que Cal seul peut lancer** (sur les vrais modèles), puis lus par un diagnostic :
- le premier tour réel de l'agent Showrunner ; un PDF de présentation sur DGX2 ;
- un entraînement LoRA lancé depuis le portail (Z-Image, puis H3, puis ACE-Step avec son `ds.json`) ;
- le génératif d'ODIO : une chanson YuE2 avec la partition corrigée (plus d'erreur « plain barline »), un
  « instrument seul » par la voie de repli (chanson puis stem) ;
- les paroles calées sur 1-2 morceaux d'AGOSTA (l'écart réel, contre les LRC d'aeneas) ;
- la consigne du carnet de Transcrire ; le tempo d'ODIO sur sa musique ; Multishot avec et sans durées ; la
  voie audio sur DGX1 (deux rendus d'affilée) ; la galerie des modèles d'Idéation.

### 2.E Ensuite (feuille de route, Claude)

- **Montage** : les images clés (si `wip2/montage-poignees` ne les a pas finies) ; « Coller les attributs »
  pour la trajectoire ; poignées de côté et flèches pour pousser ; des TITRES dans le banc (il n'y en a pas) ;
  une photo à rotation EXIF à l'export (non vérifié).
- **L'agent design** (`docs/etudes/agent_design.md`, § 6 l'ordre des travaux) après les décisions de Cal.
- **ODIO** : ACE-Step réel (lego, repaint, cover, complete) après l'accord de Cal ; le comping ; Macro dans le
  nodal et Macro compact (1 900 px) ; Follow Actions, warp, Legato, la prise audio en Session ; ce qu'ODIO
  importe ou enregistre dans le Space du projet (le socle) ; comparer SATURA, CRUSH, délai et réverbe du nodal à
  `appareils/calcul.js`.
- **Cloudflare** : le flux unique `/api/events` par onglet (étude dans `cloudflare.md`, une mesure à faire
  d'abord) ; les originaux de la bibliothèque encore en no-cache ; Movie Analysis : le son des films longs par
  morceaux.
- **Éléments versionnés** : les rendus automatiques à la première pose (séquence → MP4, personnage) — le contrat
  manque (quel cadre exporter d'une planche ; un travail qui rend puis publie ; l'import d'un personnage CF en
  travail ; ODIO fermé) ; les pages refusent encore (« publie la v1 depuis sa source »).
- YuE2 qui ignore les paroles (dès que les diagnostics parlent) ; YuE2 LoRA (nœud) ; le LoRA d'ACE-Step au
  rendu dans Musique.
- Slides : publication ; agent stratégique ; package agences ; API fermées (si Cal les ouvre).
- Multishot : confirmer la grammaire de H3 dans les guides MiniMax de DGX1.
- La porte : durcir `porte/worker.js` (la voie R2, le mode `access`) comme `library.serve_policy`.

### 2.F Restes techniques connus

- **ODIO** : les réglages de Plaits arrivent en avance de tout le tampon quand ils sont automatisés ;
  Chromium refait la mise en calques à chaque image (3,6 à 5 ms en rendu logiciel) ; le pas à pas au clavier
  d'ODIO n'a pas de son ; un échec de calcul ne survit pas à un rechargement de la page.
- **Idéation** : les textes riches ne s'éditent pas dans le mode Présentation ; « aucune entrée » de la
  minuterie collé au bord gauche ; de loin, les étiquettes de deux cadres côte à côte se chevauchent.
- **Documents** : pas d'OCR ; DOC, PPT, XLS d'avant 2007 sans texte ; la liseuse jamais essayée sur 5 000 pages.
- **Vidéo / H3** : le mode Images d'H3 en Brouillon forcé à 1 étage.
- **Personnages CF** : aucun n'a sa planche visage masqué ni ses 5 crops `.char`.
- **Divers** : écrêtage léger d'ACE et de YuE2 ; Z-Image Base seulement sur DGX1 ; Angle « left » à vérifier.

## 3. Ce qui a été fait (le plus récent d'abord ; le détail : `git log`)

### Session cloud du 06/10

Une session principale, une trentaine d'agents en parallèle (un sujet, une copie, une branche `wip2/…`
chacun), fusionnés et vérifiés lot par lot, chaque lot poussé sur `main` après un `check.py` complet à 0 échec
(de 2723 à 3153 contrôles), le crible des 30 pages dans les deux thèmes et les pilotes des pages touchées.
Le détail de chaque sujet est dans les commits de sa branche et dans son étude.

- **Diagnostics** : « Copier tout » marche en http (la copie dans le clic), un Copier par sortie, la sélection
  à la main tient pendant les relevés (`admin/admin.js`).
- **Cloudflare : 80 000 requêtes le 05/10 (limite 100 000 par jour)**. La cause, lue dans l'Observability de
  Cal : `GET /api/jobs` relevé par chaque onglet, même caché. Corrigé (`commun/shell.js`, étude
  `cloudflare.md` § « Le compte des requêtes du Worker ») : rien quand l'onglet est caché ; la file au repos
  toutes les 30 s ; un seul relevé par navigateur partagé entre ses onglets (Web Locks + BroadcastChannel, en
  https) ; les vignettes à une adresse versionnée gardées un an. Une journée comme le 05/10 : ≈ 9 000.
- **Documents** dans la bibliothèque : la liseuse (`commun/documents.js`), la fiche d'Asset, l'objet
  d'Idéation ; tout fichier entre.
- **L'agent Showrunner** : son panneau dans Idéation (`ideation/agent.js`), `app.agent`, le diagnostic.
- **« Commencer un projet »** essayé de bout en bout (`ideation/pilote_projet.mjs`).
- **ODIO** :
  - la **Session refaite** : une couche de voies par-dessus l'arrangement, Tab fait le tour Arrangement →
    Session → Nodal, « Envoyer à la Session », la bibliothèque du projet (rubrique « Projet ») ; centrée, les
    retours collés à la Sortie ;
  - la **sélection reste au clic droit** ; plus aucun slider natif (le fader couché du kit) ;
  - les **craquements** : tampon réglable (préférence « Tampon audio »), rien de planifié dans le passé, des
    images légères ;
  - le **génératif refait** (`musique/generatif_panneau.js`) : une question en haut, le projet rempli d'office,
    les paroles en colonne et la structure en blocs, les versions en cartes, « un instrument seul » par la voie
    de repli ; la partition YuE2 qui « ne passait pas » (`music line must end with a plain barline`) corrigée ;
  - le **groupe d'arcs** repliable (énergie, volume, filtre, réverbe, delay, + largeur, saturation, densité,
    tension) appliqué par le moteur ; un clip **en calcul** qui respire et dit sa progression ; la **structure**
    synchronisée avec les balises des paroles ;
  - les **synthés** : 130 préréglages, LFO, bruit, glissé, arpège, et **Macro** (Plaits complet en WASM) ;
  - le **panneau du bas compact** (clip et chaîne côte à côte, « Agrandir » Ctrl+Alt+E, « Replier », « Cadrer ») ;
  - **ODIO dans les Spaces** ; le panneau Asset et la barre ; l'EQ-3 et le FILTRE du nodal qui n'appliquaient
    pas leurs réglages ; la courbe du compresseur ; le son au défilement des clips audio et de notes.
- **Musique** : les **Spaces** (S1 partagés, S2, `music_space`) ; les **playlists** (volet, pochette, ordre
  proposé, écoute) ; les **paroles calées** sans saisie (alignement global, éditeur `commun/lrc.js`) ; le **lien
  d'écoute** (`ecoute/`, le lecteur d'AGOSTA généralisé ; .zip ; publication Cloudflare codée, en attente du
  jeton R2 ; essayé sur l'album AGOSTA).
- **Montage** : le moniteur suit les gestes en direct ; rogner tronque ; le **son au défilement** (commun) ;
  la **trajectoire** par plan (position, échelle, rotation, ancrage, opacité, recadrage), les grilles en un clic,
  la manipulation au moniteur, l'export identique ; l'export d'une source à une autre cadence corrigé ;
  `sr:elements` au lieu du relevé de 5 s.
- **Transcrire** : l'en-tête d'un son à hauteur fixe ; **Idéation, Motion** : la tête commune, plus de sélection
  de texte, nos boutons de lecture, l'édition des textes, la minuterie redimensionnable ; l'**export PDF** des
  présentations (Chromium sans affichage, `presentation.pdf`).
- **LoRA** : les cinq corrections du compte rendu du PC (sans `HF_HUB_OFFLINE`, `ds.json` d'ACE-Step…), le
  LoRA de moodboard dans la carte Générer, la page Image et la page Vidéo (H3) ; le manifeste du 05/10 dans
  `tools/lora_manifeste_0510.json`.
- **Restes** : la diarisation sur l'en-tête commun ; les messages de `movie_engine` et de la file ; l'export PNG
  des objets Web ; `ideation/pilote_fils.mjs` ; `ARCHITECTURE.md` à jour.
- **Études neuves ou complétées** : `agent_design.md`, `odio_synthes.md`, `odio_arcs.md`, `musique_generatif.md`
  § 8, `cloudflare.md` (le compte des requêtes), `montage.md` (trajectoire, poignées, son au défilement),
  `musique.md` (les craquements, le panneau du bas), `presentations_motion.md` § 8-9.
- **Outils** : `check.py <modules>` (filtre) ; `tools/compte_requetes.mjs` ; `tools/paroles_mesure.py` ;
  `tools/plaits_wasm/construire.sh` ; les pilotes `*/pilote_*.mjs`.

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
