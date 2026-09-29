"""Le serveur HTTP du portail : un routeur, les fichiers statiques du
dépôt et ceux de la bibliothèque, rien d'autre que la bibliothèque
standard (aucune roue à compiler en aarch64).

Un outil s'enregistre par `app.route(méthode, motif, fonction)` ; le
motif prend des segments `{nom}`, passés à la fonction en arguments
nommés. La fonction rend un objet (envoyé en JSON), un `Response`, ou
lève `HttpError`.

Les fichiers statiques sont jugés une fois résolus : un chemin qui sort
de son dossier (`..`, lien) est refusé — la faille corrigée le 28/09 dans
le studio de Character Factory (commit 01aea49) ne doit pas renaître ici.
Les vidéos se lisent avec les requêtes partielles (Range) : sans elles,
le navigateur ne peut ni lire en continu ni sauter dans une vidéo.

Un relais (le studio de Character Factory, sur DGX1) prend un préfixe
entier par `app.prefix(préfixe, fonction)`, toutes méthodes, et rend un
`StreamResponse` : le corps passe par morceaux, au fil de l'eau, sans
être gardé en mémoire (un GLB de 100 Mo, une réponse longue en SSE).

La porte (core/auth.py) se pose par `app.gate(req, app)`, appelée avant
chaque requête, et `app.after(req, statut)`, après : le socle juge qui
entre, les outils n'ont rien à changer. Un dossier monté peut porter son
propre juge (`mount(…, check=)`) : un fichier qu'on n'a pas le droit de
lire répond 404. Un `PermissionError` levé par un outil répond 403.

Le cache (docs/etudes/ideation_fluidite.md, § 4.1) : chaque fichier servi
porte un validateur (`ETag`, sa taille et sa date au nanoseconde) et
répond 304, sans corps, à un `If-None-Match` qui le reconnaît ; il reste
en `no-cache` (le navigateur redemande, le serveur dit « pas changé »).
Un dossier monté choisit sa politique fichier par fichier
(`mount(…, cache=fonction(chemin, req))`) : la bibliothèque garde un an
ses copies d'affichage, dont l'adresse change avec elles.
`app.on_start(fonction)` : appelée une fois, quand le serveur écoute
(après le démarrage de la file) — le rattrapage des copies s'y lance.
"""

from __future__ import annotations

import json
import mimetypes
import re
import sys
import threading
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/javascript", ".mjs")
mimetypes.add_type("font/otf", ".otf")
mimetypes.add_type("font/ttf", ".ttf")
mimetypes.add_type("model/gltf-binary", ".glb")
mimetypes.add_type("image/webp", ".webp")
mimetypes.add_type("audio/flac", ".flac")

MAX_BODY = 2 << 30  # 2 Go : une vidéo déposée dans la bibliothèque
# un corps JSON est lu en mémoire : 32 Mo au plus (le plus gros que les outils
# acceptent est de 8 Mo : un lot d'Idéation, ideation_collab.OPS_BYTES)
MAX_JSON = 32 << 20


class HttpError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


class Response:
    def __init__(self, body: bytes | str = b"", status: int = 200, ctype: str = "application/octet-stream",
                 headers: dict | None = None) -> None:
        self.body = body.encode("utf-8") if isinstance(body, str) else body
        self.status = status
        self.ctype = ctype
        self.headers = headers or {}


class FileResponse:
    """Un fichier sur disque, servi avec les requêtes partielles."""

    def __init__(self, path: Path, ctype: str | None = None, cache: str = "no-cache") -> None:
        self.path = path
        self.ctype = ctype or mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        self.cache = cache


class StreamResponse:
    """Une réponse lue au fil de l'eau (un relais) : l'en-tête, puis le
    corps morceau par morceau. `chunks` est un itérable d'octets ;
    `length` la taille annoncée, ou None — le corps part alors en
    transfert par morceaux (HTTP/1.1 chunked), chaque morceau dès qu'il
    arrive. `close` libère la source, lue jusqu'au bout ou non."""

    def __init__(self, status: int, headers: list[tuple[str, str]], chunks, length: int | None = None,
                 close=None) -> None:
        self.status = status
        self.headers = headers
        self.chunks = chunks
        self.length = length
        self.close = close or (lambda: None)


class Request:
    def __init__(self, handler: BaseHTTPRequestHandler, method: str, path: str, query: dict) -> None:
        self._h = handler
        self.method = method
        self.path = path
        self.query = query
        self.headers = handler.headers
        self._body: bytes | None = None

    def q(self, name: str, default: str = "") -> str:
        v = self.query.get(name)
        return v[0] if v else default

    def _length(self) -> int:
        # une taille négative ferait lire read(-1) jusqu'à la fermeture (audit du 28/09, M2)
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError as e:
            raise HttpError(400, "Content-Length illisible") from e
        if n < 0:
            raise HttpError(400, "Content-Length négatif")
        if n > MAX_BODY:
            raise HttpError(413, "fichier trop gros (2 Go au plus)")
        return n

    def body(self) -> bytes:
        if self._body is None:
            n = self._length()
            self._body = self._h.rfile.read(n) if n else b""
        return self._body

    def stream_to(self, dest: Path, chunk: int = 1 << 20) -> int:
        """Écrit le corps dans un fichier sans le garder en mémoire."""
        n = self._length()
        left = n
        with open(dest, "wb") as f:
            while left > 0:
                buf = self._h.rfile.read(min(chunk, left))
                if not buf:
                    break
                f.write(buf)
                left -= len(buf)
        self._body = b""
        return n - left

    def discard(self, chunk: int = 1 << 20) -> None:
        """Le corps d'une requête refusée avant d'être lu : lu et jeté par
        morceaux (un dépôt de 2 Go refusé ne passe pas en mémoire), pour que
        la réponse arrive entière et que la connexion reste bonne."""
        left = self._length()
        while left > 0:
            buf = self._h.rfile.read(min(chunk, left))
            if not buf:
                break
            left -= len(buf)
        self._body = b""

    def json(self) -> dict:
        if self._body is None and self._length() > MAX_JSON:
            raise HttpError(413, f"corps trop gros ({MAX_JSON >> 20} Mo au plus)")
        raw = self.body()
        if not raw:
            return {}
        # un formulaire d'une autre page envoie du JSON déguisé en text/plain
        # sans demander la permission (audit du 28/09, H3) : refusé
        ctype = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        if ctype in ("text/plain", "application/x-www-form-urlencoded", "multipart/form-data"):
            raise HttpError(415, "corps JSON attendu (Content-Type: application/json)")
        try:
            data = json.loads(raw)
        except ValueError as e:
            raise HttpError(400, f"JSON illisible : {e}") from e
        if not isinstance(data, dict):
            raise HttpError(400, "un objet JSON est attendu")
        return data


class App:
    def __init__(self, root: Path) -> None:
        self.root = root.resolve()
        self.routes: list[tuple[str, re.Pattern, callable]] = []
        # préfixe d'URL → dossier servi (la bibliothèque, les rendus…)
        self.mounts: dict[str, Path] = {}
        # préfixe d'URL → fonction(req, reste) : un relais, toutes méthodes
        self.prefixes: list[tuple[str, callable]] = []
        # ce qui ne sort jamais du dépôt, même s'il est dans la racine
        self.hidden = re.compile(r"(^|/)(\.|server/|showrunner\.local\.json|node_modules/)")
        # la porte (core/auth.py) : gate(req, app) avant, after(req, statut) après
        self.gate = None
        self.after = None
        # préfixe monté → fonction(chemin dans le dossier) → bool : le droit de lire
        self.mount_checks: dict[str, callable] = {}
        # préfixe monté → fonction(chemin dans le dossier, req) → Cache-Control, ou None (no-cache)
        self.mount_cache: dict[str, callable] = {}
        # appelées une fois, quand le serveur écoute
        self.starters: list[callable] = []

    def route(self, method: str, pattern: str, fn) -> None:
        rx = "^" + re.sub(r"\{(\w+)\}", r"(?P<\1>[^/]+)", pattern.rstrip("/")) + "/?$"
        self.routes.append((method.upper(), re.compile(rx), fn))

    def mount(self, prefix: str, folder: Path, check=None, cache=None) -> None:
        self.mounts[prefix.strip("/") + "/"] = folder.resolve()
        if check:
            self.mount_checks[prefix.strip("/") + "/"] = check
        if cache:
            self.mount_cache[prefix.strip("/") + "/"] = cache

    def on_start(self, fn) -> None:
        self.starters.append(fn)

    def prefix(self, prefix: str, fn) -> None:
        """Confie tout ce qui commence par `prefix` (« /character/api/ ») à
        `fn(req, reste)`, quelle que soit la méthode ; `reste` est la suite
        du chemin telle qu'elle est arrivée, encore encodée."""
        self.prefixes.append(("/" + prefix.strip("/") + "/", fn))

    # ── répartition ─────────────────────────────────────────
    def dispatch(self, req: Request):
        path = req.path
        for pre, fn in self.prefixes:
            if path.startswith(pre):
                return fn(req, path[len(pre):])
        if path.startswith("/api/"):
            allowed = []
            for method, rx, fn in self.routes:
                m = rx.match(path)
                if not m:
                    continue
                if method != req.method:
                    allowed.append(method)
                    continue
                params = {k: unquote(v) for k, v in m.groupdict().items()}
                # un segment d'adresse décodé ne sort jamais de son dossier :
                # « %2F », « .. » ou « \ » refusés ici, pour toutes les routes
                for v in params.values():
                    if "/" in v or "\\" in v or ".." in v or "\x00" in v:
                        raise HttpError(400, "identifiant refusé")
                return fn(req, **params)
            if allowed:
                raise HttpError(405, "méthode refusée ici : " + ", ".join(sorted(set(allowed))))
            raise HttpError(404, "pas de route " + path)
        if req.method not in ("GET", "HEAD"):
            raise HttpError(405, "lecture seule")
        rel = unquote(path).lstrip("/")
        for prefix, folder in self.mounts.items():
            if rel.startswith(prefix):
                check = self.mount_checks.get(prefix)
                if check and not check(rel[len(prefix):]):
                    raise HttpError(404, "introuvable")
                f = self._file(folder, rel[len(prefix):])
                policy = self.mount_cache.get(prefix)
                if policy:
                    f.cache = policy(rel[len(prefix):], req) or f.cache
                return f
        if self.hidden.search(rel):
            raise HttpError(404, "introuvable")
        if rel == "" or rel.endswith("/"):
            rel += "index.html"
        return self._file(self.root, rel)

    @staticmethod
    def _file(folder: Path, rel: str) -> FileResponse:
        target = (folder / rel).resolve()
        if not target.is_relative_to(folder) or not target.is_file():
            if target.is_dir() and target.is_relative_to(folder) and (target / "index.html").is_file():
                return FileResponse(target / "index.html")
            raise HttpError(404, "introuvable")
        return FileResponse(target)

    # ── serveur ─────────────────────────────────────────────
    def serve(self, host: str, port: int) -> None:
        app = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"
            server_version = "Showrunner/1"
            # sans cela, chaque réponse sur une connexion gardée ouverte attend
            # l'accusé retardé du client : 41 ms par requête mesurées sur DGX2
            # (docs/etudes/ideation_fluidite.md) ; socketserver.StreamRequestHandler
            disable_nagle_algorithm = True

            def log_message(self, fmt, *args):  # le journal des requêtes noierait celui des rendus
                pass

            def end_headers(self):
                # audit du 28/09, B1 : pas de type deviné, pas d'adresse qui
                # fuit vers un autre site, pas de page du portail dans le
                # cadre d'un autre (le bouton « Accepter » de la page admin)
                self.send_header("X-Content-Type-Options", "nosniff")
                self.send_header("Referrer-Policy", "same-origin")
                self.send_header("Content-Security-Policy", "frame-ancestors 'self'")
                super().end_headers()

            def _run(self, method: str) -> None:
                parts = urlsplit(self.path)
                req = Request(self, method, parts.path, parse_qs(parts.query))
                try:
                    if app.gate:
                        app.gate(req, app)
                    out = app.dispatch(req)
                except HttpError as e:
                    out = Response(json.dumps({"error": e.message}, ensure_ascii=False), e.status,
                                   "application/json; charset=utf-8")
                except PermissionError as e:  # un droit refusé par le socle (core/library.py)
                    out = Response(json.dumps({"error": str(e) or "refusé"}, ensure_ascii=False), 403,
                                   "application/json; charset=utf-8")
                except Exception as e:  # une erreur d'outil ne tombe pas le portail
                    traceback.print_exc()
                    out = Response(json.dumps({"error": f"{type(e).__name__}: {e}"}, ensure_ascii=False), 500,
                                   "application/json; charset=utf-8")
                # le corps non lu d'une requête refusée casserait la suivante
                if req._body is None and method in ("POST", "PUT", "PATCH", "DELETE"):
                    try:
                        req.discard()   # lu et jeté par morceaux : jamais gardé en mémoire
                    except (HttpError, OSError):
                        self.close_connection = True
                try:
                    self._send(out, head=(method == "HEAD"))
                except (BrokenPipeError, ConnectionResetError):
                    pass
                finally:
                    if app.after:
                        app.after(req, getattr(out, "status", 200))

            def _send(self, out, head: bool = False) -> None:
                if isinstance(out, FileResponse):
                    return self._send_file(out, head)
                if isinstance(out, StreamResponse):
                    return self._send_stream(out, head)
                if not isinstance(out, Response):
                    out = Response(json.dumps(out, ensure_ascii=False), 200, "application/json; charset=utf-8")
                self.send_response(out.status)
                self.send_header("Content-Type", out.ctype)
                self.send_header("Content-Length", str(len(out.body)))
                self.send_header("Cache-Control", "no-store")
                for k, v in out.headers.items():
                    self.send_header(k, v)
                self.end_headers()
                if not head:
                    self.wfile.write(out.body)

            def _send_file(self, f: FileResponse, head: bool) -> None:
                st = f.path.stat()
                size = st.st_size
                # un validateur faible (taille, date) : « a-t-il changé ? » se répond
                # sans le corps. Faible : il ne sert pas à If-Range, rien ne change là
                etag = f'W/"{size:x}-{st.st_mtime_ns:x}"'
                inm = self.headers.get("If-None-Match")
                if inm and (inm.strip() == "*" or etag[2:] in {t.strip().removeprefix("W/") for t in inm.split(",")}):
                    self.send_response(304)
                    self.send_header("ETag", etag)
                    self.send_header("Cache-Control", f.cache)
                    self.end_headers()
                    return
                start, end, status = 0, size - 1, 200
                rng = self.headers.get("Range")
                if rng:
                    m = re.match(r"bytes=(\d*)-(\d*)", rng)
                    if m and (m.group(1) or m.group(2)):
                        if m.group(1):
                            start = int(m.group(1))
                            end = int(m.group(2)) if m.group(2) else size - 1
                        else:
                            start = max(0, size - int(m.group(2)))
                        end = min(end, size - 1)
                        if start > end:
                            self.send_response(416)
                            self.send_header("Content-Range", f"bytes */{size}")
                            self.send_header("Content-Length", "0")
                            self.end_headers()
                            return
                        status = 206
                self.send_response(status)
                self.send_header("Content-Type", f.ctype)
                self.send_header("Accept-Ranges", "bytes")
                self.send_header("Content-Length", str(end - start + 1))
                self.send_header("Cache-Control", f.cache)
                self.send_header("ETag", etag)
                if status == 206:
                    self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
                self.end_headers()
                if head:
                    return
                with open(f.path, "rb") as fh:
                    fh.seek(start)
                    left = end - start + 1
                    while left > 0:
                        buf = fh.read(min(1 << 20, left))
                        if not buf:
                            break
                        self.wfile.write(buf)
                        left -= len(buf)

            def _send_stream(self, s: StreamResponse, head: bool) -> None:
                # sans corps : HEAD, 204, 304 ; sinon la taille annoncée, ou
                # des morceaux (chunked) écrits dès qu'ils arrivent
                bodyless = head or s.status in (204, 304) or 100 <= s.status < 200
                chunked = s.length is None and not bodyless
                try:
                    self.send_response(s.status)
                    for k, v in s.headers:
                        self.send_header(k, v)
                    if s.length is not None:
                        self.send_header("Content-Length", str(s.length))
                    elif chunked:
                        self.send_header("Transfer-Encoding", "chunked")
                    else:
                        self.close_connection = True
                    self.end_headers()
                    if bodyless:
                        return
                    sent = 0
                    for buf in s.chunks:
                        if not buf:
                            continue
                        self.wfile.write(b"%x\r\n%b\r\n" % (len(buf), buf) if chunked else buf)
                        sent += len(buf)
                    if chunked:
                        self.wfile.write(b"0\r\n\r\n")
                    elif s.length is not None and sent != s.length:
                        self.close_connection = True   # la source s'est tue en route
                except (BrokenPipeError, ConnectionResetError):
                    self.close_connection = True   # le navigateur est parti
                except Exception as e:  # la source se tait en route : l'en-tête est parti, on ferme
                    self.close_connection = True
                    print(f"relais interrompu : {type(e).__name__}: {e}", file=sys.stderr, flush=True)
                finally:
                    s.close()

            def do_GET(self):
                self._run("GET")

            def do_HEAD(self):
                self._run("HEAD")

            def do_POST(self):
                self._run("POST")

            def do_PUT(self):
                self._run("PUT")

            def do_DELETE(self):
                self._run("DELETE")

            def do_PATCH(self):
                self._run("PATCH")

            def do_OPTIONS(self):
                self._run("OPTIONS")

        class Server(ThreadingHTTPServer):
            def handle_error(self, request, client_address):
                # un navigateur qui abandonne une lecture vidéo coupe la connexion :
                # ce n'est pas une panne, le journal n'a pas à s'en remplir
                exc = sys.exc_info()[1]
                if isinstance(exc, (ConnectionResetError, BrokenPipeError, TimeoutError)):
                    return
                super().handle_error(request, client_address)

        server = Server((host, port), Handler)
        server.daemon_threads = True
        print(f"showrunner : http://{host}:{port}/", flush=True)
        for fn in self.starters:   # une fonction qui échoue ne tombe pas le portail
            try:
                fn()
            except Exception:
                traceback.print_exc()
        threading.current_thread().name = "http"
        server.serve_forever()
