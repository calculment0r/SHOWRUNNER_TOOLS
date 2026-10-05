#!/usr/bin/env python3
"""La bibliothèque « Asset » recopiée dans R2 (docs/etudes/cloudflare.md, § 4) :
un seul sens, DGX2 → R2, pour que les pages la voient DGX éteintes.

    python3 porte/r2_recopie.py             # envoie ce qui a changé ; retire de R2 ce qui a quitté la bibliothèque
    python3 porte/r2_recopie.py --a-blanc   # dit ce qu'il ferait, n'envoie rien
    python3 porte/r2_recopie.py --essai     # la signature SigV4 contre l'exemple publié par AWS, sans réseau

Les clés, celles que lit le Worker (porte/worker.js) : `library/<id>/<fichier>`
pour chaque fichier d'un objet ; `library/<id>/item.json`, l'objet tel que la
page le voit, plus `owner_email` (l'e-mail du propriétaire, s'il en a un),
`shared` et `tous` (vrai quand « qui voit quoi » vaut « tout le monde voit
tout ») ; `library/index.json`, la liste entière, pour les DGX éteintes.

Le jeton, jamais dans le dépôt (public) : `~/.config/showrunner/r2.json`,
lisible par son seul propriétaire (chmod 600) :
    {"account_id": "<id du compte>", "access_key_id": "…", "secret_access_key": "…",
     "bucket": "showrunner-bibliotheque"}
Cal le crée : R2 object storage → Manage API Tokens → « Object Read & Write »,
limité au bucket (https://developers.cloudflare.com/r2/api/tokens/) ; la clé
secrète ne s'affiche qu'une fois. Point d'accès : l'API S3 de R2,
`https://<ACCOUNT_ID>.r2.cloudflarestorage.com`, région `auto`
(https://developers.cloudflare.com/r2/api/s3/api/). Signature AWS SigV4 en
bibliothèque standard ; un envoi simple (un fichier de la bibliothèque fait
2 Go au plus, sous la limite de 5 Gio d'un envoi simple). Ce qui est déjà
parti est noté dans `<data_dir>/r2-etat.json` (taille, date, SHA-256) : rien
n'est relu ni renvoyé sans raison.
"""

from __future__ import annotations

import hashlib
import hmac
import http.client
import json
import mimetypes
import os
import stat
import sys
import time
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
JETON = Path(os.environ.get("SR_R2_JETON") or Path.home() / ".config" / "showrunner" / "r2.json")   # SR_R2_JETON : essais
REGION, SERVICE = "auto", "s3"
VIDE = hashlib.sha256(b"").hexdigest()
for ext, t in ((".webp", "image/webp"), (".glb", "model/gltf-binary"), (".flac", "audio/flac"), (".mid", "audio/midi")):
    mimetypes.add_type(t, ext)


# ── SigV4 (https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html) ──
def _q(s: str, safe: str = "-_.~") -> str:
    return urllib.parse.quote(s, safe=safe)


def autorisation(method: str, host: str, path: str, query: list[tuple[str, str]], headers: dict, payload: str,
                 access: str, secret: str, amzdate: str, region: str = REGION, service: str = SERVICE) -> str:
    """L'en-tête Authorization d'une requête S3. `headers` : noms en minuscules,
    avec host, x-amz-date et x-amz-content-sha256 ; tous sont signés."""
    names = sorted(headers)
    canon = "\n".join([
        method, _q(path, "/-_.~"), "&".join(f"{_q(k)}={_q(v)}" for k, v in sorted(query)),
        "".join(f"{n}:{' '.join(str(headers[n]).split())}\n" for n in names), ";".join(names), payload])
    day = amzdate[:8]
    scope = f"{day}/{region}/{service}/aws4_request"
    todo = "\n".join(["AWS4-HMAC-SHA256", amzdate, scope, hashlib.sha256(canon.encode()).hexdigest()])
    k = ("AWS4" + secret).encode()
    for part in (day, region, service, "aws4_request"):
        k = hmac.new(k, part.encode(), hashlib.sha256).digest()
    sig = hmac.new(k, todo.encode(), hashlib.sha256).hexdigest()
    return f"AWS4-HMAC-SHA256 Credential={access}/{scope}, SignedHeaders={';'.join(names)}, Signature={sig}"


def essai() -> bool:
    """Les exemples « GET Object » et « GET Bucket (List Objects) » de la documentation AWS (signatures connues) :
    la seconde porte des paramètres (la liste d'un préfixe, R2.liste)."""
    cle = ("AKIAIOSFODNN7EXAMPLE", "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", "20130524T000000Z")
    got = autorisation("GET", "examplebucket.s3.amazonaws.com", "/test.txt", [],
                       {"host": "examplebucket.s3.amazonaws.com", "range": "bytes=0-9", "x-amz-content-sha256": VIDE,
                        "x-amz-date": "20130524T000000Z"}, VIDE, *cle, region="us-east-1")
    liste = autorisation("GET", "examplebucket.s3.amazonaws.com", "/", [("max-keys", "2"), ("prefix", "J")],
                         {"host": "examplebucket.s3.amazonaws.com", "x-amz-content-sha256": VIDE,
                          "x-amz-date": "20130524T000000Z"}, VIDE, *cle, region="us-east-1")
    return (got.endswith("Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41")
            and liste.endswith("Signature=34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7"))


# ── R2 ──────────────────────────────────────────────────────
class R2:
    def __init__(self, cfg: dict, point: str | None = None) -> None:
        self.bucket = cfg["bucket"]
        self.access, self.secret = cfg["access_key_id"], cfg["secret_access_key"]
        u = urllib.parse.urlsplit(point or f"https://{cfg['account_id']}.r2.cloudflarestorage.com")
        self.scheme, self.host = u.scheme, u.netloc

    def _send(self, method: str, key: str, body=None, length: int = 0, sha: str = VIDE, extra: dict | None = None,
              query: list[tuple[str, str]] | None = None):
        # key vide : le bucket lui-même (une liste, query = ses paramètres)
        path = f"/{self.bucket}/{key}" if key else f"/{self.bucket}"
        query = query or []
        amz = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        h = {"host": self.host, "x-amz-date": amz, "x-amz-content-sha256": sha, **{k.lower(): v for k, v in (extra or {}).items()}}
        h["authorization"] = autorisation(method, self.host, path, query, h, sha, self.access, self.secret, amz)
        if body is not None or method == "PUT":
            h["content-length"] = str(length)
        qs = "&".join(f"{_q(k)}={_q(v)}" for k, v in sorted(query))
        conn = (http.client.HTTPSConnection if self.scheme == "https" else http.client.HTTPConnection)(self.host, timeout=120)
        try:
            conn.request(method, _q(path, "/-_.~") + (f"?{qs}" if qs else ""), body=body, headers=h)
            r = conn.getresponse()
            txt = r.read()
            return r.status, txt
        finally:
            conn.close()

    def put(self, key: str, path: Path | None = None, data: bytes | None = None, ctype: str = "", sha: str = "") -> None:
        extra = {"content-type": ctype or "application/octet-stream", "x-amz-meta-sha256": sha}
        for essai_n in range(3):
            if data is not None:
                st, txt = self._send("PUT", key, data, len(data), sha, extra)
            else:
                with open(path, "rb") as fh:
                    st, txt = self._send("PUT", key, fh, path.stat().st_size, sha, extra)
            if st == 200:
                return
            if st < 500 or essai_n == 2:
                raise OSError(f"PUT {key} : {st} {txt[:300]!r}")
            time.sleep(2 * (essai_n + 1))

    def delete(self, key: str) -> None:
        st, txt = self._send("DELETE", key)
        if st not in (200, 204, 404):
            raise OSError(f"DELETE {key} : {st} {txt[:300]!r}")

    def liste(self, prefixe: str) -> list[str]:
        """Les clés sous un préfixe (ListObjectsV2, 1000 par page, la suite par
        continuation-token : https://developers.cloudflare.com/r2/api/s3/api/). Le lien
        d'écoute s'en sert pour retirer un lien et compter ses écoutes (server/tools/ecoute.py)."""
        import xml.etree.ElementTree as ET
        cles: list[str] = []
        suite = None
        while True:
            q = [("list-type", "2"), ("prefix", prefixe)] + ([("continuation-token", suite)] if suite else [])
            st, txt = self._send("GET", "", query=q)
            if st != 200:
                raise OSError(f"LIST {prefixe} : {st} {txt[:300]!r}")
            racine = ET.fromstring(txt)
            nom = lambda e: e.tag.rsplit("}", 1)[-1]   # noqa: E731 — avec ou sans l'espace de noms de S3
            cles += [e.text or "" for e in racine.iter() if nom(e) == "Key"]
            tronque = next((e.text for e in racine if nom(e) == "IsTruncated"), "false")
            suite = next((e.text for e in racine if nom(e) == "NextContinuationToken"), None)
            if tronque != "true" or not suite:
                return cles


def lis_jeton() -> dict:
    try:
        st = JETON.stat()
    except OSError:
        sys.exit(f"pas de jeton R2 : {JETON} (docs/etudes/cloudflare.md, « Prêt à déployer »)")
    if stat.S_IMODE(st.st_mode) & 0o077:
        sys.exit(f"{JETON} est lisible par d'autres : chmod 600 {JETON}")
    cfg = json.loads(JETON.read_text(encoding="utf-8"))
    manque = [k for k in ("account_id", "access_key_id", "secret_access_key", "bucket") if not cfg.get(k)]
    if manque:
        sys.exit(f"{JETON} : il manque {', '.join(manque)}")
    return cfg


# ── ce qui doit être dans R2 ────────────────────────────────
def _sha(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as fh:
        for buf in iter(lambda: fh.read(1 << 20), b""):
            h.update(buf)
    return h.hexdigest()


def voulu() -> tuple[dict[str, Path], dict[str, bytes], Path]:
    """(fichiers : clé → chemin, documents : clé → octets, fichier d'état) de la bibliothèque du portail."""
    sys.path.insert(0, str(REPO / "server"))
    from core import auth, config, library   # noqa: E402  (showrunner.local.json et SHOWRUNNER_DATA, comme le portail)

    library._load()
    tous = auth.settings()["visibility"] == "all"
    emails = {uid: e for e, uid in auth.door_settings()["emails"].items()}

    def email_of(uid):
        u = auth.user(uid) or {}
        return (u.get("email") or emails.get(uid) or "").lower() or None

    fichiers: dict[str, Path] = {}
    docs: dict[str, bytes] = {}
    index = []
    for it in sorted(library._items.values(), key=lambda i: i["created"], reverse=True):
        d = library.folder_of(it["id"])
        if not d.is_dir():
            continue
        pub = {**library.public(it), "owner_email": email_of(auth.owner_of(it)), "shared": bool(it.get("shared")),
               "tous": tous}
        for p in sorted(d.iterdir()):
            if p.is_file() and not p.name.startswith(".") and p.name != "item.json" and not p.name.endswith(".tmp"):
                fichiers[f"library/{it['id']}/{p.name}"] = p
        docs[f"library/{it['id']}/item.json"] = json.dumps(pub, ensure_ascii=False).encode()
        index.append(pub)
    docs["library/index.json"] = json.dumps({"at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                                             "visibility": "all" if tous else "own", "items": index},
                                            ensure_ascii=False).encode()
    return fichiers, docs, config.data_dir() / "r2-etat.json"


def main() -> int:
    if "--essai" in sys.argv:
        good = essai()
        print("SigV4 : l'exemple d'AWS est retrouvé" if good else "SigV4 : ÉCHEC contre l'exemple d'AWS")
        return 0 if good else 1
    blanc = "--a-blanc" in sys.argv
    point = sys.argv[sys.argv.index("--point") + 1] if "--point" in sys.argv else None   # essais : un faux S3 local
    fichiers, docs, etat_f = voulu()
    etat = json.loads(etat_f.read_text(encoding="utf-8")) if etat_f.exists() else {}
    r2 = None if blanc else R2(lis_jeton(), point)
    envoyes = retires = 0
    octets = 0
    try:
        envoyes, retires, octets = _recopie(r2, blanc, fichiers, docs, etat)
    finally:   # ce qui est parti reste noté, même si un envoi échoue en route
        if not blanc:
            tmp = etat_f.with_suffix(".tmp")
            tmp.write_text(json.dumps(etat, ensure_ascii=False, indent=0), encoding="utf-8")
            tmp.replace(etat_f)
    print(f"{'à blanc : ' if blanc else ''}{envoyes} envoyés ({octets / 1e6:.1f} Mo de fichiers), {retires} retirés, "
          f"{len(fichiers)} fichiers et {len(docs)} documents dans la bibliothèque")
    return 0


def _recopie(r2, blanc: bool, fichiers: dict, docs: dict, etat: dict) -> tuple[int, int, int]:
    envoyes = retires = octets = 0
    for key, p in fichiers.items():
        st = p.stat()
        vu = etat.get(key) or {}
        if vu.get("taille") == st.st_size and vu.get("mtime") == st.st_mtime_ns:
            continue
        sha = _sha(p)
        if vu.get("sha") != sha:
            if blanc:
                print("envoyer", key, st.st_size)
            else:
                r2.put(key, path=p, ctype=mimetypes.guess_type(p.name)[0] or "", sha=sha)
            envoyes += 1
            octets += st.st_size
        etat[key] = {"taille": st.st_size, "mtime": st.st_mtime_ns, "sha": sha}
    for key, data in docs.items():
        sha = hashlib.sha256(data).hexdigest()
        if (etat.get(key) or {}).get("sha") == sha:
            continue
        if blanc:
            print("envoyer", key, len(data))
        else:
            r2.put(key, data=data, ctype="application/json", sha=sha)
        envoyes += 1
        etat[key] = {"sha": sha}
    for key in [k for k in etat if k.startswith("library/") and k not in fichiers and k not in docs]:
        if blanc:
            print("retirer", key)
        else:
            r2.delete(key)
        retires += 1
        etat.pop(key)
    return envoyes, retires, octets


if __name__ == "__main__":
    sys.exit(main())
