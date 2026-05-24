#!/bin/zsh
set -e

APP_NAME="Notlinear"
APP_DIR="/Users/yash/Downloads/notlinear"
APP_PATH="${APP_DIR}/launchers/${APP_NAME}.app"
DESKTOP_APP="${HOME}/Desktop/${APP_NAME}.app"
NATIVE_SOURCE="${APP_DIR}/launchers/NotlinearNative.m"
APP_EXECUTABLE="${APP_PATH}/Contents/MacOS/${APP_NAME}"

mkdir -p "${APP_PATH}/Contents/MacOS"
clang "${NATIVE_SOURCE}" -o "${APP_EXECUTABLE}" -framework Cocoa -framework WebKit -fobjc-arc
chmod +x "${APP_EXECUTABLE}"

echo "Built ${APP_PATH}"
echo
echo "To run from your Desktop:"
echo "  cp -R '${APP_PATH}' '${DESKTOP_APP}'"
echo
echo "Then double-click ${APP_NAME}.app on your Desktop."
