#!/usr/bin/env python3
"""Un faux Ollama, pour essayer l'agent Showrunner d'Idéation sans modèle.

    python3 tools/faux_ollama.py --port 11500

Il répond comme Ollama à ce que l'agent appelle (docs/api.md du dépôt d'Ollama) :
`GET /api/tags` (les modèles), `GET /api/version`, `POST /api/show` (`capabilities`, et ce que lit
le diagnostic tools/diag_agent.py : `parameters`, `details`, `model_info`), `POST /api/generate`
(décharger : compté), `POST /api/chat` :

  - avec `format` (un schéma JSON) : un objet conforme au schéma, rempli d'après le texte
    reçu — l'entrée d'un projet (ce qu'il comprend, ce qui ne colle pas : un brief sans un mot
    en commun avec les documents est signalé, des questions à choix), le plan, un palier
    (les images regardées) ;
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
        props = schema.get("properties") or {}
        if "comprehension" in props:
            return self.entree(text)
        if "etapes" in props:
            return self.plan(text)
        if "annonce" in props:
            return self.palier(msgs[-1] if msgs else {})
        if "shots" in props and "subjects" in props:
            return self.invite(text)
        body = _block(text, "document") or re.sub(r"<[^>]+>", " ", text)
        return fill(schema, " ".join(body.split())[:80])

    @staticmethod
    def invite(text: str) -> dict:
        """La mise en forme d'une invite H3 (server/tools/movie_invite.py) : des plans en anglais qui citent chaque
        entrée, des répliques dans la langue demandée quand la demande parle de dispute, de dialogue."""
        toks = re.findall(r"^(@(?:image|element)\d+): [^\n]*?(?:description: ([^\n]*))?$", _block(text, "inputs"), re.M)
        req = _block(text, "request")
        m = re.search(r"<duration>([\d.]+) seconds", text)
        dur = float(m.group(1)) if m else 5.0
        m = re.search(r"split the video into (\d+) shots", text)
        n = int(m.group(1)) if m else (3 if dur >= 5 else 1)
        lang = _block(text, "spoken_language") or "English"
        who = [t for t, _ in toks] or ["the man"]
        both = " and ".join(who[:2])
        acts = [f"Wide shot of a small kitchen table at noon: {both} sit facing each other over steaming bowls of noodles, "
                "eating with chopsticks. The camera holds a static shot.",
                f"Medium close-up on {who[0]}, who slams his bowl down and points across the table; the camera pushes in "
                "with small amplitude at slow speed.",
                f"{both} stand up and grapple, the table tips over and the bowls shatter on the floor; the camera shakes "
                "strongly as a tracking shot follows them."]
        lines = []
        if re.search(r"disput|argu|dialog|parle|talk", req, re.I):
            fr = lang == "French"
            lines = [{"who": who[0], "language": lang, "text": "Tu as encore pris ma part !" if fr else "You took my share again!",
                      "delivery": "shouts angrily"},
                     {"who": who[-1], "language": lang, "text": "C'est faux, menteur !" if fr else "That's a lie!",
                      "delivery": "snaps back"}]
        shots = [{"start": round(k * dur / n, 1), "description": acts[min(k, len(acts) - 1)], "lines": lines if k == min(1, n - 1) else []}
                 for k in range(n)]
        return {"style": "Live-action, cinematic action film look with hard daylight, high contrast and a handheld camera.",
                "subjects": [{"token": t, "appearance": f"the person described as {d.strip()[:60] or 'in the reference images'}"}
                             for t, d in toks],
                "shots": shots, "soundscape": "Chopsticks clatter on ceramic bowls, then chairs scrape and bowls shatter on the tiles.",
                "music": "N/A", "summary": f"{both} argue over a meal, then fight."}

    @staticmethod
    def _mots(text: str) -> set:
        vides = {"projet", "documents", "document", "première", "toutes", "chapitre", "paragraphe", "autres", "pendant"}
        return {w for w in re.findall(r"[a-zà-ÿ]{6,}", text.lower()) if w not in vides}

    def entree(self, text: str) -> dict:
        """L'entrée : ce qu'il comprend (le brief, les titres), la contradiction quand le brief n'a pas un mot
        de six lettres en commun avec le début des documents, puis 3 ou 4 questions à choix."""
        brief = _block(text, "brief").strip()
        docs = re.findall(r'<document n="\d+" id="[^"]*" title="([^"]*)"[^>]*>\n?(.*?)</document>', _block(text, "documents"), re.S)
        titres = [t for t, _ in docs]
        commun = self._mots(brief) & self._mots(" ".join(t + " " + b for t, b in docs))
        sujet = " ".join(brief.split()[:10]) or "(pas de brief)"
        comp = (f"Le brief demande : {sujet}. Les documents reçus : {', '.join(titres[:4]) or 'aucun'}"
                f"{'…' if len(titres) > 4 else ''}. Je ne sais pas encore la durée ni la cible (faux Ollama).")
        contra, qs = [], []
        if brief and docs and not commun:
            contra.append(f"Le brief parle de « {sujet} », mais les documents parlent de « {titres[0]} »"
                          + (f" et de « {titres[1]} »" if len(titres) > 1 else "") + " : lequel est le projet ?")
            qs.append({"question": "Lequel est le projet ?", "choix": ["Le brief", *[f"« {t} »" for t in titres[:3]]][:5], "plusieurs": False})
        qs.append({"question": "Quel est le livrable ?", "choix": ["Un film de 30 s", "Un film de 60 s", "Un clip de 2 min"], "plusieurs": False})
        qs.append({"question": "Quel ton ?", "choix": ["Chaleureux", "Sombre", "Drôle"], "plusieurs": False})
        if titres:
            qs.append({"question": "Quels documents comptent ?", "choix": titres[:5], "plusieurs": True})
        while len(qs) < 3:
            qs.append({"question": "Pour qui ?", "choix": ["Le grand public", "Des professionnels"], "plusieurs": False})
        return {"comprehension": comp, "contradictions": contra, "questions": qs[:5]}

    def plan(self, text: str) -> dict:
        ans = _block(text, "answers")
        req = _block(text, "request")
        heard = []
        m = re.search(r"(?:on )?écarte[rz]? (.+)", req, re.I)
        if m:
            heard.append(f"On écarte {m.group(1).strip()[:80]}")
        dur = re.search(r"(\d+ s|\d+ min)", ans)
        return {"reponse": "C'est noté (faux Ollama)" + (f" : {dur.group(1)}." if dur else ".") + " Je propose de commencer petit.",
                "decisions": heard,
                "etapes": [{"titre": "Une note qui résume le projet", "pose": "une note : le projet, la durée, le ton"},
                           {"titre": "Une carte d'ambiance", "pose": "une carte Générer image, prête, pas lancée"}]}

    def palier(self, last: dict) -> dict:
        text = last.get("content") or ""
        noms = re.findall(r"^Picture (\d+): ([^«]*)« (.*) »$", _block(text, "pictures"), re.M)
        n = len(last.get("images") or [])
        return {"annonce": f"{f'Les {n} images regardées' if n > 1 else 'L’image regardée'} (faux Ollama) : des aplats de couleur, sans rapport net avec le brief.",
                "pieces": [{"n": int(k), "ce_que_c_est": f"{'trois images d’une vidéo' if 'video' in kind else 'un aplat'} « {t} »"} for k, kind, t in noms],
                "questions": [{"question": "Ces images servent-elles de références ?", "choix": ["Oui, toutes", "Non, on les écarte"], "plusieurs": False}]}

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
        if "do only this step" in req:   # une étape d'un plan accepté : un geste, puis la question de la suite
            if step == 0:
                titre = re.search(r"«(.*?)»", req)
                return "", [call("poser_texte", sorte="note", texte="Synthèse du projet (faux Ollama) : " + (titre.group(1) if titre else ""),
                                 pourquoi="l'étape acceptée")]
            return "Étape faite : une note de synthèse. On passe à la suivante, ou tu changes quelque chose ?", None
        if "on écarte" in req or "je décide" in req:
            if step == 0:
                return "", [call("noter_decision", texte=req.strip().split("\n")[0][:120])]
            return "C'est noté au carnet.", None
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
