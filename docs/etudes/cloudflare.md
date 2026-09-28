# La porte d'entrée Cloudflare — étude du 28/09/2026

Étude seulement : **rien n'est déployé, aucun tunnel ne tourne, rien n'est
ouvert sur internet** (l'audit de sécurité du 28/09 dit de ne rien ouvrir en
l'état). Documentation Cloudflare lue le 28/09/2026 ; chaque affirmation
technique porte son lien, « non documenté » quand la documentation se tait.
Un squelette de Worker, non déployé, est dans `porte/` (§ 8).

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
n'a pas RS256 ; HMAC, si. Côté DGX :

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
(`commun/shell.js`) ; le studio aussi relit souvent. Un onglet ouvert, c'est
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

## 8. Le squelette `porte/` (non déployé)

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
