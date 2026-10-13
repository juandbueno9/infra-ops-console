#!/usr/bin/env bash
# Detecta ping y escaneos de puertos contra ESTE servidor y lo publica al panel (Centro de seguridad).
# Cómo: agrega reglas de firewall que SOLO REGISTRAN (target LOG). No bloquean, no cambian nada del tráfico.
#   - ping (ICMP echo) recibido
#   - intentos de conexión TCP a puertos distintos de 80/443 (la web normal no se registra)
# Cada minuto cuenta, por IP de origen y en los últimos 10 min: pings, puertos distintos e intentos → métricas node_exporter.
# Ojo: en AWS el Security Group filtra antes; aquí solo se ve lo que el Security Group deja pasar.
#   Instalar: sudo bash escaneos-red.sh
#   Quitar:   sudo bash escaneos-red.sh --quitar     (borra solo lo que este script agregó)
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Ejecuta con sudo (sudo su -)"; exit 1; }
DIR=/var/lib/node_exporter/textfile
BIN=/usr/local/bin/infra-escaneos-red.sh
CH=INFRA-SCAN

if [ "${1:-}" = "--quitar" ]; then
  while iptables -C INPUT -j $CH 2>/dev/null; do iptables -D INPUT -j $CH; done
  iptables -F $CH 2>/dev/null || true; iptables -X $CH 2>/dev/null || true
  systemctl disable --now infra-escaneos-red.service 2>/dev/null || true
  rm -f /etc/systemd/system/infra-escaneos-red.service /etc/cron.d/infra-escaneos-red "$BIN" "$DIR/infra_netscan.prom"
  systemctl daemon-reload; echo "✔ Quitado (reglas de registro, cron y métricas)."; exit 0
fi
command -v iptables >/dev/null || { echo "✘ No está iptables"; exit 1; }
mkdir -p "$DIR"

cat > "$BIN" <<'SCRIPT'
#!/usr/bin/env bash
# --reglas: (re)crea la cadena de registro.  Sin argumentos: publica las métricas.
CH=INFRA-SCAN; DIR=/var/lib/node_exporter/textfile
if [ "${1:-}" = "--reglas" ]; then
  iptables -N $CH 2>/dev/null || iptables -F $CH
  for i in lo docker0 'br-+' 'veth+'; do iptables -A $CH -i "$i" -j RETURN; done
  iptables -A $CH -p icmp --icmp-type echo-request -m hashlimit --hashlimit-upto 20/min --hashlimit-burst 40 --hashlimit-mode srcip --hashlimit-name infraping -j LOG --log-prefix "INFRA-PING " --log-level 6
  iptables -A $CH -p tcp --syn -m multiport ! --dports 80,443 -m hashlimit --hashlimit-upto 120/min --hashlimit-burst 120 --hashlimit-mode srcip --hashlimit-name infrasyn -j LOG --log-prefix "INFRA-SYN " --log-level 6
  iptables -A $CH -j RETURN
  iptables -C INPUT -j $CH 2>/dev/null || iptables -I INPUT 1 -j $CH
  exit 0
fi
TMP=$(mktemp "$DIR/.infra_ns.XXXXXX")
if ! iptables -C INPUT -j $CH 2>/dev/null; then echo "infra_netscan_up 0" > "$TMP"; else
  echo "infra_netscan_up 1" > "$TMP"
  { journalctl -k --since "-10 min" -o short-unix --no-pager 2>/dev/null || true; } | grep -E 'INFRA-(PING|SYN) ' | awk '
    { t=int($1); src=""; dpt=""; for (i=1;i<=NF;i++){ if ($i ~ /^SRC=/) src=substr($i,5); if ($i ~ /^DPT=/) dpt=substr($i,5) }
      if (src=="") next; if (!(src in first) || t<first[src]) first[src]=t
      if ($0 ~ /INFRA-PING/) ping[src]++; else { syn[src]++; if (!((src,dpt) in seen)) { seen[src,dpt]=1; ports[src]++ } } all[src]=1 }
    END { n=0; for (s in all) { p=ping[s]+0; q=ports[s]+0; if (p<3 && q<3) continue; if (++n>150) break
      printf "infra_netscan_pings{ip=\"%s\"} %d\ninfra_netscan_ports{ip=\"%s\"} %d\ninfra_netscan_syn{ip=\"%s\"} %d\ninfra_netscan_first{ip=\"%s\"} %d\n", s,p,s,q,s,syn[s]+0,s,first[s] } }' >> "$TMP"
fi
chmod 644 "$TMP" && mv "$TMP" "$DIR/infra_netscan.prom"
SCRIPT
chmod 755 "$BIN"

cat > /etc/systemd/system/infra-escaneos-red.service <<UNIT
[Unit]
Description=Infra Ops: registro de ping y escaneos (solo LOG, no bloquea)
After=network-online.target docker.service
[Service]
Type=oneshot
ExecStart=$BIN --reglas
RemainAfterExit=yes
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now infra-escaneos-red.service
echo '* * * * * root /usr/local/bin/infra-escaneos-red.sh >/dev/null 2>&1' > /etc/cron.d/infra-escaneos-red
"$BIN"
echo "✔ Listo. Reglas (solo registran):"; iptables -S $CH
echo "✔ Métricas en $DIR/infra_netscan.prom (cada minuto). Prueba desde otro equipo: ping 3 veces a este servidor y espera 1-2 min."
