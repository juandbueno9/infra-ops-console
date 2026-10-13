#!/usr/bin/env bash
# Pone el panel nuevo en https://monitoreo.empresa.com y APAGA (no borra) el Grafana del monitoreo.
#   sudo bash cambiar-monitoreo.sh             → cambia a panel nuevo
#   sudo bash cambiar-monitoreo.sh --revertir  → vuelve a Grafana tal como estaba
# NO toca el Grafana de FortiClient EMS (fcems_docker-grafana-1), ni Prometheus, Loki, Blackbox o Alertmanager.
set -euo pipefail
CONF=/etc/nginx/conf.d/infra-ops-console.conf; BK=/root/infra-ops-console.conf.antes-panel
[ "$(id -u)" = 0 ] || { echo "Ejecuta con sudo"; exit 1; }
if [ "${1:-}" = "--revertir" ]; then
  [ -f "$BK" ] || { echo "No hay respaldo $BK"; exit 1; }
  cp -a "$BK" "$CONF"; nginx -t && systemctl reload nginx
  docker update --restart=unless-stopped grafana >/dev/null && docker start grafana >/dev/null
  echo "✔ monitoreo.empresa.com volvió a Grafana"; exit 0
fi
curl -fsS -m 5 http://127.0.0.1:4000/api/health >/dev/null || { echo "✘ El panel nuevo no responde en 127.0.0.1:4000: publícalo primero"; exit 1; }
[ -f "$BK" ] || cp -a "$CONF" "$BK"
python3 - "$CONF" <<'PY'
import re, sys
p = sys.argv[1]; s = open(p).read()
i = s.index('location / {'); j = s.index('}', i)
blk = s[i:j]
new = blk.replace('proxy_pass http://127.0.0.1:3001;', 'proxy_pass http://127.0.0.1:4000;')
if 'proxy_read_timeout' not in new: new = new.rstrip() + '\n        proxy_read_timeout 120s;\n    '
s = s[:i] + new + s[j:]
open(p, 'w').write(s)
PY
if nginx -t 2>/dev/null; then systemctl reload nginx; else cp -a "$BK" "$CONF"; nginx -t; echo "✘ nginx rechazó el cambio: dejé el original"; exit 1; fi
echo "✔ https://monitoreo.empresa.com ahora muestra el panel nuevo (mismas IP permitidas que antes)"
docker update --restart=no grafana >/dev/null && docker stop grafana >/dev/null && echo "✔ Grafana del monitoreo APAGADO (no borrado). Volver: sudo bash cambiar-monitoreo.sh --revertir"
