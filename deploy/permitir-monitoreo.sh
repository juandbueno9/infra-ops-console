#!/usr/bin/env bash
# =====================================================================
#  Infra Ops · que el monitoreo vea los sitios restringidos por IP
#
#  1. nginx: agrega la red Docker interna del monitoreo (p. ej. 172.19.0.0/16)
#     a las listas "allow ... deny all" de los sitios. Es una red interna
#     del servidor: NO abre nada a Internet.
#  2. blackbox: módulo http_app que cuenta como "arriba" 2xx y 401 (login).
#     Un 403/404/5xx, timeout o sin respuesta sigue contando como caído.
#  3. Prometheus: el job blackbox_http_proyectos usa http_app y agrega
#     operaciones.empresa.com.
#
#  Uso:  sudo bash /tmp/permitir-monitoreo.sh
#  Seguro: respaldos fuera de sites-enabled, nginx -t / promtool, y
#  restauración automática si algo falla.
# =====================================================================
set -euo pipefail
trap 'rc=$?; [ $rc -ne 0 ] && printf "\033[31m✘\033[0m El script se detuvo en la línea %s (código %s). No se completaron los pasos siguientes.\n" "$LINENO" "$rc"' EXIT
ok()   { printf '\033[32m✔\033[0m %s\n' "$*"; }
warn() { printf '\033[33m!\033[0m %s\n' "$*"; }
die()  { trap - EXIT; printf '\033[31m✘\033[0m %s\n' "$*"; exit 1; }
[ "$(id -u)" = 0 ] || die "Ejecuta con sudo"

PROM_DIR="${PROM_DIR:-/opt/enterprise-tools/infra-ops-console/prometheus}"
PROM_YML="$PROM_DIR/prometheus.yml"
STAMP="$(date +%F-%H%M%S)"
BAK="/root/infra-backups/$STAMP"; mkdir -p "$BAK/nginx"

BB="$(docker ps --format '{{.Names}} {{.Image}}' | awk '/blackbox/{print $1; exit}')"
[ -n "$BB" ] || die "No encontré el contenedor de blackbox"
NETNAME="$(docker inspect "$BB" --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' | awk '{print $1}')"
SUBNET="$(docker network inspect "$NETNAME" --format '{{range .IPAM.Config}}{{.Subnet}} {{end}}' | awk '{print $1}')"
[[ "$SUBNET" =~ ^(10|172|192)\. ]] || die "Subred Docker inesperada: '$SUBNET'"
ok "Red interna del monitoreo: $NETNAME ($SUBNET)"

# ---------- 1) nginx ----------
shopt -s nullglob
CANDS=(/etc/nginx/sites-enabled/* /etc/nginx/conf.d/*.conf)
shopt -u nullglob
FILES="$( { [ ${#CANDS[@]} -gt 0 ] && grep -lE 'server_name[^;]*empresa\.com' "${CANDS[@]}" 2>/dev/null || true; } | xargs -r -n1 readlink -f | sort -u)"
[ -n "$FILES" ] || die "No encontré archivos de nginx con dominios empresa.com"
CHANGED=""
for f in $FILES; do
  grep -q "allow $SUBNET" "$f" && continue
  # Solo inserta antes de un "deny all;" que cierra una lista de allow (no toca bloques como /data/ de wiki)
  python3 - "$f" "$SUBNET" > /tmp/infra-ngx.tmp <<'PY'
import re, sys
path, net = sys.argv[1], sys.argv[2]
L = open(path).read().split('\n'); out = []; n = 0
for i, l in enumerate(L):
    m = re.match(r'^(\s*)deny\s+all;\s*(#.*)?$', l)
    prev = next((x for x in reversed(out) if x.strip()), '')
    if m and re.match(r'^\s*allow\s+\S+;', prev):
        out.append(f"{m.group(1)}allow {net};   # Monitoreo la empresa (red Docker interna, no es Internet)"); n += 1
    out.append(l)
print('\n'.join(out), end='')
PY
  if ! cmp -s "$f" /tmp/infra-ngx.tmp; then
    cp -a "$f" "$BAK/nginx/$(basename "$f")"
    cat /tmp/infra-ngx.tmp > "$f"
    CHANGED="$CHANGED $f"
  fi
done
restore_nginx() { for f in $CHANGED; do cat "$BAK/nginx/$(basename "$f")" > "$f"; done; }
if [ -n "$CHANGED" ]; then
  if nginx -t >/tmp/infra-ngx.log 2>&1; then
    systemctl reload nginx
    ok "nginx: red de monitoreo permitida en$(for f in $CHANGED; do printf ' %s' "$(basename "$f")"; done)"
  else
    restore_nginx; cat /tmp/infra-ngx.log; die "nginx -t falló; restauré los archivos"
  fi
else
  ok "nginx ya permitía la red de monitoreo"
fi

# ---------- 2) blackbox: módulo http_app ----------
BB_CFG="$(docker inspect "$BB" --format '{{range .Mounts}}{{.Source}}{{"\n"}}{{end}}' | grep -E '\.ya?ml$' | head -1 || true)"
if [ -z "$BB_CFG" ]; then
  d="$(docker inspect "$BB" --format '{{range .Mounts}}{{.Source}}{{"\n"}}{{end}}' | head -1)"; BB_CFG="$(ls "$d"/*.yml "$d"/*.yaml 2>/dev/null | head -1 || true)"
fi
[ -f "$BB_CFG" ] || die "No encontré blackbox.yml"
if ! grep -qE '^\s{2}http_app:' "$BB_CFG"; then
  cp -a "$BB_CFG" "$BAK/blackbox.yml"
  cat >> "$BB_CFG" <<'YML'
  http_app:
    prober: http
    timeout: 10s
    http:
      preferred_ip_protocol: ip4
      valid_status_codes: [200, 201, 202, 203, 204, 206, 401]
      follow_redirects: true
YML
  docker restart "$BB" >/dev/null; sleep 4
  docker ps --format '{{.Names}}' | grep -qx "$BB" || { cat "$BAK/blackbox.yml" > "$BB_CFG"; docker restart "$BB" >/dev/null; die "blackbox no arrancó; restauré"; }
  ok "Módulo http_app agregado a blackbox"
else
  ok "blackbox ya tiene http_app"
fi

# ---------- 2b) operaciones.empresa.com también por la red interna ----------
DIR="$(docker inspect "$BB" --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}')"
COMPOSE="$(docker inspect "$BB" --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}')"; COMPOSE="${COMPOSE%%,*}"
SVC="$(docker inspect "$BB" --format '{{index .Config.Labels "com.docker.compose.service"}}')"
if [ -f "$COMPOSE" ] && grep -q 'empresa.com:' "$COMPOSE" && ! grep -q 'operaciones.empresa.com:' "$COMPOSE"; then
  cp -a "$COMPOSE" "$BAK/docker-compose.yml"
  python3 - "$COMPOSE" > /tmp/infra-dc.tmp <<'PY'
import re, sys
L = open(sys.argv[1]).read().split('\n')
k = max(i for i, l in enumerate(L) if re.search(r'-\s*"[a-z0-9-]+\.empresa\.com:[0-9.]+"', l))
m = re.match(r'^(\s*-\s*")[a-z0-9-]+\.empresa\.com:([0-9.]+)"', L[k])
L.insert(k + 1, f'{m.group(1)}operaciones.empresa.com:{m.group(2)}"')
print('\n'.join(L), end='')
PY
  cat /tmp/infra-dc.tmp > "$COMPOSE"
  if (cd "$DIR" && docker compose -f "$COMPOSE" config -q && docker compose -f "$COMPOSE" up -d --no-deps "$SVC" >/dev/null 2>&1); then
    sleep 4; BB="$(docker ps --format '{{.Names}} {{.Image}}' | awk '/blackbox/{print $1; exit}')"
    ok "operaciones.empresa.com agregado a los extra_hosts de blackbox"
  else
    cat "$BAK/docker-compose.yml" > "$COMPOSE"; (cd "$DIR" && docker compose -f "$COMPOSE" up -d --no-deps "$SVC" >/dev/null 2>&1) || true
    warn "No pude agregar operaciones a blackbox; restauré el compose (ese sitio saldrá caído)"
  fi
fi

# ---------- 3) Prometheus ----------
grep -q "job_name: 'blackbox_http_proyectos'" "$PROM_YML" || die "No existe el job blackbox_http_proyectos (ejecuta antes aplicar-prometheus.sh)"
cp -a "$PROM_YML" "$BAK/prometheus.yml"
python3 - "$PROM_YML" > /tmp/infra-prom.tmp <<'PY'
import re, sys
L = open(sys.argv[1]).read().split('\n')
i = next(k for k, l in enumerate(L) if "job_name: 'blackbox_http_proyectos'" in l)
j = next((k for k in range(i + 1, len(L)) if re.match(r'^\s*- job_name:', L[k]) or re.match(r'^[A-Za-z_]', L[k])), len(L))
blk = L[i:j]
blk = [l.replace('module: [http_2xx]', 'module: [http_app]') for l in blk]
if not any('operaciones.empresa.com' in l for l in blk):
    t = next(k for k, l in enumerate(blk) if re.match(r'^\s*- https://', l))
    ind = blk[t][:len(blk[t]) - len(blk[t].lstrip())]
    blk.insert(t, f'{ind}- https://operaciones.empresa.com/')
print('\n'.join(L[:i] + blk + L[j:]), end='')
PY
cat /tmp/infra-prom.tmp > "$PROM_YML"
if docker run --rm -v "$PROM_DIR:/p:ro" --entrypoint promtool prom/prometheus:latest check config /p/prometheus.yml >/tmp/infra-promtool.log 2>&1; then
  curl -fsS -X POST http://127.0.0.1:9090/-/reload >/dev/null && ok "Prometheus: proyectos con http_app + operaciones, recargado"
else
  cat "$BAK/prometheus.yml" > "$PROM_YML"; cat /tmp/infra-promtool.log; die "promtool falló; restauré prometheus.yml"
fi

# ---------- prueba ----------
probe() { docker exec "$BB" wget -qO- -T 12 "http://127.0.0.1:9115/probe?module=http_app&target=$1&debug=true" 2>/dev/null | awk '/^probe_success /{s=$2} /^probe_http_status_code /{c=$2} END{print s" "c}'; }
echo; echo "Probando desde el monitoreo:"
bad=0
for d in consultas contabilidad crm ems extras ingresos ofrenda solicitud-asociado monitoreo vault wiki ocsinventory operaciones stg-api stg-listas stg-originacion stg-taquilla stg-cobranza; do
  read -r s c <<<"$(probe "https://$d.empresa.com/")"
  if [ "$s" = 1 ]; then printf '  \033[32m●\033[0m %-34s HTTP %s\n' "$d.empresa.com" "$c"
  else bad=$((bad+1)); printf '  \033[31m●\033[0m %-34s HTTP %s\n' "$d.empresa.com" "${c:-sin respuesta}"; fi
done
echo; ok "Listo ($bad con falla). Respaldos en $BAK"
