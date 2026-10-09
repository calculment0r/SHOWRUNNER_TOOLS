"""La barre de création de la page Vidéo et son Multishot (09/10/2026) : les contrôles de ce que la page fait
seule, sans route à elle — les routes restent celles de server/tools/movie.py et movie_invite.py.

Cal, 09/10 : « le multishot s'affiche en bas au-dessus du fil comme la barre de création pour les images … Je
n'arrive pas à modifier les longueurs de plan par leurs handles sur la timeline. » La frise (commun/multishot.js)
s'appuie sur des fonctions pures (commun/multishot_texte.js) : les plans en images entières, la coupe à l'image
près (le total ne bouge pas), la fin aimantée à la grille d'H3, le plan qui change de place avec sa durée, les
temps de coupe du guide d'H3 (« [Shot 2] At 00:01.708, »). Ce module les mène par node, comme l'Idéation mène
ideation/ports.js, et vérifie le contrat de la page (la barre commune, le Multishot dans la barre, les feuilles
sans couleur en dur ni bordure) et ce que garde une vidéo pour « Réutiliser » (les plans, le résumé).
"""

from __future__ import annotations

import json
import re

from core import config

# le scénario est ici, multishot_texte.js répond, le contrôle compare
_MS_JS = r"""
const M = await import(process.env.MS_URL);
const grid = JSON.parse(process.env.GRID);
const R = {};
const fr = (s) => s.map((p) => p.frames);
let s = M.equalFrames(3, 124);
R.equal = [fr(s), s.every((p) => Math.abs(p.secs - p.frames / 24) < 1e-9)];
M.cutFrames(s, 0, 18); R.cut = fr(s);
M.cutFrames(s, 0, 999); R.cut_max = fr(s);
M.cutFrames(s, 1, 999); R.cut_next = fr(s);
R.snap = [M.snapTotal(200, grid), M.snapTotal(10, grid), M.snapTotal(999, grid)];
s = M.equalFrames(3, 175);
M.trimEnd(s, 141); R.trim_short = fr(s);
M.trimEnd(s, 362); R.trim_long = fr(s);
M.trimEnd(s, 36); R.trim_floor = fr(s);
s = M.equalFrames(3, 124); s[0].text = 'a'; s[1].text = 'b'; s[2].text = 'c'; M.cutFrames(s, 0, 10);
M.moveShot(s, 2, 0); R.move = [s.map((p) => p.text).join(''), fr(s)];
M.splitFrames(s, 1); R.split = fr(s);
M.removeFrames(s, 3); R.remove = fr(s);
R.starts = M.starts(s);
R.split_short = fr(M.splitFrames([Object.assign(M.plan(1), { frames: 20 })], 0));
R.max = [M.maxShots(124), M.MIN_FRAMES];
// la forme du guide d'H3 : le premier plan sans temps, les suivants avec leur temps de coupe, à la milliseconde
s = M.equalFrames(3, 124); s[0].text = 'Wide shot.'; s[1].text = 'Close up.'; s[1].lines = [{ who: '@element1', text: 'Encore toi ?' }]; s[2].text = 'Pull out.';
R.text = M.compose(s, { lang: 'fr' });
// retour : les temps de coupe redonnent les durées
R.back = M.parse(R.text, 124 / 24).map((p) => Math.round(p.secs * 10) / 10);
R.fit = fr(M.fitFrames(M.parse(R.text, 124 / 24), 124));
console.log(JSON.stringify(R));
"""


def selftest(call, ok) -> None:
    import os
    import shutil
    import subprocess
    from tools import movie

    st, opts = call("GET", "/api/movie/options")
    grid = [f["frames"] for f in opts.get("frames", [])]
    ok(st == 200 and grid and all(f % 17 == 5 and 124 <= f <= 362 for f in grid) and grid == sorted(grid),
       "multishot : la grille de la poignée de fin (les durées d'/api/movie/options) est celle d'H3, 17k+5, de 124 à 362 images")

    node = shutil.which("node")
    if not node:
        ok(True, "multishot : node absent, les fonctions de la frise ne sont pas essayées ici")
    else:
        env = {**os.environ, "MS_URL": (config.REPO / "commun" / "multishot_texte.js").as_uri(), "GRID": json.dumps(grid)}
        r = subprocess.run([node, "--input-type=module", "-e", _MS_JS], capture_output=True, text=True, timeout=60, env=env)
        try:
            R = json.loads(r.stdout.strip().splitlines()[-1])
        except (ValueError, IndexError):
            ok(False, f"multishot : multishot_texte.js ne répond pas ({r.returncode} {r.stderr[-400:]})")
            R = None
        if R:
            ok(R["equal"] == [[41, 41, 42], True], f"multishot : trois plans égaux en images entières, les secondes suivent ({R['equal']})")
            ok(R["cut"] == [59, 23, 42] and R["cut_max"] == [70, 12, 42] and R["cut_next"] == [70, 42, 12],
               f"multishot : la coupe se déplace à l'image près, le total ne bouge pas, chaque plan garde 12 images ({R['cut']} {R['cut_max']} {R['cut_next']})")
            ok(R["snap"] == [192, 124, 362], f"multishot : la fin s'aimante à la durée permise la plus proche ({R['snap']})")
            ok(R["trim_short"] == [58, 58, 25] and R["trim_long"] == [58, 58, 246] and R["trim_floor"] == [12, 12, 12],
               f"multishot : la fin raccourcit le dernier plan, puis les autres jusqu'à leur minimum ({R['trim_short']} {R['trim_long']} {R['trim_floor']})")
            ok(R["move"] == ["cab", [42, 51, 31]], f"multishot : un plan déplacé emporte sa durée et son texte ({R['move']})")
            ok(R["split"] == [42, 26, 25, 31] and R["remove"] == [42, 26, 56] and R["starts"] == [0, 42, 68],
               f"multishot : couper un plan, en retirer un (sa durée au voisin), les débuts ({R['split']} {R['remove']} {R['starts']})")
            ok(R["split_short"] == [20] and R["max"] == [10, 12], f"multishot : un plan trop court ne se coupe pas ({R['split_short']} {R['max']})")
            ok(R["text"] == "[Shot 1] Wide shot.\n[Shot 2] At 00:01.708, Close up. @element1 (S1) says: <d>[French] Encore toi ?</d>\n"
                            "[Shot 3] At 00:03.417, Pull out.",
               f"multishot : la forme du guide d'H3, les temps de coupe des images entières ({R['text']!r})")
            ok(R["back"] == [1.7, 1.7, 1.7] and R["fit"] == [41, 41, 42], f"multishot : les temps de coupe relus redonnent les durées ({R['back']} {R['fit']})")

    # « Réutiliser » : une vidéo garde ses plans et son résumé (server/tools/movie.py, REQUEST_KEYS)
    ms = {"shots": [{"frames": 70, "text": "Wide.", "lines": []}, {"frames": 54, "text": "Close.", "lines": []}], "lang": "fr"}
    got = movie.request_of({"request": {"desc": "[Shot 1] Wide.", "multishot": ms, "summary": "A man.", "format": "16:9", "bidon": 1}})
    ok(got.get("multishot") == ms and got.get("summary") == "A man." and got.get("format") == "16:9" and "bidon" not in got,
       f"multishot : une vidéo garde ses plans, son résumé, son format pour « Réutiliser » ({sorted(got)})")

    # le contrat de la page : la barre commune en bas, le Multishot dedans (plus une fenêtre), les feuilles du thème
    st, page = call("GET", "/movie/")
    page = page.decode() if isinstance(page, bytes) else str(page)
    ok(st == 200 and "../commun/barre.css" in page and "../commun/multishot.css" in page and 'id="pbar"' in page and 'id="ms"' in page,
       "la page Vidéo : la barre de création commune en bas, le Multishot dans la barre")
    st, ipage = call("GET", "/image/")
    ipage = ipage.decode() if isinstance(ipage, bytes) else str(ipage)
    ok(st == 200 and "../commun/barre.css" in ipage, "la page Image prend la même barre (commun/barre.css)")
    mjs = (config.REPO / "movie" / "movie.js").read_text(encoding="utf-8")
    ok("createMultishot(" in mjs and "openMultishot" not in mjs and "layout: 'rangee'" in mjs and "movie/apercu" in mjs and "movie/invite" in mjs,
       "movie.js : le Multishot monté dans la barre, les entrées en rangée, l'aperçu et la mise en forme de l'invite")
    for name in ("commun/barre.css", "commun/multishot.css", "commun/entrees.css", "movie/movie.css"):
        css = (config.REPO / name).read_text(encoding="utf-8")
        body = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
        ok(not re.search(r"#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(", body), f"{name} : aucune couleur en dur (tokens.css seulement)")
        ok(not re.search(r"(?<![\w-])border(-(top|right|bottom|left))?\s*:(?!\s*(none|0)\b)", body), f"{name} : des filets, jamais de bordures")
    st, sjs = call("GET", "/commun/shell.js")
    sjs = sjs.decode() if isinstance(sjs, bytes) else str(sjs)
    ok("t.includes(CF_MIME) && kinds.includes('element')" in sjs and "cf/import" in sjs,
       "dropZone prend aussi un personnage de Character Factory glissé du panneau Asset (importé au dépôt)")
