#!/bin/sh
# Bouwt het laptoppakket: batch-gui-laptop/ met voorgebouwde server en schermen.
# Gebruik: tools/maak_laptoppakket.sh <doelmap>
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DOEL="${1:-$ROOT/../batch-gui-laptop}"
rm -rf "$DOEL"; mkdir -p "$DOEL/server" "$DOEL/web" "$DOEL/db"
(cd "$ROOT/api" && npx tsc)
(cd "$ROOT/invoer" && npm run build --silent)
(cd "$ROOT/portaal" && npm run build --silent)
cp -r "$ROOT/api/dist" "$DOEL/server/dist"
cp "$ROOT/api/package.json" "$ROOT/api/package-lock.json" "$DOEL/server/"
(cd "$DOEL/server" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund --silent)
cp -r "$ROOT/invoer/dist" "$DOEL/web/invoer"
cp -r "$ROOT/portaal/dist" "$DOEL/web/portaal"
cp "$ROOT/db/schema.sql" "$ROOT/db/seed_config.sql" "$ROOT/tools/pakket/testdata.sql" "$DOEL/db/"
cp "$ROOT/tools/pakket/opstarten.mjs" "$ROOT/tools/pakket/START.bat" "$ROOT/tools/pakket/TESTDATA OPNIEUW.bat" \
   "$ROOT/tools/pakket/start.sh" "$ROOT/tools/pakket/LEESMIJ.md" "$DOEL/"
echo "Pakket klaar in $DOEL"
