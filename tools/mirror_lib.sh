# Le socle des miroirs audio entre DGX1 et DGX2 (tools/mirror_yue.sh,
# tools/mirror_stems.sh) : se source, ne se lance pas.
#
# Chaque miroir déclare, avant `mirror_run` :
#   ITEMS    « propriétaire|chemin sous ~ » (un « / » final = un dossier) ;
#            le propriétaire est la machine de référence (celle où Cal l'a
#            installé) : lancé chez lui on pousse, lancé chez l'autre on tire
#   EXCLUDES[chemin]   options rsync en plus pour cet élément (facultatif)
#   SEEDS    « propriétaire|chemin|source sous ~ » : un élément qui n'existe
#            pas encore est d'abord copié, sur sa machine, depuis la source
#            (un fichier déjà présent ailleurs sur le disque) — facultatif
#   EXPECT[chemin]     « sha256|d'où vient cette empreinte » (facultatif)
#   extra_checks       une fonction : imports, /object_info… (facultatif)
#
# La copie passe par le câble (DGX1 169.254.110.6 <-> DGX2 169.254.42.193),
# en rsync de machine à machine. Rien n'est téléchargé d'internet, rien
# n'est installé par pip, ComfyUI n'est pas relancé. Jamais --delete : un
# fichier en trop de l'autre côté est signalé, pas effacé.
set -uo pipefail

case "$(hostname)" in
  DGX1) SELF=DGX1; PEER=169.254.42.193; PEER_NAME=DGX2 ;;
  DGX2) SELF=DGX2; PEER=169.254.110.6;  PEER_NAME=DGX1 ;;
  *) echo "à lancer sur DGX1 ou DGX2 (ici : $(hostname)), jamais depuis le PC"; exit 2 ;;
esac
CHECK_ONLY=0
[ "${1:-}" = "--check" ] && CHECK_ONLY=1
SSH=(ssh -o BatchMode=yes -o ConnectTimeout=10 "$PEER")
TMP=$(mktemp -d /tmp/mirror_audio.XXXXXX)
trap 'rm -rf "$TMP"' EXIT
exec 9>/tmp/mirror_audio.lock
flock -n 9 || { echo "un autre miroir audio tourne déjà sur $SELF"; exit 3; }
FAIL=0
declare -a ITEMS=() SEEDS=()
declare -A EXCLUDES=() EXPECT=() SUM=()
RSYNC=(rsync -a --partial --mkpath --exclude=__pycache__/ --exclude='*.pyc'
       -e "ssh -o BatchMode=yes -o ConnectTimeout=10")

# ── résumé d'un fichier ou d'un dossier : octets, fichiers, empreinte ──
# L'empreinte couvre chaque chemin, son contenu (sha256) et chaque lien.
# Un dépôt git compte par son commit (ligne « G ») et ses fichiers, pas par
# l'intérieur de .git : l'index garde des dates propres à chaque disque, et
# ComfyUI-Manager (lancé avec DGX1) y écrit .git/.cnr-id — rsync copie .git
# quand même. « blobs HF » : les blobs LFS du cache Hugging Face sont nommés
# par leur sha256 ; on compte ceux dont le contenu redonne bien le nom.
tree_sum() {
  local p="$HOME/$1"
  if [ -f "$p" ]; then
    printf '%s octets, empreinte %s\n' "$(stat -c %s "$p")" "$(sha256sum "$p" | cut -c1-64)"
  elif [ -d "$p" ]; then
    cd "$p" || return 1
    local list; list=$(mktemp)
    local prune=( \( -name __pycache__ -o -name .git -o -path ./out -o -path ./webui-out \) -prune -o )
    {
      find . "${prune[@]}" -type l -printf 'L %p -> %l\n'
      find . "${prune[@]}" -type f ! -name '*.pyc' -print0 | xargs -0 -r sha256sum
      [ -d .git ] && echo "G $(git -C . rev-parse HEAD 2>/dev/null)"
    } | LC_ALL=C sort > "$list"
    local bytes
    bytes=$(find . "${prune[@]}" -type f ! -name '*.pyc' -printf '%s\n' | awk '{s+=$1} END {print s+0}')
    local files; files=$(grep -vc '^[LG] ' "$list")
    local blobs
    blobs=$(awk '$1 != "L" && $2 ~ /\/blobs\/[0-9a-f]+$/ && length($1) == 64 {
                   n = split($2, a, "/"); if (length(a[n]) == 64) { t++; if (a[n] == $1) ok++ } }
                 END { if (t) printf ", blobs HF conformes %d/%d", ok, t }' "$list")
    printf '%s octets, %s fichiers, empreinte %s%s\n' "$bytes" "$files" "$(sha256sum "$list" | cut -c1-64)" "$blobs"
    rm -f "$list"
  else
    echo "absent"
  fi
}

# une fonction de ce fichier, jouée sur l'autre DGX
remote() { { declare -f "$1"; printf '%q ' "$@"; echo; } | "${SSH[@]}" bash -s; }

# « source » -> « chemin », sur la machine où la fonction tourne
seed_one() {
  local dest="$HOME/$1" src="$HOME/$2"
  if [ -e "$dest" ]; then echo "déjà là"; return 0; fi
  if [ ! -e "$src" ]; then echo "source absente : ~/$2"; return 1; fi
  if [ -d "$src" ]; then mkdir -p "$dest" && cp -a "$src/." "$dest/"; else mkdir -p "$(dirname "$dest")" && cp -a "$src" "$dest"; fi \
    && echo "copié depuis ~/$2"
}

mirror_copy() {
  echo "== copie ($SELF <-> $PEER_NAME par $PEER), $(date '+%d/%m %H:%M:%S')"
  local s owner rel src out
  for s in "${SEEDS[@]}"; do
    owner=${s%%|*}; rel=${s#*|}; src=${rel#*|}; rel=${rel%%|*}
    if [ "$owner" = "$SELF" ]; then out=$(seed_one "$rel" "$src"); else out=$(remote seed_one "$rel" "$src"); fi
    echo "  amorce sur $owner  ~/$rel : $out"
    case "$out" in "source absente"*) FAIL=$((FAIL+1)) ;; esac
  done
  local it t0 dir extra
  for it in "${ITEMS[@]}"; do
    owner=${it%%|*}; rel=${it#*|}
    read -r -a extra <<< "${EXCLUDES[$rel]:-}"
    t0=$(date +%s)
    if [ "$owner" = "$SELF" ]; then
      if [ ! -e "$HOME/$rel" ]; then echo "  ABSENT sur la référence $SELF : ~/$rel"; FAIL=$((FAIL+1)); continue; fi
      "${RSYNC[@]}" "${extra[@]}" "$HOME/$rel" "$PEER:$rel" || { echo "  ÉCHEC rsync ~/$rel"; FAIL=$((FAIL+1)); continue; }
      dir="$SELF -> $PEER_NAME"
    else
      "${RSYNC[@]}" "${extra[@]}" "$PEER:$rel" "$HOME/$rel" || { echo "  ÉCHEC rsync ~/$rel"; FAIL=$((FAIL+1)); continue; }
      dir="$PEER_NAME -> $SELF"
    fi
    echo "  $dir  ~/$rel  ($(( $(date +%s) - t0 )) s)"
  done
}

mirror_verify() {
  echo "== vérification des deux côtés, $(date '+%d/%m %H:%M:%S')"
  local it rel l r c
  for it in "${ITEMS[@]}"; do
    rel=${it#*|}
    tree_sum "$rel" > "$TMP/l" 2>&1 &
    remote tree_sum "$rel" > "$TMP/r" 2>&1 &
    wait
    l=$(cat "$TMP/l"); r=$(cat "$TMP/r")
    SUM[$rel]=$l
    if [ "$l" = "$r" ] && [ "$l" != "absent" ]; then
      echo "  identique  ~/$rel : $l"
      case "$l" in *"blobs HF conformes"*)
        c=${l##*conformes }; [ "${c%%/*}" = "${c##*/}" ] || { echo "    blobs HF non conformes à leur nom"; FAIL=$((FAIL+1)); } ;;
      esac
    else
      echo "  DIFFÈRE    ~/$rel"; echo "    $SELF : $l"; echo "    $PEER_NAME : $r"; FAIL=$((FAIL+1))
    fi
  done
  if [ "${#EXPECT[@]}" -gt 0 ]; then
    echo "== empreintes contre leur origine"
    local want from got
    for rel in "${!EXPECT[@]}"; do
      want=${EXPECT[$rel]%%|*}; from=${EXPECT[$rel]#*|}
      got=${SUM[$rel]:-absent}; got=${got##*empreinte }
      if [ "$want" = "$got" ]; then echo "  conforme   ~/$rel  ($from)"
      else echo "  NON CONFORME ~/$rel : attendu $want ($from) ; lu $got"; FAIL=$((FAIL+1)); fi
    done
  fi
}

mirror_run() {
  [ "$CHECK_ONLY" = 0 ] && mirror_copy
  mirror_verify
  if declare -f extra_checks > /dev/null; then extra_checks; fi
  echo "== $([ "$FAIL" = 0 ] && echo "miroir identique" || echo "$FAIL écart(s)"), $(date '+%d/%m %H:%M:%S')"
  exit $((FAIL > 0))
}
