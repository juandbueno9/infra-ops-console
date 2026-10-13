#!/usr/bin/env bash
# Infra Ops · deshace lo que agregó instalar-stack.sh y deja el stack como estaba.
#   sudo bash desinstalar-stack.sh              (conserva los logs guardados en Loki)
#   sudo bash desinstalar-stack.sh --borrar-datos
set -euo pipefail
trap 'rc=$?; [ $rc -ne 0 ] && printf "\\033[31m✘\\033[0m Se detuvo en la línea %s (código %s)\\n" "$LINENO" "$rc"' EXIT
ok() { printf '\033[32m✔\033[0m %s\n' "$*"; }
die() { trap - EXIT; printf '\033[31m✘\033[0m %s\n' "$*"; exit 1; }
[ "$(id -u)" = 0 ] || die "Ejecuta con sudo"
PC="$(docker ps -a --format '{{.Names}} {{.Image}}' | awk '$2 ~ /prom\/prometheus/ {print $1; exit}')"
[ -n "$PC" ] || die "No encontré Prometheus"
DIR="$(docker inspect "$PC" --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}')"
MAIN="$(docker inspect "$PC" --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}')"; MAIN="${MAIN%%,*}"
SVC="$(docker inspect "$PC" --format '{{index .Config.Labels "com.docker.compose.service"}}')"
FIRST="$(cat "$DIR/infra/primer-respaldo" 2>/dev/null || true)"
[ -n "$FIRST" ] && [ -d "$FIRST" ] || die "No encontré el respaldo original (infra/primer-respaldo)"
PROM_SRC=""
while read -r s; do
  [ -z "$s" ] && continue
  if [ -f "$s" ] && [[ "$s" == *prometheus.yml ]]; then PROM_SRC="$s"; fi
  if [ -d "$s" ] && [ -f "$s/prometheus.yml" ]; then PROM_SRC="$s/prometheus.yml"; fi
done < <(docker inspect "$PC" --format '{{range .Mounts}}{{.Source}}{{"\n"}}{{end}}')
[ -n "$PROM_SRC" ] || die "No encontré prometheus.yml"
cd "$DIR"
for c in infra-loki infra-promtail infra-alertmanager infra-mysqld-exporter infra-postgres-exporter infra-mssql-exporter infra-cloudwatch; do
  if docker inspect "$c" >/dev/null 2>&1; then docker rm -f "$c" >/dev/null && ok "Quitado $c"; fi
done
cp -a "$PROM_SRC" "$PROM_SRC.antes-de-desinstalar-$(date +%F-%H%M%S)"
cat "$FIRST/prometheus.yml" > "$PROM_SRC"; ok "prometheus.yml restaurado al original"
if [ -f "$FIRST/.env" ]; then cat "$FIRST/.env" > "$DIR/.env"
elif [ -f "$DIR/.env" ]; then
  sed -i '/COMPOSE_FILE=.*docker-compose.infra.yml/d;/la empresa: carga también/d' "$DIR/.env"
  grep -q '[^[:space:]]' "$DIR/.env" || rm -f "$DIR/.env"
fi
ok "Archivo .env como estaba"
mv "$DIR/docker-compose.infra.yml" "$DIR/docker-compose.infra.yml.desinstalado" 2>/dev/null || true
docker compose -f "$MAIN" up -d --no-deps "$SVC" >/dev/null && ok "Prometheus con su configuración original"
rm -f /etc/cron.daily/infra-respaldo
mv "$DIR/infra/primer-respaldo" "$DIR/infra/primer-respaldo.usado-$(date +%F-%H%M%S)"   # la próxima instalación toma el estado de ese momento
if [ "${1:-}" = "--borrar-datos" ]; then
  docker volume ls -q | grep -E '_infra_(loki_data|promtail_positions|alertmanager_data)$' | xargs -r docker volume rm >/dev/null && ok "Datos de Loki/Alertmanager borrados"
fi
ok "Listo: el stack quedó como antes de instalar-stack.sh (las reglas quedan en disco, sin usarse)."
trap - EXIT
