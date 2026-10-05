#!/usr/bin/env bash
# La mise à jour toute seule (Cal, 05/10 : « tu veux pas les faire tout seul les trucs dans le terminal ? »).
# Sur DGX2, une fois :   bash ~/SHOWRUNNER_TOOLS/tools/auto_maj.sh installe
# Ensuite, toutes les 2 minutes (cron de l'utilisateur), sans rien taper :
#   1. regarde s'il y a du neuf sur origin/main (git fetch) ; rien de neuf : rien ne se passe, rien n'est écrit ;
#   2. si le neuf touche le serveur (server/) et qu'un calcul tourne ou attend dans la file (jobs.json) : ATTEND le tour
#      suivant — un redémarrage interromprait le rendu (core/jobs.py, _load : « interrompu par un redémarrage ») ;
#   3. sinon : git reset --hard origin/main (comme à la main), relance le portail si server/ a changé,
#      publie les pages sur l'adresse publique (tools/porte.sh deploie) si autre chose que docs/ a changé,
#      et recale le miroir de DGX1 (le câble) ;
#   4. écrit ce qu'il a fait dans ~/showrunner-maj.log.
#
#   bash tools/auto_maj.sh installe       la ligne cron (idempotent) + le PATH de cette session (node, wrangler)
#   bash tools/auto_maj.sh desinstalle    retire la ligne cron
#   bash tools/auto_maj.sh etat           installé ? la version en route, celle d'origin/main, le journal
#   bash tools/auto_maj.sh maintenant     un tour tout de suite (même règle, même journal)
#   bash tools/auto_maj.sh tourne         ce que lance le cron
#
# Ce qui n'est jamais touché : showrunner.local.json et les données (~/showrunner-data), hors du suivi git.
#
# LE VERROU (05/10, la panne) : un tour tient /tmp/sr_auto_maj_<moi>.lock (descripteur 9) ; tout ce qu'il lance
# et qui lui survit (le portail relancé, wrangler, ssh) se lance avec `9>&-`, sinon il garde le verrou à sa
# place, et chaque tour suivant s'arrête en silence (flock -n) tant que ce processus vit — c'est ce qui a
# figé DGX2 sur 0573119 après « portail relancé » à 13:54. `etat` dit qui tient le verrou.
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$HOME/showrunner-maj.log"
CONFD="$HOME/.config/showrunner"
PATHF="$CONFD/maj.path"
LOCK="/tmp/sr_auto_maj_${USER:-moi}.lock"
DGX1="dgx@169.254.110.6"
LIGNE="*/2 * * * * bash $REPO/tools/auto_maj.sh tourne >> $LOG 2>&1"

# le PATH de la session où l'on a installé (node et wrangler y sont : porte.sh deploie marche par ssh)
[ -f "$PATHF" ] && PATH="$(cat "$PATHF"):$PATH"
export PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

ts() { date '+%Y-%m-%d %H:%M:%S'; }
dit() { printf '%s  %s\n' "$(ts)" "$*"; }

occupe() {   # un calcul en cours ou en file ? (le portail écrit jobs.json à chaque changement de la file)
  (cd "$REPO" && python3 - <<'PY'
import json, sys
sys.path.insert(0, "server")
from core import config
f = config.data_dir() / "jobs.json"
try:
    jobs = json.loads(f.read_text(encoding="utf-8")) if f.exists() else []
except ValueError:
    jobs = []
n = sum(1 for j in jobs if j.get("state") in ("running", "queued"))
print(n)
PY
  ) 2>/dev/null || echo 0
}

bloquants() {   # les travaux qui font attendre la mise à jour : leur titre, leur état, depuis quand (pour les annuler dans Admin → File)
  (cd "$REPO" && python3 - <<'PY'
import json, sys
sys.path.insert(0, "server")
from core import config
f = config.data_dir() / "jobs.json"
try:
    jobs = json.loads(f.read_text(encoding="utf-8")) if f.exists() else []
except ValueError:
    jobs = []
for j in jobs:
    if j.get("state") in ("running", "queued"):
        etat = "en cours" if j["state"] == "running" else "en file"
        print(f"  {etat:8} {str(j.get('created', ''))[:16]}  {j.get('id', '')}  {j.get('title') or j.get('kind', '')}  ({j.get('owner_name') or j.get('owner') or ''})")
PY
  ) 2>/dev/null
}
tour() {
  cd "$REPO" || { dit "ÉCHEC dépôt introuvable : $REPO"; return 1; }
  git fetch -q origin main 2>/dev/null || { dit "ÉCHEC git fetch (réseau ?)"; return 1; }
  local avant apres changes serveur pages
  avant=$(git rev-parse HEAD)
  apres=$(git rev-parse origin/main)
  [ "$avant" = "$apres" ] && return 0
  changes=$(git diff --name-only "$avant" "$apres")
  serveur=$(printf '%s\n' "$changes" | grep -c '^server/' || true)
  pages=$(printf '%s\n' "$changes" | grep -vc '^docs/' || true)
  if [ "$serveur" -gt 0 ]; then
    local n
    n=$(occupe)
    if [ "${n:-0}" -gt 0 ]; then
      # une seule ligne par version en attente : pas de journal qui gonfle toutes les 2 minutes
      grep -q "attend.*${apres:0:7}" "$LOG" 2>/dev/null || dit "attend : $n calcul(s) en cours ou en file, le serveur change (${apres:0:7}) — relance au prochain tour libre"
      return 0
    fi
  fi
  git reset -q --hard origin/main || { dit "ÉCHEC git reset"; return 1; }
  dit "à jour : ${avant:0:7} → ${apres:0:7} ($(git log -1 --format=%s | cut -c1-90))"
  if [ "$serveur" -gt 0 ]; then
    if ! bash tools/portail.sh status 2>/dev/null | grep -q 'en route'; then
      dit "portail arrêté : laissé arrêté (tools/portail.sh start pour le lancer)"
    elif bash tools/portail.sh restart 9>&- > /tmp/sr_maj_portail.txt 2>&1; then
      dit "portail relancé"
    else
      dit "ÉCHEC relance du portail : $(tail -3 /tmp/sr_maj_portail.txt | tr '\n' ' ')"
    fi
  fi
  if [ "$pages" -gt 0 ]; then
    if bash tools/porte.sh deploie 9>&- > /tmp/sr_maj_porte.txt 2>&1; then dit "adresse publique publiée"; else dit "ÉCHEC publication : $(grep -E 'ÉCHEC|Error|error' /tmp/sr_maj_porte.txt | head -3 | tr '\n' ' ')"; fi
  fi
  if ssh -o BatchMode=yes -o ConnectTimeout=5 "$DGX1" "cd ~/SHOWRUNNER_TOOLS && git fetch -q && git reset -q --hard origin/main" 9>&- 2>/dev/null; then
    dit "DGX1 recalé"
  else
    dit "DGX1 injoignable (le miroir sera recalé au prochain changement)"
  fi
  # le journal ne grossit pas sans fin
  if [ -f "$LOG" ] && [ "$(wc -c < "$LOG")" -gt 1000000 ]; then tail -n 2000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"; fi
}

case "${1:-etat}" in
  tourne)
    exec 9>"$LOCK"
    flock -n 9 || exit 0     # un tour déjà en cours (une publication peut prendre une minute)
    tour
    ;;
  maintenant)
    exec 9>"$LOCK"
    flock -n 9 || { echo "un tour est déjà en cours : réessaie dans une minute"; exit 0; }
    tour | tee -a "$LOG"
    ;;
  installe)
    mkdir -p "$CONFD"
    printf '%s' "$PATH" > "$PATHF"
    command -v crontab > /dev/null || { echo "ÉCHEC crontab absent sur cette machine"; exit 1; }
    ( crontab -l 2>/dev/null | grep -v 'tools/auto_maj.sh' ; echo "$LIGNE" ) | crontab -
    echo "ok     installé : toutes les 2 minutes ($LIGNE)"
    echo "       journal : $LOG ; état : bash tools/auto_maj.sh etat ; arrêt : bash tools/auto_maj.sh desinstalle"
    exec 9>"$LOCK"; flock -n 9 || exit 0
    # la première fois : remettre à niveau ce qui tourne (le dépôt a pu être recalé à la main juste avant, sans relance)
    cd "$REPO" || exit 1
    git fetch -q origin main 2>/dev/null && git reset -q --hard origin/main
    if bash tools/portail.sh status 2>/dev/null | grep -q 'en route'; then
      if [ "$(occupe)" -gt 0 ]; then echo "       un calcul tourne : le portail sera relancé au prochain changement"; else bash tools/portail.sh restart 9>&- > /dev/null 2>&1 && echo "ok     portail relancé"; fi
    fi
    bash tools/porte.sh deploie 9>&- > /tmp/sr_maj_porte.txt 2>&1 && echo "ok     adresse publique publiée" || echo "ÉCHEC publication : voir /tmp/sr_maj_porte.txt"
    ;;
  desinstalle)
    ( crontab -l 2>/dev/null | grep -v 'tools/auto_maj.sh' ) | crontab -
    echo "ok     désinstallé : plus de mise à jour automatique"
    ;;
  etat)
    cd "$REPO" || exit 1
    if crontab -l 2>/dev/null | grep -q 'tools/auto_maj.sh'; then echo "installé : oui (toutes les 2 minutes)"; else echo "installé : non (bash tools/auto_maj.sh installe)"; fi
    git fetch -q origin main 2>/dev/null
    echo "en route    : $(git log -1 --format='%h %s' | cut -c1-100)"
    echo "origin/main : $(git log -1 --format='%h %s' origin/main | cut -c1-100)"
    echo "calculs en cours ou en file : $(occupe)"
    # le verrou d'un tour : libre, ou tenu (un tour qui tourne, ou un processus qui en a hérité)
    if [ -e "$LOCK" ] && ! flock -n "$LOCK" true 2>/dev/null; then
      tiennent=""
      for d in /proc/[0-9]*; do
        ls -l "$d/fd" 2>/dev/null | grep -q "$LOCK" && tiennent="$tiennent ${d#/proc/}:$(tr '\0' ' ' < "$d/cmdline" 2>/dev/null | cut -c1-60)"
      done
      echo "VERROU TENU ($LOCK) par :${tiennent:- ?} — si ce n'est pas un tour en cours, la mise à jour est figée : relancer le portail à la main le libère"
    fi
    if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ] && git diff --name-only HEAD origin/main | grep -q '^server/' && [ "$(occupe)" -gt 0 ]; then
      echo "LA MISE À JOUR ATTEND ces travaux (le serveur change ; un redémarrage les interromprait) — Admin → File pour annuler ceux qui sont coincés :"
      bloquants
    fi
    echo "--- journal ($LOG) ---"
    tail -n 15 "$LOG" 2>/dev/null || echo "(vide)"
    ;;
  *) echo "usage : $0 installe | desinstalle | etat | maintenant | tourne"; exit 2 ;;
esac
