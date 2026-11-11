#!/bin/zsh
set -euo pipefail
REPO_DIR="${0:A:h:h}"
if [[ -z "${NOTLINEAR_PYTHON_FRAMEWORK:-}" ]]; then
  echo 'Set NOTLINEAR_PYTHON_FRAMEWORK to a python.org framework Versions/3.x directory.'
  echo 'Example: NOTLINEAR_PYTHON_FRAMEWORK=/Library/Frameworks/Python.framework/Versions/3.13 ./launchers/build-macos-app.command'
  exit 1
fi
exec python3 "${REPO_DIR}/scripts/build_macos.py" --python-framework "${NOTLINEAR_PYTHON_FRAMEWORK}" "$@"
