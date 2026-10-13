#!/usr/bin/env bash
# Se ejecuta EN app-server (lo llama scripts/publicar.sh). Instala o actualiza el panel como servicio.
#   sudo bash servidor-instalar.sh /tmp/infra-panel.tgz      → instala la versión nueva (con vuelta atrás automática si no responde)
#   sudo bash servidor-instalar.sh --deshacer              → vuelve a la versión anterior
# No toca Prometheus, Loki, Blackbox, Grafana, nginx ni ningún otro servicio.
set -euo pipefail
APP=/opt/enterprise-tools/infra-panel
SVC=infra-panel
ok() { printf '\033[32m✔\033[0m %s\n' "$*"; }; die() { printf '\033[31m✘\033[0m %s\n' "$*"; exit 1; }
[ "$(id -u)" = 0 ] || die "Ejecuta con sudo"
mkdir -p "$APP/releases" "$APP/shared/data"

health() { for i in $(seq 1 20); do curl -fsS -m 3 http://127.0.0.1:4000/api/health >/dev/null 2>&1 && return 0; sleep 1; done; return 1; }

if [ "${1:-}" = "--deshacer" ]; then
  cur=$(readlink -f "$APP/current" 2>/dev/null || true)
  prev=$(ls -1d "$APP"/releases/* | grep -v "^$cur$" | sort | tail -1)
  [ -n "$prev" ] || die "No hay versión anterior"
  ln -sfn "$prev" "$APP/current"; systemctl restart "$SVC"
  health && ok "Volví a $(basename "$prev")" || die "La versión anterior tampoco responde: journalctl -u $SVC -n 50"
  exit 0
fi

PKG="${1:?Falta el paquete .tgz}"
# Node 18+ (Ubuntu 24.04 trae 18.19 en apt)
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 18 ]; then
  apt-get update -qq && apt-get install -y -qq nodejs npm >/dev/null; ok "Node instalado: $(node -v)"
fi
id infrapanel >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin infrapanel

STAMP=$(date +%Y%m%d-%H%M%S); REL="$APP/releases/$STAMP"
mkdir -p "$REL" && tar --no-same-owner --warning=no-unknown-keyword -xzf "$PKG" -C "$REL"
chown -R root:root "$REL" && chmod -R u=rwX,go=rX "$REL"   # el servicio (usuario infrapanel) debe poder leer la versión
# .env y datos compartidos entre versiones (nunca se pisan al publicar)
if [ -f "$REL/server/.env.nuevo" ]; then
  if [ ! -f "$APP/shared/.env" ]; then mv "$REL/server/.env.nuevo" "$APP/shared/.env"; ok "Configuración (.env) instalada por primera vez"; else rm -f "$REL/server/.env.nuevo"; fi
fi
[ -f "$APP/shared/.env" ] || die "Falta $APP/shared/.env (publica con --env la primera vez)"
if [ -d "$REL/server/data-inicial" ]; then
  [ -z "$(ls -A "$APP/shared/data")" ] && cp -a "$REL/server/data-inicial/." "$APP/shared/data/" && ok "Datos del panel (nombres, reglas, incidentes, auditoría) copiados"
  rm -rf "$REL/server/data-inicial"
fi
ln -sfn "$APP/shared/.env" "$REL/server/.env"
chmod 600 "$APP/shared/.env"; chown -R infrapanel:infrapanel "$APP/shared"; chown root:infrapanel "$APP/shared/.env"; chmod 640 "$APP/shared/.env"
(cd "$REL/server" && npm ci --omit=dev --no-audit --no-fund --loglevel=error) || die "npm ci falló"
# Escaneo de dependencias (solo informa; se ve en Configuración → Seguridad del panel). Nunca bloquea ni cambia paquetes.
(cd "$REL/server" && timeout 60 npm audit --omit=dev --json > "$APP/shared/data/npm-audit-server.json" 2>/dev/null) || true
[ -f "$REL/web/npm-audit.json" ] && cp "$REL/web/npm-audit.json" "$APP/shared/data/npm-audit-web.json"
chown infrapanel:infrapanel "$APP/shared/data/"npm-audit-*.json 2>/dev/null || true
ok "Dependencias instaladas"

cat > /etc/systemd/system/$SVC.service <<UNIT
[Unit]
Description=Infra Ops - Panel de monitoreo (infra-ops-console)
After=network-online.target docker.service
Wants=network-online.target

[Service]
User=infrapanel
WorkingDirectory=$APP/current/server
Environment=NODE_ENV=production
Environment=HOST=127.0.0.1
Environment=PORT=4000
Environment=DATA_DIR=$APP/shared/data
ExecStart=/usr/bin/env node src/index.js
Restart=always
RestartSec=5
NoNewPrivileges=true
ProtectSystem=full
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload; systemctl enable -q $SVC

PREV=""; if [ -L "$APP/current" ]; then PREV=$(readlink -f "$APP/current" 2>/dev/null || true); fi
case "$PREV" in "$APP"/releases/*) [ -d "$PREV" ] || PREV="";; *) PREV="";; esac
ln -sfn "$REL" "$APP/current"
systemctl restart $SVC
if health; then
  ok "Panel $STAMP en línea en http://127.0.0.1:4000"
  ls -1d "$APP"/releases/* | sort | head -n -5 | xargs -r rm -rf   # deja las 5 últimas versiones
else
  [ -n "$PREV" ] && { ln -sfn "$PREV" "$APP/current"; systemctl restart $SVC; health && echo "↩ La versión nueva no respondió: volví a $(basename "$PREV")"; }
  journalctl -u $SVC -n 30 --no-pager; die "La versión nueva no arrancó"
fi
