"""Les mentions « @ » : UNE grammaire pour la personne, dans tous les outils (Cal, 09/10/2026 : « il faut que le
user puisse le faire tout le temps de la même façon »).

La personne écrit toujours la même chose : `@image1`, `@element2`, `@video1`, `@audio1` — une sorte et une place,
comptées dans l'ordre de ses entrées, chaque sorte à part (décision de Cal du 29/09 : « on ne les nomme pas par leur
nom mais par @image1 @image2… car très souvent on veut garder le prompt mais changer les images de ref »). C'est
la grammaire de l'autocomplétion des pages (commun/arobase.js, commun/entrees.js, commun/mentions.js : le même motif).

Chaque modèle lit ses entrées autrement ; ce module ne connaît aucun modèle. Un outil lui donne la table de SES
places (`{clé: ce que le modèle lit}`) et il rend :

    scan(texte)              les mentions trouvées, dans l'ordre (jamais une adresse mél : « cal@ex.fr »)
    check(textes, table)     (celles qui ne pointent vers rien, les clés citées) — la page les rougit en direct,
                             le serveur refuse un rendu qui en a encore (« signalée avant le rendu »)
    swap(texte, table)       le texte compilé : chaque mention remplacée par ce que le modèle lit
    places(sortes)           la table des clés d'un carrousel mélangé (images et éléments à la suite) : chaque sorte
                             a son compte, la place k du carrousel garde son indice

Les conventions documentées de chaque modèle (l'audit du 09/10, docs/etudes/movie.md et image.md) :
    MiniMax H3        `<Picture i>`, `<Video k>`, `<Audio j>`, 1-based par sorte, dans l'ordre images, vidéos, sons
                      (comfy/text_encoders/minimax.py : « <Picture %d>: » devant chaque image) ; `<Subject N>` pour un
                      contenu défini dans subject_definitions (guide ref-en, MiniMax-AI/MiniMax-H3, skills/h3-prompt-writing)
    Qwen-Image 2.1    `<image1>`, `<image2>`… (comfy/text_encoders/qwen_image21.py : « <image%d> » devant chaque image)
    Qwen-Image-Edit   « Picture 1: » (TextEncodeQwenImageEditPlus, comfy_extras/nodes_qwen.py) — l'outil Angle seul,
    2511              qui n'a pas de prompt libre
    Krea 2            aucune étiquette documentée : deux entrées, la scène puis le sujet (README comfyui-krea2edit)
    Z-Image           aucune entrée d'image
"""

from __future__ import annotations

import re

CATS = ("image", "element", "video", "audio")
# @ + une sorte + une place ; pas après une lettre, un chiffre, « _ » ni « @ » (une adresse mél n'en est pas une) —
# le même motif que commun/mentions.js (TOKEN_RX)
RX = re.compile(r"(?<![^\W_]|[@_])@([^\W\d]+)(\d*)")


def key(cat: str, num: str | int) -> str:
    return f"{str(cat).lower()}{num}"


def scan(text: str) -> list[dict]:
    """Les mentions d'un texte : {raw, cat, n, key, start, end}. `n` vaut 0 sans numéro (« @image »)."""
    out = []
    for m in RX.finditer(text or ""):
        out.append({"raw": m.group(0), "cat": m.group(1).lower(), "n": int(m.group(2) or 0), "key": key(m.group(1), m.group(2)),
                    "start": m.start(), "end": m.end()})
    return out


def check(texts, table: dict) -> tuple[list[str], set[str]]:
    """(les mentions qui ne pointent vers rien, telles qu'écrites et sans doublon ; les clés citées)."""
    bad, seen = [], set()
    for t in texts:
        for m in scan(t):
            seen.add(m["key"])
            if m["key"] not in table and m["raw"] not in bad:
                bad.append(m["raw"])
    return bad, seen


def swap(text: str, table: dict) -> str:
    """Chaque mention remplacée par ce que le modèle lit ; une mention sans place reste telle quelle (check la dit)."""
    return RX.sub(lambda m: table.get(key(m.group(1), m.group(2)), m.group(0)), text or "")


def places(kinds: list[str]) -> list[str]:
    """Les clés d'un carrousel mélangé, dans son ordre : ['image', 'element', 'image'] → ['image1', 'element1',
    'image2'] — la règle de commun/entrees.js (une sorte, une place, chaque sorte comptée à part)."""
    seen: dict[str, int] = {}
    out = []
    for k in kinds:
        seen[k] = seen.get(k, 0) + 1
        out.append(key(k, seen[k]))
    return out


# ── la langue d'un prompt, hors répliques ───────────────────
# H3 : « Write all six rewrite sections in English. Preserve the original language only for dialogue and lyrics
# inside <d> and for text visibly present in the scene » (guide ref-en ; base-en, SKILL.md : « Write rewrite
# sections in English »). Ce relevé ne traduit rien : il dit qu'un texte est en français pour que la page le montre
# avant le rendu. Les mots-outils seuls comptent (ni les noms, ni les mentions, ni les étiquettes, ni ce qui est entre
# guillemets — une enseigne — ni dans <d>…</d>) ; « a », « on », « son » sont dans les deux langues : ignorés.
_FR = set("le la les des du de et il ils elle elles se un une est sont dans avec pour sur qui que au aux en ne pas sa ses "
          "leur leurs ce cette ces mais ou où puis très plus comme nous vous je tu lui été être avoir fait font vers chez "
          "sous sans entre aussi donc alors encore quand dont".split())
_EN = set("the an and of in with is are his her he she they them to at from as by their it its while then into this "
          "that these those was were be been has have which who whom when where through toward towards him".split())


def langue(text: str) -> str:
    """« fr », « en » ou « ? » (trop peu de mots-outils pour le dire)."""
    t = re.sub(r"<d>.*?</d>", " ", text or "", flags=re.S)
    t = re.sub(r"[\"“«][^\"”»]*[\"”»]", " ", t)
    t = RX.sub(" ", re.sub(r"<[^>]*>|\[[^\]]*\]", " ", t))
    words = re.findall(r"[^\W\d_]+(?:['’][^\W\d_]+)?", t.lower())
    words = [w.split("'")[-1].split("’")[-1] if ("'" in w or "’" in w) else w for w in words]
    fr = sum(w in _FR for w in words) + sum(1 for w in re.findall(r"\b[ldjnmst]['’]", t.lower()))
    en = sum(w in _EN for w in words)
    if fr + en < 3:
        return "?"
    return "fr" if fr > en else "en"


def selftest(ok) -> None:
    """Appelé par le selftest de movie.py (le socle n'en a pas à lui)."""
    got = scan("@element1 mange avec @Image2, écrit à cal@ex.fr ; @video ; @@audio1 ; x_@image3")
    ok([m["key"] for m in got] == ["element1", "image2", "video"], f"mentions : le motif, sans adresse mél ni @@ ({got})")
    bad, seen = check(["@image1 et @element2", "@audio1"], {"image1": "<Subject 1>", "audio1": "<Audio 1>"})
    ok(bad == ["@element2"] and seen == {"image1", "element2", "audio1"}, f"mentions : ce qui ne pointe vers rien ({bad})")
    ok(swap("@image1 près de @image2", {"image1": "<image1>"}) == "<image1> près de @image2", "mentions : compilées, l'inconnue reste")
    ok(places(["image", "element", "image", "element"]) == ["image1", "element1", "image2", "element2"],
       "mentions : un carrousel mélangé compte chaque sorte à part")
    cal = "il mange des @element1 et @element2 se dispute en francais, il en viennent aux main , cinema d'action"
    ok(langue(cal) == "fr" and langue("<Subject 1> eats noodles at the table while <Subject 2> argues with him (S1) says: "
                                      "<d>[French] Tu m'as volé ma part !</d>") == "en"
       and langue('A neon sign reading "Ouvert la nuit" glows above the door of the shop.') == "en" and langue("@image1") == "?",
       "mentions : la langue d'un prompt, hors répliques et enseignes")
