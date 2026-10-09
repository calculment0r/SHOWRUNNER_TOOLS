#!/usr/bin/env python3
"""Un faux Telegram, pour essayer les alertes de Cal sans téléphone (server/core/alertes.py).

    python3 tools/faux_telegram.py --port 8832 --jeton 123456:faux-jeton-pour-les-essais-0000 --chat 4242

Il répond comme l'API de bot (https://core.telegram.org/bots/api ; relue dans
@grammyjs/types 5.0.0) à ce que le portail appelle : POST /bot<jeton>/<méthode>, un corps JSON ;
la réponse {ok, result} ou {ok: false, error_code, description} (un jeton faux : 401
« Unauthorized ») :

  getMe                un bot d'essai (`username`) ;
  sendMessage          un message rangé (chat_id, text, reply_markup) ; un chat inconnu : 400 ;
  editMessageText      le message changé (son texte, ses boutons : absents, ils s'en vont) ;
  answerCallbackQuery  la réponse à un clic, rangée ;
  getUpdates           les mises à jour d'offset ≥ celui demandé (un offset plus grand confirme les
                       précédentes : elles s'oublient), attendues au plus `timeout` secondes
                       (`max_attente` : moins, pour les essais).

Ce que fait Cal, simulé : `ecrit(texte)` (un message de son chat : « /start <code> »), `clic(data |
bouton, …)` (un bouton pressé, depuis son chat ou un autre). Réglable : `lent` (secondes par
méthode : Telegram qui ne répond pas — il attend, puis ne range rien), `panne` (500 partout). Par l'objet (les selftests :
server/tools/alertes.py) ou par HTTP, sans jeton :
  GET  /_faux                         ce qui a été reçu (messages, modifications, réponses)
  POST /_faux/ecrit {text, chat_id?}  POST /_faux/clic {data | bouton, message_id?, chat_id?}
  POST /_faux {lent, panne}
Le portail d'essai le prend de SR_TELEGRAM_URL (tools/portail_essai.py) ; le jeton se colle
dans Admin → Demandes → Alertes comme le vrai.
"""

from __future__ import annotations

import argparse
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

JETON = "123456:faux-jeton-pour-les-essais-0000"


class Faux:
    def __init__(self, token: str = JETON, chat_id: int = 4242, bot: str = "portail_essai_bot", max_attente: float = 50.0):
        self.token, self.chat_id, self.bot, self.max_attente = token, int(chat_id), bot, max_attente
        self.messages: list[dict] = []    # ce que le bot a envoyé (et ce qu'il en a fait depuis)
        self.edits: list[dict] = []
        self.answers: list[dict] = []
        self.calls: list[str] = []        # les méthodes appelées, dans l'ordre (sans le jeton)
        self.updates: list[dict] = []     # ce qui attend getUpdates
        self.lent: dict[str, float] = {}
        self.panne = False
        self.cv = threading.Condition()
        self._uid, self._mid = 100, 500
        self.srv = None
        self.url = ""

    # ── Cal, simulé ──────────────────────────────────────────
    def _push(self, kind: str, obj: dict) -> dict:
        with self.cv:
            self._uid += 1
            up = {"update_id": self._uid, kind: obj}
            self.updates.append(up)
            self.cv.notify_all()
            return up

    def ecrit(self, text: str, chat_id: int | None = None, prenom: str = "Cal", username: str = "cal_essai") -> dict:
        chat = {"id": int(chat_id or self.chat_id), "type": "private", "first_name": prenom, "username": username}
        with self.cv:
            self._mid += 1
            mid = self._mid
        return self._push("message", {"message_id": mid, "date": int(time.time()), "chat": chat, "text": text,
                                      "from": {"id": chat["id"], "is_bot": False, "first_name": prenom}})

    def dernier(self, bouton: str | None = None) -> dict | None:
        """Le dernier message qui a des boutons (celui dont un bouton porte ce texte, s'il est dit)."""
        with self.cv:
            for m in reversed(self.messages):
                kb = (m.get("reply_markup") or {}).get("inline_keyboard") or []
                if kb and (bouton is None or any(b.get("text", "").startswith(bouton) for row in kb for b in row)):
                    return m
        return None

    def clic(self, data: str | None = None, *, bouton: str | None = None, message_id: int | None = None,
             chat_id: int | None = None) -> dict:
        """Un bouton pressé : `data` (callback_data), ou le texte d'un bouton du dernier message qui en a."""
        with self.cv:
            m = next((x for x in self.messages if x["message_id"] == message_id), None) if message_id else None
        m = m or self.dernier(bouton)
        if m and data is None:
            kb = (m.get("reply_markup") or {}).get("inline_keyboard") or []
            data = next((b["callback_data"] for row in kb for b in row if b.get("text", "").startswith(bouton or "")), None)
        # le chat d'où vient le clic : celui du message ; un autre (`chat_id`) simule un clic qui n'est pas de Cal
        cid = int(chat_id) if chat_id is not None else int((m or {}).get("chat_id") or self.chat_id)
        msg = {"message_id": (m or {}).get("message_id", 1), "date": int(time.time()),
               "chat": {"id": cid, "type": "private"}, "text": (m or {}).get("text", "")}
        with self.cv:
            self._uid += 1
            qid = f"cq{self._uid}"
        return self._push("callback_query", {"id": qid, "from": {"id": cid, "is_bot": False, "first_name": "Cal"},
                                             "message": msg, "chat_instance": "essai", "data": data or ""})

    def attendre(self, cond, t: float = 5.0) -> bool:
        end = time.time() + t
        while time.time() < end:
            if cond():
                return True
            time.sleep(0.05)
        return bool(cond())

    def etat(self) -> dict:
        with self.cv:
            return {"messages": json.loads(json.dumps(self.messages)), "edits": len(self.edits), "answers": list(self.answers),
                    "calls": list(self.calls), "en_attente": len(self.updates)}

    # ── l'API ────────────────────────────────────────────────
    def _message(self, chat_id, text: str, markup=None) -> dict:
        with self.cv:
            self._mid += 1
            m = {"message_id": self._mid, "chat_id": int(chat_id), "date": int(time.time()), "text": text}
            if markup:
                m["reply_markup"] = markup
            self.messages.append(m)
            return m

    def appel(self, method: str, p: dict):
        """(code, réponse) d'une méthode de l'API."""
        if self.lent.get(method):   # Telegram qui ne répond pas : rien n'est rangé, l'appelant a renoncé
            time.sleep(float(self.lent[method]))
            return 504, {"ok": False, "error_code": 504, "description": "Gateway Timeout (faux)"}
        if self.panne:
            return 500, {"ok": False, "error_code": 500, "description": "Internal Server Error (faux)"}
        bad = lambda d: (400, {"ok": False, "error_code": 400, "description": f"Bad Request: {d}"})   # noqa: E731
        if method == "getMe":
            return 200, {"ok": True, "result": {"id": int(self.token.split(":")[0]), "is_bot": True,
                                                "first_name": "Portail essai", "username": self.bot}}
        if method == "sendMessage":
            try:
                cid = int(p.get("chat_id"))
            except (TypeError, ValueError):
                return bad("chat not found")
            text = str(p.get("text") or "")
            if not text or len(text) > 4096:
                return bad("message text is empty or too long")
            m = self._message(cid, text, p.get("reply_markup"))
            return 200, {"ok": True, "result": {"message_id": m["message_id"], "date": m["date"], "text": text,
                                                "chat": {"id": cid, "type": "private"}}}
        if method == "editMessageText":
            with self.cv:
                m = next((x for x in self.messages if x["message_id"] == p.get("message_id")
                          and str(x["chat_id"]) == str(p.get("chat_id"))), None)
                if not m:
                    return bad("message to edit not found")
                m["text"] = str(p.get("text") or "")
                if p.get("reply_markup"):
                    m["reply_markup"] = p["reply_markup"]
                else:
                    m.pop("reply_markup", None)
                self.edits.append({"message_id": m["message_id"], "text": m["text"]})
            return 200, {"ok": True, "result": {"message_id": m["message_id"], "text": m["text"]}}
        if method == "answerCallbackQuery":
            with self.cv:
                self.answers.append({"id": p.get("callback_query_id"), "text": p.get("text") or ""})
            return 200, {"ok": True, "result": True}
        if method == "getUpdates":
            off = int(p.get("offset") or 0)
            wait = min(float(p.get("timeout") or 0), self.max_attente)
            end = time.time() + wait
            with self.cv:
                while True:
                    self.updates = [u for u in self.updates if u["update_id"] >= off]   # confirmées : oubliées
                    if self.updates or time.time() >= end:
                        break
                    self.cv.wait(max(0.01, end - time.time()))
                return 200, {"ok": True, "result": list(self.updates)[:int(p.get("limit") or 100)]}
        return 404, {"ok": False, "error_code": 404, "description": "Not Found: method not found"}

    # ── le serveur ───────────────────────────────────────────
    def start(self, port: int = 0, host: str = "127.0.0.1") -> str:
        outer = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _send(self, code: int, obj):
                data = json.dumps(obj, ensure_ascii=False).encode()
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def _body(self) -> dict:
                try:
                    d = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
                except ValueError:
                    d = {}
                return d if isinstance(d, dict) else {}

            def do_GET(self):
                if self.path == "/_faux":
                    return self._send(200, outer.etat())
                return self.do_POST()

            def do_POST(self):
                if self.path.startswith("/_faux"):
                    d = self._body()
                    if self.path == "/_faux/ecrit":
                        return self._send(200, outer.ecrit(str(d.get("text") or ""), d.get("chat_id")))
                    if self.path == "/_faux/clic":
                        return self._send(200, outer.clic(d.get("data"), bouton=d.get("bouton"), message_id=d.get("message_id"),
                                                          chat_id=d.get("chat_id")))
                    for k in ("lent", "panne"):
                        if k in d:
                            setattr(outer, k, d[k])
                    return self._send(200, {"ok": True})
                parts = self.path.split("?", 1)[0].strip("/").split("/")
                if len(parts) != 2 or not parts[0].startswith("bot"):
                    return self._send(404, {"ok": False, "error_code": 404, "description": "Not Found"})
                if parts[0][3:] != outer.token:
                    return self._send(401, {"ok": False, "error_code": 401, "description": "Unauthorized"})
                with outer.cv:
                    outer.calls.append(parts[1])
                code, doc = outer.appel(parts[1], self._body())
                return self._send(code, doc)

        class S(ThreadingHTTPServer):
            daemon_threads = True

            def handle_error(self, request, client_address):   # l'appelant a renoncé (`lent`) : rien à dire
                import sys
                if not isinstance(sys.exc_info()[1], (BrokenPipeError, ConnectionResetError)):
                    super().handle_error(request, client_address)

        self.srv = S((host, port), H)
        threading.Thread(target=self.srv.serve_forever, daemon=True, name="faux-telegram").start()
        self.url = f"http://{host}:{self.srv.server_address[1]}"
        return self.url

    def close(self) -> None:
        if self.srv:
            with self.cv:
                self.cv.notify_all()
            self.srv.shutdown()
            self.srv.server_close()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--port", type=int, default=8832)
    ap.add_argument("--jeton", default=JETON, help="le jeton que le faux accepte (à coller dans Admin → Alertes)")
    ap.add_argument("--chat", type=int, default=4242, help="le chat de « Cal »")
    ap.add_argument("--attente", type=float, default=5.0, help="getUpdates attend au plus ces secondes")
    a = ap.parse_args()
    f = Faux(a.jeton, a.chat, max_attente=a.attente)
    print("faux Telegram :", f.start(a.port), flush=True)
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        f.close()


if __name__ == "__main__":
    main()
