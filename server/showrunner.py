#!/usr/bin/env python3
"""Le portail Showrunner Tools : les pages des outils, la bibliothèque,
la file des rendus.

    python3 server/showrunner.py            # port 8790 (showrunner.local.json : "port")
    python3 server/showrunner.py --admin nico007   # secours : crée ou remet ce pseudo admin

Chaque module de `server/tools/` expose `register(app)` : il y déclare
ses routes (`app.route`) et ses travaux (`jobs.register`). Un module qui
ne se charge pas est signalé au démarrage ; les autres outils tournent.
La porte (core/auth.py) est posée devant tout, ici.

Deux points d'écoute (docs/etudes/cloudflare.md, « Prêt à déployer ») :

  la maison         host:port (0.0.0.0:8790)   Cal sur place, le LAN, Tailscale
  la porte publique 127.0.0.1:port+1000 (9790) les tunnels Cloudflare seulement :
                    rien n'y est « le réseau de Cal » (core/auth.py, `app.door`)

Réglage `porte` de showrunner.local.json : `{"mode": "demo"}` par défaut
(tunnel rapide, codes d'invitation : tools/demo.sh), `"access"` (le Worker
de porte/, Cloudflare Access), `"code"` (le Worker de porte/, à l'adresse
fixe, code d'invitation puis pseudo : tools/porte.sh code), `"off"` (pas de
seconde écoute). La porte n'écoute jamais ailleurs que sur le loopback.

    python3 server/showrunner.py --porte-adresse          # « hôte port mode »
    python3 server/showrunner.py --porte-codes            # les codes d'invitation (créés s'il n'y en a pas)
    python3 server/showrunner.py --porte-codes-nouveaux   # d'autres codes : les sessions de la porte se ferment
    python3 server/showrunner.py --porte-url <https://….trycloudflare.com | "">   # l'adresse du tunnel
    python3 server/showrunner.py --porte-lien             # mode, adresse, lien d'invitation, code admin
    python3 server/showrunner.py --ami su007              # un pseudo d'ami créé d'avance, déjà accepté
"""

from __future__ import annotations

import copy
import importlib
import pkgutil
import sys
import threading
import traceback
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from core import auth, config, jobs, library  # noqa: E402
from core.http import App  # noqa: E402


def build() -> App:
    app = App(config.REPO)
    app.gate, app.after = auth.gate, auth.after
    # les copies d'affichage à leur adresse versionnée se gardent un an (library.cache_policy)
    # un document déposé (une page HTML, un SVG, un fichier inconnu) part en téléchargement (library.serve_policy)
    app.mount("library", library.root(), check=library.readable_path, cache=library.cache_policy,
              serve=library.serve_policy)
    # la page d'invitation de la porte « demo » (404 partout ailleurs)
    app.prefix("/invitation/", auth.invitation)
    auth.startup()
    import tools
    loaded, failed = [], []
    for mod in sorted(pkgutil.iter_modules(tools.__path__), key=lambda m: (m.name != "core_api", m.name)):
        try:
            m = importlib.import_module(f"tools.{mod.name}")
            if hasattr(m, "register"):
                m.register(app)
                loaded.append(mod.name)
        except Exception:
            traceback.print_exc()
            failed.append(mod.name)
    print("outils :", ", ".join(loaded) or "aucun", ("· en échec : " + ", ".join(failed)) if failed else "", flush=True)
    return app


def door_app(app: App, mode: str) -> App:
    """L'App de la porte publique : les mêmes routes, relais et dossiers que la
    maison (partagés, pas recopiés), marquée `door` — c'est elle que la porte
    du socle reçoit (`gate(req, app)`) pour chaque requête arrivée sur cette
    écoute. Ses `starters` sont vides : le rattrapage ne part qu'une fois."""
    door = copy.copy(app)
    door.door = mode
    door.starters = []
    return door


def serve_door(app: App, mode: str | None = None, host: str | None = None, port: int | None = None):
    """Ouvre la porte publique dans un fil à part ; rend le fil, ou None si elle reste fermée."""
    ds = auth.door_settings()
    mode, host, port = mode or ds["mode"], host or ds["host"], int(port or ds["port"])
    if mode == "off":
        print("porte publique : fermée (porte.mode = off)", flush=True)
        return None
    if not auth.loopback(host):
        print(f"porte publique : refusée sur {host} — elle n'écoute que sur 127.0.0.1 (les tunnels y arrivent)",
              flush=True)
        return None
    door = door_app(app, mode)

    def run() -> None:
        try:
            door.serve(host, port)
        except OSError as e:
            print(f"porte publique : {host}:{port} ne s'ouvre pas ({e}) ; la maison tourne", flush=True)

    print(f"porte publique ({mode}) : http://{host}:{port}/", flush=True)
    t = threading.Thread(target=run, name="porte", daemon=True)
    t.start()
    return t


def _arg(flag: str) -> str | None:
    k = sys.argv.index(flag)
    return sys.argv[k + 1] if k + 1 < len(sys.argv) else None


def _print_codes(st: dict) -> None:
    print(f"invitation {st.get('invitation', '')}")
    print(f"admin {st.get('admin', '')}")
    print(f"url {st.get('url', '')}")


def main() -> None:
    if "--admin" in sys.argv:
        pseudo = _arg("--admin") or ""
        try:
            u = auth.cli_admin(pseudo)
        except ValueError as e:
            sys.exit(f"--admin <pseudo> : {e}")
        print(f"« {u['pseudo']} » est admin (id {u['id']}) : à l'accueil du portail, taper ce pseudo "
              f"(depuis le réseau de Cal). Le portail en marche le relit seul.")
        return
    if "--ami" in sys.argv:
        try:
            u = auth.create_friend(_arg("--ami") or "", by=f"{auth.admin_id()} (ligne de commande)")
        except auth.HttpError as e:
            sys.exit(f"--ami <pseudo> : {e.message}")
        lien = auth.invite_links().get("lien") or ""
        print(f"« {u['pseudo']} » est un ami, déjà accepté (id {u['id']}) : il entre en tapant ce pseudo"
              + (f", après le lien d'invitation {lien}" if lien else "") + ". Le portail en marche le relit seul.")
        return
    if "--porte-lien" in sys.argv:
        for k, v in auth.invite_links().items():
            print(k, v)
        return
    if "--porte-adresse" in sys.argv:
        ds = auth.door_settings()
        print(ds["host"], ds["port"], ds["mode"])
        return
    if "--porte-codes" in sys.argv or "--porte-codes-nouveaux" in sys.argv:
        _print_codes(auth.demo_codes(renew="--porte-codes-nouveaux" in sys.argv))
        return
    if "--porte-url" in sys.argv:
        try:
            _print_codes(auth.demo_set_url(_arg("--porte-url") or ""))
        except ValueError as e:
            sys.exit(f"--porte-url : {e}")
        return
    app = build()
    jobs.start()
    serve_door(app)
    app.serve(config.get("host"), int(config.get("port")))


if __name__ == "__main__":
    main()
