#!/bin/sh
# Bouwt het serverpakket voor de fabrieksserver: batch-gui-server-<versie>.zip
# Gebruik: tools/maak_serverpakket.sh [doelmap]   (standaard: ../batch-gui-server)
# Inhoud staat direct in de zip (geen bovenmap): uitpakken naar C:\batchgui\<versie>.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DOEL="${1:-$ROOT/../batch-gui-server}"
V="$(cat "$ROOT/VERSIE")"
rm -rf "$DOEL"; mkdir -p "$DOEL/server" "$DOEL/web" "$DOEL/db" "$DOEL/tools" "$DOEL/service"
(cd "$ROOT/api" && npx tsc)
(cd "$ROOT/invoer" && npm run build --silent)
(cd "$ROOT/portaal" && npm run build --silent)
cp -r "$ROOT/api/dist" "$DOEL/server/dist"
cp "$ROOT/api/package.json" "$ROOT/api/package-lock.json" "$DOEL/server/"
(cd "$DOEL/server" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund --silent)
cp -r "$ROOT/invoer/dist" "$DOEL/web/invoer"
cp -r "$ROOT/portaal/dist" "$DOEL/web/portaal"
cp "$ROOT/db/schema.sql" "$ROOT/db/rechten.sql" "$ROOT/db/seed_config.sql" "$ROOT/db/seed_accounts_demo.sql" "$DOEL/db/"
cp -r "$ROOT/db/migraties" "$DOEL/db/migraties"
for t in lib migreer backup herstel rotatie start-server beheerder; do cp "$ROOT/tools/$t.mjs" "$DOEL/tools/"; done
cp "$ROOT/tools/pakket/server/"* "$DOEL/service/"
cp "$ROOT/docs/SERVER.md" "$DOEL/README.md"
cp "$ROOT/VERSIE" "$ROOT/CHANGELOG.md" "$DOEL/"
echo "Serverpakket klaar in $DOEL"
if command -v zip >/dev/null; then
  Z="$(cd "$(dirname "$DOEL")" && pwd)/batch-gui-server-$V.zip"
  rm -f "$Z"; (cd "$DOEL" && zip -qr "$Z" .)
  echo "Zip: $Z"
fi
