#!/usr/bin/env bash
# Arranca TODO en una sola terminal: túnel hacia AWS (en segundo plano) + compila la página + inicia el panel.
# Ctrl+C cierra el panel y el túnel juntos.
cd "$(dirname "$0")/.."
echo "→ Cerrando panel y túnel anteriores (si había)…"
lsof -ti tcp:4000 2>/dev/null | xargs kill 2>/dev/null
pkill -f "ssh -N -o ExitOnForwardFailure" 2>/dev/null
sleep 1
echo "→ Abriendo túnel hacia app-server…"
bash scripts/tunnel.sh > /tmp/infra-tunel.log 2>&1 &
TUN=$!
sleep 3
if kill -0 $TUN 2>/dev/null; then echo "  ✔ Túnel abierto"; else echo "  ✘ El túnel no abrió (el panel funciona, pero sin datos de AWS):"; cat /tmp/infra-tunel.log; fi
trap 'echo; echo "→ Cerrando túnel…"; kill $TUN 2>/dev/null; exit 0' INT TERM EXIT
echo "→ Compilando la página…"
npm --prefix web run build --silent > /tmp/infra-build.log 2>&1 || { echo "  ✘ Error al compilar:"; tail -20 /tmp/infra-build.log; exit 1; }
echo "  ✔ Compilada"
IP=$(ipconfig getifaddr en0 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}')
echo "→ Panel listo en http://localhost:4000${IP:+  ·  red local: http://$IP:4000}   (Ctrl+C para cerrar todo)"
cd server && HOST=0.0.0.0 NODE_ENV=production node src/index.js
