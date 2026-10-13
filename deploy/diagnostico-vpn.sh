#!/usr/bin/env bash
# Diagnóstico de la conexión AWS → sede principal (SOLO LECTURA: no cambia nada).
#   sudo bash diagnostico-vpn.sh
# Revisa: ping desde el servidor, ping desde Blackbox (lo que usa el panel), acceso al FortiGate por la VPN,
# estado de los túneles de AWS, y si fail2ban o el firewall del servidor están bloqueando IP de la sede.
[ "$(id -u)" = 0 ] || { echo "Ejecuta con sudo (sudo su -)"; exit 1; }
SEDE_LAN=192.168.10.254; FGT=192.168.10.253; SEDE_WAN=203.0.113.10
P=/opt/enterprise-tools/infra-panel
ok() { echo "  ✔ $*"; }; ko() { echo "  ✘ $*"; }; inf() { echo "  · $*"; }
V=()

echo "=== 1. Ping desde el servidor ==="
for ip in $SEDE_LAN $FGT $SEDE_WAN; do
  if ping -c3 -W2 "$ip" >/dev/null 2>&1; then ok "$ip responde"; else ko "$ip NO responde"; V+=("ping a $ip falla desde el servidor"); fi
done
inf "Ruta hacia la sede: $(ip route get $SEDE_LAN 2>/dev/null | head -1)"

echo "=== 2. Ping desde Blackbox (lo que usa el panel) ==="
BB=$(curl -s -m 15 "http://127.0.0.1:9115/probe?module=icmp&target=$SEDE_LAN&debug=true" 2>/dev/null)
if [ -z "$BB" ]; then ko "Blackbox no responde en 127.0.0.1:9115"; V+=("Blackbox caído"); docker ps -a --format '{{.Names}}\t{{.Status}}' | grep -i blackbox | sed 's/^/    /'
elif echo "$BB" | grep -q 'probe_success 1'; then ok "Blackbox llega a $SEDE_LAN"
else ko "Blackbox NO llega a $SEDE_LAN"; echo "$BB" | grep -iE 'level=(error|warn)|msg=' | head -5 | sed 's/^/    /'; fi

echo "=== 3. FortiGate por la VPN (API del panel) ==="
C=$(curl -sk -m 8 -o /dev/null -w '%{http_code}' "https://$FGT:10443/" 2>/dev/null)
[ "$C" != "000" ] && ok "FortiGate responde por HTTPS (código $C): la VPN SÍ pasa tráfico" || { ko "FortiGate no responde por HTTPS"; V+=("no hay tráfico por la VPN hacia la sede"); }

echo "=== 4. Túneles de la VPN en AWS ==="
if command -v aws >/dev/null 2>&1; then
  aws ec2 describe-vpn-connections --region us-east-1 --query 'VpnConnections[].[VpnConnectionId,State,VgwTelemetry[].[OutsideIpAddress,Status,StatusMessage,LastStatusChange]]' --output text 2>&1 | sed 's/^/    /' | head -20
elif [ -f "$P/current/server/scripts/revisar-vpn.mjs" ]; then
  ( cd "$P/current/server" && set -a && . "$P/shared/.env" 2>/dev/null; set +a; timeout 40 node scripts/revisar-vpn.mjs 2>&1 | head -40 | sed 's/^/    /' )
else inf "Sin AWS CLI: revisa en la consola AWS → VPC → Site-to-Site VPN → pestaña Túneles"; fi

echo "=== 5. ¿fail2ban bloqueó IP de la sede o de la LAN? ==="
if command -v fail2ban-client >/dev/null 2>&1 && fail2ban-client ping >/dev/null 2>&1; then
  for j in $(fail2ban-client status | sed -n 's/.*Jail list:[[:space:]]*//p' | tr ',' ' '); do
    L=$(fail2ban-client status "$j" | sed -n 's/.*Banned IP list:[[:space:]]*//p')
    for ip in $L; do case "$ip" in $SEDE_WAN|192.168.*|10.*|172.1[6-9].*|172.2?.*|172.3[01].*) ko "jail $j tiene BLOQUEADA la IP $ip"; V+=("fail2ban bloqueó $ip (jail $j). Desbloquear: fail2ban-client set $j unbanip $ip");; esac; done
    inf "jail $j: $(echo $L | wc -w) IP bloqueadas"
  done
else inf "fail2ban no está activo"; fi

echo "=== 6. Firewall del servidor ==="
R=$(iptables -S 2>/dev/null | grep -E "$SEDE_WAN|192\.168\." | grep -E 'DROP|REJECT')
[ -n "$R" ] && { ko "Reglas que bloquean IP de la sede:"; echo "$R" | sed 's/^/    /'; V+=("hay reglas DROP/REJECT para IP de la sede en el servidor"); } || ok "Ninguna regla del servidor bloquea la sede"
iptables -S INFRA-SCAN >/dev/null 2>&1 && inf "Registro de escaneos instalado (solo registra, no bloquea)"

echo; echo "=== Resultado ==="
if [ ${#V[@]} -eq 0 ]; then echo "  ✔ Todo responde ahora. Si el panel seguía en rojo fue una caída pasajera: recarga la página."
else printf '  → %s\n' "${V[@]}"; fi
echo "Envíale este resultado a Claude."
