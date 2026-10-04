"""La porte publique (le second point d'écoute, 127.0.0.1:<port + 1000>) :
son contrôle. La porte elle-même est dans core/auth.py (`_door_gate`,
`invitation`, `_access_user`) et server/showrunner.py (`serve_door`) ;
ce module ne fait que garder l'App pour que le contrôle ouvre une porte à
côté du portail d'essai, sur des ports libres, comme le ferait un tunnel :
tout y arrive de 127.0.0.1, avec les en-têtes que pose Cloudflare.

Ce que le contrôle prouve (docs/etudes/cloudflare.md, « Prêt à déployer ») :
sur la porte, `nico007` n'est jamais admin sans le code admin ; sans code,
on n'entre pas ; une session de la maison n'y vaut rien ; un jeton Access
faux, périmé, d'une autre application ou sans la signature du Worker est
refusé ; la maison marche comme avant, et refuse ce qui vient d'un tunnel.
"""

from __future__ import annotations

import base64
import hashlib
import http.client
import json
import math
import os
import secrets
import socket
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

_APP = None


def register(app) -> None:
    global _APP
    _APP = app


# ── des outils d'essai ──────────────────────────────────────
def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _wait_port(port: int, t: float = 5.0) -> bool:
    end = time.time() + t
    while time.time() < end:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.5):
                return True
        except OSError:
            time.sleep(0.05)
    return False


def _req(port: int, method: str, path: str, body=None, *, cookies: dict | None = None, headers: dict | None = None,
         raw: bytes | None = None):
    """(statut, corps, cookies posés, en-têtes) ; ne suit pas les redirections, garde l'en-tête Host donné."""
    hd = dict(headers or {})
    data = raw
    if body is not None:
        data = json.dumps(body).encode()
        hd.setdefault("Content-Type", "application/json")
    if cookies:
        hd["Cookie"] = "; ".join(f"{k}={v}" for k, v in cookies.items() if v)
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=30)
    try:
        conn.request(method, path, body=data, headers=hd)
        r = conn.getresponse()
        txt = r.read()
        set_cookies = r.headers.get_all("Set-Cookie") or []
        rh = r.headers
        status = r.status
    finally:
        conn.close()
    try:
        doc = json.loads(txt)
    except ValueError:
        doc = txt
    jar = {}
    for c in set_cookies:
        k, _, v = c.split(";", 1)[0].partition("=")
        jar[k.strip()] = v.strip()
    jar["_raw"] = set_cookies
    return status, doc, jar, rh


def _b64u(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def _probably_prime(n: int, rounds: int = 24) -> bool:
    d, r = n - 1, 0
    while d % 2 == 0:
        d //= 2
        r += 1
    for _ in range(rounds):
        x = pow(secrets.randbelow(n - 3) + 2, d, n)
        if x in (1, n - 1):
            continue
        for _ in range(r - 1):
            x = pow(x, 2, n)
            if x == n - 1:
                break
        else:
            return False
    return True


_SMALL = [p for p in range(3, 2000, 2) if all(p % q for q in range(3, int(p ** 0.5) + 1, 2))]


def _prime(bits: int) -> int:
    while True:
        c = secrets.randbits(bits) | (3 << (bits - 2)) | 1
        if all(c % p for p in _SMALL) and _probably_prime(c):
            return c


def _rsa_2048() -> tuple[int, int, int]:
    """Une paire RSA de 2048 bits, tirée pour l'essai (rien de gardé nulle part)."""
    e = 65537
    while True:
        p, q = _prime(1024), _prime(1024)
        phi = (p - 1) * (q - 1)
        if p != q and math.gcd(e, phi) == 1 and (p * q).bit_length() == 2048:
            return p * q, e, pow(e, -1, phi)


def _jwt(n: int, d: int, claims: dict, kid: str = "essai-1", alg: str = "RS256") -> str:
    from core import auth
    head = _b64u(json.dumps({"alg": alg, "kid": kid, "typ": "JWT"}).encode())
    body = _b64u(json.dumps(claims).encode())
    t = auth._SHA256_INFO + hashlib.sha256(f"{head}.{body}".encode()).digest()
    em = b"\x00\x01" + b"\xff" * (256 - len(t) - 3) + b"\x00" + t
    return f"{head}.{body}.{_b64u(pow(int.from_bytes(em, 'big'), d, n).to_bytes(256, 'big'))}"


# ── la porte « code » (29/09 : « un login simple genre su007 ») ──
def _selftest_code(ok, home, home_tok, same_home, keyfile, key, team, jwt_for) -> None:
    """Derrière le Worker, à l'adresse fixe : la signature du Worker (rôle « code », l'adresse
    du visiteur), sans Cloudflare Access, puis le code d'invitation et le pseudo — pour tous,
    Cal compris (le code admin, puis nico007)."""
    import hmac

    import showrunner
    from core import auth, config

    cport = _free_port()
    config.CFG["porte"] = {"mode": "code", "port": cport, "team_domain": team, "aud": "aud-essai", "cle": str(keyfile),
                           "emails": {"cal@essai.test": "cal"}, "url": "https://essai.workers.dev"}
    showrunner.serve_door(_APP, "code", "127.0.0.1", cport)
    ok(_wait_port(cport), f"la porte « code » écoute sur 127.0.0.1:{cport}")

    def sig(method, path, qui="203.0.113.30", role="code", k=key, quand=None, jwt=None):
        q = str(int(quand if quand is not None else time.time()))
        s = hmac.new(k, "\n".join((qui, role, q, method, path)).encode(), hashlib.sha256).hexdigest()
        h = {"X-Porte-Qui": qui, "X-Porte-Role": role, "X-Porte-Quand": q, "X-Porte-Sig": s, "Host": "portail"}
        if jwt:
            h["Cf-Access-Jwt-Assertion"] = jwt
        return h

    def C(method, path, body=None, *, cookies=None, raw=None, headers=None, **kw):
        return _req(cport, method, path, body, cookies=cookies, raw=raw, headers={**sig(method, path, **kw), **(headers or {})})

    inv, adm = auth.demo_codes()["invitation"], auth.demo_codes()["admin"]
    # ── seul le Worker entre ──
    for path in ("/invitation/", f"/invitation/{inv}", "/api/auth/me", "/api/library", "/"):
        s, _, jar, _ = _req(cport, "GET", path, headers={"Host": "portail"})
        ok(s == 401 and not jar.get(auth.INVITE_COOKIE), f"code, sans la signature du Worker : 401, même le lien d'invitation ({path} {s})")
    s, _, _, _ = _req(cport, "GET", "/api/auth/me", headers=sig("GET", "/api/library"))
    ok(s == 401, f"code : une signature faite pour un autre chemin → 401 ({s})")
    s, _, _, _ = _req(cport, "GET", "/api/auth/me", headers=sig("GET", "/api/auth/me", k=b"une-autre-cle-" * 4))
    ok(s == 401, f"code : une signature d'une autre clé → 401 ({s})")
    s, _, _, _ = C("GET", "/api/auth/me", quand=time.time() - 120)
    ok(s == 401, f"code : une signature vieille de deux minutes → 401 ({s})")
    for role in ("admin", "ami"):
        s, _, _, _ = C("GET", "/api/library", qui="cal@essai.test", role=role)
        ok(s == 401, f"code : signé « {role} » sans jeton Access → 401 (le chemin « access » exige le jeton) ({s})")

    # ── signé par le Worker, sans code : la page d'invitation, rien d'autre ──
    s, d, _, _ = C("GET", "/api/auth/me")
    ok(s == 200 and d.get("state") == "anonymous" and d.get("porte") == "code" and d.get("invitation") is False,
       f"code, signé, sans invitation : anonyme, la porte le dit ({d})")
    for path in ("/api/library", "/api/jobs", "/api/admin/state", "/character/api/characters"):
        s, _, _, _ = C("GET", path)
        ok(s == 401, f"code, signé, sans invitation : refusé {path} ({s})")
    s, d, _, h = C("GET", "/invitation/")
    ok(s == 200 and isinstance(d, bytes) and b'action="/invitation/"' in d and h.get("X-Porte") == "code"
       and "démonstration".encode() not in d, f"la page d'invitation, à l'adresse fixe ({s})")
    s, d, _, _ = C("GET", "/invitation/?next=/image/")
    ok(s == 200 and b'name="next" value="/image/"' in d, f"… elle garde la page d'où l'on vient (next) ({s})")
    for name in ("nico007", "su007"):
        s, _, jar, _ = C("POST", "/api/auth/enter", {"name": name})
        ok(s == 401 and not jar.get(auth.COOKIE), f"code, sans invitation, « {name} » n'entre pas ({s})")

    # ── le lien d'invitation ──
    s, _, jar, h = C("GET", f"/invitation/{inv}?next=/image/")
    inv_ck = jar.get(auth.INVITE_COOKIE)
    ok(s == 303 and inv_ck and h.get("Location") == "/image/" and "Secure" in " ".join(jar["_raw"]),
       f"le lien d'invitation (le code dedans) : cookie Secure, retour à la page demandée ({s} {h.get('Location')})")
    ic = {auth.INVITE_COOKIE: inv_ck}
    for name in ("nico007", "NICO007"):
        s, d, jar, _ = C("POST", "/api/auth/enter", {"name": name}, cookies=ic)
        ok(s == 403 and not jar.get(auth.COOKIE) and "code admin" in (d or {}).get("error", ""),
           f"code : « {name} » avec le code d'invitation → 403, aucune session ({s})")

    # ── Cal crée su007 d'avance (Admin, à la maison) ──
    s, d, _, _ = _req(home, "POST", "/api/admin/users", {"name": "su007"}, cookies={auth.COOKIE: home_tok}, headers=same_home)
    ok(s == 200 and d.get("role") == "ami" and (auth.user("su007") or {}).get("state") == "active",
       f"Admin : Cal crée « su007 », déjà accepté ({s} {d})")
    for name, why in (("su007", "existe"), ("SU007", "existe"), ("nic0007", "réservé"), ("CaI", "réservé"), ("Cal", "existe"),
                      ("s", "2 à 24")):
        s, d, _, _ = _req(home, "POST", "/api/admin/users", {"name": name}, cookies={auth.COOKIE: home_tok}, headers=same_home)
        ok(s in (400, 409) and why in (d or {}).get("error", ""), f"Admin : « {name} » refusé : {why} ({s} {d})")
    s, d, _, _ = _req(home, "GET", "/api/admin/porte", cookies={auth.COOKIE: home_tok})
    ok(s == 200 and d.get("mode") == "code" and d.get("lien") == f"https://essai.workers.dev/invitation/{inv}"
       and d.get("lien_admin") == f"https://essai.workers.dev/invitation/{adm}" and d.get("invitation_requise") is True,
       f"Admin : le lien à envoyer, et le lien admin pour un admin ajouté ({s} {d})")

    s, d, jar, _ = C("POST", "/api/auth/enter", {"name": "Su007"}, cookies=ic)
    su_tok = jar.get(auth.COOKIE)
    ok(s == 200 and su_tok and d.get("state") == "active" and "Secure" in " ".join(jar["_raw"]),
       f"code : « su007 », créé d'avance, entre aussitôt ({s} {d})")
    suc = {**ic, auth.COOKIE: su_tok}
    s, d, _, _ = C("GET", "/api/auth/me", cookies=suc)
    s2, _, _, _ = C("GET", "/api/library", cookies=suc)
    s3, _, _, _ = C("GET", "/api/admin/state", cookies=suc)
    s4, _, _, _ = C("POST", "/api/admin/users", {"name": "Intrus"}, cookies=suc)
    ok(d.get("state") == "active" and d.get("porte") == "code" and s2 == 200 and s3 == 403 and s4 == 403,
       f"su007 : la bibliothèque, pas l'admin, ne crée personne ({d.get('state')}, {s2}, {s3}, {s4})")
    s, _, _, _ = C("GET", "/api/library", cookies={auth.COOKIE: su_tok})
    ok(s == 200, f"… sa session suffit ensuite, même sans le cookie d'invitation ({s})")
    s, _, _, _ = C("GET", "/api/library", cookies={auth.COOKIE: home_tok})
    ok(s == 401, f"code : la session admin de la maison n'y vaut rien ({s})")

    # ── un pseudo neuf attend Cal ──
    s, d, jar, _ = C("POST", "/api/auth/enter", {"name": "Margaux"}, cookies=ic, qui="203.0.113.31")
    mg = {**ic, auth.COOKIE: jar.get(auth.COOKIE)}
    ok(s == 200 and d.get("state") == "pending", f"code : « Margaux », pseudo neuf → en attente ({s} {d})")
    s, _, _, _ = C("GET", "/api/library", cookies=mg)
    ok(s == 401, f"en attente : rien ne s'ouvre ({s})")
    ok((auth.user("margaux") or {}).get("ip") == "203.0.113.31",
       "l'adresse notée pour Cal est celle que le Worker a signée")
    s, _, _, _ = _req(home, "POST", "/api/admin/requests/margaux/accept", cookies={auth.COOKIE: home_tok}, headers=same_home)
    s2, _, _, _ = C("GET", "/api/library", cookies=mg)
    ok(s == 200 and s2 == 200, f"Cal l'accepte dans Admin : elle entre ({s}, {s2})")

    # ── Cal : le code admin, puis nico007 ──
    s, _, jar, _ = C("POST", "/invitation/", raw=f"code={urllib.parse.quote(adm)}".encode(),
                     headers={"Content-Type": "application/x-www-form-urlencoded"})
    adm_ck = jar.get(auth.INVITE_COOKIE)
    s, d, jar, _ = C("POST", "/api/auth/enter", {"name": "nico007"}, cookies={auth.INVITE_COOKIE: adm_ck})
    calc = {auth.INVITE_COOKIE: adm_ck, auth.COOKIE: jar.get(auth.COOKIE)}
    s2, _, _, _ = C("GET", "/api/admin/state", cookies=calc)
    ok(s == 200 and d.get("user", {}).get("role") == "admin" and s2 == 200,
       f"code : le code admin puis nico007 → admin, la page d'admin s'ouvre ({s}, {s2})")

    # ── pseudo seul : aucune identité Access n'est reçue sur cette porte, pas même celle de Cal ──
    for role in ("admin", "ami"):
        s, _, _, _ = C("GET", "/api/admin/state", qui="cal@essai.test", role=role, jwt=jwt_for("cal@essai.test"))
        ok(s == 401, f"code : signé « {role} » avec un vrai jeton Access de Cal → 401 (pseudo seul) ({s})")
    s, _, _, _ = C("GET", "/api/admin/state", cookies=calc, jwt=jwt_for("ami@essai.test"))
    ok(s == 200, f"code : un jeton Access en plus ne change rien à la session ({s})")
    s, _, _, _ = C("GET", "/api/admin/state", cookies={auth.COOKIE: calc[auth.COOKIE]})
    ok(s == 200, f"code : Cal reste admin par sa seule session (120 jours), sans retaper le code ({s})")

    # ── les essais de code, par adresse ──
    got = [C("GET", f"/invitation/ZZZZ-ZZZZ-ZZZ{i % 10}", qui="198.51.100.77")[0] for i in range(11)]
    ok(got[:10] == [403] * 10 and got[10] == 429, f"code : 10 mauvais codes depuis une adresse, puis 429 ({got})")
    s, _, _, _ = C("GET", f"/invitation/{inv}", qui="198.51.100.77")
    ok(s == 429, f"… même le bon code attend (la limite ne dit rien du code) ({s})")
    s, _, jar, _ = C("GET", f"/invitation/{inv}", qui="198.51.100.78")
    ok(s == 303, f"… une autre adresse n'est pas gênée ({s})")

    # ── de nouveaux codes : les sessions de la porte se ferment ──
    auth.demo_codes(renew=True)
    for label, ck in (("su007", suc), ("Cal", calc)):
        s, _, _, _ = C("GET", "/api/library", cookies=ck)
        ok(s == 401, f"code : nouveaux codes, la session de {label} se ferme ({s})")
    ok((auth.user("su007") or {}).get("state") == "active", "… le pseudo su007, lui, reste : avec le nouveau lien, il rentre")

    # ── sans invitation (porte.invitation = false : la phase d'essai de Cal, 29/09 à 19 h) ──
    config.CFG["porte"]["invitation"] = False
    ip2 = "203.0.113.40"
    s, d, _, _ = C("GET", "/api/auth/me", qui=ip2)
    ok(s == 200 and d.get("sur_liste") is True and d.get("invitation") and d.get("state") == "anonymous",
       f"sans invitation : rien à ouvrir d'abord, la porte demande le pseudo ({d})")
    s, _, _, _ = C("GET", "/api/library", qui=ip2)
    ok(s == 401, f"sans invitation, sans pseudo : l'API reste fermée ({s})")
    s, d, jar, _ = C("POST", "/api/auth/enter", {"name": "su007"}, qui=ip2)
    open_tok = jar.get(auth.COOKIE)
    s2, _, _, _ = C("GET", "/api/library?limit=500", cookies={auth.COOKIE: open_tok}, qui=ip2)
    s3, _, _, _ = C("GET", "/api/admin/state", cookies={auth.COOKIE: open_tok}, qui=ip2)
    ok(s == 200 and d.get("state") == "active" and s2 == 200 and s3 == 403,
       f"sans invitation : su007 (ajouté par Cal) tape son pseudo et entre, pas l'admin ({s}, {s2}, {s3})")
    for name in ("Inconnu", "Zazou"):
        s, d, jar, _ = C("POST", "/api/auth/enter", {"name": name}, qui=ip2)
        ok(s == 403 and not jar.get(auth.COOKIE) and "demande à Cal" in (d or {}).get("error", "")
           and not auth.user(auth.slug(name)), f"sans invitation : « {name} », inconnu → refusé, aucune demande ({s} {d})")
    for name in ("nico007", "NICO007"):
        s, d, jar, _ = C("POST", "/api/auth/enter", {"name": name}, qui=ip2)
        ok(s == 403 and not jar.get(auth.COOKIE) and "code admin" in (d or {}).get("error", ""),
           f"sans invitation : « {name} » sans le code admin → 403, aucune session ({s})")
    # un admin ajouté par Cal : il entre avec le lien du code admin, puis son pseudo
    s, d, _, _ = _req(home, "POST", "/api/admin/users", {"name": "Lea007", "role": "admin"}, cookies={auth.COOKIE: home_tok},
                      headers=same_home)
    ok(s == 200 and d.get("role") == "admin", f"Admin : Cal ajoute « Lea007 », admin ({s} {d})")
    s, _, _, _ = C("POST", "/api/auth/enter", {"name": "lea007"}, qui=ip2)
    ok(s == 403, f"… sans le code admin, elle n'entre pas ({s})")
    adm2 = auth.demo_codes()["admin"]
    s, _, jar, _ = C("GET", f"/invitation/{adm2}", qui=ip2)
    s, d, jar2, _ = C("POST", "/api/auth/enter", {"name": "lea007"}, cookies={auth.INVITE_COOKIE: jar.get(auth.INVITE_COOKIE)}, qui=ip2)
    s2, _, _, _ = C("GET", "/api/admin/state", cookies={auth.COOKIE: jar2.get(auth.COOKIE)}, qui=ip2)
    ok(s == 200 and d["user"]["role"] == "admin" and s2 == 200, f"… avec le lien du code admin, elle entre, admin ({s}, {s2})")
    # admin par son seul pseudo (porte.admin_pseudo, faux par défaut) : sans le code admin, sur la porte ouverte
    config.CFG["porte"]["admin_pseudo"] = True
    s, d, jar3, _ = C("POST", "/api/auth/enter", {"name": "lea007"}, qui=ip2)
    s2, _, _, _ = C("GET", "/api/admin/state", cookies={auth.COOKIE: jar3.get(auth.COOKIE)}, qui=ip2)
    ok(s == 200 and d["user"]["role"] == "admin" and s2 == 200, f"admin_pseudo : « lea007 » entre par son seul pseudo, admin ({s}, {s2})")
    config.CFG["porte"]["admin_pseudo"] = False
    s2, _, _, _ = C("GET", "/api/admin/state", cookies={auth.COOKIE: jar3.get(auth.COOKIE)}, qui=ip2)
    ok(s2 in (401, 403), f"admin_pseudo coupé : sa session sans code admin ne vaut plus ({s2})")
    s, d, _, _ = _req(home, "POST", "/api/admin/users", {"name": "Truc", "role": "root"}, cookies={auth.COOKIE: home_tok},
                      headers=same_home)
    ok(s == 400, f"Admin : un autre rôle que ami/admin → 400 ({s})")
    s, d, _, _ = _req(home, "GET", "/api/admin/porte", cookies={auth.COOKIE: home_tok})
    ok(d.get("invitation_requise") is False and d.get("lien") == "https://essai.workers.dev",
       f"Admin : sans invitation, l'adresse à envoyer, rien d'autre ({d})")
    ok(auth.settings()["visibility"] == "all", "par défaut, tout le monde voit tout : les amis voient la bibliothèque comme Cal")
    # nouveaux codes : les sessions ouvertes sans invitation se ferment aussi
    auth.demo_codes(renew=True)
    s, _, _, _ = C("GET", "/api/library", cookies={auth.COOKIE: open_tok}, qui=ip2)
    ok(s == 401, f"sans invitation : nouveaux codes, la session de su007 se ferme aussi ({s})")
    config.CFG["porte"]["invitation"] = True
    s, _, jar, _ = C("POST", "/api/auth/enter", {"name": "su007"}, qui=ip2)
    ok(s == 401 and not jar.get(auth.COOKIE), f"invitation rétablie : le pseudo seul ne suffit plus ({s})")


# ── le contrôle (tools/check.py) ────────────────────────────
def selftest(call, ok) -> None:
    import hmac

    import showrunner
    from core import auth, config, library

    if _APP is None:
        ok(False, "porte : l'App n'a pas été gardée (register)")
        return
    # la recopie R2 (porte/r2_recopie.py) : sa signature SigV4 contre l'exemple publié par AWS
    import importlib.util
    spec = importlib.util.spec_from_file_location("r2_recopie", config.REPO / "porte" / "r2_recopie.py")
    r2m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(r2m)
    ok(r2m.essai(), "R2 : la signature SigV4 retrouve l'exemple « GET Object » de la documentation AWS")
    saved = {k: config.CFG.get(k) for k in ("auth", "porte")}
    real_ip = auth._ip
    config.CFG["auth"] = True
    auth.startup()
    home = int(config.get("port"))
    same_home = {"Origin": f"http://127.0.0.1:{home}"}
    dport, aport = _free_port(), _free_port()
    config.CFG["porte"] = {"mode": "demo", "port": dport}
    TUN_HOST = "essai-porte.trycloudflare.com"
    # ce que pose le tunnel rapide : l'hôte public, l'adresse du visiteur, la marque du bord de Cloudflare
    TUN = {"Host": TUN_HOST, "Cf-Connecting-IP": "203.0.113.7", "Cf-Ray": "8c0ffee00000-CDG", "X-Forwarded-Proto": "https"}
    TUNW = {**TUN, "Origin": f"https://{TUN_HOST}"}
    jsrv = None
    try:
        # ── la porte n'écoute que sur le loopback ──
        ok(showrunner.serve_door(_APP, "demo", "0.0.0.0", _free_port()) is None,
           "la porte publique refuse d'écouter ailleurs que sur 127.0.0.1")
        showrunner.serve_door(_APP, "demo", "127.0.0.1", dport)
        ok(_wait_port(dport), f"la porte publique « demo » écoute sur 127.0.0.1:{dport}")
        codes = auth.demo_codes(renew=True)
        inv, adm = codes["invitation"], codes["admin"]
        ok(inv != adm and len(auth._norm_code(inv)) == 12 and len(auth._norm_code(adm)) == 16,
           "deux codes distincts : invitation (12 signes), admin (16)")
        st_ = os.stat(auth._demo_file()).st_mode & 0o777
        ok(st_ == 0o600, f"les codes sont lisibles par leur seul propriétaire ({oct(st_)})")

        # ── la maison, comme avant ──
        s, d, jar, _ = _req(home, "POST", "/api/auth/enter", {"name": "nico007"}, headers=same_home)
        home_tok = jar.get(auth.COOKIE)
        ok(s == 200 and home_tok and d.get("user", {}).get("role") == "admin",
           f"la maison marche comme avant : nico007 depuis 127.0.0.1 entre, admin ({s})")
        s, _, _, _ = _req(home, "GET", "/api/admin/state", cookies={auth.COOKIE: home_tok})
        ok(s == 200, f"… et ouvre la page d'admin ({s})")
        # un tunnel pointé par erreur sur la maison : tout y viendrait de 127.0.0.1
        s, d, jar, _ = _req(home, "POST", "/api/auth/enter", {"name": "nico007"}, headers={**same_home, "Cf-Connecting-IP": "203.0.113.7"})
        ok(s == 403 and not jar.get(auth.COOKIE) and "maison" in (d or {}).get("error", ""),
           f"la maison refuse ce qui vient du bord de Cloudflare, même nico007 ({s} {d})")
        s, _, _, _ = _req(home, "GET", "/api/admin/state", cookies={auth.COOKIE: home_tok}, headers={"Cf-Ray": "x-CDG"})
        s2, _, _, _ = _req(home, "GET", "/api/library", cookies={auth.COOKIE: home_tok}, headers={"CDN-Loop": "cloudflare"})
        ok(s == 403 and s2 == 403, f"… et une session admin de la maison qui passerait par un tunnel ({s}, {s2})")

        # ── la porte « demo » : sans code, rien ──
        auth.set_current(auth.pseudo_admin())
        tmp = config.data_dir() / "porte-essai.png"
        from PIL import Image
        Image.new("RGB", (16, 12), (40, 90, 60)).save(tmp, "PNG")
        cal_item = library.add_file(tmp, title="à Cal, porte")
        auth.set_current(None)
        s, d, _, h = _req(dport, "GET", "/", headers=TUN)
        ok(s == 401 and isinstance(d, bytes) and b'action="/invitation/"' in d and h.get("X-Porte") == "demo",
           f"sans code, la page d'accueil montre l'invitation, en 401 ({s})")
        s, d, _, _ = _req(dport, "GET", "/commun/tokens.css", headers=TUN)
        ok(s == 200, f"… avec ses styles (commun/, le dépôt public) ({s})")
        for path in ("/api/library", "/api/jobs", "/api/queue", "/character/api/characters", "/character/v1/models",
                     f"/library/{cal_item['id']}/main.png", "/analyse/runs/x/y.json", "/api/admin/state",
                     "/api/analyse/diar/etat"):
            s, _, _, _ = _req(dport, "GET", path, headers=TUN)
            ok(s == 401, f"sans code, refusé : {path} ({s})")
        s, d, _, _ = _req(dport, "GET", "/admin/", headers=TUN)
        ok(s == 401 and isinstance(d, bytes) and b"invitation" in d, f"sans code, la page d'admin montre l'invitation ({s})")
        for name in ("nico007", "Zazie"):
            s, d, jar, _ = _req(dport, "POST", "/api/auth/enter", {"name": name}, headers=TUNW)
            ok(s == 401 and not jar.get(auth.COOKIE) and "invitation" in (d or {}).get("error", ""),
               f"sans code, « {name} » n'entre pas ({s} {d})")
        # une session de la maison n'y vaut rien
        for path in ("/api/library", "/api/admin/state"):
            s, _, _, _ = _req(dport, "GET", path, cookies={auth.COOKIE: home_tok}, headers=TUN)
            ok(s == 401, f"la session admin de la maison, sur la porte : refusée ({path} {s})")
        s, d, _, _ = _req(dport, "GET", "/api/auth/me", cookies={auth.COOKIE: home_tok}, headers=TUN)
        ok(d.get("state") == "anonymous" and d.get("porte") == "demo", f"… la porte la dit anonyme ({d})")

        # ── les codes ──
        for bad in ("AAAA-BBBB-CCCC", urllib.parse.quote(adm[:-1] + ("A" if adm[-1] != "A" else "B"))):
            s, d, jar, _ = _req(dport, "GET", f"/invitation/{bad}", headers=TUN)
            ok(s == 403 and not jar.get(auth.INVITE_COOKIE), f"un mauvais code : refusé, sans cookie ({s})")
        s, _, jar, h = _req(dport, "GET", "/invitation/" + urllib.parse.quote(inv.lower().replace("-", " ")), headers=TUN)
        inv_ck = jar.get(auth.INVITE_COOKIE)
        raw_ck = " ".join(jar["_raw"])
        ok(s == 303 and h.get("Location") == "/" and inv_ck and "Secure" in raw_ck and "HttpOnly" in raw_ck,
           f"le lien d'invitation (casse et tirets indifférents) : cookie Secure, HttpOnly, retour à l'accueil ({s})")
        ok(inv not in raw_ck and auth._norm_code(inv) not in raw_ck, "le cookie ne contient pas le code")
        s, d, _, _ = _req(dport, "GET", "/", cookies={auth.INVITE_COOKIE: inv_ck}, headers=TUN)
        ok(s == 200 and isinstance(d, bytes) and b'action="/invitation/"' not in d, f"invité·e : l'accueil se sert ({s})")
        s, _, _, _ = _req(dport, "GET", "/api/library", cookies={auth.INVITE_COOKIE: inv_ck}, headers=TUN)
        ok(s == 401, f"invité·e sans pseudo : l'API reste fermée ({s})")

        # ── nico007 avec le code d'invitation : jamais admin ──
        for name in ("nico007", "NICO007", "Nico007"):
            s, d, jar, _ = _req(dport, "POST", "/api/auth/enter", {"name": name}, cookies={auth.INVITE_COOKIE: inv_ck},
                                headers=TUNW)
            ok(s == 403 and not jar.get(auth.COOKIE) and "code admin" in (d or {}).get("error", ""),
               f"sur la porte, « {name} » avec le code d'invitation : refusé, aucune session ({s} {d})")
        for name in ("Cal", "nic0007", "admin"):
            s, _, jar, _ = _req(dport, "POST", "/api/auth/enter", {"name": name}, cookies={auth.INVITE_COOKIE: inv_ck},
                                headers=TUNW)
            ok(s == 409 and not jar.get(auth.COOKIE), f"« {name} » (imitation, mot réservé) : refusé ({s})")

        # ── un ami : demande, Cal accepte (à la maison), il entre ──
        s, d, jar, _ = _req(dport, "POST", "/api/auth/enter", {"name": "Zazie"}, cookies={auth.INVITE_COOKIE: inv_ck},
                            headers=TUNW)
        z_tok = jar.get(auth.COOKIE)
        ok(s == 200 and z_tok and d.get("state") == "pending" and "Secure" in " ".join(jar["_raw"]),
           f"« Zazie » avec le code : demande en attente, session Secure ({s} {d})")
        zc = {auth.INVITE_COOKIE: inv_ck, auth.COOKIE: z_tok}
        s, _, _, _ = _req(dport, "GET", "/api/library", cookies=zc, headers=TUN)
        ok(s == 401, f"en attente : l'API reste fermée ({s})")
        ok((auth.user("zazie") or {}).get("ip") == "203.0.113.7",
           "l'adresse du visiteur (Cf-Connecting-IP) est notée pour Cal, pas celle du tunnel")
        s, _, _, _ = _req(home, "POST", "/api/admin/requests/zazie/accept", cookies={auth.COOKIE: home_tok}, headers=same_home)
        ok(s == 200, f"Cal accepte Zazie depuis Admin ({s})")
        s, d, _, _ = _req(dport, "GET", "/api/auth/me", cookies=zc, headers=TUN)
        s2, _, _, _ = _req(dport, "GET", "/api/library", cookies=zc, headers=TUN)
        s3, _, _, _ = _req(dport, "GET", "/api/admin/state", cookies=zc, headers=TUN)
        ok(d.get("state") == "active" and s2 == 200 and s3 == 403,
           f"acceptée : elle entre, la bibliothèque s'ouvre, pas l'admin ({d.get('state')}, {s2}, {s3})")
        s, _, _, _ = _req(dport, "GET", f"/library/{cal_item['id']}/main.png", cookies=zc, headers=TUN)
        ok(s == 200, f"… les fichiers de la bibliothèque suivent la règle « qui voit quoi » ({s})")
        s, _, _, _ = _req(dport, "POST", f"/api/library/{cal_item['id']}", {"title": "x"}, cookies=zc,
                          headers={**TUN, "Origin": "https://evil.example"})
        ok(s == 403, f"une écriture venue d'une autre page : refusée ({s})")
        # Zazie, amie avec le Studio, est éditrice de Général (décision 9 : tout éditeur modifie) ; la corbeille
        # reste à l'auteur (equipes_espaces.md § 2.4)
        s, d, _, _ = _req(dport, "POST", f"/api/library/{cal_item['id']}/delete", {}, cookies=zc, headers=TUNW)
        ok(s == 403, f"l'objet de Cal ne part pas à la corbeille par Zazie ({s})")

        # ── le code admin : Cal entre, admin ──
        s, _, jar, _ = _req(dport, "POST", "/invitation/", raw=f"code={urllib.parse.quote(adm)}".encode(),
                            headers={**TUNW, "Content-Type": "application/x-www-form-urlencoded"})
        adm_ck = jar.get(auth.INVITE_COOKIE)
        ok(s == 303 and adm_ck and adm_ck != inv_ck, f"le formulaire, avec le code admin : un autre cookie ({s})")
        s, d, jar, _ = _req(dport, "POST", "/api/auth/enter", {"name": "nico007"}, cookies={auth.INVITE_COOKIE: adm_ck},
                            headers=TUNW)
        cal_tok = jar.get(auth.COOKIE)
        ok(s == 200 and cal_tok and d.get("user", {}).get("role") == "admin",
           f"avec le code admin, nico007 entre, admin ({s} {d})")
        calc = {auth.INVITE_COOKIE: adm_ck, auth.COOKIE: cal_tok}
        s, _, _, _ = _req(dport, "GET", "/api/admin/state", cookies=calc, headers=TUN)
        ok(s == 200, f"… et la page d'admin s'ouvre sur la porte ({s})")
        # une session admin de la porte, portée à la maison sans le réseau de Cal : la maison juge comme avant
        auth._ip = lambda req: "198.51.100.4"
        s, _, _, _ = _req(home, "GET", "/api/admin/state", cookies={auth.COOKIE: cal_tok})
        auth._ip = real_ip
        ok(s == 403, f"la session admin de la porte, à la maison hors du réseau de Cal : refusée ({s})")

        # un ami devenu admin : sa session ouverte avec le code d'invitation ne vaut plus
        auth.set_user("zazie", {"role": "admin"}, "cal")
        s, _, _, _ = _req(dport, "GET", "/api/library", cookies=zc, headers=TUN)
        ok(s == 401, f"un compte admin ouvert avec le code d'invitation : la session tombe ({s})")
        auth.set_user("zazie", {"role": "ami"}, "cal")
        s, _, _, _ = _req(dport, "GET", "/api/library", cookies=zc, headers=TUN)
        ok(s == 200, f"… et revient avec le rôle d'ami ({s})")

        # ── l'hôte réécrit par le tunnel : l'adresse relevée par demo.sh vaut pour Origin ──
        auth.demo_set_url(f"https://{TUN_HOST}")
        s, d, _, _ = _req(dport, "POST", "/api/auth/enter", {"name": "Yann"}, cookies={auth.INVITE_COOKIE: inv_ck},
                          headers={"Host": f"127.0.0.1:{dport}", "Origin": f"https://{TUN_HOST}", "Cf-Connecting-IP": "203.0.113.8"})
        s2, _, _, _ = _req(dport, "POST", "/api/auth/enter", {"name": "Yves"}, cookies={auth.INVITE_COOKIE: inv_ck},
                           headers={"Host": f"127.0.0.1:{dport}", "Origin": "https://autre.trycloudflare.com"})
        ok(s == 200 and s2 == 403, f"Origin : l'adresse du tunnel relevée passe, une autre non ({s}, {s2})")
        try:
            auth.demo_set_url("https://evil.example")
            ok(False, "une adresse qui n'est pas trycloudflare est refusée")
        except ValueError:
            ok(True, "")

        # ── de nouveaux codes : toutes les sessions de la porte se ferment ──
        auth.demo_codes(renew=True)
        for label, ck in (("Zazie", zc), ("Cal", calc)):
            s, _, _, _ = _req(dport, "GET", "/api/library", cookies=ck, headers=TUN)
            ok(s == 401, f"nouveaux codes : la session de {label} sur la porte se ferme ({s})")
        s, d, _, _ = _req(dport, "GET", "/", cookies={auth.INVITE_COOKIE: inv_ck}, headers=TUN)
        ok(s == 401 and isinstance(d, bytes) and b"invitation" in d, f"… et l'ancien cookie d'invitation ne vaut plus ({s})")
        s, _, _, _ = _req(home, "GET", "/api/admin/state", cookies={auth.COOKIE: home_tok}, headers=same_home)
        ok(s == 200, f"la maison, elle, ne bouge pas ({s})")
        s, _, _, _ = _req(home, "GET", "/invitation/", cookies={auth.COOKIE: home_tok})
        ok(s == 404, f"la page d'invitation n'existe pas à la maison ({s})")

        # ── la porte « access » : la signature du Worker et le jeton Cloudflare Access ──
        n, e, d_ = _rsa_2048()
        n2, _, d2 = _rsa_2048()
        fetches = []

        class Certs(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_GET(self):
                fetches.append(self.path)
                doc = {"keys": [{"kid": "essai-1", "kty": "RSA", "alg": "RS256", "use": "sig",
                                 "e": _b64u(e.to_bytes(3, "big")), "n": _b64u(n.to_bytes(256, "big"))}]}
                b = json.dumps(doc).encode() if self.path == "/cdn-cgi/access/certs" else b"{}"
                self.send_response(200 if self.path == "/cdn-cgi/access/certs" else 404)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(b)))
                self.end_headers()
                self.wfile.write(b)

        jsrv = ThreadingHTTPServer(("127.0.0.1", 0), Certs)
        jsrv.daemon_threads = True
        threading.Thread(target=jsrv.serve_forever, daemon=True).start()
        team = f"http://127.0.0.1:{jsrv.server_address[1]}"
        keyfile = config.data_dir() / "porte-essai.key"
        key = secrets.token_hex(32).encode()
        fd = os.open(keyfile, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "wb") as fh:
            fh.write(key)
        config.CFG["porte"] = {"mode": "access", "port": aport, "team_domain": team, "aud": "aud-essai",
                               "cle": str(keyfile), "emails": {"Cal@Essai.test": "cal"}}
        auth._jwks.update(team="", t=0.0, keys={})
        showrunner.serve_door(_APP, "access", "127.0.0.1", aport)
        ok(_wait_port(aport), f"la porte « access » écoute sur 127.0.0.1:{aport}")

        def claims(email, **kw):
            now = int(time.time())
            return {"iss": team, "aud": ["aud-essai"], "email": email, "iat": now, "nbf": now, "exp": now + 600,
                    "type": "app", "sub": hashlib.md5(email.encode()).hexdigest(), **kw}

        def signed(method, path, email, role, *, k=key, quand=None, jwt=None):
            q = str(int(quand if quand is not None else time.time()))
            sig = hmac.new(k, "\n".join((email, role, q, method, path)).encode(), hashlib.sha256).hexdigest()
            out = {"X-Porte-Qui": email, "X-Porte-Role": role, "X-Porte-Quand": q, "X-Porte-Sig": sig, "Host": "portail"}
            if jwt is not False:
                out["Cf-Access-Jwt-Assertion"] = jwt or _jwt(n, d_, claims(email))
            return out

        def A(method, path, email="ami@essai.test", role="ami", body=None, **kw):
            return _req(aport, method, path, body, headers=signed(method, path, email, role, **kw))

        for path in ("/", "/api/auth/me", "/api/library", "/character/api/characters", f"/library/{cal_item['id']}/main.png"):
            s, _, _, _ = _req(aport, "GET", path, headers={"Host": "portail"})
            ok(s == 401, f"access, sans signature ni jeton : refusé, pages comprises ({path} {s})")
        s, d, _, _ = A("GET", "/api/auth/me")
        ok(s == 200 and d.get("state") == "active" and d.get("porte") == "access" and d["user"]["role"] == "ami",
           f"access : signature du Worker + jeton Access valide → l'ami entre ({s} {d})")
        s, _, _, _ = A("GET", "/api/library")
        s2, _, _, _ = A("GET", "/api/admin/state")
        ok(s == 200 and s2 == 403, f"… la bibliothèque, pas l'admin ({s}, {s2})")
        s, d, jar, _ = A("POST", "/api/auth/enter", body={"name": "nico007"})
        ok(s == 409 and not jar.get(auth.COOKIE), f"access : taper nico007 ne sert à rien, aucune session ({s} {d})")
        s, d, _, _ = A("GET", "/api/admin/state", email="cal@essai.test", role="admin")
        ok(s == 200 and d.get("me", {}).get("id") == "cal",
           f"access : l'e-mail de Cal (porte.emails → cal), signé admin → admin, sous son compte ({s})")
        s, _, _, _ = A("GET", "/api/admin/state", email="cal@essai.test", role="ami")
        ok(s == 403, f"access : Cal signé « ami » par le Worker → pas admin ({s})")
        s, _, _, _ = A("GET", "/api/admin/state", email="ami@essai.test", role="admin")
        ok(s == 403, f"access : un ami signé « admin » sans compte admin → pas admin ({s})")
        n_fetch = len(fetches)
        for _ in range(5):
            A("GET", "/api/auth/me")
        ok(n_fetch == 1 and len(fetches) == 1, f"les clés de l'équipe sont gardées, pas relues à chaque requête ({len(fetches)})")

        # les jetons faux
        now = int(time.time())
        bad = {
            "signé par une autre clé": _jwt(n2, d2, claims("ami@essai.test")),
            "d'une autre application (aud)": _jwt(n, d_, claims("ami@essai.test", aud=["autre"])),
            "d'une autre équipe (iss)": _jwt(n, d_, claims("ami@essai.test", iss="https://autre.cloudflareaccess.com")),
            "périmé": _jwt(n, d_, claims("ami@essai.test", exp=now - 120)),
            "pas encore valable": _jwt(n, d_, claims("ami@essai.test", nbf=now + 600)),
            "sans e-mail (jeton de service)": _jwt(n, d_, {k: v for k, v in claims("ami@essai.test").items() if k != "email"}),
            "d'un autre e-mail que la signature": _jwt(n, d_, claims("autre@essai.test")),
            "alg none": _b64u(b'{"alg":"none","kid":"essai-1"}') + "." + _b64u(json.dumps(claims("ami@essai.test")).encode()) + ".",
            "kid inconnu": _jwt(n, d_, claims("ami@essai.test"), kid="inconnu"),
            "illisible": "abc.def.ghi",
        }
        for why, tok in bad.items():
            s, _, _, _ = A("GET", "/api/library", jwt=tok)
            ok(s == 401, f"access : un jeton {why} → refusé ({s})")
        s, _, _, _ = A("GET", "/api/library", jwt=False)
        ok(s == 401, f"access : la signature seule, sans jeton Access → refusé ({s})")
        s, _, _, _ = _req(aport, "GET", "/api/library",
                          headers={"Host": "portail", "Cf-Access-Jwt-Assertion": _jwt(n, d_, claims("ami@essai.test"))})
        ok(s == 401, f"access : le jeton seul, sans la signature du Worker → refusé ({s})")
        s, _, _, _ = A("GET", "/api/library", k=b"une-autre-cle-" * 4)
        ok(s == 401, f"access : une signature d'une autre clé → refusé ({s})")
        s, _, _, _ = A("GET", "/api/library", quand=time.time() - 120)
        ok(s == 401, f"access : une signature vieille de deux minutes → refusé ({s})")
        s, _, _, _ = _req(aport, "GET", "/api/admin/state", headers=signed("GET", "/api/library", "cal@essai.test", "admin"))
        ok(s == 401, f"access : une signature faite pour un autre chemin → refusé ({s})")
        os.chmod(keyfile, 0o644)
        s, _, _, _ = A("GET", "/api/library")
        os.chmod(keyfile, 0o600)
        ok(s == 503, f"access : une clé lisible par d'autres est refusée ({s})")
        config.CFG["porte"]["team_domain"] = f"http://127.0.0.1:{_free_port()}"
        s, _, _, _ = A("GET", "/api/library")
        ok(s == 503, f"access : les clés de l'équipe injoignables → 503, rien ne passe ({s})")
        config.CFG["porte"]["team_domain"] = team
        auth._jwks.update(team="", t=0.0, keys={})
        s, _, _, _ = A("GET", "/api/library")
        ok(s == 200, f"access : de retour ({s})")
        ok(auth.rs256_ok(n, e, b"x", b"\x00" * 256) is False and auth.rs256_ok(n, e, b"x", b"") is False,
           "RS256 : une signature vide ou nulle ne passe pas")
        s, _, _, _ = _req(aport, "GET", "/api/auth/me", headers=signed("GET", "/api/auth/me", "203.0.113.9", "code", jwt=False))
        ok(s == 401, f"access : une signature « code » (bonne clé) n'est pas reçue sur la porte « access » ({s})")

        _selftest_code(ok, home, home_tok, same_home, keyfile, key, team, lambda em: _jwt(n, d_, claims(em)))
    finally:
        auth._ip = real_ip
        auth.set_current(None)
        for k, v in saved.items():
            if v is None:
                config.CFG.pop(k, None)
            else:
                config.CFG[k] = v
        if jsrv:
            jsrv.shutdown()
            jsrv.server_close()
