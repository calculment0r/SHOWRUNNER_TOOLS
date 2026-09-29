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
| `server/tools/ideation_collab.py` | présence, fil, signalisation ; la co-édition (§ 5) ; les rôles et les invitations (§ 6) ; l'interrogation sans flux (§ 8) ; `selftest` |
| `ideation/collab.js` | le module greffé (`install(app)`, une ligne dans `PLUGINS` de `ideation/plugins.js`) ; suivre (§ 7), inviter (§ 6) |
| `ideation/coedition.js` | la co-édition côté page (créée par `collab.js`, `app.coed`) |
| `ideation/collab.css` | sa feuille (chargée par le module : `index.html` n'a pas changé) |
| `ideation/ideation.js` | quatre accroches `// collab :` (l'enregistrement passe par `app.coed`, `app.paintSave`, `board:open`) |
| `server/tools/ideation.py` | `load` et `_write` passent par la planche en mémoire ; les routes demandent le rôle (`_need`) |

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
| `POST …/ops {sid, n, ops, live}` · `GET …/ops?since=R` | la co-édition (§ 5) : un lot d'opérations ; les lots d'après R |
| `GET …/stream?since=R` · `GET …/poll?resume=&since=&wait=` | le flux rejoue d'abord les lots d'après R ; l'interrogation longue (§ 8) |
| `GET · POST …/access` · `POST …/invites` · `POST …/invites/<id>/revoke` | les rôles, les réglages, les liens (§ 6) |
| `POST /api/auth/ideation-invite/<jeton>` | ouvrir un lien (sous `/api/auth/` : une session qui attend y passe) |

Le flux porte aussi `op` (un lot appliqué), `reset` (la planche écrite entière
ailleurs) et `role` (mon rôle a changé) ; la présence porte `lead` (« suivez-moi »)
et `role`.

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

## 5. La co-édition (29/09, faite)

Avant : une planche n'avait qu'un écrivain à la fois (la page envoyait la
planche entière avec `rev`, un second écrivain recevait 409), et la barre
disait « Lina a changé la planche · recharger ». Maintenant, à plusieurs,
chacun voit les gestes des autres en direct ; l'enregistrement entier ne sert
plus que de repli (§ 5.5), et l'avis « recharger » ne s'affiche que là.

### 5.1 Le modèle : le serveur arbitre, le dernier écrit gagne registre par registre

Sur le modèle de Figma ([How Figma's multiplayer technology works](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/), 2019),
qui a écarté OT (« OTs were unnecessarily complex for our problem space ») et
les vrais CRDT (« Figma isn't using true CRDTs though ») pour un serveur
central (« our server is the central authority ») :

- **Le serveur ordonne** : chaque lot d'opérations reçoit un numéro, la
  version de la planche (`rev`, un lot = une version). « Figma's multiplayer
  servers keep track of the latest value that any client has sent for a given
  property on a given object » ; « similar to a last-writer-wins register in
  CRDT literature except we don't need a timestamp because the server can
  define the order of events ».
- **Les registres** : un objet (nœud) ou un lien, et chacun de ses champs.
  La géométrie `x, y, w, h` est un seul registre (un déplacement ne se mélange
  pas avec un autre) ; pour un objet qui mesure sa hauteur (`AUTO_H` de
  `canvas.js` : note, post-it, titre, cartes), `h` est à part et ne part
  qu'avec un vrai changement de l'objet (**une mesure n'est pas un geste** :
  deux navigateurs qui mesurent 82 et 84 px ne se renvoient rien, et une
  mesure n'écrase jamais un déplacement). Les deux bouts d'un lien (`a, b, pa,
  pb`) sont un registre ; chaque autre champ (texte, couleur, nom, prompt,
  `slots`, `group`, `jobs`…) en est un. « Two clients changing unrelated
  properties on the same object won't conflict ».
- **Un retrait gagne** : un changement d'un objet absent est écarté (le
  serveur le dit, `drop : absent`) ; un objet retiré emporte ses liens. Le
  serveur ne garde rien d'un objet retiré ; il vit dans l'annulation de celui
  qui l'a retiré (Figma : « That data is instead stored in the undo buffer of
  the client that performed the delete »).
- **Les identifiants neufs** portent l'horodatage et un tirage (`app.uid()`) :
  deux onglets ne créent pas le même.
- **L'ordre** (l'empilement, l'ordre des fils d'une entrée, l'ordre des
  enfants d'une rangée) : Figma range les enfants par une fraction
  (« An object's position in its parent's array of children is represented as
  a fraction between 0 and 1 exclusive ») ; la planche garde des tableaux et
  on ne change pas son format. L'ordre est donc un registre de la planche,
  **fusionné par le serveur** : la page envoie l'ordre qu'elle voit (`ord`),
  le serveur l'applique en gardant ce qu'elle ne connaissait pas juste après
  son voisin d'avant, et renvoie l'ordre complet après chaque ajout ou
  réordonnancement ; chaque page l'adopte quand elle n'a pas d'ordre en
  attente. Un ajout à la fin ne l'envoie pas (le serveur place à la fin).
- **Les règles des groupes** (un groupe de moins de deux enfants se dissout)
  tournent sur le serveur après chaque lot, comme dans `normalize` ; ce qui en
  change part à tous (`fx`). Une opération invalide est écartée et l'objet
  remis chez tous tel que le serveur l'a (`fx : put`) : personne ne diverge.
- **Un résultat de travail posé deux fois** (deux onglets suivent le même
  travail : `gen.js` reprend les travaux d'une planche rouverte) : le serveur
  garde le premier, retire l'autre chez tous.

### 5.2 La page (`coedition.js`) : juste par construction

- **Les opérations ne sont pas écrites geste par geste.** Chaque geste finit
  déjà par `commit` (ou `quiet`, un travail qui avance) ; la page compare
  alors la planche à sa copie `base` (ce que le serveur a, plus ce qu'elle a
  déjà envoyé) et en tire les opérations. Aucun geste ne peut y échapper, y
  compris ceux des objets que l'autre agent ajoute en ce moment (formes, mind
  map, crayon) : rien à déclarer. Mesuré (Chromium, DGX2) : la comparaison
  coûte 0,2 ms pour 300 objets, 0,8 ms pour 3 000.
- **Pendant un geste** (déplacer, redimensionner, mettre à l'échelle), la
  géométrie part au fil de l'eau : 20 lots par seconde au plus, un seul en vol
  (ce qui s'accumule part au suivant, fusionné). Un champ qu'on remplit part 5
  fois par seconde (l'objet choisi, ou celui du champ). Les autres replacent
  seulement les objets qui bougent, sans refaire la planche ; un rendu entier
  suit quand le geste s'arrête.
- **Les opérations des autres** arrivent par le flux, dans l'ordre du serveur
  (`rev`), et s'appliquent à la planche et à `base` — sauf sur un registre où
  j'ai un changement non confirmé (« we want to discard incoming changes from
  the server that conflict with unacknowledged property changes ») ou en cours
  (le texte que je tape, l'objet que je traîne) : ma valeur, écrite après,
  gagnera. Un objet retiré l'est toujours. Un trou dans les numéros se relit
  (`GET …/ops?since=`) ; un écho qui tarde (2,5 s) aussi.
- **Le champ où l'on écrit** ne se casse pas : le canvas ne refait pas l'objet
  où l'on écrit (`render`, déjà), l'inspecteur attend qu'on le quitte ; mon
  texte en cours n'est pas écrasé par celui d'un autre (il repartira).
- **Annuler** ne défait que mes gestes, registre par registre : un pas garde
  la valeur d'avant de chaque registre que mon geste a changé (le pas s'ouvre
  à `app.snap()`, comme avant) ; annuler remet ces valeurs (un objet retiré
  par un autre entre-temps reste retiré) et range les valeurs d'à présent dans
  « rétablir » — « An undo operation modifies redo history at the time of the
  undo, and likewise a redo operation modifies undo history at the time of
  the redo ». Les opérations des autres n'entrent jamais dans ma pile ; ce que
  les travaux écrivent seuls (`jobs`, `error`) non plus. Un pas qui ne change
  plus rien (tout a été retiré) est passé.
- **Rien à enregistrer** : `S.dirty` et « enregistre / enregistrée » disent où
  en sont les envois ; plus de 409 à plusieurs.

### 5.3 Le serveur

La planche est tenue en mémoire le temps de la co-édition (`_hot`) : un lot
s'applique en mémoire, valide chaque objet par `ideation._node` (la même
validation que l'enregistrement entier), avance `rev`, entre dans le journal
des lots (4 000 lots, 16 Mo au plus), part à tous par le flux, et la planche
s'écrit sur le disque tout de suite (un geste en cours : au plus toutes les
0,8 s). `ideation.load` écrit d'abord ce qui est en mémoire (l'export, la copie,
l'enregistrement entier lisent le vrai) ; `ideation._write` venu d'ailleurs
(le repli, renommer) efface la copie et recale les onglets (`reset`). Un lot
renvoyé (réponse perdue) n'est appliqué qu'une fois (`sid`, `n`). Un geste en
cours ne va pas au journal des écritures (jusqu'à 20 lots par seconde) ; le
lot qui le termine, oui.

### 5.4 Hors ligne, flux coupé

Les opérations s'accumulent (le même lot se renvoie, avec le même numéro,
jusqu'à 15 s entre deux essais) ; au retour, le flux s'ouvre avec `since` et
rejoue d'abord les lots manqués. Si la mémoire du serveur ne remonte pas
jusque-là (redémarré, trop ancien, planche écrite entière) : la page relit la
planche et rejoue ses gestes dessus, puis les renvoie (Figma : « the client
downloads a fresh copy of the document, reapplies any offline edits on top of
this latest state, and then continues syncing updates »). Sans flux, la page
relit les lots toutes les 4 s.

### 5.5 Le repli : l'enregistrement entier

Un refus franc du serveur (la route n'existe pas, un lot illisible) coupe la
co-édition : la page enregistre la planche entière avec sa version, comme
avant, et un conflit (409) propose de recharger. Une page d'avant (sans
`coedition.js`) fait de même : elle reçoit 409 dès qu'un autre a co-édité.

### 5.6 Mesures et essais (29/09, DGX2, copie `/tmp/sr_ide_coed`)

| | |
|---|---|
| un lot, POST → flux SSE d'un autre onglet (200 lots à 20 Hz, planche de 300 objets) | médiane 1,5 ms, p95 2,1 ms, max 2,4 ms ; 200/200 |
| le même, → un onglet qui interroge (§ 8) | médiane 42 ms (40 ms de regroupement voulu), max 43,5 ms |
| un lot écrit sur le disque tout de suite (300 objets) | médiane 1,8 ms, max 9,7 ms |
| `tools/check.py` | 1 094 contrôles, 0 échec (dont co-édition, rôles, interrogation) |

Playwright, trois navigateurs (`/tmp/sr_ide_coed_pilote.mjs`, 48 contrôles ; 49
en interrogation, sans aucun flux SSE) : Cal traîne une carte, Lina voit 15
positions intermédiaires ; couleur et texte du même post-it changés au même
instant : les deux gagnent, chez les deux et sur le serveur ; un titre retiré
pendant qu'on l'écrit : retiré partout ; Lina écrit dans une note pendant que
Cal pose et déplace : son champ reste en écriture, son texte intact, Cal le
voit arriver ; Ctrl+Z de Cal rend sa couleur et laisse le post-it là où Lina
l'a mis, Ctrl+Z de Lina défait son déplacement et pas la couleur de Cal ; Lina
hors ligne 2,5 s puis rétablie : les deux et le serveur ont la même planche ;
aucun 409 de tout l'essai.

## 6. Les rôles par planche, les invitations

Demande de Cal (29/09) : « le canva pourra être collaboratif hein ? c'est très
important.. et on pourra inviter quelqu'un pour qu'il soit un viewer et suivre
ce qu'on fait en temps réel ? »

- **Trois rôles**, comme les accès d'un fichier Figma ([Guide to sharing and permissions](https://help.figma.com/hc/en-us/articles/1500007609322-Guide-to-sharing-and-permissions) :
  « People with can view access can only perform certain 'read only' actions,
  like inspecting properties, following, and commenting ») : le
  **propriétaire** (qui a créé la planche ; les admins le sont de toutes), l'
  **éditeur**, le **spectateur**. Le spectateur voit tout en direct (objets,
  curseurs, sélections, fil, visio), suit qui il veut, ne modifie rien : sa
  planche est figée (`canvas.lock`), l'inspecteur et les outils de pose
  s'éteignent, un changement forcé revient aussitôt, et **le serveur refuse
  ses opérations (403)** — aussi l'enregistrement entier, renommer, dupliquer.
  Il écrit au fil si le propriétaire l'a permis (réglage).
- **Les membres du portail** sans rôle sur une planche y ont le réglage de la
  planche : éditeurs (par défaut : comme avant), spectateurs, ou sans accès.
  La liste des planches ne montre que celles où l'on a un rôle ; seul le
  propriétaire met une planche à la corbeille.
- **Inviter** (« Inviter » dans la barre, propriétaire) : un lien, un rôle
  (éditeur ou spectateur), une durée (1 h, 1 jour, 7 jours, 30 jours). Le lien
  ne s'affiche qu'une fois (le serveur n'en garde que l'empreinte, comme les
  sessions) ; la liste dit qui l'a ouvert ; « Retirer » le coupe et retire ce
  qu'il a donné (l'onglet ouvert est fermé : « accès retiré »). Qui ouvre le
  lien entre par la porte du portail (son pseudo) ; **un pseudo neuf est
  accepté par le lien** (le propriétaire l'a créé : c'est son accord, noté au
  journal) et n'a, dans Idéation, que les planches de ses liens.
- Hors du dépôt : `<data_dir>/ideation_collab/<planche>.access.json` et
  `_invites.json` (les personnes entrées par un lien).
- **La limite** : la porte du socle ne sait pas restreindre un compte à une
  planche. Une personne acceptée par un lien est une amie du portail : les
  autres outils (Image, Vidéo…) lui sont ouverts comme aux amis que Cal
  accepte. Il faudrait dans `core/auth.py` un état « invité » (hors du
  périmètre de ce travail, qui ne touche pas au socle). Et la route d'un lien
  vit sous `/api/auth/` (la seule que la porte laisse passer à une session qui
  attend) : à ranger dans le socle le jour où il saura le dire.

## 7. Suivre

- **Un clic sur un visage** suit sa vue (Figma, [spotlight](https://help.figma.com/hc/en-us/articles/5025214483351-Facilitate-meetings-with-spotlight) :
  « If you click on another person's avatar, you will begin to follow their
  view of the board ») : ma vue tient le cadre que l'autre regarde (sa
  présence le porte), centrée, en un vol court (0,14 s) à chaque changement.
  Un geste de ma part sur la planche (molette, glisser, zoom au clavier)
  rompt le suivi ; la barre dit « Lina · reprendre », un clic le reprend ;
  « suit Lina · arrêter » tant qu'on suit.
- **« Suivez-moi »** (menu de mon visage ; pendant la présentation par cadres,
  la pastille « suivez-moi » en bas à gauche, la barre étant cachée) : ma
  présence le dit, tous me suivent (Figma : « Everyone currently viewing the
  board will be notified that you'd like them to follow you » ; ici sans le
  délai « Not now » : le suivi commence tout de suite, et un geste le rompt).
  Qui arrive pendant ce temps suit aussi. « Arrêter » : chacun reprend sa vue,
  là où il est.
- **Pendant la présentation de l'atelier** (`atelier/presentation.js`, sans
  y toucher) : la caméra du présentateur vole de cadre en cadre ; sa vue part
  avec sa présence, ceux qui le suivent voient la même diapositive (écart
  mesuré : 0,1 px du monde). Celui qui présente ne suit personne.

## 8. Derrière la porte Cloudflare, derrière le tunnel de démo

- **Le tunnel rapide de la démo** : « Quick Tunnels do not support
  Server-Sent Events (SSE) » ([Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/),
  `docs/etudes/cloudflare.md` § 3.1). **Repli fait : l'interrogation longue**
  (`GET …/poll`) : la page demande « ce qui s'est passé depuis », le serveur
  tient la question jusqu'à 20 s ou jusqu'au premier événement (une réponse
  ordinaire, entière), regroupe ce qui arrive dans les 40 ms, et rend les
  mêmes événements que le flux, dans le même ordre ; un onglet qui ne demande
  plus depuis 8 s est « coupé » pour les autres. La page passe d'elle-même à
  l'interrogation sur `*.trycloudflare.com`, ou quand un flux ne dit jamais
  bonjour deux fois de suite (9 s chacun). Essai : tout le pilote passe sans
  un seul flux SSE (49 contrôles). Présence, curseurs, fil, co-édition, rôles,
  suivre passent ; **la visio non** (sans STUN ni TURN, deux réseaux ne se
  joignent pas, § 4) ; et la limite du tunnel, « 200 in-flight requests »,
  compte une question tenue par onglet.
- **La porte Cloudflare (Worker + Workers VPC)** : un Worker relaie une réponse
  en flux ; **le flux à travers Workers VPC n'est pas documenté** (étude
  Cloudflare, « Ce qui reste incertain », 2) : non vérifié. Si le flux passe,
  tout passe ; s'il ne passe pas, la page bascule d'elle-même sur
  l'interrogation (ci-dessus). En HTTPS, la caméra s'ouvre ; la visio entre
  deux maisons demande TURN (§ 4). Les opérations, les rôles, les invitations
  sont des requêtes ordinaires.

## 9. Ce qui manque, ce qui est moche

- **HTTPS** (caméra et micro pour les amis) et **TURN** (hors de la maison) :
  la porte Cloudflare, § 4.
- **Les registres entiers** : les cases d'un composeur (`slots`) forment un
  seul registre, les travaux d'une carte (`jobs`) aussi : deux personnes qui
  écrivent en même temps dans deux cases du **même** composeur, la dernière
  gagne pour toutes les cases. À découper (une case = un registre) si ça
  gêne. Le texte d'une note est entier aussi (pas de CRDT de texte) : deux
  personnes dans la même note, la dernière gagne ; l'anneau de sélection dit
  qui est dedans.
- **Un invité est un ami du portail** (§ 6) : à restreindre dans le socle.
- La boîte d'un groupe déplié et les places d'une rangée sont dérivées : elles
  partent avec les gestes (sans conflit réel, chacun les recalcule), un peu de
  bruit dans les lots.
- La barre d'Idéation passe sur deux lignes (avec les boutons de l'atelier et
  « Inviter ») ; le bandeau cache l'inspecteur tant qu'il est ouvert.
- Six couleurs de participant empruntées aux jetons (`amb` signifie aussi
  « ce qui attend Cal ») : il faudrait des jetons à eux (`--p1`…`--p6`) dans
  `commun/tokens.css`.
- Pas d'indicateur de parole, pas de choix de caméra / micro ; un message ne
  se corrige pas (il se retire) ; `hello` ne donne que les 500 derniers
  messages.
- Ce que le canvas devrait exposer (lu ou refait aujourd'hui ailleurs) :
  `place(id)` (la co-édition replace elle-même un objet qui bouge chez un
  autre, en recopiant `place`), `app.paintUndo()` (le module repeint les
  boutons annuler / rétablir), la conversion monde ↔ écran (calculée depuis
  `S.view`), un `app.reloadBoard()` (le module clique `#c-reload`).
