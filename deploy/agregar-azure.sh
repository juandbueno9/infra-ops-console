#!/usr/bin/env bash
# =====================================================================
#  Infra Ops · agrega a Prometheus los servidores de Azure (por la VPN AWS↔Azure)
#    azure_windows → Windows con windows_exporter (:9182)
#  Uso en app-server:   sudo bash /tmp/agregar-azure.sh
#  Seguro: respaldo, valida con promtool y si algo falla restaura el original.
# =====================================================================
set -euo pipefail
PROM_DIR="${PROM_DIR:-/opt/enterprise-tools/infra-ops-console/prometheus}"
PROM_YML="$PROM_DIR/prometheus.yml"
STAMP="$(date +%F-%H%M%S)"
ok()   { printf '\033[32m✔\033[0m %s\n' "$*"; }
warn() { printf '\033[33m!\033[0m %s\n' "$*"; }
die()  { printf '\033[31m✘\033[0m %s\n' "$*"; exit 1; }
[ "$(id -u)" = 0 ] || die "Ejecuta con sudo"
[ -f "$PROM_YML" ] || die "No existe $PROM_YML (define PROM_DIR=...)"

for t in 172.0.10.30:9182 172.0.10.20:9182; do
  if timeout 4 bash -c "</dev/tcp/${t%:*}/${t#*:}" 2>/dev/null; then ok "Responde $t"; else warn "Todavía no responde $t (revisa NSG de Azure, firewall de Windows o el agente). Prometheus lo mostrará caído hasta que responda."; fi
done

cp -a "$PROM_YML" "$PROM_YML.bak-$STAMP"
python3 - "$PROM_YML" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
block = """
  # Infra Ops · servidores de Azure por la VPN (agregado por agregar-azure.sh)
  - job_name: 'azure_windows'
    scrape_interval: 30s
    static_configs:
      - targets: ['172.0.10.20:9182']
        labels: { nube: 'azure', nombre: 'azure-active-directory' }
      - targets: ['172.0.10.30:9182']
        labels: { nube: 'azure', nombre: 'azure-applications' }
"""
if "job_name: 'azure_windows'" in s:
    print("Ya existían los jobs de Azure: sin cambios"); sys.exit(0)
i = s.index("scrape_configs:")
j = s.index("\n", i) + 1
s = s[:j] + block.lstrip("\n") + s[j:]
open(p, "w").write(s)
print("Jobs de Azure agregados")
PY
if docker run --rm -v "$PROM_DIR:/p:ro" --entrypoint promtool prom/prometheus:latest check config /p/prometheus.yml >/tmp/infra-promtool.log 2>&1; then
  ok "promtool: configuración válida"
else
  cat "$PROM_YML.bak-$STAMP" > "$PROM_YML"; cat /tmp/infra-promtool.log; die "promtool rechazó la configuración; restauré el original"
fi
if curl -fsS -X POST http://127.0.0.1:9090/-/reload >/dev/null; then ok "Prometheus recargado (respaldo: $PROM_YML.bak-$STAMP)"
else warn "No pude recargar por /-/reload; ejecuta: sudo docker restart \$(docker ps --format '{{.Names}}' | grep -m1 prometheus)"; fi
