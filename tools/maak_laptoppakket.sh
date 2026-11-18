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
cp "$ROOT/db/rechten.sql" "$DOEL/db/" && cp -r "$ROOT/db/migraties" "$DOEL/db/migraties"
mkdir -p "$DOEL/tools" && cp "$ROOT/tools/lib.mjs" "$ROOT/tools/migreer.mjs" "$DOEL/tools/"
cp "$ROOT/VERSIE" "$DOEL/"
cp "$ROOT/tools/pakket/opstarten.mjs" "$ROOT/tools/pakket/START.bat" "$ROOT/tools/pakket/TESTDATA OPNIEUW.bat" \
   "$ROOT/tools/pakket/start.sh" "$ROOT/tools/pakket/README.md" "$DOEL/"
echo "Pakket klaar in $DOEL"
# Zip met het versienummer in de naam
V="$(cat "$ROOT/VERSIE")"
if command -v zip >/dev/null; then
  (cd "$(dirname "$DOEL")" && rm -f "batch-gui-laptop-$V.zip" && zip -qr "batch-gui-laptop-$V.zip" "$(basename "$DOEL")")
  echo "Zip: $(dirname "$DOEL")/batch-gui-laptop-$V.zip"
fi
