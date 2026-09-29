# Reprise — à lire en premier

État au 29/09/2026, 14 h 15 (commit fe51c35). Portail :
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

## En ligne (29/09, de 11 h à 14 h 15)

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

Données : 21 médias d'essai de Cal dans Asset « Essais » ; 342 LUT importées
(Fujifilm ETERNA v1.10 en Rec.709 cuit + F-Log2, RawTherapee) sous
`~/showrunner-data/luts` ; archives dans `~/showrunner-refs/luts`. Doublon de
compte « nico007 » (rôle ami) fusionné dans `cal` (sauvegarde
`~/showrunner-data/sauvegarde-fusion-20260929-132539`).

## En cours au moment de cette note

- **Idéation · groupes façon Miro** (agent) : `ideation/canvas.js`,
  `groups.js`, `selection.js`… d'après `docs/etudes/ideation_miro.md` ; plus
  les crochets du composeur (`inspector.js` : libellé `app.gen.goText(n)`, prise
  de vue cachée si `looksFrom(n) === 'composer'`).
- **Finitions transverses** (agent) : Ctrl+Z dans ODIO (AZERTY) et Movie
  Analysis, `fil.js` branché sur l'annulation, le thème clair qui passe mal
  (`--vh`, `.statcard`, pages des voix), `sequence` et `midi` dans Asset,
  `ARCHITECTURE.md`.
- À lancer ensuite (même fichier que les groupes) : les objets du prototype
  (formes, cartes, mind map, guides magnétiques — `docs/etudes/ideation_atelier.md` § 3),
  la co-édition (`docs/etudes/ideation_collab.md`).

## Ce qui attend Cal

1. **Démo en ligne** : `ssh dgx2 'cd ~/SHOWRUNNER_TOOLS && tools/demo.sh start'`
   (tunnel rapide trycloudflare → 127.0.0.1:9790 ; affiche l'adresse, le lien
   et le code d'invitation, le code admin). Pas de SSE : la collaboration en
   direct ne passe pas. À lancer seulement sur son oui.
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
