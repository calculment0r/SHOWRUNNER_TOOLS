"""L'objet « Web » d'Idéation (30/09/2026) : une adresse collée sur la planche
devient une carte — une vidéo YouTube ou Vimeo dans son lecteur officiel, un
site dans un cadre s'il l'autorise, sinon une carte lien propre (titre, image,
description lus sur la page par le serveur), et elle le dit.

Demande de Cal (30/09) : « on peut embedder des vidéos YouTube ou des sites web
comme Miro ? ils ont un truc genre iframe... ». L'étude, les sources :
docs/etudes/ideation_collab.md § 10.

Ce que fait le serveur, et seulement lui :
- `parse(url)` : l'adresse est-elle acceptable (http ou https, sans identifiant,
  2 048 signes au plus) ; est-ce YouTube, Vimeo ou un site ; l'adresse
  d'intégration **officielle** qui en découle (YouTube en « privacy-enhanced
  mode », `youtube-nocookie.com` ; Vimeo avec `dnt=1`). La page tient la même
  fonction (`ideation/objets/web_url.js`) : le contrôle compare les deux, cas
  par cas ; l'adresse d'intégration n'est jamais lue dans la planche (une
  opération d'un autre onglet ne peut pas y glisser une autre adresse).
- `apercu(url)` : lit la page (ou l'oEmbed de YouTube / Vimeo) et en tire le
  titre, la description, le site, l'image (Open Graph, sinon Twitter, sinon
  `<title>`), et si le site se laisse mettre dans un cadre (`X-Frame-Options`,
  CSP `frame-ancestors`). L'image est relue, réduite à 640 px et rangée en WebP
  sous `<data_dir>/ideation_web/<empreinte>.webp` : la page ne va jamais la
  chercher chez le site (ni fuite de l'adresse du portail, ni image qui change
  ou disparaît, ni « hotlink » refusé).
- **SSRF** : rien n'est demandé à une adresse locale ou privée. Le nom est
  résolu, CHAQUE adresse doit être publique (`ipaddress.is_global` ; une
  adresse IPv4 dans IPv6 est jugée comme IPv4), et la connexion se fait à
  l'adresse vérifiée elle-même (pas de seconde résolution : le « DNS
  rebinding » ne passe pas) ; ports 80 et 443 seulement ; chaque redirection
  (4 au plus) est rejugée.
- **Bornes** : 8 s en tout par aperçu (chaque opération réseau prend ce qui
  reste), 512 Ko de page lus au plus (les balises Open Graph sont dans
  `<head>`), 64 Ko pour un oEmbed, 4 Mo pour une image, 40 mégapixels ; 30
  aperçus par minute et par personne ; une adresse déjà lue sert son résultat
  une heure.

Routes :
  POST /api/ideation/web/apercu {url, board?}  → {ok, url, kind, id, embed, title, desc, site, img, frame, why, fetched}
  GET  /api/ideation/web/img/<empreinte>       → l'image rangée (WebP)
L'invité d'Idéation (rôle `invite`) voit les images ; il ne demande un aperçu
que pour une planche où il est éditeur (`board`).
"""

from __future__ import annotations

import hashlib
import html
import http.client
import ipaddress
import json
import re
import socket
import ssl
import threading
import time
import zlib
from html.parser import HTMLParser
from io import BytesIO
from pathlib import Path
from urllib.parse import parse_qs, quote, urljoin, urlsplit

from core import auth, config
from core.http import FileResponse, HttpError

MAX_URL = 2048
DEADLINE = 8.0               # s, tout un aperçu (page, redirections, image)
MAX_PAGE = 512 << 10         # octets de page lus
MAX_JSON = 64 << 10          # un oEmbed
MAX_IMG = 4 << 20            # une image
MAX_PIXELS = 40_000_000
MAX_HOPS = 4
PORTS = (80, 443)
RATE = 30                    # aperçus par minute et par personne
TTL = 3600                   # s, un aperçu gardé
IMG_SIDE = 640
KEY = re.compile(r"[0-9a-f]{24}")
UA = "Mozilla/5.0 (compatible; ShowrunnerTools-carte/1.0; +lien colle sur une planche)"
# l'hôte, en clair (sans identifiant ni port) : lettres, chiffres, points, tirets, crochets IPv6
HOST_OK = re.compile(r"[A-Za-z0-9.\-]{1,253}|\[[0-9A-Fa-f:.]{2,45}\]")

YT_HOSTS = ("youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com",
            "youtube-nocookie.com", "www.youtube-nocookie.com")
YT_SHORT = ("youtu.be", "www.youtu.be")
VIMEO_HOSTS = ("vimeo.com", "www.vimeo.com", "player.vimeo.com")
YT_ID = re.compile(r"[A-Za-z0-9_-]{11}")
VIMEO_ID = re.compile(r"\d{1,12}")
VIMEO_H = re.compile(r"[0-9a-f]{6,20}")
T_RX = re.compile(r"(?:(\d{1,2})h)?(?:(\d{1,4})m)?(?:(\d{1,6})s?)?")


# ── l'adresse ────────────────────────────────────────────────
def _start(v: str) -> int:
    """`t=` / `start=` de YouTube : « 90 », « 90s », « 1m30s », « 1h2m3s » → secondes (0 si illisible)."""
    m = T_RX.fullmatch(v or "")
    if not m or not any(m.groups()):
        return 0
    h, mi, s = (int(g or 0) for g in m.groups())
    return min(86400, h * 3600 + mi * 60 + s)


def parse(raw) -> dict:
    """{ok, why, url, kind: youtube | vimeo | site, id, embed, host}. `ok` faux : `why` dit pourquoi.
    La même règle que ideation/objets/web_url.js (le contrôle compare)."""
    u = str(raw if raw is not None else "").strip()
    bad = lambda why: {"ok": False, "why": why, "url": u[:MAX_URL], "kind": "", "id": "", "embed": "", "host": ""}  # noqa: E731
    if not u:
        return bad("une adresse vide")
    if len(u) > MAX_URL:
        return bad(f"une adresse de plus de {MAX_URL} signes")
    if re.search(r"[\s\x00-\x1f\x7f]", u):
        return bad("une adresse ne contient ni espace ni caractère de contrôle")
    if not re.match(r"^[A-Za-z][A-Za-z0-9+.\-]*:", u) and re.match(r"^[A-Za-z0-9\-]+(\.[A-Za-z0-9\-]+)+(:\d+)?([/?#]|$)", u):
        u = "https://" + u          # « youtube.com/watch?v=… » collé sans son début
    m = re.match(r"^([A-Za-z][A-Za-z0-9+.\-]*):", u)
    scheme = m.group(1).lower() if m else ""
    if scheme not in ("http", "https"):
        return bad(f"seules les adresses http:// et https:// sont prises ({scheme + ':' if scheme else 'sans schéma'} refusé)")
    if not re.match(r"^https?://", u, re.I):
        return bad("une adresse web commence par http:// ou https://")
    rest = u.split("://", 1)[1]
    auth_part = re.split(r"[/?#]", rest, 1)[0]
    if "@" in auth_part:
        return bad("une adresse avec un identifiant (nom@ ou nom:mot@) est refusée")
    host = re.sub(r":\d*$", "", auth_part) if not auth_part.startswith("[") else auth_part[: auth_part.find("]") + 1]
    if not HOST_OK.fullmatch(host or ""):
        return bad("le nom du site est illisible")
    port_s = auth_part[len(host):]
    if port_s and not re.fullmatch(r":\d{1,5}", port_s):
        return bad("le port est illisible")
    host = host.lower()
    try:
        sp = urlsplit(u)
    except ValueError:
        return bad("une adresse illisible")
    path, q = sp.path or "/", parse_qs(sp.query)
    seg = [x for x in path.split("/") if x]
    out = {"ok": True, "why": "", "url": u, "kind": "site", "id": "", "embed": "", "host": host}
    vid = ""
    if host in YT_HOSTS:
        if path == "/watch":
            vid = (q.get("v") or [""])[0]
        elif len(seg) >= 2 and seg[0] in ("embed", "shorts", "live", "v"):
            vid = seg[1]
    elif host in YT_SHORT and seg:
        vid = seg[0]
    if vid and YT_ID.fullmatch(vid):
        t = _start((q.get("t") or q.get("start") or [""])[0])
        out.update(kind="youtube", id=vid, embed=f"https://www.youtube-nocookie.com/embed/{vid}" + (f"?start={t}" if t else ""))
        return out
    if host in VIMEO_HOSTS:
        vid, hh = "", ""
        if host == "player.vimeo.com" and len(seg) >= 2 and seg[0] == "video":
            vid = seg[1]
        elif seg and VIMEO_ID.fullmatch(seg[0]):
            vid = seg[0]
            hh = seg[1] if len(seg) >= 2 else ""
        elif len(seg) >= 3 and seg[0] == "channels":
            vid = seg[2]
        elif len(seg) >= 4 and seg[0] == "groups" and seg[2] == "videos":
            vid = seg[3]
        hh = hh or (q.get("h") or [""])[0]
        if VIMEO_ID.fullmatch(vid or ""):
            hh = hh if VIMEO_H.fullmatch(hh or "") else ""
            out.update(kind="vimeo", id=vid, embed=f"https://player.vimeo.com/video/{vid}?dnt=1" + (f"&h={hh}" if hh else ""))
    return out


# ── les champs d'un objet « web » de la planche (server/tools/ideation.py, `_node`) ──
def _line(v, n: int) -> str:
    return " ".join(str(v if v is not None else "").split())[:n]


def node_fields(n: dict) -> dict:
    """Ce qu'un objet « web » garde : l'adresse (refusée si elle ne passe pas `parse`),
    ce que l'aperçu en a lu (borné), l'image rangée (son empreinte, sinon rien).
    La sorte et l'adresse d'intégration ne sont pas gardées : elles se déduisent."""
    p = parse(n.get("url"))
    if not p["ok"]:
        raise HttpError(400, f"l'objet web {n.get('id')} : {p['why']}")
    img = str(n.get("img") or "")
    return {"url": p["url"], "title": _line(n.get("title"), 300), "desc": _line(n.get("desc"), 600),
            "site": _line(n.get("site"), 120), "img": img if KEY.fullmatch(img) else "",
            "frame": bool(n.get("frame")), "why": _line(n.get("why"), 240), "fetched": _line(n.get("fetched"), 32)}


# ── le réseau, sans jamais viser le dedans ───────────────────
class Refused(Exception):
    """Une adresse que le serveur ne lira pas (le pourquoi est dans le message)."""


_ALLOW_TEST: set[tuple[str, int]] = set()     # le contrôle seul y met ses serveurs d'essai (ip, port)


def _public(ip: str, port: int) -> bool:
    if (ip, port) in _ALLOW_TEST:
        return True
    a = ipaddress.ip_address(ip.split("%", 1)[0])
    if a.version == 6:
        if a.ipv4_mapped:
            a = a.ipv4_mapped
        elif a in ipaddress.ip_network("64:ff9b::/96"):       # NAT64 : l'IPv4 est dans les 32 derniers bits
            a = ipaddress.IPv4Address(int(a) & 0xFFFFFFFF)
        elif a.sixtofour:
            a = a.sixtofour
    return a.is_global and not a.is_multicast


def _resolve(host: str, port: int) -> str:
    """L'adresse à joindre : toutes celles du nom doivent être publiques ; on garde la première."""
    h = host[1:-1] if host.startswith("[") else host
    try:
        infos = socket.getaddrinfo(h, port, type=socket.SOCK_STREAM)
    except (socket.gaierror, UnicodeError) as e:
        raise Refused(f"le nom « {host} » ne se résout pas") from e
    ips = [i[4][0] for i in infos]
    if not ips:
        raise Refused(f"le nom « {host} » ne se résout pas")
    for ip in ips:
        if not _public(ip, port):
            raise Refused("adresse locale ou privée : le serveur ne la lit pas")
    return ips[0]


class _Http(http.client.HTTPConnection):
    def __init__(self, host, ip, port, timeout):
        super().__init__(host, port, timeout=timeout)
        self._ip = ip

    def connect(self):
        self.sock = socket.create_connection((self._ip, self.port), self.timeout)


class _Https(http.client.HTTPSConnection):
    def __init__(self, host, ip, port, timeout):
        super().__init__(host, port, timeout=timeout, context=ssl.create_default_context())
        self._ip = ip

    def connect(self):
        sock = socket.create_connection((self._ip, self.port), self.timeout)
        self.sock = self._context.wrap_socket(sock, server_hostname=self.host)


def _read(resp, sock, limit: int, end: float) -> tuple[bytes, bool]:
    """Le corps, `limit` octets au plus (décompressé), avant `end` ; (octets, tronqué).
    Chaque lecture attend au plus ce qui reste jusqu'à `end` (la socket le porte)."""
    enc = (resp.getheader("Content-Encoding") or "").strip().lower()
    dec = zlib.decompressobj(16 + zlib.MAX_WBITS) if enc == "gzip" else zlib.decompressobj() if enc == "deflate" else None
    out = bytearray()
    while len(out) < limit:
        left = end - time.monotonic()
        if left <= 0:
            return bytes(out), True
        if sock is not None:
            sock.settimeout(min(4.0, left))
        chunk = resp.read1(16384)
        if not chunk:
            return bytes(out), False
        if dec:
            chunk = dec.decompress(chunk, limit - len(out) + 1)
        out += chunk
    return bytes(out[:limit]), True


def fetch(url: str, *, accept: str, limit: int, end: float) -> dict:
    """GET borné, sans jamais joindre une adresse privée ; les redirections rejugées.
    Rend {status, url (la dernière), headers (minuscules → liste), body, truncated}."""
    hops = 0
    while True:
        p = parse(url)
        if not p["ok"]:
            raise Refused(p["why"])
        sp = urlsplit(p["url"])
        scheme = sp.scheme.lower()
        port = sp.port or (443 if scheme == "https" else 80)
        if port not in PORTS:
            raise Refused(f"port {port} : l'aperçu ne lit que les ports 80 et 443")
        left = end - time.monotonic()
        if left <= 0:
            raise Refused("trop long : plus de %d s" % DEADLINE)
        ip = _resolve(sp.hostname or "", port)
        C = _Https if scheme == "https" else _Http
        conn = C(sp.hostname, ip, port, timeout=min(4.0, left))
        try:
            path = (sp.path or "/") + (f"?{sp.query}" if sp.query else "")
            conn.request("GET", path, headers={"User-Agent": UA, "Accept": accept, "Accept-Language": "fr,en;q=0.8",
                                               "Accept-Encoding": "gzip, deflate"})
            resp = conn.getresponse()
            if resp.status in (301, 302, 303, 307, 308) and resp.getheader("Location"):
                hops += 1
                if hops > MAX_HOPS:
                    raise Refused(f"plus de {MAX_HOPS} redirections")
                url = urljoin(p["url"], resp.getheader("Location"))
                continue
            body, cut = _read(resp, conn.sock, limit, end)
            headers: dict[str, list[str]] = {}
            for k, v in resp.getheaders():
                headers.setdefault(k.lower(), []).append(v)
            return {"status": resp.status, "url": p["url"], "headers": headers, "body": body, "truncated": cut}
        except (socket.timeout, TimeoutError) as e:
            raise Refused("trop long : le site ne répond pas à temps") from e
        except ssl.SSLError as e:
            raise Refused(f"connexion chiffrée refusée ({e.reason or e})") from e
        except (OSError, http.client.HTTPException) as e:
            raise Refused(f"le site ne répond pas ({type(e).__name__})") from e
        finally:
            conn.close()


# ── se laisse-t-il mettre dans un cadre ? ────────────────────
def frame_policy(headers: dict) -> tuple[bool, str]:
    """(autorisé, pourquoi) d'après les en-têtes de la réponse (noms en minuscules → listes).
    CSP `frame-ancestors`, s'il est là, décide seul (X-Frame-Options est alors ignoré) ;
    sinon X-Frame-Options : DENY / SAMEORIGIN refusent (le portail n'est pas le même
    site), plusieurs valeurs contradictoires refusent, une valeur inconnue est ignorée."""
    fa = None
    for pol in headers.get("content-security-policy", []):
        for d in pol.split(";"):
            parts = d.strip().split()
            if parts and parts[0].lower() == "frame-ancestors":
                srcs = [s.lower() for s in parts[1:]]
                fa = srcs if fa is None else [s for s in fa if s in srcs]   # plusieurs politiques : toutes s'appliquent
    if fa is not None:
        if "*" in fa:
            return True, ""
        return False, "ce site n’accepte d’être intégré que chez lui (Content-Security-Policy : frame-ancestors " + (" ".join(fa) or "'none'") + ")"
    vals = {v.strip().lower() for h in headers.get("x-frame-options", []) for v in h.split(",") if v.strip()}
    if not vals or vals == {"allowall"}:
        return True, ""
    if len(vals) > 1:
        return False, "ce site refuse d’être intégré (X-Frame-Options : " + ", ".join(sorted(vals)).upper() + ")"
    v = next(iter(vals))
    if v in ("deny", "sameorigin"):
        return False, f"ce site refuse d’être intégré (X-Frame-Options : {v.upper()})"
    return True, ""


# ── ce que dit la page ───────────────────────────────────────
class _Head(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.meta: dict[str, str] = {}
        self.title = ""
        self._in_title = False
        self.done = False

    def handle_starttag(self, tag, attrs):
        if self.done:
            return
        a = {k.lower(): (v or "") for k, v in attrs}
        if tag == "meta":
            k = (a.get("property") or a.get("name") or "").strip().lower()
            if k and "content" in a and k not in self.meta:
                self.meta[k] = a["content"]
        elif tag == "title":
            self._in_title = True
        elif tag == "body":
            self.done = True

    def handle_endtag(self, tag):
        if tag == "title":
            self._in_title = False
        elif tag == "head":
            self.done = True

    def handle_data(self, data):
        if self._in_title and not self.done and len(self.title) < 600:
            self.title += data


def _charset(ctype: str, body: bytes) -> str:
    m = re.search(r"charset=([\w.\-]+)", ctype or "", re.I) or re.search(rb"<meta[^>]+charset=[\"']?([\w.\-]+)", body[:4096], re.I)
    cs = (m.group(1).decode() if isinstance(m.group(1), bytes) else m.group(1)) if m else "utf-8"
    try:
        "".encode(cs)
        return cs
    except LookupError:
        return "utf-8"


def read_head(body: bytes, ctype: str, base: str) -> dict:
    """Titre, description, site, image (adresse absolue) d'une page HTML."""
    h = _Head()
    try:
        h.feed(body.decode(_charset(ctype, body), errors="replace"))
    except Exception:  # une page mal formée : on garde ce qu'on a lu
        pass
    m = h.meta
    img = m.get("og:image:secure_url") or m.get("og:image") or m.get("og:image:url") or m.get("twitter:image") or m.get("twitter:image:src") or ""
    img = urljoin(base, html.unescape(img.strip())) if img.strip() else ""
    return {"title": _line(m.get("og:title") or m.get("twitter:title") or h.title, 300),
            "desc": _line(m.get("og:description") or m.get("twitter:description") or m.get("description"), 600),
            "site": _line(m.get("og:site_name"), 120),
            "image": img if re.match(r"^https?://", img, re.I) else ""}


def _store_image(url: str, end: float) -> str:
    """L'image d'une carte : relue, réduite, rangée en WebP ; son empreinte, ou « »."""
    if not url:
        return ""
    try:
        r = fetch(url, accept="image/webp,image/png,image/jpeg,image/gif;q=0.8", limit=MAX_IMG, end=end)
    except Refused:
        return ""
    if r["status"] != 200 or r["truncated"]:
        return ""
    from PIL import Image
    try:
        im = Image.open(BytesIO(r["body"]), formats=("PNG", "JPEG", "WEBP", "GIF"))
        if im.width * im.height > MAX_PIXELS:
            return ""
        im.seek(0)
        im = im.convert("RGBA" if ("A" in im.getbands() or "transparency" in im.info) else "RGB")
        im.thumbnail((IMG_SIDE, IMG_SIDE))
        out = BytesIO()
        im.save(out, "WEBP", quality=80)
    except Exception:
        return ""
    data = out.getvalue()
    key = hashlib.sha256(data).hexdigest()[:24]
    d = _img_dir()
    f = d / f"{key}.webp"
    if not f.exists():
        tmp = f.with_suffix(".tmp")
        tmp.write_bytes(data)
        tmp.replace(f)
    return key


def _img_dir() -> Path:
    d = config.data_dir() / "ideation_web"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _oembed(p: dict, end: float) -> dict:
    watch = f"https://www.youtube.com/watch?v={p['id']}" if p["kind"] == "youtube" else p["url"]
    api = ("https://www.youtube.com/oembed?format=json&url=" if p["kind"] == "youtube"
           else "https://vimeo.com/api/oembed.json?url=") + quote(watch, safe="")
    site = "YouTube" if p["kind"] == "youtube" else "Vimeo"
    why = ""
    try:
        r = fetch(api, accept="application/json", limit=MAX_JSON, end=end)
        d = json.loads(r["body"].decode("utf-8", "replace")) if r["status"] == 200 and not r["truncated"] else {}
        if r["status"] != 200:
            why = f"{site} ne décrit pas cette vidéo (réponse {r['status']}) : privée, retirée, ou l’adresse est fausse"
    except (Refused, ValueError) as e:
        d, why = {}, f"{site} ne répond pas ({e})"
    d = d if isinstance(d, dict) else {}
    thumb = str(d.get("thumbnail_url") or "")
    return {"title": _line(d.get("title"), 300), "desc": _line(d.get("author_name"), 600), "why": why,
            "site": site, "image": thumb if re.match(r"^https://", thumb) else ""}


_cache: dict[str, tuple[float, dict]] = {}
_cache_lock = threading.Lock()
_hits: dict[str, list[float]] = {}


def apercu(url: str, *, deadline: float = DEADLINE) -> dict:
    """L'aperçu d'une adresse (voir l'en-tête du module). Ne lève que pour une adresse
    refusée d'emblée (`ok` faux dans `parse`) ; le reste se dit dans `why`."""
    p = parse(url)
    if not p["ok"]:
        raise HttpError(400, p["why"])
    now = time.time()
    with _cache_lock:
        c = _cache.get(p["url"])
        if c and now - c[0] < TTL:
            return dict(c[1])
    end = time.monotonic() + deadline
    out = {**p, "title": "", "desc": "", "site": "", "img": "", "frame": False, "fetched": time.strftime("%Y-%m-%dT%H:%M:%S")}
    if p["kind"] in ("youtube", "vimeo"):
        got = _oembed(p, end)
        out.update(title=got["title"], desc=got["desc"], site=got["site"], frame=True, why=got["why"])
        out["img"] = _store_image(got["image"], end)
    else:
        try:
            r = fetch(p["url"], accept="text/html,application/xhtml+xml;q=0.9,*/*;q=0.5", limit=MAX_PAGE, end=end)
        except Refused as e:
            out.update(why=str(e), site=p["host"])
            return out            # pas gardé : une adresse qui ne répond pas peut répondre plus tard
        ctype = (r["headers"].get("content-type") or [""])[0]
        is_html = bool(re.match(r"\s*(text/html|application/xhtml\+xml)", ctype, re.I))
        head = read_head(r["body"], ctype, r["url"]) if is_html else {"title": "", "desc": "", "site": "", "image": ""}
        framed, why = frame_policy(r["headers"])
        if r["status"] >= 400:
            framed, why = False, f"le site répond {r['status']}"
        elif not is_html:
            framed, why = False, f"ce n’est pas une page ({ctype.split(';')[0] or 'type inconnu'}) : un lien"
        elif not r["url"].lower().startswith("https://"):
            framed, why = False, "une page en http:// ne s’intègre pas (le portail est servi en https derrière la porte : contenu mixte)"
        out.update(title=head["title"], desc=head["desc"], site=head["site"] or p["host"], frame=framed, why=why,
                   final=r["url"])
        out["img"] = _store_image(head["image"], end)
    with _cache_lock:
        if len(_cache) > 256:
            _cache.clear()
        _cache[p["url"]] = (now, dict(out))
    return out


# ── les routes ───────────────────────────────────────────────
def _limit(u: dict | None) -> None:
    who = (u or {}).get("id") or "cal"
    now = time.time()
    with _cache_lock:
        L = [t for t in _hits.get(who, []) if now - t < 60]
        if len(L) >= RATE:
            raise HttpError(429, f"{RATE} aperçus par minute au plus : réessayez dans un instant")
        L.append(now)
        _hits[who] = L


def r_apercu(req):
    d = req.json()
    u = getattr(req, "user", None) or auth.current()
    if auth.is_guest(u):
        # l'invité : seulement pour une planche où son lien le fait éditeur
        from tools import ideation_collab
        bid = str(d.get("board") or "")
        if not bid or ideation_collab.role_of(u, bid) not in ("owner", "editor"):
            raise HttpError(403, "invité : l’aperçu d’une adresse se demande depuis une planche où tu es éditeur")
    _limit(u)
    return apercu(d.get("url"))


def r_img(req, key):
    if not KEY.fullmatch(key or ""):
        raise HttpError(400, "empreinte illisible")
    f = _img_dir() / f"{key}.webp"
    if not f.is_file():
        raise HttpError(404, "image introuvable")
    # l'empreinte est celle du contenu : il ne change jamais sous son adresse
    return FileResponse(f, "image/webp", cache="private, max-age=31536000, immutable")


def register(app) -> None:
    app.route("POST", "/api/ideation/web/apercu", r_apercu)
    app.route("GET", "/api/ideation/web/img/{key}", r_img)
    auth.guest_realm("ideation_web", routes=[("POST", r"/api/ideation/web/apercu", None),
                                             ("GET", r"/api/ideation/web/img/(?P<key>[0-9a-f]{24})", None)])


# ── le contrôle (tools/check.py) ─────────────────────────────
# les cas que web_url.js doit trancher comme parse() : [adresse, ok, sorte, id, embed]
CASES = [
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", True, "youtube", "dQw4w9WgXcQ", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ?t=1m30s", True, "youtube", "dQw4w9WgXcQ", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=90"],
    ["youtube.com/watch?v=dQw4w9WgXcQ&t=42", True, "youtube", "dQw4w9WgXcQ", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=42"],
    ["https://m.youtube.com/shorts/abcdefghijk", True, "youtube", "abcdefghijk", "https://www.youtube-nocookie.com/embed/abcdefghijk"],
    ["https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=5", True, "youtube", "dQw4w9WgXcQ", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=5"],
    ["https://www.youtube.com/watch?v=trop-court", True, "site", "", ""],
    ["https://vimeo.com/76979871", True, "vimeo", "76979871", "https://player.vimeo.com/video/76979871?dnt=1"],
    ["https://vimeo.com/76979871/abc123def0", True, "vimeo", "76979871", "https://player.vimeo.com/video/76979871?dnt=1&h=abc123def0"],
    ["https://player.vimeo.com/video/76979871?h=0f1e2d3c4b", True, "vimeo", "76979871", "https://player.vimeo.com/video/76979871?dnt=1&h=0f1e2d3c4b"],
    ["https://vimeo.com/channels/staffpicks/76979871", True, "vimeo", "76979871", "https://player.vimeo.com/video/76979871?dnt=1"],
    ["https://miro.com/app/board/uXjVL=/", True, "site", "", ""],
    ["http://example.org", True, "site", "", ""],
    ["javascript:alert(1)", False, "", "", ""],
    ["JavaScript:alert(1)", False, "", "", ""],
    ["data:text/html,<b>x</b>", False, "", "", ""],
    ["file:///etc/passwd", False, "", "", ""],
    ["ftp://example.org/x", False, "", "", ""],
    ["https://cal:secret@example.org/", False, "", "", ""],
    ["https://exa mple.org/", False, "", "", ""],
    ["", False, "", "", ""],
    ["https://" + "a" * 2100 + ".org", False, "", "", ""],
]

_NODE_JS = r"""
const { parseWeb } = await import(process.env.WEB_URL);
let s = ''; for await (const c of process.stdin) s += c;
const out = JSON.parse(s).map((c) => { const p = parseWeb(c[0]); return [c[0], p.ok, p.kind, p.id, p.embed]; });
console.log(JSON.stringify(out));
"""


def _serve(handler_fn):
    """Un petit serveur d'essai local, sur un port libre ; rend (port, arrêter)."""
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_GET(self):
            handler_fn(self)

    srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv.server_address[1], srv.shutdown


def selftest(call, ok) -> None:
    import os
    import shutil
    import subprocess
    from core import config as cfg
    repo = Path(__file__).resolve().parents[2]
    # 1. l'adresse : ce qui passe, ce qui est refusé, YouTube et Vimeo reconnus
    bad = [c for c in CASES if [c[0], *[parse(c[0])[k] for k in ("ok", "kind", "id", "embed")]] != c]
    ok(not bad, f"web : parse() tranche les {len(CASES)} cas comme prévu ({bad[:2]})")
    # 2. la page tranche pareil (ideation/objets/web_url.js, par node)
    node = shutil.which("node")
    if node:
        env = {**os.environ, "WEB_URL": (repo / "ideation" / "objets" / "web_url.js").as_uri()}
        r = subprocess.run([node, "--input-type=module", "-e", _NODE_JS], input=json.dumps(CASES), capture_output=True, text=True, timeout=60, env=env)
        try:
            got = json.loads(r.stdout.strip().splitlines()[-1])
        except (ValueError, IndexError):
            got = None
        diff = [g for g, c in zip(got or [], CASES) if g != c]
        ok(got is not None and not diff, f"web : web_url.js tranche comme le serveur ({diff[:2] or r.stderr[-300:]})")
    else:
        ok(True, "web : node absent, web_url.js n'est pas comparé ici")
    # 3. la route : une adresse qui n'est pas http(s) → 400
    for u in ("javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "ftp://example.org/"):
        st, res = call("POST", "/api/ideation/web/apercu", {"url": u})
        ok(st == 400, f"web : « {u} » refusée ({st} {res})")
    # 4. SSRF : aucune connexion vers le dedans. Un serveur local écoute et compte ses visites.
    seen = []

    def spy(h):
        seen.append(h.path)
        h.send_response(200)
        h.send_header("Content-Type", "text/html")
        h.end_headers()
        h.wfile.write(b"<title>dedans</title>")

    port, stop = _serve(spy)
    inside = [f"http://127.0.0.1:{port}/", f"http://localhost:{port}/", "http://127.0.0.1/", "http://localhost/",
              "http://[::1]/", "http://0.0.0.0/", "http://10.0.0.1/", "http://192.168.10.247:8790/", "http://172.16.0.1/",
              "http://169.254.169.254/latest/meta-data/", "http://100.108.108.65/", "http://[::ffff:127.0.0.1]/",
              "http://2130706433/", "http://0x7f000001/", "http://[fd00::1]/", "http://[64:ff9b::7f00:1]/"]
    for u in inside:
        st, res = call("POST", "/api/ideation/web/apercu", {"url": u})
        ok(st == 200 and not res.get("title") and not res.get("frame") and res.get("why"),
           f"web : pas de requête vers « {u} » ({st} {res.get('why') if isinstance(res, dict) else res})")
    ok(not seen, f"web : le serveur local n'a reçu aucune visite ({seen})")
    # une page « publique » (autorisée pour l'essai) qui redirige vers le dedans : refusée au 2e pas
    def redirect(h):
        h.send_response(302)
        h.send_header("Location", f"http://127.0.0.1:{port}/cache")
        h.end_headers()

    rport, rstop = _serve(redirect)
    _ALLOW_TEST.add(("127.0.0.1", rport))
    try:
        fetch(f"http://127.0.0.1:{rport}/", accept="*/*", limit=1000, end=time.monotonic() + 3)
        ok(False, "web : une redirection vers le dedans aurait dû être refusée")
    except Refused as e:
        ok("port" in str(e) or "privée" in str(e), f"web : la redirection vers le dedans est refusée ({e})")
    ok(not seen, "web : …et le dedans n'a toujours reçu personne")
    # 5. les bornes : 5 Mo de page → 512 Ko lus ; une page qui traîne → rendu dans le temps
    def huge(h):
        h.send_response(200)
        h.send_header("Content-Type", "text/html")
        h.end_headers()
        try:
            h.wfile.write(b"<html><head><title>gros</title></head><body>" + b"x" * (5 << 20))
        except OSError:
            pass

    def slow(h):
        time.sleep(6)
        try:
            h.send_response(200)
            h.end_headers()
        except OSError:
            pass

    hport, hstop = _serve(huge)
    sport, sstop = _serve(slow)
    _ALLOW_TEST.update({("127.0.0.1", hport), ("127.0.0.1", sport)})
    global PORTS
    old_ports, PORTS = PORTS, (*PORTS, rport, hport, sport)
    try:
        t0 = time.monotonic()
        r = fetch(f"http://127.0.0.1:{hport}/", accept="text/html", limit=MAX_PAGE, end=time.monotonic() + DEADLINE)
        ok(len(r["body"]) == MAX_PAGE and r["truncated"], f"web : une page de 5 Mo est lue sur {MAX_PAGE // 1024} Ko ({len(r['body'])} octets, {time.monotonic() - t0:.2f} s)")
        t0 = time.monotonic()
        try:
            fetch(f"http://127.0.0.1:{sport}/", accept="text/html", limit=MAX_PAGE, end=time.monotonic() + 1.5)
            ok(False, "web : une page qui traîne aurait dû être abandonnée")
        except Refused as e:
            dt = time.monotonic() - t0
            ok(dt < 2.5, f"web : une page qui traîne est abandonnée à l'échéance ({dt:.2f} s pour 1,5 s ; {e})")
        ok(DEADLINE <= 8 and MAX_PAGE <= 512 << 10 and MAX_IMG <= 4 << 20, "web : les bornes du module (8 s, 512 Ko, 4 Mo)")
    finally:
        PORTS = old_ports
        _ALLOW_TEST.clear()
        for f in (stop, rstop, hstop, sstop):
            f()
    ok(PORTS == (80, 443), "web : seuls les ports 80 et 443 hors essai")
    # 6. le cadre : X-Frame-Options, CSP frame-ancestors (qui l'emporte)
    FP = [({}, True), ({"x-frame-options": ["DENY"]}, False), ({"x-frame-options": ["SAMEORIGIN"]}, False),
          ({"x-frame-options": ["ALLOW-FROM https://a.b"]}, True), ({"x-frame-options": ["deny, sameorigin"]}, False),
          ({"content-security-policy": ["default-src 'self'; frame-ancestors 'none'"]}, False),
          ({"content-security-policy": ["frame-ancestors 'self' https://x.org"]}, False),
          ({"content-security-policy": ["frame-ancestors *"], "x-frame-options": ["DENY"]}, True),
          ({"content-security-policy": ["script-src 'self'"], "x-frame-options": ["SAMEORIGIN"]}, False),
          ({"content-security-policy": ["frame-ancestors *", "frame-ancestors 'self'"]}, False)]
    badf = [h for h, want in FP if frame_policy(h)[0] != want]
    ok(not badf, f"web : X-Frame-Options et frame-ancestors lus comme la spécification ({badf})")
    # 7. Open Graph : balises, entités, adresse relative, repli sur <title>
    page = (b"<html><head><meta charset='utf-8'><title>Repli</title><meta property='og:title' content='L&#39;affiche &amp; le film'>"
            b"<meta property=\"og:image\" content=\"/img/a.jpg\"><meta name='description' content='  deux   espaces '></head>"
            b"<body><meta property='og:title' content='dans le corps : ignor\xc3\xa9'></body></html>")
    hd = read_head(page, "text/html", "https://ex.org/films/")
    ok(hd == {"title": "L'affiche & le film", "desc": "deux espaces", "site": "", "image": "https://ex.org/img/a.jpg"},
       f"web : Open Graph lu (titre, description, image absolue) ({hd})")
    hd = read_head("<title>Café</title>".encode("latin-1"), "text/html; charset=iso-8859-1", "https://ex.org/")
    ok(hd["title"] == "Café", f"web : le jeu de caractères de la réponse est suivi ({hd['title']})")
    # 8. l'objet sur la planche : adresse validée, champs bornés, image par empreinte seulement
    from tools import ideation
    b = ideation.blank("Essai web")
    ideation._write(b)
    good = {"id": "w1", "type": "web", "x": 0, "y": 0, "w": 360, "h": 240, "url": "https://youtu.be/dQw4w9WgXcQ",
            "title": "t" * 900, "img": "../../etc/passwd", "embed": "javascript:alert(1)", "frame": 1}
    st, sv = call("POST", f"/api/ideation/boards/{b['id']}", {"name": b["name"], "v": ideation.VERSION, "nodes": [good], "links": [], "base_rev": 1})
    st2, got = call("GET", f"/api/ideation/boards/{b['id']}")
    w = next((n for n in (got or {}).get("nodes", []) if n["id"] == "w1"), {})
    ok(st == 200 and len(w.get("title", "")) == 300 and w.get("img") == "" and "embed" not in w and w.get("frame") is True,
       f"web : l'objet s'enregistre, borné ; ni image hors empreinte, ni adresse d'intégration gardée ({st} {w})")
    for u in ("javascript:alert(1)", "data:text/html,x"):
        st, res = call("POST", f"/api/ideation/boards/{b['id']}", {"name": b["name"], "v": ideation.VERSION,
                                                                   "nodes": [{**good, "url": u}], "links": [], "base_rev": 2})
        ok(st == 400, f"web : un objet web « {u} » est refusé par la planche ({st} {res})")
    st, _ = call("GET", "/api/ideation/web/img/../../x")
    st2, _ = call("GET", "/api/ideation/web/img/0123456789abcdef01234567")
    ok(st in (400, 404) and st2 == 404, f"web : l'image se demande par son empreinte seulement ({st} {st2})")
    ok(isinstance(cfg.data_dir(), Path), "web : les images rangées hors du dépôt (data_dir)")
