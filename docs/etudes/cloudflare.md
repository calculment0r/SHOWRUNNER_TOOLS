# La porte d'entrée Cloudflare — étude du 28/09/2026, prête à déployer le 29/09

**29/09 au soir : la porte est en ligne** (Worker `showrunner` → Workers
VPC → 127.0.0.1:9790 de DGX2) ; Cal quitte Cloudflare Access pour **la
porte par code** (section suivante). Ce qui suit la section « La porte par
code » est l'étude d'avant, gardée telle quelle.

**06/10 : le compte des requêtes du Worker** (section suivante) : 80 000 requêtes
dans la journée sur 100 000 ; les relevés des pages divisés par 6 à 13 au repos, à zéro
pour un onglet caché.

---

## Le compte des requêtes du Worker (06/10/2026)

### Ce qui s'est passé

Cloudflare a prévenu Cal que le Worker `showrunner` avait fait 80 000 requêtes dans la
journée, sur les 100 000 de Workers Free. L'Observability du Worker, vers 20 h, montrait
**5 340 événements dans l'heure** (≈ 89 par minute). Presque tous étaient
`GET /api/jobs?limit=60`, parfois trois à quelques dizaines de millisecondes d'écart (donc
plusieurs onglets), et de temps en temps `GET /api/auth/me`.

### Ce que Cloudflare compte

Ces pages ont été lues dans leurs sources (dépôt `cloudflare/cloudflare-docs`, branche
`production`, le 06/10) : `developers.cloudflare.com` est fermé depuis le conteneur.

- **100 000 requêtes par jour** sur Workers Free, remises à zéro **à minuit UTC** (2 h à Paris
  jusqu'au 25/10, 1 h ensuite). Au-delà, Cloudflare répond « Error 1027 »
  ([limits, Daily requests](https://developers.cloudflare.com/workers/platform/limits/#daily-requests)).
- **Les assets sont gratuits et illimités ; `run_worker_first` ne l'est pas** : « requests
  matching the specified patterns will always invoke your Worker script. If you exceed your free
  tier request limits, these requests will receive a 429 (Too Many Requests) response instead of
  falling back to static asset serving »
  ([Static Assets, Billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)).
  - Donc, la limite passée, les pages s'affichent encore, mais `/api/*`, `/library/*`, les
    médias et `/ecoute/*` répondent 429 jusqu'à minuit UTC.
  - Les motifs négatifs (`!/…`) renvoient aux assets sans le Worker
    ([binding, run_worker_first](https://developers.cloudflare.com/workers/static-assets/binding/#run_worker_first)) ;
    ils ne servent à rien ici : ce qui passe par le Worker a besoin de lui.
- **Ce qui compte** : « Inbound requests to your Worker ». Les sous-requêtes (le Worker vers
  DGX2 par Workers VPC, vers R2) ne sont pas facturées. Un WebSocket compte pour une requête
  (l'`Upgrade`), ses messages pour rien
  ([pricing](https://developers.cloudflare.com/workers/platform/pricing/), notes 1 et 2).
- **La durée** : « There is no hard limit on duration for HTTP-triggered Workers. As long as the
  client remains connected… » ; attendre le réseau ne compte pas dans les 10 ms de CPU. Le
  moteur est mis à jour « a few times per week », avec 30 s de grâce pour une requête en cours
  ([limits, Duration et CPU time](https://developers.cloudflare.com/workers/platform/limits/#duration)).
- **Workers Logs** (`observability`, `head_sampling_rate: 1`) sur Workers Free : 200 000
  événements par jour, gardés 3 jours
  ([Workers Logs, Pricing](https://developers.cloudflare.com/workers/observability/logs/workers-logs/#pricing)).

### D'où venaient les requêtes : mesuré

Le compteur `tools/compte_requetes.mjs` lance Playwright devant le portail d'essai. Il compte
les requêtes des chemins de `run_worker_first` par le protocole de Chromium : ce que le cache
du navigateur sert ne compte pas, une revalidation (304) compte. L'état « caché » est simulé
(`document.hidden`, `visibilitychange`), car Chromium sans affichage ne cache jamais un onglet.
Le ralentissement des minuteries d'un onglet caché n'est donc pas compté : l'« avant caché »
est le pire cas.
- Chrome vérifie les minuteries d'un onglet caché une fois par seconde, puis une fois par
  minute après 5 minutes cachées, si la chaîne de minuteries est assez longue (MDN,
  `setTimeout`, « Timeouts in inactive tabs »).
- Un onglet qui joue du son n'est pas ralenti (MDN, Page Visibility API).

Requêtes du Worker par minute, onglet inactif, avant le 06/10 (visible = caché) :

| page | par minute | par jour, onglet ouvert | d'où |
|---|---|---|---|
| accueil | 26 | 37 440 | la file **deux fois** (20), la session (3), le budget (3) |
| Asset, Idéation | 13 | 18 720 | la file toutes les 6 s (10), la session toutes les 20 s (3) |
| ODIO | 33 | 47 520 | la file **trois fois** (30), la session (3) |
| Admin | 33 | 47 520 | `admin/state` toutes les 3 s (20), la file, la session |
| Character Factory | 31 | 44 640 | ses trois relevés du studio toutes les 5 s (18), la file, la session |

« Deux fois », « trois fois » : c'était un défaut de `jobs.poll`. Chaque `jobs.watch` d'une page
lancé pendant un relevé en vol ajoutait une chaîne de relevés. Quatre onglets (accueil, ODIO,
Asset, Idéation) font 85 requêtes par minute : c'est ce que montrait l'Observability.

### Ce qui a été fait (branche `wip2/worker-requetes`)

1. **Onglet caché : plus aucun relevé** (`commun/shell.js` : `ongletCache`, `auRetour`,
   `quandVisible`, `releve(fn, ms)`). Un onglet caché ne relit plus rien ; il relit tout de
   suite à son retour. Une fenêtre détachée visible (`commun/fenetre.js`) garde la page
   « visible ». C'est le cas de la file, de la session, du tiroir de la file, d'Admin (et de
   ses diagnostics), de l'agent d'Idéation, de `jobs.wait`, du budget de l'accueil, de l'état
   d'H3, de Transcrire, de la porte en attente, de Movie Analysis et du studio de Character
   Factory. Ce qui continue caché :
   - « Tout lancer et copier » d'Admin : chaque relevé lance le script suivant, l'arrêter
     arrêterait la suite ;
   - **le flux de la collaboration d'Idéation reste ouvert**. C'est une seule requête tant
     qu'il tient. Il porte la signalisation de la visio, qui doit continuer onglet caché. La
     présence dit déjà « absent » (`away: document.hidden`). Le fermer puis le rouvrir
     coûterait une requête à chaque retour, et la visio.
   - Un enregistrement et une lecture d'ODIO n'interrogent rien.
2. **Un seul relevé en vol** (le défaut des chaînes, corrigé).
3. **La file au repos** :
   - 1,5 s quand un travail est en file ou en cours ;
   - 6 s pendant les 2 minutes qui suivent un mouvement ;
   - **30 s au repos** (6 s avant).

   Un travail lancé d'ici se voit tout de suite. `jobs.submit` (`cancel`, `retry`, `forget`)
   et **`api()` relisent la file après toute écriture dont la réponse porte un travail**
   (`job-MMJJ-HHMMSS-xxxx`, `{job}`, `{jobs}`), quelle que soit la route de l'outil. Ce que
   lancent les autres se voit en 30 s au plus.
4. **La session toutes les 60 s** (20 s avant). Elle sert aux Teams et Workspaces, aux
   demandes à traiter (Admin) et au Studio ouvert ou fermé. Une porte qui se ferme (compte
   suspendu, connexion retirée) n'attend pas ce relevé : toute requête refusée en 401 la
   montre aussitôt (`api()`, `showDoor`), et la file relit au moins toutes les 30 s.
5. **Un seul relevé par navigateur**. Les onglets visibles d'un même portail et d'un même
   Workspace élisent un meneur par Web Locks (`navigator.locks`) :
   - le verrou passe au suivant quand l'onglet se ferme ; caché ou porte fermée, l'onglet le
     rend ;
   - le meneur relève et diffuse la liste (`BroadcastChannel` « sr-file:<Workspace> ») ;
   - un geste relève dans son propre onglet et diffuse aussi ;
   - un suiveur qui n'entend rien pendant le délai + 15 s relève lui-même ;
   - un onglet caché garde la dernière liste diffusée sans la traiter, et la traite à son
     retour : rien ne part caché, pas même ce que relit un `sr:job` (Asset, le panneau) ;
   - un travail né et fini entre deux listes (un travail court, ou pendant que l'onglet était
     caché) fait aussi son `sr:job` : il est plus récent que tous ceux de la liste d'avant
     (`created`, l'heure du portail) ;
   - un onglet neuf ne partage qu'une fois son Workspace connu (la session a répondu) ;
   - sans ces API, chaque onglet relève. Web Locks n'existe qu'en contexte sûr (MDN, Web Locks
     API : « secure context ») : à l'adresse publique (https) et en local (127.0.0.1), oui ; à la
     maison (`http://192.168.10.247:8790`), non, et chaque onglet relève, hors du compte de
     Cloudflare ;
   - l'onglet meneur fermé, un autre prend la main (essayé : le verrou est rendu avec l'onglet).

   `jobs.wait` lit la liste tant que le travail tourne, puis sa fiche une fois fini (un GET
   toutes les 1,2 s en plus, avant).
6. **Les vignettes de la bibliothèque à une adresse versionnée**. `thumb.jpg` et
   `ref-NN.thumb.jpg` étaient en `no-cache` : une revalidation par page qui les montre, donc
   une requête du Worker. Elles portent maintenant `?v=<taille-date du fichier>`
   (`library.file_v`) et se gardent un an (`private, immutable`), mais seulement à la version
   du fichier présent ; une autre version se revalide. Les copies d'affichage
   (`view-N.webp?v=`) l'étaient déjà : les grilles d'Asset, le panneau Asset, le fil ne
   redemandent rien d'une visite à l'autre (mesuré : 0 requête `/library/` à la seconde
   visite).

Mesuré après (requêtes du Worker par minute, au repos ; « par jour » = ouvert 24 h) :

| | avant | onglet caché + repos | + partage |
|---|---|---|---|
| 1 onglet (accueil) | 26 | 4 | 4 |
| 3 onglets, dont 2 cachés | 52 | 4 | 4 |
| 3 onglets visibles (plusieurs fenêtres) | 52 | 10 | 6 |
| accueil et ODIO visibles, Admin caché | 92 (somme des mesures par onglet : 26 + 33 + 33) | — | 5 |
| Asset, Idéation, ODIO (un onglet visible) | 13 · 13 · 33 | 3 · 3 · 3 | 3 |
| un onglet caché, quel qu'il soit | = visible | **0** | 0 |
| Admin, Character Factory (visibles) | 33 · 31 | 23 · 21 | 23 · 21 |

Un travail lancé (`POST /api/image/generate`) : la file est relue 18 ms après, puis toutes les
1,5 s ; il est vu fini comme avant. Un travail lancé dans un onglet suiveur est vu par un autre
onglet 4 ms après (la diffusion). Retour d'un onglet caché : relu dans la seconde. Aucune erreur
console sur les 14 pages.

**L'estimation** :
- au repos, un onglet visible coûte 3 à 4 requêtes par minute (≈ 1 800 pour 10 h) ; les onglets
  cachés, rien ;
- pendant un calcul, la file coûte 40 requêtes par minute (2 400 par heure de rendu), une seule
  fois par navigateur ;
- une journée de 10 h devant le portail, dont 3 h de rendus, fait environ 9 000 requêtes,
  contre 80 000 le 06/10 ;
- s'y ajoutent les médias et la bibliothèque, non mesurés ici (le portail d'essai n'en a
  presque pas). Chaque requête partielle d'une vidéo ou d'un son lus compte (`media()`,
  `worker.js`).

**À faire après la mise à jour** : recharger (ou fermer) les onglets du portail déjà ouverts.
Un onglet ouvert garde son ancien code, et ses relevés, jusqu'à ce qu'on le recharge.

**09/10, l'aperçu au survol du nom** (`commun/apercu.js`, `orchestration.md`, « Fait le 09/10 ») : il
n'ajoute aucun relevé. Bulle fermée, aucune requête ; les travaux viennent de la liste de la file déjà
relevée ; les machines, `GET /api/machines/apercu`, une fois par ouverture, resservie 5 s (mesuré par
`commun/pilote_apercu.mjs` : 0 requête bulle fermée, 1 par survol, 0 de plus en la rouvrant dans les
5 s, ni pendant qu'elle reste ouverte et que la file bouge). Au doigt, rien.

### Un flux par onglet (`/api/events`) : étudié, pas codé

L'idée : une requête longue (SSE) qui pousse la file, `ev_seq` et la session, au lieu des
relevés.

Ce qui est clair :
- Cloudflare compte une requête par connexion, sans limite de durée tant que le navigateur
  reste connecté, et le CPU seulement quand le Worker calcule.
- Le Worker relaie déjà un flux tel quel (`rends()`, le flux de la collaboration d'Idéation).
- Le portail sait en écrire un (`ideation_collab.py` : `retry: 3000`, un commentaire toutes
  les 15 s, `HEARTBEAT_S`).
- La file a déjà de quoi prévenir : `core/jobs.py`, `_cv.notify_all()`.

Ce qui ne l'est pas :
- **Par Workers VPC, un flux n'est pas documenté.** `connection_read_timeout` coupe une
  connexion sans données « within the time limit », délai non publié
  ([Workers VPC, troubleshooting](https://developers.cloudflare.com/workers-vpc/reference/troubleshooting/)).
- Le moteur, mis à jour plusieurs fois par semaine, coupe aussi les flux.
- Chaque coupure coûte une requête (la reconnexion d'`EventSource`). Si un flux ne tenait que
  30 s, il coûterait 2 requêtes par minute, autant que la file au repos maintenant.

Le gain restant est surtout pendant les calculs (40 par minute → presque 0). Il ne vaut le
risque qu'après une mesure. Elle est gratuite, car le flux d'Idéation passe déjà par le Worker :

1. Dans l'Observability, filtrer `$workers.event.request.path` sur `…/collab/…/stream`.
2. Le nombre d'invocations par heure, pour une planche ouverte, donne les reconnexions.
3. La durée (wall time) de chaque invocation donne combien de temps un flux tient.

Si un flux tient plusieurs minutes, coder :
- `GET /api/events?since=<ev_seq>` : `hello`, `jobs` (la liste, quand `_cv` bouge), `ev`,
  `me`, un commentaire toutes les 15 s ;
- **ouvert par le seul meneur** (point 5 : un flux par navigateur, pas par onglet), qui diffuse
  aux autres onglets ;
- un repli sur le relevé si le flux ne dit pas bonjour en 9 s ou tombe deux fois de suite,
  comme `ideation/collab.js` (et le tunnel rapide de la démo, qui n'a pas de SSE).

### Ce qui reste

- **Character Factory** (`character/js/studio.js`, `coulisses.js`) : visible, ses relevés
  propres restent toutes les 5 s au repos (18 par minute). Ils pourraient passer à 15-30 s :
  ses gestes relèvent déjà tout de suite (`schedulePoll(600)`).
- **Admin** visible : `admin/state` toutes les 3 s (réglage `admin.refresh`), 20 par minute. À
  rallonger si Cal la laisse ouverte.
- **La session** reste relue par chaque onglet visible (1 par minute). Elle se partagerait
  comme la file.
- **Les fichiers originaux** (`library/<id>/<fichier>`) restent en `no-cache` : leur adresse est
  rendue au serveur par plusieurs outils, la versionner demande de vérifier chacun.
- **Les médias** : chaque plage d'une vidéo ou d'un son lu compte ; à regarder dans
  l'Observability.
- **Au besoin, Workers Paid** : 5 $ par mois, 10 millions de requêtes par mois.

### Ce que Cal peut regarder dans le tableau de bord

Les noms viennent de la documentation (sources lues le 06/10) :
- **Workers & Pages → Overview → `showrunner`** : les **Metrics** du Worker. Le graphe
  **Requests** (Total, Success, Errors) compte les requêtes du Worker. Il y a aussi
  Subrequests, CPU Time et Wall time per execution
  ([Metrics and analytics](https://developers.cloudflare.com/workers/observability/metrics-and-analytics/)).
- **`showrunner` → Observability** (menu de gauche) → onglet **Overview** : le **Query
  Builder** ([Query Builder](https://developers.cloudflare.com/workers/observability/query-builder/)).
  - Visualization **Count**, **Group By** `$workers.event.request.path`, l'intervalle de
    temps, **Run** : les chemins les plus demandés, comme dans l'exemple de la documentation
    (qui groupe par `$workers.event.request.path` et `$workers.event.response.status`).
  - Les vues **Visualizations**, **Invocations** et **Events** ; **Save Query** pour la
    garder.
  - Workers Logs garde 3 jours sur Workers Free.
- **Le chiffre à suivre** : 5 340 événements par heure le 06/10 vers 20 h, presque tous
  `/api/jobs`. Une fois les onglets rechargés, il devrait tomber vers 200 par heure (un onglet
  visible au repos) et 2 400 par heure pendant un calcul.

---

## La porte par code (29/09/2026, soir)

### La demande

Cal, 18 h 15 : « je veux envoyer le lien à un ami pour tester […] un login
simple genre su007 ? je veux pas de mail etc.. simple ». Puis, 18 h 45 : plus
de Cloudflare Access du tout, **Cal compris** (la page d'Access, son attente
du code par e-mail, « ça fait pas pro du tout […] je veux virer cette
merde »). Donc : à l'adresse fixe `https://showrunner.luxigone.workers.dev`,
**notre** page d'entrée, dans notre thème ; un code d'invitation (ou un lien
qui le porte), puis un pseudo ; Cal admin par `nico007` et le code admin.

### Ce qui est retenu, et pourquoi

**La mécanique de la démo (tunnel rapide), derrière le Worker.** Elle est
déjà écrite et contrôlée (« Prêt à déployer », mode `demo`) : code
d'invitation → cookie `sr_invitation` (empreinte du code, `Secure`,
`HttpOnly`, `SameSite=Lax`) ; puis le pseudo : un pseudo accepté entre, un
pseudo neuf **attend Cal** (Admin) ; **un compte admin n'entre qu'avec le
code admin** ; `nouveaux-codes` ferme toutes les sessions de la porte. Ce
qui change, c'est qui a le droit de parler à la porte :

| | porte `demo` | porte **`code`** (neuve) |
|---|---|---|
| qui atteint 127.0.0.1:9790 | le tunnel rapide (`cloudflared --url`) | **le Worker seulement** : chaque requête porte sa signature HMAC (`x-porte-*`, clé `porte.key`, ±60 s, méthode + chemin), sinon 401 — la page d'invitation comprise |
| l'adresse du visiteur | `Cf-Connecting-IP` en clair | **signée par le Worker** (`x-porte-qui`, rôle `code`) : elle sert aux limites d'essais et à la page Admin, jamais à un droit |
| l'adresse | tirée au hasard à chaque lancement | **fixe** |
| Cloudflare Access | — | **aucun** : le Worker ne lit ni ne transmet aucun jeton ; le portail refuse une signature `admin` ou `ami` sur cette porte, même avec un vrai jeton (contrôlé) |

Réglages : `porte.mode = "code"` dans `showrunner.local.json` (le portail)
et `PORTE_MODE = "code"` dans `porte/wrangler.jsonc` (le Worker). Les deux
doivent dire « code » : un Worker `code` devant un portail `access`, ou
l'inverse, ne laisse rien passer (401 partout) — jamais rien d'ouvert.

**Le Worker en mode code** (`porte/worker.js`) :
- les pages restent des assets (le dépôt, public de toute façon) ; `/api/*`,
  les relais et **`/invitation/*`** (ajouté à `run_worker_first`) passent par
  lui ;
- il transmet au portail **les deux cookies du portail seulement**
  (`sr_session`, `sr_invitation` ; jamais `CF_Authorization` ni un autre) et
  rend les `Set-Cookie` du portail tels quels ;
- **sans l'un de ces cookies, il répond 401 lui-même** (sauf
  `/invitation/…`, `/api/auth/…`, `/api/porte/…`) : les robots n'atteignent
  pas DGX2 ;
- la bibliothèque dans R2 n'est pas servie en mode code (le Worker ne sait
  pas qui est derrière une session ; DGX2 juge) ; les ponts (`/pont/…`) sont
  refusés.

**Le portail en mode code** (`server/core/auth.py`, `_door_gate`) : la
signature d'abord (rôle `code` seulement), puis exactement le chemin de la
démo ; les sessions ouvertes là sont marquées `code` (une session de la démo
ou de la maison n'y vaut rien). La page d'invitation dit « sur invitation »
(plus « démonstration ») ; `?next=` y ramène à la page d'où l'on vient
(`commun/porte.js` y envoie qui n'a pas encore de code).

**Cal, admin** : le lien du code admin (`…/invitation/<code admin>`), puis
`nico007`. Sa session tient **120 jours** (`SESSION_DAYS`) sans retaper le
code (contrôlé) : c'est le « cookie long ». Un mot de passe choisi par Cal
aurait demandé un stockage de mot de passe (dérivation lente, sel,
changement, oubli) pour un gain nul : un code de 16 signes tirés par
`secrets` vaut mieux qu'un mot de passe choisi, et un marque-page suffit.
**Non retenu.**

**Inviter d'avance** : Admin → A · Demandes → « Inviter un ami » : un pseudo
(`su007`) créé **déjà accepté** — l'ami entre sans attendre — et le lien
d'invitation à copier (le code admin n'y est jamais montré). Mêmes règles
qu'à la porte : ni imitation d'un admin (`nic0007`, `CaI`), ni mot réservé,
ni pseudo trop proche d'un autre. En ligne de commande : `tools/porte.sh ami
su007` (`showrunner.py --ami`). Routes : `POST /api/admin/users`,
`GET /api/admin/porte` (`server/tools/compte.py`).

**À savoir** (décision de Cal, « on se log juste avec le pseudo ») : qui a le
code d'invitation et connaît le pseudo d'un ami entre sous ce pseudo. Le code
d'invitation est le vrai secret ; un admin, lui, exige le code admin. Un ami
qui fuit le lien : `nouveaux-codes`, et Cal renvoie le nouveau lien aux
autres (leurs pseudos restent).

### « Access et le pseudo en même temps » : étudié, abandonné

Documenté : une application Access sur un chemin ne protège que ce chemin
([chemins d'application](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/)) ;
le cookie `CF_Authorization` vaut pour tout le nom d'hôte tant que « Cookie
Path Attribute » est désactivé, le défaut
([cookie](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/)).
Access sur `/cal` et le pseudo ailleurs était donc faisable (essayé : le
Worker lisait le cookie hors de `/cal`), au prix du « binding cookie », qui
n'est vérifié que par Cloudflare sur le chemin protégé. Cal ne veut plus
d'Access : **pseudo seul**, code retiré.

Pour mémoire, une politique **Bypass** + **Everyone** : « Bypass does not
enforce any Access security controls and requests are not logged » ; Bypass
est évalué avant Allow ([politiques](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/)) ;
qu'un jeton soit émis pour une requête contournée : **non documenté**. Une
application qui ne garde plus rien n'a pas de raison de rester : **la
supprimer**.

### Les robots, sur une adresse fixe

- Codes : invitation **12 signes**, admin **16**, tirés par `secrets` dans
  un alphabet de 31 (sans 0/O, 1/I/L) : 31¹² ≈ 8·10¹⁷, 31¹⁶ ≈ 7·10²³.
- **Worker** : liaison `ESSAIS` (10 par minute et par adresse) sur chaque
  code tenté (`/invitation/<code>`, `POST /invitation/`) et chaque pseudo
  tapé (`POST /api/auth/enter`) ; `LIMITE` (30 écritures par minute et par
  adresse) comme avant ([rate limit](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) :
  compté par lieu Cloudflare, périodes de 10 ou 60 s). Sans cookie du portail,
  401 sans aller jusqu'à DGX2.
- **Portail** : 10 codes par 10 min et par adresse (signée), 300 en tout ;
  30 pseudos par 10 min et par adresse ; 5 demandes par heure et par adresse,
  3 en attente par adresse, 30 en attente en tout. Contrôlé : 10 mauvais
  codes, puis 429 — même le bon code attend ; une autre adresse passe.
- Un pseudo neuf n'ouvre rien tant que Cal ne l'a pas accepté.

### L'ordre des gestes (le site n'est jamais ouvert sans code)

Aujourd'hui : Worker `access` en ligne, application Access sur le nom
d'hôte, portail `access`.

1. **Le portail en mode code** (l'agent) :
   `ssh dgx2 'cd ~/SHOWRUNNER_TOOLS && tools/portail.sh status && bash tools/porte.sh code'`
   — il écrit `porte.mode = "code"` (+ `url`), crée les codes s'il n'y en a
   pas, relance, vérifie (sans signature : 401, page d'invitation comprise) et
   affiche le lien et le code admin. De là jusqu'au geste 2, Cal (seul à
   passer Access) reçoit 401 : le Worker `access` signe `admin`, que la porte
   `code` refuse.
2. **Le Worker en mode code** (l'agent, aussitôt) :
   `ssh dgx2 'cd ~/SHOWRUNNER_TOOLS && bash tools/porte.sh deploie'`
   (`PORTE_MODE = "code"` est déjà dans `wrangler.jsonc`). Access garde encore
   l'adresse : seul Cal passe, et tombe sur **notre** page d'invitation ; il
   peut essayer (code admin, `nico007`).
3. **Cal supprime l'application Access** : tableau de bord Zero Trust
   ([one.dash.cloudflare.com](https://one.dash.cloudflare.com/)) → **Access
   controls** → **Applications** → l'application du nom d'hôte
   `showrunner.luxigone.workers.dev` → **Delete** (dans le menu « ⋯ » de sa
   ligne, ou en bas de **Configure**) → confirmer. Le libellé exact du bouton
   n'est pas dans la documentation ; l'API a bien une suppression
   ([API](https://developers.cloudflare.com/api/resources/zero_trust/subresources/access/subresources/applications/methods/delete/)),
   mais le jeton de wrangler n'a pas la portée `access` : c'est Cal. Rien à
   redéployer. Le fournisseur One-time PIN et l'équipe `nirvalab` peuvent
   rester (gratuits, inutilisés).
4. **Vérifier** (l'agent) : `ssh dgx2 'cd ~/SHOWRUNNER_TOOLS && bash tools/porte.sh essai'`
   → `/api/porte/moi` 200 `{"porte":"code"}`, `/api/library` 401,
   `/invitation/` 200.

Les autres ordres : supprimer l'application d'abord laisse le Worker
`access` répondre 403 à tous (cassé, pas ouvert) jusqu'au déploiement ;
déployer le Worker avant le portail donne 401 à tous (la porte `access`
refuse le rôle `code`) jusqu'au geste 1. Aucun n'ouvre rien ; l'ordre 1 → 2
→ 3 ne casse que l'accès de Cal, une minute.

Revenir à Access : `remplis mode access`, `deploie`, `acces <e-mail>`, et
recréer l'application (« La vraie porte : les gestes », étape 5).

### Sans invitation, pour la phase d'essai (29/09, 19 h)

Cal : « vire-moi ces invitations […] je veux les rentrer côté dashboard
admin […] là c'est juste pour tester ». Réglage `porte.invitation = false`
(mode « code » seulement ; défaut `true`) : on ouvre l'adresse, on tape le
pseudo que Cal a ajouté (Admin → A · Demandes → « Ajouter quelqu'un », rôle
ami ou admin), on entre. **Un pseudo inconnu est refusé** (« demande à Cal de
t'ajouter »), sans demande en attente. **Un compte admin garde le code
admin** (sinon `nico007` tapé par n'importe qui serait admin : le trou du
28/09) ; un admin ajouté par Cal reçoit le lien du code admin (Admin :
« Montrer le lien admin », ou `tools/porte.sh lien`), puis tape son pseudo.
Une session ouverte sans invitation est liée au code d'invitation en cours
(`_door_mark`) : `nouveaux-codes` la ferme aussi. Le Worker n'a rien à
changer : les pages sont des assets, `/api/auth/…` passe déjà sans cookie,
`ESSAIS` bride les pseudos tapés par adresse. Qui voit quoi : `visibility`
vaut « all » par défaut (`DEFAULT_SETTINGS`) et n'est pas changé dans
`auth.json` en ligne (relevé du 29/09) : les amis voient la bibliothèque
comme Cal ; seul le propriétaire (ou un admin) modifie.

```sh
ssh dgx2 'cd ~/SHOWRUNNER_TOOLS && bash tools/porte.sh invitation off'  # on | off ; relancé, vérifié, puis le lien
```

### Les commandes

```sh
ssh dgx2 'cd ~/SHOWRUNNER_TOOLS && bash tools/porte.sh lien'            # le lien à envoyer, le code admin
ssh dgx2 'cd ~/SHOWRUNNER_TOOLS && bash tools/porte.sh ami su007'       # un pseudo créé d'avance, déjà accepté
ssh dgx2 'cd ~/SHOWRUNNER_TOOLS && bash tools/porte.sh nouveaux-codes'  # tout fermer, d'autres codes
```

### Les preuves (copie `/tmp/sr_porte3` sur DGX2, ports 8853 / 9853)

- `python3 tools/check.py` : **1280 passés, 0 en échec** (1229 sur
  origin/main : 51 contrôles neufs, `_selftest_code` de
  `server/tools/porte_publique.py`). Entre autres : sans signature → 401
  partout, page et lien d'invitation compris ; signature d'un autre chemin,
  d'une autre clé, vieille de 2 min → 401 ; signé `admin`/`ami`, même avec un
  vrai jeton Access de Cal → 401 ; signé `code` sans invitation → la page
  d'invitation, l'API en 401 ; `nico007` avec le code d'invitation → 403,
  aucune session ; `su007` créé d'avance par Admin → entre aussitôt, pas
  d'admin, ne crée personne ; `Margaux` → en attente, l'adresse signée notée,
  acceptée → entre ; code admin + `nico007` → admin, et le reste par sa seule
  session ; 10 mauvais codes → 429 ; nouveaux codes → sessions fermées ; une
  signature `code` sur la porte `access` → 401.
- **Le trou rouvert exprès** (la signature non exigée en mode code, sur une
  copie jetable) : 6 contrôles tombent.
- `node porte/essai.mjs` : **33/33** devant un portail `access`, **26/26**
  devant un portail `code` (`--codes`) : sans cookie → 401 du Worker, rien
  vers DGX2 ; vers le portail, rôle `code`, l'adresse, ni jeton ni cookie
  étranger ; le lien d'invitation pose son cookie à travers le Worker ;
  `nico007` → 403 ; `su007` entre ; un vrai jeton Access (en-tête ou cookie)
  ne compte pour rien et ne part jamais ; `ESSAIS` : un code, un pseudo → 429,
  compté par adresse ; la page d'invitation seule n'est pas un essai.
- `bash tools/porte.sh verifie` (`wrangler deploy --dry-run`) : passe ;
  liaisons `PORTAIL`, `BIBLIO`, `LIMITE`, `ESSAIS`, `PORTE_MODE = "code"`.
- `tools/porte.sh code`, `ami su007`, `ami nic0007` (refusé), `acces`, puis
  `code` à nouveau : essayés sur la copie (relance et démo factices).
- Captures (Chromium sans affichage, un faux bord local qui fait tourner
  `worker.js` devant la porte d'essai) : l'accueil sans code mène à la page
  d'invitation, dans le thème ; le lien mène au pseudo ; téléphone compris.

### Ce qui reste

- Rien n'a tourné chez Cloudflare en mode code : le premier essai réel est
  le geste 4 (et Cal, depuis la 4G : le lien, son pseudo).
- `Cf-Connecting-IP` lu par le Worker : documenté pour les requêtes qui
  arrivent au bord ([en-têtes](https://developers.cloudflare.com/fundamentals/reference/http-headers/)) ;
  s'il manquait, l'adresse vaudrait « inconnue » et les limites par adresse
  deviendraient une limite commune (rien ne s'ouvrirait pour autant).
- La collaboration en direct d'Idéation par le Worker : essayée par
  `essai.mjs` en mode `access` ; en mode code, même relais, cookies en plus.

---

## L'étude d'avant la porte par code

*(Tel qu'écrit le 29/09 avant le déploiement :)* rien n'est déployé, aucun
tunnel ne tourne, rien n'est ouvert sur internet. Le 29/09, le code de la porte est écrit et essayé sur une copie
(section suivante, « Prêt à déployer ») : le trou « nico007 derrière un
tunnel » est fermé, la démo par tunnel rapide et la vraie porte (Worker +
Access + Workers VPC + R2) n'attendent que les gestes de Cal. Documentation
Cloudflare lue le 28 et le 29/09/2026 ; chaque affirmation technique porte
son lien, « non documenté » quand la documentation se tait.

---

## Prêt à déployer (29/09/2026)

### Le trou fermé

Avant : `server/core/auth.py` faisait entrer un pseudo admin « depuis le
réseau de Cal », et ce réseau comprenait `127.0.0.0/8`. Derrière un tunnel
(cloudflared, Workers VPC), **toute requête arrive de 127.0.0.1** : n'importe
qui tapant `nico007` aurait été admin.

Maintenant, le portail a **deux écoutes** (`server/showrunner.py`) :

| écoute | adresse | pour qui | identité |
|---|---|---|---|
| **la maison** | `0.0.0.0:8790`, inchangée | Cal sur place, le LAN, Tailscale, le câble | comme avant ; et **toute requête qui porte un en-tête du bord de Cloudflare** (`Cf-Ray`, `Cf-Connecting-IP`, `Cf-Access-Jwt-Assertion`, `Cf-Worker`, `Cf-Visitor`, `CDN-Loop: cloudflare`) **est refusée** : un tunnel pointé par erreur sur 8790 n'ouvre rien |
| **la porte publique** | `127.0.0.1:9790` (maison + 1000) ; refuse d'écouter ailleurs que sur le loopback | les tunnels seulement | **jamais « le réseau de Cal »** ; `"auth": false` n'y vaut rien ; tout est gardé, relais (`/character/…`, la diarisation `/api/analyse/diar/…`) et fichiers de la bibliothèque compris |

C'est **l'App qui a reçu la requête** qui dit d'où elle vient : la porte est
une copie de l'App de la maison (mêmes routes, partagées), marquée `door`,
servie sur sa propre socket — ni une adresse, ni un en-tête (juste par
construction). Deux modes, réglage `porte` de `showrunner.local.json` :

- **`"demo"`** (défaut ; le tunnel rapide) : sans invitation, toute page
  montre la page d'invitation (401) et l'API répond 401. Le code
  d'invitation (lien `/invitation/<code>` ou formulaire `/invitation/`) pose
  un cookie `sr_invitation` (empreinte du code, `Secure`, `HttpOnly`,
  `SameSite=Lax`, 14 jours) ; ensuite le pseudo, comme à la maison : un
  pseudo neuf **attend que Cal l'accepte** (page Admin, qui le fait déjà) ;
  **un compte admin n'entre qu'avec le code admin**, distinct (16 signes).
  Une session ouverte par la porte est liée au code qui l'a ouverte :
  `tools/demo.sh nouveaux-codes` les ferme toutes. Une session de la maison
  n'y vaut rien. Les codes : `~/showrunner-data/porte-demo.json` (0600),
  relus à chaud.
- **`"access"`** (la vraie porte) : chaque requête doit porter **la
  signature HMAC du Worker** (`x-porte-*`, clé `~/.config/showrunner/porte.key`,
  0600, ±60 s, sur `qui\nrôle\nquand\nméthode\nchemin?requête` tel que reçu)
  **et le jeton Cloudflare Access** (`Cf-Access-Jwt-Assertion`, que le Worker
  transmet après l'avoir vérifié), **revérifié sur DGX2** : RS256 contre les
  clés de l'équipe (`https://nirvalab.cloudflareaccess.com/cdn-cgi/access/certs`,
  gardées une heure, relues pour un `kid` inconnu au plus une fois par
  minute), `iss`, `aud`, `exp`, `nbf`, et le même e-mail que la signature
  ([valider le JWT](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)).
  RS256 est écrit en bibliothèque standard (RFC 8017, `pow`), clés de 2048
  bits au moins. **Admin seulement si le Worker le signe (secret `ADMINS`)
  ET si l'e-mail mène à un compte admin** (`porte.emails` : l'e-mail de Cal →
  `cal`, ses objets restent à lui) ; un autre e-mail reçoit un compte « ami »
  actif (la liste d'Access est déjà celle de Cal). Taper un pseudo n'y sert
  à rien (409).
- `"off"` : pas de seconde écoute.

**Les preuves** (copie `/tmp/sr_porte` sur DGX2, ports 8813 et 9813) :

- `python3 tools/check.py` : **846 passés, 0 en échec**, dont **91 pour la
  porte** (`server/tools/porte_publique.py` ; 755 sans elle : les contrôles
  existants de la porte par pseudo, `compte.py`, passent tous). Entre
  autres : sur la porte, `nico007` avec le code d'invitation → 403, aucune
  session ; sans code → 401 partout (pages, API, `/character/`, fichiers,
  diarisation) ; la session admin de la maison sur la porte → 401 ; un
  jeton Access signé par une autre clé, d'une autre application, d'une autre
  équipe, périmé, pas encore valable, sans e-mail, `alg: none`, d'un autre
  e-mail que la signature → 401 ; la signature sans jeton, le jeton sans
  signature, une signature vieille de 2 min ou faite pour un autre chemin →
  401 ; une clé de porte lisible par d'autres → 503 ; la maison marche comme
  avant, et refuse `nico007` qui viendrait avec `Cf-Connecting-IP`.
- **Le trou rouvert exprès** (sur une copie jetable) : 4 contrôles tombent.
- **Un faux tunnel** (un relais local qui arrive de 127.0.0.1 sur 9813 en
  posant l'hôte `….trycloudflare.com`, `Cf-Connecting-IP`, `Cf-Ray`) : sans
  code tout est 401 ; `nico007`/`NiCo007` avec le code d'invitation → 403 ;
  « Margaux » → en attente, 401, puis acceptée à la maison → 200, admin 403 ;
  code admin + `nico007` → admin 200.
- **Le Worker de bout en bout** (`node porte/essai.mjs`) : `porte/worker.js`
  tourne dans Node devant la vraie porte « access » ; les jetons sont signés
  par WebCrypto, une autre implémentation de RS256 que celle du portail :
  **20 passés sur 20** (signature, chemins encodés, dépôt d'une image par
  `FixedLengthStream`, Range, `/character/` relayé, DGX2 injoignable → 503,
  autre clé de porte → 401).
- `wrangler deploy --dry-run` (wrangler 4.143.0 de DGX2, lecture seule) :
  la configuration passe ; 259 fichiers publiés, `server/`, `tools/`,
  `docs/`, `porte/`, `.git`, `showrunner.local.json` écartés
  (`.assetsignore`).

### La démo : tunnel rapide, prête à lancer

La commande, telle que la documentation la donne
([Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/),
« cloudflared tunnel --url http://localhost:8080 ») :

```sh
cloudflared tunnel --url http://127.0.0.1:9790
```

C'est `tools/demo.sh start` qui la lance (sur DGX2, `cloudflared` 2026.9.3
y est), après avoir vérifié que la porte répond en mode « demo » (jamais la
maison), qu'aucun `~/.cloudflared/config.yaml` n'existe, et créé les codes ;
il relève l'adresse `https://….trycloudflare.com` dans le journal et
l'affiche avec le lien d'invitation, le code d'invitation et le code admin.
`tools/demo.sh stop | status | nouveaux-codes`. PID dans
`~/showrunner-demo.pid`, journal `~/showrunner-demo.log`. Essayé avec un faux
`cloudflared` (`CLOUDFLARED=…`) : il reçoit bien `tunnel --url
http://127.0.0.1:<porte>`.

```sh
ssh dgx2 'cd ~/SHOWRUNNER_TOOLS && tools/demo.sh start'     # l'adresse, le lien, les codes
# à l'ami : https://<…>.trycloudflare.com/invitation/  et le code d'invitation (ou le lien direct avec le code)
# Cal, depuis n'importe où : le code admin, puis nico007 ; il accepte les demandes dans Admin
ssh dgx2 'cd ~/SHOWRUNNER_TOOLS && tools/demo.sh stop'
```

Ce que dit la documentation (même page) : « Quick Tunnels are intended for
testing and development only » ; « a hard limit on the number of concurrent
requests … Currently, this limit is 200 in-flight requests » ; « Quick
Tunnels do not support Server-Sent Events (SSE) » ; « We don't guarantee any
SLA or uptime of TryCloudflare » ; pas de tunnel rapide si un `config.yaml`
existe ; une adresse tirée au hasard à chaque lancement ; aucun compte
nécessaire.

**Ce qui marche encore, ce qui ne marche pas** (déduit du code ; aucun tunnel
n'a tourné) :

- Marche (requêtes ordinaires) : toutes les pages, la bibliothèque et ses
  fichiers (Range), les dépôts, la file et les rendus (la page relit la file
  toutes les 1,5 s pendant un rendu, 6 s au repos : un onglet ≈ 1 requête en
  vol), Character Factory sous `/character/` (le studio n'utilise pas de
  flux : aucun `stream` dans `character/js`), la lecture de Movie Analysis.
- **Ne marche pas : la collaboration en direct d'Idéation.** Elle passe
  entièrement par un flux SSE (`ideation/collab.js` : `EventSource` sur
  `…/collab/<planche>/stream` ; l'événement `hello` donne l'identifiant de
  connexion sans lequel ni présence ni message ne partent) : pas de
  curseurs, pas de présences, pas de fil en direct, pas de signalisation de
  la visio (qui, sans serveur STUN/TURN — `ideation_ice_servers` vide —, ne
  traverserait de toute façon pas deux réseaux). La planche elle-même
  s'enregistre par des requêtes ordinaires.
- Ne marche pas non plus : écrire des corrections dans le dépôt partagé de
  Movie Analysis depuis l'adresse de la démo — le Worker de MOVIE_ANALYSE
  refuse les origines inconnues, et il faut qu'il continue à refuser
  `*.trycloudflare.com` (n'importe qui peut en ouvrir une).
- Taille d'un dépôt par le tunnel rapide : non documentée.
- L'hôte reçu derrière le tunnel rapide est celui du tunnel (constaté par
  d'autres, pas documenté : `httpHostHeader` de cloudflared est vide par
  défaut, [paramètres d'origine](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/cloudflared-parameters/origin-parameters/)) ;
  si ce n'était pas le cas, l'adresse relevée par `demo.sh` vaut pour
  `Origin` (contrôlé).

### La vraie porte : les gestes, dans l'ordre

Déjà fait (29/09) : Zero Trust actif, équipe **`nirvalab`**
(`https://nirvalab.cloudflareaccess.com`), plan Free ; `wrangler` 4.143.0
connecté au compte de Cal sur DGX2 (`~/.local/bin/wrangler`, compte
`4428c8a9c5e493580d3f003c2adcf1ca`). Le jeton de wrangler n'a **pas** de
portée `access` : l'application Access se crée à la main.

1. **La clé de la porte** (l'agent, sur DGX2 ; elle ne sort jamais de
   DGX2 que vers le secret du Worker) :
   `ssh dgx2 'mkdir -p ~/.config/showrunner && (umask 077; openssl rand -hex 32 > ~/.config/showrunner/porte.key)'`
   (le portail la refuse si elle est lisible par d'autres ; lui et le Worker ignorent le retour à la ligne final)
2. **Le tunnel de DGX2** (Cal : tableau de bord et `sudo`) : tableau de bord
   Cloudflare → **Workers VPC** → onglet **Tunnels** → **Create** → nom
   `dgx2`, Linux, arm64 → copier la commande d'installation qu'il affiche
   (`sudo cloudflared service install <jeton>`) et la lancer **lui-même**
   dans un terminal sur DGX2 (le jeton est un secret : ni dans le chat, ni
   dans un dépôt ; « Anyone with the token can run the tunnel »,
   [jetons](https://developers.cloudflare.com/tunnel/reference/tunnel-tokens/)).
   Noter l'identifiant du tunnel. Vérifier : le tunnel apparaît « Healthy »,
   et `systemctl status cloudflared` sur DGX2 ; il faut l'UDP sortant 7844
   (QUIC) ([démarrer](https://developers.cloudflare.com/workers-vpc/get-started/)).
   (Autre voie, expérimentale : `wrangler tunnel create dgx2`.)
3. **Le service VPC** (l'agent) :
   `ssh dgx2 'cd ~/SHOWRUNNER_TOOLS/porte && ~/.local/bin/wrangler vpc service create portail-dgx2 --type http --tunnel-id <id du tunnel> --ipv4 127.0.0.1 --http-port 9790'`
   ([commandes](https://developers.cloudflare.com/workers-vpc/reference/wrangler-commands/)),
   puis coller l'identifiant rendu dans `porte/wrangler.jsonc`
   (`vpc_services`, `PORTAIL`).
4. **L'accès par code e-mail** (Cal) : Zero Trust → **Integrations** →
   **Identity providers** → **Add new identity provider** → **One-time PIN**
   ([One-time PIN](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/)).
5. **L'application Access** (Cal) : Zero Trust → **Access controls** →
   **Applications** → **Create new application** → **Self-hosted and
   private** ([application](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/)) :
   nom `Showrunner` ; nom d'hôte **`showrunner.luxigone.workers.dev`** (un
   nom `workers.dev` est admis :
   [Access pour Workers](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)) ;
   durée de session **24 hours** ; politique **Allow**, nom « Cal et ses
   amis », **Include → Emails** → son e-mail (ceux des amis plus tard) ;
   aucune règle *Bypass* ni *Service Auth* ; méthode de connexion
   **One-time PIN** ; réglages du cookie : **SameSite Lax**, **HttpOnly**,
   **Binding Cookie**. Enregistrer, puis **Configure → Additional settings →
   Application Audience (AUD) Tag** : le copier (ce n'est pas un secret) dans
   `porte/wrangler.jsonc` (`POLICY_AUD`) et dans le réglage du portail
   (étape 6). Ne pas utiliser l'onglet Access du Worker (« Protect this
   Worker ») : ses politiques ne sont que « Cloudflare account » ou « Email
   domain », et `gmail.com` ouvrirait à tout Gmail.
6. **Le portail en mode « access »** (l'agent) : dans
   `~/SHOWRUNNER_TOOLS/showrunner.local.json` de DGX2,
   `"porte": {"mode": "access", "team_domain": "https://nirvalab.cloudflareaccess.com", "aud": "<tag AUD>", "emails": {"<l'e-mail de Cal pour Access>": "cal"}}`,
   puis `tools/portail.sh restart`. **La démo s'arrête** : la porte est
   l'une ou l'autre.
7. **Le Worker** (l'agent, sur DGX2, dans `~/SHOWRUNNER_TOOLS/porte`) :
   ```sh
   ~/.local/bin/wrangler r2 bucket create showrunner-bibliotheque
   ~/.local/bin/wrangler deploy --dry-run
   ~/.local/bin/wrangler deploy
   ~/.local/bin/wrangler secret put PORTE_CLE < ~/.config/showrunner/porte.key
   ~/.local/bin/wrangler secret put ADMINS        # l'e-mail de Cal (virgules entre plusieurs), tapé à l'invite
   ```
   Déployer avant de poser les secrets ne laisse rien passer : sans jeton
   Access valide le Worker répond 403, sans `PORTE_CLE` il ne joint pas DGX2.
   `wrangler secret put` d'un fichier : la forme conseillée pour ne jamais
   écrire un secret dans une commande ; le Worker et le portail ignorent le
   retour à la ligne final (essayé).
8. **L'essai** (Cal, depuis la 4G) : `https://showrunner.luxigone.workers.dev`
   → la page d'Access → le code reçu par e-mail → le portail ;
   `…/api/porte/moi` rend son e-mail et `admin`. Une version URL
   (`<version>-showrunner…`) : coupée (`preview_urls: false`).
9. **R2** (Cal, puis l'agent) : **R2 object storage** → **Account Details →
   API Tokens → Manage** → créer un jeton **Object Read & Write** limité au
   bucket `showrunner-bibliotheque` ([jetons R2](https://developers.cloudflare.com/r2/api/tokens/) ;
   la clé secrète ne s'affiche qu'une fois). Cal écrit lui-même, dans un
   terminal sur DGX2, `~/.config/showrunner/r2.json` (chmod 600) :
   `{"account_id": "4428c8a9c5e493580d3f003c2adcf1ca", "access_key_id": "…", "secret_access_key": "…", "bucket": "showrunner-bibliotheque"}`.
   Puis `python3 porte/r2_recopie.py --a-blanc`, et sans `--a-blanc`.
10. **Les amis** : Cal ajoute leurs e-mails à la politique (étape 5).

`porte/r2_recopie.py` : API S3 de R2 (`https://<ACCOUNT_ID>.r2.cloudflarestorage.com`,
région `auto`, [S3](https://developers.cloudflare.com/r2/api/s3/api/)),
SigV4 en bibliothèque standard — elle retrouve l'exemple « GET Object » de la
documentation AWS (contrôlé dans `check.py`) et la signature de botocore pour
un envoi tel qu'il part vers R2 ; contre un faux S3 local : 4 envois, puis
rien à renvoyer, puis le retrait d'un objet parti de la bibliothèque. Chaque
`item.json` publié porte `owner_email`, `shared` et `tous` (« tout le monde
voit tout ») : le Worker ne sert un fichier de R2 qu'à un admin, au
propriétaire, ou si l'un des deux derniers est vrai.

### Movie Analysis : le changement à faire dans son Worker (non appliqué)

`C:\claude\MOVIE_ANALYSE\outils\partage\worker.js`, ligne 18 : le Worker
refuse les écritures (`PUT /corrections/…`, `POST /publier/…`) dont `Origin`
n'est pas `calculment0r.github.io` ou `localhost`. Pour que les pages du
portail y écrivent — à la maison et derrière la vraie porte, **jamais depuis
`*.trycloudflare.com`** :

```diff
-const ORIGINES = [/^https:\/\/calculment0r\.github\.io$/, /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/];
+const ORIGINES = [
+  /^https:\/\/calculment0r\.github\.io$/,
+  /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/,
+  // le portail Showrunner Tools : la maison (DGX2 sur le LAN, par Tailscale) et la porte Cloudflare
+  /^http:\/\/(192\.168\.10\.247|100\.108\.108\.65):8790$/,
+  /^https:\/\/showrunner\.luxigone\.workers\.dev$/,
+];
```

Puis `npx wrangler deploy` dans `outils/partage` (le compte de Cal). Le
préflight CORS est déjà servi (`OPTIONS` → 204, l'origine renvoyée telle
quelle). À savoir : ce contrôle d'`Origin` protège des pages piégées, pas
d'un script (curl pose l'`Origin` qu'il veut) ; ce Worker n'est pas derrière
Access.

### Ce qui reste

- **Rien n'a tourné chez Cloudflare** : Workers VPC vers `127.0.0.1`, le
  jeton `Cf-Access-Jwt-Assertion` reçu par un Worker à assets, les flux par
  Workers VPC, la limite de débit sur Workers Free, l'UDP 7844 depuis la box
  restent à vérifier au premier essai (liste plus bas).
- Le studio en direct (`wrangler.studio.jsonc`) attend une porte au studio
  (dépôt Character_Factory) ; d'ici là il passe par `/character/`, gardé.
- Les ponts (`PONT_DGX1`, `PONT_DGX2`) : pas écrits (§ 5).
- La recopie R2 se lance à la main (pas encore de minuteur).
- « Se déconnecter » dans le portail ne ferme pas la session Access
  (`/cdn-cgi/access/logout`) : `commun/porte.js` n'a pas été touché.
- Démo ou vraie porte : une seule à la fois (`porte.mode`).
- `tools/demo.sh` doit être exécutable dans git (`git update-index --chmod=+x tools/demo.sh`).

La demande de Cal (28/09) : travailler de n'importe où **sans Tailscale** ;
que ses amis aillent sur la page et fassent leur personnage **quand les DGX
sont allumés** ; un **pont** qui sait si les DGX sont disponibles et lance
les modèles depuis la page ; **pas de nom de domaine** ; des pages hébergées
chez Cloudflare, les fichiers dans **R2** ; une **porte d'entrée commune** à
tous ses outils ; des outils qui **chargent / déchargent les modèles** des
DGX, et certains qui ont **un agent** (le modèle avec qui on caractérise un
personnage).

---

## Ce que je propose, en sept lignes

1. **Les pages : un Worker à assets statiques, pas Pages.** Le portail sous
   `https://showrunner.luxigone.workers.dev`, servi tel quel depuis le dépôt
   (ses pages n'ont que des chemins relatifs). Le studio Character Factory à
   part, sous `https://character-factory.luxigone.workers.dev`, parce que ses
   pages demandent `/api/…` à la racine.
2. **La porte : Cloudflare Access**, une application sur chaque nom d'hôte
   `workers.dev`, connexion par **code envoyé par e-mail**, une **liste
   d'e-mails** (Cal et ses amis). Le Worker **revérifie le jeton** et **signe
   l'identité** qu'il transmet aux DGX.
3. **Les DGX : Workers VPC**, un **tunnel sortant par DGX sans nom d'hôte
   public**, qui ne vise que `127.0.0.1` ; les serveurs des DGX y ouvrent une
   « porte » (port de la maison + 1000) qui **refuse toute requête non
   signée**. Pas de tunnel rapide `trycloudflare`. Workers VPC est **en bêta** :
   c'est le seul chemin documenté sans domaine.
4. **R2 : la bibliothèque publiée.** DGX2 y recopie chaque objet par l'API S3,
   avec un jeton limité à ce bucket ; les pages lisent par le Worker (Range,
   droit de lecture pris dans l'`item.json` de l'objet). DGX éteintes, la
   bibliothèque reste visible.
5. **Le pont : un par DGX, seul arbitre de sa machine** (ce qui tourne, la
   mémoire, démarrer, charger, décharger). Le Worker ne fait que porter la
   demande et l'identité ; il ne décide jamais de la mémoire.
6. **L'agent : pas tout de suite.** L'étage Identité marche déjà par le relais
   `/v1` du studio, que la porte relaie. Un agent Cloudflare (un Durable
   Object par personnage) viendra si Cal veut une conversation qui vit côté
   serveur ; le modèle reste Ollama sur DGX1, joint par le même tunnel.
7. **Coût : 0 € pour commencer** (Workers Free, Access Free, R2 jusqu'à
   10 Go, Workers VPC gratuit en bêta, Tunnel gratuit) ; Zero Trust demande
   **un moyen de paiement même en gratuit**. 5 $/mois (Workers Paid) si les
   pages dépassent 100 000 requêtes par jour. Le prix de Workers VPC après la
   bêta n'est pas publié.

## Ce que Cal doit décider

1. **Rester sans domaine** (Workers VPC, en bêta) **ou en prendre un**
   (Cloudflare Registrar vend au prix du registre, sans marge —
   [Registrar](https://developers.cloudflare.com/registrar/)). Avec un domaine,
   un tunnel à nom d'hôte public, hors bêta, devient possible. Je recommande
   de **commencer sans** : le Worker, Access, R2, le pont et la signature sont
   les mêmes dans les deux cas ; un domaine s'ajoute plus tard au Worker sans
   rien défaire.
2. **Qui voit quoi.** Chacun voit ses objets et ses personnages, plus ce qui
   est partagé ; Cal voit tout (c'est ce que demande l'audit, C2 — je le
   recommande : les amis déposeront des photos de visages réels). Ou bien
   tout le monde voit tout, et seul le propriétaire modifie (c'est ce que fait
   la branche `claude/cf-bridge`).
3. **Ce qu'un ami peut faire aux machines.** Recommandé : « préparer »
   (démarrer ce qui manque pour travailler) ; « libérer » (décharger un
   modèle, arrêter H3) reste à Cal.
4. **La connexion des amis** : code par e-mail seulement (rien à régler
   ailleurs), ou aussi « se connecter avec Google » (un client OAuth à créer
   chez Google).
5. **L'accès « maison »** sans connexion (LAN, Tailscale) : le garder pour Cal,
   mais lié aux adresses du réseau de la maison et du câble direct, plus
   jamais à `0.0.0.0` ni à `127.0.0.1` (§ 3.3).
6. **Deux adresses** (portail + studio), ou réécrire les pages du studio en
   chemins relatifs pour n'en garder qu'une.
7. **L'agent** : plus tard (recommandé), et dans quel format de messages
   (§ 6.4).

---

## Le schéma

```
  Cal ou un ami, n'importe où (navigateur)
        │  https://showrunner.luxigone.workers.dev          https://character-factory.luxigone.workers.dev
        ▼                                                             ▼
┌──────────────────────────────────── Cloudflare ─────────────────────────────────────────────┐
│  Access (Zero Trust Free) : une application par nom d'hôte, politique « Allow » = la liste   │
│  d'e-mails ; connexion par code e-mail ; cookie SameSite=Lax, HttpOnly, binding cookie       │
│        │ Cf-Access-Jwt-Assertion (JWT RS256)                          │                      │
│        ▼                                                             ▼                      │
│  Worker « showrunner »                                   Worker « character-factory »        │
│   ├ pages du portail (assets, gratuits)                    (même worker.js, MODE=studio)     │
│   ├ revérifie le JWT → { email, rôle }                      revérifie le JWT, signe,         │
│   ├ /api/*       → PORTAIL   ─┐ identité signée              tout chemin → STUDIO ─┐         │
│   ├ /pont/dgx2/* → PONT_DGX2 ─┤ HMAC (x-porte-*)                                   │         │
│   ├ /pont/dgx1/* → PONT_DGX1 ─┼───────────────────────────────────────────────┐    │         │
│   ├ /library/*   → R2 d'abord (Range, droit lu dans item.json), sinon PORTAIL │    │         │
│   └ /agents/*    → plus tard : Durable Object par personnage (§ 6)            │    │         │
│                                                                               │    │         │
│  R2 « showrunner-bibliotheque » (privé : ni r2.dev, ni URL signée)            │    │         │
│        ▲ S3 PutObject, jeton « Object Read & Write » limité à ce bucket       │    │         │
└────────┼──────────────────────────────┬───────────────────────────────────────┼────┼─────────┘
         │                              │ Workers VPC : tunnels sortants        │    │
         │                              │ (QUIC, UDP 7844), aucun nom d'hôte    │    │
         │                              ▼ public, aucun port ouvert chez Cal    ▼    ▼
  ┌──────┴──────────── DGX2 ─────────────────────┐        ┌──────────────── DGX1 ──────────────────┐
  │ cloudflared (service, jeton)                 │        │ cloudflared (service, jeton)           │
  │   PORTAIL   → 127.0.0.1:9790 (portail)       │        │   PONT_DGX1 → 127.0.0.1:9770 (pont)    │
  │   PONT_DGX2 → 127.0.0.1:9770 (pont)          │        │   STUDIO    → 127.0.0.1:9765 (studio)  │
  │ portail :8790 (maison : LAN seulement)       │ câble  │ studio :8765 (maison : câble seulement)│
  │ pont    :8770 (maison)                       │◀──────▶│ pont   :8770 (maison)                  │
  │ ComfyUI :8188 · H3 :8189 · Ollama            │ direct │ ComfyUI :8188 · H3 :8189 · Ollama      │
  │   (jamais derrière le tunnel)                │        │   qwen3-vl-32b-32k (étage Identité)    │
  └──────────────────────────────────────────────┘        └────────────────────────────────────────┘
   « porte » = n'accepte que x-porte-* signé par le Worker ; « maison » = Cal sur place, sans connexion
```

---

## 1. Héberger les pages sans domaine : Workers, pas Pages

| | Workers + assets statiques | Pages |
|---|---|---|
| Adresse sans domaine | `<worker>.luxigone.workers.dev` | `<projet>.pages.dev` |
| Fichiers | 20 000 par version (Free), 100 000 (Paid) | 20 000 (Free), 100 000 (payant) |
| Taille d'un fichier | 25 Mio | 25 Mio |
| Requêtes d'assets | gratuites, illimitées | gratuites |
| Durable Objects, limite de débit, Workers Logs | oui | non |
| Access posé sur le Worker lui-même (previews comprises), `ctx.access` | oui | non documenté |

Sources : [limites Workers](https://developers.cloudflare.com/workers/platform/limits/),
[facturation des assets](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)
(« Requests to static assets are free and unlimited »),
[limites Pages](https://developers.cloudflare.com/pages/platform/limits/),
[comparaison Pages → Workers](https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/).

**Workers**, parce qu'un seul Worker porte à la fois les pages, la
vérification de l'identité, les liaisons vers les DGX (VPC), R2 et, plus
tard, l'agent (Durable Objects, absent de Pages). La documentation ne dit pas
en toutes lettres « préférez Workers » ; elle donne à Workers « a distinctly
broader set of features » (même page de migration).

Réglages ([assets](https://developers.cloudflare.com/workers/static-assets/binding/)) :
`assets.directory` = le dépôt ; `run_worker_first` =
`["/api/*", "/library/*", "/pont/*", "/agents/*"]` (ces chemins passent par
le Worker, le reste est servi directement) ; un fichier `.assetsignore` à la
racine (syntaxe `.gitignore`) écarte `server/`, `tools/`, `docs/`, `porte/`,
`.git`. Les pages n'ont que des chemins relatifs (`docs/ARCHITECTURE.md`
§ 7) : servies et relayées par la même origine, `window.SR_API` reste
inutile.

**Le studio Character Factory ne peut pas partager cette adresse** :
`js/studio.js` demande `/api/characters`, `/files/…`, `/api/jobs` à la racine,
et le portail a déjà son `/api/`. D'où un second Worker, sans assets, qui
relaie tout au studio de DGX1 (`porte/wrangler.studio.jsonc`). Autre voie,
à décider : réécrire le studio en chemins relatifs.

`workers.dev` est « treated as a Free website and is intended for personal
or hobby projects » ([workers.dev](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)) :
c'est le cas ici.

---

## 2. La porte : Cloudflare Access sur `workers.dev`

### 2.1 C'est possible sans domaine — trois façons, une retenue

Depuis le 14/08/2026, Access protège un Worker directement
([changelog](https://developers.cloudflare.com/changelog/post/2026-08-14-workers-access/),
[Access pour Workers](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)) :

| Façon | Couvre | Limite |
|---|---|---|
| « Protect one Worker » (onglet Access du Worker) | toutes ses adresses, previews comprises | **pas de WebSocket** : « WebSocket upgrade requests … will fail with a `403` error » |
| « Protect all Workers » | tout le compte, y compris les Workers futurs | idem, et toucherait `movie-analysis-partage` |
| **Application self-hosted sur un nom d'hôte** (« can be `workers.dev` ») | ce nom d'hôte | les version URLs ne sont pas couvertes → les couper |

**Retenue : l'application self-hosted sur chaque nom d'hôte** — elle laisse
passer les WebSocket (l'agent en aura besoin, § 6), et ses réglages de cookie
et de politique sont ceux de Zero Trust, que l'audit détaille. Les version
URLs (`<version>-showrunner.luxigone.workers.dev`) sont publiques par défaut
([previews](https://developers.cloudflare.com/workers/configuration/previews/)) :
`"preview_urls": false` les coupe. Et le Worker refuse de toute façon une
requête sans jeton valide pour l'AUD de l'application : même un réglage
oublié ne laisse rien passer vers les DGX.

Les politiques proposées par l'onglet Access d'un Worker ne sont que
« Cloudflare account » ou « Email domain » : « Email domain » = `gmail.com`
ouvrirait la porte à tout Gmail. Il faut la politique **Emails** (la liste),
réglée dans Zero Trust → Access → Applications.

### 2.2 Se connecter, pour un ami

- Une organisation Zero Trust neuve a pour seule méthode le **fournisseur
  d'identité Cloudflare**, réglé sur « Restrict to account members »
  ([changelog du 18/06/2026](https://developers.cloudflare.com/changelog/post/2026-06-18-cloudflare-idp-default/),
  [Cloudflare IdP](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/cloudflare/)) :
  un ami qui n'est pas membre du compte ne peut pas entrer.
- **Code par e-mail (One-time PIN)** : à ajouter soi-même (« OTP is no
  longer added automatically ») ; code à usage unique, valable 10 minutes,
  envoyé seulement si l'e-mail est autorisé par une politique
  ([One-time PIN](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/)).
  Rien à créer chez l'ami. **Recommandé.**
- **Google** (comptes Gmail) : un client OAuth à créer dans Google Cloud,
  redirection vers `https://<équipe>.cloudflareaccess.com/cdn-cgi/access/callback`
  ([Google](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/google/)).
  En option.

### 2.3 Gratuit jusqu'à combien

- La page produit : Free « Best for teams under 50 users »
  ([Access](https://www.cloudflare.com/sase/products/access/)). Je n'ai pas
  trouvé ce chiffre dans la documentation développeur.
- Un siège est pris à la première connexion, un seul par personne quel que
  soit le nombre d'applications ; on le libère en retirant l'utilisateur
  ([sièges](https://developers.cloudflare.com/cloudflare-one/team-and-resources/users/seat-management/)).
- Mise en place de Zero Trust : un nom d'équipe, un plan, **et un moyen de
  paiement même pour le plan gratuit** (« you will not be charged »)
  ([setup](https://developers.cloudflare.com/cloudflare-one/setup/)).
- Limites du compte : 500 applications, 50 fournisseurs d'identité
  ([limites](https://developers.cloudflare.com/cloudflare-one/account-limits/)).

### 2.4 Le Worker revérifie le jeton lui-même

`ctx.access.getIdentity()` donne l'e-mail sans rien parser, **mais pas à un
Worker qui a des assets statiques** : « the router does not pass
`ctx.access` to the user Worker »
([Access pour Workers, « ctx.access limitations »](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)).
Le portail en a. Donc, comme la documentation l'indique
([valider le JWT](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)) :

- jeton dans l'en-tête `Cf-Access-Jwt-Assertion` (préféré au cookie
  `CF_Authorization`, qui « n'est pas garanti ») ;
- clés publiques à `https://<équipe>.cloudflareaccess.com/cdn-cgi/access/certs`,
  choisies par `kid` ; Cloudflare les change toutes les 6 semaines ;
- contrôles : signature RS256, `iss` = le domaine de l'équipe, `aud` = le
  tag AUD de l'application, `exp`.

`porte/worker.js` le fait avec WebCrypto, **sans dépendance** (comme
`movie-analysis-partage`). Le rôle vient de là : `admin` si l'e-mail est dans
le secret `ADMINS`, `ami` sinon. Les champs du jeton :
[application token](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/).

### 2.5 Réglages de l'application (ceux de l'audit)

- Une seule politique **Allow**, sélecteur **Emails** ; aucune règle
  *Bypass* ni *Service Auth*.
- Sessions de 24 h.
- Cookie : `SameSite` **Lax** (défaut : None), `HttpOnly` (déjà par défaut),
  **binding cookie** (retiré au bord de Cloudflare, jamais transmis)
  ([cookie](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/)).

### 2.6 Sans Access ?

- **Lien magique par e-mail** : Cloudflare Email Service exige un domaine
  sur le DNS Cloudflare
  ([Email Service](https://developers.cloudflare.com/email-service/configuration/domains/)) :
  impossible ici.
- **Passkeys** : rien de fourni par Cloudflare ; tout serait à écrire et à
  maintenir (inscription, perte d'appareil, sessions). Non recommandé.

Access reste le plus solide et ne coûte rien à cette échelle.

---

## 3. Joindre les DGX depuis le Worker, sans nom d'hôte public

### 3.1 Les trois chemins

| Chemin | Sans domaine ? | Verdict |
|---|---|---|
| **Workers VPC** : tunnel + « VPC Service » lié au Worker | **oui** : « ingress configurations … are not required for Workers VPC » | **retenu** ; en bêta |
| Tunnel à nom d'hôte public (« published application ») | **non** : prérequis « A domain on Cloudflare (required to publish applications) » ([tunnel](https://developers.cloudflare.com/tunnel/get-started/)) | si Cal prend un domaine |
| Tunnel rapide `trycloudflare.com` | oui | **écarté** |

Le tunnel rapide est écarté par sa documentation même : « intended for
testing and development only », 200 requêtes simultanées au plus, pas de SSE,
« We don't guarantee any SLA or uptime », adresse tirée au hasard à chaque
démarrage
([Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/)).
Et quiconque a l'adresse arrive jusqu'au service, sans porte (audit C1, M5).

### 3.2 Workers VPC, ce que dit la documentation

- **En bêta**, « Features and APIs may change before general availability » ;
  **gratuit pendant la bêta**, sur les plans Free et Paid ; date de fin et
  prix ensuite non publiés
  ([vue d'ensemble](https://developers.cloudflare.com/workers-vpc/),
  [prix](https://developers.cloudflare.com/workers-vpc/platform/pricing/)).
- On crée le tunnel dans le tableau de bord **Workers VPC → Tunnels →
  Create**, puis on installe `cloudflared` avec la commande à jeton qu'il
  donne ; on crée ensuite un **VPC Service** (tunnel, adresse, port) et on
  le lie au Worker (`vpc_services`)
  ([démarrer](https://developers.cloudflare.com/workers-vpc/get-started/),
  [tunnel](https://developers.cloudflare.com/workers-vpc/configuration/tunnel/)).
- Le service décide seul où va la requête : « The host provided in the
  `fetch()` operation is not used to route requests » ; l'URL ne remplit que
  l'en-tête `Host`
  ([VPC Services](https://developers.cloudflare.com/workers-vpc/configuration/vpc-services/)).
- **VPC Services plutôt que VPC Networks** : une liaison « Network » laisse le
  Worker joindre « any hostname or IP address reachable through the bound
  Cloudflare Tunnel »
  ([VPC Networks](https://developers.cloudflare.com/workers-vpc/configuration/vpc-networks/)) —
  sur les DGX, ce serait ComfyUI, Ollama et l'ancienne API, ouverts sur le
  réseau local. Un service par couple adresse/port, rien d'autre.
- **QUIC obligatoire** : sinon `dns_error` ; il faut l'UDP sortant sur le
  port 7844
  ([dépannage](https://developers.cloudflare.com/workers-vpc/reference/troubleshooting/),
  [tunnel](https://developers.cloudflare.com/workers-vpc/configuration/tunnel/)).
- Erreurs rendues au Worker : `connection_refused`, `destination_unavailable`,
  `connection_timeout`, `connection_read_timeout`, `http_upgrade_failed`
  (même page de dépannage).
- Limites : celles des Workers, 1 000 VPC Services par compte
  ([limites](https://developers.cloudflare.com/workers-vpc/platform/limits/)).
- Cloudflare Tunnel : « Available on all plans », connexions sortantes
  seulement ([Tunnel](https://developers.cloudflare.com/tunnel/)). Le jeton
  d'un tunnel est un secret : « Anyone with the token can run the tunnel »
  ([jetons](https://developers.cloudflare.com/tunnel/reference/tunnel-tokens/)).

**Viser `127.0.0.1`** : la documentation Workers VPC ne le dit pas. Un guide
d'un dépôt Cloudflare le dit : `cloudflared` « resolves the Host on the
tunnel machine », et son tutoriel met `localhost` quand le service tourne sur
la même machine que `cloudflared`
([cloudflare/claude-managed-agents](https://github.com/cloudflare/claude-managed-agents/blob/main/docs/connecting-to-private-services.md)).
À vérifier au premier essai. On donne une **adresse IP** (`--ipv4 127.0.0.1`),
pas un nom : pas de résolution à faire.

### 3.3 Ce que ça demande aux serveurs des DGX

**Un tunnel par DGX**, chacun vers les `127.0.0.1` de sa machine : une
machine éteinte = son tunnel absent = le Worker le sait, sans saut par l'autre.

**Deux écoutes par serveur**, au lieu d'une sur `0.0.0.0` :

| | écoute | qui | identité |
|---|---|---|---|
| **porte** | `127.0.0.1:<port + 1000>` : portail 9790, studio 9765, pont 9770 | le tunnel seulement | **signature obligatoire**, sinon 401 |
| **maison** | l'adresse du LAN (portail DGX2 `192.168.10.247:8790`) ou du câble (studio DGX1 `169.254.110.6:8765`) | Cal sur place, le relais, l'autre DGX | « cal », comme aujourd'hui |

C'est **la socket qui a reçu la requête qui dit d'où elle vient**, pas
l'adresse de l'appelant ni un en-tête : juste par construction. Relevé du
28/09 : aucun port 97xx n'est pris sur les deux DGX.

**Attention à la branche `claude/cf-bridge`** : son pont croit
`127.0.0.1/32` « de la maison » et lit l'e-mail dans
`Cf-Access-Authenticated-User-Email` (`tools/bridge.py`, `TRUSTED`,
`requester`). Avec un `cloudflared` sur la machine, **tout ce qui vient du
tunnel arrive de `127.0.0.1`** : une requête sans cet en-tête ni marque
`Cf-*` y serait prise pour Cal, et tout processus local peut poser l'en-tête.
À reprendre avant de la fusionner : plus de confiance dans `127.0.0.1`, plus
d'e-mail en clair — la signature ci-dessous.

**La signature** : le Worker ajoute `x-porte-qui` (e-mail), `x-porte-role`
(`admin` / `ami`), `x-porte-quand` (secondes Unix) et
`x-porte-sig` = HMAC-SHA256(clé, `qui\nrole\nquand\nméthode\nchemin?requête`).
La clé est un secret du Worker (`PORTE_CLE`) et un fichier hors dépôt sur
chaque DGX (`~/.config/showrunner/porte.key`, `chmod 600`). HMAC plutôt que
revérifier le JWT sur les DGX : le portail est en bibliothèque standard, qui
n'a pas RS256 ; HMAC, si. *(29/09 : le portail fait les deux — la
signature, et le jeton revérifié en RS256 écrit en bibliothèque standard ;
voir « Prêt à déployer ». Le code ci-dessous est l'esquisse d'origine.)*
Côté DGX :

```python
import hashlib, hmac, time
from pathlib import Path

CLE = (Path.home() / ".config/showrunner/porte.key").read_bytes().strip()

def identite(headers, method: str, path_qs: str):
    """(e-mail, rôle) si la requête vient de la porte, None sinon. path_qs = self.path, tel que reçu."""
    qui, role, quand, sig = (headers.get(h, "") for h in ("X-Porte-Qui", "X-Porte-Role", "X-Porte-Quand", "X-Porte-Sig"))
    if not (qui and role in ("admin", "ami") and quand.isdigit() and sig):
        return None
    if abs(time.time() - int(quand)) > 60:
        return None
    attendu = hmac.new(CLE, "\n".join((qui, role, quand, method, path_qs)).encode(), hashlib.sha256).hexdigest()
    return (qui.lower(), role) if hmac.compare_digest(attendu, sig) else None
```

Sur l'écoute « maison », une identité signée, si elle est là et valide,
l'emporte sur « cal » : c'est ainsi que le portail de DGX2 agit au nom d'un
ami auprès du studio de DGX1, par le câble (import d'un personnage), avec la
même clé. Sur l'écoute « porte », elle est obligatoire.

Le Worker ne transmet qu'une **liste fermée d'en-têtes** (`accept`,
`content-type`, `range`, `x-filename`…) : ni cookie, ni
`Cf-*`, ni `x-porte-*` forgé par la page. **Le rôle se décide dans le Worker,
les droits sur les objets sur les DGX** (propriétaire, partage, quotas) : une
seule vérité pour chaque question.

**Le corps des requêtes** : un flux quelconque part en « chunked » ; seul un
`FixedLengthStream` garde `Content-Length`
([Request](https://developers.cloudflare.com/workers/runtime-apis/request/),
[streams](https://developers.cloudflare.com/workers/runtime-apis/streams/transformstream/)).
Les serveurs `http.server` des DGX lisent `Content-Length` et ne décodent
pas le chunked : le Worker repasse donc chaque corps dans un
`FixedLengthStream`, et refuse (411) un corps sans longueur.

**Ce qui ne passe jamais par le tunnel** : ComfyUI (:8188, :8189), Ollama
(:11434), l'ancienne API de DGX2 (:8000, `character-factory.service`). Ils
restent ouverts sur le réseau local (audit M5) : à lier au loopback et au
câble, indépendamment de la porte.

### 3.4 Les tunnels sur les DGX

`cloudflared` 2026.9.3 est installé sur les deux DGX (aarch64), aucun tunnel
n'existe (pas de `~/.cloudflared`, aucun service). Un tunnel géré à distance
ne demande que son jeton ; installé en service systemd `cloudflared.service`
([service Linux](https://developers.cloudflare.com/tunnel/advanced/local-management/as-a-service/linux/)).
La commande exacte avec le jeton est donnée par le tableau de bord : **c'est
Cal qui la lance** (sudo, jeton secret).

Tailscale continue à côté ; aucun Funnel ne vise les ports de la porte
(relevé du 28/09 : DGX1 → 8445, 8189, 8448 ; DGX2 → 8444, 8446). On n'y
touche pas.

---

## 4. R2 pour la bibliothèque

### 4.1 Ce qui y va

La **copie publiée** de la bibliothèque « Asset », objet par objet, sous la
même clé que l'adresse de la page : `library/<id>/<fichier>` — le fichier
principal (PNG/JPEG/WEBP, MP4/WEBM, WAV/MP3…, GLB), la vignette, les
références d'un élément, et l'`item.json`, qui porte deux champs de plus :
`owner` (l'e-mail) et `shared`. Plus `library/index.json`, la liste publiée
(les objets tels que `library.public()` les rend), pour les DGX éteintes.

Les personnages Character Factory y entrent **comme éléments**, par l'import
existant (`/api/cf/import`) : visage verrouillé, looks, plein pied, rig,
expressions. Pas les fichiers de travail de ComfyUI ni `projects/` entier
(2,2 Go sur DGX1).

Le DGX garde la **copie de travail** (les rendus en ont besoin sur place) ;
R2 est la copie durable et visible de partout. **Un seul sens pour
commencer : DGX → R2.**

### 4.2 Comment les DGX y écrivent

- Par l'**API S3** : région `auto`, `PutObject`, `HeadObject`,
  `ListObjectsV2`, envoi en plusieurs parties
  ([S3 API](https://developers.cloudflare.com/r2/api/s3/api/)) ;
  point d'accès `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`.
- Avec un **jeton « Object Read & Write » limité au bucket**
  ([jetons R2](https://developers.cloudflare.com/r2/api/tokens/)) ; la clé
  secrète ne s'affiche qu'une fois. Rangée hors dépôt
  (`~/.config/showrunner/r2.json`, `chmod 600`) sur DGX2 seulement. Fuite =
  ce bucket seul.
- La signature SigV4 s'écrit en bibliothèque standard (`hmac`, `hashlib`) :
  pas de paquet à ajouter au portail.
- Limites : 5 Gio par envoi simple (au-delà, en plusieurs parties) ; une
  écriture par seconde sur une même clé
  ([limites R2](https://developers.cloudflare.com/r2/platform/limits/)).

### 4.3 Comment les pages lisent

**Par le Worker**, comme `movie-analysis-partage` (qui sert déjà ses vidéos
R2 avec les requêtes Range) : `GET /library/<id>/<fichier>` → le Worker lit
`library/<id>/item.json` dans R2, sert le fichier si l'appelant est le
propriétaire, si l'objet est partagé, ou s'il est admin ; sinon 404 (on ne dit
pas qu'il existe). Absent de R2 : le Worker le demande à DGX2, qui juge avec
l'identité signée.

Pourquoi pas les autres voies :

- **URL signées** : « Presigned URLs work with the S3 API domain and cannot
  be used with custom domains », ce sont des jetons au porteur (« Anyone with
  the URL can perform the specified operation until it expires »), il faut
  régler le CORS du bucket, et les Range n'y sont pas documentées
  ([URL signées](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)).
  Le Worker garde Access devant chaque octet.
- **`r2.dev`** : « not intended for production usage », limité en débit, et
  Access ne peut pas le garder
  ([buckets publics](https://developers.cloudflare.com/r2/buckets/public-buckets/)).

Les dépôts des amis (photos) passent par la page → Worker → DGX2
(`PUT /api/library/upload`) : 100 Mo au plus par requête sur un compte
gratuit ([limites Workers](https://developers.cloudflare.com/workers/platform/limits/)) ;
l'audit demande PNG/JPEG/WEBP seulement et 15 Mo.

### 4.4 Coût

10 Go-mois, 1 million d'opérations A et 10 millions d'opérations B gratuits
par mois ; puis 0,015 $/Go-mois ; sortie gratuite
([prix R2](https://developers.cloudflare.com/r2/pricing/)). 100 Go publiés :
environ 1,35 $/mois.

---

## 5. Allumer, éteindre les modèles à distance : le pont

### 5.1 Ce qui reste sur les DGX

**L'arbitrage de la mémoire.** Un DGX Spark gèle quand sa mémoire unifiée
sature (incident du 24/09 : `Character_Factory/factory/memory.py`). Les
règles existent déjà dans le studio : décharger Ollama avant un rendu
(`keep_alive: 0`), vider ComfyUI (`/free`) entre familles de modèles, ne
jamais décharger sous le travail d'un autre, refuser sous un seuil. Les API
sont documentées :
[Ollama — charger / décharger, `/api/ps`](https://github.com/ollama/ollama/blob/main/docs/api.md),
[ComfyUI — `/free`](https://github.com/Comfy-Org/ComfyUI/pull/16622).

Aujourd'hui **deux ordonnanceurs** se partagent les deux machines sans se
parler : le studio (DGX1, et le ComfyUI de DGX2 par `comfyui_peers`) et le
portail (DGX2, et le ComfyUI de DGX1 par ses voies). Avec des amis en plus,
il faut **un seul arbitre par machine** : le pont. Hors du périmètre de la
porte, mais la porte le rend urgent.

### 5.2 Le pont

Un petit service systemd **sur chaque DGX**, toujours allumé, qui ne parle
que de sa machine (le code de `claude/cf-bridge`, repris : plus de ssh vers
l'autre DGX, la signature au lieu de l'e-mail en clair) :

| | qui | ce que ça fait |
|---|---|---|
| `GET /pont/etat` | tous | services (studio, portail, ComfyUI, H3, Ollama), mémoire, modèles chargés, file ; `ready` |
| `POST /pont/preparer {pour}` | ami, admin | démarre ce qui manque pour un outil (`character-factory`, `image`, `h3`) ; ne redémarre jamais ce qui tourne |
| `POST /pont/liberer {quoi}` | admin | décharge un modèle, arrête H3 ; refusé si un travail tourne |

Le pont décide selon le rôle signé ; le Worker ne fait que relayer
(`/pont/dgx1/…`, `/pont/dgx2/…`) et limiter le débit.

### 5.3 Ce qui se fait dans le Worker

- `GET /api/porte/etat` : sonde les deux ponts (3 s au plus) ; un ami voit
  « joignable / prête », Cal voit le détail (l'audit B2 : pas d'adresses
  internes pour les autres).
- Porter « préparer » et « libérer » avec l'identité signée.

### 5.4 DGX éteintes : ce que voit un ami

- Le pont ne répond pas → le Worker dit « les machines dorment ».
- **La bibliothèque reste visible** : `GET /api/library` échoue → le Worker
  rend `library/index.json` de R2, filtré pour lui (`hors_ligne: true`), et
  les fichiers viennent de R2. Ses personnages importés en éléments aussi.
- Le studio : une page « Les machines dorment », avec le lien du portail.
- **Allumer une machine éteinte à distance n'est pas traité** (il faudrait
  un appareil toujours allumé sur le réseau de la maison) : conforme à la
  demande (« quand les DGX sont allumés »).

---

## 6. Les agents

### 6.1 Qui en a besoin

**L'étage Identité de Character Factory** : la conversation avec
`qwen3-vl-32b-32k` (Ollama, présent sur les deux DGX, relevé du 28/09) qui
bâtit la fiche d'un personnage. Aujourd'hui, la boucle tourne dans la page
(`js/llm.js`), le modèle derrière le relais `/v1` du studio, qui applique les
règles de mémoire (`before_chat`) ; la conversation est rangée dans
`project.json`. Les autres outils n'en ont pas besoin pour l'instant.

### 6.2 Où tourne le modèle

**Sur les DGX, toujours** (règle de Cal : pas d'API de modèle payante). Ni
Workers AI, ni modèle hébergé.

### 6.3 Première étape : pas d'agent

La porte **relaie `/v1/chat/completions`** du studio (Worker
`character-factory`) : la page actuelle marche derrière la porte sans
changement. Le relais `/v1` doit d'abord recevoir les corrections de l'audit
(M1 : `max_tokens` plafonné, corps ≤ 2 Mo, 503 pendant un calcul, ComfyUI
vidé pour un admin seulement).

### 6.4 Plus tard : un agent Cloudflare

Ce qu'il apporterait : une conversation qui **continue quand la page se
ferme**, plusieurs spectateurs d'un même personnage, des outils (mettre à
jour la fiche, proposer des images) appelés côté serveur, des relances
programmées (attendre que DGX1 se réveille).

- Un **Durable Object par personnage** (`/agents/identite/<slug>`), état en
  SQLite. Disponible sur Workers Free (SQLite seulement) : 100 000 requêtes
  et 13 000 Go-s par jour ; sur Paid, 1 million de requêtes et 400 000 Go-s
  par mois compris ([prix DO](https://developers.cloudflare.com/durable-objects/platform/pricing/)).
- Le DO a l'`env` du Worker (« the Durable Object also has the Worker `Env`
  in `this.env` », [Agent class](https://developers.cloudflare.com/agents/runtime/lifecycle/agent-class/)) :
  il joint DGX1 par la même liaison VPC, en signant. Un appel de liaison VPC
  depuis un DO n'est pas montré par la documentation : à vérifier.
- Le modèle : un client compatible OpenAI avec un `baseURL` au choix
  ([modèles](https://developers.cloudflare.com/agents/api-reference/using-ai-models/)) ;
  le fournisseur AI SDK compatible OpenAI accepte un `fetch` sur mesure
  ([AI SDK](https://ai-sdk.dev/providers/openai-compatible-providers)) —
  c'est là qu'on branche la liaison VPC. Le DO appelle le relais `/v1` du
  studio, **jamais Ollama directement** : l'arbitrage de la mémoire reste sur
  DGX1.
- Le prompt système reste `data/methodology.md`, lu sur DGX1 : une seule
  vérité (règle de `Character_Factory/CLAUDE.md`).
- Connexion : WebSocket ; refus des non-authentifiés dans `onBeforeConnect`
  ([routing](https://developers.cloudflare.com/agents/api-reference/routing/)) ;
  d'où l'application Access sur le nom d'hôte (§ 2.1).

**Le point à trancher** : `AIChatAgent` range les messages en `UIMessage`
de l'AI SDK ([chat agents](https://developers.cloudflare.com/agents/api-reference/chat-agents/)),
et son client React (`useAgentChat`) suppose une étape de construction.
`Character_Factory/CLAUDE.md` interdit un second dialecte : `js/llm.js` ne
parle que les blocs de contenu Anthropic en interne. Proposition : une classe
`Agent` simple (pas `AIChatAgent`) qui garde les messages en blocs Anthropic
et ne traduit vers OpenAI qu'au bord, vers le DGX — la traduction de
`js/llm.js`, déplacée.

---

## 7. Le plan par étapes

Chaque étape s'essaie seule, avec Cal comme seul invité jusqu'à la
cinquième.

**Étape 0 — préparer sans rien ouvrir** (code, sur une copie, contrôles :
`tools/check.py`, `chain_check`).
- Portail et studio : l'écoute « porte » (127.0.0.1, signature exigée) et
  l'écoute « maison » liée au LAN ou au câble ; `owner`/`shared` sur les
  objets et les travaux ; quota de travaux en file par personne.
- Studio : les corrections de l'audit (C2, H2, H3, H4, M1–M4) ; la branche
  `claude/cf-bridge` reprise (§ 3.3).
- Pont : un par machine, écoutes porte 9770 et maison 8770.
- Essai en local : des requêtes signées à la main (curl) sur la porte ;
  non signées → 401.

**Étape 1 — la porte seule** (le plus petit pas utile ; rien des DGX n'est
joignable).
- Cal : Zero Trust (nom d'équipe, plan Free, moyen de paiement) ;
  One-time PIN ; l'application self-hosted sur
  `showrunner.luxigone.workers.dev`, politique Emails = lui seul, cookie Lax +
  binding cookie, 24 h ; copie du tag AUD.
- Cal : `npx wrangler deploy` du Worker `showrunner` (pages + `/api/porte/moi`),
  sans liaison VPC ; secrets `PORTE_CLE` et `ADMINS`.
- Essai, en 4G : code par e-mail, puis `/api/porte/moi` rend son e-mail et
  `admin`. Sans connexion : la page de connexion ; une version URL : coupée.

**Étape 2 — DGX2 relié.**
- Cal : Workers VPC → Tunnels → Create « dgx2 » ; sur DGX2, la commande
  `cloudflared` à jeton qu'affiche le tableau de bord (service systemd).
- Cal : VPC Service « portail-dgx2 » → tunnel dgx2, `127.0.0.1`, port 9790 ;
  son identifiant dans `wrangler.jsonc` ; redéployer.
- Essai : bibliothèque, file des rendus, un rendu d'image, depuis la 4G ;
  `cloudflared` doit annoncer QUIC.

**Étape 3 — R2.**
- Cal : bucket `showrunner-bibliotheque` ; jeton « Object Read & Write »
  limité à ce bucket, rangé sur DGX2 dans `~/.config/showrunner/r2.json`.
- Code : la recopie DGX2 → R2 et `library/index.json`.
- Essai : DGX2 arrêtée (portail coupé), la bibliothèque s'affiche encore.

**Étape 4 — DGX1, le studio et les ponts.**
- Cal : tunnel « dgx1 », services « studio-dgx1 » (9765), « pont-dgx1 »
  (9770), « pont-dgx2 » (9770 sur le tunnel dgx2) ; application Access sur
  `character-factory.luxigone.workers.dev` ; déploiement de
  `wrangler.studio.jsonc`.
- Essai : un personnage de bout en bout depuis la 4G ; « préparer » depuis la
  page quand ComfyUI dort.

**Étape 5 — les amis.** Cal ajoute leurs e-mails à la politique ; on regarde
les journaux (Workers Logs, journal du pont) la première semaine.

**Étape 6 — l'agent Identité**, si Cal le veut (§ 6.4).

### Ce que Cal fait lui-même

Tout ce qui touche au compte et aux secrets : l'inscription Zero Trust et
son moyen de paiement ; les applications Access et la liste des invités ;
la création des tunnels et la commande `cloudflared` à jeton sur chaque DGX
(sudo) ; les VPC Services ; `wrangler login`, `deploy`, `secret put` ; le
bucket et son jeton R2 ; la clé HMAC (par exemple
`python3 -c "import secrets; print(secrets.token_hex(32))"` sur un DGX, puis
dans le fichier et dans `wrangler secret put`). Aucun de ces secrets ne va
dans un dépôt (tous sont publics) ni dans une conversation.

### Coûts

| | gratuit | au-delà |
|---|---|---|
| Workers ([prix](https://developers.cloudflare.com/workers/platform/pricing/)) | 100 000 requêtes/jour, 10 ms de CPU par requête ; assets illimités | Paid : 5 $/mois, 10 millions de requêtes et 30 millions de ms CPU compris |
| Access ([Access](https://www.cloudflare.com/sase/products/access/)) | moins de 50 personnes | non chiffré ici |
| Workers VPC ([prix](https://developers.cloudflare.com/workers-vpc/platform/pricing/)) | gratuit pendant la bêta | non publié |
| Tunnel ([Tunnel](https://developers.cloudflare.com/tunnel/)) | « Available on all plans » | — |
| R2 ([prix](https://developers.cloudflare.com/r2/pricing/)) | 10 Go-mois, 1 M ops A, 10 M ops B | 0,015 $/Go-mois |
| Durable Objects ([prix](https://developers.cloudflare.com/durable-objects/platform/pricing/)) | 100 000 requêtes et 13 000 Go-s par jour | Paid : voir la page |

Le poste qui peut faire passer à 5 $ : **les relevés des pages**. Le portail
relit la file toutes les 1,5 s pendant un rendu, 6 s au repos
(`commun/shell.js`) ; le studio aussi relit souvent. (06/10 : c'est arrivé — 80 000 requêtes
dans la journée ; les relevés refaits, voir « Le compte des requêtes du Worker », en tête.) Un onglet ouvert, c'est
600 à 2 400 requêtes par heure : 100 000 par jour font 40 à 160 heures
d'onglet. Quelques amis tiennent en gratuit ; une vraie séance à plusieurs,
non. Les 10 ms de CPU par requête devraient suffire (vérifier un RS256 et un
HMAC par WebCrypto, relayer en flux) : non mesuré.

---

## Ce que l'audit exige, et où c'est réglé

| Point | Réglé par |
|---|---|
| C1 aucune authentification, écoute sur `0.0.0.0` | Access + JWT revérifié dans le Worker + écoute « porte » sur 127.0.0.1 qui exige la signature + écoute « maison » liée au LAN/câble |
| C2 pas de droits par utilisateur | rôle signé par le Worker ; `owner`/`shared` et `admins` jugés sur les DGX ; lecture R2 filtrée par `item.json` |
| H1 traversée de chemin | corrigé le 28/09 (01aea49) ; le Worker ne sert de R2 que `library/<id>/<fichier>` validés par regex |
| H2 EPS → Ghostscript | sur les DGX : PNG/JPEG/WEBP seulement (inchangé par la porte) |
| H3 CSRF | cookie Access Lax + binding cookie ; le Worker refuse une écriture dont `Origin`/`Sec-Fetch-Site` n'est pas la page même |
| H4 quotas GPU | file des DGX : N travaux par personne ; Worker : limite de débit par e-mail sur les écritures ([rate limit](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/), par lieu, périodes 10 ou 60 s) |
| M1 relais `/v1` | sur le studio (§ 6.3) ; limite de débit du Worker |
| M5 services voisins, tunnel rapide | VPC Services ciblés (jamais VPC Networks), pas de `trycloudflare` ; ComfyUI/Ollama à lier au loopback et au câble |
| B2 fuites d'information | `/api/porte/etat` détaillé pour un admin seulement ; erreurs internes cachées aux amis |

---

## Ce qui reste incertain — à vérifier au premier essai

1. **Workers VPC vers `127.0.0.1`** : dit par un guide d'un dépôt Cloudflare,
   pas par la documentation du produit (étape 2).
2. **Flux et WebSocket par Workers VPC** : non documentés (corps envoyés en
   flux, réponses en flux pour `/v1`, WebSocket pour l'agent). L'erreur
   `http_upgrade_failed` laisse penser que l'upgrade existe. Les pages
   actuelles n'en dépendent pas : elles relisent en boucle.
3. **Workers VPC est une bêta** : API, prix et fin de gratuité peuvent
   changer ; un fil communautaire signale un incident de résolution de nom
   d'hôte le 11/09/2026 (non lu : la page m'a été refusée). On vise une
   adresse IP, pas un nom.
4. **L'en-tête `Cf-Access-Jwt-Assertion` sur un Worker à assets** : la
   documentation dit que `ctx.access` n'est pas transmis ; elle ne dit rien de
   l'en-tête. Le Worker lit l'en-tête, sinon le cookie (étape 1).
5. **Deux noms d'hôte, deux applications Access** : une seconde connexion ou
   non, non vérifié.
6. **L'UDP sortant sur 7844** depuis la box de la maison : inconnu tant qu'un
   tunnel n'a pas tourné.
7. **`"directory": ".."`** (le dépôt comme dossier d'assets) : non documenté
   pour un chemin parent ; `wrangler deploy --dry-run` le dira.
8. **Limite de débit sur Workers Free** : la documentation ne précise pas le
   plan.
9. **Les requêtes et le CPU réels** : ni mesurés ni estimés au-delà du calcul
   ci-dessus.
10. **Un appel de liaison VPC depuis un Durable Object** : déduit de
    `this.env`, pas montré (étape 6).

---

## 8. `porte/` (prêt, non déployé)

Mis à jour le 29/09 (« Prêt à déployer », plus haut) : le jeton Access vérifié
suit vers le portail, qui le revérifie avec la signature ; `/character/…` et
`/analyse/runs/…` vont au portail ; le droit de lire dans R2 suit
`owner_email`, `shared`, `tous` ; `porte/essai.mjs` essaie le Worker de bout
en bout dans Node ; `porte/r2_recopie.py` recopie la bibliothèque.

- `porte/worker.js` — le Worker, sans dépendance : vérification du JWT
  Access (WebCrypto, clés par `kid`, relues au plus une fois par minute),
  rôle par le secret `ADMINS`, refus des écritures venues d'une autre page,
  limite de débit par e-mail, relais vers les DGX par liaison VPC avec
  identité signée et corps en `FixedLengthStream`, lecture de R2 avec Range
  (repris de `movie-analysis-partage`) et droit lu dans `item.json`, liste de
  la bibliothèque hors ligne, état des machines, page « les machines
  dorment ». Mode studio par `MODE = "studio"`.
- `porte/wrangler.jsonc` — le portail (`showrunner`), commenté, identifiants
  à remplir.
- `porte/wrangler.studio.jsonc` — le studio (`character-factory`).
- `.assetsignore` (racine du dépôt) — ce que la porte ne publie jamais.
- `porte/.gitignore` — `.wrangler/`, `node_modules/`, `.dev.vars`.

Rien de secret dans ces fichiers ; `TEAM_DOMAIN` et `POLICY_AUD` sont des
emplacements à remplir.

---

## Relevé des DGX (28/09/2026, lecture seule)

| | DGX1 | DGX2 |
|---|---|---|
| architecture | aarch64 | aarch64 |
| `cloudflared` | 2026.9.3, aucun tunnel, pas de `~/.cloudflared` | idem |
| écoute sur `0.0.0.0` | studio 8765, ComfyUI 8188, 8005, 8015, 8080 ; Ollama `*:11434` | portail 8790, relais 8765, ancienne API 8000, ComfyUI 8188, 8080, 8799 ; Ollama `*:11434` |
| Ollama | 0.20.7, `qwen3-vl-32b-32k` présent, rien de chargé | idem |
| Tailscale Funnel | public : racine et :8443 ; tailnet : 10000 → 8445, 10001 → 8189, 10002 → 8448 | public : racine → 8444, :8443 → 8446 |
| mémoire | 121 Go, 94 disponibles | 121 Go, 109 disponibles |

---

## Sources (lues le 28/09/2026)

Workers et assets
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/workers/platform/pricing/
- https://developers.cloudflare.com/workers/static-assets/
- https://developers.cloudflare.com/workers/static-assets/binding/
- https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/
- https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/
- https://developers.cloudflare.com/pages/platform/limits/
- https://developers.cloudflare.com/workers/configuration/routing/workers-dev/
- https://developers.cloudflare.com/workers/configuration/previews/
- https://developers.cloudflare.com/workers/runtime-apis/request/
- https://developers.cloudflare.com/workers/runtime-apis/streams/transformstream/
- https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/

Access et Zero Trust
- https://developers.cloudflare.com/workers/configuration/cloudflare-access/
- https://developers.cloudflare.com/changelog/post/2026-08-14-workers-access/
- https://developers.cloudflare.com/changelog/post/2026-06-18-cloudflare-idp-default/
- https://developers.cloudflare.com/cloudflare-one/setup/
- https://developers.cloudflare.com/cloudflare-one/account-limits/
- https://developers.cloudflare.com/cloudflare-one/team-and-resources/users/seat-management/
- https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/
- https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/cloudflare/
- https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/google/
- https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/
- https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/
- https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/
- https://www.cloudflare.com/sase/products/access/
- https://developers.cloudflare.com/email-service/configuration/domains/

Workers VPC et Tunnel
- https://developers.cloudflare.com/workers-vpc/
- https://developers.cloudflare.com/workers-vpc/get-started/
- https://developers.cloudflare.com/workers-vpc/configuration/tunnel/
- https://developers.cloudflare.com/workers-vpc/configuration/vpc-services/
- https://developers.cloudflare.com/workers-vpc/configuration/vpc-networks/
- https://developers.cloudflare.com/workers-vpc/api/
- https://developers.cloudflare.com/workers-vpc/platform/limits/
- https://developers.cloudflare.com/workers-vpc/platform/pricing/
- https://developers.cloudflare.com/workers-vpc/reference/troubleshooting/
- https://developers.cloudflare.com/workers-vpc/reference/wrangler-commands/
- https://developers.cloudflare.com/workers-vpc/examples/private-api/
- https://github.com/cloudflare/claude-managed-agents/blob/main/docs/connecting-to-private-services.md
- https://developers.cloudflare.com/tunnel/
- https://developers.cloudflare.com/tunnel/get-started/
- https://developers.cloudflare.com/tunnel/reference/tunnel-tokens/
- https://developers.cloudflare.com/tunnel/advanced/local-management/as-a-service/linux/
- https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/
- https://developers.cloudflare.com/registrar/

R2
- https://developers.cloudflare.com/r2/pricing/
- https://developers.cloudflare.com/r2/platform/limits/
- https://developers.cloudflare.com/r2/api/tokens/
- https://developers.cloudflare.com/r2/api/s3/api/
- https://developers.cloudflare.com/r2/api/s3/presigned-urls/
- https://developers.cloudflare.com/r2/buckets/public-buckets/

Agents et modèles
- https://developers.cloudflare.com/agents/api-reference/using-ai-models/
- https://developers.cloudflare.com/agents/api-reference/chat-agents/
- https://developers.cloudflare.com/agents/api-reference/routing/
- https://developers.cloudflare.com/agents/runtime/lifecycle/agent-class/
- https://developers.cloudflare.com/durable-objects/platform/pricing/
- https://ai-sdk.dev/providers/openai-compatible-providers
- https://github.com/ollama/ollama/blob/main/docs/api.md
- https://github.com/Comfy-Org/ComfyUI/pull/16622

Chez Cal
- `C:\claude\MOVIE_ANALYSE\outils\partage\worker.js`, `wrangler.jsonc` (le modèle éprouvé : CORS par origine, Range sur R2)
- `Character_Factory` : `docs/REPRISE_CAL.md`, `docs/CLOUDFLARE.md`, branche `claude/cf-bridge` (`tools/bridge.py`, `docs/CLOUDFLARE.md`), `factory/memory.py`, `js/studio.js`
- l'audit de sécurité du 28/09 (hors dépôt)
