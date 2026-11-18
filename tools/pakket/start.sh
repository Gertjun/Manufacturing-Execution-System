#!/bin/sh
# Mac/Linux: starten met ./start.sh (of ./start.sh --opnieuw voor verse testdata)
cd "$(dirname "$0")" || exit 1
command -v node >/dev/null || { echo "Node.js is niet gevonden. Installeer Node.js 26 LTS van https://nodejs.org"; exit 1; }
exec node opstarten.mjs "$@"
