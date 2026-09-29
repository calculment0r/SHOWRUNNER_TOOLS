#!/usr/bin/env bash
# La démo en ligne : un tunnel rapide Cloudflare (https://….trycloudflare.com) vers la PORTE PUBLIQUE du portail
# (127.0.0.1:9790), jamais vers la maison (8790). Sans compte ni domaine ; pour montrer le prototype, pas pour y
# travailler. Là, rien n'est « le réseau de Cal » : un code d'invitation, puis le pseudo ; un pseudo neuf attend que
# Cal l'accepte ; l'admin entre avec le code admin (server/core/auth.py, porte « demo »).
#
#   tools/demo.sh start            lance le tunnel, affiche l'adresse, le lien et les codes
#   tools/demo.sh stop             l'arrête
#   tools/demo.sh status           en route ? l'adresse, les codes
#   tools/demo.sh nouveaux-codes   d'autres codes : toutes les sessions ouvertes par la porte se ferment
#
# La commande, telle que la documentation la donne (Quick Tunnels,
# https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/) :
#   cloudflared tunnel --url http://127.0.0.1:9790
# Ses limites (même page) : 200 requêtes en vol au plus ; pas de Server-Sent Events (la collaboration en direct
# d'Idéation ne passe pas) ; « intended for testing and development only » ; aucune garantie de service ; une adresse
# tirée au hasard à chaque lancement ; pas de tunnel rapide si ~/.cloudflared/config.yaml existe.
#
# Le PID est gardé dans ~/showrunner-demo.pid (jamais de pkill par motif) ; le journal : ~/showrunner-demo.log.
set -u
cd "$(dirname "$0")/.."
CLOUDFLARED=${CLOUDFLARED:-cloudflared}
PIDF=${DEMO_PID:-$HOME/showrunner-demo.pid}
LOG=${DEMO_LOG:-$HOME/showrunner-demo.log}

py() { python3 server/showrunner.py "$@"; }
running() { [ -f "$PIDF" ] && kill -0 "$(cat "$PIDF")" 2>/dev/null; }
adresse() { read -r HOST PORT MODE < <(py --porte-adresse); }
url_du_journal() { grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" 2>/dev/null | grep -v '^https://api\.' | head -1; }
code() { py --porte-codes | awk -v k="$1" '$1 == k { print $2 }'; }

montre() {
  local url=$1 inv adm
  inv=$(code invitation)
  adm=$(code admin)
  echo "adresse       $url"
  echo "pour un ami   $url/invitation/   code d'invitation : $inv"
  echo "              ou le lien direct : $url/invitation/$inv"
  echo "pour Cal      le code admin : $adm, puis le pseudo nico007"
  echo "les pseudos neufs attendent Cal : page Admin (à la maison, ou par la démo avec le code admin)"
  echo "limites       200 requêtes en vol, pas de SSE (collaboration en direct), essais seulement, adresse neuve à chaque start"
}

start() {
  if running; then echo "déjà en route (pid $(cat "$PIDF"))"; montre "$(url_du_journal)"; return 0; fi
  adresse
  if [ "$MODE" != "demo" ]; then
    echo "la porte publique est en mode « $MODE » (showrunner.local.json, porte.mode) : la démo demande « demo »"; return 1
  fi
  case "$HOST" in 127.*|::1) ;; *) echo "la porte publique doit écouter sur 127.0.0.1, pas $HOST"; return 1 ;; esac
  # la porte « demo » répond X-Porte: demo sur /invitation/ ; la maison y rend 404 : on ne tunnelise jamais la maison
  if ! curl -s -m 5 -o /dev/null -D - "http://$HOST:$PORT/invitation/" | grep -qi '^x-porte: demo'; then
    echo "la porte publique ne répond pas sur $HOST:$PORT (portail à redémarrer : tools/portail.sh restart)"; return 1
  fi
  for f in "$HOME/.cloudflared/config.yaml" "$HOME/.cloudflared/config.yml"; do
    if [ -f "$f" ]; then echo "$f existe : pas de tunnel rapide avec un fichier de configuration (documentation)"; return 1; fi
  done
  command -v "$CLOUDFLARED" > /dev/null || { echo "cloudflared absent"; return 1; }
  py --porte-codes > /dev/null
  : > "$LOG"
  setsid nohup "$CLOUDFLARED" tunnel --url "http://$HOST:$PORT" >> "$LOG" 2>&1 < /dev/null &
  echo $! > "$PIDF"
  local url=""
  for _ in $(seq 1 60); do
    url=$(url_du_journal)
    [ -n "$url" ] && break
    running || break
    sleep 0.5
  done
  if [ -z "$url" ]; then echo "pas d'adresse après 30 s — voir $LOG"; tail -20 "$LOG"; stop > /dev/null; return 1; fi
  py --porte-url "$url" > /dev/null   # l'adresse vaut pour Origin si le tunnel réécrit l'hôte
  echo "en route (pid $(cat "$PIDF"))"
  montre "$url"
}

stop() {
  if running; then
    local pid
    pid=$(cat "$PIDF")
    # le PID gardé doit être le tunnel qu'on a lancé (un PID peut resservir)
    if ps -p "$pid" -o args= | grep -q -- "tunnel --url"; then
      kill "$pid"
      for _ in $(seq 1 25); do kill -0 "$pid" 2> /dev/null || break; sleep 0.2; done
    else
      echo "le PID $pid n'est pas le tunnel : rien de tué"
    fi
  fi
  rm -f "$PIDF"
  py --porte-url "" > /dev/null
  echo "arrêté"
}

status() {
  adresse
  echo "porte publique  $HOST:$PORT ($MODE)"
  if running; then echo "tunnel          en route (pid $(cat "$PIDF"))"; montre "$(url_du_journal)"; else echo "tunnel          arrêté"; fi
}

case "${1:-status}" in
  start) start ;;
  stop) stop ;;
  status) status ;;
  nouveaux-codes) py --porte-codes-nouveaux > /dev/null && echo "nouveaux codes : les sessions de la porte sont fermées" && status ;;
  *) echo "usage : $0 start|stop|status|nouveaux-codes"; exit 2 ;;
esac
