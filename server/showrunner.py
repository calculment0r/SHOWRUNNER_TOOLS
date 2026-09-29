#!/usr/bin/env python3
"""Le portail Showrunner Tools : les pages des outils, la bibliothèque,
la file des rendus.

    python3 server/showrunner.py            # port 8790 (showrunner.local.json : "port")
    python3 server/showrunner.py --admin nico007   # secours : crée ou remet ce pseudo admin

Chaque module de `server/tools/` expose `register(app)` : il y déclare
ses routes (`app.route`) et ses travaux (`jobs.register`). Un module qui
ne se charge pas est signalé au démarrage ; les autres outils tournent.
La porte (core/auth.py) est posée devant tout, ici.
"""

from __future__ import annotations

import importlib
import pkgutil
import sys
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
    app.mount("library", library.root(), check=library.readable_path, cache=library.cache_policy)
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


def main() -> None:
    if "--admin" in sys.argv:
        k = sys.argv.index("--admin")
        pseudo = sys.argv[k + 1] if k + 1 < len(sys.argv) else ""
        try:
            u = auth.cli_admin(pseudo)
        except ValueError as e:
            sys.exit(f"--admin <pseudo> : {e}")
        print(f"« {u['pseudo']} » est admin (id {u['id']}) : à l'accueil du portail, taper ce pseudo "
              f"(depuis le réseau de Cal). Le portail en marche le relit seul.")
        return
    app = build()
    jobs.start()
    app.serve(config.get("host"), int(config.get("port")))


if __name__ == "__main__":
    main()
