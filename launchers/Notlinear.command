#!/bin/zsh

# Find the repo root by walking up from this script until backend/server.py
# appears, rather than hardcoding a path. Works wherever the repo is cloned,
# and survives this launcher being moved deeper or shallower in the tree.
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
while [ ! -f "${APP_DIR}/backend/server.py" ] && [ "${APP_DIR}" != "/" ]; do
  APP_DIR="$(dirname "${APP_DIR}")"
done
if [ ! -f "${APP_DIR}/backend/server.py" ]; then
  echo "notlinear: could not locate backend/server.py above $(dirname "$0")" >&2
  exit 1
fi
PORT="8765"
HOST="127.0.0.1"
URL="http://${HOST}:${PORT}/frontend/index.html"
LOG_DIR="${HOME}/Library/Logs/notlinear"
LOG_FILE="${LOG_DIR}/server.log"

mkdir -p "${LOG_DIR}"
cd "${APP_DIR}" || exit 1

if ! lsof -nP -iTCP:${PORT} -sTCP:LISTEN >/dev/null 2>&1; then
  nohup python3 backend/server.py --port "${PORT}" --host "${HOST}" > "${LOG_FILE}" 2>&1 &
  sleep 1
fi

open "${URL}"
exit 0
