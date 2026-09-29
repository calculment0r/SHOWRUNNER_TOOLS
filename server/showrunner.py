#!/usr/bin/env python3
"""Le portail Showrunner Tools : les pages des outils, la bibliothèque,
la file des rendus.

    python3 server/showrunner.py            # port 8790 (showrunner.local.json : "port")
    python3 server/showrunner.py --code-admin   # écrit un code admin à usage unique et l'affiche

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
    app.mount("library", library.root(), check=library.readable_path)
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
    if "--code-admin" in sys.argv:
        code = auth.new_admin_code(in_server=False)
        print(f"code admin à usage unique : {code}\n(écrit dans {auth.admin_code_file()} ; à l'accueil du portail : "
              "« J'ai un code »)")
        return
    app = build()
    jobs.start()
    app.serve(config.get("host"), int(config.get("port")))


if __name__ == "__main__":
    main()
