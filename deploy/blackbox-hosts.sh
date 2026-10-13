#!/usr/bin/env bash
# =====================================================================
#  Infra Ops · que blackbox alcance los sitios alojados en ESTE servidor
#
#  El servidor resuelve sus dominios por /etc/hosts (127.0.0.1), pero el
#  contenedor de blackbox no ve ese archivo y las sondas fallan en DNS.
#  Este script agrega "extra_hosts" al servicio de blackbox en el
#  docker-compose, apuntando los dominios a la puerta de enlace de la red
#  Docker (el propio servidor), y recrea SOLO el contenedor de blackbox.
#
#  Uso:  sudo bash /tmp/blackbox-hosts.sh
#  Seguro: prueba antes, respalda el compose, valida y revierte si falla.
# =====================================================================
set -euo pipefail
ok()   { printf '\033[32m✔\033[0m %s\n' "$*"; }
warn() { printf '\033[33m!\033[0m %s\n' "$*"; }
die()  { printf '\033[31m✘\033[0m %s\n' "$*"; exit 1; }
[ "$(id -u)" = 0 ] || die "Ejecuta con sudo"

DOMAINS="consultas contabilidad crm ems extras ingresos ofrenda solicitud-asociado monitoreo vault wiki ocsinventory stg-api stg-listas stg-originacion stg-taquilla stg-cobranza operaciones"

BB="$(docker ps --format '{{.Names}} {{.Image}}' | awk '/blackbox/{print $1; exit}')"
[ -n "$BB" ] || die "No encontré el contenedor de blackbox"
DIR="$(docker inspect "$BB" --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}')"
FILES="$(docker inspect "$BB" --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}')"
SVC="$(docker inspect "$BB" --format '{{index .Config.Labels "com.docker.compose.service"}}')"
COMPOSE="${FILES%%,*}"
[ -f "$COMPOSE" ] || die "No encontré el docker-compose de blackbox ($COMPOSE)"
GW="$(docker inspect "$BB" --format '{{range .NetworkSettings.Networks}}{{.Gateway}} {{end}}' | awk '{print $1}')"
[ -n "$GW" ] || die "No pude leer la puerta de enlace de la red de blackbox"
ok "Blackbox: servicio '$SVC' en $COMPOSE · servidor visto desde Docker: $GW"

probe() { docker exec "$BB" wget -qO- -T 8 "http://127.0.0.1:9115/probe?module=$1&target=$2" 2>/dev/null | awk '/^probe_success /{print $2}'; }

# 1) ¿El contenedor llega al nginx del servidor por la red interna?
if [ "$(probe tcp_connect "$GW:443")" != 1 ]; then
  warn "Desde Docker no se llega a $GW:443. Probablemente ufw bloquea la red de Docker."
  echo "   Revisa:  sudo ufw status   y, si está activo, permite la red de Docker hacia 80/443:"
  NET="$(docker inspect "$BB" --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}/{{.IPPrefixLen}}{{end}}')"
  echo "   sudo ufw allow from ${NET%.*}.0/16 to any port 80,443 proto tcp"
  die "No hice cambios."
fi
ok "Blackbox llega al nginx del servidor ($GW:443)"

# 2) Agregar extra_hosts al servicio (si ya tiene, no tocar)
if awk -v s="$SVC" '
  $0 ~ "^[[:space:]]+"s":[[:space:]]*$" {inside=1; ind=match($0,/[^ ]/); next}
  inside && NF && match($0,/[^ ]/)<=ind {inside=0}
  inside && /extra_hosts:/ {found=1}
  END {exit !found}' "$COMPOSE"; then
  die "El servicio $SVC ya tiene extra_hosts; agrega los dominios a mano (ver deploy/blackbox-hosts.sh)"
fi

STAMP="$(date +%F-%H%M%S)"
cp -a "$COMPOSE" "$COMPOSE.bak-$STAMP"
ok "Respaldo: $COMPOSE.bak-$STAMP"

python3 - "$COMPOSE" "$SVC" "$GW" $DOMAINS > /tmp/infra-compose.yml <<'PY'
import re, sys
path, svc, gw, doms = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4:]
L = open(path).read().split('\n')
i = next(k for k, l in enumerate(L) if re.match(r'^(\s+)' + re.escape(svc) + r':\s*$', l))
base = len(L[i]) - len(L[i].lstrip())
child = next((len(l) - len(l.lstrip()) for l in L[i+1:] if l.strip() and not l.strip().startswith('#')), base + 2)
item = child + 2
block = [' ' * child + 'extra_hosts:'] + [' ' * item + f'- "{d}.empresa.com:{gw}"' for d in doms]
print('\n'.join(L[:i+1] + block + L[i+1:]))
PY
cat /tmp/infra-compose.yml > "$COMPOSE"

cd "$DIR"
if ! docker compose -f "$COMPOSE" config -q 2>/tmp/infra-compose.err; then
  cat "$COMPOSE.bak-$STAMP" > "$COMPOSE"; cat /tmp/infra-compose.err
  die "docker compose rechazó el archivo; restauré el original"
fi
ok "docker-compose válido"

docker compose -f "$COMPOSE" up -d --no-deps "$SVC" >/dev/null 2>&1 || {
  cat "$COMPOSE.bak-$STAMP" > "$COMPOSE"; docker compose -f "$COMPOSE" up -d --no-deps "$SVC" >/dev/null 2>&1 || true
  die "No se pudo recrear blackbox; restauré el original"; }
sleep 4
BB="$(docker ps --format '{{.Names}} {{.Image}}' | awk '/blackbox/{print $1; exit}')"
ok "Blackbox recreado ($BB)"

echo; echo "Probando los sitios desde blackbox:"
bad=0
for d in $DOMAINS; do
  r="$(probe http_2xx "https://$d.empresa.com/")"
  if [ "$r" = 1 ]; then printf '  \033[32m●\033[0m %s\n' "$d.empresa.com"; else bad=$((bad+1)); printf '  \033[31m●\033[0m %s (no responde 2xx: revisa si nginx lo limita por IP)\n' "$d.empresa.com"; fi
done
echo
ok "Listo. En ~15 s el panel mostrará el estado real. $bad sitio(s) con falla."
