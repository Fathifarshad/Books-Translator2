#!/bin/sh
# Dozabaneh - start on macOS/Linux. Details: README.md
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Install the LTS version from https://nodejs.org, then run ./start.sh again."
  exit 1
fi
exec node scripts/start.mjs "$@"
