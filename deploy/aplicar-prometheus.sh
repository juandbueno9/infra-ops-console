#!/usr/bin/env bash
# =====================================================================
#  Infra Ops · aplica en Prometheus los monitores nuevos del panel
#
#   1. Sucursal virtual (job blackbox_http_externos)
#   2. Exposición de puertos a Internet (job exposicion_puertos)
#   3. Red de agencias por SD-WAN (job red_agencias, ping ICMP)
#
#  Uso en el servidor:
#     sudo bash /tmp/aplicar-prometheus.sh /tmp/agencias.csv
#
#  Seguro: copia de respaldo, valida con promtool y si algo falla restaura
#  el archivo original. Si un job ya existe no lo vuelve a agregar.
# =====================================================================
set -euo pipefail

PROM_DIR="${PROM_DIR:-/opt/enterprise-tools/infra-ops-console/prometheus}"
PROM_YML="$PROM_DIR/prometheus.yml"
CSV="${1:-/tmp/agencias.csv}"
STAMP="$(date +%F-%H%M%S)"
ok()   { printf '\033[32m✔\033[0m %s\n' "$*"; }
warn() { printf '\033[33m!\033[0m %s\n' "$*"; }
die()  { printf '\033[31m✘\033[0m %s\n' "$*"; exit 1; }

[ "$(id -u)" = 0 ] || die "Ejecuta con sudo"
[ -f "$PROM_YML" ] || die "No existe $PROM_YML (define PROM_DIR=...)"
command -v python3 >/dev/null || die "Falta python3"

BB="$(docker ps --format '{{.Names}} {{.Image}}' | awk '/blackbox/{print $1; exit}')"
[ -n "$BB" ] || die "No encontré el contenedor de blackbox_exporter"
ok "Blackbox: contenedor $BB"

# ---------- 1) módulos tcp_connect e icmp en blackbox.yml ----------
BB_CFG="$(docker inspect "$BB" --format '{{range .Mounts}}{{.Source}}{{"\n"}}{{end}}' | grep -E '\.ya?ml$' | head -1 || true)"
if [ -z "$BB_CFG" ]; then
  BB_DIR="$(docker inspect "$BB" --format '{{range .Mounts}}{{.Source}}{{"\n"}}{{end}}' | head -1)"
  BB_CFG="$(ls "$BB_DIR"/*.yml "$BB_DIR"/*.yaml 2>/dev/null | head -1 || true)"
fi
[ -n "$BB_CFG" ] && [ -f "$BB_CFG" ] || die "No encontré blackbox.yml del contenedor $BB"
ok "Configuración de blackbox: $BB_CFG"

BB_CHANGED=0
if ! grep -qE '^\s{2}tcp_connect:' "$BB_CFG" || ! grep -qE '^\s{2}icmp:' "$BB_CFG" || ! grep -qE '^\s{2}http_app:' "$BB_CFG"; then
  top="$(grep -cE '^[A-Za-z_]' "$BB_CFG")"
  [ "$top" = 1 ] && grep -q '^modules:' "$BB_CFG" || die "blackbox.yml tiene más secciones que 'modules:'; agrega tcp_connect/icmp a mano"
  cp -a "$BB_CFG" "$BB_CFG.bak-$STAMP"
  grep -qE '^\s{2}tcp_connect:' "$BB_CFG" || printf '  tcp_connect:\n    prober: tcp\n    timeout: 5s\n' >> "$BB_CFG"
  grep -qE '^\s{2}icmp:' "$BB_CFG" || printf '  icmp:\n    prober: icmp\n    timeout: 5s\n    icmp:\n      preferred_ip_protocol: ip4\n' >> "$BB_CFG"
  grep -qE '^\s{2}http_app:' "$BB_CFG" || printf '  http_app:\n    prober: http\n    timeout: 10s\n    http:\n      preferred_ip_protocol: ip4\n      valid_status_codes: [200, 201, 202, 203, 204, 206, 401]\n      follow_redirects: true\n' >> "$BB_CFG"
  BB_CHANGED=1
  docker restart "$BB" >/dev/null && sleep 4
  if ! docker ps --format '{{.Names}}' | grep -qx "$BB"; then
    cat "$BB_CFG.bak-$STAMP" > "$BB_CFG"; docker restart "$BB" >/dev/null
    die "Blackbox no arrancó con los módulos nuevos; restauré su configuración"
  fi
  ok "Módulos tcp_connect e icmp agregados a blackbox (respaldo .bak-$STAMP)"
else
  ok "Blackbox ya tiene tcp_connect e icmp"
fi

probe() { docker exec "$BB" wget -qO- -T 8 "http://127.0.0.1:9115/probe?module=$1&target=$2" 2>/dev/null | awk '/^probe_success /{print $2}'; }

# ---------- 2) detectar la IP de cada agencia ----------
[ -f "$CSV" ] || die "No encuentro $CSV (copia deploy/agencias.csv a /tmp)"
echo; echo "Buscando el equipo de cada agencia por la VPN (ping desde AWS)…"
RESOLVED="$(mktemp)"
python3 - "$CSV" > "$RESOLVED.in" <<'PY'
import csv, sys
for r in csv.DictReader(open(sys.argv[1], encoding='utf-8')):
    print('|'.join([r['agencia'], r['ciudad'], r.get('direccion','') or '-', r['subred'], r.get('ip','').strip() or '-']))
PY
up=0; total=0
while IFS='|' read -r ag ciudad dir subred ip; do
  [ "$dir" = - ] && dir=""; [ "$ip" = - ] && ip=""
  total=$((total+1))
  base="${subred%.*}"; cands="$ip"
  [ -z "$ip" ] && cands="$base.254 $base.1"
  found=""
  for c in $cands; do [ "$(probe icmp "$c")" = 1 ] && { found="$c"; break; }; done
  if [ -n "$found" ]; then up=$((up+1)); printf '  \033[32m●\033[0m %-22s %s\n' "$ag" "$found"
  else found="${ip:-$base.254}"; printf '  \033[31m●\033[0m %-22s sin respuesta (queda %s, confírmalo)\n' "$ag" "$found"; fi
  printf '%s|%s|%s|%s|%s\n' "$ag" "$ciudad" "$dir" "$subred" "$found" >> "$RESOLVED"
done < "$RESOLVED.in"
echo "  → $up de $total agencias responden desde AWS"
[ "$up" = 0 ] && warn "Ninguna responde: revisa que la VPN-AWS lleve las redes 192.168.x (fase 2 + rutas de la VPC) y que la política permita ICMP desde 172.31.0.0/16"

echo; echo "Alcance desde AWS hacia el FortiGate principal:"
for t in 192.168.10.253:443 192.168.10.253:10443 192.168.10.254:443; do
  if [ "$(probe tcp_connect "$t")" = 1 ]; then printf '  \033[32m●\033[0m %s responde\n' "$t"; else printf '  \033[31m●\033[0m %s sin respuesta\n' "$t"; fi
done

echo; echo "Ruta sede principal ↔ AWS:"
WAN=203.0.113.10; WAN_MOD=icmp; WAN_T="$WAN"
if [ "$(probe icmp "$WAN")" = 1 ]; then printf '  \033[32m●\033[0m Internet sede (%s) responde ping\n' "$WAN"
else
  WAN_MOD=""; for pt in 443 10443 8443; do [ "$(probe tcp_connect "$WAN:$pt")" = 1 ] && { WAN_MOD=tcp_connect; WAN_T="$WAN:$pt"; break; }; done
  if [ -n "$WAN_MOD" ]; then printf '  \033[32m●\033[0m Internet sede responde en %s (sin ping)\n' "$WAN_T"
  else WAN_MOD=icmp; printf '  \033[33m●\033[0m Internet sede (%s) no responde ping ni 443/10443/8443; se vigila por ping igual\n' "$WAN"; fi
fi
[ "$(probe icmp 192.168.10.254)" = 1 ] && printf '  \033[32m●\033[0m VPN AWS → LAN sede (192.168.10.254) responde\n' || printf '  \033[31m●\033[0m VPN AWS → LAN sede sin respuesta\n'
export WAN_MOD WAN_T SKIP_AG=$([ "$up" -lt 2 ] && echo 1 || echo 0)
[ "$SKIP_AG" = 1 ] && warn "No agrego red_agencias todavía: desde AWS no se alcanzan las agencias (saldrían todas rojas)."

# ---------- 3) agregar los jobs a prometheus.yml ----------
grep -q '^scrape_configs:' "$PROM_YML" || die "prometheus.yml no tiene scrape_configs:"
cp -a "$PROM_YML" "$PROM_YML.bak-$STAMP"
ok "Respaldo: $PROM_YML.bak-$STAMP"
# Si red_agencias ya existe se reemplaza con las IPs nuevas (cat > conserva el inodo)
if grep -q "job_name: 'red_agencias'" "$PROM_YML"; then
  python3 - "$PROM_YML" > /tmp/infra-prom-sin-agencias.yml <<'PY'
import re, sys
L = open(sys.argv[1]).read().split('\n')
i = next(k for k, l in enumerate(L) if "job_name: 'red_agencias'" in l)
if i > 0 and L[i-1].strip().startswith('# Infra Ops · agencias'): i -= 1
j = next((k for k in range(i + 2, len(L)) if re.match(r"^  - job_name:|^  # la empresa", L[k])), len(L))
while i > 0 and L[i-1].strip() == '': i -= 1
print('\n'.join(L[:i] + L[j:]).rstrip('\n'))
PY
  cat /tmp/infra-prom-sin-agencias.yml > "$PROM_YML"
  ok "Job red_agencias anterior quitado; se agrega con las IPs nuevas"
fi

python3 - "$PROM_YML" "$RESOLVED" <<'PY' > /tmp/infra-jobs.yml
import os, sys
prom = open(sys.argv[1]).read()
has = lambda j: f"job_name: '{j}'" in prom or f'job_name: "{j}"' in prom or f"job_name: {j}\n" in prom
relabel = """    relabel_configs:
      - source_labels: [__address__]
        target_label: __param_target
      - source_labels: [__param_target]
        target_label: instance
      - target_label: __address__
        replacement: blackbox_exporter:9115
"""
q = lambda s: "'" + s.replace("'", "''") + "'"
out = []
if not has('blackbox_http_externos'):
    out.append("""
  # Infra Ops · sitios de proveedores externos (sucursal virtual)
  - job_name: 'blackbox_http_externos'
    scrape_interval: 15s
    scrape_timeout: 10s
    metrics_path: /probe
    params:
      module: [http_2xx]
    static_configs:
      - targets:
          - https://sucursalvirtual.empresa.com/cdigital/aplicacion/?id=4F1B75484C394A3C9821DE3919B9835E
""" + relabel)
if not has('blackbox_http_proyectos'):
    projs = ['consultas','contabilidad','crm','ems','ingresos','ofrenda','solicitud-asociado','monitoreo','vault','wiki','ocsinventory','operaciones',
             'stg-api','stg-listas','stg-originacion','stg-taquilla','stg-cobranza']
    urls = [f'https://{p}.empresa.com/' for p in projs] + ['https://extras.empresa.com/formulario_horas.html']
    urls = [u for u in urls if u not in prom]          # no duplicar los que ya vigila blackbox_http
    if urls:
        out.append("""
  # Infra Ops · proyectos alojados en app-server (uptime + SSL)
  - job_name: 'blackbox_http_proyectos'
    scrape_interval: 15s
    scrape_timeout: 10s
    metrics_path: /probe
    params:
      module: [http_app]
    static_configs:
      - targets:
""" + ''.join(f"          - {u}\n" for u in urls) + relabel)
if not has('exposicion_puertos'):
    ports = [21,22,23,25,80,443,445,1433,1521,3306,3389,5432,5900,6379,8080,8443,9090,9100,10443,27017]
    tg = [('empresa.com','empresa.com','Hosting externo'),('sucursalvirtual.empresa.com','sucursalvirtual.empresa.com','Proveedor externo (Google Cloud)'),
          ('203.0.113.10','FortiGate oficina (WAN)','INFRA OPS-PPAL'),('203.0.113.11','app-server','AWS EC2')]
    s = """
  # Infra Ops · exposición de puertos a Internet (tcp connect cada 5 min)
  - job_name: 'exposicion_puertos'
    scrape_interval: 5m
    scrape_timeout: 10s
    metrics_path: /probe
    params:
      module: [tcp_connect]
    static_configs:
"""
    for h, n, o in tg:
        s += f"      - labels: {{ objetivo: {q(n)}, propietario: {q(o)} }}\n        targets: [{', '.join(f'{h}:{p}' for p in ports)}]\n"
    out.append(s + relabel)
if not has('red_sede'):
    wm, wt = os.environ.get('WAN_MOD', 'icmp'), os.environ.get('WAN_T', '203.0.113.10')
    s = """
  # Infra Ops · ruta sede principal <-> AWS (ping cada 15 s)
  - job_name: 'red_sede'
    scrape_interval: 15s
    scrape_timeout: 10s
    metrics_path: /probe
    params:
      module: [icmp]
    static_configs:
      - targets: [192.168.10.254]
        labels: { capa: 'vpn', nombre: 'VPN AWS → LAN sede principal' }
"""
    if wm == 'icmp':
        s += f"      - targets: [{wt}]\n        labels: {{ capa: 'internet', nombre: 'Internet sede principal (WAN)' }}\n"
    out.append(s + relabel)
    if wm != 'icmp':
        out.append(f"""
  # Infra Ops · Internet sede principal por TCP (la WAN no responde ping)
  - job_name: 'red_sede_tcp'
    scrape_interval: 15s
    scrape_timeout: 10s
    metrics_path: /probe
    params:
      module: [tcp_connect]
    static_configs:
      - targets: [{wt}]
        labels: {{ capa: 'internet', nombre: 'Internet sede principal (WAN)' }}
""" + relabel)
if not has('red_agencias') and os.environ.get('SKIP_AG') != '1':
    s = """
  # Infra Ops · agencias por SD-WAN (ping ICMP cada 30 s). Edita IPs aquí.
  - job_name: 'red_agencias'
    scrape_interval: 30s
    scrape_timeout: 10s
    metrics_path: /probe
    params:
      module: [icmp]
    static_configs:
"""
    for line in open(sys.argv[2], encoding='utf-8'):
        ag, ciudad, d, subred, ip = line.rstrip('\n').split('|')
        s += f"      - targets: [{ip}]\n        labels: {{ agencia: {q(ag)}, ciudad: {q(ciudad)}, direccion: {q(d)}, subred: {q(subred)} }}\n"
    out.append(s + relabel)
print(''.join(out), end='')
PY

if [ ! -s /tmp/infra-jobs.yml ]; then ok "Los jobs ya estaban en prometheus.yml. Nada que agregar."; exit 0; fi
# Inserta los jobs al final de la sección scrape_configs (aunque haya otras secciones después),
# con la misma sangría que usa el archivo. cat > conserva el inodo: el contenedor ve el cambio.
python3 - "$PROM_YML" /tmp/infra-jobs.yml > /tmp/infra-prom-nuevo.yml <<'PY'
import re, sys
L = open(sys.argv[1]).read().rstrip('\n').split('\n')
jobs = open(sys.argv[2]).read().rstrip('\n').split('\n')
s = next(k for k, l in enumerate(L) if re.match(r'^scrape_configs:', l))
e = next((k for k in range(s + 1, len(L)) if re.match(r'^[A-Za-z_]', L[k])), len(L))
while e - 1 > s and (L[e-1].strip() == '' or L[e-1].startswith('#')): e -= 1
m = next((re.match(r'^(\s*)- ', L[k]) for k in range(s + 1, e) if re.match(r'^\s*- ', L[k])), None)
ind = m.group(1) if m else '  '
fix = lambda l: (ind + l[2:]) if l.startswith('  ') else l
print('\n'.join(L[:e] + [fix(l) for l in jobs] + L[e:]))
PY
cat /tmp/infra-prom-nuevo.yml > "$PROM_YML"

if docker run --rm -v "$PROM_DIR:/p:ro" --entrypoint promtool prom/prometheus:latest check config /p/prometheus.yml >/tmp/infra-promtool.log 2>&1; then
  ok "promtool: configuración válida"
else
  cat "$PROM_YML.bak-$STAMP" > "$PROM_YML"
  cat /tmp/infra-promtool.log; die "promtool rechazó la configuración; restauré el original"
fi
if curl -fsS -X POST http://127.0.0.1:9090/-/reload >/dev/null; then ok "Prometheus recargado"
else warn "No pude recargar por /-/reload; ejecuta: sudo docker restart \$(docker ps --format '{{.Names}}' | grep -m1 prometheus)"; fi

echo
ok "Listo. En 1–5 minutos verás en el panel la sucursal en Sitios, la exposición de puertos y la ruta sede ↔ AWS en Red y agencias."
[ "$BB_CHANGED" = 1 ] && echo "  (blackbox se reinició para cargar los módulos nuevos)"
rm -f "$RESOLVED" "$RESOLVED.in"
