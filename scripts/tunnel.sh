#!/usr/bin/env bash
# Abre un túnel SSH seguro hacia el Prometheus del servidor.
# Tu Mac verá Prometheus en http://127.0.0.1:9090 sin exponerlo a internet.
# Ctrl+C para cerrarlo.
set -e
HOST_ALIAS="${1:-app-server}"   # usa el Host de tu ~/.ssh/config
LOCAL_PORT="${LOCAL_PORT:-9090}"
# FortiGate de la sede (API): sale desde app-server, que es la IP permitida en el FortiGate
FG_TARGET="${FG_TARGET:-192.168.10.253:10443}"
echo "Túnel: Prometheus 127.0.0.1:${LOCAL_PORT} · Loki 127.0.0.1:3100 · Alertmanager 127.0.0.1:9093 · FortiGate 127.0.0.1:10443  →  ${HOST_ALIAS}   (Ctrl+C para cerrar)"
exec ssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 \
  -L "${LOCAL_PORT}:127.0.0.1:9090" -L "3100:127.0.0.1:3100" -L "9093:127.0.0.1:9093" -L "10443:${FG_TARGET}" "$HOST_ALIAS"
