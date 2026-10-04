#!/usr/bin/env bash
# La vraie porte (Worker « showrunner » + Cloudflare Access + Workers VPC + R2) : les gestes de l'agent, dans l'ordre,
# chacun avec sa vérification. Sur DGX2, depuis ~/SHOWRUNNER_TOOLS. L'étude : docs/etudes/cloudflare.md.
#
# Sans argument : le plan, rien d'autre. Chaque geste qui touche Cloudflare ou le portail en ligne demande son
# argument explicite ; « verifie » ne touche à rien (lecture de l'arbre, wrangler deploy --dry-run).
#
#   bash tools/porte.sh verifie                     ce qui sera publié (nombre, le plus gros, rien de privé), dry-run
#   bash tools/porte.sh cle                         ~/.config/showrunner/porte.key (0600), si elle manque
#   bash tools/porte.sh service <UUID du tunnel>    wrangler vpc service create portail-dgx2 → 127.0.0.1:9790 (fait le 29/09)
#   bash tools/porte.sh remplis service <id>        colle l'identifiant du service dans porte/wrangler.jsonc
#   bash tools/porte.sh remplis aud <tag AUD>       colle le tag AUD (à committer ensuite)
#   bash tools/porte.sh bucket                      le bucket R2 showrunner-bibliotheque existe-t-il ?
#   bash tools/porte.sh deploie                     dry-run, puis wrangler deploy
#   bash tools/porte.sh secrets <e-mail admin[,…]>  PORTE_CLE (depuis le fichier) et ADMINS
#   bash tools/porte.sh acces <e-mail de Cal>       le portail en mode « access » (AUD lu dans wrangler.jsonc), relancé
#                                                   (la démo s'arrête) ; l'e-mail ne va jamais dans le dépôt, public
#   bash tools/porte.sh essai                       sans connexion, l'adresse publique renvoie vers Access
#   bash tools/porte.sh demo                        revenir à la démo (porte.mode = "demo"), relancé
#
# La porte par code (29/09, « un login simple genre su007 » ; étude : « La porte par code ») :
#   bash tools/porte.sh code                        le portail en mode « code » (code d'invitation puis pseudo, derrière
#                                                   le Worker), relancé, vérifié ; puis le lien et les codes
#   bash tools/porte.sh remplis mode <code|access>  PORTE_MODE du Worker dans wrangler.jsonc (puis deploie)
#   bash tools/porte.sh lien                        le lien d'invitation à envoyer, le code admin (lecture seule)
#   bash tools/porte.sh ami <pseudo>                un pseudo d'ami créé d'avance, déjà accepté (il entre sans attendre)
#   bash tools/porte.sh nouveaux-codes              d'autres codes : toutes les sessions ouvertes par la porte se ferment
#   bash tools/porte.sh invitation <on|off>         off : pas de code d'invitation, seuls les pseudos ajoutés dans Admin
#                                                   entrent ; un admin garde le code admin (relancé, vérifié)
#   (revenir à Cloudflare Access pour tous : remplis mode access, deploie, acces <e-mail de Cal>)
#
# Réglages (pour un essai sur une copie ; défauts = la production) : WRANGLER, PORTE_CLE_FICHIER, PORTAIL_RELANCE,
# DEMO_SH, SAUVE_DIR, URL_PUBLIQUE.
set -u
cd "$(dirname "$0")/.."
RACINE=$(pwd)
WRANGLER=${WRANGLER:-$HOME/.local/bin/wrangler}
CLE=${PORTE_CLE_FICHIER:-$HOME/.config/showrunner/porte.key}
RELANCE=${PORTAIL_RELANCE:-tools/portail.sh restart}
DEMO_SH=${DEMO_SH:-tools/demo.sh}
SAUVE_DIR=${SAUVE_DIR:-$HOME/showrunner-data}
URL_PUBLIQUE=${URL_PUBLIQUE:-https://showrunner.luxigone.workers.dev}
EQUIPE=https://nirvalab.cloudflareaccess.com
CONF=porte/wrangler.jsonc
LOCAL=showrunner.local.json
# Limites Workers Free (https://developers.cloudflare.com/workers/platform/limits/) : 20 000 fichiers d'assets par
# version, 25 Mio par fichier.
MAX_FICHIERS=20000
MAX_OCTETS=$((25 * 1024 * 1024))

dit() { printf '%s\n' "$*"; }
faux() { printf 'ÉCHEC  %s\n' "$*"; exit 1; }
bon() { printf 'ok     %s\n' "$*"; }
w() { (cd porte && "$WRANGLER" "$@"); }
# les emplacements "<…>" encore à remplir dans wrangler.jsonc, hors commentaires (les ponts, plus tard, y sont commentés)
a_remplir_liste() { grep -v '^[[:space:]]*//' "$CONF" | grep -o '"<[^"]*>"' | tr '\n' ' '; }
a_remplir() { [ -n "$(a_remplir_liste)" ]; }

plan() {
  sed -n '2,33p' "$0" | sed 's/^# \{0,1\}//'
  cat <<'EOF'

L'ordre (étude, « La vraie porte : les gestes, dans l'ordre ») :
  1. verifie                  ← relancer après chaque changement de l'arbre
  2. cle
  3. (Cal) le tunnel dgx2 : Workers VPC → Tunnels → Create ; « Healthy » ; il donne l'UUID      (fait le 29/09)
  4. service <UUID>           → l'identifiant du service                                       (fait le 29/09)
     remplis service <id>
  5. (Cal) One-time PIN, puis l'application Access sur showrunner.luxigone.workers.dev → le tag AUD
  6. remplis aud <AUD>        puis git commit + push de porte/wrangler.jsonc (le PC : scp le fichier en retour)
  7. bucket                   (créé le 29/09 : ne fait que vérifier)
  8. deploie                  refuse tant qu'un emplacement "<…>" reste dans wrangler.jsonc
  9. secrets <e-mail de Cal>
 10. acces <e-mail de Cal>
 11. essai                    puis Cal, depuis la 4G : l'adresse, le code par e-mail, /api/porte/moi
Revenir en arrière : demo (puis tools/demo.sh start si Cal veut la démo).
EOF
}

# ── 1. ce qui sera publié ─────────────────────────────────────────────────────────────────────────────────────────
# Les assets sont l'ARBRE de DGX2 (assets.directory = "..") moins .assetsignore, pas le dernier commit : un fichier
# oublié là serait publié. On calcule la liste comme wrangler (syntaxe .gitignore), par git sur un dépôt vide.
publie() {
  local vide
  vide=$(mktemp -d)
  git init -q --bare "$vide"
  GIT_DIR=$vide git --work-tree="$RACINE" ls-files -o --exclude-from="$RACINE/.assetsignore"
  rm -rf "$vide"
}

verifie() {
  command -v git > /dev/null || faux "git absent"
  [ -x "$WRANGLER" ] || faux "wrangler absent ($WRANGLER)"
  local liste n gros taille interdits
  liste=$(mktemp)
  publie > "$liste"
  n=$(wc -l < "$liste")
  [ "$n" -gt 0 ] || faux "aucun fichier à publier ?"
  [ "$n" -le "$MAX_FICHIERS" ] || faux "$n fichiers : plus que les $MAX_FICHIERS de Workers Free"
  gros=$(tr '\n' '\0' < "$liste" | xargs -0 stat -c '%s %n' | sort -n -r | head -1)
  taille=${gros%% *}
  [ "$taille" -le "$MAX_OCTETS" ] || faux "trop gros pour un asset (25 Mio) : $gros"
  bon "$n fichiers publiés (au plus $MAX_FICHIERS) ; le plus gros : ${gros#* } ($taille octets, au plus $MAX_OCTETS) ; total $(tr '\n' '\0' < "$liste" | xargs -0 cat | wc -c) octets"
  # rien de ce qui ne sert qu'aux machines ni rien de privé (character/data/methodology.md est lu par le studio)
  interdits=$(grep -E '(^|/)\.|^(server|tools|docs|porte)/|\.(py|pyc|sh|key|pem|log|pid)$|local\.json$|(^|/)PROVENANCE\.md$|^[^/]+\.md$' "$liste")
  [ -z "$interdits" ] || faux "publié par erreur (compléter .assetsignore) : $(echo "$interdits" | head -5 | tr '\n' ' ')"
  bon "ni server/, tools/, docs/, porte/, ni .py/.sh/.key/.md de notes, ni showrunner.local.json"
  # publié mais hors de git : un fichier laissé dans l'arbre de DGX2, que personne n'a relu
  local horsgit
  horsgit=$(comm -23 <(sort "$liste") <(git ls-files | sort) | head -5)
  [ -z "$horsgit" ] && bon "tout ce qui est publié est dans git" \
    || dit "ATTENTION publié mais hors de git (à relire, ou à écarter dans .assetsignore) : $(echo "$horsgit" | tr '\n' ' ')"
  rm -f "$liste"
  a_remplir && dit "à remplir encore dans $CONF : $(a_remplir_liste)" || bon "$CONF rempli"
  local sortie
  sortie=$(mktemp -d)
  w deploy --dry-run --outdir "$sortie" 2>&1 | grep -E 'Read|Total Upload|env\.|ERROR|✘|exiting' || faux "wrangler deploy --dry-run a échoué"
  rm -rf "$sortie"
  bon "wrangler deploy --dry-run"
}

# ── 2. la clé de la porte (HMAC du Worker vers le portail) ────────────────────────────────────────────────────────
cle() {
  if [ -f "$CLE" ]; then
    [ "$(stat -c '%a' "$CLE")" = 600 ] || faux "$CLE existe mais n'est pas en 600 (le portail la refuse)"
    bon "$CLE existe, 600"; return 0
  fi
  mkdir -p "$(dirname "$CLE")" && (umask 077; openssl rand -hex 32 > "$CLE") || faux "clé non écrite"
  bon "$CLE créée (600) ; elle ne sort de DGX2 que vers le secret PORTE_CLE"
}

# ── 4. le service VPC : UN couple adresse/port, jamais une « VPC Network » ────────────────────────────────────────
# https://developers.cloudflare.com/workers-vpc/reference/wrangler-commands/ ; --tunnel-id : « UUID of the
# Cloudflare tunnel » (wrangler vpc service create --help).
service() {
  local tunnel=${1:-}
  [[ "$tunnel" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] || faux "usage : service <UUID du tunnel dgx2>"
  w vpc service create portail-dgx2 --type http --tunnel-id "$tunnel" --ipv4 127.0.0.1 --http-port 9790 \
    || faux "service non créé"
  dit "→ coller l'identifiant rendu : bash tools/porte.sh remplis <id du service> <tag AUD>"
}

# ── 6. les identifiants dans wrangler.jsonc (ni l'un ni l'autre n'est un secret) ──────────────────────────────────
remplis() {
  local quoi=${1:-} val=${2:-} place
  case "$quoi" in
    service)
      [[ "$val" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] || faux "usage : remplis service <id du service VPC, tel que wrangler le rend>"
      place='"<id du service portail-dgx2>"' ;;
    aud)
      [[ "$val" =~ ^[0-9a-f]{32,128}$ ]] || faux "usage : remplis aud <tag AUD> (des chiffres hexadécimaux : Access → l'application → Configure → Additional settings)"
      place="\"<tag AUD de l'application Access>\"" ;;
    mode)
      [[ "$val" =~ ^(code|access)$ ]] || faux "usage : remplis mode <code|access>"
      grep -qE '^[[:space:]]*"PORTE_MODE"[[:space:]]*:' "$CONF" || faux "$CONF : pas de PORTE_MODE dans vars"
      sed -i -E "s|^([[:space:]]*\"PORTE_MODE\"[[:space:]]*:[[:space:]]*)\"[^\"]*\"|\1\"$val\"|" "$CONF"
      git --no-pager diff --stat -- "$CONF"
      bon "PORTE_MODE = $val ; à déployer (deploie), à committer, à recopier sur le PC"
      return 0 ;;
    *) faux "usage : remplis service <id> | remplis aud <tag AUD> | remplis mode <code|access>" ;;
  esac
  grep -qF "$place" "$CONF" || faux "$CONF : l'emplacement $place n'y est plus (déjà rempli ?)"
  sed -i "s|$place|\"$val\"|" "$CONF"
  git --no-pager diff --stat -- "$CONF"
  bon "rempli ; à committer (git add $CONF && git commit && git push), et à recopier sur le PC"
}

# ── 7. le bucket (créé par Cal ou l'agent avant) ──────────────────────────────────────────────────────────────────
bucket() {
  w r2 bucket list 2>&1 | grep -q 'showrunner-bibliotheque' && bon "bucket showrunner-bibliotheque présent" \
    || faux "bucket absent : wrangler r2 bucket create showrunner-bibliotheque (depuis porte/)"
}

# ── 8. le déploiement ─────────────────────────────────────────────────────────────────────────────────────────────
deploie() {
  a_remplir && faux "$CONF n'est pas rempli (remplis service <id> / remplis aud <tag>) : $(a_remplir_liste)"
  verifie
  w deploy || faux "wrangler deploy a échoué"
  bon "déployé : $URL_PUBLIQUE (sans secrets : sans jeton Access valide → 403 ; sans PORTE_CLE, rien ne joint DGX2)"
}

# ── 9. les secrets : jamais dans une commande ni dans le dépôt ────────────────────────────────────────────────────
# « The put command can also receive piped input » (https://developers.cloudflare.com/workers/wrangler/commands/workers/) ;
# le Worker et le portail ignorent le retour à la ligne final de la clé.
secrets() {
  local admins=${1:-}
  [[ "$admins" =~ ^[^,@[:space:]]+@[^,@[:space:]]+(,[^,@[:space:]]+@[^,@[:space:]]+)*$ ]] || faux "usage : secrets <e-mail admin[,autre]>"
  [ -f "$CLE" ] || faux "$CLE absente (cle)"
  w secret put PORTE_CLE < "$CLE" || faux "PORTE_CLE non posé"
  printf '%s' "$admins" | w secret put ADMINS || faux "ADMINS non posé"
  w secret list 2>&1 | grep -E 'PORTE_CLE|ADMINS'
  bon "secrets posés (les noms seulement sont listés)"
}

# ── le réglage « porte » de showrunner.local.json (fusionné, le reste gardé ; une copie datée avant) ──────────────
regle() {
  mkdir -p "$SAUVE_DIR"
  [ -f "$LOCAL" ] && cp -p "$LOCAL" "$SAUVE_DIR/showrunner.local.json.$(date +%Y%m%d-%H%M%S)"
  python3 - "$LOCAL" "$@" <<'PY' || faux "réglage non écrit"
import json, sys
from pathlib import Path
p, mode = Path(sys.argv[1]), sys.argv[2]
d = json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}
porte = d.get("porte") if isinstance(d.get("porte"), dict) else {}
porte["mode"] = mode
if mode == "access":
    porte["team_domain"], porte["aud"], porte["emails"] = sys.argv[3], sys.argv[4], {sys.argv[5].strip().lower(): "cal"}
elif mode == "code":
    # team_domain, aud, emails restent (ils ne servent qu'en « access ») : revenir en arrière ne demande rien de plus
    porte["url"] = sys.argv[3]
d["porte"] = porte
p.write_text(json.dumps(d, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"porte": {k: v for k, v in porte.items() if k != "emails"}}, ensure_ascii=False))
PY
}

sonde_porte() {   # « hôte port mode » de la porte publique, et ce qu'elle répond sans signature
  local hote port mode code
  read -r hote port mode < <(python3 server/showrunner.py --porte-adresse)
  # /api/library : gardée dans les deux modes (/api/auth/… reste ouvert en démo, pour la page d'invitation)
  code=$(curl -s -m 5 -o /dev/null -w '%{http_code}' "http://$hote:$port/api/library?limit=1")
  echo "$mode $code $hote:$port"
}

# ── 10. le portail derrière la vraie porte ────────────────────────────────────────────────────────────────────────
acces() {
  local email=${1:-} aud
  [[ "$email" =~ ^[^,@[:space:]]+@[^,@[:space:]]+$ ]] || faux "usage : acces <e-mail de Cal pour Access>"
  # une seule source pour le tag AUD : celle que le Worker déploie
  aud=$(grep -v '^[[:space:]]*//' "$CONF" | sed -n 's/.*"POLICY_AUD"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
  [[ "$aud" =~ ^[0-9a-f]{32,128}$ ]] || faux "POLICY_AUD n'est pas rempli dans $CONF (remplis aud <tag>) : « $aud »"
  [ -f "$CLE" ] || faux "$CLE absente (cle) : le portail refuserait tout"
  # la porte est l'une ou l'autre : la démo (tunnel rapide vers la même porte) s'arrête d'abord
  if [ -f "$DEMO_SH" ]; then bash "$DEMO_SH" stop; fi
  regle access "$EQUIPE" "$aud" "$email"
  $RELANCE || faux "le portail ne repart pas"
  local mode code adr
  read -r mode code adr < <(sonde_porte)
  [ "$mode" = access ] || faux "la porte publique est en mode « $mode »"
  [ "$code" = 401 ] || faux "sans signature, $adr répond $code (attendu 401)"
  bon "porte « access » sur $adr : une requête non signée → 401"
}

# ── 11. l'essai depuis dehors (lecture seule) ─────────────────────────────────────────────────────────────────────
# Sans connexion, l'application Access doit répondre avant le Worker (une redirection vers la page de connexion de
# l'équipe) ; un 403 JSON du Worker (« passe par la porte ») veut dire qu'Access n'est pas posé sur ce nom d'hôte.
essai() {
  local r corps
  corps=$(mktemp)
  r=$(curl -s -m 10 -o "$corps" -w '%{http_code} %{redirect_url}' "$URL_PUBLIQUE/api/porte/moi")
  dit "sans connexion : $r $(head -c 200 "$corps")"
  # porte par code (l'application Access supprimée) : le Worker répond lui-même, et rien d'autre ne s'ouvre sans code
  if [ "${r%% *}" = 200 ] && grep -q '"porte": *"code"' "$corps"; then
    rm -f "$corps"
    bon "porte par code : $URL_PUBLIQUE répond sans Access (le Worker en PORTE_MODE = code)"
    r=$(curl -s -m 10 -o /dev/null -w '%{http_code}' "$URL_PUBLIQUE/api/library")
    [ "$r" = 401 ] || faux "sans code, /api/library répond $r (attendu 401)"
    bon "sans code : /api/library → 401"
    r=$(curl -s -m 15 -o /dev/null -w '%{http_code}' "$URL_PUBLIQUE/invitation/")
    [ "$r" = 200 ] || faux "la page d'invitation répond $r (attendu 200 : le portail en mode « code », joint par le tunnel)"
    bon "la page d'invitation se sert (DGX2 jointe, portail en mode « code »)"
    return 0
  fi
  rm -f "$corps"
  case "$r" in
    30[0-9]\ "$EQUIPE"*|30[0-9]\ https://*.cloudflareaccess.com*) bon "Access garde l'adresse (redirection vers la connexion)" ;;
    403*) faux "403 du Worker : l'application Access n'est pas posée sur ce nom d'hôte (étape 5)" ;;
    *) faux "réponse inattendue : $r" ;;
  esac
  dit "reste à Cal, depuis la 4G : $URL_PUBLIQUE → le code par e-mail → le portail ; $URL_PUBLIQUE/api/porte/moi → son e-mail, admin"
}

# ── revenir à la démo ─────────────────────────────────────────────────────────────────────────────────────────────
demo() {
  regle demo
  $RELANCE || faux "le portail ne repart pas"
  local mode code adr
  read -r mode code adr < <(sonde_porte)
  [ "$mode" = demo ] || faux "la porte publique est en mode « $mode »"
  [ "$code" = 401 ] || faux "sans code d'invitation, $adr répond $code (attendu 401)"
  bon "porte « demo » sur $adr : sans code → 401 ; le Worker ne joint plus rien (la démo refuse sa signature)"
  dit "pour rouvrir la démo : tools/demo.sh start"
}

# ── la porte par code : l'adresse fixe, un code d'invitation puis le pseudo ───────────────────────────────────────
py() { python3 server/showrunner.py "$@"; }
val_lien() { py --porte-lien | awk -v k="$1" '$1 == k { print $2 }'; }

lien() {
  local mode url l inv adm
  mode=$(val_lien mode)
  case "$mode" in code|demo) ;; *) faux "la porte publique est en mode « $mode » : pas de lien d'invitation (bash tools/porte.sh code)" ;; esac
  url=$(val_lien url); l=$(val_lien lien); inv=$(val_lien invitation); adm=$(val_lien admin)
  [ -n "$url" ] || faux "pas d'adresse publique (mode « $mode »)"
  if [ "$(val_lien invitation_requise)" = False ]; then
    dit "porte         $mode · $url · SANS invitation (bash tools/porte.sh invitation on pour la remettre)"
    dit "pour un ami   $url   puis le pseudo que Cal a ajouté (Admin → Ajouter quelqu'un, ou bash tools/porte.sh ami <pseudo>) ;"
    dit "              un pseudo inconnu est refusé"
  else
    dit "porte         $mode · $url"
    dit "pour un ami   $l"
    dit "              (ou $url/invitation/ et le code $inv) ; puis son pseudo : un pseudo créé d'avance entre aussitôt"
    dit "              (bash tools/porte.sh ami <pseudo>), un pseudo neuf attend Cal (page Admin)"
  fi
  dit "pour un admin $url/invitation/$adm   puis son pseudo (nico007 pour Cal) ; ce lien ne va qu'aux admins"
  dit "              (sa session tient 120 jours ; « nouveaux-codes » ferme toutes les sessions de la porte)"
  return 0
}

code_() {
  [ -f "$CLE" ] || faux "$CLE absente (cle) : le portail refuserait tout"
  [ "$(stat -c '%a' "$CLE")" = 600 ] || faux "$CLE n'est pas en 600 (le portail la refuse)"
  # la porte est l'une ou l'autre : la démo (tunnel rapide vers la même porte) s'arrête d'abord
  if [ -f "$DEMO_SH" ]; then bash "$DEMO_SH" stop > /dev/null; fi
  regle code "$URL_PUBLIQUE"
  py --porte-codes > /dev/null || faux "codes non créés"
  $RELANCE || faux "le portail ne repart pas"
  local mode code adr
  for _ in $(seq 1 20); do
    read -r mode code adr < <(sonde_porte)
    [ "$code" = 000 ] || break
    sleep 0.5
  done
  [ "$mode" = code ] || faux "la porte publique est en mode « $mode »"
  [ "$code" = 401 ] || faux "sans signature, $adr répond $code (attendu 401)"
  code=$(curl -s -m 5 -o /dev/null -w '%{http_code}' "http://$adr/invitation/")
  [ "$code" = 401 ] || faux "sans signature, la page d'invitation répond $code (attendu 401 : seul le Worker entre)"
  bon "porte « code » sur $adr : sans la signature du Worker → 401, page d'invitation comprise"
  local wmode
  wmode=$(grep -v '^[[:space:]]*//' "$CONF" | sed -n 's/.*"PORTE_MODE"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
  [ "$wmode" = code ] && bon "$CONF : PORTE_MODE = code (déployé ? bash tools/porte.sh deploie)" \
    || dit "ATTENTION $CONF : PORTE_MODE = « $wmode » : bash tools/porte.sh remplis mode code, puis deploie"
  lien
}

ami() {
  local p=${1:-}
  [ -n "$p" ] || faux "usage : ami <pseudo> (par exemple su007)"
  py --ami "$p" || faux "pseudo non créé"
}

# porte.invitation (mode « code ») : off = phase d'essai (Cal, 29/09 à 19 h) : on ouvre l'adresse, on tape le pseudo
# que Cal a ajouté dans Admin, on entre ; un pseudo inconnu est refusé ; un compte admin exige toujours le code admin.
# l'admin par son seul pseudo (porte ouverte seulement) : plus de code admin à porter d'un ordinateur à l'autre.
# Un pseudo admin n'est pas un secret : à n'allumer que si l'on accepte que quiconque le connaît entre en admin.
admin_pseudo() {
  local v=${1:-}
  case "$v" in on) v=true ;; off) v=false ;; *) faux "usage : admin-pseudo <on|off>" ;; esac
  mkdir -p "$SAUVE_DIR"
  [ -f "$LOCAL" ] && cp -p "$LOCAL" "$SAUVE_DIR/showrunner.local.json.$(date +%Y%m%d-%H%M%S)"
  python3 - "$LOCAL" "$v" <<'PY' || faux "réglage non écrit"
import json, sys
from pathlib import Path
p = Path(sys.argv[1])
d = json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}
porte = d.get("porte") if isinstance(d.get("porte"), dict) else {"mode": d.get("porte") or "demo"}
porte["admin_pseudo"] = sys.argv[2] == "true"
d["porte"] = porte
p.write_text(json.dumps(d, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"porte": {k: v for k, v in porte.items() if k != "emails"}}, ensure_ascii=False))
PY
  $RELANCE || faux "le portail ne repart pas"
  bon "admin-pseudo $1 (ne compte que si la porte est ouverte : bash tools/porte.sh invitation off)"
}

invitation() {
  local v=${1:-}
  case "$v" in on) v=true ;; off) v=false ;; *) faux "usage : invitation <on|off>" ;; esac
  mkdir -p "$SAUVE_DIR"
  [ -f "$LOCAL" ] && cp -p "$LOCAL" "$SAUVE_DIR/showrunner.local.json.$(date +%Y%m%d-%H%M%S)"
  python3 - "$LOCAL" "$v" <<'PY' || faux "réglage non écrit"
import json, sys
from pathlib import Path
p = Path(sys.argv[1])
d = json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}
porte = d.get("porte") if isinstance(d.get("porte"), dict) else {"mode": d.get("porte") or "demo"}
porte["invitation"] = sys.argv[2] == "true"
d["porte"] = porte
p.write_text(json.dumps(d, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"porte": {k: v for k, v in porte.items() if k != "emails"}}, ensure_ascii=False))
PY
  $RELANCE || faux "le portail ne repart pas"
  local mode code adr
  for _ in $(seq 1 20); do
    read -r mode code adr < <(sonde_porte)
    [ "$code" = 000 ] || break
    sleep 0.5
  done
  [ "$code" = 401 ] || faux "sans signature, $adr répond $code (attendu 401)"
  [ "$mode" = code ] || dit "ATTENTION la porte publique est en mode « $mode » : invitation ne compte qu'en mode « code »"
  bon "invitation $1 ; porte « $mode » sur $adr : sans la signature du Worker → 401"
  lien
}

nouveaux_codes() {
  py --porte-codes-nouveaux > /dev/null || faux "codes non renouvelés"
  bon "nouveaux codes : toutes les sessions ouvertes par la porte sont fermées, les anciens liens ne valent plus"
  lien
}

case "${1:-}" in
  code) code_ ;;
  lien) lien ;;
  ami) ami "${2:-}" ;;
  invitation) invitation "${2:-}" ;;
  admin-pseudo) admin_pseudo "${2:-}" ;;
  nouveaux-codes) nouveaux_codes ;;
  verifie) verifie ;;
  cle) cle ;;
  service) service "${2:-}" ;;
  remplis) remplis "${2:-}" "${3:-}" ;;
  bucket) bucket ;;
  deploie) deploie ;;
  secrets) secrets "${2:-}" ;;
  acces) acces "${2:-}" ;;
  essai) essai ;;
  demo) demo ;;
  *) plan ;;
esac
