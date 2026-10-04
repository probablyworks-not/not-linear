#!/bin/zsh
set -e

APP_NAME="Notlinear"
# Repo root, derived from this script's own location (see Notlinear.command).
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_PATH="${APP_DIR}/launchers/${APP_NAME}.app"
DESKTOP_APP="${HOME}/Desktop/${APP_NAME}.app"
NATIVE_SOURCE="${APP_DIR}/launchers/NotlinearNative.m"
APP_EXECUTABLE="${APP_PATH}/Contents/MacOS/${APP_NAME}"

mkdir -p "${APP_PATH}/Contents/MacOS"
# NOTLINEAR_ROOT is compiled in, because the app is meant to be copied to the
# Desktop (see below) and a bundle-relative lookup would break the moment it
# moves. At runtime a NOTLINEAR_ROOT environment variable still wins, and the
# bundle-relative guess is the last resort.
clang "${NATIVE_SOURCE}" -o "${APP_EXECUTABLE}" -framework Cocoa -framework WebKit -fobjc-arc \
  -DNOTLINEAR_ROOT="\"${APP_DIR}\""
chmod +x "${APP_EXECUTABLE}"

echo "Built ${APP_PATH}"
echo
echo "To run from your Desktop:"
echo "  cp -R '${APP_PATH}' '${DESKTOP_APP}'"
echo
echo "Then double-click ${APP_NAME}.app on your Desktop."
