"""Character Factory dans le portail : le relais vers son studio.

Le front du studio (casting, fiche, étapes, coulisses, viewer, console
Identité) vit désormais dans `character/` (décision du 29/09, voir
`character/PROVENANCE.md`). Le studio Python, lui, reste dans le dépôt
Character_Factory et tourne sur DGX1 (:8765) ; le portail le joint par
le câble direct (réglage `cf_api`, 169.254.110.6:8765). Trois préfixes,
pas un de plus :

    /character/api/*    → <cf_api>/api/*     personnages, actions, file, dépôts d'images
    /character/files/*  → <cf_api>/files/*   les fichiers d'un personnage (images, sons, GLB)
    /character/v1/*     → <cf_api>/v1/*      le relais du modèle de texte (étage Identité, Scène)

Toutes méthodes. Le corps d'une requête (une image déposée) et celui de
la réponse (un GLB, une réponse longue ou en SSE) passent par morceaux,
sans être gardés en mémoire ; les requêtes partielles (Range) suivent
telles quelles. Un chemin qui sortirait de son préfixe (`..`) est refusé
avant de partir. Si DGX1 ne répond pas, la page reçoit un 502 qui le
dit, dans la forme d'erreur du studio : {"error": {"message": …}}.
"""

from __future__ import annotations

import http.client
import json
import urllib.parse

from core import config
from core.http import Response, StreamResponse

PREFIXES = ("api", "files", "v1")
# ce que les pages du studio envoient et que le studio lit ; rien d'autre ne part
REQ_HEADERS = ("Content-Type", "Accept", "Accept-Language", "Range", "If-Range", "If-None-Match",
               "If-Modified-Since", "Cache-Control", "X-Filename", "Last-Event-ID")
# en-têtes de saut (RFC 9110 §7.6.1), et ceux que le portail pose lui-même
HOP = {"connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "proxy-connection", "te",
       "trailer", "transfer-encoding", "upgrade", "content-length", "server", "date"}
MAX_BODY = 2 << 30   # comme le socle
CONNECT_S = 5        # DGX1 par le câble : il répond tout de suite, ou pas du tout
READ_S = 960         # le studio attend jusqu'à 900 s le modèle de texte (factory/studio.py, _llm)


def _error(status: int, message: str) -> Response:
    return Response(json.dumps({"error": {"message": message}}, ensure_ascii=False), status,
                    "application/json; charset=utf-8", {"Cache-Control": "no-store"})


def _safe(rest: str) -> bool:
    """Le reste du chemin reste sous son préfixe : ni `.` ni `..` comme
    segment, ni antislash, ni caractère nul — jugé décodé une fois, comme
    le studio le décode (factory/studio.py, _dispatch)."""
    plain = urllib.parse.unquote(rest)
    if "\\" in plain or "\x00" in plain:
        return False
    return not any(seg in (".", "..") for seg in plain.split("/"))


def relay(req, kind: str, rest: str):
    """Une requête de la page vers le studio de DGX1, et sa réponse en retour."""
    if not _safe(rest):
        return _error(400, f"chemin refusé : il sortirait de /{kind}/")
    if req.headers.get("Transfer-Encoding"):
        return _error(411, "un envoi sans taille (Content-Length) n'est pas relayé")
    try:
        n = int(req.headers.get("Content-Length") or 0)
    except ValueError:
        return _error(400, "Content-Length illisible")
    if n < 0 or n > MAX_BODY:
        return _error(413, "fichier trop gros (2 Go au plus)")
    up = urllib.parse.urlsplit(config.get("cf_api"))
    query = urllib.parse.urlsplit(req._h.path).query
    target = f"/{kind}/{rest}" + (f"?{query}" if query else "")
    conn = http.client.HTTPConnection(up.hostname, up.port or 80, timeout=CONNECT_S)
    try:
        conn.connect()
    except OSError as e:
        conn.close()
        return _error(502, f"le studio Character Factory ne répond pas (DGX1, {config.get('cf_api')}) : {e}")
    left, rfile = n, req._h.rfile
    try:
        conn.sock.settimeout(READ_S)
        conn.putrequest(req.method, target)
        for h in REQ_HEADERS:
            v = req.headers.get(h)
            if v:
                conn.putheader(h, v)
        if n or req.method in ("POST", "PUT", "PATCH"):
            conn.putheader("Content-Length", str(n))
        conn.endheaders()
        # le corps passe par morceaux : une image de 40 Mo ne tient jamais en mémoire
        while left > 0:
            buf = rfile.read(min(1 << 20, left))
            if not buf:
                break
            conn.send(buf)
            left -= len(buf)
        req._body = b""
        if left:
            conn.close()
            req._h.close_connection = True
            return _error(400, "l'envoi s'est interrompu avant la fin")
        r = conn.getresponse()
    except (OSError, http.client.HTTPException) as e:
        conn.close()
        if left:
            # un reste de corps non lu : la connexion ne peut plus servir
            req._body = b""
            req._h.close_connection = True
        return _error(502, f"le studio Character Factory a coupé la réponse (DGX1, {config.get('cf_api')}) : {e}")
    headers = [(k, v) for k, v in r.getheaders() if k.lower() not in HOP]
    length = None
    if not r.chunked and r.getheader("Content-Length") is not None:
        try:
            length = int(r.getheader("Content-Length"))
        except ValueError:
            length = None

    def chunks():
        # read1 rend ce qui est arrivé, sans attendre d'en avoir plus :
        # une réponse en SSE passe événement par événement
        while True:
            buf = r.read1(1 << 16)
            if not buf:
                return
            yield buf

    return StreamResponse(r.status, headers, chunks(), length, close=conn.close)


def register(app) -> None:
    for kind in PREFIXES:
        app.prefix(f"/character/{kind}/", lambda req, rest, kind=kind: relay(req, kind, rest))


# ── le contrôle, sans DGX1 : un faux studio local ───────────
def selftest(call, ok) -> None:
    import os
    import socket
    import threading
    import urllib.request
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

    # les pages du studio se servent sous /character/
    for page in ("/character/", "/character/coulisses.html", "/character/viewer.html", "/character/console.html",
                 "/character/js/studio.js", "/character/js/cf.js", "/character/assets/studio.css",
                 "/character/data/methodology.md"):
        st, _ = call("GET", page)
        ok(st == 200, f"{page} se sert ({st})")

    seen: list[tuple[str, str]] = []
    release = threading.Event()
    blob = os.urandom(300_000)

    class Faux(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *a):
            pass

        def _json(self, doc, code=200):
            b = json.dumps(doc).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(b)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(b)

        def _file(self):
            start, end, code = 0, len(blob) - 1, 200
            rng = self.headers.get("Range", "")
            if rng.startswith("bytes="):
                a, _, b = rng[6:].partition("-")
                start, end, code = int(a), int(b) if b else len(blob) - 1, 206
            self.send_response(code)
            self.send_header("Content-Type", "model/gltf-binary")
            self.send_header("Content-Length", str(end - start + 1))
            self.send_header("Cache-Control", "max-age=31536000, immutable")
            if code == 206:
                self.send_header("Content-Range", f"bytes {start}-{end}/{len(blob)}")
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(blob[start:end + 1])

        def _flux(self):
            # une réponse en SSE : un premier événement, puis rien tant que le contrôle ne l'a pas reçu
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Transfer-Encoding", "chunked")
            self.end_headers()
            for i, ev in enumerate((b"data: un\n\n", b"data: deux\n\n")):
                if i:
                    release.wait(10)
                self.wfile.write(b"%x\r\n%b\r\n" % (len(ev), ev))
            self.wfile.write(b"0\r\n\r\n")

        def do_GET(self):
            seen.append((self.command, self.path))
            if self.path.startswith("/files/"):
                return self._file()
            if self.path == "/v1/flux":
                return self._flux()
            self._json({"chemin": self.path, "methode": self.command})

        do_HEAD = do_GET

        def _body(self):
            seen.append((self.command, self.path))
            n = int(self.headers.get("Content-Length") or 0)
            got, first = 0, b""
            while got < n:
                buf = self.rfile.read(min(1 << 16, n - got))
                if not buf:
                    break
                first = first or buf[:8]
                got += len(buf)
            self._json({"chemin": self.path, "methode": self.command, "recu": got, "type": self.headers.get("Content-Type"),
                        "nom": self.headers.get("X-Filename"), "debut": first.hex()})

        do_POST = do_PUT = do_DELETE = _body

    srv = ThreadingHTTPServer(("127.0.0.1", 0), Faux)
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    before = config.CFG.get("cf_api")
    config.CFG["cf_api"] = f"http://127.0.0.1:{srv.server_address[1]}"
    base = f"http://127.0.0.1:{config.get('port')}"
    try:
        st, r = call("GET", "/character/api/characters?slug=mj-survet&limit=3")
        ok(st == 200 and r.get("chemin") == "/api/characters?slug=mj-survet&limit=3",
           f"relais GET : le chemin et la requête suivent ({st} {r})")
        corps = os.urandom(3 << 20)
        st, r = call("POST", "/character/api/uploads", raw=corps,
                     headers={"Content-Type": "image/png", "X-Filename": "visage%20n%C2%B01.png"})
        ok(st == 200 and r.get("recu") == len(corps) and r.get("debut") == corps[:8].hex()
           and r.get("type") == "image/png" and r.get("nom") == "visage%20n%C2%B01.png",
           f"relais POST : 3 Mo déposés passent par morceaux, avec leur type et leur nom ({st} {r and {k: r.get(k) for k in ('recu', 'type', 'nom')}})")
        st, r = call("PUT", "/character/api/characters/essai/identity", {"name": "Essai"})
        ok(st == 200 and r.get("methode") == "PUT" and r.get("recu") == len(json.dumps({"name": "Essai"})),
           f"relais PUT ({st} {r})")
        st, r = call("GET", "/character/files/essai/costumes/tenue-1/rig/v001/rigged.glb")
        ok(st == 200 and r == blob, f"relais d'un fichier entier ({st}, {len(r) if isinstance(r, bytes) else r})")
        st, r = call("GET", "/character/files/essai/costumes/tenue-1/rig/v001/rigged.glb", headers={"Range": "bytes=1000-1999"})
        ok(st == 206 and r == blob[1000:2000], f"relais d'une requête partielle (Range) : 206, le bon morceau ({st})")
        req = urllib.request.Request(base + "/character/files/essai/a.glb", method="HEAD")
        with urllib.request.urlopen(req, timeout=10) as h:
            ok(h.status == 200 and h.headers.get("Content-Length") == str(len(blob)) and h.read() == b""
               and h.headers.get("Cache-Control") == "max-age=31536000, immutable",
               f"relais HEAD : la taille et le cache suivent, sans corps ({h.status} {dict(h.headers)})")

        # le flux : le premier événement arrive pendant que le studio tient encore le second
        with urllib.request.urlopen(base + "/character/v1/flux", timeout=10) as f:
            first = f.readline()
            held = not release.is_set()
            release.set()
            rest = f.read()
        ok(first == b"data: un\n" and held and b"data: deux" in rest,
           f"relais en flux (SSE) : le premier événement passe avant la fin de la réponse ({first!r}, tenu : {held})")

        # hors des trois préfixes, ou hors de son préfixe : rien ne part vers le studio
        n_seen = len(seen)
        for bad, want in (("/character/api/..%2F..%2Fstudio.html", 400), ("/character/files/%2e%2e/factory.local.json", 400),
                          ("/character/files/essai/..%5C..%5Cx", 400), ("/character/apix/characters", 404),
                          ("/character/data/../api/characters", 404)):
            st, _ = call("GET", bad)
            ok(st == want, f"refusé : {bad} ({st}, attendu {want})")
        st, _ = call("POST", "/character/index.html", {"x": 1})
        ok(st == 405, f"une page du studio est en lecture seule : seuls les trois préfixes écrivent ({st})")
        ok(len(seen) == n_seen, f"aucune requête refusée n'a atteint le studio ({seen[n_seen:]})")
    finally:
        srv.shutdown()
        srv.server_close()

    # DGX1 muet : un 502 qui le dit, dans la forme d'erreur du studio
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        dead = s.getsockname()[1]
    config.CFG["cf_api"] = f"http://127.0.0.1:{dead}"
    try:
        st, r = call("GET", "/character/api/characters")
        ok(st == 502 and "ne répond pas" in ((r or {}).get("error") or {}).get("message", ""),
           f"studio muet : 502 et la raison ({st} {r})")
        st, r = call("POST", "/character/api/uploads", raw=b"x" * 1000, headers={"Content-Type": "image/png"})
        ok(st == 502, f"studio muet, un dépôt : 502, et le portail reste debout ({st})")
        st, _ = call("GET", "/api/library")
        ok(st == 200, f"le portail répond encore après ({st})")
    finally:
        config.CFG["cf_api"] = before
