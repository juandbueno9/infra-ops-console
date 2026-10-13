#!/usr/bin/env bash
# =====================================================================
#  Infra Ops · instala el stack de observabilidad SIN TOCAR LO EXISTENTE
#
#  Agrega (en un docker-compose.infra.yml aparte):
#    · Loki + Promtail   → logs centralizados (nginx, apache, auth, syslog, contenedores)
#    · Alertmanager      → solo si no existe uno (alertas sin enviar hasta elegir canal)
#    · Reglas de alerta  → servidores, sitios, SSL, seguridad, red, bases de datos
#    · Retención 90 días → Prometheus (uptime de 30 días real)
#  Opcionales:
#    --bd-mysql --bd-postgres --bd-mssql   exportadores (antes: crear-usuarios-bd.sh)
#    --aws                                 CloudWatch (requiere rol IAM en la instancia)
#    --ec2                                 descubrir servidores con etiqueta monitoreo=si (rol IAM)
#    --sin-retencion                       no cambiar la retención de Prometheus
#    --grafana                             agregar Loki como fuente de datos en Grafana
#
#  Uso:  sudo bash /tmp/infra-stack/instalar-stack.sh [opciones]
#
#  Garantías:
#    · docker-compose.yml original: no se edita.
#    · Solo se crean/recrean contenedores de monitoreo. Apps, nginx y BD no se tocan.
#    · Respaldo previo en /root/infra-backups/<fecha>-stack/
#    · Validación (docker compose config, promtool) y reversión automática.
# =====================================================================
set -euo pipefail
trap 'rc=$?; [ $rc -ne 0 ] && printf "\033[31m✘\033[0m El instalador se detuvo (línea %s, código %s). Revisa el mensaje de arriba.\n" "$LINENO" "$rc"' EXIT
ok()   { printf '\033[32m✔\033[0m %s\n' "$*"; }
warn() { printf '\033[33m!\033[0m %s\n' "$*"; }
info() { printf '  %s\n' "$*"; }
die()  { trap - EXIT; printf '\033[31m✘\033[0m %s\n' "$*"; exit 1; }
[ "$(id -u)" = 0 ] || die "Ejecuta con sudo"
command -v python3 >/dev/null || die "Falta python3"
SRC="$(cd "$(dirname "$0")" && pwd)"
GEN="$SRC/generar.py"
[ -f "$GEN" ] || die "Falta generar.py junto al instalador (copia la carpeta completa)"

FEATS=(); RETENTION=1; GRAFANA=0; SILENCE=False
for a in "$@"; do case "$a" in
  --bd-mysql) FEATS+=(mysql);; --bd-postgres) FEATS+=(postgres);; --bd-mssql) FEATS+=(mssql);;
  --aws) FEATS+=(aws);; --ec2) FEATS+=(ec2);; --sin-retencion) RETENTION=0;; --grafana) GRAFANA=1;;
  *) die "Opción desconocida: $a";; esac; done

# ---------- detectar el stack existente ----------
PC="$(docker ps --format '{{.Names}} {{.Image}}' | awk '$2 ~ /prom\/prometheus/ {print $1; exit}')"
[ -n "$PC" ] || die "No encontré el contenedor de Prometheus"
lbl() { docker inspect "$PC" --format "{{index .Config.Labels \"$1\"}}"; }
DIR="$(lbl com.docker.compose.project.working_dir)"; PROJECT="$(lbl com.docker.compose.project)"
MAIN="$(lbl com.docker.compose.project.config_files)"; MAIN="${MAIN%%,*}"; PROM_SVC="$(lbl com.docker.compose.service)"
[ -d "$DIR" ] && [ -f "$MAIN" ] || die "No encontré el docker-compose de Prometheus ($MAIN)"
MAIN_NAME="$MAIN"; [ "$(dirname "$MAIN")" = "$DIR" ] && MAIN_NAME="$(basename "$MAIN")"
NETNAME="$(docker inspect "$PC" --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' | awk '{print $1}')"
NET_KEY="${NETNAME#${PROJECT}_}"
GW="$(docker network inspect "$NETNAME" --format '{{range .IPAM.Config}}{{.Gateway}} {{end}}' | awk '{print $1}')"
HOST="$(hostname)"
INFRA="$DIR/infra"
ok "Stack: proyecto '$PROJECT' en $DIR · Prometheus '$PROM_SVC' · red '$NET_KEY' ($GW) · servidor $HOST"

# prometheus.yml: dónde está en el host y cómo lo ve el contenedor
PROM_SRC=""; PROM_DEST=""; DIRMOUNT_SRC=""; DIRMOUNT_DEST=""
while read -r s d; do
  [ -z "$s" ] && continue
  if [ -f "$s" ] && [[ "$s" == *prometheus.yml ]]; then PROM_SRC="$s"; PROM_DEST="$d"; fi
  if [ -d "$s" ] && [ -f "$s/prometheus.yml" ]; then DIRMOUNT_SRC="$s"; DIRMOUNT_DEST="$d"; PROM_SRC="$s/prometheus.yml"; PROM_DEST="$d/prometheus.yml"; fi
done < <(docker inspect "$PC" --format '{{range .Mounts}}{{.Source}} {{.Destination}}{{"\n"}}{{end}}')
[ -n "$PROM_SRC" ] || die "No pude ubicar prometheus.yml montado en el contenedor"
PROM_DIR="$(dirname "$PROM_SRC")"
RULES_HOST="$PROM_DIR/rules"
if [ -n "$DIRMOUNT_SRC" ]; then RULES_PATH="$DIRMOUNT_DEST/rules/infra-alertas.yml"; EXTRA_VOL=""
else RULES_PATH="/etc/prometheus/infra-rules/infra-alertas.yml"; EXTRA_VOL="$RULES_HOST:/etc/prometheus/infra-rules:ro"; fi
ok "prometheus.yml: $PROM_SRC → $PROM_DEST"

SERVICES="$(cd "$DIR" && docker compose -f "$MAIN" config --services 2>/dev/null || true)"
AM_SVC="$(docker ps --format '{{.Names}} {{.Image}}' | awk '$2 ~ /alertmanager/ && $1 != "infra-alertmanager" {print $1; exit}')"
if [ -n "$AM_SVC" ]; then ADD_AM=false; AM_TARGET="$AM_SVC:9093"; ok "Ya existe Alertmanager ($AM_SVC): se reutiliza"
  AMCFG="$(docker exec "$AM_SVC" sh -c 'cat /etc/alertmanager/*.yml 2>/dev/null' 2>/dev/null || true)"
  if [[ "$AMCFG" =~ (email_configs|webhook_configs|slack_configs|telegram_configs|msteams_configs|pagerduty_configs) ]]; then
    if [ "${INFRA_ACEPTO_AVISOS:-}" = "si" ]; then
      warn "Ese Alertmanager tiene canales (${BASH_REMATCH[1]}): las reglas nuevas SÍ enviarán avisos por ahí."
    else
      SILENCE=True
      ok "Ese Alertmanager ya avisa por ${BASH_REMATCH[1]}: tus alertas actuales siguen igual; las 29 reglas nuevas NO se enviarán (solo panel)"
    fi
  else
    info "Ese Alertmanager no tiene canales de envío: las alertas solo se verán en el panel."
  fi
else ADD_AM=true; AM_TARGET="infra-alertmanager:9093"; fi

# Opciones de ejecuciones anteriores se conservan
STATE="$INFRA/stack.conf"
[ -f "$STATE" ] && while read -r f; do [ -n "$f" ] && FEATS+=("$f"); done < "$STATE"
FEATS=($(printf '%s\n' "${FEATS[@]:-}" | sort -u | grep -v '^$' || true))
if printf '%s\n' "${FEATS[@]:-}" | grep -qE '^(mysql|postgres|mssql)$'; then
  [ -f "$INFRA/bd.env" ] || die "Faltan las credenciales de BD ($INFRA/bd.env). Ejecuta antes crear-usuarios-bd.sh"
fi

# Retención: se parte del comando del docker-compose.yml ORIGINAL (no del contenedor)
MAIN_JSON="$(cd "$DIR" && docker compose -f "$MAIN" config --format json 2>/dev/null)"
IMG="$(docker inspect "$PC" --format '{{.Config.Image}}')"
IMG_CMD="$(docker image inspect "$IMG" --format '{{json .Config.Cmd}}' 2>/dev/null || echo null)"
PROM_OVERRIDE="$(python3 - "$MAIN_JSON" "$IMG_CMD" "$RETENTION" "$EXTRA_VOL" "$PROM_SVC" <<'PY'
import json, shlex, sys
cfg = json.loads(sys.argv[1] or '{}'); img = json.loads(sys.argv[2] or 'null') or []
ret, vol, svc = sys.argv[3] == '1', sys.argv[4], sys.argv[5]
cmd = cfg.get('services', {}).get(svc, {}).get('command')
if isinstance(cmd, str): cmd = shlex.split(cmd)
args = list(cmd or img)
o = {}
if ret and not any(a.startswith('--storage.tsdb.retention') for a in args):
    if not any(a.startswith('--config.file') for a in args):
        args = ['--config.file=/etc/prometheus/prometheus.yml'] + args
    o['command'] = args + ['--storage.tsdb.retention.time=90d']
if vol:
    o['volumes'] = [vol]
print(json.dumps(o))
PY
)"
# ¿Hace falta recrear Prometheus? Solo si al contenedor actual le falta la retención o el montaje de reglas
CUR_ARGS="$(docker inspect "$PC" --format '{{json .Args}}')"
CUR_MOUNTS="$(docker inspect "$PC" --format '{{range .Mounts}}{{.Destination}} {{end}}')"
NEED_RECREATE=0
if [[ "$PROM_OVERRIDE" == *retention* && "$CUR_ARGS" != *retention* ]]; then NEED_RECREATE=1; fi
if [[ -n "$EXTRA_VOL" && "$CUR_MOUNTS" != */etc/prometheus/infra-rules* ]]; then NEED_RECREATE=1; fi

# ---------- respaldo ----------
STAMP="$(date +%F-%H%M%S)"; BAK="/root/infra-backups/$STAMP-stack"; mkdir -p "$BAK"
cp -a "$PROM_SRC" "$BAK/prometheus.yml"
[ -f "$DIR/.env" ] && cp -a "$DIR/.env" "$BAK/.env"
[ -f "$DIR/docker-compose.infra.yml" ] && cp -a "$DIR/docker-compose.infra.yml" "$BAK/docker-compose.infra.yml"
ok "Respaldo: $BAK"
mkdir -p "$DIR/infra"; [ -f "$DIR/infra/primer-respaldo" ] || echo "$BAK" > "$DIR/infra/primer-respaldo"   # estado original para desinstalar

restore() {
  warn "Restaurando configuración anterior…"
  cat "$BAK/prometheus.yml" > "$PROM_SRC"
  if [ -f "$BAK/.env" ]; then cat "$BAK/.env" > "$DIR/.env"; else rm -f "$DIR/.env"; fi
  if [ -f "$BAK/docker-compose.infra.yml" ]; then cat "$BAK/docker-compose.infra.yml" > "$DIR/docker-compose.infra.yml"; else rm -f "$DIR/docker-compose.infra.yml"; fi
}

# ---------- archivos de configuración ----------
mkdir -p "$INFRA" "$RULES_HOST"
cp "$SRC/loki.yml" "$INFRA/loki.yml"
sed "s/__SERVIDOR__/$HOST/g" "$SRC/promtail.yml" > "$INFRA/promtail.yml"
[ -f "$INFRA/alertmanager.yml" ] || cp "$SRC/alertmanager.yml" "$INFRA/alertmanager.yml"   # no pisa un canal ya configurado
cp "$SRC/yace.yml" "$INFRA/yace.yml"
cp "$SRC/rules/infra-alertas.yml" "$RULES_HOST/infra-alertas.yml"
chmod 644 "$INFRA"/*.yml "$RULES_HOST/infra-alertas.yml"
printf '%s\n' "${FEATS[@]:-}" | grep -v '^$' > "$STATE" || true

NEW_SVCS=(loki promtail); $ADD_AM && NEW_SVCS+=(infra-alertmanager)
for f in "${FEATS[@]:-}"; do case "$f" in
  mysql) NEW_SVCS+=(infra-mysqld-exporter);; postgres) NEW_SVCS+=(infra-postgres-exporter);;
  mssql) NEW_SVCS+=(infra-mssql-exporter);; aws) NEW_SVCS+=(infra-cloudwatch);; esac; done

python3 - "$INFRA/ctx.json" <<PY
import json, sys
json.dump({
  "net_key": "$NET_KEY", "gw": "$GW", "infra_dir": "$INFRA", "hostname": "$HOST", "prom_svc": "$PROM_SVC",
  "add_alertmanager": $( $ADD_AM && echo True || echo False ), "am_target": "$AM_TARGET", "rules_path": "$RULES_PATH",
  "features": "${FEATS[*]:-}".split(), "new_services": "${NEW_SVCS[*]}".split(),
  "prom_override": json.loads('''$PROM_OVERRIDE''') or None, "silence_notifications": $SILENCE,
}, open(sys.argv[1], "w"), indent=1)
PY

# Validar reglas antes de tocar nada
docker run --rm -v "$RULES_HOST:/r:ro" --entrypoint promtool prom/prometheus:latest check rules /r/infra-alertas.yml >/tmp/infra-rules.log 2>&1 \
  || { cat /tmp/infra-rules.log; die "Las reglas de alerta no son válidas (no se cambió nada)"; }
ok "Reglas de alerta válidas ($(grep -o '[0-9]* rules' /tmp/infra-rules.log))"

python3 "$GEN" compose "$INFRA/ctx.json" > /tmp/infra-compose.yml
cat /tmp/infra-compose.yml > "$DIR/docker-compose.infra.yml"
python3 "$GEN" envfile "$DIR/.env" "$MAIN_NAME" > /tmp/infra-env
cat /tmp/infra-env > "$DIR/.env"
if ! (cd "$DIR" && docker compose config -q) 2>/tmp/infra-compose.err; then
  cat /tmp/infra-compose.err; restore; die "docker compose rechazó la configuración; restauré todo"
fi
ok "docker-compose.infra.yml válido (el docker-compose.yml original no se modificó)"

python3 "$GEN" prom "$PROM_SRC" "$INFRA/ctx.json" > /tmp/infra-prom.yml
cat /tmp/infra-prom.yml > "$PROM_SRC"
# El validador ve exactamente los mismos archivos que el Prometheus real (todos sus montajes bind)
CHECK_VOLS=()
while read -r t s d; do
  [ "$t" = bind ] && [ -e "$s" ] && CHECK_VOLS+=(-v "$s:$d:ro")
done < <(docker inspect "$PC" --format '{{range .Mounts}}{{.Type}} {{.Source}} {{.Destination}}{{"\n"}}{{end}}')
[ -n "$EXTRA_VOL" ] && CHECK_VOLS+=(-v "$RULES_HOST:/etc/prometheus/infra-rules:ro")
if ! docker run --rm "${CHECK_VOLS[@]}" --entrypoint promtool prom/prometheus:latest check config "$PROM_DEST" >/tmp/infra-promtool.log 2>&1; then
  cat /tmp/infra-promtool.log; restore; die "promtool rechazó prometheus.yml; restauré todo"
fi
ok "prometheus.yml válido (reglas, alerting y jobs nuevos)"

# ---------- levantar solo lo nuevo ----------
cd "$DIR"
if ! docker compose up -d --no-deps "${NEW_SVCS[@]}" >/tmp/infra-up.log 2>&1; then
  cat /tmp/infra-up.log; docker compose rm -sf "${NEW_SVCS[@]}" >/dev/null 2>&1 || true; restore
  die "No se pudieron crear los servicios nuevos; los quité y restauré la configuración"
fi
ok "Servicios nuevos en marcha: ${NEW_SVCS[*]}"

if [ "$NEED_RECREATE" = 1 ]; then
  info "Recreando Prometheus para aplicar retención/montaje (~10 s sin métricas; los datos se conservan)…"
  if ! docker compose up -d --no-deps "$PROM_SVC" >/tmp/infra-up.log 2>&1 || ! sleep 8 || ! curl -fsS http://127.0.0.1:9090/-/ready >/dev/null 2>&1; then
    cat /tmp/infra-up.log 2>/dev/null || true
    restore
    docker compose -f "$MAIN" up -d --no-deps "$PROM_SVC" >/dev/null 2>&1 || true
    die "Prometheus no arrancó con la configuración nueva; volví a la anterior"
  fi
  ok "Prometheus recreado con retención de 90 días"
else
  curl -fsS -X POST http://127.0.0.1:9090/-/reload >/dev/null && ok "Prometheus recargado"
fi

# ---------- verificación ----------
echo; echo "Verificando:"
sleep 5
chk() { if eval "$2" >/dev/null 2>&1; then printf '  \033[32m●\033[0m %s\n' "$1"; else printf '  \033[31m●\033[0m %s\n' "$1"; fi; }
chk "Loki listo (127.0.0.1:3100)" "curl -fsS http://127.0.0.1:3100/ready"
for i in 1 2 3 4 5 6; do curl -fsS http://127.0.0.1:3100/loki/api/v1/label/job/values 2>/dev/null | grep -q '"job"\|\[\"' && break; sleep 5; done
chk "Promtail enviando logs a Loki" "[ \"\$(docker inspect -f '{{.State.Running}} {{.RestartCount}}' infra-promtail)\" = 'true 0' ] && curl -fsS http://127.0.0.1:3100/loki/api/v1/label/job/values | grep -qE '\"(nginx|syslog|auth|docker)\"'"
$ADD_AM && chk "Alertmanager listo (127.0.0.1:9093)" "curl -fsS http://127.0.0.1:9093/-/ready"
chk "Reglas cargadas en Prometheus" "curl -fsS http://127.0.0.1:9090/api/v1/rules | grep -q infra-servidores"
chk "Prometheus conectado a Alertmanager" "curl -fsS http://127.0.0.1:9090/api/v1/alertmanagers | grep -q 9093"
for f in "${FEATS[@]:-}"; do case "$f" in
  mysql) chk "Exportador MySQL ($GW:9104)" "docker exec $PC wget -qO- -T 5 http://$GW:9104/metrics | grep -q '^mysql_up 1'";;
  postgres) chk "Exportador PostgreSQL ($GW:9187)" "docker exec $PC wget -qO- -T 5 http://$GW:9187/metrics | grep -q '^pg_up 1'";;
esac; done
if printf '%s\n' "${FEATS[@]:-}" | grep -qE '^(mysql|postgres)$' && ! docker exec "$PC" wget -qO- -T 5 "http://$GW:9104/metrics" >/dev/null 2>&1 && ! docker exec "$PC" wget -qO- -T 5 "http://$GW:9187/metrics" >/dev/null 2>&1; then
  warn "Prometheus no alcanza los exportadores en $GW. Si ufw está activo:  sudo ufw allow from ${GW%.*}.0/16 to $GW port 9104,9187 proto tcp"
fi

# ---------- Grafana (opcional) ----------
if [ "$GRAFANA" = 1 ]; then
  read -rp "  Usuario admin de Grafana: " GU; read -rsp "  Contraseña: " GP; echo
  r="$(curl -s -u "$GU:$GP" -H 'Content-Type: application/json' -X POST http://127.0.0.1:3001/api/datasources \
      -d '{"name":"Loki (la empresa)","type":"loki","url":"http://loki:3100","access":"proxy"}' || true)"
  [[ "$r" == *'"id"'* || "$r" == *"already exists"* ]] && ok "Loki agregado como fuente de datos en Grafana" || warn "Grafana respondió: $r"
fi

# ---------- respaldo diario de configuración ----------
cat > /etc/cron.daily/infra-respaldo <<EOF
#!/bin/sh
# Infra Ops · respaldo diario de la configuración del monitoreo (14 días)
D=/root/infra-backups/diario; mkdir -p "\$D"
tar czf "\$D/monitoreo-\$(date +%F).tgz" -C / "${DIR#/}/infra" "${PROM_DIR#/}" "${DIR#/}/docker-compose.infra.yml" "${MAIN#/}" "${DIR#/}/blackbox" 2>/dev/null
[ -d /opt/infra-ops-console/server/data ] && tar czf "\$D/panel-auditoria-\$(date +%F).tgz" -C / opt/infra-ops-console/server/data 2>/dev/null
find "\$D" -name '*.tgz' -mtime +14 -delete
EOF
chmod 755 /etc/cron.daily/infra-respaldo
ok "Respaldo diario de configuración y auditoría: /root/infra-backups/diario (14 días)"

echo
ok "Listo. Para deshacer todo:  sudo bash $SRC/desinstalar-stack.sh"
trap - EXIT
