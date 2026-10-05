#!/usr/bin/env python3
"""Un faux Ollama, pour essayer l'agent Showrunner d'Idéation sans modèle.

    python3 tools/faux_ollama.py --port 11500

Il répond comme Ollama à ce que l'agent appelle (docs/api.md du dépôt d'Ollama) :
`GET /api/tags` (les modèles), `GET /api/version`, `POST /api/show` (`capabilities`, et ce que lit
le diagnostic tools/diag_agent.py : `parameters`, `details`, `model_info`), `POST /api/generate`
(décharger : compté), `POST /api/chat` :

  - avec `format` (un schéma JSON) : un objet conforme au schéma, rempli d'après le texte
    reçu (l'analyse d'entrée) ;
  - avec `tools` : des appels d'outils SCÉNARISÉS, au format d'Ollama
    (`message.tool_calls: [{"function": {"name", "arguments": {…}}}]`), choisis d'après la
    demande (`<request>`) et les objets cités (`<cited>`) du dernier message de la personne,
    étape par étape (le nombre de réponses de l'assistant depuis ce message) ; puis une
    réponse sans appel, qui finit le tour ;
  - sinon (une image à regarder) : une description.

Un essai peut imposer ses réponses : `script` (une file de `{"tool_calls": [...]}` ou
`{"content": "…"}`, prise dans l'ordre avant les scénarios), `delay` (secondes par appel),
`caps`, `models` — par l'objet (le contrôle : server/tools/ideation_agent.py, selftest) ou
par `POST /_faux {…}` ; `GET /_faux` rend ce qui a été reçu.
"""

from __future__ import annotations

import argparse
import json
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ITEM = r"[a-z]{3}-\d{8}-\d{6}-[0-9a-f]{4}"


def _block(text: str, tag: str) -> str:
    m = re.search(rf"<{tag}>\n?(.*?)\n?</{tag}>", text or "", re.S)
    return m.group(1) if m else ""


def call(name: str, **args) -> dict:
    return {"function": {"name": name, "arguments": args}}


def fill(schema: dict, seed: str = "") -> object:
    """Un objet conforme à un schéma JSON simple (objet, liste, texte, entier, énumération)."""
    t = schema.get("type")
    if "enum" in schema:
        return schema["enum"][0]
    if t == "object":
        return {k: fill(v, f"{seed} {k}") for k, v in (schema.get("properties") or {}).items()}
    if t == "array":
        n = max(1, int(schema.get("minItems") or 0))
        return [fill(schema.get("items") or {"type": "string"}, seed) for _ in range(n)]
    if t == "integer":
        return 0
    if t == "number":
        return 0.0
    if t == "boolean":
        return False
    return (seed.strip() or "texte")[:120]


class Faux:
    def __init__(self, models=("qwen3-vl-32b-32k:latest",), caps=("completion", "tools", "vision", "thinking"), delay: float = 0.0):
        self.models = list(models)
        self.caps = list(caps)
        self.delay = delay
        self.script: list[dict] = []
        self.calls: list[dict] = []
        self.unloads = 0
        self.lock = threading.Lock()
        self.srv = None
        self.url = ""

    # ── les réponses ─────────────────────────────────────────
    def chat(self, body: dict) -> dict:
        with self.lock:
            self.calls.append(body)
            scripted = self.script.pop(0) if (self.script and body.get("tools")) else None
        if self.delay:
            time.sleep(self.delay)
        msgs = body.get("messages") or []
        if body.get("format"):
            return self._msg(json.dumps(self.structured(body["format"], msgs), ensure_ascii=False))
        if scripted is not None:
            return self._msg(scripted.get("content", ""), scripted.get("tool_calls"))
        if body.get("tools"):
            content, calls = self.scenario(msgs)
            return self._msg(content, calls)
        last = msgs[-1] if msgs else {}
        n = len(last.get("images") or [])
        return self._msg(f"Une image (faux Ollama, {n} jointe{'s' if n > 1 else ''}) : un portrait en lumière douce, "
                         "une ambiance de film des années 1920.")

    @staticmethod
    def _msg(content: str, calls: list | None = None) -> dict:
        m = {"role": "assistant", "content": content or ""}
        if calls:
            m["tool_calls"] = calls
        return {"model": "faux", "message": m, "done": True, "done_reason": "stop", "prompt_eval_count": 1200, "eval_count": 40}

    def structured(self, schema: dict, msgs: list) -> dict:
        text = (msgs[-1].get("content") if msgs else "") or ""
        body = _block(text, "document") or re.sub(r"<[^>]+>", " ", text)
        words = " ".join(body.split())
        out = fill(schema, words[:80])
        if isinstance(out, dict):
            if "resume" in out:
                out["resume"] = "Résumé (faux Ollama) : " + words[:160]
                out["themes"] = ["les années folles", "Montparnasse"]
                names = [n for n in ("Kiki", "Man Ray", "Léa", "Foujita") if n in body]
                out["personnages"] = [{"nom": n, "description": "repéré dans le texte (faux)"} for n in names] or \
                                     [{"nom": "Personnage 1", "description": "repéré dans le texte (faux)"}]
                out["lieux"] = [p for p in ("Montparnasse", "La Rotonde", "Le Dôme") if p in body] or ["un atelier"]
                out["references"] = ["Man Ray, rayographies"] if "Man Ray" in body else ["photographie des années 1920"]
            if "description" in out:
                out.update(description="Un portrait (faux Ollama), lumière douce, grain de film.", sujet="un portrait",
                           ambiance="mélancolique", style="photographie argentique", personnages=["une femme"], lieu="un café")
        return out

    def scenario(self, msgs: list) -> tuple[str, list | None]:
        """Les scénarios : la demande (`<request>`) choisit, l'étape avance d'une réponse à l'autre."""
        k = max((i for i, m in enumerate(msgs) if m.get("role") == "user"), default=0)
        user = msgs[k].get("content") or ""
        step = sum(1 for m in msgs[k + 1:] if m.get("role") == "assistant")
        req = _block(user, "request").lower()
        cited = re.findall(rf"^- ({ITEM}|[A-Za-z0-9_-]+):", _block(user, "cited"), re.M)
        board = re.findall(r"^- ([A-Za-z0-9_-]+) · (\S+)", _block(user, "board"), re.M)
        media = [i for i, kind in board if kind in ("image", "vidéo", "video", "élément")]
        last_tool = msgs[-1].get("content", "") if msgs and msgs[-1].get("role") == "tool" else ""
        if "organize the board from the documents" in req:
            return self.ingest(user, step, last_tool)
        if "style" in req or "même" in req or "comme celle" in req:
            if not cited:
                return "Cite une image (glisse-la dans le champ) : je la brancherai en référence.", None
            if step == 0:
                return "", [call("decrire_image", id=cited[0])]
            if step == 1:
                return "", [call("carte_image", prompt="A cinematic portrait in the style of the reference: soft window light, "
                                 "film grain, muted colours.", refs=[cited[0]], format="3:4", nombre=2,
                                 pourquoi="ta demande : une image dans le style de la référence citée")]
            return ("J'ai posé une carte Générer image, branchée sur ta référence ; le prompt reprend sa lumière et son grain. "
                    "Relis-le, puis appuie sur Générer."), None
        if "vidéo" in req or "anime" in req:
            if step == 0 and cited:
                return "", [call("carte_video", prompt="The camera slowly pushes in; she turns her head towards the window.",
                                 image=cited[0], pourquoi="animer l'image citée")]
            return "Une carte Générer vidéo est posée, sa première image branchée.", None
        if "range" in req:
            if step == 0 and media:
                return "", [call("poser_cadre", nom="Images", pourquoi="un cadre pour les images"),
                            call("ranger", ids=media, disposition="grille", dans="new:0", pourquoi="les images ensemble")]
            return "Les images sont rangées dans un cadre.", None
        if "renomme" in req:
            if step == 0:
                return "", [call("renommer_planche", nom="Les années folles", pourquoi="le nom que tu as donné")]
            return "C'est renommé.", None
        if "lis" in req and cited:
            if step == 0:
                return "", [call("lire_document", id=cited[0])]
            if step == 1:
                return "", [call("poser_texte", sorte="note", texte="Résumé : " + last_tool[:200], pourquoi="le résumé demandé")]
            return "Le résumé est posé en note.", None
        if step == 0:
            return "", [call("lire_planche")]
        return f"Je vois {len(board)} objets sur la planche.", None

    def ingest(self, user: str, step: int, last_tool: str) -> tuple[str, list | None]:
        docs = re.findall(r'<document id="([^"]+)"[^>]*title="([^"]*)">\n?(.*?)</document>', user, re.S)
        imgs = re.findall(r'<image id="([^"]+)"( board_object="([^"]+)")?', user)
        if step == 0:
            return "", [call("poser_cadre", nom="Histoire", pourquoi="les documents et leur résumé"),
                        call("poser_cadre", nom="Personnages et lieux", pourquoi="ce que les documents nomment"),
                        call("poser_cadre", nom="Images", pourquoi="les références visuelles")]
        if step == 1:
            calls = []
            for _id, title, fiche in docs:
                first = fiche.strip().split("\n")[0][:300]
                calls.append(call("poser_texte", sorte="note", texte=f"{title} — {first}", dans="new:0", pourquoi=f"le résumé de « {title} »"))
                for nom in re.findall(r"personnages : (.*)", fiche):
                    for who in nom.split(";")[:4]:
                        calls.append(call("poser_texte", sorte="postit", texte=who.split(" — ")[0].strip(), dans="new:1",
                                          pourquoi="un personnage repéré"))
            for iid, _b, node in imgs:
                calls.append(call("deplacer", ids=[node], dans="new:2", pourquoi="une référence visuelle") if node
                             else call("poser_asset", item=iid, dans="new:2", pourquoi="une référence visuelle"))
            return "", calls or [call("poser_texte", sorte="note", texte="Rien à lire.", pourquoi="aucun document")]
        if step == 2:
            return "", [call("poser_texte", sorte="note", texte="Suite proposée : une carte Générer image par personnage, "
                             "d'après les références du cadre Images.", pres_de="new:0", pourquoi="la proposition de suite")]
        return (f"J'ai lu {len(docs)} document{'s' if len(docs) > 1 else ''} et regardé {len(imgs)} image{'s' if len(imgs) > 1 else ''} : "
                "trois cadres (Histoire, Personnages et lieux, Images), un résumé par document, et une proposition de suite."), None

    # ── le serveur ───────────────────────────────────────────
    def start(self, port: int = 0, host: str = "127.0.0.1") -> str:
        outer = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _send(self, obj, code=200):
                data = json.dumps(obj, ensure_ascii=False).encode()
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def do_GET(self):
                if self.path == "/api/tags":
                    return self._send({"models": [{"name": m, "size": 30_800_000_000} for m in outer.models]})
                if self.path == "/api/version":
                    return self._send({"version": "0.0.0-faux"})
                if self.path == "/_faux":
                    return self._send({"calls": len(outer.calls), "unloads": outer.unloads, "script": len(outer.script),
                                       "last": outer.calls[-1] if outer.calls else None})
                return self._send({"error": "inconnu"}, 404)

            def do_POST(self):
                try:
                    body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
                except ValueError:
                    return self._send({"error": "json"}, 400)
                if self.path == "/api/show":   # les champs que lit le diagnostic (tools/diag_agent.py) ; des valeurs d'essai
                    return self._send({"capabilities": outer.caps, "parameters": "num_ctx                        32768",
                                       "details": {"family": "faux", "parameter_size": "0B", "quantization_level": "faux"},
                                       "model_info": {"faux.context_length": 32768}})
                if self.path == "/api/generate":
                    outer.unloads += 1
                    return self._send({"done": True, "done_reason": "unload"})
                if self.path == "/api/chat":
                    return self._send(outer.chat(body))
                if self.path == "/_faux":
                    for k in ("script", "delay", "caps", "models"):
                        if k in body:
                            setattr(outer, k, body[k])
                    return self._send({"ok": True})
                return self._send({"error": "inconnu"}, 404)

        self.srv = ThreadingHTTPServer((host, port), H)
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.url = f"http://{host}:{self.srv.server_address[1]}"
        return self.url

    def close(self) -> None:
        if self.srv:
            self.srv.shutdown()
            self.srv.server_close()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--port", type=int, default=11500)
    ap.add_argument("--delay", type=float, default=0.6, help="secondes par appel (pour voir la progression)")
    a = ap.parse_args()
    f = Faux(delay=a.delay)
    print("faux Ollama :", f.start(a.port), flush=True)
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        f.close()


if __name__ == "__main__":
    main()
