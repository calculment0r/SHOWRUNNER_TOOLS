#!/usr/bin/env bash
# Démarrer, arrêter, relancer le portail sur la machine (DGX2).
#   tools/portail.sh start | stop | restart | status
# Le PID est gardé dans ~/showrunner.pid : pas de pkill par motif, qui
# tuerait aussi la commande ssh qui l'appelle.
set -u
cd "$(dirname "$0")/.."
PIDF="$HOME/showrunner.pid"
LOG="$HOME/showrunner.log"

running() { [ -f "$PIDF" ] && kill -0 "$(cat "$PIDF")" 2>/dev/null; }

start() {
  if running; then echo "déjà en route (pid $(cat "$PIDF"))"; return 0; fi
  setsid nohup python3 server/showrunner.py > "$LOG" 2>&1 < /dev/null &
  echo $! > "$PIDF"
  for _ in $(seq 1 30); do
    if curl -s -o /dev/null "http://127.0.0.1:${SHOWRUNNER_PORT:-8790}/api/library?limit=1"; then
      echo "en route (pid $(cat "$PIDF"))"; head -3 "$LOG"; return 0
    fi
    sleep 0.3
  done
  echo "ne répond pas — voir $LOG"; tail -20 "$LOG"; return 1
}

stop() {
  if running; then kill "$(cat "$PIDF")"; sleep 1; fi
  rm -f "$PIDF"
  echo "arrêté"
}

case "${1:-status}" in
  start) start ;;
  stop) stop ;;
  restart) stop; start ;;
  status) if running; then echo "en route (pid $(cat "$PIDF"))"; else echo "arrêté"; fi ;;
  *) echo "usage : $0 start|stop|restart|status"; exit 2 ;;
esac
