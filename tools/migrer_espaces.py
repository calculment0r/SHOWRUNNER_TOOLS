#!/usr/bin/env python3
"""La migration vers Teams et Workspaces (docs/etudes/equipes_espaces.md § 5.1,
étape 3) : la Team « Nirvalab » (propriétaire Cal), son Workspace « Général »,
les amis Studio membres, une Team personnelle (My Team) par compte, chaque objet,
document et travail sans `space` dans Général. Idempotente : relancée, elle ne
change rien. Le code : server/core/espaces.py, `migrate`.

    python3 tools/migrer_espaces.py --donnees /tmp/copie --a-blanc   # ce qu'elle ferait, rien d'écrit
    python3 tools/migrer_espaces.py --donnees /tmp/copie             # la faire (sauvegarde d'abord)

Portail ARRÊTÉ (tools/portail.sh stop) : la bibliothèque et la file gardent leurs
fiches en mémoire et les réécriraient sans `space`. Sans --donnees : le dossier de
données du portail (showrunner.local.json, SHOWRUNNER_DATA), et il faut le dire
(--vraies-donnees) : on ne migre pas les vraies données par mégarde.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "server"))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--donnees", help="le dossier de données à migrer (une copie pour l'essai)")
    ap.add_argument("--vraies-donnees", action="store_true", help="migrer le dossier de données du portail lui-même")
    ap.add_argument("--a-blanc", action="store_true", help="dire ce qu'elle ferait, sans rien écrire")
    a = ap.parse_args()
    if a.donnees:
        os.environ["SHOWRUNNER_DATA"] = str(Path(a.donnees).expanduser().resolve())
    elif not a.vraies_donnees:
        ap.error("--donnees <dossier> (une copie), ou --vraies-donnees (le portail arrêté)")
    from core import config, espaces   # après SHOWRUNNER_DATA : config le lit à l'import
    root = config.data_dir()
    if not (root / "auth.json").exists():
        ap.error(f"{root} : pas d'auth.json, ce n'est pas un dossier de données du portail")
    rep = espaces.migrate(root, dry=a.a_blanc)
    print(json.dumps(rep, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
