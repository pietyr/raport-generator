#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

mkdir -p data

PORT="${PORT:-3000}"

port_in_use() {
  ss -tln 2>/dev/null | grep -q ":${PORT} " || \
    netstat -tln 2>/dev/null | grep -q ":${PORT} "
}

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  echo "Uruchamiam przez Docker Compose..."
  if port_in_use; then
    echo "UWAGA: port ${PORT} jest zajęty — Docker nie zbindowałby go poprawnie."
    echo "Zatrzymaj proces na porcie ${PORT} (np. stary npm run dev) i spróbuj ponownie:"
    echo "  ss -tlnp | grep :${PORT}"
    echo "  docker compose down"
    exit 1
  fi
  docker compose up --build "$@"
  exit 0
fi

echo "Docker niedostępny — uruchamiam lokalnie (dev)."
echo "Uwaga: konwersja PDF wymaga LibreOffice (soffice) w PATH."
echo "Aplikacja: http://localhost:5173  (API: http://localhost:${PORT})"

if [[ ! -d node_modules ]]; then
  npm install
fi

npm run dev
