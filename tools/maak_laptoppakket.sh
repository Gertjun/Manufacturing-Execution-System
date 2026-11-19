#!/bin/sh
# Bouwt het laptoppakket (proof of concept): alles in één map, niets te installeren.
#
#   tools/maak_laptoppakket.sh [doelmap] [platform]
#     platform: windows (standaard)  → met runtime\node.exe en een ingebouwde PostgreSQL voor Windows
#               linux                → met een ingebouwde PostgreSQL voor Linux (Node.js zelf installeren); voor tests
#               geen                 → zonder ingebouwde onderdelen; gebruikt een geïnstalleerde Node.js en PostgreSQL
#
# Maakt ook batch-gui-laptop-<versie>-<platform>.zip naast de doelmap.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DOEL="${1:-$ROOT/../batch-gui-laptop}"
PLATFORM="${2:-windows}"
V="$(cat "$ROOT/VERSIE")"

# Vastgezette versies van de ingebouwde onderdelen
NODE_VERSIE="26.13.1"
NODE_SHA256="f5109dc868ec38703ad8f305e0aceece717cb60d4889873f434017af4e96cccb"   # win-x64/node.exe volgens nodejs.org/blog/release/v26.13.1
PG_PAKKET_VERSIE="18.6.0-beta.19"                                                 # npm @embedded-postgres/*, PostgreSQL 18.6
# Microsoft Visual C++-runtime die PostgreSQL voor Windows nodig heeft (app-lokaal meegeleverd).
# Bron: PyPI-pakket msvc-runtime; de DLL's zijn door Microsoft ondertekend (gecontroleerd 19-11-2026).
VC_VERSIE="14.51.36231"
VC_SHA256="d1f4225df2cd877dbf130d5668a021dce3f94118455ff5ec952061c30afc9ce7  vcruntime140.dll
a7146c08f89fe5b04541ab507cdb59ff7b44534d4ba3c668a426c6450a03434e  vcruntime140_1.dll
7c26614e1d733892c2deac7e245ce115504b1d80592dd0a01b08e3e5a55f89ca  msvcp140.dll"
CACHE="$ROOT/tools/pakket/.cache"

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
cp "$ROOT/tools/pakket/opstarten.mjs" "$ROOT/tools/pakket/README.md" "$DOEL/"
if [ "$PLATFORM" = "windows" ]; then
  cp "$ROOT/tools/pakket/"*.bat "$DOEL/"
else
  cp "$ROOT/tools/pakket/start.sh" "$DOEL/" && chmod +x "$DOEL/start.sh"
fi

haal() { # npm-pakket in de cache uitpakken: haal <pakket@versie> <map>
  if [ ! -d "$CACHE/$2" ]; then
    mkdir -p "$CACHE/$2" && (cd "$CACHE" && npm pack "$1" --silent >/dev/null 2>&1 && tar xzf "$(ls -t *.tgz | head -1)" -C "$2" && rm -f *.tgz)
  fi
}

pg_inbouwen() { # pg_inbouwen <npm-platform>
  haal "@embedded-postgres/$1@$PG_PAKKET_VERSIE" "pg-$1"
  N="$CACHE/pg-$1/package/native"
  mkdir -p "$DOEL/postgres"
  cp -r "$N/bin" "$N/lib" "$N/share" "$DOEL/postgres/"
  cp "$CACHE/pg-$1/package/LICENSE.md" "$DOEL/postgres/LICENSE.md" 2>/dev/null || true
  # Niet nodig voor de database (onderdelen van grafische hulpprogramma's en ontwikkelbestanden)
  rm -f "$DOEL"/postgres/bin/wx*.dll "$DOEL"/postgres/bin/testplug.dll "$DOEL"/postgres/lib/*.lib "$DOEL"/postgres/lib/*.a
  # npm bewaart geen symbolische koppelingen; het pakket somt ze op in pg-symlinks.json
  if [ -f "$N/pg-symlinks.json" ]; then
    node -e '
      const fs = require("fs"), p = require("path"), [doel, lijst] = process.argv.slice(1);
      for (const { source, target } of JSON.parse(fs.readFileSync(lijst, "utf8"))) {
        const t = p.join(doel, target.replace(/^native[\/\\]/, "")), s = p.join(doel, source.replace(/^native[\/\\]/, ""));
        try { fs.symlinkSync(p.relative(p.dirname(t), s), t); } catch {}
      }' "$DOEL/postgres" "$N/pg-symlinks.json"
  fi
}

case "$PLATFORM" in
  windows)
    pg_inbouwen windows-x64
    haal "node-win-x64@$NODE_VERSIE" "node-win-$NODE_VERSIE"
    EXE="$CACHE/node-win-$NODE_VERSIE/package/bin/node.exe"
    echo "$NODE_SHA256  $EXE" | sha256sum -c --quiet || { echo "FOUT: node.exe wijkt af van de officiële versie"; exit 1; }
    mkdir -p "$DOEL/runtime" && cp "$EXE" "$DOEL/runtime/node.exe"
    VC="$CACHE/vc-$VC_VERSIE"
    if [ ! -d "$VC" ]; then
      mkdir -p "$VC" && pip download "msvc-runtime==$VC_VERSIE" --platform win_amd64 --only-binary=:all: --no-deps -d "$VC" -q
      (cd "$VC" && python3 -m zipfile -e msvc_runtime-*.whl uit >/dev/null)
    fi
    for f in vcruntime140.dll vcruntime140_1.dll msvcp140.dll; do cp "$VC"/uit/*.data/data/Scripts/$f "$DOEL/postgres/bin/"; done
    (cd "$DOEL/postgres/bin" && echo "$VC_SHA256" | sha256sum -c --quiet) || { echo "FOUT: Visual C++-runtime wijkt af"; exit 1; }
    ;;
  linux) pg_inbouwen linux-x64 ;;
  geen) ;;
  *) echo "Onbekend platform: $PLATFORM"; exit 1 ;;
esac

echo "Laptoppakket ($PLATFORM) klaar in $DOEL"
if command -v zip >/dev/null; then
  Z="$(cd "$(dirname "$DOEL")" && pwd)/batch-gui-laptop-$V-$PLATFORM.zip"
  rm -f "$Z"; (cd "$(dirname "$DOEL")" && zip -qry "$Z" "$(basename "$DOEL")")
  echo "Zip: $Z ($(du -h "$Z" | cut -f1))"
fi
