#!/bin/zsh

APP_DIR="/Users/yash/Downloads/notlinear"
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
