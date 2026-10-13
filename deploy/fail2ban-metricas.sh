#!/usr/bin/env bash
# Publica el estado de fail2ban como métricas (node_exporter textfile) para el panel → Centro de seguridad.
# Solo LEE fail2ban (fail2ban-client status); no cambia reglas ni bloqueos. Se ejecuta cada minuto por cron.
# Instalar:   sudo bash fail2ban-metricas.sh
# Quitar:     sudo bash fail2ban-metricas.sh --uninstall
set -e
[ "$(id -u)" = 0 ] || { echo "Ejecuta con sudo"; exit 1; }
DIR=/var/lib/node_exporter/textfile
if [ "$1" = "--uninstall" ]; then rm -f /etc/cron.d/infra-fail2ban /usr/local/bin/infra-fail2ban.sh "$DIR/infra_fail2ban.prom"; echo "Quitado."; exit 0; fi
mkdir -p "$DIR"
cat > /usr/local/bin/infra-fail2ban.sh <<'SCRIPT'
#!/usr/bin/env bash
DIR=/var/lib/node_exporter/textfile
TMP=$(mktemp "$DIR/.infra_f2b.XXXXXX")
if ! command -v fail2ban-client >/dev/null 2>&1 || ! fail2ban-client ping >/dev/null 2>&1; then
  echo "infra_fail2ban_up 0" > "$TMP"
else
  echo "infra_fail2ban_up 1" > "$TMP"
  for j in $(fail2ban-client status | sed -n 's/.*Jail list:[[:space:]]*//p' | tr ',' ' '); do
    s=$(fail2ban-client status "$j" 2>/dev/null)
    val() { echo "$s" | sed -n "s/.*$1:[[:space:]]*//p" | head -1; }
    echo "infra_fail2ban_banned{jail=\"$j\"} $(val 'Currently banned' | tr -dc 0-9 || true)" | sed 's/ $/ 0/' >> "$TMP"
    echo "infra_fail2ban_banned_total{jail=\"$j\"} $(val 'Total banned' | tr -dc 0-9 || true)" | sed 's/ $/ 0/' >> "$TMP"
    echo "infra_fail2ban_failed{jail=\"$j\"} $(val 'Currently failed' | tr -dc 0-9 || true)" | sed 's/ $/ 0/' >> "$TMP"
    for ip in $(val 'Banned IP list'); do echo "infra_fail2ban_banned_ip{jail=\"$j\",ip=\"$ip\"} 1"; done | head -300 >> "$TMP"
  done
fi
chmod 644 "$TMP" && mv "$TMP" "$DIR/infra_fail2ban.prom"
SCRIPT
chmod 755 /usr/local/bin/infra-fail2ban.sh
echo '* * * * * root /usr/local/bin/infra-fail2ban.sh >/dev/null 2>&1' > /etc/cron.d/infra-fail2ban
/usr/local/bin/infra-fail2ban.sh
echo "Listo. Métricas en $DIR/infra_fail2ban.prom (se actualizan cada minuto):"
cat "$DIR/infra_fail2ban.prom"
