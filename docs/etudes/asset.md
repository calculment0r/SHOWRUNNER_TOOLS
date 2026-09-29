# Asset — télécharger une sélection, et la bibliothèque sur R2 (29/09)

Question de Cal, le 29/09 : « download (on peut faire un zip si les assets
sont sur R2 ?) ». Une source par ligne ; « non documenté » sinon.

## Ce qui marche aujourd'hui

- **Un fichier** : téléchargé tel quel, au nom de son titre.
- **Plusieurs, ou un élément** : `POST /api/asset/zip {ids}` sur DGX2, qui a
  les fichiers (`server/tools/asset.py`, `zip_make`). `zipfile` de la
  bibliothèque standard, sans recompression (`ZIP_STORED` : PNG, JPEG, MP4
  le sont déjà). Écrit dans `<data>/zips/<jeton>/`, servi en flux par
  `GET /api/asset/zip/<jeton>/<nom>.zip` (les requêtes partielles marchent :
  `core/http.py`, `FileResponse`), effacé après deux heures.
- Un **élément** y devient un dossier à son nom : ses références dans
  l'ordre (« 01 visage · neutre.png »), sa voix, ses GLB, sa description.

## Quand la bibliothèque publiée sera sur R2

(`docs/etudes/cloudflare.md` §4 : DGX2 recopie chaque objet dans R2, les
pages lisent par le Worker.)

Ce que disent les documents de Cloudflare, lus le 29/09 :

| | | source |
|---|---|---|
| Archive | R2 n'a pas d'opération d'archive : il imite l'API S3, qui n'en a pas ; il lit un objet (`GetObject`, avec `Range`) | [S3 API compatibility](https://developers.cloudflare.com/r2/api/s3/api/) |
| Sortie | « There are no charges for egress bandwidth for any storage class » ; une lecture = une opération de classe B, 0,36 $ le million, 10 millions gratuites par mois | [R2 pricing](https://developers.cloudflare.com/r2/pricing/) |
| Worker, CPU | 10 ms par requête (Free) ; 30 s par défaut, 5 min au plus (Paid) ; attendre le réseau ne compte pas | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) |
| Worker, mémoire | 128 Mo par isolat : « Stream request and response bodies » | idem |
| Worker, sous-requêtes | 50 par requête (Free), 10 000 (Paid) | idem |

Trois façons de faire le zip, donc :

1. **Par la DGX qui a les fichiers** — ce qui existe. Le Worker relaie le
   flux venu du tunnel (Workers VPC, `cloudflare.md` §3) : il attend le
   réseau, ce qui ne compte pas en CPU. Limites : la DGX doit être allumée ;
   le débit est celui de la montée de la box (non mesuré).
2. **Par le navigateur, en flux depuis R2** — marche DGX éteintes. La page lit
   chaque fichier par le Worker (une lecture de classe B chacun) et l'écrit
   dans un zip en flux : [client-zip](https://www.npmjs.com/package/client-zip)
   2.5.1 (MIT, « A tiny and fast client-side streaming ZIP generator ») ou
   [fflate](https://www.npmjs.com/package/fflate) 0.8.3 (MIT). Écrire ce flux
   sur le disque au lieu de la mémoire demande l'API d'accès aux fichiers
   (`showSaveFilePicker`, Chromium) : **non essayé ici** ; sans elle, le zip
   entier tient en mémoire du navigateur — la taille qui passe est **non
   documentée**. Il faudrait au serveur une route qui rende la liste des
   fichiers et leurs noms dans le zip, pour que la page fasse le même.
3. **Par le Worker lui-même** — à écarter : le CRC32 de chaque octet se
   calcule dans le Worker et compte en CPU (10 ms en Free) ; pour des vidéos
   de plusieurs Go, le temps réel n'est **pas mesuré**, mais la limite de
   5 min (Paid) est un plafond dur.

**Proposition à Cal** : garder 1 tant que les DGX sont allumées (c'est le
cas où l'on travaille), ajouter 2 en secours quand elles sont éteintes et
que la bibliothèque est sur R2. Rien n'est à acheter ; 2 ajoute une
bibliothèque JS (client-zip), à télécharger avec son accord.
