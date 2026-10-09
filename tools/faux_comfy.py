#!/usr/bin/env python3
"""Un faux ComfyUI, pour essayer la file des calculs sans rien calculer.

    python3 tools/faux_comfy.py --port 8781 --total 121 --free 100

Il répond comme ComfyUI à ce que la file lit (core/machines.py) :
`/system_stats` (la mémoire, réglable), `/queue` (vide, ou occupée par le
rendu d'un « autre » : le studio Character Factory, une autre session),
`/free` (la mémoire revient), `/prompt` et `/history` (un rendu fini tout
de suite, sans image). `/object_info/LoraLoaderModelOnly` liste ses LoRA
(`loras`, réglable), `/models/loras` aussi ; un autre nœud : `{}` (inconnu),
un autre dossier : 404 ; `version` : la `comfyui_version` de `/system_stats`. Il garde chaque graphe
reçu, pour qu'un essai vérifie ce que le portail a vraiment envoyé.
Réglages en direct, depuis un essai :

    POST /_faux {"busy": true, "client": "usine-essai", "free_gb": 20, "loras": ["showrunner/x.safetensors"]}
    GET  /_faux          son état : combien de /free reçus, etc.
    GET  /_faux/last     le dernier graphe reçu par /prompt

tools/check.py le lance dans son processus (`start()`) ; le pilote de la
page admin en lance deux, un par « machine ».
"""

from __future__ import annotations

import argparse
import json
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

GB = 1e9


class Faux:
    def __init__(self, total_gb: float = 121.0, free_gb: float = 100.0, base_gb: float = 8.0) -> None:
        self.total, self.free, self.base = total_gb, free_gb, base_gb
        self.busy, self.client = False, "usine-essai"
        self.frees = 0
        self.prompts: list[str] = []
        self.graphs: dict[str, dict] = {}   # prompt_id → le graphe reçu
        self.loras: list[str] = []
        self.version = "faux"   # system.comfyui_version de /system_stats (le registre de l'agent la compare)
        self.lock = threading.Lock()

    def state(self) -> dict:
        return {"total_gb": self.total, "free_gb": self.free, "busy": self.busy, "client": self.client,
                "frees": self.frees, "prompts": len(self.prompts)}

    def handler(self):
        faux = self

        class H(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *a):
                pass

            def _json(self, doc, code: int = 200) -> None:
                b = json.dumps(doc).encode()
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(b)))
                self.end_headers()
                self.wfile.write(b)

            def _body(self) -> dict:
                n = int(self.headers.get("Content-Length") or 0)
                raw = self.rfile.read(n) if n > 0 else b""
                try:
                    return json.loads(raw) if raw else {}
                except ValueError:
                    return {}

            def do_GET(self):
                with faux.lock:
                    if self.path == "/system_stats":
                        return self._json({"system": {"os": "faux", "ram_total": int(faux.total * GB),
                                                      "ram_free": int(faux.free * GB), "comfyui_version": faux.version}})
                    if self.path.startswith("/models/"):   # ComfyUI server.py : les fichiers d'un dossier ; 404 pour un dossier inconnu
                        folder = self.path.rsplit("/", 1)[1]
                        if folder == "loras":
                            return self._json(list(faux.loras))
                        return self._json({"error": "dossier inconnu"}, 404)
                    if self.path == "/queue":
                        run = [[1, "faux-" + faux.client, {}, {"client_id": faux.client}, []]] if faux.busy else []
                        return self._json({"queue_running": run, "queue_pending": []})
                    if self.path.startswith("/history/"):
                        pid = self.path.rsplit("/", 1)[1]
                        return self._json({pid: {"status": {"status_str": "success"}, "outputs": {}}}
                                          if pid in faux.prompts else {})
                    if self.path == "/_faux":
                        return self._json(faux.state())
                    if self.path == "/_faux/last":
                        return self._json(faux.graphs.get(faux.prompts[-1], {}) if faux.prompts else {})
                    if self.path.startswith("/object_info/"):
                        node = self.path.rsplit("/", 1)[1]
                        if node == "LoraLoaderModelOnly":
                            return self._json({node: {"input": {"required": {
                                "model": ["MODEL"], "lora_name": [list(faux.loras)],
                                "strength_model": ["FLOAT", {"default": 1.0, "min": -100.0, "max": 100.0}]}}}})
                        return self._json({})
                self._json({"error": "introuvable"}, 404)

            def do_POST(self):
                d = self._body()
                with faux.lock:
                    if self.path == "/free":
                        faux.frees += 1
                        faux.free = round(faux.total - faux.base, 1)
                        return self._json({})
                    if self.path == "/prompt":
                        pid = uuid.uuid4().hex
                        faux.prompts.append(pid)
                        faux.graphs[pid] = d.get("prompt") or {}
                        return self._json({"prompt_id": pid, "number": len(faux.prompts), "node_errors": {}})
                    if self.path == "/_faux":
                        if "busy" in d:
                            faux.busy = bool(d["busy"])
                        if d.get("client"):
                            faux.client = str(d["client"])
                        if d.get("free_gb") is not None:
                            faux.free = float(d["free_gb"])
                        if d.get("total_gb") is not None:
                            faux.total = float(d["total_gb"])
                        if isinstance(d.get("loras"), list):
                            faux.loras = [str(x) for x in d["loras"]]
                        return self._json(faux.state())
                self._json({"error": "introuvable"}, 404)

        return H


def start(port: int = 0, host: str = "127.0.0.1", **kw) -> tuple[ThreadingHTTPServer, Faux, str]:
    faux = Faux(**kw)
    srv = ThreadingHTTPServer((host, port), faux.handler())
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True, name="faux-comfy").start()
    return srv, faux, f"http://{host}:{srv.server_address[1]}"


def main() -> None:
    ap = argparse.ArgumentParser(description="un faux ComfyUI pour essayer la file")
    ap.add_argument("--port", type=int, default=8781)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--total", type=float, default=121.0)
    ap.add_argument("--free", type=float, default=100.0)
    a = ap.parse_args()
    faux = Faux(a.total, a.free)
    srv = ThreadingHTTPServer((a.host, a.port), faux.handler())
    print(f"faux ComfyUI : http://{a.host}:{a.port}/ ({a.free:g} Go libres sur {a.total:g})", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
