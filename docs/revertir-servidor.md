# Revertir app-server a como estaba

Deshace todo lo que se hizo en el servidor durante las pruebas del 25-sep-2026.
Ejecuta los bloques **en orden**. Cada uno valida antes de aplicar.

> Todo se hace en el servidor: `ssh app-server`

## 1. nginx: quitar la página /estado/

```bash
sudo sed -i '/include \/etc\/nginx\/conf.d\/infra-estado.locations;/d' /etc/nginx/conf.d/infra-ops-console.conf
sudo rm -rf /etc/nginx/conf.d/estado /etc/nginx/conf.d/infra-estado.locations /etc/nginx/conf.d/infra-estado.htpasswd
grep -c infra-estado /etc/nginx/conf.d/infra-ops-console.conf     # debe dar 0
sudo nginx -t && sudo systemctl reload nginx && echo "NGINX OK"
```

## 2. docker-compose: restaurar node-exporter original

```bash
cd /opt/enterprise-tools/infra-ops-console
ls docker-compose.yml.bak-*                       # debe existir docker-compose.yml.bak-2026-09-25-1351
sudo cp docker-compose.yml.bak-2026-09-25-1351 docker-compose.yml
sudo docker compose config -q && echo "YAML OK"
sudo docker compose up -d --no-deps --force-recreate node-exporter
```

## 3. Prometheus: restaurar prometheus.yml (solo si se cambió el nombre del servidor)

```bash
cd /opt/enterprise-tools/infra-ops-console
ls prometheus/prometheus.yml.bak-* 2>/dev/null || echo "No hay backup: no se modificó, salta este paso"
```

Si existe **un** backup:

```bash
B=$(ls prometheus/prometheus.yml.bak-* | head -1)
diff "$B" prometheus/prometheus.yml                # debe mostrar solo las 2 líneas 'labels/instance'
cat "$B" | sudo tee prometheus/prometheus.yml > /dev/null
sudo docker run --rm -v "$PWD/prometheus:/p:ro" --entrypoint promtool prom/prometheus:latest check config /p/prometheus.yml
curl -s -X POST http://127.0.0.1:9090/-/reload && echo "RELOAD OK"
```

> Se usa `cat | tee` (no `cp`) para que el contenedor vea el cambio sin reiniciarse.

## 4. Agente: scripts, cron y métricas

```bash
sudo rm -f /etc/cron.d/infra-metrics /usr/local/bin/infra-metrics.sh /usr/local/bin/infra-metrics-info.sh
sudo rm -rf /var/lib/node_exporter
dpkg -l | grep -q prometheus-node-exporter && sudo apt-get remove -y prometheus-node-exporter prometheus-node-exporter-collectors || echo "paquete no instalado, OK"
```

## 5. Limpieza de archivos temporales

```bash
rm -f /tmp/index.html /tmp/infra-estado.locations /tmp/infra-agent-install.sh
```

Opcional, cuando confirmes que todo quedó bien, borra los backups:

```bash
cd /opt/enterprise-tools/infra-ops-console
sudo rm -f docker-compose.yml.bak-* prometheus/prometheus.yml.bak-*
sudo sh -c 'rm -f /root/infra-ops-console.conf.bak-*'
```

## 6. Grafana (desde el navegador)

- **Dashboards** → elimina "Infra Ops · Servidores (estado general)" y "Infra Ops · Estado".
- **Connections → Data sources → prometheus**: se dejó con la URL `http://prometheus:9090`. Si quieres dejarlo como estaba, bórralo.

## Verificación final

```bash
sudo docker ps --format '{{.Names}}\t{{.Status}}'          # todos Up
curl -s -o /dev/null -w "%{http_code}\n" https://monitoreo.empresa.com/   # 200 o 302 (Grafana)
curl -s -o /dev/null -w "%{http_code}\n" https://monitoreo.empresa.com/estado/   # ya NO debe ser la página
```
