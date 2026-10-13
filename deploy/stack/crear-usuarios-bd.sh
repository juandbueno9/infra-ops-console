#!/usr/bin/env bash
# Infra Ops · crea usuarios de SOLO LECTURA para monitorear MySQL y PostgreSQL.
# Solo permisos de estadísticas (no pueden leer ni cambiar datos de negocio).
# Guarda las credenciales en <proyecto>/infra/bd.env (permisos 600).
#   sudo bash crear-usuarios-bd.sh
set -euo pipefail
ok() { printf '\033[32m✔\033[0m %s\n' "$*"; }
warn() { printf '\033[33m!\033[0m %s\n' "$*"; }
die() { printf '\033[31m✘\033[0m %s\n' "$*"; exit 1; }
[ "$(id -u)" = 0 ] || die "Ejecuta con sudo"
PC="$(docker ps --format '{{.Names}} {{.Image}}' | awk '$2 ~ /prom\/prometheus/ {print $1; exit}')"
DIR="$(docker inspect "$PC" --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}')"
ENVF="$DIR/infra/bd.env"; mkdir -p "$DIR/infra"
[ -f "$ENVF" ] && cp -a "$ENVF" "$ENVF.bak-$(date +%F-%H%M%S)"
PASS="$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 28)"
FLAGS=""
: > "$ENVF.tmp"; chmod 600 "$ENVF.tmp"
echo "# Generado por crear-usuarios-bd.sh — usuarios de solo lectura para monitoreo" >> "$ENVF.tmp"
if systemctl is-active --quiet mysql || systemctl is-active --quiet mariadb; then
  mysql -e "CREATE USER IF NOT EXISTS 'infra_monitor'@'127.0.0.1' IDENTIFIED BY '$PASS' WITH MAX_USER_CONNECTIONS 3;
            ALTER USER 'infra_monitor'@'127.0.0.1' IDENTIFIED BY '$PASS';
            GRANT PROCESS, REPLICATION CLIENT ON *.* TO 'infra_monitor'@'127.0.0.1';
            GRANT SELECT ON performance_schema.* TO 'infra_monitor'@'127.0.0.1';" \
    && { echo "MYSQLD_EXPORTER_PASSWORD=$PASS" >> "$ENVF.tmp"; FLAGS="$FLAGS --bd-mysql"; ok "MySQL: usuario infra_monitor (PROCESS, REPLICATION CLIENT, performance_schema)"; } \
    || warn "MySQL: no pude crear el usuario (¿root no entra por socket? créalo a mano con los permisos de arriba)"
fi
if systemctl is-active --quiet postgresql; then
  sudo -u postgres psql -v ON_ERROR_STOP=1 -q <<SQL >/dev/null \
    && { echo "DATA_SOURCE_NAME=postgresql://infra_monitor:$PASS@127.0.0.1:5432/postgres?sslmode=disable" >> "$ENVF.tmp"; FLAGS="$FLAGS --bd-postgres"; ok "PostgreSQL: rol infra_monitor (pg_monitor)"; } \
    || warn "PostgreSQL: no pude crear el rol"
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'infra_monitor') THEN CREATE ROLE infra_monitor LOGIN; END IF;
END \$\$;
ALTER ROLE infra_monitor WITH LOGIN PASSWORD '$PASS' CONNECTION LIMIT 3;
GRANT pg_monitor TO infra_monitor;
SQL
fi
mv "$ENVF.tmp" "$ENVF"
[ -n "$FLAGS" ] || die "No encontré MySQL ni PostgreSQL activos en este servidor"
echo; ok "Credenciales en $ENVF (solo root puede leerlas)"
echo "Ahora ejecuta:  sudo bash $(dirname "$0")/instalar-stack.sh$FLAGS"
