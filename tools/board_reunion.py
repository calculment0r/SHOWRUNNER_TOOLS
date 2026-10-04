#!/usr/bin/env python3
"""La planche d'Idéation de la réunion avec le réalisateur : les ESTABLISHING SHOTS de Montparnasse, années folles.

Lancé sur DGX2, depuis ~/SHOWRUNNER_TOOLS (le portail peut tourner ; le relancer après, pour qu'il voie les images neuves) :

    python3 tools/board_reunion.py --plan                  ce qu'elle contiendra, rien n'est écrit
    python3 tools/board_reunion.py --sans-web              la planche, sans télécharger de photos
    python3 tools/board_reunion.py                         la planche, avec les photos d'époque (Wikimedia Commons)
    options : --team "Années folles"  --espace <nom ou id d'un Workspace de cette Team>  --par-lieu 4  --nom "..."

Ce qu'elle fait :
  1. trouve la Team (« Années folles », sans accents ni majuscules) et son Workspace (le premier non archivé, ou --espace) ;
  2. fabrique la planche : un titre, des cadres rangés en grille — l'ordre du jour, les questions au réalisateur, le calage
     de l'époque, les lieux (un cadre par lieu : sa fiche et ses photos), la rue, les véhicules, la fumée et la lumière, la
     Seine, les pièges d'anachronisme, Seedance, les sources ; le contenu vient de l'étude documentaire « Montparnasse, Paris
     1920-1929 » (les points « à vérifier » le restent) ;
  3. les photos : (a) celles de la bibliothèque dont le titre, le prompt ou les étiquettes parlent du lieu ; (b) des photos
     d'époque libres de Wikimedia Commons (domaine public, CC0 ; CC BY et CC BY-SA acceptées, leur crédit dans le titre),
     téléchargées dans le Workspace de la Team, dossier « Réunion establishing shots ». Le tri est automatique (licence, date
     1900-1939, taille) : à relire à l'œil sur la planche, un lieu mal servi se complète à la main ;
  4. écrit la planche (`ide-….json`) comme le fait le portail, au nom de Cal.
Rien n'est effacé ; une deuxième passe crée une deuxième planche.
"""
import argparse
import json
import re
import sys
import tempfile
import time
import unicodedata
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "server"))

UA = "ShowrunnerTools/1.0 (reunion board; calculmentor@yahoo.fr)"
COMMONS = "https://commons.wikimedia.org/w/api.php"
FOLDER = "Réunion establishing shots"

# ── le contenu ──────────────────────────────────────────────────────────────────────────────────────────────
# (cadre, [blocs]) ; un bloc : ("note", texte) | ("sticky", texte, couleur) | ("img", requête Commons, mots-clés bibliothèque)
# Les lieux : « img » en tête, la fiche ensuite.
OBJECTIFS = [
    ("sticky", "Objectif : se mettre d'accord sur ce que fait CHAQUE establishing shot (où, quand, quelle ambiance) et sur la liste des lieux qu'on fabrique.", "coral-3"),
    ("sticky", "Sortie de la réunion : une liste de plans validés (lieu, heure, saison, météo, mouvement) + les références photo/film qu'on garde.", "verd-3"),
    ("sticky", "Ce qu'on apporte : une base documentaire 1924-1928 (pivot 1926), des pièges d'anachronisme, un pipeline Seedance 2.5 par références.", "amb"),
]
QUESTIONS = [
    "À quoi sert un establishing shot ici : situer (Montparnasse), dater (1926), ou installer un ton ? Les trois ?",
    "Quelle année exacte pour chaque épisode ? La Coupole n'existe pas avant 1927 ; le Select : 1923 ou 1925 (à trancher).",
    "Combien de lieux récurrents ? Un « générique de lieux » (Vavin, Dôme, Rotonde, Coupole, gare) ou du neuf à chaque épisode ?",
    "Durée d'un plan : 3-4 s sec, ou 8-10 s qui respire ? Un plan fixe, ou un mouvement (travelling, grue, pano) ?",
    "Pas de drone en 1926 : on assume une grue / un point haut d'époque, ou on s'autorise le moderne discret ?",
    "Jour, nuit, pluie, hiver (fumée de charbon, brouillard) : une météo par épisode, ou une palette de la série ?",
    "Densité humaine : rue vivante (foule, métiers de rue) ou quasi vide façon « Paris qui dort » ?",
    "Couleur : naturelle sourde type autochrome Albert-Kahn, ou étalonnage de la série ? Qui fixe la LUT ?",
    "Texte à l'image : enseignes lisibles ? (les IA inventent les lettres : on pose le lettrage en post)",
    "Son : ambiance de rue posée sous chaque plan (sabots, tram, klaxon, accordéon) : on la prépare avec le plan ?",
    "Raccords : comment un establishing shot entre-t-il dans la scène (fondu, cut sur la terrasse, carton) ?",
    "Faisabilité IA / tournage / archive : ce qu'on génère, ce qu'on filme, ce qu'on achète (Gaumont Pathé, Albert-Kahn) ?",
]
CHRONO = [
    ("1920-1922", "Sortie de guerre : uniformes bleu horizon, anciens combattants dans la rue ; ourlets mi-mollet. Silhouettes longues, sobres."),
    ("1922", "Citroën 5CV Trèfle ; le chapeau cloche s'impose ; « La Garçonne »."),
    ("1923 / 1925", "Ouverture du Select (sources divergentes). À VÉRIFIER avant de le figer."),
    ("1924", "Bal Blomet (jazz) ; JO de Paris ; Manifeste du surréalisme."),
    ("1925", "Expo des Arts décoratifs : Art déco dans devantures et affiches, encore minoritaire dans la rue ordinaire."),
    ("1925-1927", "Ourlets au genou, cheveux courts, robes droites taille basse. La rue reste plus âgée et plus sobre."),
    ("1927", "OUVERTURE DE LA COUPOLE (piliers peints, mosaïques) : pas de Coupole avant. Vol de Lindbergh."),
    ("1928-1929", "Ourlets qui redescendent ; marquages au sol plus visibles (à vérifier). Ne pas mélanger 1925 et 1929 dans un plan."),
    ("1930", "Fusion Nord-Sud / CMP (métro). Avant : deux réseaux, deux esthétiques de stations."),
    ("1937", "Fin des tramways dans Paris : rails et caténaires présents sur toute la période."),
]
LIEUX = [
    ("Carrefour Vavin", "Montparnasse carrefour Vavin 1920s Dôme Rotonde Select", ("vavin", "montparnasse", "dôme", "rotonde"),
     "Le plan-signature : Dôme, Rotonde, Select (et La Coupole à partir de 1927) se font face. Terrasses pleines, chaises en bois cintré, tables rondes en marbre, bannes. Fin d'après-midi ou nuit : lumière chaude des devantures. Piège : stationnement massif, marquages au sol."),
    ("Boulevard du Montparnasse", "boulevard du Montparnasse Paris 1925", ("boulevard du montparnasse", "montparnasse"),
     "Grand axe de pierre, façades noircies par le charbon, platanes, kiosque à journaux, colonne Morris, tram électrique (rails encastrés dans les pavés). Mélange chevaux / autos / autobus à plateforme ouverte. Piège : autos des années 30, câbles aériens massifs."),
    ("La Coupole (à partir de 1927)", "La Coupole Montparnasse 1927 brasserie", ("coupole",),
     "Ouvre en 1927 : piliers décorés par des artistes, mosaïques, décor Art déco, plus de 100 personnes au service. Interdit avant 1927. Plan d'intérieur ou terrasse ; c'est le marqueur de la fin de la fenêtre."),
    ("Le Dôme et La Rotonde", "Café du Dôme Montparnasse 1920s", ("dôme", "dome", "rotonde"),
     "Dôme (1898, Paul Chambon, Auvergnat), Rotonde (1911) : cafés d'artistes, banquettes en velours, comptoir en zinc, artistes, modèles, Américains expatriés. Facade et terrasse d'époque à relever sur photo avant de figer."),
    ("Gare Montparnasse", "Gare Montparnasse 1920s locomotive vapeur", ("gare montparnasse",),
     "Vapeur et fumée de locomotive, verrière, voyageurs en chapeau, porteurs de valises, taxis Renault AG. Très bon plan d'entrée de ville ; fumée à décrire comme élément de plan (« white steam under the glass roof »)."),
    ("Rue de la Gaîté", "rue de la Gaîté Paris 1920s théâtres music-hall", ("gaîté", "gaite"),
     "Théâtres, music-halls, enseignes lumineuses, nuit animée. Attention aux néons : rares avant la fin de la décennie (à vérifier) ; préférer ampoules, lanternes, réverbères à gaz."),
    ("Ateliers d'artistes, Cité Falguière, La Ruche", "Cité Falguière atelier artistes Paris 1920s", ("atelier", "falguière", "ruche"),
     "Grandes verrières orientées nord, cités d'artistes, murs noircis, pigeons, escaliers extérieurs. Plan de toits fumants (souches de cheminées en groupe) très crédible."),
    ("Bal Blomet, nuit et jazz", "Bal Blomet Paris 1924 jazz", ("blomet", "jazz"),
     "Ouvert en 1924 (rue Blomet) : jazz, musiciens noirs américains, lustres, fumée de tabac. Plan de façade de nuit, enseigne lumineuse sobre, files d'attente en manteaux à col de fourrure."),
    ("Les quais de Seine et les bouquinistes", "quais de Seine bouquinistes Paris 1920s", ("seine", "quai", "bouquiniste"),
     "Pas de voies sur berges : les quais bas sont des ports de travail (péniches, grues, sable, charbon, tonneaux). Bouquinistes : boîtes en bois peint vert foncé aux parapets. Pêcheurs, lavandières, promeneurs."),
    ("Les ponts", "pont des Arts Paris 1920s", ("pont",),
     "Pont-Neuf, Pont des Arts (passerelle piétonne), Pont Royal, Saint-Michel, Alexandre-III. Remorqueurs à vapeur, péniches ; jamais de bateaux-mouches (1949) ni de vedettes à toit vitré."),
    ("Marché et rue populaire", "marché rue Paris 1920s étals", ("marché", "marche", "étal"),
     "Étals de planches sur tréteaux, balances à plateaux, cageots, toiles blanches ou rayées, marchande des quatre-saisons et sa voiture à bras. Densité humaine et sonore, pas de sacs plastique."),
    ("Toits et horizon de Paris", "toits de Paris 1920s cheminées vue", ("toit", "toits", "cheminée"),
     "Établissement par les toits : souches de cheminées en groupe, filets de fumée de charbon (gris sombre) ou de bois (bleutés), façades noircies, Tour Eiffel au loin. Panache mince, pas de brouillard épais."),
]
RUE = [
    "SOLS — pavés de grès, parfois pavés de bois ; macadam ailleurs ; caniveaux, bordures en pierre, rails de tram encastrés. Pas de passages piétons clairs ni de lignes jaunes (à vérifier).",
    "MOBILIER — kiosques en fonte et verre, colonnes Morris, fontaines Wallace vertes, bancs, réverbères à gaz et électriques, bouches de métro Guimard, plaques de rue en émail bleu à lettres blanches.",
    "FAÇADES — immeubles de pierre de 5-6 niveaux, persiennes, balcons filants, ateliers à verrière, pignons aveugles couverts de publicités peintes, murs noircis par le charbon.",
    "DÉTAILS DE VIE — tonneaux, caisses, sacs de charbon, bidons de lait, cageots, linge aux fenêtres, affiches sauvages, palissades de chantier, pigeons, chiens, chevaux.",
    "ABSENT EN 1926 — parcmètres, bollards, panneaux routiers modernes, poteaux à câbles massifs, antennes TV, climatiseurs, mobilier plastique, sacs poubelles, vitrines à led, pistes cyclables peintes.",
]
VEHICULES = [
    "AUTOS — Citroën Type A (1919), 5CV Trèfle (1922), B2, B10, B12, C4 (1928) ; Peugeot Quadrilette ; Renault 6CV NN ; Amilcar, Salmson, Voisin, Delage, Hispano-Suiza, Bugatti 35. Roues à rayons, capote, marchepieds. Pas de carrosserie enveloppante (à vérifier modèle par modèle).",
    "TAXIS — Renault AG « taxi de la Marne » encore en service, carrosseries fermées avec compteur extérieur ; livrée à vérifier sur autochromes.",
    "TRANSPORT PUBLIC — autobus à plateforme arrière ouverte, tramways électriques à perche, métro CMP et Nord-Sud. Pas de bus à plancher bas.",
    "HIPPOMOBILE — tombereaux, haquets de brasseur, charrettes de maraîcher, camions à chevaux (percherons, boulonnais), harnais de cuir, œillères.",
    "DEUX-ROUES ET BRAS — vélos à cadre droit, motos à chaîne, triporteurs, voitures à bras des quatre-saisons.",
    "DENSITÉ — les autos sont minoritaires dans les rues secondaires ; chevaux et charrettes à bras restent communs. Éviter la rue saturée de voitures garées.",
]
FUMEE = [
    "SOURCES — cheminées sur les toits (souches en groupe), tuyaux de poêle aux rez-de-chaussée, braseros de marchands de marrons, locomotives de la gare Montparnasse, remorqueurs à vapeur sur la Seine, usines en périphérie.",
    "COULEUR — charbon : gris sombre ; bois : plus clair, bleuté. Filets et panaches minces plutôt qu'un brouillard épais, surtout l'hiver et par temps humide. À vérifier sur photos d'hiver.",
    "NUIT — réverbères à gaz et électriques mélangés, enseignes de cinémas et cafés, lumière chaude des devantures ; néons rares avant la fin de la décennie (à vérifier).",
    "SEEDANCE — décrire la fumée comme élément de plan (« fine bluish wood smoke rising from a chimney pot »), pas comme calque global ; une planche dédiée sert de référence de forme et de densité.",
    "SURFACES — façades noircies et patinées, trottoirs mouillés par le lavage du matin, vêtements mats et usés (ni neufs ni saturés).",
]
SEINE = [
    "QUAIS BAS — ports de travail pavés : péniches bord à quai, grues, tas de sable et de charbon, tonneaux (Bercy). Pas de voies sur berges.",
    "BATEAUX — péniches en bois ou acier halées ou poussées par remorqueurs à vapeur, bateaux-lavoirs, bains flottants, bateaux-omnibus. « Bateaux-Mouches » = 1949 : interdit.",
    "BOUQUINISTES — boîtes en bois peint vert foncé aux parapets, ouvertes le jour. Pêcheurs à la ligne, lavandières, promeneurs sur les quais hauts.",
    "À REGARDER AVANT DE FIXER — « Études sur Paris » (André Sauvage, 1928) : canal, écluses, Seine à Paris.",
]
PIEGES = [
    ("Vêtements", "Fermeture éclair visible, jean, couleurs néon ; homme nu-tête ou femme sans chapeau dehors ; coiffures contemporaines ; baskets, semelles épaisses ; sacs à dos ; lunettes de soleil modernes."),
    ("Rue", "Marquages au sol, lignes jaunes ; panneaux routiers modernes, parcmètres, barrières métalliques ; voitures des années 30-50 ; câbles aériens massifs, antennes ; façades de verre."),
    ("Matières", "Plastiques brillants, led, néons omniprésents ; tissus parfaitement unis ou neufs ; peintures pâles uniformes (les façades sont noircies)."),
    ("Seine", "Voies sur berges, parkings, bateaux-mouches à toit vitré ; quais déserts (ils sont occupés) ; gilets de sauvetage, bouées modernes."),
    ("Couleur et photo", "Saturation excessive (autochromes : teintes sourdes) ; netteté numérique, bokeh de grand capteur ; étalonnage orange-teal contemporain."),
    ("Mouvement", "Marche trop rapide (muet projeté trop vite : 16-20 i/s) ; foule uniforme ; gestes de téléphone, selfie, regards caméra."),
]
SEEDANCE = [
    "Seedance 2.5 accepte jusqu'à 30 images, 10 vidéos et 10 audio en référence (2.0 : 9 / 3 / 3). Sources : docs Sogni, Kapwing.",
    "Références adressées par étiquette (@Image1, @Image2…) ; un numéro hors du nombre d'images est ignoré en silence ; changer l'ordre change les pointeurs (guide Runware multi-référence).",
    "Pour un establishing shot : 4 à 8 références choisies (un fond de rue, un véhicule, 2-3 figurants, une fumée), pas la planche entière. Test A/B planche entière contre vignettes à faire sur notre pipeline.",
    "Vignettes : fond neutre, lumière douce, sans texte lisible, personnages fictifs et anonymes ; garder prompt, graine et planche d'origine avec chaque vignette.",
    "Clips jusqu'à 30 s ; sortie ni 1080p ni 4K d'après Sogni. Notre H3 : prompts en [Shot n], répliques en <d>.",
]
SOURCES = [
    "Gallica (BnF) — Agence Rol, Meurisse, Mondial Photo Presse : rues, personnages, métiers. gallica.bnf.fr",
    "Europeana — agrège Gallica, filtre par année. europeana.eu",
    "Archives de la Planète, musée Albert-Kahn — SEUL fonds couleur d'époque (autochromes, films 1909-1931) ; open data sur data.gouv.fr.",
    "Paris Musées Collections — 150 000 œuvres en CC0 (Carnavalet, Galliera, Petit Palais). parismuseescollections.paris.fr",
    "Wikimedia Commons — reprises de Gallica, Atget, Rol. Licence indiquée sur chaque fichier.",
    "Retronews / Gallica presse — pubs, faits divers, annonces datées. Lantern (cinéma), Internet Archive (catalogues, films).",
    "Photographes : Atget (jusqu'en 1927), Kertész (Paris dès 1925), Abbott, Man Ray, Krull ; Brassaï surtout après 1930 (fin de fenêtre seulement).",
    "Droits : les photos servent de référence interne ; avant tout usage visible, vérifier la licence image par image. Fonds CC0 de Paris Musées = base la plus sûre.",
]
FILMS = [
    ("Rien que les heures — Cavalcanti, 1926", "Une journée parisienne : rues, ouvriers, bistrots. Domaine public. archive.org"),
    ("Études sur Paris — André Sauvage, 1928", "Canal, péniches, Petite Ceinture : la vie des quais et des ports."),
    ("Paris qui dort — René Clair, 1925", "Paris vide : vues de rues et de monuments (réf. d'un plan quasi sans foule)."),
    ("Le Ballet mécanique — Léger, 1924 / Entr'acte — Clair", "Avant-garde de Montparnasse ; ambiance plus qu'information."),
    ("Ménilmontant — Kirsanoff, 1926", "Rues populaires, pavés, immeubles."),
    ("La Zone — Lacombe, 1928", "Les marges de Paris : chiffonniers, baraques."),
    ("Gaumont Pathé Archives", "Actualités 1908-1979 : « Paris 1925 », « Montparnasse », « Seine » (licence payante)."),
    ("Archives de la Planète (Albert Kahn)", "21 films parisiens en ligne + autochromes."),
]
BANQUE = [  # cadre « banque d'images » : requêtes Commons génériques d'époque
    ("Agence Rol Paris 1926 rue", ("rol", "paris", "1926")),
    ("Paris 1925 rue animation chevaux automobiles", ("paris", "rue")),
    ("Eugène Atget Paris boutique devanture", ("atget", "devanture")),
    ("Paris 1920s autochrome Albert Kahn rue", ("autochrome", "kahn")),
]

STICKY_CYCLE = ["coral-3", "amb", "verd-3", "cy", "coral-2", "paper"]


# ── mise en page ────────────────────────────────────────────────────────────────────────────────────────────
class Board:
    def __init__(self):
        self.nodes, self.n = [], 0

    def nid(self, p):
        self.n += 1
        return f"{p}{self.n}"

    def add(self, **kw):
        kw.setdefault("id", self.nid(kw["type"][:2]))
        self.nodes.append(kw)
        return kw


def lines(text, per=34):
    return sum(max(1, -(-len(p) // per)) for p in text.split("\n"))


def frame(B, name, x, y, cells, cols=3, cw=360, gap=24, pad=28, head=70):
    """Un cadre titré, ses cellules rangées en `cols` colonnes ; rend sa hauteur."""
    cells = [c for c in cells if c]
    colh = [head + pad] * cols
    placed = []
    for c in cells:
        w = cw * c.get("span", 1) + gap * (c.get("span", 1) - 1)
        k = min(range(cols - c.get("span", 1) + 1), key=lambda i: max(colh[i:i + c.get("span", 1)]))
        yy = max(colh[k:k + c.get("span", 1)])
        placed.append((c, pad + k * (cw + gap), yy, w))
        for i in range(k, k + c.get("span", 1)):
            colh[i] = yy + c["h"] + gap
    W = pad * 2 + cols * cw + (cols - 1) * gap
    H = max(colh) + pad - gap
    fr = B.add(type="frame", name=name, x=x, y=y, w=W, h=H)
    B.add(type="title", text=name, size="m", x=x + pad, y=y + 18, w=W - 2 * pad, h=46)
    for c, dx, dy, w in placed:
        node = dict(c["node"])
        node.update(x=x + dx, y=y + dy, w=w, h=c["h"])
        B.add(**node)
    return W, H


def note(text, per=36):
    return {"h": 36 + 21 * lines(text, per), "node": {"type": "note", "text": text}}


def sticky(text, color, per=26):
    return {"h": 40 + 22 * lines(text, per), "node": {"type": "sticky", "text": text, "color": color}}


def image(item_id, title, span=1):
    return {"h": 240 if span == 1 else 300, "span": span, "node": {"type": "media", "kind": "image", "item": item_id, "title": title}}


# ── Commons ─────────────────────────────────────────────────────────────────────────────────────────────────
OKLIC = re.compile(r"public domain|domaine public|cc0|cc[- ]by(?!-nc)|pd[- ]|no restrictions|copyrighted free use", re.I)
BADLIC = re.compile(r"-nc|-nd|non.?commercial|all rights|fair use", re.I)
YEAR = re.compile(r"\b(19[0-3]\d)\b")


def _get(url, timeout=40):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    return urllib.request.urlopen(req, timeout=timeout)


def commons_search(q, want=6):
    """Des photos d'époque libres pour une requête : [{title, url, credit, license, page}]."""
    p = {"action": "query", "generator": "search", "gsrsearch": q + " filetype:bitmap", "gsrnamespace": "6", "gsrlimit": "40",
         "prop": "imageinfo", "iiprop": "url|extmetadata|size|mime", "iiurlwidth": "1600", "format": "json"}
    try:
        with _get(COMMONS + "?" + urllib.parse.urlencode(p)) as r:
            data = json.load(r)
    except Exception as e:
        print(f"  ! Commons injoignable pour « {q} » : {e}")
        return []
    out = []
    for pg in sorted((data.get("query") or {}).get("pages", {}).values(), key=lambda x: x.get("index", 0)):
        ii = (pg.get("imageinfo") or [{}])[0]
        meta = ii.get("extmetadata") or {}
        lic = (meta.get("LicenseShortName") or {}).get("value", "")
        if not ii.get("thumburl") or ii.get("mime") not in ("image/jpeg", "image/png") or not lic:
            continue
        if BADLIC.search(lic) or not OKLIC.search(lic):
            continue
        if (ii.get("width") or 0) < 900:
            continue
        when = " ".join([(meta.get("DateTimeOriginal") or {}).get("value", ""), (meta.get("ImageDescription") or {}).get("value", ""),
                         pg.get("title", "")])
        years = [int(y) for y in YEAR.findall(re.sub(r"<[^>]+>", " ", when))]
        if not years or not all(1900 <= y <= 1939 for y in years):
            continue
        artist = re.sub(r"<[^>]+>", "", (meta.get("Artist") or {}).get("value", "")).strip()[:60]
        title = re.sub(r"^File:|\.\w{3,4}$", "", pg["title"]).strip()[:70]
        out.append({"title": title, "url": ii["thumburl"], "credit": artist, "license": lic, "page": ii.get("descriptionurl", "")})
        if len(out) >= want:
            break
    return out


def download(url, dest: Path):
    with _get(url, 90) as r, open(dest, "wb") as f:
        f.write(r.read())


# ── la bibliothèque ─────────────────────────────────────────────────────────────────────────────────────────
def norm(s):
    return unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode().lower()


def library_matches(library, words, limit):
    out = []
    for it in list(library._items.values()):
        if it.get("kind") != "image" or it.get("trashed") or it.get("deleted"):
            continue
        hay = norm(" ".join([it.get("title", ""), it.get("prompt", ""), " ".join(it.get("tags") or [])]))
        if any(norm(w) in hay for w in words):
            out.append(it)
    out.sort(key=lambda i: i.get("created", ""), reverse=True)
    return out[:limit]


# ── la planche ──────────────────────────────────────────────────────────────────────────────────────────────
def build(B, pics):
    """pics(nom du cadre, requête Commons, mots-clés) → [(item id, titre)]"""
    X, Y = 0, 0
    B.add(type="title", text="RÉUNION RÉALISATEUR — ESTABLISHING SHOTS", size="l", x=0, y=-190, w=1700, h=80)
    B.add(type="note", text="Montparnasse, Paris 1924-1928 (pivot 1926) · base documentaire Nirvalab · pour décider des plans d'établissement de la série",
          x=0, y=-100, w=1700, h=44)
    rows = []   # (nom, cellules, colonnes)

    rows.append(("1 · Objectifs de la réunion", [sticky(t, c) for _, t, c in OBJECTIFS], 3))
    rows.append(("2 · Questions au réalisateur", [sticky(q, STICKY_CYCLE[i % 6]) for i, q in enumerate(QUESTIONS)], 4))
    rows.append(("3 · Caler l'époque (chronologie)", [note(f"{d}\n{t}") for d, t in CHRONO], 3))
    for i, (nom, q, mots, fiche) in enumerate(LIEUX):
        cells = [note(fiche, 42)]
        cells[0]["span"] = 1
        for iid, tt in pics(nom, q, mots):
            cells.append(image(iid, tt))
        rows.append((f"4.{i + 1} · {nom}", cells, 3))
    rows.append(("5 · La rue : sols, mobilier, façades", [note(t) for t in RUE], 3))
    rows.append(("6 · Véhicules et circulation", [note(t) for t in VEHICULES], 3))
    rows.append(("7 · Fumée, lumière, météo", [note(t) for t in FUMEE], 3))
    rows.append(("8 · Seine, quais, ponts", [note(t) for t in SEINE], 3))
    rows.append(("9 · Pièges d'anachronisme (checklist de relecture)", [sticky(f"{a}\n{t}", "coral-1", 30) for a, t in PIEGES], 3))
    rows.append(("10 · Seedance 2.5 : fabriquer un establishing shot", [note(t) for t in SEEDANCE], 3))
    rows.append(("11 · Films d'époque à regarder (mouvement, densité, rythme)", [note(f"{a}\n{b}") for a, b in FILMS], 3))
    rows.append(("12 · Sources (photo, presse, droits)", [note(t) for t in SOURCES], 3))
    bank = []
    for q, mots in BANQUE:
        bank += pics("Banque d'images", q, mots)
    if bank:
        rows.append(("13 · Banque d'images d'époque", [image(i, t) for i, t in bank], 4))

    # en grille de cadres, sur 3 colonnes de cadres, le haut de chaque rangée aligné
    colx, coly, k = [0, 1240, 2480], [0, 0, 0], 0
    heights = []
    for nom, cells, cols in rows:
        k = min(range(3), key=lambda i: coly[i])
        W, H = frame(B, nom, colx[k], coly[k], cells, cols=3)
        coly[k] += H + 90
        heights.append((nom, W, H))
    return heights


def resolve_space(args):
    from core import espaces
    db = espaces._data()
    want = norm(args.team)
    teams = [t for t in db["teams"].values() if want in norm(t.get("name")) and not t.get("archived")]
    if not teams:
        sys.exit(f"aucune Team « {args.team} » (Teams : {', '.join(t.get('name', '?') for t in db['teams'].values())})")
    t = teams[0]
    sps = [s for s in db["spaces"].values() if s.get("team") == t["id"] and not s.get("archived")]
    if args.espace:
        sps = [s for s in sps if args.espace in (s["id"], s.get("name"))] or sys.exit(f"pas de Workspace « {args.espace} » dans {t['name']}")
    if not sps:
        sys.exit(f"la Team « {t['name']} » n'a aucun Workspace actif")
    return t, sps[0]


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--team", default="Années folles")
    ap.add_argument("--espace", default="")
    ap.add_argument("--nom", default="Réunion réalisateur · Establishing shots (Montparnasse 1926)")
    ap.add_argument("--par-lieu", type=int, default=4)
    ap.add_argument("--sans-web", action="store_true")
    ap.add_argument("--plan", action="store_true")
    args = ap.parse_args(argv)

    from core import auth, library
    from tools import ideation, ideation_collab
    library._load()

    if args.plan:
        B = Board()
        hs = build(B, lambda *a: [])
        print(f"{len(B.nodes)} objets, {len(hs)} cadres :")
        for nom, W, H in hs:
            print(f"  - {nom}  ({W}×{H})")
        return 0

    team, space = resolve_space(args)
    print(f"Team « {team['name']} », Workspace « {space.get('name')} » ({space['id']})")
    auth.set_current_space(space["id"])
    tmp = Path(tempfile.mkdtemp(prefix="reunion_"))
    cache = {}
    used = set()
    stats = {"biblio": 0, "commons": 0}

    def pics(nom, q, mots):
        got = []
        for it in library_matches(library, mots, 2):
            if it["id"] not in used and library.space_of(it) == space["id"]:
                used.add(it["id"])
                got.append((it["id"], it.get("title") or "bibliothèque"))
                stats["biblio"] += 1
        if args.sans_web:
            return got
        for c in cache.setdefault(q, commons_search(q, args.par_lieu + 2)):
            if len(got) >= args.par_lieu:
                break
            if c["url"] in used:
                continue
            used.add(c["url"])
            try:
                dest = tmp / f"{len(used):03d}.jpg"
                download(c["url"], dest)
                title = f"{c['title']} · {c['credit'] or 'auteur ?'} · {c['license']} (Commons)"
                it = library.add_file(dest, kind="image", title=title[:200], origin={"tool": "reunion", "source": c["page"]},
                                      prompt=f"{nom} : {q}", tags=["reunion", "establishing", "années folles", "archive"], folder=FOLDER,
                                      extra={"source": {"page": c["page"], "license": c["license"], "credit": c["credit"]}})
                got.append((it["id"], title[:120]))
                stats["commons"] += 1
                print(f"  + {nom} : {c['title']} ({c['license']})")
                time.sleep(0.4)
            except Exception as e:
                print(f"  ! {c['title']} : {e}")
        return got

    B = Board()
    hs = build(B, pics)
    b = ideation.blank(args.nom)
    b["nodes"] = B.nodes
    b = ideation.normalize(b)
    with ideation._lock:
        ideation._write(b)
    owner = auth.user("cal") or next(iter(auth.admins()), None)
    ideation_collab.created(b, owner)
    print(f"\nPlanche « {b['name']} » : {b['id']}  ({len(b['nodes'])} objets, {stats['biblio']} images de la bibliothèque, "
          f"{stats['commons']} photos de Commons)")
    print("Relancer le portail pour qu'il voie les images neuves : tools/portail.sh restart, puis ouvrir Idéation.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
