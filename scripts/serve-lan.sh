#!/bin/zsh
# Serve the app to the local Wi-Fi so an iPad can try it. Stop with Ctrl+C.
set -eu
PORT="${1:-8000}"
cd "$(dirname "$0")/.."
IP="$(ipconfig getifaddr en0 || echo 'IP不明')"
echo "iPadのSafariで開く: http://${IP}:${PORT}/"
echo "Macで開く:         http://localhost:${PORT}/"
exec python3 -m http.server "$PORT" --bind 0.0.0.0
