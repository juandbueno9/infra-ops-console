#!/usr/bin/env bash
# Elimina el Grafana del monitoreo anterior (contenedor "grafana"), que ya fue reemplazado por el panel nuevo.
#   sudo bash eliminar-grafana.sh              → SOLO muestra lo que se eliminaría (no cambia nada)
#   sudo bash eliminar-grafana.sh --confirmar  → respalda y elimina
# NO toca: el Grafana de FortiClient EMS (fcems_docker-grafana-1), Prometheus, Loki, Blackbox, Alertmanager,
# node-exporter, promtail ni el panel nuevo. Solo borra volúmenes/carpetas que ningún otro contenedor usa.
set -uo pipefail
C=grafana
[ "$(id -u)" = 0 ] || { echo "Ejecuta con sudo (sudo su - o sudo bash ...)"; exit 1; }
GO=0; [ "${1:-}" = "--confirmar" ] && GO=1

docker inspect "$C" >/dev/null 2>&1 || { echo "✔ No existe el contenedor '$C': no hay nada que eliminar"; exit 0; }
IMG=$(docker inspect -f '{{.Config.Image}}' "$C")
case "$IMG" in grafana/grafana*|*grafana*) ;; *) echo "✘ '$C' usa la imagen '$IMG', no parece Grafana. No hago nada."; exit 1;; esac

# Seguridad: el panel nuevo debe estar respondiendo y nginx ya no debe apuntar a Grafana
curl -fsS -m 5 http://127.0.0.1:4000/api/health >/dev/null || { echo "✘ El panel nuevo no responde en 127.0.0.1:4000. No elimino Grafana."; exit 1; }
NG=$(grep -rln "127.0.0.1:3001\|localhost:3001" /etc/nginx/ 2>/dev/null)
if [ -n "$NG" ]; then echo "✘ nginx todavía envía tráfico a Grafana (puerto 3001) en:"; echo "$NG"; echo "  Primero: sudo bash /opt/enterprise-tools/infra-panel/cambiar-monitoreo.sh"; exit 1; fi

PROJ=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$C" 2>/dev/null)
CDIR=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$C" 2>/dev/null)
CFILES=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.config_files"}}' "$C" 2>/dev/null)
OTROS=$(docker ps -a --format '{{.Names}}' | grep -vx "$C")

VOLS=(); DIRS=(); KEEP=()
while IFS='|' read -r T NAME SRC DST; do
  [ -z "$T" ] && continue
  if [ "$T" = volume ]; then
    USERS=$(docker ps -a --filter volume="$NAME" --format '{{.Names}}' | grep -vx "$C")
    [ -z "$USERS" ] && VOLS+=("$NAME") || KEEP+=("volumen $NAME (lo usa: $USERS)")
  elif [ "$T" = bind ]; then
    SHARED=""
    for o in $OTROS; do docker inspect -f '{{range .Mounts}}{{.Source}}{{"\n"}}{{end}}' "$o" | grep -qx "$SRC" && SHARED="$SHARED $o"; done
    if [ -n "$SHARED" ]; then KEEP+=("carpeta $SRC (la usa:$SHARED)")
    elif [[ "$SRC" == *grafana* && "$SRC" != /etc/nginx* && "$SRC" != / ]]; then DIRS+=("$SRC")
    else KEEP+=("carpeta $SRC (no tiene 'grafana' en el nombre: la dejo)"); fi
  fi
done < <(docker inspect -f '{{range .Mounts}}{{.Type}}|{{.Name}}|{{.Source}}|{{.Destination}}{{"\n"}}{{end}}' "$C")

echo "=== Grafana del monitoreo anterior ==="
echo "Contenedor : $C  (imagen $IMG, estado $(docker inspect -f '{{.State.Status}}' "$C"))"
[ -n "$PROJ" ] && echo "Compose    : proyecto '$PROJ' en $CDIR ($CFILES)"
echo "Se eliminará:"
echo "  - contenedor $C"
for v in "${VOLS[@]}"; do echo "  - volumen docker $v ($(du -sh "$(docker volume inspect -f '{{.Mountpoint}}' "$v")" 2>/dev/null | cut -f1))"; done
for d in "${DIRS[@]}"; do echo "  - carpeta $d ($(du -sh "$d" 2>/dev/null | cut -f1))"; done
echo "  - imagen $IMG (solo si ningún otro contenedor la usa)"
[ ${#KEEP[@]} -gt 0 ] && { echo "Se CONSERVA:"; printf '  - %s\n' "${KEEP[@]}"; }
echo "No se toca: $(echo "$OTROS" | tr '\n' ' ')"

if [ "$GO" = 0 ]; then echo; echo "Nada fue cambiado. Para eliminar:  sudo bash $0 --confirmar"; exit 0; fi

# Respaldo pequeño por si algún día se necesita un tablero viejo
BK=/root/respaldo-grafana-$(date +%Y%m%d-%H%M).tgz
docker inspect "$C" > /root/grafana-inspect.json
P=(/root/grafana-inspect.json)
for v in "${VOLS[@]}"; do P+=("$(docker volume inspect -f '{{.Mountpoint}}' "$v")"); done
P+=("${DIRS[@]}")
[ -n "$CFILES" ] && for f in ${CFILES//,/ }; do [ -f "$f" ] && P+=("$f"); done
tar -czf "$BK" "${P[@]}" 2>/dev/null && echo "✔ Respaldo: $BK ($(du -sh "$BK" | cut -f1))" || { echo "✘ No pude crear el respaldo. No elimino nada."; exit 1; }
rm -f /root/grafana-inspect.json

docker stop "$C" >/dev/null 2>&1; docker rm "$C" >/dev/null && echo "✔ Contenedor $C eliminado"
for v in "${VOLS[@]}"; do docker volume rm "$v" >/dev/null && echo "✔ Volumen $v eliminado"; done
for d in "${DIRS[@]}"; do rm -rf -- "$d" && echo "✔ Carpeta $d eliminada"; done
if [ -z "$(docker ps -a --filter ancestor="$IMG" -q)" ]; then docker rmi "$IMG" >/dev/null 2>&1 && echo "✔ Imagen $IMG eliminada"; fi

# Avisos de cosas que podrían volver a crear Grafana o mostrarlo como caído
if [ -n "$CFILES" ]; then
  for f in ${CFILES//,/ }; do [ -f "$f" ] && grep -q "grafana/grafana" "$f" && echo "⚠ $f todavía define Grafana: si alguien corre 'docker compose up' ahí, se vuelve a crear. Envíame ese archivo y lo limpio."; done
fi
grep -rln "grafana:3000\|:3001" /etc/prometheus /opt/*/prometheus* 2>/dev/null | sed 's/^/⚠ Prometheus aún menciona Grafana en: /'
[ -f /root/infra-ops-console.conf.antes-panel ] && echo "ℹ cambiar-monitoreo.sh --revertir ya no sirve (Grafana no existe). El respaldo de nginx sigue en /root/infra-ops-console.conf.antes-panel"
echo "✔ Listo. https://monitoreo.empresa.com sigue con el panel nuevo."
