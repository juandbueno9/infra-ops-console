#!/usr/bin/env bash
# Sube el panel a app-server con un solo comando (desde tu Mac).
#   npm run publicar            → compila, sube y reinicia (vuelve solo a la versión anterior si falla)
#   npm run publicar -- --env   → la PRIMERA vez: además sube la configuración (.env) y los datos del panel
#   npm run publicar:deshacer   → vuelve a la versión anterior
set -euo pipefail
cd "$(dirname "$0")/.."
H="${INFRA_HOST:-app-server}"
if [ "${1:-}" = "--deshacer" ]; then ssh "$H" "sudo bash /opt/enterprise-tools/infra-panel/servidor-instalar.sh --deshacer"; exit; fi
echo "→ Compilando la página…"; npm --prefix web run build --silent >/tmp/infra-build.log 2>&1 || { tail -20 /tmp/infra-build.log; exit 1; }
T=$(mktemp -d); mkdir -p "$T/server" "$T/web"
cp -R server/src server/package.json server/package-lock.json "$T/server/"; [ -d server/scripts ] && cp -R server/scripts "$T/server/"
cp -R web/dist "$T/web/dist"
# Escaneo de dependencias de la página (solo informa, no cambia nada)
(cd web && npm audit --omit=dev --json > "$T/web/npm-audit.json" 2>/dev/null) || true
node -e 'try{const v=require(process.argv[1]).metadata.vulnerabilities;console.log(`  · dependencias de la página: ${v.critical} críticas, ${v.high} altas, ${v.moderate} moderadas`)}catch{}' "$T/web/npm-audit.json" || true
if [ "${1:-}" = "--env" ]; then
  # .env del servidor = el de tu Mac con las direcciones locales del servidor (Prometheus/Loki/FortiGate sin túnel)
  sed -E -e '/^(HOST|PORT|PROM_URL|LOKI_URL|FORTIGATE_URL|DATA_DIR|NODE_ENV)=/d' server/.env > "$T/server/.env.nuevo"
  printf '%s\n' 'PROM_URL=http://127.0.0.1:9090' 'LOKI_URL=http://127.0.0.1:3100' 'FORTIGATE_URL=https://192.168.10.253:10443' >> "$T/server/.env.nuevo"
  [ -d server/data ] && cp -R server/data "$T/server/data-inicial"
  echo "  · incluye configuración (.env) y datos del panel (solo se usan si el servidor aún no los tiene)"
fi
COPYFILE_DISABLE=1 tar --no-xattrs -czf /tmp/infra-panel.tgz -C "$T" . && rm -rf "$T"
echo "→ Subiendo a ${H}…"
scp -q /tmp/infra-panel.tgz deploy/panel/servidor-instalar.sh deploy/panel/cambiar-monitoreo.sh deploy/panel/eliminar-grafana.sh deploy/escaneos-red.sh deploy/fail2ban-metricas.sh deploy/diagnostico-vpn.sh "$H":/tmp/
ssh "$H" "sudo mkdir -p /opt/enterprise-tools/infra-panel && sudo cp /tmp/servidor-instalar.sh /tmp/cambiar-monitoreo.sh /tmp/eliminar-grafana.sh /tmp/escaneos-red.sh /tmp/fail2ban-metricas.sh /tmp/diagnostico-vpn.sh /opt/enterprise-tools/infra-panel/ && sudo bash /opt/enterprise-tools/infra-panel/servidor-instalar.sh /tmp/infra-panel.tgz && rm -f /tmp/infra-panel.tgz"
rm -f /tmp/infra-panel.tgz
echo "✔ Publicado. Pruébalo desde tu Mac con:  ssh -N -L 4100:127.0.0.1:4000 ${H}   y abre http://localhost:4100"
