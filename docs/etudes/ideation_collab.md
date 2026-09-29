# Étude — Idéation à plusieurs (29/09/2026)

Demande de Cal (29/09) : « dans mon zip avec ma DA, on avait des fonctions
aussi qu'on ne retrouve pas ici... visio conférence et mode présentation »,
avec le brief et le prototype `atelier-canvas` (DGX2 :
`~/showrunner-refs/atelier-canvas/README.md`). Ses amis entrent par la porte
(pseudo) ; plus tard par la porte Cloudflare (HTTPS). Le README est la
spécification : présence et curseurs partagés, sélection des autres
visible, « où regarde X », fil latéral avec messages ancrés à un objet ou
une zone et pastille sur le tableau, point corail, historique par planche,
visio (bandeau de vignettes repliable qui ne couvre jamais les outils,
caméra, micro, partage d'écran, « en appel » dans l'en-tête), chat et visio
dans un même bandeau à onglets, réduits en pastille en mode présentation.
Le prototype n'implémente rien de collaboratif (« Rien de collaboratif
n'est implémenté — c'est l'objet de ce brief ») : l'interface vient de son
langage (filets, micro-étiquettes mono, Venus Rising pour les initiales et
les nombres), dans les jetons du portail.

## 1. Ce qui est fait

| fichier | rôle |
|---|---|
| `server/tools/ideation_collab.py` | présence, fil, signalisation ; `selftest` (46 contrôles, porte allumée, deux personnes) |
| `ideation/collab.js` | le module greffé (`install(app)`, une ligne dans `PLUGINS` de `ideation/plugins.js`) |
| `ideation/collab.css` | sa feuille (chargée par le module : `index.html` n'a pas changé) |

**Sur la planche** : le curseur de chacun (flèche et nom à sa couleur, lissé
sur 90 ms), l'anneau de sa sélection (à sa couleur, son nom sur le premier
objet ; la mienne reste orange, tracée par le canvas), en option le cadre
de ce qu'il regarde (« vue · Lina », pointillés), les pastilles des messages
épinglés (à la couleur de l'auteur, le nombre de messages, un point corail
si non lu). Les anneaux et les pastilles suivent un objet qu'on déplace,
image par image.

**La barre** (à la fin de `.ide-bar`) : l'état de la liaison s'il y a lieu
(connexion, reconnexion, coupé et pourquoi), « X a changé la planche ·
recharger » (voir § 5), les visages (initiales sur la couleur de la
personne, un seul par personne même en plusieurs onglets, estompé si son
onglet est caché ou coupé, un point vert en appel ; clic : aller à sa vue,
voir où regardent les autres), « en appel · 3 » / « appel en cours · 2 »,
« commenter ici » (C), le fil (point corail), la visio.

**Le bandeau à onglets Fil | Visio** se pose sur la colonne de
l'inspecteur (comme le mode commentaire de Figma remplace le panneau de
droite) : il ne couvre ni la planche ni ses outils ; « Fermer » rend
l'inspecteur. Sans inspecteur visible (fenêtre étroite), il flotte à droite
de la planche au-dessus du zoom et de la mini-carte.

- **Fil** : les messages en fils (un message et ses réponses, un seul
  niveau), l'ancre en tête (« « couleur : corail ? » », « un point de la
  planche » ; clic : y aller), répondre, retirer (l'auteur ou un admin, avec
  confirmation). Écrire : Entrée envoie, Maj+Entrée va à la ligne ; « sur »
  : toute la planche, l'objet choisi, ou un objet / un point désigné (C puis
  un clic ; une pastille creuse montre où il ira). Point corail sur le
  bouton du fil et sur l'onglet tant qu'un message des autres n'est pas lu
  (lu = vu fil ouvert ; gardé par planche dans ce navigateur).
- **Visio** : qui est dans l'appel (micro, caméra, écran, « écoute »,
  « connexion », « pas de chemin »), Lancer / Rejoindre / Quitter, Micro,
  Caméra, Écran, « vignettes » (replier le bandeau). Un contrôle impossible
  reste cliquable et dit pourquoi (règle 7).

**Les vignettes** : un bandeau inséré entre la barre et la planche (il
prend sa place, ne recouvre rien), 160 × 90, ma vignette en miroir, les
autres avec leur nom, « muet », « écran » ; une caméra coupée montre les
initiales. Replié, il sort du flux mais les vidéos continuent (le son des
autres passe par elles).

**En présentation** (`atelier/presentation.js`, événement
`atelier:present`, ou `present` ; aussi un plein écran de la planche) : le
bandeau et les vignettes se réduisent à une pastille en bas à gauche
(« appel · 3 · fil ● ») ; les curseurs des autres restent visibles, les
anneaux et les pastilles s'effacent pour la diapositive. La fin de la
présentation rouvre ce qui était ouvert.

### Routes (`/api/ideation/collab/<planche>/…`)

| | |
|---|---|
| `GET …` | qui est là, peut-on entrer (et pourquoi pas) |
| `GET …/stream[?resume=cid]` | le flux SSE : `hello` (moi, les autres, les 500 derniers messages, `ice`), `p` (présences), `join`, `leave`, `msg`, `del`, `sig`, `bye` |
| `POST …/presence {cid, cursor, sel, view, call, away, rev}` | ce qui a changé, seulement |
| `POST …/leave {cid}` | partir (la page l'envoie par `sendBeacon` en se fermant) |
| `GET · POST …/messages` · `POST …/messages/<id>/delete` | le fil ; `{text, anchor: {node, label} \| {x, y}, reply_to}` |
| `POST …/signal {cid, to, kind: offer \| answer \| bye, data}` | une description de session vers un seul onglet, entre deux onglets dans l'appel |

Le fil est gardé hors du dépôt : `<data_dir>/ideation_collab/<planche>.jsonl`
(une ligne par message, une ligne par retrait ; réécrit sans ses retraits
au-delà de 4 Mo, 5 000 messages gardés). Une planche mise à la corbeille
garde son fil.

## 2. Le transport : un flux SSE par onglet, de petits POST

Le serveur du socle est **threadé** (`ThreadingHTTPServer`,
`daemon_threads`) et sait envoyer une réponse **au fil de l'eau**
(`StreamResponse`, en morceaux) : un flux Server-Sent Events y tient sans
rien ajouter. Chaque onglet ouvre un flux (un fil d'exécution du serveur
qui dort sur une condition et regarde chaque seconde si son navigateur est
parti) ; ses gestes montent par des POST, **un seul à la fois, fusionnés**
(ce qui s'accumule pendant un envoi part au suivant, au plus un toutes les
60 ms). Côté serveur, les présences sont fusionnées par flux : chacun reçoit
la dernière de chaque onglet, au plus toutes les 40 ms ; messages, signaux,
arrivées et départs passent dans l'ordre. Un commentaire SSE toutes les
15 s garde la connexion et relit la session (retirée ou suspendue : `bye`).

**Mesuré le 29/09 sur DGX2** (`collab_mesure.py`, serveur de la copie
d'essai dans son propre processus, client sur la même machine) :

| | |
|---|---|
| latence d'un curseur, POST → flux de l'autre onglet (20 Hz, 300 envois) | médiane 0,8 ms, p95 1,3 ms, max 2,3 ms ; 300 positions reçues sur 300 |
| 102 flux ouverts, au repos (10 s) | 104 fils (+103), +11 Mo, 0,30 % d'un cœur |
| un curseur à 20 Hz vers 101 flux (10 s) | 19,9 % d'un cœur ; latence médiane 3,8 ms, p95 6,4 ms, max 15,7 ms |
| une requête courte (ce que coûterait l'interrogation en boucle) | 0,52 ms de processeur ; à 10 Hz × 102 onglets = 1 020 req/s ≈ 53 % d'un cœur, et 100 ms de retard au mieux |
| un onglet fermé sans prévenir | vu « coupé » par les autres en 689 ms ; il part après 30 s de grâce (une reprise dans ce délai garde son identifiant) |
| flux fermés | retour à 2 fils |

**Pourquoi pas l'interrogation courte** : le serveur est threadé, et
l'interrogation coûterait cent fois plus pour un retard pire. **Pourquoi
pas WebSocket** : il faudrait écrire la poignée de main et le découpage en
trames dans le socle (`core/http.py` rend une réponse, il ne cède pas la
socket) ; SSE n'a besoin de rien, se relie seul, et passe par un Worker
Cloudflare comme une réponse en flux.

**La limite des six connexions** (MDN, « Using server-sent events ») :
« When not used over HTTP/2, SSE suffers from a limitation to the maximum
number of open connections […] (6) », par navigateur et par adresse. Le
portail est en HTTP/1.1 : chaque onglet d'Idéation prend une connexion sur
six, et les autres pages du portail se partagent le reste. Ce que fait la
page : un seul flux par onglet, un seul POST de présence à la fois, et un
onglet **caché hors appel rend sa connexion après une minute** (il revient
en redevenant visible). Derrière la porte Cloudflare, la limite s'efface :
« HTTP/2 is enabled by default for all plans » entre le navigateur et
Cloudflare ([HTTP/2](https://developers.cloudflare.com/speed/optimization/protocol/http2/)),
et en HTTP/2 le nombre de flux simultanés se négocie (« defaults to 100 »,
MDN).

**Cloudflare, plus tard** : un Worker relaie une réponse en flux ; le tunnel
rapide `trycloudflare` n'a pas de SSE (étude Cloudflare § 3.1, écarté de
toute façon) ; le flux à travers Workers VPC n'est pas documenté (même étude,
« Ce qui reste incertain », 2) : à vérifier à l'étape 2. Le commentaire SSE
toutes les 15 s est ce que MDN recommande contre les coupures
(« a server can send a comment periodically to keep the connection alive »).

## 3. Identité, droits, quotas

- Le flux donne à l'onglet un **identifiant de connexion** (`cid`) ; le nom,
  la couleur et la personne viennent de la **session** (la porte), jamais du
  corps d'une requête. Une requête au nom d'un `cid` doit venir de la même
  personne **et** de la même session (403 sinon ; 410 si l'onglet est parti,
  la page se reconnecte). Un `cid` connu des autres (il faut bien adresser
  les signaux) ne permet donc pas d'agir à sa place.
- Couleurs : six jetons du thème (`cy`, `grn2`, `amb`, `coral-3`,
  `coral-2`, `ink`), la première libre sur la planche, la même dans tous
  les onglets d'une personne, gardée avec chaque message.
- Quotas : 8 onglets à plusieurs par personne, 32 par planche, 256 en tout ;
  6 personnes dans un appel (un maillage : chacun envoie à tous) ; 40
  présences par seconde et par onglet ; 20 messages par minute et par
  personne, 2 000 signes ; 240 signaux par minute, 64 Ko ; corps refusés
  avant lecture au-delà de 16 Ko (présence), 32 Ko (message).
- **Journal** : les arrivées et départs y sont (« idéation · entre /
  quitte »), comme chaque message et signal (le journal des écritures du
  socle). Une présence **acceptée** n'y est pas : jusqu'à ~16 POST par
  seconde noieraient le journal (audit B5). Faute de crochet dans le socle,
  le module met `req.protected = False` après avoir vérifié l'onglet
  (`auth.after` ne lit plus ce drapeau que pour journaliser) ; les refus
  (autre session, onglet parti) restent journalisés. **À faire dans le
  socle** : un drapeau propre (`req.journal = False`) lu par `auth.after`.

## 4. La visio : WebRTC pair à pair

- **Maillage** : chaque paire d'onglets dans l'appel a sa connexion ; l'offre
  vient toujours du plus petit `cid` (pas de collision d'offres, pas besoin
  de la « perfect negotiation »). Pas de « trickle » : l'offre et la réponse
  partent avec tous leurs candidats (réseau local, rassemblés en quelques
  millisecondes, 2,5 s au plus).
- Deux transceivers (son, image) posés une fois ; couper la caméra, la
  rallumer, partager l'écran passent par `replaceTrack` — **sans
  renégocier** (mesuré : la caméra rallumée revient chez l'autre). Couper
  la caméra arrête la piste (le voyant s'éteint) ; couper le micro la met en
  sourdine.
- **Contexte sécurisé** (MDN, `getUserMedia`) : « in insecure contexts,
  `navigator.mediaDevices` is `undefined` » ; un contexte sûr est « a page
  loaded using HTTPS or the `file:///` URL scheme, or a page loaded from
  `localhost` » ; `getDisplayMedia` : « available only in secure contexts »
  et demande un geste de l'utilisateur. Le portail est servi en
  **http://192.168.10.247** : pas de caméra, pas de micro, pas d'écran. La
  page de `RTCPeerConnection` ne porte pas cette mention : **on peut
  rejoindre pour voir et entendre**. L'onglet Visio le dit (l'encadré ambre,
  les contrôles désactivés avec leur raison, le lien MDN) et dit comment
  débloquer : `ssh -L 8790:127.0.0.1:8790 dgx2`, puis
  `http://localhost:8790/` (pour Cal seulement : les amis n'ont pas de
  compte ssh), ou la porte Cloudflare (https).
- **Essai** (Playwright sur DGX2, `--use-fake-device-for-media-stream
  --use-fake-ui-for-media-stream`, trois navigateurs) : Cal et Lina par
  `http://localhost:8802` (sûr : c'est ce que donne le tunnel ssh), Noé par
  `http://192.168.10.247:8802` (pas sûr). Cal ↔ Lina `connected`, son et
  image `live` ; Noé, sans `navigator.mediaDevices`, rejoint en écoute et
  reçoit les deux images ; micro et caméra coupés se voient chez l'autre ;
  le partage d'écran (source factice) arrive chez Lina ; la présentation de
  l'atelier réduit tout en pastille. 32 contrôles sur 32.

### Derrière la porte Cloudflare

1. **HTTPS** : donné par le Worker (`*.workers.dev`) — la caméra s'ouvre.
2. **STUN** : sans lui, deux navigateurs derrière deux box ne trouvent pas
   leurs adresses publiques ; celui de Cloudflare : `stun.cloudflare.com`
   (3478/udp).
3. **TURN** : derrière un NAT symétrique ou une 4G (CGNAT), le pair à pair
   direct échoue (l'onglet Visio dit alors « pas de chemin ») ; il faut un
   relais. Cloudflare Realtime TURN : « free of charge when used together
   with the Realtime SFU. Otherwise, it costs $0.05/real-time GB outbound » ;
   les identifiants se créent par l'API
   (`…/v1/turn/keys/<id>/credentials/generate-ice-servers`, avec un `ttl`),
   donc **par le serveur**, par session, jamais dans la page ni dans le
   dépôt : le réglage `ideation_ice_servers` (statique aujourd'hui, vide)
   deviendra une liste fabriquée pour chaque `hello`. Un coturn sur un DGX
   demanderait un port UDP ouvert chez Cal (contraire à l'étude Cloudflare).
4. Au-delà de 6 : un SFU (chacun envoie une fois) — Cloudflare Realtime
   SFU, ou rien : c'est un atelier entre amis.

Sources : MDN [getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia),
[getDisplayMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia),
[Secure contexts](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts),
[RTCPeerConnection](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection),
[Using server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events) ;
Cloudflare [Realtime TURN](https://developers.cloudflare.com/realtime/turn/),
[generate credentials](https://developers.cloudflare.com/realtime/turn/generate-credentials/).

## 5. La co-édition : pas maintenant, voici comment

Aujourd'hui une planche n'a qu'un écrivain à la fois : la page envoie la
planche entière avec sa version (`rev`), un second écrivain reçoit 409 et le
bandeau « conflit ». À plusieurs, chacun voit les curseurs et les
sélections des autres, mais **pas leurs gestes** tant qu'il ne recharge pas.
En attendant, la présence porte la version de chacun : quand un autre a
enregistré après moi, la barre dit « Lina a changé la planche · recharger »
(le bouton « Recharger celle du serveur » de la page, sans quitter l'appel ;
refusé tant que mes propres gestes ne sont pas enregistrés).

**Constaté à l'essai** : trois personnes qui **ouvrent** la même planche la
mettent en conflit sans avoir rien touché — le canvas mesure la hauteur des
notes, post-it et titres (`measure()`, `AUTO_H`) et l'enregistre
(`app.touch`) ; le premier enregistre, les deux autres reçoivent 409. À
corriger dans le modèle (une mesure n'est pas un geste), avant tout le reste.

Le plan, sur le modèle de Figma (« How Figma's multiplayer technology
works », 2019), qui a écarté OT et les vrais CRDT pour un serveur arbitre :

- **Qui gagne** : le serveur ordonne ; le dernier arrivé gagne, **propriété
  par propriété** (« similar to a last-writer-wins register in CRDT
  literature except we don't need a timestamp because the server can
  define the order of events »). Deux personnes qui changent deux
  propriétés d'un même objet ne se gênent pas.
- **À quelle granularité** : l'objet et ses champs — la géométrie
  (`x, y, w, h` ensemble : un déplacement ne se mélange pas), le texte (entier
  : des notes courtes, pas besoin d'un CRDT de texte — et pas de dépendance),
  la couleur, le nom d'un cadre, les réglages d'une carte Générer ; un lien
  est un objet (créé, supprimé). Les identifiants neufs portent l'identifiant
  de l'onglet (Figma : « including that client ID as part of newly-created
  object IDs ») — `app.uid()` le fait presque déjà. Une suppression gagne
  sur un changement concurrent (Figma ne garde rien d'un objet supprimé côté
  serveur : il vit dans l'annulation de celui qui l'a supprimé). Pendant
  qu'on écrit dans une note, la présence dit « Lina écrit ici » (son anneau)
  et les autres voient le texte arriver à l'enregistrement.
- **Avec quelle source** : le serveur reste la seule vérité
  (`<data_dir>/ideation/<id>.json`), tenu par une suite d'opérations
  numérotées (`seq` remplace `rev`) ; la page applique ses gestes tout de
  suite, les envoie par petits POST (comme la présence), les reçoit des
  autres par **le même flux SSE** (événement `op`) et se recale sur l'ordre
  du serveur ; `hello` donne la planche et son `seq`, un trou se relit par
  `seq`. Annuler / rétablir : les opérations de chacun seulement, comme
  Figma (« An undo operation modifies redo history at the time of the undo
  »). Les travaux en cours (`jobs`) et les résultats posés par une
  génération deviennent des opérations du serveur.
- **Ce que ça demande au canvas** (refondu en ce moment) : que chaque geste
  passe par une fonction qui dit *quoi* a changé (objet, champ, valeur), pas
  seulement `commit()` sur la planche entière.

## 6. Ce qui manque, ce qui est moche

- **HTTPS** (caméra et micro pour les amis) et **TURN** (hors de la maison) :
  la porte Cloudflare, § 4.
- **La co-édition** : § 5. Et le conflit à l'ouverture, à corriger d'abord.
- La barre d'Idéation passe sur deux lignes à 1500 px (avec les boutons de
  l'atelier) ; le bandeau cache l'inspecteur tant qu'il est ouvert.
- Six couleurs de participant empruntées aux jetons (`amb` signifie aussi
  « ce qui attend Cal ») : il faudrait des jetons à eux (`--p1`…`--p6`) dans
  `commun/tokens.css`.
- L'étiquette « vue · X » passe sous le bandeau « Moteur factice » quand la
  vue de l'autre commence en haut à gauche.
- Pas d'indicateur de parole, pas de choix de caméra / micro, pas de mode
  « suivre » ; un message ne se corrige pas (il se retire) ; `hello` ne
  donne que les 500 derniers messages.
- Ce que le canvas devrait exposer (lu aujourd'hui autrement) : la
  conversion monde ↔ écran (calculée depuis `S.view`), un
  `app.reloadBoard()` (le module clique `#c-reload`), un événement pendant
  qu'on déplace des objets (le module observe la classe `.moving`).
