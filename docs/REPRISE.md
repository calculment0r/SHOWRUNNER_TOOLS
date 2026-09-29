# Reprise — à lire en premier

État au 29/09/2026, soir (commit e1b4351). Portail à la maison :
**http://192.168.10.247:8790/** (DGX2 ; Tailscale http://100.108.108.65:8790/).
**Adresse publique permanente : https://showrunner.luxigone.workers.dev** —
les amis tapent le pseudo que Cal leur a créé (Admin → « Ajouter quelqu'un »),
sans code ni e-mail. Cal : pseudo `nico007` (admin, compte `cal`) ; un compte
admin n'entre par l'adresse publique qu'avec le lien admin (Admin → « Montrer le
lien admin », ou `bash tools/porte.sh lien` sur DGX2). Secours si plus aucun
admin n'entre : `ssh dgx2 'cd ~/SHOWRUNNER_TOOLS && python3 server/showrunner.py --admin nico007'`.

## Travailler ici (règles fermes de Cal)

- **Chaque commande commence par `ssh dgx1 `, `ssh dgx2 ` ou `scp `.** Sur le PC :
  Read, Write, Edit, Glob, Grep seulement (pas de `mkdir`, ni `cd … &&` en local). À
  répéter en tête de chaque brief d'agent ; plusieurs l'ont encore enfreint le 29/09.
- **Git se fait sur DGX2. Un seul intégrateur (la session principale) ; les agents
  ne poussent jamais.** Chaque agent travaille dans sa copie `/tmp/sr_<nom>` (clone
  d'origin/main + ses fichiers du PC par scp, serveur d'essai sur son port, données
  à lui). Déployer : `/tmp/sr_deploy` ← `git reset --hard origin/main`, y copier les
  fichiers **depuis la copie testée de l'agent** (pas depuis le PC, où d'autres agents
  écrivent en même temps ; d'un fichier partagé, n'extraire que la part de l'agent),
  `python3 tools/check.py`, commit, push, puis
  `cd ~/SHOWRUNNER_TOOLS && git fetch && git reset --hard origin/main && tools/portail.sh restart`,
  **puis `bash tools/porte.sh deploie`** (l'adresse publique sert les pages depuis
  Cloudflare : sans ce geste, elle garde les anciennes), et DGX1 suit par
  `ssh dgx@169.254.110.6 "cd ~/SHOWRUNNER_TOOLS && git fetch -q && git reset -q --hard origin/main"`.
- **wrangler : jamais depuis `~` sur DGX2**, toujours depuis `~/SHOWRUNNER_TOOLS/porte`
  (ou un dossier de projet). Lancé depuis `~`, il crée `~/.wrangler/` et se croit
  déconnecté (« CLOUDFLARE_API_TOKEN… non-interactive ») : `rm -rf ~/.wrangler` le
  répare (les identifiants sont dans `~/.config/.wrangler`).
- Le travail en cours du PC est sauvegardé toutes les 30 min sur la branche
  `wip/travail-en-cours` (`/tmp/sr_wip`, poussé en force). `main` reste la version en ligne.
- Un fichier que deux agents touchent en même temps se casse : un agent possède ses
  fichiers ; partage explicite par message quand il le faut.
- Aucun rendu de modèle ni téléchargement tant que Cal ne le demande pas (moteurs
  factices, câblage réel derrière Admin → Câblage).
- Jamais de `pkill -f` par motif : par PID.
- **Cal déteste qu'on lui impose une page tierce** : la connexion par e-mail de
  Cloudflare Access a été mise en place puis retirée le 29/09 à sa demande (très
  fâché). Montrer l'expérience avant de déployer tout ce qui touche l'entrée.
- Bloqueurs de pub : aucun fichier ne doit tomber sous EasyPrivacy / EasyList
  (`/tmp/easyprivacy.txt`, `/tmp/easylist.txt` sur DGX2 ; cf. 42b6147, `analyse.js` bloqué).
- Souris et menus (tous les canvas) : bouton du milieu = déplacer ; clic = choisir,
  Maj = ajouter, Ctrl = ajouter / retirer ; jamais le menu du navigateur. Timelines :
  `commun/molette.js` (molette = défiler, Maj = temps, Alt = zoom, Ctrl = hauteur).

## La porte publique (en place le 29/09)

Worker `showrunner` (assets = le dépôt moins `.assetsignore`) → Workers VPC
`portail-dgx2` (service `01a0edac-…`) → tunnel `dgx2` (`15a096f7-…`,
`cloudflared.service` sur DGX2) → `127.0.0.1:9790`. Mode **« code »**
(`PORTE_MODE = code`, `porte.mode = code`) et **`porte.invitation = false`** (phase
d'essai : un pseudo créé par Cal suffit). Plus d'application Access (supprimée par
Cal). Bucket R2 `showrunner-bibliotheque` créé, recopie jamais lancée (pas de
`~/.config/showrunner/r2.json`). Commandes : `tools/porte.sh`
(`verifie | deploie | lien | ami <pseudo> | invitation on|off | nouveaux-codes | essai`).
Étude : `docs/etudes/cloudflare.md`. Amis actifs : su007, eric007, mehdi007,
pilou007, steph007, nico — tous avec `"access": "studio"` (sauvegarde de
`auth.json` d'avant : `~/showrunner-data/auth.json.avant-studio-*`).
Le jeton du tunnel est passé dans le chat : proposer à Cal de le régénérer.
La démo trycloudflare (`tools/demo.sh`) est arrêtée ; la porte est l'une ou l'autre.

## En ligne le 29/09 au soir

| commit | quoi |
|---|---|
| 0aa4f7e | ODIO rhabillé dans notre thème, fils en espace écran (`docs/etudes/musique_theme.md`) |
| 810c1b2 | droits des amis (`library.get` / `check_write`, `POST /api/jobs` filtré, dépôts vérifiés, `droits.py`) ; Idéation : rôle « invite », co-édition fine, barre sur une ligne ; porte prête |
| 98a7c23 | ODIO : aimant coupable (barre, clic droit, Ctrl+4), étiquette de piste glissable, netteté au zoom |
| 913a390 | la même molette dans toutes les timelines ; `kindMark()` marque séquences / MIDI / éléments |
| fc732cc · 27cde72 | porte par pseudo sans Access, puis sans invitation ; Movie Analysis : un clic ouvre le projet ; Image : Qwen 2.1 = 10 réf., Krea 2 = 2 |
| b3e32c0 | Upscale : pile par média, rideau A/B, zoom lié, préréglages Précis / Créatif / Aperçu |
| da77232 | app **Transcrire** (factice ; câblage local prêt, sans téléchargement) |
| 4f8dfc3 | app **Musique** `chanson/` (chanson par prompt ; stems → ODIO réservés au Studio) |
| d8efa62 | Montage : panneau Effets, calques FX, groupes de pistes, fondus à poignées, LUT sans éclair ; export = ffmpeg 6.1.1 sur DGX2 |
| b01a463 · 7c1d7c5 · f06c855 | **Accueil Apps / Studio**, l'image et la vidéo de Cal dans les grandes cartes (`media/`), logotype **NIRVALAB**, titre **SHOWRUNNER**, Asset en haut à droite |
| 796b1a9 | Idéation : bibliothèque repliable (poignée, ×, entrée au clic droit / double-clic) |
| 6b22136 | références : `commun/refs.js` (places, pas visuels ; grisées au-delà de la limite ; `split_refs` côté serveur) ; cartes Générer d'Idéation réparées ; Vidéo : curseur de durée |
| fee53b5 · 7bcd857 | ODIO : attracteurs en espace écran ; export par tranches, forme d'onde en fond, piano roll centré, thème clair complet (`tokens.css`) |
| e1b4351 | plein écran (Ctrl+Maj+F) ; panneaux détachables (`commun/fenetre.js`, étude `fenetres.md`) : Montage et nodal d'ODIO |

Avant 16 h 30 : voir `git log` (ODIO_01 dans le nodal, Idéation atelier et
co-édition, Montage, Vidéo, préférences, thème clair…). Le morceau vitrine
**« Verre fumé »** est dans les données de Cal (`musique/?p=mus-20260929-173609-9d87`) ;
livrables dans `/tmp/sr_morceau_livrables/`.

## Les études du soir — sur le PC seulement, PAS commitées

Le dépôt est **public** ; elles contiennent stratégie, prix, alertes de licence.
Question posée à Cal : les garder hors du dépôt public ? (pas encore de réponse) :
`docs/etudes/positionnement.md`, `modeles.md`, `pipeline_video.md`,
`presentations.md`, `agent_brief.md`, `package_export.md`.
Points qui pèsent : **H3 n'est pas licencié dans l'UE** (écrire à MiniMax ; repli
LTX-2.5) ; **Qwen-Image 2.1 et YuE2 non commerciaux** ; **Venus Rising et Norelli
servies en webfonts sur une adresse publique sans licence web** (acheter, ou polices
OFL) ; Starlight Fast 3 de Topaz n'existe qu'en nuage (API) ; la règle « tout en
local » de `CLAUDE.md` est à réécrire avec Cal (local d'abord, API fermées avec budget).

## Ce qui attend Cal

1. Répondre : études hors du dépôt public ? disque des attracteurs plafonné à 100 % ?
   références : ajouter au-delà de la limite (grisée) ? « Tasser » de Vidéo ?
2. Les décisions des études (positionnement 13, modèles 7, pipeline vidéo 10,
   présentations 11, agent 8, package 10) ; son abonnement Topaz ; un compte Comfy.org.
3. Allumer le câblage réel de Transcrire et de Musique (aucun téléchargement).
4. Workers Paid (5 $/mois) si la collaboration à distance d'Idéation s'emballe
   (quota gratuit : 100 000 requêtes par jour).
5. Commiter `C:\claude\MOVIE_ANALYSE\outils\partage\worker.js` (origines du portail ;
   déployé : version 277fe452).
6. Plus anciens : ACE-Step 1.5 base, BS-RoFormer, ADTOF ; DGX1 (`seconohe`,
   `tiktoken`) ; la 3090 (`vfx-3090`, hors ligne) ; contrastes sombres `--grn2`, `--ink3`.

## Restes techniques connus

- iPhone / Safari : le Worker répond 200 à une requête `Range` sur les vidéos de
  l'accueil (pas 206) : lecture à vérifier.
- Le droit Studio n'est lu que par l'app Musique et l'accueil ; `auth.public_user`
  ne rend pas `access`, le serveur ne ferme pas les pages Studio, Admin ne sait pas le régler.
- Fils d'Idéation (`commun/wire.css`, `vector-effect`) : même défaut de zoom que ceux
  d'ODIO avant, probablement : à mesurer. Menu commun dans une fenêtre détachée : un pont
  (l'accroche propre est dans `fenetres.md`).
- `docs/ARCHITECTURE.md` : ajouter `refs.js`, `molette.js`, `fenetre.js`, `pleinecran.js`.

## Machines

- DGX2 : le portail (`~/SHOWRUNNER_TOOLS`, `tools/portail.sh`, journal
  `~/showrunner.log`, données `~/showrunner-data`), porte 9790 (loopback),
  `cloudflared.service`, ComfyUI :8188, H3 :8189 arrêté au repos. DGX1 : miroir du
  code, ComfyUI :8188, studio Character Factory :8765, diarisation :10002.
- Références : `~/showrunner-refs/` sur DGX2 (`odio-theme-2909/`, prototypes, `luts`).
