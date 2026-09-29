# Reprise — à lire en premier

État au 29/09/2026, 16 h 30 (commit 4e74fb3). Portail :
**http://192.168.10.247:8790/** (DGX2 ; Tailscale http://100.108.108.65:8790/).
Entrer : taper le pseudo **`nico007`** (Cal, admin, compte `cal`). Secours si
plus aucun admin n'entre : `ssh dgx2 'cd ~/SHOWRUNNER_TOOLS && python3 server/showrunner.py --admin nico007'`.
Le point du jour, lisible par Cal : l'artifact « Showrunner · point du 29/09 »
(https://claude.ai/artifact/VzaAXMQqEUwQ3MMkVpzP18).

## Travailler ici (règles fermes de Cal)

- **Chaque commande commence par `ssh dgx1 `, `ssh dgx2 ` ou `scp `** (seules
  commandes autorisées une fois pour toutes ; le reste lui demande « allow
  once »). Sur le PC : Read, Write, Edit, Glob, Grep seulement. À répéter en
  tête de chaque brief d'agent (plusieurs l'ont enfreint le 29/09 : `mkdir`,
  `for`, `grep` locaux).
- **Git se fait sur DGX2.** Déployer : `/tmp/sr_deploy` (clone), `git reset
  --hard origin/main`, n'y copier **que les fichiers d'un chantier fini** (le
  PC est un brouillon partagé par les agents), `python3 tools/check.py`, les
  pilotes Playwright de l'agent contre un serveur lancé depuis ce clone, commit,
  push, puis `cd ~/SHOWRUNNER_TOOLS && git fetch && git reset --hard
  origin/main && tools/portail.sh restart`, et DGX1 suit par
  `ssh dgx@169.254.110.6 "cd ~/SHOWRUNNER_TOOLS && git fetch -q && git reset -q --hard origin/main"`.
- **Le travail en cours est sauvegardé toutes les 30 min** sur la branche
  `wip/travail-en-cours` (`/tmp/sr_wip` : main + l'arbre du PC, poussé en
  force). `main` reste la version en ligne.
- Un fichier que deux agents touchent en même temps se casse : un agent
  possède ses fichiers, les autres n'y posent que des accroches marquées.
- Aucun rendu de modèle tant que Cal ne le demande pas (moteurs factices,
  câblage réel derrière des interrupteurs : Admin → Câblage).
- Jamais de `pkill -f` par motif (tue la commande ssh) : par PID.

## PRIORITÉ 1 de la session suivante — ODIO a perdu notre thème (Cal, 29/09 16 h 25, très fâché)

« pourquoi sur ODIO on n'a pas notre thème !!! les nodes avaient le bon design et tu as mis ceux
de l'ancien projet qui était du prototype ». La traduction d'ODIO_01 (eebbd9f, `musique/nodal.js`,
`nodal.css`, `machines/**`) a repris l'habillage des tuiles d'ODIO_01. Cal voulait **la logique
d'ODIO_01 dans NOS cartes du nodal** (celles d'avant eebbd9f : `git show 4a20f41:musique/nodal.js`
et `musique/musique.css` de ce commit — en-tête, ports, filets, jetons). À faire : rhabiller les
tuiles, machines et panneaux du nodal dans notre DA (cartes du nodal d'avant, `commun/tokens.css`),
**sans perdre** la logique (glisser-déposer, T/G/F, planogrammes, attracteurs, tracé au bouton du
milieu, pistes liées). Les jouets gardent leur intérieur (demande de Cal) dans notre cadre.
Captures côte à côte avant eebbd9f / maintenant / après, à lui montrer.

Précision de Cal (16 h 40) : « garde les fonctions dedans comme on a mais les cards doivent être
avec le nouveau design.. les sliders rotatifs etc doivent être avec le nouveau design.. on garde
juste le code et la logique et on repasse tout dans notre thème qui est plus abouti. »
Et : « les fils ne sont plus en screen space aussi.. on doit mettre le design de notre canva dans
notre thème qui est beaucoup mieux réfléchi » : câbles d'épaisseur constante à l'écran (comme
`commun/wire.js`), fond, trame, sélection, poignées et menus de nos canvas (nodal de 4a20f41,
Idéation), pas ceux d'ODIO_01.
**Un agent y travaille depuis 16 h 40** : copie `/tmp/sr_odio_theme` sur DGX2 (port 8828),
référence `/tmp/sr_odio_avant` (4a20f41, port 8827), fichiers sur le PC dans `musique/**`, son
rapport écrit dans `docs/etudes/musique_theme.md`. Session suivante : lire ce rapport, repasser
`tools/check.py` et les pilotes (`/tmp/sr_odio3_essai.mjs`, `/tmp/nodal_essai.mjs`,
`/tmp/sr_odio3_*.mjs`) sur un assemblage `/tmp/sr_deploy`, montrer les captures à Cal, déployer.

## Démo en ligne (lancée le 29/09 à 16 h 20, à la demande de Cal)

`ssh dgx2 'cd ~/SHOWRUNNER_TOOLS && tools/demo.sh status'` — adresse
https://infinite-tracks-enjoyed-cooked.trycloudflare.com (change à chaque `start` : **relire les
mots tirés au hasard avant de la donner** — la première contenait « terrorist », Cal furieux),
compte simple de Cal pour la démo : pseudo **`nico`** (ami, actif, sans code),
invitation `/invitation/<code>`, code admin pour Cal ; les pseudos neufs attendent son accord
(Admin). Pas de SSE : la collaboration en direct ne passe pas. Arrêt : `tools/demo.sh stop`.

## Prêt sur le PC, pas encore en ligne (sauvegardé dans `wip/travail-en-cours`)

- **Idéation · objets du prototype et co-édition : EN LIGNE** (1d70b78, 1108/1108 ; pilotes objets
  80/80, co-édition 48/48, groupes 41/41, fils 18/18). Restes : un invité par lien devient un ami
  du portail (il faudrait un état « invité » dans `core/auth.py`) ; registres de co-édition trop
  larges (cases d'un composeur, texte d'une note) ; la barre d'Idéation passe sur deux lignes.
- **Étude Apps / Studio et éléments liés** : `docs/etudes/apps_studio_elements.md` (source
  vivante → versions publiées → usages épinglés, pastille « vN+1 », accès apps | studio) ;
  6 questions à Cal (recommandations : oui, oui, à la main, propriétaire + Cal, Apps par défaut,
  ACE-Step pour « s'en inspirer »). Signale aussi : `music.save_project` sans contrôle de
  propriétaire (`music.py:639`), `POST /api/jobs` sans filtre de sorte, restauration en lot
  d'Asset qui ignore `mid-` / `seq-`.

## En ligne (29/09, de 11 h à 16 h 30)

| commit | quoi |
|---|---|
| 194ae62 | ODIO, deuxième tour (les onze remarques de Cal) |
| 1f64157 | Image et Vidéo : le fil façon Higgsfield ; « Movie Creator » devient **Vidéo** ; `commun/menu.js` (clic droit, ⋯) |
| cd43d4a | Montage : panneaux, chutier en dossiers, clic droit, outils de Premiere (V A B N C Y U R H Z), LUT (.cube, HaldCLUT) |
| 0cfea9c | Image : la barre de prompt flottante en bas (capture Higgsfield de Cal) |
| 4a20f41 | Idéation : l'atelier du prototype de Cal (`ideation/atelier/*` : présentation, vote, projecteur, minuteur, machine temporelle, ⌘K, vues Alt+1…4), `ideation/plugins.js` |
| 0782335 | Idéation : fils typés (`ports.js`, `commun/wire.js`), Générer vidéo, composeur v1, collaboration (présence, fil, visio pair à pair) ; Nagle coupé |
| b648cc9 | Movie Analysis refait dans l'interface du portail (page Projets) |
| fef9887 | Idéation : composeur v2 (Varier, lots en cadre) |
| f9b95e1 | `commun/undo.js` (Ctrl+Z), préférences (`/api/prefs`, roue, Ctrl+,), thème clair + éditeur (règle 2 réécrite) ; Montage : le chutier devient Asset, séquences (`kind: sequence`), onglets ; copies d'affichage 256…2048 WebP, ETag, `/api/library/batch` |
| eebbd9f | ODIO : ODIO_01 traduit dans le nodal (glisser-déposer, attracteurs qui agissent, 13 planogrammes, T/G/F, zoom sémantique), les 14 jouets du Playground, le génératif (région, panneau, partition YuE2, Extraire le MIDI, `kind: midi`) |
| fe51c35 | La porte publique `127.0.0.1:9790` (trou admin fermé), mode démo (codes), mode Access, `porte/` (Worker, R2) |
| 992b772 | Idéation : groupes façon Miro, barre de sélection, poignées, groupe réduit à ports, zoom sémantique, fluidité (1000 images) |
| 42b6147 | Movie Analysis : `analyse.js` → `accueil.js` — **EasyPrivacy bloque `/analyse.js`** : chez Cal la page restait vide (cause de « pas mes exemples, pas le menu ») |
| 4e74fb3 | Plus de menu du navigateur (gardien commun + menus par zone), Ctrl+Z partout (AZERTY), thème clair corrigé, `sequence` / `midi` dans Asset ; ODIO : bouton du milieu, Maj/Ctrl+clic, tracé au bouton du milieu, pistes (Suppr, glisser, groupes), panneau du bas sans onglets, effets partagés entre pistes, couleur et nom de piste sur le nœud |

Données : 21 médias d'essai de Cal dans Asset « Essais » ; 342 LUT importées
(Fujifilm ETERNA v1.10 en Rec.709 cuit + F-Log2, RawTherapee) sous
`~/showrunner-data/luts` ; archives dans `~/showrunner-refs/luts`. Doublon de
compte « nico007 » (rôle ami) fusionné dans `cal` (sauvegarde
`~/showrunner-data/sauvegarde-fusion-20260929-132539`).

## À ne pas oublier

- **Bloqueurs de pub** : aucun fichier du portail ne doit tomber sous EasyPrivacy / EasyList
  (vérifié le 29/09 après le renommage ; refaire la vérification après chaque nouveau fichier —
  la méthode : `/tmp/easyprivacy.txt`, règles `/chemin` sans joker, cf. commit 42b6147).
- Règles de souris et de menus de Cal (tous les canvas) : bouton du milieu = déplacer ; clic =
  choisir, Maj = ajouter, Ctrl = ajouter / retirer ; jamais le menu du navigateur.
- Le digest pour Cal : artifact https://claude.ai/artifact/VzaAXMQqEUwQ3MMkVpzP18 (le republier
  depuis `…\scratchpad\digest\digest.html` de la session du 29/09, ou en refaire un).

## Ce qui attend Cal

1. **Démo en ligne** : `ssh dgx2 'cd ~/SHOWRUNNER_TOOLS && tools/demo.sh start'`
   (tunnel rapide trycloudflare → 127.0.0.1:9790 ; affiche l'adresse, le lien
   et le code d'invitation, le code admin). Pas de SSE : la collaboration en
   direct ne passe pas. **Lancée le 29/09 à 16 h 20** (Cal veut l'envoyer à un ami).
2. **La vraie porte** (`docs/etudes/cloudflare.md`, « Prêt à déployer ») :
   Zero Trust est actif (équipe `nirvalab`), wrangler 4.143.0 est connecté sur
   DGX2 (`~/.local/bin/wrangler`, compte `luxigone@gmail.com`, sans portée
   Access). Restent à Cal : créer le tunnel Workers VPC `dgx2` et lancer
   `sudo cloudflared service install <jeton>`, activer One-time PIN, créer
   l'application Access et donner le tag AUD, le jeton R2, la liste d'e-mails.
3. **Worker de MOVIE_ANALYSE** : ajouter l'adresse du portail aux `ORIGINES`
   (diff dans `cloudflare.md`) puis `wrangler deploy`.
4. **ODIO** : télécharger ACE-Step 1.5 base (4,79 Go), BS-RoFormer SW (699 Mo),
   ADTOF ; le LoRA « pronostic » sur l'étage partition de YuE2 (oui / non) ;
   mesure en 6 : 6/4 ou 6/8 dans la partition ; la table des facettes.
5. **Contrastes sombres** : éclaircir `--grn2` et `--ink3` d'un cran (sous 4,5:1 sur certains panneaux) ?
6. Plus anciens : câbler les modèles (interrupteurs), téléchargements Image /
   Upscale, DGX1 (`seconohe`, `tiktoken`, redémarrer ComfyUI), orchestration,
   décisions Cloudflare (7).

## Machines

- DGX2 : le portail (`~/SHOWRUNNER_TOOLS`, `tools/portail.sh`, journal
  `~/showrunner.log`, données `~/showrunner-data`), porte publique 9790 (loopback),
  ComfyUI :8188, H3 :8189 arrêté au repos. DGX1 : miroir du code, ComfyUI
  :8188, studio Character Factory :8765, diarisation :10002.
- Références : `~/showrunner-refs/` sur DGX2 (prototype `atelier-canvas`,
  `odio-o1-playground`, `luts`) ; ODIO_01 cloné dans `/tmp/odio01` ;
  H3 Studio `/tmp/h3hf`.
