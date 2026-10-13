#!/bin/bash
# =====================================================================
#  Infra Ops - Agente de monitoreo  v2
#  node_exporter + métricas infra_* (servicios, puertos con app,
#  contenedores, SSH, actualizaciones, red, info de instancia)
#
#  Servidor nuevo:                 sudo bash infra-agent-install.sh
#  Ya tiene node_exporter (Docker): sudo bash infra-agent-install.sh --scripts-only
#  Desinstalar:                    sudo bash infra-agent-install.sh --uninstall
#  Escaneo semanal de imágenes:     sudo bash infra-agent-install.sh --trivy   (solo agrega esto)
# =====================================================================
set -euo pipefail

TEXTDIR=/var/lib/node_exporter/textfile
MODE="${1:-full}"

[ "$(id -u)" -eq 0 ] || { echo "Ejecuta con sudo"; exit 1; }

if [ "$MODE" = "--uninstall" ]; then
  apt-get remove -y prometheus-node-exporter || true
  rm -f /etc/cron.d/infra-metrics /usr/local/bin/infra-metrics.sh /usr/local/bin/infra-metrics-info.sh
  rm -f /etc/cron.d/infra-trivy /usr/local/bin/infra-trivy.sh /usr/local/bin/infra-trivy-parse.py "$TEXTDIR/infra_trivy.prom"
  echo "Agente desinstalado."; exit 0
fi

# ---------------------------------------------------------------------
# Escaneo de vulnerabilidades de imágenes Docker (Trivy, semanal)
# Usa el contenedor oficial aquasec/trivy: no instala paquetes en el servidor.
# Baja prioridad de CPU y disco; no toca los contenedores (solo lee las imágenes).
# ---------------------------------------------------------------------
if [ "$MODE" = "--trivy" ]; then
  command -v docker >/dev/null || { echo "Este servidor no tiene Docker: no hay imágenes que escanear."; exit 0; }
  mkdir -p "$TEXTDIR"
  cat > /usr/local/bin/infra-trivy.sh <<'TRIVYEOF'
#!/bin/bash
# Infra Ops · vulnerabilidades de las imágenes Docker en uso (Trivy)
DIR=/var/lib/node_exporter/textfile
TMP=$(mktemp "$DIR/.infra_trivy.XXXX")
TRIVY=aquasec/trivy:0.55.2
{
echo "# HELP infra_image_vulnerabilities Vulnerabilidades por imagen y severidad (Trivy)"
echo "# TYPE infra_image_vulnerabilities gauge"
for img in $(docker ps --format '{{.Image}}' | sort -u); do
  out=$(nice -n 19 ionice -c3 docker run --rm -v /var/run/docker.sock:/var/run/docker.sock:ro -v infra-trivy-cache:/root/.cache \
        "$TRIVY" image --quiet --scanners vuln --severity CRITICAL,HIGH,MEDIUM --format json --timeout 20m "$img" 2>/dev/null) || continue
  printf '%s' "$out" | IMG="$img" python3 /usr/local/bin/infra-trivy-parse.py 2>/dev/null
done
echo "# HELP infra_image_scan_timestamp_seconds Último escaneo de imágenes"
echo "# TYPE infra_image_scan_timestamp_seconds gauge"
echo "infra_image_scan_timestamp_seconds $(date +%s)"
} > "$TMP"
chmod 644 "$TMP" && mv "$TMP" "$DIR/infra_trivy.prom"
TRIVYEOF
  cat > /usr/local/bin/infra-trivy-parse.py <<'TRIVYEOF'
import json, os, re, sys
d = json.load(sys.stdin)
c = {"CRITICAL": 0, "HIGH": 0, "MEDIUM": 0}
for r in d.get("Results") or []:
    for v in r.get("Vulnerabilities") or []:
        if v.get("Severity") in c:
            c[v["Severity"]] += 1
img = re.sub(r"[^A-Za-z0-9_./:@-]", "_", os.environ.get("IMG", "desconocida"))
for k, n in c.items():
    print('infra_image_vulnerabilities{image="%s",severity="%s"} %d' % (img, k, n))
TRIVYEOF
  chmod +x /usr/local/bin/infra-trivy.sh
  echo '17 3 * * 0 root /usr/local/bin/infra-trivy.sh' > /etc/cron.d/infra-trivy
  nohup /usr/local/bin/infra-trivy.sh >/dev/null 2>&1 &
  echo "Escaneo semanal instalado (domingos 3:17 a. m.). El primer escaneo corre ahora en segundo plano (10-30 min)."
  echo "Resultado: $TEXTDIR/infra_trivy.prom  → página Seguridad del panel."
  exit 0
fi

mkdir -p "$TEXTDIR"

# ---------------------------------------------------------------------
# 1. Script principal (cada minuto)
# ---------------------------------------------------------------------
cat > /usr/local/bin/infra-metrics.sh <<'EOF'
#!/bin/bash
# Infra Ops - métricas textfile para node_exporter  (v2)
DIR=/var/lib/node_exporter/textfile
TMP=$(mktemp)
clean(){ tr -d '"\\\n' <<<"$1"; }

# --- Servicios systemd (usa /etc/infra-services si existe) ---
CANDIDATES="nginx apache2 docker mysql mariadb postgresql php8.3-fpm php8.2-fpm php8.1-fpm pm2-ubuntu tomcat9 tomcat10 redis-server mongod"
[ -f /etc/infra-services ] && CANDIDATES=$(grep -v '^#' /etc/infra-services)
for s in $CANDIDATES; do
  systemctl list-unit-files "$s.service" --no-legend 2>/dev/null | grep -q . || continue
  systemctl is-active --quiet "$s.service" && v=1 || v=0
  echo "infra_service_up{service=\"$s\"} $v" >> "$TMP"
done

# --- SSH fallidos 24h ---
fails=$(journalctl -t sshd -t sshd-session --since "24 hours ago" --no-pager 2>/dev/null | grep -cE "Failed password|Invalid user")
echo "infra_ssh_failed_logins_24h $fails" >> "$TMP"

# --- Identidad por llave SSH ---
# Huella -> nombre. Se toma del comentario de cada llave en authorized_keys (ej. "juan@macbook").
# Para nombres más claros crea /etc/infra-ssh-keys con líneas:  SHA256:xxxxx  Ana Admin
declare -A KEYNAME
for f in /root/.ssh/authorized_keys /home/*/.ssh/authorized_keys; do
  [ -f "$f" ] || continue
  while read -r fp comment; do [ -n "$fp" ] && KEYNAME[$fp]="${comment:-llave sin comentario}"; done < <(
    ssh-keygen -lf "$f" 2>/dev/null | awk '{c=""; for(i=3;i<NF;i++) c=c (c?" ":"") $i; print $2, c}')
done
if [ -f /etc/infra-ssh-keys ]; then
  while read -r fp name; do [[ "$fp" == SHA256:* ]] && KEYNAME[$fp]="$name"; done < /etc/infra-ssh-keys
fi
keyname(){ [ -n "$1" ] && echo "${KEYNAME[$1]:-llave desconocida}" || echo ""; }

# --- Sesiones activas (quién está conectado ahora) ---
who | awk '{ from=$5; gsub(/[()]/,"",from); if(from=="") from="local"; print $1"|"$2"|"$3" "$4"|"from }' |
while IFS='|' read -r u tty since from; do
  ts=$(date -d "$since" +%s 2>/dev/null || echo 0)
  # La sesión "sshd: usuario@pts/N" es hija del proceso que registró el login (con la huella de la llave)
  fp=""; spid=$(pgrep -f "^sshd(-session)?: ${u}@${tty}\$" | head -1)
  if [ -n "$spid" ]; then
    ppid=$(ps -o ppid= -p "$spid" | tr -d ' ')
    fp=$(journalctl _PID="$ppid" --no-pager -o cat 2>/dev/null | grep -m1 -oE 'SHA256:[A-Za-z0-9+/=]+')
  fi
  echo "infra_user_session{user=\"$(clean "$u")\",tty=\"$(clean "$tty")\",from=\"$(clean "$from")\",key=\"$(clean "$(keyname "$fp")")\"} $ts"
done >> "$TMP"

# --- Accesos SSH exitosos 24h (usuario, IP, método, persona/llave) ---
journalctl -t sshd -t sshd-session --since "24 hours ago" -o short-unix --no-pager 2>/dev/null | grep " Accepted " |
awk '{ fp=""; for(i=1;i<=NF;i++){ if($i ~ /^SHA256:/) fp=$i; if($i=="Accepted"){ m=$(i+1); u=$(i+3); f=$(i+5) } }
       k=u"|"f"|"m"|"fp; c[k]++; if($1+0>t[k]) t[k]=$1+0 }
     END{ for(k in c) printf "%d|%d|%s\n", c[k], t[k], k }' |
while IFS='|' read -r cnt last u f m fp; do
  kn=$(clean "$(keyname "$fp")")
  echo "infra_ssh_logins_24h{user=\"$u\",from=\"$f\",method=\"$m\",key=\"$kn\"} $cnt"
  echo "infra_ssh_login_last_seconds{user=\"$u\",from=\"$f\",method=\"$m\",key=\"$kn\"} ${last%.*}"
done >> "$TMP"

# --- Actualizaciones ---
if [ -x /usr/lib/update-notifier/apt-check ]; then
  IFS=';' read upd sec < <(/usr/lib/update-notifier/apt-check 2>&1 | tail -1)
else
  upd=$(apt list --upgradable 2>/dev/null | grep -c upgradable)
  sec=$(apt list --upgradable 2>/dev/null | grep -c -- -security)
fi
echo "infra_apt_upgrades_pending ${upd:-0}" >> "$TMP"
echo "infra_apt_security_pending ${sec:-0}" >> "$TMP"
[ -f /var/run/reboot-required ] && rr=1 || rr=0
echo "infra_reboot_required $rr" >> "$TMP"
# Lista de paquetes pendientes (máx. 80) para ver en el panel CUÁLES son y cuáles son de seguridad
apt list --upgradable 2>/dev/null | tail -n +2 | head -80 | awk '{
  split($1, a, "/"); s = (a[2] ~ /-security/) ? 1 : 0; gsub(/["\\]/, "", a[1]); gsub(/["\\]/, "", $2)
  printf "infra_apt_package_pending{name=\"%s\",version=\"%s\",security=\"%d\"} 1\n", a[1], $2, s }' >> "$TMP"
# Paquetes que piden el reinicio (kernel, libc…)
if [ -f /var/run/reboot-required.pkgs ]; then
  sort -u /var/run/reboot-required.pkgs | head -20 | tr -d '"\\' | while read -r p; do echo "infra_reboot_required_pkg{name=\"$p\"} 1"; done >> "$TMP"
fi

# --- Red del host ---
sed 1,2d /proc/net/dev | tr ':' ' ' | awk '$1 !~ /^(lo|veth|docker|br-)/ {
  print "infra_net_receive_bytes_total{device=\""$1"\"} "$2
  print "infra_net_transmit_bytes_total{device=\""$1"\"} "$10 }' >> "$TMP"

# --- Contenedores Docker ---
declare -A DPORT
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  while IFS='|' read -r name ports; do
    for hp in $(grep -oE ':[0-9]+->' <<<"$ports" | tr -d ':>-'); do DPORT[$hp]=$name; done
  done < <(docker ps --format '{{.Names}}|{{.Ports}}')
  ids=$(docker ps -aq)
  if [ -n "$ids" ]; then
    docker inspect --format '{{.Name}}|{{.Config.Image}}|{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}|{{.State.StartedAt}}|{{.RestartCount}}' $ids 2>/dev/null |
    while IFS='|' read -r n img st hl started rc; do
      n=$(clean "${n#/}"); img=$(clean "$img")
      [ "$st" = running ] && r=1 || r=0
      [ "$hl" = unhealthy ] && u=1 || u=0
      echo "infra_container_info{name=\"$n\",image=\"$img\",state=\"$st\",health=\"$hl\"} 1"
      echo "infra_container_running{name=\"$n\"} $r"
      echo "infra_container_unhealthy{name=\"$n\"} $u"
      echo "infra_container_restarts_total{name=\"$n\"} ${rc:-0}"
      ts=$(date -d "$started" +%s 2>/dev/null || echo 0)
      [ "$ts" -gt 0 ] 2>/dev/null && echo "infra_container_started_seconds{name=\"$n\"} $ts"
    done >> "$TMP"
  fi
fi

# --- Puertos en escucha + app que los usa ---
ss -Htlnp | awk '{print $4" "$6}' | while read -r addr proc; do
  port="${addr##*:}"; host="${addr%:*}"
  case "$host" in 0.0.0.0|"[::]"|"*") scope=public;; 127.*|"[::1]") scope=local;; *) scope=private;; esac
  pname=$(sed -nE 's/^users:\(\("([^"]+)".*/\1/p' <<<"$proc")
  pid=$(sed -nE 's/.*pid=([0-9]+).*/\1/p' <<<"$proc")
  if [ "$pname" = "docker-proxy" ]; then
    app="${DPORT[$port]:-docker}"
  else
    unit=$(ps -o unit= -p "${pid:-0}" 2>/dev/null | tr -d ' ')
    case "$unit" in *.service) app="${unit%.service}";; *) app="${pname:-desconocido}";; esac
  fi
  echo "infra_listening_port{port=\"$port\",scope=\"$scope\",app=\"$(clean "$app")\"} 1"
done | sort -u >> "$TMP"

chmod 644 "$TMP" && mv "$TMP" "$DIR/infra.prom"
EOF

# ---------------------------------------------------------------------
# 2. Info de instancia, usuarios y SSH (cada 5 min)
# ---------------------------------------------------------------------
cat > /usr/local/bin/infra-metrics-info.sh <<'EOF'
#!/bin/bash
DIR=/var/lib/node_exporter/textfile
TMP=$(mktemp)
TOKEN=$(curl -s -m 2 -X PUT http://169.254.169.254/latest/api/token -H "X-aws-ec2-metadata-token-ttl-seconds: 60")
md(){ curl -sf -m 2 -H "X-aws-ec2-metadata-token: $TOKEN" "http://169.254.169.254/latest/meta-data/$1"; }
echo "infra_instance_info{hostname=\"$(hostname)\",instance_id=\"$(md instance-id)\",az=\"$(md placement/availability-zone)\",private_ip=\"$(md local-ipv4)\",public_ip=\"$(md public-ipv4)\"} 1" >> "$TMP"
echo "infra_users_logged_in $(who | wc -l)" >> "$TMP"
mkdir -p /run/sshd; S=$(sshd -T 2>/dev/null)
g(){ awk -v k="$1" '$1==k{print $2; exit}' <<<"$S"; }
echo "infra_ssh_config{port=\"$(g port)\",password_auth=\"$(g passwordauthentication)\",root_login=\"$(g permitrootlogin)\",pubkey=\"$(g pubkeyauthentication)\"} 1" >> "$TMP"

# Historial de accesos SSH (7 días): cada login con inicio/fin de sesión y los últimos intentos fallidos.
# Se exporta como eventos (valor = timestamp) para la auditoría del panel. Máximo 300 logins y 100 fallidos.
declare -A KEYNAME
for f in /root/.ssh/authorized_keys /home/*/.ssh/authorized_keys; do
  [ -f "$f" ] || continue
  while read -r fp comment; do [ -n "$fp" ] && KEYNAME[$fp]="${comment:-llave sin comentario}"; done < <(
    ssh-keygen -lf "$f" 2>/dev/null | awk '{c=""; for(i=3;i<NF;i++) c=c (c?" ":"") $i; print $2, c}')
done
[ -f /etc/infra-ssh-keys ] && while read -r fp name; do [[ "$fp" == SHA256:* ]] && KEYNAME[$fp]="$name"; done < /etc/infra-ssh-keys
cl(){ tr -d '"\\\n' <<<"$1" | cut -c1-40; }
EV=$(mktemp)
journalctl -t sshd -t sshd-session --since "7 days ago" -o short-unix --no-pager 2>/dev/null | awk '
  { ts=int($1); pid=$3; sub(/.*\[/,"",pid); sub(/\].*/,"",pid) }
  / Accepted / { for(i=1;i<=NF;i++){ if($i=="Accepted"){m=$(i+1);u=$(i+3);f=$(i+5)} if($i ~ /^SHA256:/) fp=$i }
                 acc[pid]=ts"|"u"|"f"|"m"|"fp; fp="" ; next }
  /session closed for user/ { if(pid in acc) end[pid]=ts; next }
  / Invalid user / { for(i=1;i<=NF;i++) if($i=="user"){u=$(i+1); f=$(i+3)} print "F|"ts"|"u"|"f; next }
  / Failed (password|publickey) for / { if($0 ~ /invalid user/) next; for(i=1;i<=NF;i++) if($i=="for"){u=$(i+1); f=$(i+3)} print "F|"ts"|"u"|"f; next }
  END { for(p in acc) print "A|"p"|"acc[p]"|"(p in end ? end[p] : "") }' > "$EV"
grep '^A|' "$EV" | sort -t'|' -k3,3nr | head -300 | while IFS='|' read -r _ pid ts u f m fp endts; do
  kn="${KEYNAME[$fp]:-}"; [ -n "$fp" ] && [ -z "$kn" ] && kn="llave desconocida"
  echo "infra_ssh_event{kind=\"login\",id=\"$ts-$pid\",user=\"$(cl "$u")\",from=\"$(cl "$f")\",method=\"$(cl "$m")\",key=\"$(cl "$kn")\",end=\"$endts\"} $ts"
done >> "$TMP"
grep '^F|' "$EV" | sort -t'|' -k2,2nr | head -100 | awk -F'|' '{n[$2]++; print $0"|"n[$2]}' | while IFS='|' read -r _ ts u f n; do
  echo "infra_ssh_event{kind=\"failed\",id=\"$ts-$n\",user=\"$(cl "$u")\",from=\"$(cl "$f")\",method=\"\",key=\"\",end=\"\"} $ts"
done >> "$TMP"
rm -f "$EV"

# Certificados TLS configurados en nginx (dominio, archivo, emisor, vencimiento, tipo de renovación)
clean(){ tr -d '"\\\n' <<<"$1"; }
if command -v nginx >/dev/null 2>&1; then
  nginx -T 2>/dev/null | awk '$1=="server_name"{sn=$2; gsub(/;/,"",sn)} $1=="ssl_certificate"{c=$2; gsub(/;/,"",c); print sn"|"c}' | sort -u |
  while IFS='|' read -r dom file; do
    [ -f "$file" ] || continue
    end=$(openssl x509 -enddate -noout -in "$file" 2>/dev/null | cut -d= -f2); [ -n "$end" ] || continue
    ts=$(date -d "$end" +%s 2>/dev/null) || continue
    iss=$(openssl x509 -issuer -noout -in "$file" 2>/dev/null | sed -n 's/.* O *= *\([^,]*\).*/\1/p' | head -1)
    [ -n "$iss" ] || iss=$(openssl x509 -issuer -noout -in "$file" 2>/dev/null | sed -n 's/.*CN *= *\([^,]*\).*/\1/p' | head -1)
    # Tipo de renovación real: se lee de /etc/letsencrypt/renewal/<nombre>.conf
    #   certbot-auto   = authenticator webroot/nginx/standalone/dns-* y certbot.timer activo
    #   certbot-manual = authenticator manual (o timer inactivo): hay que renovarlo a mano
    #   manual         = certificado comprado/externo (DigiCert, etc.)
    case "$file" in
      /etc/letsencrypt/live/*)
        name=$(basename "$(dirname "$file")"); conf="/etc/letsencrypt/renewal/${name}.conf"
        auth=$(awk -F' *= *' '$1=="authenticator"{print $2; exit}' "$conf" 2>/dev/null)
        if [ "$auth" = "manual" ] || ! systemctl is-active --quiet certbot.timer 2>/dev/null; then ren="certbot-manual"; else ren="certbot-auto"; fi ;;
      *) ren="manual"; auth="" ;;
    esac
    echo "infra_tls_cert_expiry_seconds{domain=\"$(clean "$dom")\",file=\"$(clean "$file")\",issuer=\"$(clean "$iss")\",renewal=\"$ren\",method=\"$(clean "${auth:-}")\"} $ts"
  done >> "$TMP"
fi
chmod 644 "$TMP" && mv "$TMP" "$DIR/infra_info.prom"
EOF

chmod +x /usr/local/bin/infra-metrics.sh /usr/local/bin/infra-metrics-info.sh
printf '* * * * * root /usr/local/bin/infra-metrics.sh\n*/5 * * * * root /usr/local/bin/infra-metrics-info.sh\n' > /etc/cron.d/infra-metrics
/usr/local/bin/infra-metrics.sh
/usr/local/bin/infra-metrics-info.sh
echo "Scripts instalados. Métricas en $TEXTDIR"

if [ "$MODE" = "--scripts-only" ]; then
  echo "---- Muestra ----"
  grep -E '^infra_(listening_port|container_running)' "$TEXTDIR/infra.prom" | head -15
  exit 0
fi

# ---------------------------------------------------------------------
# 3. node_exporter nativo (solo servidores nuevos)
# ---------------------------------------------------------------------
if ss -Htln | grep -q ':9100 ' && ! systemctl is-active --quiet prometheus-node-exporter; then
  echo "ABORTADO: el puerto 9100 ya está en uso. Si ya tienes node_exporter, usa --scripts-only"; exit 1
fi
TOKEN=$(curl -s -m 2 -X PUT http://169.254.169.254/latest/api/token -H "X-aws-ec2-metadata-token-ttl-seconds: 60" || true)
PRIV_IP=$(curl -s -m 2 -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/local-ipv4 || true)
[ -n "$PRIV_IP" ] || PRIV_IP=$(hostname -I | awk '{print $1}')
echo "IP privada: $PRIV_IP"

apt-get update -qq
apt-get install -y --no-install-recommends prometheus-node-exporter
[ -f /etc/default/prometheus-node-exporter ] && cp -n /etc/default/prometheus-node-exporter /etc/default/prometheus-node-exporter.bak
echo "ARGS=\"--web.listen-address=${PRIV_IP}:9100 --collector.textfile.directory=${TEXTDIR}\"" > /etc/default/prometheus-node-exporter
systemctl enable --now prometheus-node-exporter >/dev/null 2>&1 || true
systemctl restart prometheus-node-exporter
sleep 2
echo "---- Verificación ----"
curl -s "http://${PRIV_IP}:9100/metrics" | grep -E '^infra_service_up|^node_uname_info' || { echo "ERROR: node_exporter no responde"; exit 1; }
echo "OK: agente en ${PRIV_IP}:9100 — etiqueta la instancia en AWS con  monitoreo = si"
