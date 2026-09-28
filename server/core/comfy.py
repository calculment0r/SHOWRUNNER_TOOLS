"""Un client ComfyUI minimal (bibliothèque standard seulement).

Le graphe est au format API. Les nœuds de sortie à rapatrier portent le
titre `OUT` (`_meta.title`) ; sans eux, on rapatrie toutes les sorties.
Les images d'entrée montent par `/upload/image` et le graphe les appelle
par le nom rendu.
"""

from __future__ import annotations

import json
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


class ComfyError(RuntimeError):
    pass


class Cancelled(RuntimeError):
    pass


class Comfy:
    def __init__(self, url: str, timeout: float = 30.0) -> None:
        self.url = url.rstrip("/")
        self.timeout = timeout
        self.client_id = "showrunner-" + secrets.token_hex(4)

    def _req(self, method: str, path: str, data: bytes | None = None, ctype: str | None = None,
             timeout: float | None = None) -> bytes:
        req = urllib.request.Request(self.url + path, data=data, method=method)
        if ctype:
            req.add_header("Content-Type", ctype)
        try:
            with urllib.request.urlopen(req, timeout=timeout or self.timeout) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", "replace")[:2000]
            raise ComfyError(f"{self.url}{path} : {e.code} {body}") from e
        except (urllib.error.URLError, OSError) as e:
            raise ComfyError(f"{self.url} ne répond pas ({e})") from e

    def _json(self, method: str, path: str, obj=None, timeout: float | None = None):
        data = json.dumps(obj).encode() if obj is not None else None
        raw = self._req(method, path, data, "application/json" if data else None, timeout)
        # /free et /interrupt rendent un corps vide : ne jamais le lire en JSON
        return json.loads(raw) if raw.strip() else {}

    # ── état ────────────────────────────────────────────────
    def ping(self, timeout: float = 3.0) -> dict:
        return self._json("GET", "/system_stats", timeout=timeout)

    def queue_state(self) -> dict:
        return self._json("GET", "/queue")

    def object_info(self, node: str | None = None) -> dict:
        return self._json("GET", "/object_info" + (f"/{node}" if node else ""), timeout=120)

    def free(self) -> None:
        self._json("POST", "/free", {"unload_models": True, "free_memory": True})

    def interrupt(self) -> None:
        self._json("POST", "/interrupt", {})

    # ── fichiers ────────────────────────────────────────────
    def upload(self, path: Path, name: str | None = None) -> str:
        path = Path(path)
        name = name or f"sr_{secrets.token_hex(4)}_{path.name}"
        boundary = "----sr" + secrets.token_hex(8)
        head = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"image\"; filename=\"{name}\"\r\n"
                f"Content-Type: application/octet-stream\r\n\r\n").encode()
        tail = (f"\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"overwrite\"\r\n\r\ntrue"
                f"\r\n--{boundary}--\r\n").encode()
        raw = self._req("POST", "/upload/image", head + path.read_bytes() + tail,
                        f"multipart/form-data; boundary={boundary}", timeout=300)
        info = json.loads(raw)
        return (info.get("subfolder") + "/" if info.get("subfolder") else "") + info["name"]

    def download(self, item: dict, dest: Path) -> Path:
        q = urllib.parse.urlencode({"filename": item["filename"], "subfolder": item.get("subfolder", ""),
                                    "type": item.get("type", "output")})
        dest.write_bytes(self._req("GET", "/view?" + q, timeout=600))
        return dest

    # ── rendu ───────────────────────────────────────────────
    def queue(self, graph: dict) -> str:
        out = self._json("POST", "/prompt", {"prompt": graph, "client_id": self.client_id}, timeout=120)
        if out.get("node_errors"):
            raise ComfyError("graphe refusé : " + json.dumps(out["node_errors"], ensure_ascii=False)[:1500])
        return out["prompt_id"]

    def wait(self, prompt_id: str, *, cancelled=lambda: False, report=None, timeout: float = 7200,
             poll: float = 1.0) -> dict:
        t0 = time.time()
        seen_running = False
        while True:
            if cancelled():
                self._cancel(prompt_id)
                raise Cancelled("arrêté")
            hist = self._json("GET", f"/history/{prompt_id}")
            if prompt_id in hist:
                entry = hist[prompt_id]
                st = entry.get("status") or {}
                if st.get("status_str") == "error":
                    msgs = [m for m in st.get("messages", []) if m and m[0] == "execution_error"]
                    detail = msgs[0][1].get("exception_message", "") if msgs else ""
                    raise ComfyError(f"ComfyUI a échoué : {detail.strip()[:800]}")
                return entry
            if report:
                q = self.queue_state()
                running = any(r[1] == prompt_id for r in q.get("queue_running", []))
                ahead = sum(1 for r in q.get("queue_pending", []) if r[1] != prompt_id)
                if running and not seen_running:
                    seen_running = True
                report("run" if running else "wait", 0 if running else ahead)
            if time.time() - t0 > timeout:
                self._cancel(prompt_id)
                raise ComfyError(f"trop long (> {int(timeout)} s)")
            time.sleep(poll)

    def _cancel(self, prompt_id: str) -> None:
        try:
            q = self.queue_state()
            if any(r[1] == prompt_id for r in q.get("queue_running", [])):
                self.interrupt()
            else:
                self._json("POST", "/queue", {"delete": [prompt_id]})
        except ComfyError:
            pass

    @staticmethod
    def outputs(entry: dict, graph: dict, title: str = "OUT") -> list[dict]:
        outs = entry.get("outputs") or {}
        titled = [k for k, v in graph.items() if (v.get("_meta") or {}).get("title", "").startswith(title)]
        keys = [k for k in titled if k in outs] or list(outs)
        files = []
        for k in keys:
            for field, vals in outs[k].items():
                if isinstance(vals, list):
                    for v in vals:
                        if isinstance(v, dict) and v.get("filename"):
                            files.append({**v, "node": k, "field": field})
        return files

    def run(self, graph: dict, dest_dir: Path, *, cancelled=lambda: False, report=None, prefix: str = "out",
            timeout: float = 7200) -> list[Path]:
        dest_dir.mkdir(parents=True, exist_ok=True)
        pid = self.queue(graph)
        entry = self.wait(pid, cancelled=cancelled, report=report, timeout=timeout)
        paths = []
        for k, item in enumerate(self.outputs(entry, graph)):
            ext = Path(item["filename"]).suffix or ".png"
            paths.append(self.download(item, dest_dir / f"{prefix}_{k:02d}{ext}"))
        if not paths:
            raise ComfyError("ComfyUI n'a rien rendu")
        return paths


def fill(graph: dict, values: dict) -> dict:
    """Remplace `{{nom}}` dans le graphe ; une valeur seule garde son type."""
    def sub(v):
        if isinstance(v, str):
            for k, val in values.items():
                if v == "{{" + k + "}}":
                    return val
                v = v.replace("{{" + k + "}}", str(val))
            return v
        if isinstance(v, dict):
            return {kk: sub(vv) for kk, vv in v.items()}
        if isinstance(v, list):
            return [sub(x) for x in v]
        return v
    return sub(json.loads(json.dumps(graph)))
