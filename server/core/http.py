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
"""

from __future__ import annotations

import json
import mimetypes
import re
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

    def body(self) -> bytes:
        if self._body is None:
            n = int(self.headers.get("Content-Length") or 0)
            if n > MAX_BODY:
                raise HttpError(413, "fichier trop gros (2 Go au plus)")
            self._body = self._h.rfile.read(n) if n else b""
        return self._body

    def stream_to(self, dest: Path, chunk: int = 1 << 20) -> int:
        """Écrit le corps dans un fichier sans le garder en mémoire."""
        n = int(self.headers.get("Content-Length") or 0)
        if n > MAX_BODY:
            raise HttpError(413, "fichier trop gros (2 Go au plus)")
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

    def json(self) -> dict:
        raw = self.body()
        if not raw:
            return {}
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
        # ce qui ne sort jamais du dépôt, même s'il est dans la racine
        self.hidden = re.compile(r"(^|/)(\.|server/|showrunner\.local\.json|node_modules/)")

    def route(self, method: str, pattern: str, fn) -> None:
        rx = "^" + re.sub(r"\{(\w+)\}", r"(?P<\1>[^/]+)", pattern.rstrip("/")) + "/?$"
        self.routes.append((method.upper(), re.compile(rx), fn))

    def mount(self, prefix: str, folder: Path) -> None:
        self.mounts[prefix.strip("/") + "/"] = folder.resolve()

    # ── répartition ─────────────────────────────────────────
    def dispatch(self, req: Request):
        path = req.path
        if path.startswith("/api/"):
            allowed = []
            for method, rx, fn in self.routes:
                m = rx.match(path)
                if not m:
                    continue
                if method != req.method:
                    allowed.append(method)
                    continue
                return fn(req, **{k: unquote(v) for k, v in m.groupdict().items()})
            if allowed:
                raise HttpError(405, "méthode refusée ici : " + ", ".join(sorted(set(allowed))))
            raise HttpError(404, "pas de route " + path)
        if req.method not in ("GET", "HEAD"):
            raise HttpError(405, "lecture seule")
        rel = unquote(path).lstrip("/")
        for prefix, folder in self.mounts.items():
            if rel.startswith(prefix):
                return self._file(folder, rel[len(prefix):])
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

            def log_message(self, fmt, *args):  # le journal des requêtes noierait celui des rendus
                pass

            def _run(self, method: str) -> None:
                parts = urlsplit(self.path)
                req = Request(self, method, parts.path, parse_qs(parts.query))
                try:
                    out = app.dispatch(req)
                except HttpError as e:
                    out = Response(json.dumps({"error": e.message}, ensure_ascii=False), e.status,
                                   "application/json; charset=utf-8")
                except Exception as e:  # une erreur d'outil ne tombe pas le portail
                    traceback.print_exc()
                    out = Response(json.dumps({"error": f"{type(e).__name__}: {e}"}, ensure_ascii=False), 500,
                                   "application/json; charset=utf-8")
                # le corps non lu d'une requête refusée casserait la suivante
                if req._body is None and method in ("POST", "PUT", "PATCH", "DELETE"):
                    try:
                        req.body()
                    except HttpError:
                        self.close_connection = True
                try:
                    self._send(out, head=(method == "HEAD"))
                except (BrokenPipeError, ConnectionResetError):
                    pass

            def _send(self, out, head: bool = False) -> None:
                if isinstance(out, FileResponse):
                    return self._send_file(out, head)
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
                size = f.path.stat().st_size
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

        server = ThreadingHTTPServer((host, port), Handler)
        server.daemon_threads = True
        print(f"showrunner : http://{host}:{port}/", flush=True)
        threading.current_thread().name = "http"
        server.serve_forever()
